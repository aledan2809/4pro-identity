#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// --- CLI flags ---
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

// --- Load env var from an .env file ---
function loadEnvVar(envPath, varName) {
  const resolved = path.resolve(envPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Env file not found: ${resolved}`);
  }
  const content = fs.readFileSync(resolved, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (key === varName) {
      let val = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      return val;
    }
  }
  throw new Error(`Variable ${varName} not found in ${resolved}`);
}

// --- DB connections ---
const identityUrl = loadEnvVar('C:/Projects/4pro-identity/.env', 'IDENTITY_DB_URL');
const eCabinetUrl = loadEnvVar('C:/Projects/eCabinet/server/.env', 'DATABASE_URL');
const proUrl = loadEnvVar('C:/Projects/PRO/.env', 'DATABASE_URL');

const identityPool = new Pool({ connectionString: identityUrl, ssl: { rejectUnauthorized: false } });
const eCabinetPool = new Pool({ connectionString: eCabinetUrl, ssl: { rejectUnauthorized: false } });
const proPool = new Pool({ connectionString: proUrl, ssl: { rejectUnauthorized: false } });

// --- Stats ---
const stats = {
  eCabinet: { total: 0, noPhone: 0, migrated: 0, skipped: 0, errors: 0 },
  PRO: { total: 0, noPhone: 0, migrated: 0, skipped: 0, errors: 0 },
  conflicts: [],
};

// Track phones we've already processed (first source wins)
const processedPhones = new Map(); // phone -> sourceName

// --- Fetch users from eCabinet ---
async function fetchECabinetUsers() {
  const res = await eCabinetPool.query(`
    SELECT id, phone, email, "firstName", "lastName", password, locale
    FROM "User"
  `);
  return res.rows;
}

// --- Fetch users from PRO ---
// PRO table is "pro_users" with "name" (single field) instead of firstName/lastName
async function fetchPROUsers() {
  const res = await proPool.query(`
    SELECT id, phone, email, name, password, locale
    FROM pro_users
  `);
  return res.rows.map(row => {
    const parts = (row.name || '').trim().split(/\s+/);
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ') || '';
    return { ...row, firstName, lastName };
  });
}

// --- Check if phone exists in Identity DB ---
async function phoneExistsInIdentity(phone) {
  const res = await identityPool.query(
    'SELECT "globalId" FROM "Identity" WHERE phone = $1',
    [phone]
  );
  return res.rows.length > 0;
}

// --- Insert user into Identity DB ---
async function insertIdentityUser(user) {
  const res = await identityPool.query(
    `INSERT INTO "Identity" ("phone", "hashedPassword", "email", "firstName", "lastName", "locale", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING "globalId"`,
    [user.phone, user.password, user.email || null, user.firstName, user.lastName, user.locale || 'ro']
  );
  return res.rows[0].globalId;
}

// --- Ensure globalId column exists in source DB ---
async function ensureGlobalIdColumn(pool, sourceName) {
  if (sourceName === 'eCabinet') {
    // eCabinet already has globalId column on "User" table
    return;
  }
  // PRO: add globalId column to pro_users if it doesn't exist
  await pool.query(`
    ALTER TABLE pro_users
    ADD COLUMN IF NOT EXISTS "globalId" VARCHAR(255) UNIQUE
  `);
  console.log('  [INFO] Ensured globalId column exists on PRO pro_users table');
}

// --- Update source DB with globalId ---
async function updateSourceGlobalId(sourcePool, sourceName, phone, globalId) {
  if (sourceName === 'eCabinet') {
    await sourcePool.query(
      'UPDATE "User" SET "globalId" = $1 WHERE phone = $2',
      [globalId, phone]
    );
  } else {
    await sourcePool.query(
      'UPDATE pro_users SET "globalId" = $1 WHERE phone = $2',
      [globalId, phone]
    );
  }
}

// --- Migrate a single user ---
async function migrateUser(user, sourceName, sourcePool) {
  const s = stats[sourceName];
  const { phone } = user;

  // Skip users without phone
  if (!phone || !phone.trim()) {
    s.noPhone++;
    return;
  }

  // Check cross-source duplicates (first source wins)
  if (processedPhones.has(phone)) {
    const firstSource = processedPhones.get(phone);
    if (firstSource !== sourceName) {
      stats.conflicts.push({ phone, firstSource, duplicateSource: sourceName });
      console.log(`  [CONFLICT] Phone ${phone} already processed from ${firstSource}, skipping ${sourceName} duplicate`);
    }
    s.skipped++;
    return;
  }

  processedPhones.set(phone, sourceName);

  try {
    const exists = await phoneExistsInIdentity(phone);

    if (exists) {
      console.log(`  [SKIP] ${sourceName} user ${phone}: already in Identity DB`);
      s.skipped++;
      return;
    }

    if (isDryRun) {
      console.log(`  [DRY-RUN] Would insert ${sourceName} user: ${phone} (${user.firstName} ${user.lastName})`);
      s.migrated++;
      return;
    }

    const globalId = await insertIdentityUser(user);
    await updateSourceGlobalId(sourcePool, sourceName, phone, globalId);
    console.log(`  [MIGRATED] ${sourceName} user ${phone} -> globalId: ${globalId}`);
    s.migrated++;
  } catch (err) {
    console.error(`  [ERROR] ${sourceName} user ${phone}: ${err.message}`);
    s.errors++;
  }
}

// --- Main ---
async function main() {
  console.log('=== 4PRO Identity - User Migration Script ===');
  if (isDryRun) console.log('*** DRY RUN MODE - No writes will be made ***\n');

  try {
    // Verify Identity DB connection
    await identityPool.query('SELECT 1');
    console.log('[OK] Connected to Identity DB');

    // Fetch users from both sources
    console.log('\nFetching users from eCabinet...');
    const eCabinetUsers = await fetchECabinetUsers();
    stats.eCabinet.total = eCabinetUsers.length;
    console.log(`  Found ${eCabinetUsers.length} users`);

    console.log('Fetching users from PRO...');
    const proUsers = await fetchPROUsers();
    stats.PRO.total = proUsers.length;
    console.log(`  Found ${proUsers.length} users`);

    // Ensure globalId columns exist in source DBs (for back-reference)
    if (!isDryRun) {
      await ensureGlobalIdColumn(eCabinetPool, 'eCabinet');
      await ensureGlobalIdColumn(proPool, 'PRO');
    }

    // Process eCabinet first (first source wins for duplicates)
    console.log('\n--- Migrating eCabinet users ---');
    for (const user of eCabinetUsers) {
      await migrateUser(user, 'eCabinet', eCabinetPool);
    }

    console.log('\n--- Migrating PRO users ---');
    for (const user of proUsers) {
      await migrateUser(user, 'PRO', proPool);
    }

    // Print summary
    console.log('\n=== Migration Summary ===');
    for (const source of ['eCabinet', 'PRO']) {
      const s = stats[source];
      console.log(`\n${source}:`);
      console.log(`  Total users:     ${s.total}`);
      console.log(`  No phone (skip): ${s.noPhone}`);
      console.log(`  Migrated:        ${s.migrated}`);
      console.log(`  Skipped (dups):  ${s.skipped}`);
      console.log(`  Errors:          ${s.errors}`);
    }

    if (stats.conflicts.length > 0) {
      console.log(`\nCross-source conflicts (${stats.conflicts.length}):`);
      for (const c of stats.conflicts) {
        console.log(`  Phone ${c.phone}: kept from ${c.firstSource}, skipped from ${c.duplicateSource}`);
      }
    }

    const totalMigrated = stats.eCabinet.migrated + stats.PRO.migrated;
    const totalSkipped = stats.eCabinet.skipped + stats.PRO.skipped;
    const totalErrors = stats.eCabinet.errors + stats.PRO.errors;
    console.log(`\nTOTAL: ${totalMigrated} migrated, ${totalSkipped} skipped, ${totalErrors} errors`);

  } catch (err) {
    console.error('\nFATAL ERROR:', err.message);
    process.exit(1);
  } finally {
    await identityPool.end();
    await eCabinetPool.end();
    await proPool.end();
  }
}

main();
