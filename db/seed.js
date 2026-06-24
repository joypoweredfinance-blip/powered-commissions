const bcrypt = require('bcryptjs');
const { run, get, all } = require('./client');
const { genPassword } = require('../services/passwordUtil');

const STANDARD_TIERS = [
  [3.00, 375], [3.25, 400], [3.40, 450], [3.55, 500], [3.70, 525],
  [3.85, 675], [4.00, 725], [4.15, 775], [4.30, 825], [4.45, 875],
  [4.60, 900], [4.75, 925], [4.90, 950], [5.05, 975], [5.20, 1000],
  [5.35, 1025], [5.50, 1050], [5.65, 1075], [5.80, 1100], [5.95, 1125],
  [6.10, 1150], [6.25, 1175], [6.50, 1200], [6.75, 1225], [7.00, 1250]
];

const V1_TIERS = [
  [3.25, 500], [3.40, 550], [3.55, 600], [3.70, 650], [3.85, 700],
  [4.00, 800], [4.15, 850], [4.30, 900], [4.45, 950], [4.60, 1000],
  [4.75, 1050], [4.90, 1100], [5.05, 1150], [5.20, 1200], [5.35, 1250],
  [5.50, 1300], [5.65, 1350], [5.80, 1400], [5.95, 1450], [6.10, 1500],
  [6.25, 1550]
];

const STATUSES = [
  ['Site Scheduled', 'pre_install'],
  ['Live Inspection', 'pre_install'],
  ['Post Inspection', 'pre_install'],
  ['Awaiting SOW', 'pre_install'],
  ['Results Received - Schedule Install', 'pre_install'],
  ['Pre-Install - Needs Attention', 'pre_install'],
  ['SOW Approved - Pending Permits/HOA', 'pre_install'],
  ['Roof Work Scheduled', 'pre_install'],
  ['Roof Work Started', 'pre_install'],
  ['Roof Work Completed', 'pre_install'],
  ['Solar Install Scheduled', 'pre_install'],
  ['Solar Install Started', 'pre_install'],
  ['Post Install - Needs Attention', 'pre_install'],
  ['Install Complete - Awaiting Funding', 'post_install'],
  ['M1 Approved', 'post_install'],
  ['M1 Paid / Final Passed', 'post_install'],
  ['PTO Approved', 'post_install'],
  ['M2 Approved', 'post_install'],
  ['Job Completed - Troubleshoot', 'post_install'],
  ['Completed', 'closed'],
  ['Cancelled', 'closed'],
  ['Removed', 'closed']
];

const REPS = [
  ['Roy Fattal', 'Roy F', 'closer', 'v1'],
  ['Etai Amir', 'Etai A', 'closer', 'standard'],
  ['Ron Kaminski', 'Ron K', 'closer', 'standard'],
  ['Noam Ohayon', 'Noam O', 'closer', 'standard'],
  ['Andrew', 'Andrew', 'setter', 'standard'],
  ['Dean', 'Dean', 'setter', 'standard'],
  ['Jackson Zicklin', 'Jackson Z', 'setter', 'standard'],
  ['Roni', 'Roni', 'setter', 'standard'],
  ['Edan Baram', 'Edan B', 'setter', 'standard']
];

const PAYROLL_STAFF = [
  ['Etai Ebaiov', 'owner'],
  ['Noy Ebaiov', 'owner'],
  ['Joey', 'pm'],
  ['Austin Snyder', 'ops']
];

const INSTALLERS = [
  ['SWS', 2.60, 1.00, 0.00, 'Settles fully at M1 — no M2 cycle.'],
  ['PSS', 2.40, 0.80, 0.20, 'Invoice via Daniela. Line-item approval required.'],
  ['SoCal', 2.60, 0.80, 0.20, 'Standard 80/20 reconciliation.']
];

const FINANCIERS = [
  ['LightReach', 670, 'Primary financier. Most volume.'],
  ['GoodLeap', 680, 'Secondary.'],
  ['Enfin', 620, 'Lower-FICO option.'],
  ['Propel', null, 'Seen on real June deals — confirm with Etai whether actively used.']
];

