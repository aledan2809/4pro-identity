const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const connStr = process.argv[2];
if (!connStr) {
  console.error('Usage: node run-schema.js <connection_string>');
  process.exit(1);
}

async function run() {
  const client = new Client({ connectionString: connStr });
  await client.connect();
  console.log('Connected to database.');

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await client.query(schema);
  console.log('Schema executed successfully.');

  // Verify tables
  const res = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `);
  console.log('Tables created:', res.rows.map(r => r.table_name));

  await client.end();
}

run().catch(err => { console.error(err); process.exit(1); });
