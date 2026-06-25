const { run, get, all } = require('../db/client');
const dealService = require('./dealService');
const auditLog = require('./auditLog');

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

async function listPayRuns() {
  return all(`SELECT * FROM pay_runs ORDER BY pay_period_date DESC, id DESC`);
}

async function createPayRun({ pay_period_date, notes }, userId) {
  if (!pay_period_date) throw new Error('pay_period_date is required');
  const result = await run(
    `INSERT INTO pay_runs (pay_period_date, notes, created_by) VALUES (?, ?, ?)`,
    [pay_period_date, notes || null, userId]
  );
  const id = Number(result.lastInsertRowid);
  await auditLog.logChange('pay_runs', id, '_created', null, pay_period_date, userId);
  return get(`SELECT * FROM pay_runs WHERE id = ?`, [id]);
}

async function updatePayRun(id, { pay_period_date, notes }, userId) {
  const fields = [];
  const values = [];
  if (pay_period_date !== undefined) { fields.push('pay_period_date = ?'); values.push(pay_period_date); }
  if (notes !== undefined) { fields.push('notes = ?'); values.push(notes); }
  if (fields.length) {
    await run(`UPDATE pay_runs SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
  }
  return get(`SELECT * FROM pay_runs WHERE id = ?`, [id]);
}

async function deletePayRun(id, userId) {
  await auditLog.logChange('pay_runs', id, '_deleted', null, null, userId);
  await run(`DELETE FROM pay_run_deals WHERE pay_run_id = ?`, [id]);
  await run(`DELETE FROM pay_run_adhoc WHERE pay_run_id = ?`, [id]);
  await run(`DELETE FROM pay_run_approvals WHERE pay_run_id = ?`, [id]);
  await run(`DELETE FROM pay_runs WHERE id = ?`, [id]);
}

// Candidate deals for each of the 4 sections — anything still unpaid for that specific
// recipient, regardless of whether it's already included in some other pay run (a deal can
// only be paid once per recipient, enforced when finalizing, not at selection time).
async function getCandidates() {
  const repCandidates = await all(`
    SELECT d.id, d.customer_name, d.customer_address,
           cr.full_name as closer_name, cr.display_name as closer_display,
           sr.full_name as setter_name, sr.display_name as setter_display,
           d.closer_rep_id, d.setter_rep_id, d.closer_pay_net, d.setter_pay,
           d.closer_breakdown_approved, d.setter_breakdown_approved, d.closer_paid, d.setter_paid
    FROM deals d
    LEFT JOIN reps cr ON cr.id = d.closer_rep_id
    LEFT JOIN reps sr ON sr.id = d.setter_rep_id
    WHERE (d.closer_rep_id IS NOT NULL AND d.closer_breakdown_approved = 1 AND d.closer_paid = 0)
       OR (d.setter_rep_id IS NOT NULL AND d.setter_breakdown_approved = 1 AND d.setter_paid = 0)
    ORDER BY d.id DESC
  `);
  const etaiCandidates = await all(`
    SELECT id, customer_name, customer_address, owner_etai_m1_amount, owner_etai_m1_paid,
           owner_etai_m2_amount, owner_etai_m2_paid
    FROM deals
    WHERE (owner_etai_m1_amount > 0 AND owner_etai_m1_paid = 0) OR (owner_etai_m2_amount > 0 AND owner_etai_m2_paid = 0)
    ORDER BY id DESC
  `);
  const noyCandidates = await all(`
    SELECT id, customer_name, customer_address, owner_noy_m1_amount, owner_noy_m1_paid,
           owner_noy_m2_amount, owner_noy_m2_paid
    FROM deals
    WHERE (owner_noy_m1_amount > 0 AND owner_noy_m1_paid = 0) OR (owner_noy_m2_amount > 0 AND owner_noy_m2_paid = 0)
    ORDER BY id DESC
  `);
  const joeyCandidates = await all(`
    SELECT id, customer_name, customer_address, joey_m2_bonus, joey_paid, net_ppw
    FROM deals WHERE joey_m2_bonus > 0 AND joey_paid = 0
    ORDER BY id DESC
  `);
  return { repCandidates, etaiCandidates, noyCandidates, joeyCandidates };
}

async function getPayRun(id) {
  const payRun = await get(`SELECT * FROM pay_runs WHERE id = ?`, [id]);
  if (!payRun) return null;

  const included = await all(`SELECT * FROM pay_run_deals WHERE pay_run_id = ?`, [id]);
  const includedMap = {};
  included.forEach((r) => { includedMap[r.deal_id] = r; });

  const { repCandidates, etaiCandidates, noyCandidates, joeyCandidates } = await getCandidates();
  const settings = await get(`SELECT * FROM commission_settings WHERE id = 1`);
  const adhoc = await all(`SELECT * FROM pay_run_adhoc WHERE pay_run_id = ? ORDER BY sort_order, id`, [id]);
  const approvals = await all(`SELECT * FROM pay_run_approvals WHERE pay_run_id = ? ORDER BY created_at DESC`, [id]);

  // Section 1 — Rep Commissions. Closer and setter are independently included — a deal's
  // setter might be due this cycle while its closer was already paid in an earlier one (or
  // vice versa), so one shared flag would wrongly pull in whichever role wasn't intended.
  const repRows = [];
  for (const d of repCandidates) {
    const inc = includedMap[d.id];
    if (!inc) continue;
    if (inc.include_closer && d.closer_rep_id && !d.closer_paid) {
      repRows.push({
        dealId: d.id, repName: d.closer_display || d.closer_name, customerName: d.customer_name,
        customerAddress: d.customer_address, role: 'Closer', netPayable: d.closer_pay_net || 0
      });
    }
    if (inc.include_setter && d.setter_rep_id && !d.setter_paid) {
      repRows.push({
        dealId: d.id, repName: d.setter_display || d.setter_name, customerName: d.customer_name,
        customerAddress: d.customer_address, role: 'Setter', netPayable: d.setter_pay || 0
      });
    }
  }
  // Ad-hoc items only ever belong to Section 1 today (there's no ad-hoc entry point for the
  // other sections), so every row in `adhoc` counts here — `notes` is just a free-text note,
  // never a category flag.
  const adhocRep = adhoc;
  const repTotal = round2(repRows.reduce((s, r) => s + r.netPayable, 0) + adhocRep.reduce((s, a) => s + a.amount, 0));

  // Sections 2 & 3 — Etai / Noy distribution.
  function ownerRows(candidates, prefix) {
    const rows = [];
    for (const d of candidates) {
      const inc = includedMap[d.id];
      const flag = prefix === 'etai' ? 'include_etai' : 'include_noy';
      if (!inc || !inc[flag]) continue;
      const m1amt = d[`owner_${prefix}_m1_amount`];
      const m2amt = d[`owner_${prefix}_m2_amount`];
      const m1paid = d[`owner_${prefix}_m1_paid`];
      const m2paid = d[`owner_${prefix}_m2_paid`];
      rows.push({
        dealId: d.id, customerName: d.customer_name, customerAddress: d.customer_address,
        m1: m1paid ? 0 : (m1amt || 0), m2: m2paid ? 0 : (m2amt || 0)
      });
    }
    return rows;
  }
  const etaiRows = ownerRows(etaiCandidates, 'etai');
  const noyRows = ownerRows(noyCandidates, 'noy');
  const etaiTotal = round2(etaiRows.reduce((s, r) => s + r.m1 + r.m2, 0));
  const noyTotal = round2(noyRows.reduce((s, r) => s + r.m1 + r.m2, 0));

  // Section 4 — Joey: per-deal M2 bonus + fixed weekly salary.
  const joeyRows = [];
  for (const d of joeyCandidates) {
    const inc = includedMap[d.id];
    if (!inc || !inc.include_joey) continue;
    joeyRows.push({ dealId: d.id, customerName: d.customer_name, customerAddress: d.customer_address, bonus: d.joey_m2_bonus || 0, netPpw: d.net_ppw });
  }
  const joeyBonusTotal = round2(joeyRows.reduce((s, r) => s + r.bonus, 0));
  const joeyWeeklySalary = settings.joey_weekly_salary || 0;
  const joeyTotal = round2(joeyBonusTotal + joeyWeeklySalary);

  const grandTotal = round2(repTotal + etaiTotal + noyTotal + joeyTotal);

  // Summary — totals by recipient (rep name + adhoc recipients).
  const byRecipient = {};
  for (const r of repRows) { byRecipient[r.repName] = (byRecipient[r.repName] || 0) + r.netPayable; }
  for (const a of adhocRep) { byRecipient[a.recipient_name] = (byRecipient[a.recipient_name] || 0) + a.amount; }
  const summaryByRecipient = Object.entries(byRecipient).map(([name, total]) => ({ name, total: round2(total) })).sort((a, b) => b.total - a.total);

  return {
    payRun, adhoc, approvals,
    candidates: { repCandidates, etaiCandidates, noyCandidates, joeyCandidates },
    included: includedMap,
    sections: {
      rep: { rows: repRows, adhoc: adhocRep, total: repTotal },
      etai: { rows: etaiRows, total: etaiTotal },
      noy: { rows: noyRows, total: noyTotal },
      joey: { rows: joeyRows, weeklySalary: joeyWeeklySalary, bonusTotal: joeyBonusTotal, total: joeyTotal }
    },
    summaryByRecipient,
    grandTotal
  };
}

async function setDealInclusion(payRunId, dealId, flags, userId) {
  const existing = await get(`SELECT * FROM pay_run_deals WHERE pay_run_id = ? AND deal_id = ?`, [payRunId, dealId]);
  const FIELDS = ['include_closer', 'include_setter', 'include_etai', 'include_noy', 'include_joey'];
  const merged = {};
  FIELDS.forEach((f) => {
    merged[f] = flags[f] !== undefined ? (flags[f] ? 1 : 0) : (existing ? existing[f] : 0);
  });
  if (existing) {
    await run(`UPDATE pay_run_deals SET ${FIELDS.map((f) => `${f}=?`).join(', ')} WHERE id = ?`,
      [...FIELDS.map((f) => merged[f]), existing.id]);
  } else {
    await run(`INSERT INTO pay_run_deals (pay_run_id, deal_id, ${FIELDS.join(', ')}) VALUES (?, ?, ${FIELDS.map(() => '?').join(', ')})`,
      [payRunId, dealId, ...FIELDS.map((f) => merged[f])]);
  }
  await auditLog.logChange('pay_run_deals', dealId, 'inclusion', existing ? JSON.stringify(existing) : null, JSON.stringify(merged), userId);
  return getPayRun(payRunId);
}

async function addAdhocItem(payRunId, { recipient_name, amount, notes }, userId) {
  if (!recipient_name || amount === undefined) throw new Error('recipient_name and amount are required');
  const maxOrder = await get(`SELECT MAX(sort_order) as m FROM pay_run_adhoc WHERE pay_run_id = ?`, [payRunId]);
  const result = await run(
    `INSERT INTO pay_run_adhoc (pay_run_id, recipient_name, amount, notes, sort_order) VALUES (?, ?, ?, ?, ?)`,
    [payRunId, recipient_name, amount, notes || null, (maxOrder.m ?? -1) + 1]
  );
  await auditLog.logChange('pay_run_adhoc', Number(result.lastInsertRowid), '_created', null, `${recipient_name}: $${amount}`, userId);
  return getPayRun(payRunId);
}

async function deleteAdhocItem(itemId, payRunId, userId) {
  await auditLog.logChange('pay_run_adhoc', itemId, '_deleted', null, null, userId);
  await run(`DELETE FROM pay_run_adhoc WHERE id = ?`, [itemId]);
  return getPayRun(payRunId);
}

async function addApprovalEntry(payRunId, { status, approved_by, notes }, userId) {
  if (!status) throw new Error('status is required');
  const payRun = await get(`SELECT * FROM pay_runs WHERE id = ?`, [payRunId]);
  await run(
    `INSERT INTO pay_run_approvals (pay_run_id, approval_date, status, approved_by, notes) VALUES (?, datetime('now'), ?, ?, ?)`,
    [payRunId, status, approved_by || null, notes || null]
  );
  await run(`UPDATE pay_runs SET status = ? WHERE id = ?`, [status, payRunId]);
  await auditLog.logChange('pay_runs', payRunId, 'status', payRun.status, status, userId, notes);
  return getPayRun(payRunId);
}

// Marks every included recipient on every selected deal as paid, using the pay run's pay
// period date — the action that actually closes the loop once Etai approves.
async function finalizePayRun(payRunId, userId) {
  const data = await getPayRun(payRunId);
  const payDate = data.payRun.pay_period_date;
  for (const row of data.sections.rep.rows) {
    const recipient = row.role === 'Closer' ? 'closer' : 'setter';
    await dealService.setPaymentFlag(row.dealId, recipient, true, payDate, userId);
  }
  for (const row of data.sections.etai.rows) {
    if (row.m1 > 0) await dealService.setPaymentFlag(row.dealId, 'owner_etai_m1', true, payDate, userId);
    if (row.m2 > 0) await dealService.setPaymentFlag(row.dealId, 'owner_etai_m2', true, payDate, userId);
  }
  for (const row of data.sections.noy.rows) {
    if (row.m1 > 0) await dealService.setPaymentFlag(row.dealId, 'owner_noy_m1', true, payDate, userId);
    if (row.m2 > 0) await dealService.setPaymentFlag(row.dealId, 'owner_noy_m2', true, payDate, userId);
  }
  for (const row of data.sections.joey.rows) {
    await dealService.setPaymentFlag(row.dealId, 'joey', true, payDate, userId);
  }
  await run(`UPDATE pay_runs SET status = 'paid' WHERE id = ?`, [payRunId]);
  await auditLog.logChange('pay_runs', payRunId, 'status', data.payRun.status, 'paid', userId, 'Finalized — all included items marked paid');
  return getPayRun(payRunId);
}

module.exports = {
  listPayRuns, createPayRun, updatePayRun, deletePayRun, getPayRun,
  setDealInclusion, addAdhocItem, deleteAdhocItem, addApprovalEntry, finalizePayRun
};
