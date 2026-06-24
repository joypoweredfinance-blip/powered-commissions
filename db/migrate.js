// Adds columns to TABLES THAT ALREADY EXIST in a live database. `CREATE TABLE IF NOT EXISTS`
// in schema.js only helps brand-new tables — it's a no-op against a table that's already
// there, so any new column on an existing table (like `deals`) needs an explicit ALTER here.
// This is what lets Joy's real data survive an app update without ever recreating the database.
const { run, get, all } = require('./client');

const COLUMN_MIGRATIONS = [
  { table: 'deals', column: 'owner_m1_paid_date', definition: 'TEXT' },
  { table: 'deals', column: 'owner_m2_paid_date', definition: 'TEXT' },
  { table: 'deals', column: 'joey_paid_date', definition: 'TEXT' },
  { table: 'deals', column: 'gross_amount', definition: 'REAL' },
  { table: 'deals', column: 'expected_m1_amount', definition: 'REAL' },
  { table: 'deals', column: 'expected_m2_amount', definition: 'REAL' },
  { table: 'deals', column: 'funds_received_m1', definition: 'REAL' },
  { table: 'deals', column: 'funds_received_m1_date', definition: 'TEXT' },
  { table: 'deals', column: 'funds_received_m2', definition: 'REAL' },
  { table: 'deals', column: 'funds_received_m2_date', definition: 'TEXT' }
];

async function columnExists(table, column) {
  const cols = await all(`PRAGMA table_info(${table})`);
  return cols.some((c) => c.name === column);
}

async function runMigrations() {
  for (const m of COLUMN_MIGRATIONS) {
    if (!(await columnExists(m.table, m.column))) {
      await run(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.definition}`);
      console.log(`Migration: added column ${m.table}.${m.column}`);
    }
  }

  // One-time promotion: the very first admin account (originally seeded with role
  // 'admin') becomes the sole 'super_admin'. Only runs if no super_admin exists yet,
  // so it's safe to leave in place permanently.
  const superAdmin = await get(`SELECT id FROM users WHERE role = 'super_admin'`);
  if (!superAdmin) {
    const originalAdmin = await get(`SELECT id, email FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1`);
    if (originalAdmin) {
      await run(`UPDATE users SET role = 'super_admin' WHERE id = ?`, [originalAdmin.id]);
      console.log(`Migration: promoted ${originalAdmin.email} to super_admin`);
    }
  }
}

module.exports = { runMigrations, columnExists };
