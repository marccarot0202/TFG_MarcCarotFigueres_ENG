const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../database/web3_security.db');

const db = new sqlite3.Database(DB_PATH);

const limit = Number(process.argv[2] || 10);
const typeFilter = process.argv[3] || null;

let sql = `
  SELECT address, label, type, source
  FROM known_addresses
`;
const params = [];

if (typeFilter) {
  sql += ` WHERE type = ?`;
  params.push(typeFilter);
}

sql += ` ORDER BY address ASC LIMIT ?`;
params.push(limit);

db.all(sql, params, (err, rows) => {
  if (err) {
    console.error('❌ Error consulting known_addresses:', err.message);
    db.close();
    process.exit(1);
    return;
  }

  console.log(`📋 ${rows.length} known addresses are shown`);
  console.log('='.repeat(80));

  for (const row of rows) {
    console.log(`Address: ${row.address}`);
    console.log(`Label: ${row.label}`);
    console.log(`Type: ${row.type}`);
    console.log(`Source: ${row.source}`);
    console.log('-'.repeat(80));
  }

  db.close();
});
