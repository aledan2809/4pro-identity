const { Client } = require('pg');

const ownerConn = process.argv[2];
if (!ownerConn) {
  console.error('Usage: node grant-permissions.js <owner_connection_string>');
  process.exit(1);
}

async function run() {
  const client = new Client({ connectionString: ownerConn });
  await client.connect();
  console.log('Connected as owner.');

  const grants = [
    'GRANT USAGE ON SCHEMA public TO identity_service_user',
    'GRANT SELECT, INSERT, UPDATE ON "Identity" TO identity_service_user',
    'GRANT SELECT, INSERT, UPDATE ON "PhoneChangeLog" TO identity_service_user',
    'GRANT USAGE, SELECT ON SEQUENCE "PhoneChangeLog_id_seq" TO identity_service_user',
  ];

  for (const sql of grants) {
    await client.query(sql);
    console.log('OK:', sql);
  }

  await client.end();
  console.log('All permissions granted.');
}

run().catch(err => { console.error(err); process.exit(1); });
