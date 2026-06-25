const { run, get, all } = require('../db/client');
const dealService = require('./dealService');
const { calculateAustinPay } = require('./commissionEngine');
const auditLog = require('./auditLog');

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

// Maps the 4 payroll-staff pay sections to actual payroll_staff.id, the same way
// dashboardService tells Etai apart from Noy (both are staff_type='owner') — by name.
async function resolveStaffIds() {
  const staff = await all(`SELECT id, full_name, staff_type FROM payroll_staff`);
  const owners = staff.filter((s) => s.staff_type === 'owner');
  const etai = owners.find((s) => /etai/i.test(s.full_name));
  const noy = owners.find((s) => /noy/i.test(s.full_name));
  const joey = staff.find((s) => s.staff_type === 'pm');
  const austin = staff.find((s) => s.staff_type === 'ops');
  return {
    etai: etai ? etai.id : null, noy: noy ? noy.id : null,
    joey: joey ? joey.id : null, austin: austin ? austin.id : null
  };
}

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
  // Austin isn't paid per milestone like the owners/Joey — he's linked by Solar Date
  // (install_completed_date) and System Size, summed for the run and run through the same
  // MAX(base, kW x rate) formula that used to apply to a whole calendar month at once.
  const austinCandidates = await all(`
    SELECT id, customer_name, customer_address, system_size_kw, install_completed_date as solar_date, austin_paid
    FROM deals
    WHERE install_completed_date IS NOT NULL AND system_size_kw IS NOT NULL AND austin_paid = 0
    ORDER BY install_completed_date DESC
  `);
  const weeklyRepCandidates = await all(`SELECT id, full_name, display_name, weekly_amount FROM reps WHERE pay_type = 'weekly' AND active = 1`);
  return { repCandidates, etaiCandidates, noyCandidates, joeyCandidates, austinCandidates, weeklyRepCandidates };
}

// What's actually IN this run, joined straight from pay_run_deals -> deals. Deliberately
// independent of getCandidates()'s "still unpaid" filtering — that filtering is correct for
// the "+ Add" pickers (don't offer a deal that's already been paid elsewhere), but once a
// deal is included here, this run's own rows must keep showing it regardless of its current
// paid flags. Without this, finalizing a run (which flips those flags) would make the run
// appear empty the very next time it's opened, since the deal would no longer match the
// candidate queries' WHERE clauses.
async function getIncludedDeals(payRunId) {
  return all(`
    SELECT prd.*, d.customer_name, d.customer_address,
           d.closer_rep_id, d.setter_rep_id, d.closer_pay_net, d.setter_pay,
           d.closer_paid, d.closer_paid_date, d.setter_paid, d.setter_paid_date,
           cr.full_name as closer_name, cr.display_name as closer_display,
           sr.full_name as setter_name, sr.display_name as setter_display,
           d.owner_etai_m1_amount, d.owner_etai_m2_amount, d.owner_etai_m1_paid, d.owner_etai_m1_paid_date, d.owner_etai_m2_paid, d.owner_etai_m2_paid_date,
           d.owner_noy_m1_amount, d.owner_noy_m2_amount, d.owner_noy_m1_paid, d.owner_noy_m1_paid_date, d.owner_noy_m2_paid, d.owner_noy_m2_paid_date,
           d.joey_m2_bonus, d.joey_paid, d.joey_paid_date, d.net_ppw,
           d.system_size_kw, d.install_completed_date as solar_date, d.austin_paid, d.austin_paid_date
    FROM pay_run_deals prd
    JOIN deals d ON d.id = prd.deal_id
    LEFT JOIN reps cr ON cr.id = d.closer_rep_id
    LEFT JOIN reps sr ON sr.id = d.setter_rep_id
    WHERE prd.pay_run_id = ?
  `, [payRunId]);
}