async function seedIfEmpty() {
  // --- pay scales + tiers ---
  let standard = await get(`SELECT id FROM pay_scales WHERE name = ?`, ['Standard']);
  if (!standard) {
    await run(`INSERT INTO pay_scales (name, rounding_rule, hard_floor_ppw) VALUES (?, 'round_down', 3.20)`, ['Standard']);
    standard = await get(`SELECT id FROM pay_scales WHERE name = ?`, ['Standard']);
    let i = 0;
    for (const [threshold, rate] of STANDARD_TIERS) {
      await run(`INSERT INTO pay_scale_tiers (pay_scale_id, net_ppw_threshold, dollar_per_kw, sort_order) VALUES (?, ?, ?, ?)`,
        [standard.id, threshold, rate, i++]);
    }
  }
  let v1 = await get(`SELECT id FROM pay_scales WHERE name = ?`, ['Pay Scale v1 (Roy)']);
  if (!v1) {
    await run(`INSERT INTO pay_scales (name, rounding_rule, hard_floor_ppw) VALUES (?, 'round_down', 3.20)`, ['Pay Scale v1 (Roy)']);
    v1 = await get(`SELECT id FROM pay_scales WHERE name = ?`, ['Pay Scale v1 (Roy)']);
    let i = 0;
    for (const [threshold, rate] of V1_TIERS) {
      await run(`INSERT INTO pay_scale_tiers (pay_scale_id, net_ppw_threshold, dollar_per_kw, sort_order) VALUES (?, ?, ?, ?)`,
        [v1.id, threshold, rate, i++]);
    }
  }

  // --- deal statuses ---
  const statusCount = await get(`SELECT COUNT(*) as c FROM deal_statuses`);
  if (statusCount.c === 0) {
    let i = 0;
    for (const [label, phase] of STATUSES) {
      await run(`INSERT INTO deal_statuses (label, phase, sort_order) VALUES (?, ?, ?)`, [label, phase, i++]);
    }
  }

  // --- installers / financiers ---
  const installerCount = await get(`SELECT COUNT(*) as c FROM installers`);
  if (installerCount.c === 0) {
    for (const [name, rate, m1, m2, notes] of INSTALLERS) {
      await run(`INSERT INTO installers (name, rate_per_watt, m1_pct, m2_pct, notes) VALUES (?, ?, ?, ?, ?)`,
        [name, rate, m1, m2, notes]);
    }
  }
  const financierCount = await get(`SELECT COUNT(*) as c FROM financiers`);
  if (financierCount.c === 0) {
    for (const [name, fico, notes] of FINANCIERS) {
      await run(`INSERT INTO financiers (name, min_fico, notes) VALUES (?, ?, ?)`, [name, fico, notes]);
    }
  }

  // --- reps ---
  const repCount = await get(`SELECT COUNT(*) as c FROM reps`);
  if (repCount.c === 0) {
    for (const [fullName, display, type, scaleKey] of REPS) {
      const scaleId = scaleKey === 'v1' ? v1.id : standard.id;
      await run(
        `INSERT INTO reps (full_name, display_name, rep_type, pay_scale_id) VALUES (?, ?, ?, ?)`,
        [fullName, display, type, scaleId]
      );
    }
  }

  // --- payroll staff ---
  const staffCount = await get(`SELECT COUNT(*) as c FROM payroll_staff`);
  if (staffCount.c === 0) {
    for (const [fullName, type] of PAYROLL_STAFF) {
      await run(`INSERT INTO payroll_staff (full_name, staff_type) VALUES (?, ?)`, [fullName, type]);
    }
  }

  // --- commission settings (singleton) ---
  const settings = await get(`SELECT id FROM commission_settings WHERE id = 1`);
  if (!settings) {
    await run(`INSERT INTO commission_settings (id) VALUES (1)`);
  }

  // --- admin user ---
  const adminEmail = process.env.ADMIN_EMAIL || 'joy.powered.finance@gmail.com';
  const existingAdmin = await get(`SELECT id FROM users WHERE email = ?`, [adminEmail]);
  if (!existingAdmin) {
    const tempPassword = genPassword();
    const hash = await bcrypt.hash(tempPassword, 10);
    await run(
      `INSERT INTO users (email, password_hash, role, must_change_password) VALUES (?, ?, 'admin', 1)`,
      [adminEmail, hash]
    );
    console.log('\n========================================================');
    console.log(' POWERED Commissions — first-run admin account created');
    console.log(` Email:    ${adminEmail}`);
    console.log(` Password: ${tempPassword}`);
    console.log(' You will be asked to set a new password on first login.');
    console.log('========================================================\n');
  }
}

module.exports = { seedIfEmpty };
