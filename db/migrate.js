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
  { table: 'deals', column: 'funds_received_m2_date', definition: 'TEXT' },
  { table: 'deals', column: 'owner_etai_m1_paid', definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: 'deals', column: 'owner_etai_m1_paid_date', definition: 'TEXT' },
  { table: 'deals', column: 'owner_etai_m2_paid', definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: 'deals', column: 'owner_etai_m2_paid_date', definition: 'TEXT' },
  { table: 'deals', column: 'owner_noy_m1_paid', definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: 'deals', column: 'owner_noy_m1_paid_date', definition: 'TEXT' },
  { table: 'deals', column: 'owner_noy_m2_paid', definition: "INTEGER NOT NULL DEFAULT 0" },
  { table: 'deals', column: 'owner_noy_m2_paid_date', definition: 'TEXT' },
  { table: 'deals', column: 'owner_etai_m1_amount', definition: 'REAL' },
  { table: 'deals', column: 'owner_etai_m2_amount', definition: 'REAL' },
  { table: 'deals', column: 'owner_noy_m1_amount', definition: 'REAL' },
  { table: 'deals', column: 'owner_noy_m2_amount', definition: 'REAL' },
  { table: 'deals', column: 'overridden_fields', definition: "TEXT NOT NULL DEFAULT '[]'" },
  { table: 'deals', column: 'austin_paid', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'deals', column: 'austin_paid_date', definition: 'TEXT' },
  { table: 'reps', column: 'first_name', definition: 'TEXT' },
  { table: 'reps', column: 'last_name', definition: 'TEXT' },
  { table: 'reps', column: 'account_info', definition: 'TEXT' },
  { table: 'reps', column: 'pay_type', definition: "TEXT NOT NULL DEFAULT 'commission'" },
  { table: 'reps', column: 'weekly_amount', definition: 'REAL' },
  { table: 'payroll_staff', column: 'first_name', definition: 'TEXT' },
  { table: 'payroll_staff', column: 'last_name', definition: 'TEXT' },
  { table: 'payroll_staff', column: 'phone', definition: 'TEXT' },
  { table: 'payroll_staff', column: 'account_info', definition: 'TEXT' },
  { table: 'pay_run_deals', column: 'include_austin', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'pay_run_deals', column: 'austin_kw_override', definition: 'REAL' },
  { table: 'pay_run_adhoc', column: 'rep_id', definition: 'INTEGER REFERENCES reps(id)' },
  { table: 'pay_run_adhoc', column: 'staff_id', definition: 'INTEGER REFERENCES payroll_staff(id)' },
  { table: 'deals', column: 'funds_pending_m1', definition: 'REAL' },
  { table: 'deals', column: 'funds_pending_m2', definition: 'REAL' },
  { table: 'deals', column: 'funding_status', definition: 'TEXT' },
  { table: 'deals', column: 'funding_status_override', definition: 'TEXT' },
  { table: 'deals', column: 'field_override_reasons', definition: "TEXT NOT NULL DEFAULT '{}'" }
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

  // One-time data carry-over: older deals tracked a single combined "owner_m1_paid" flag
  // for Etai+Noy together. Now that each has their own paid flag, copy the old combined
  // value into both — best-effort preservation, not a guess, since historically they were
  // always paid together on the same date. Only touches rows where the new fields are still
  // at their default (0), so re-running this is harmless and it never overwrites a real edit.
  if (await columnExists('deals', 'owner_m1_paid')) {
    await run(`
      UPDATE deals SET owner_etai_m1_paid = owner_m1_paid, owner_etai_m1_paid_date = owner_m1_paid_date
      WHERE owner_m1_paid = 1 AND owner_etai_m1_paid = 0
    `);
    await run(`
      UPDATE deals SET owner_noy_m1_paid = owner_m1_paid, owner_noy_m1_paid_date = owner_m1_paid_date
      WHERE owner_m1_paid = 1 AND owner_noy_m1_paid = 0
    `);
    await run(`
      UPDATE deals SET owner_etai_m2_paid = owner_m2_paid, owner_etai_m2_paid_date = owner_m2_paid_date
      WHERE owner_m2_paid = 1 AND owner_etai_m2_paid = 0
    `);
    await run(`
      UPDATE deals SET owner_noy_m2_paid = owner_m2_paid, owner_noy_m2_paid_date = owner_m2_paid_date
      WHERE owner_m2_paid = 1 AND owner_noy_m2_paid = 0
    `);
    console.log('Migration: carried over combined owner M1/M2 paid flags into separate Etai/Noy fields');
  }

  // Same idea for the combined owner_etai_total/owner_noy_total — split into separate M1/M2
  // amounts so each can be overridden independently. Derived the correct way: from whether
  // M1/M2 was actually approved on that deal, times the real settings amount for each — NOT
  // a 50/50 guess off the combined total, which would be wrong for deals only at M1 so far.
  const settingsRow = await get(`SELECT owner_etai_m1, owner_etai_m2, owner_noy_m1, owner_noy_m2 FROM commission_settings WHERE id = 1`);
  if (settingsRow) {
    const needsSplit = await all(`
      SELECT id, m1_approved_date, m2_approved_date FROM deals
      WHERE owner_etai_total IS NOT NULL AND owner_etai_m1_amount IS NULL
    `);
    for (const d of needsSplit) {
      const etaiM1 = d.m1_approved_date ? settingsRow.owner_etai_m1 : 0;
      const etaiM2 = d.m2_approved_date ? settingsRow.owner_etai_m2 : 0;
      const noyM1 = d.m1_approved_date ? settingsRow.owner_noy_m1 : 0;
      const noyM2 = d.m2_approved_date ? settingsRow.owner_noy_m2 : 0;
      await run(
        `UPDATE deals SET owner_etai_m1_amount = ?, owner_etai_m2_amount = ?, owner_noy_m1_amount = ?, owner_noy_m2_amount = ? WHERE id = ?`,
        [etaiM1, etaiM2, noyM1, noyM2, d.id]
      );
    }
    if (needsSplit.length) console.log(`Migration: derived owner M1/M2 amount split for ${needsSplit.length} deal(s)`);
  }

  // Overrides used to freeze every computed field on a deal at once. Now a deal can have
  // specific fields locked while everything else keeps auto-calculating. Any deal that was
  // already overridden under the old all-or-nothing system gets every computed field locked
  // here, preserving exactly the protection it already had — nothing it was relying on
  // becomes newly recalculable by surprise.
  const ALL_COMPUTED_FIELDS = [
    'net_ppw', 'pay_scale_rate', 'rep_pool', 'closer_pay_gross', 'closer_pay_net', 'setter_pay',
    'owner_etai_total', 'owner_etai_m1_amount', 'owner_etai_m2_amount',
    'owner_noy_total', 'owner_noy_m1_amount', 'owner_noy_m2_amount',
    'joey_m2_bonus', 'below_floor', 'gross_amount', 'expected_m1_amount', 'expected_m2_amount'
  ];
  const legacyOverrides = await all(`SELECT id FROM deals WHERE manual_override = 1 AND overridden_fields = '[]'`);
  for (const d of legacyOverrides) {
    await run(`UPDATE deals SET overridden_fields = ? WHERE id = ?`, [JSON.stringify(ALL_COMPUTED_FIELDS), d.id]);
  }
  if (legacyOverrides.length) console.log(`Migration: locked all computed fields for ${legacyOverrides.length} pre-existing overridden deal(s)`);

  // Best-effort one-time split of the existing single full_name into first/last for the new
  // editable profile fields — full_name itself is untouched and stays the source of truth for
  // display everywhere; first/last are just a starting point Joy can correct in the UI.
  for (const table of ['reps', 'payroll_staff']) {
    const rows = await all(`SELECT id, full_name FROM ${table} WHERE first_name IS NULL`);
    for (const r of rows) {
      const parts = (r.full_name || '').trim().split(/\s+/);
      const first = parts[0] || null;
      const last = parts.length > 1 ? parts.slice(1).join(' ') : null;
      await run(`UPDATE ${table} SET first_name = ?, last_name = ? WHERE id = ?`, [first, last, r.id]);
    }
    if (rows.length) console.log(`Migration: split full_name into first/last for ${rows.length} row(s) in ${table}`);
  }
}

module.exports = { runMigrations, columnExists };