// True if this milestone has already been paid out through a DIFFERENT pay run (a different
// paid_date) — should be zeroed out here so it isn't double-counted. False if it's unpaid, or
// if it was paid by finalizing *this* run (paid_date matches this run's own pay period), in
// which case the historical amount must keep showing.
function paidElsewhere(paidFlag, paidDate, thisRunPayDate) {
  return !!paidFlag && paidDate !== thisRunPayDate;
}

async function getPayRun(id) {
  const payRun = await get(`SELECT * FROM pay_runs WHERE id = ?`, [id]);
  if (!payRun) return null;

  const includedDeals = await getIncludedDeals(id);
  const includedMap = {};
  includedDeals.forEach((r) => { includedMap[r.deal_id] = r; });

  const { repCandidates, etaiCandidates, noyCandidates, joeyCandidates, austinCandidates, weeklyRepCandidates } = await getCandidates();
  const settings = await get(`SELECT * FROM commission_settings WHERE id = 1`);
  const allAdhoc = await all(`SELECT * FROM pay_run_adhoc WHERE pay_run_id = ? ORDER BY sort_order, id`, [id]);
  const staffIds = await resolveStaffIds();
  // Ad-hoc rows tagged with a staff_id are manual amounts for that specific payroll-staff
  // section (e.g. a one-off bonus for Joey that isn't tied to a deal) — everything else
  // (rep_id set or untagged) belongs to Section 1.
  const adhoc = allAdhoc.filter((a) => !a.staff_id);
  const manualByStaff = (staffId) => allAdhoc.filter((a) => a.staff_id === staffId);
  const approvals = await all(`SELECT * FROM pay_run_approvals WHERE pay_run_id = ? ORDER BY created_at DESC`, [id]);

  // Section 1 — Rep Commissions. Closer and setter are independently included — a deal's
  // setter might be due this cycle while its closer was already paid in an earlier one (or
  // vice versa), so one shared flag would wrongly pull in whichever role wasn't intended.
  const payDate = payRun.pay_period_date;
  const repRows = [];
  for (const d of includedDeals) {
    if (d.include_closer && d.closer_rep_id) {
      repRows.push({
        dealId: d.deal_id, repName: d.closer_display || d.closer_name, customerName: d.customer_name,
        customerAddress: d.customer_address, role: 'Closer',
        netPayable: paidElsewhere(d.closer_paid, d.closer_paid_date, payDate) ? 0 : (d.closer_pay_net || 0)
      });
    }
    if (d.include_setter && d.setter_rep_id) {
      repRows.push({
        dealId: d.deal_id, repName: d.setter_display || d.setter_name, customerName: d.customer_name,
        customerAddress: d.customer_address, role: 'Setter',
        netPayable: paidElsewhere(d.setter_paid, d.setter_paid_date, payDate) ? 0 : (d.setter_pay || 0)
      });
    }
  }
  // Ad-hoc items only ever belong to Section 1 today (there's no ad-hoc entry point for the
  // other sections), so every row in `adhoc` counts here — `notes` is just a free-text note,
  // never a category flag.
  const adhocRep = adhoc;
  const repTotal = round2(repRows.reduce((s, r) => s + r.netPayable, 0) + adhocRep.reduce((s, a) => s + a.amount, 0));

  // Sections 2 & 3 — Etai / Noy distribution.
  function ownerRows(prefix) {
    const flag = prefix === 'etai' ? 'include_etai' : 'include_noy';
    return includedDeals
      .filter((d) => d[flag])
      .map((d) => ({
        dealId: d.deal_id, customerName: d.customer_name, customerAddress: d.customer_address,
        m1: paidElsewhere(d[`owner_${prefix}_m1_paid`], d[`owner_${prefix}_m1_paid_date`], payDate) ? 0 : (d[`owner_${prefix}_m1_amount`] || 0),
        m2: paidElsewhere(d[`owner_${prefix}_m2_paid`], d[`owner_${prefix}_m2_paid_date`], payDate) ? 0 : (d[`owner_${prefix}_m2_amount`] || 0)
      }));
  }
  const etaiManual = manualByStaff(staffIds.etai);
  const noyManual = manualByStaff(staffIds.noy);
  const etaiRows = ownerRows('etai');
  const noyRows = ownerRows('noy');
  const etaiTotal = round2(etaiRows.reduce((s, r) => s + r.m1 + r.m2, 0) + etaiManual.reduce((s, a) => s + a.amount, 0));
  const noyTotal = round2(noyRows.reduce((s, r) => s + r.m1 + r.m2, 0) + noyManual.reduce((s, a) => s + a.amount, 0));

  // Section 4 — Joey: per-deal M2 bonus + fixed weekly salary + any manual one-off amounts.
  const joeyManual = manualByStaff(staffIds.joey);
  const joeyRows = includedDeals
    .filter((d) => d.include_joey)
    .map((d) => ({
      dealId: d.deal_id, customerName: d.customer_name, customerAddress: d.customer_address,
      bonus: paidElsewhere(d.joey_paid, d.joey_paid_date, payDate) ? 0 : (d.joey_m2_bonus || 0), netPpw: d.net_ppw
    }));
  const joeyBonusTotal = round2(joeyRows.reduce((s, r) => s + r.bonus, 0));
  const joeyWeeklySalary = settings.joey_weekly_salary || 0;
  const joeyManualTotal = round2(joeyManual.reduce((s, a) => s + a.amount, 0));
  const joeyTotal = round2(joeyBonusTotal + joeyWeeklySalary + joeyManualTotal);

  // Section 5 — Austin. Linked deals by Solar Date, kW editable per line (defaults to the
  // deal's System Size). Per-line kW x rate is shown for transparency, but the total still
  // goes through the same MAX(base, total kW x rate) rule as before — only the source of
  // "which deals count" changed, from an automatic calendar-month scan to Joy's curation here.
  // Manual amounts (e.g. a one-off bonus unrelated to any job) are added on top of that rule,
  // not folded into the kW total.
  const austinManual = manualByStaff(staffIds.austin);
  const austinRows = includedDeals
    .filter((d) => d.include_austin)
    .map((d) => {
      const rawKw = d.austin_kw_override !== null && d.austin_kw_override !== undefined ? d.austin_kw_override : d.system_size_kw;
      const kw = paidElsewhere(d.austin_paid, d.austin_paid_date, payDate) ? 0 : (rawKw || 0);
      return {
        dealId: d.deal_id, customerName: d.customer_name, customerAddress: d.customer_address,
        solarDate: d.solar_date, kw, lineAmount: round2(kw * settings.austin_rate_per_kw)
      };
    });
  const austinTotalKw = round2(austinRows.reduce((s, r) => s + r.kw, 0));
  // The $6,000 base is a floor for a cycle Joy is actually building out for Austin — it must
  // NOT silently apply to every weekly run by default just because the section exists. Only
  // kicks in once she's linked at least one job or added a manual amount this run.
  const austinHasActivity = austinRows.length > 0 || austinManual.length > 0;
  const austinCalc = austinHasActivity ? calculateAustinPay({ monthlyInstalledKw: austinTotalKw, settings }) : { base: settings.austin_base, topUp: 0, total: 0 };
  const austinManualTotal = round2(austinManual.reduce((s, a) => s + a.amount, 0));
  const austinTotal = round2(austinCalc.total + austinManualTotal);

  const grandTotal = round2(repTotal + etaiTotal + noyTotal + joeyTotal + austinTotal);

  // Summary — totals by recipient (rep name + adhoc recipients). Etai/Noy/Joey/Austin aren't
  // included here — they already have their own dedicated section totals above, same as the
  // real spreadsheet's Summary tab which only lists rep payouts by name.
  const byRecipient = {};
  for (const r of repRows) { byRecipient[r.repName] = (byRecipient[r.repName] || 0) + r.netPayable; }
  for (const a of adhocRep) { byRecipient[a.recipient_name] = (byRecipient[a.recipient_name] || 0) + a.amount; }
  const summaryByRecipient = Object.entries(byRecipient).map(([name, total]) => ({ name, total: round2(total) })).sort((a, b) => b.total - a.total);

  return {
    payRun, adhoc, approvals, staffIds,
    candidates: { repCandidates, etaiCandidates, noyCandidates, joeyCandidates, austinCandidates, weeklyRepCandidates },
    included: includedMap,
    sections: {
      rep: { rows: repRows, adhoc: adhocRep, total: repTotal },
      etai: { rows: etaiRows, manual: etaiManual, total: etaiTotal },
      noy: { rows: noyRows, manual: noyManual, total: noyTotal },
      joey: { rows: joeyRows, manual: joeyManual, weeklySalary: joeyWeeklySalary, bonusTotal: joeyBonusTotal, total: joeyTotal },
      austin: { rows: austinRows, manual: austinManual, totalKw: austinTotalKw, base: austinCalc.base, topUp: austinCalc.topUp, ratePerKw: settings.austin_rate_per_kw, total: austinTotal }
    },
    summaryByRecipient,
    grandTotal
  };
}

async function setDealInclusion(payRunId, dealId, flags, userId) {
  const existing = await get(`SELECT * FROM pay_run_deals WHERE pay_run_id = ? AND deal_id = ?`, [payRunId, dealId]);
  const FIELDS = ['include_closer', 'include_setter', 'include_etai', 'include_noy', 'include_joey', 'include_austin'];
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

// kW is a value to override, not a flag — kept separate from setDealInclusion's boolean
// toggles. Passing null clears the override and falls back to the deal's own System Size.
async function setAustinKwOverride(payRunId, dealId, kw, userId) {
  const existing = await get(`SELECT * FROM pay_run_deals WHERE pay_run_id = ? AND deal_id = ?`, [payRunId, dealId]);
  if (existing) {
    await run(`UPDATE pay_run_deals SET austin_kw_override = ? WHERE id = ?`, [kw, existing.id]);
  } else {
    await run(`INSERT INTO pay_run_deals (pay_run_id, deal_id, austin_kw_override) VALUES (?, ?, ?)`, [payRunId, dealId, kw]);
  }
  await auditLog.logChange('pay_run_deals', dealId, 'austin_kw_override', existing ? existing.austin_kw_override : null, kw, userId);
  return getPayRun(payRunId);
}

async function addAdhocItem(payRunId, { recipient_name, amount, notes, rep_id, staff_id }, userId) {
  if (!recipient_name || amount === undefined) throw new Error('recipient_name and amount are required');
  const maxOrder = await get(`SELECT MAX(sort_order) as m FROM pay_run_adhoc WHERE pay_run_id = ?`, [payRunId]);
  const result = await run(
    `INSERT INTO pay_run_adhoc (pay_run_id, recipient_name, amount, notes, rep_id, staff_id, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [payRunId, recipient_name, amount, notes || null, rep_id || null, staff_id || null, (maxOrder.m ?? -1) + 1]
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
  for (const row of data.sections.austin.rows) {
    await dealService.setPaymentFlag(row.dealId, 'austin', true, payDate, userId);
  }
  await run(`UPDATE pay_runs SET status = 'paid' WHERE id = ?`, [payRunId]);
  await auditLog.logChange('pay_runs', payRunId, 'status', data.payRun.status, 'paid', userId, 'Finalized — all included items marked paid');
  return getPayRun(payRunId);
}

module.exports = {
  listPayRuns, createPayRun, updatePayRun, deletePayRun, getPayRun,
  setDealInclusion, setAustinKwOverride, addAdhocItem, deleteAdhocItem, addApprovalEntry, finalizePayRun
};
