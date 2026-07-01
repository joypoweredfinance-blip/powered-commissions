const { run, get, all } = require('../db/client');
const {
  calculateRepCommission, calculateSetterPreliminaryPay, calculateOwnerDistribution, calculateJoeyBonus,
  computeEpcCost, computeGross, computeExpectedFunding, sumAllAdders, round2
} = require('./commissionEngine');
const auditLog = require('./auditLog');

// Like adders, these are commission-relevant plain inputs — saving any of them should
// auto-recalculate the Setter Calculator's outputs (see updateDeal() below), the same way
// addAdder()/updateAdder() already auto-recalculate the Closer side.
const SETTER_CALC_INPUT_FIELDS = [
  'setter_calc_contract_value', 'setter_calc_mpu_amount', 'setter_calc_roof_amount',
  'setter_calc_battery_amount', 'setter_calc_misc_amount', 'setter_calc_system_size_kw',
  'setter_calc_rate_per_kwh', 'setter_calc_monthly_payment'
];

// Fields whose value directly feeds the commission formula, not just descriptive data —
// saving any of these should auto-recalculate immediately rather than leave stale numbers
// on screen until the next explicit Recalculate.
const RECALC_TRIGGER_FIELDS = [...SETTER_CALC_INPUT_FIELDS, 'pay_scale_id'];

const EDITABLE_FIELDS = [
  'customer_name', 'customer_address', 'status_id', 'closer_rep_id', 'setter_rep_id', 'roof_date',
  // Joy's own direct pick, not derived from the closer rep — see getPayScaleById().
  'pay_scale_id',
  'pay_split', 'is_referral', 'installer_id', 'financier_id', 'module_type', 'battery_type', 'num_batteries',
  'system_size_kw', 'panel_count', 'panel_watts', 'annual_production_kwh', 'contract_value', 'epc_rate_per_watt',
  'monthly_payment', 'rate_per_kwh', 'escalator_pct', 'cashback_amount', 'date_signed', 'install_date',
  'install_completed_date', 'ntp_approved_date', 'm1_approved_date', 'm1_paid_date', 'pto_granted_date',
  'm2_approved_date', 'm2_paid_date', 'admin_notes', 'field_override_reasons',
  'funds_received_m1', 'funds_received_m1_date', 'funds_received_m2', 'funds_received_m2_date',
  // Funds Pending is Joy's own manual call, not derived from Expected minus Received — installer
  // funding quirks mean that subtraction doesn't always reflect what's actually still owed.
  'funds_pending_m1', 'funds_pending_m2',
  'funding_status', 'funding_status_override',
  // A reference number only — deliberately not in COMPUTED_FIELDS, never touched by
  // recalculate() or any override logic, so it can never affect another figure on the deal.
  'original_estimate_amount',
  // Same treatment as cashback_amount — a plain manual figure, not a locked override. Feeds
  // into the Commission Calculator's Total display only, computed client-side.
  'advance_deduction', 'deduction_other',
  // Joy's manually-entered, frozen-at-entry preliminary numbers for the Setter Calculator —
  // these are the ONLY inputs that ever feed setter_pay. Plain fields, not locked overrides,
  // same reasoning as cashback_amount: she's just entering data, not overriding a computed result.
  ...SETTER_CALC_INPUT_FIELDS
];

const COMPUTED_FIELDS = [
  'net_ppw', 'pay_scale_rate', 'rep_pool', 'closer_pay_gross', 'closer_pay_net', 'setter_pay',
  'owner_etai_total', 'owner_etai_m1_amount', 'owner_etai_m2_amount',
  'owner_noy_total', 'owner_noy_m1_amount', 'owner_noy_m2_amount',
  'joey_m1_bonus', 'joey_m2_bonus', 'below_floor',
  'gross_amount', 'expected_m1_amount', 'expected_m2_amount',
  // Outputs of the Setter Calculator's own preliminary computation — independent from the
  // shared net_ppw/pay_scale_rate/rep_pool above, which now only ever reflect the Closer/
  // Company's real numbers.
  'setter_calc_net_ppw', 'setter_calc_pay_scale_rate', 'setter_calc_rep_pool', 'setter_calc_below_floor'
];

async function getCommissionSettings() {
  return get(`SELECT * FROM commission_settings WHERE id = 1`);
}

// The deal's own direct choice of pay scale — independent of whichever scale the closer rep
// happens to be assigned, per Joy's request to control this explicitly per deal rather than
// have it silently follow the rep.
async function getPayScaleById(payScaleId) {
  if (!payScaleId) return getStandardScale();
  const [scale, tiers] = await Promise.all([
    get(`SELECT * FROM pay_scales WHERE id = ?`, [payScaleId]),
    all(`SELECT net_ppw_threshold, dollar_per_kw FROM pay_scale_tiers WHERE pay_scale_id = ? ORDER BY net_ppw_threshold ASC`, [payScaleId])
  ]);
  if (!scale) return getStandardScale();
  return { id: scale.id, name: scale.name, hard_floor_ppw: scale.hard_floor_ppw, tiers };
}

async function getStandardScale() {
  const scale = await get(`SELECT * FROM pay_scales WHERE name = 'Standard'`);
  const tiers = await all(`SELECT net_ppw_threshold, dollar_per_kw FROM pay_scale_tiers WHERE pay_scale_id = ? ORDER BY net_ppw_threshold ASC`, [scale.id]);
  return { id: scale.id, name: scale.name, hard_floor_ppw: scale.hard_floor_ppw, tiers };
}

async function listDeals({ statusId, statusIds, fundingStatuses, repId, installerId, search, phase, startDate, endDate } = {}) {
  // total_adders is a correlated subquery rather than a second round-trip per deal — the
  // board needs "Total Adders (Roof + Adders)" per row, and this keeps the whole list
  // a single query (libsql/Turso round-trip latency is the real cost here, not the SQL).
  let sql = `
    SELECT d.*, cr.full_name as closer_name, cr.display_name as closer_display,
           sr.full_name as setter_name, sr.display_name as setter_display,
           ds.label as status_label, ds.phase as status_phase, ds.sort_order as status_sort,
           inst.name as installer_name, fin.name as financier_name,
           (SELECT COALESCE(SUM(amount), 0) FROM deal_adders WHERE deal_id = d.id) as total_adders,
           COALESCE(d.epc_rate_per_watt, 0) * COALESCE(d.system_size_kw, 0) * 1000 as epc_cost
    FROM deals d
    LEFT JOIN reps cr ON cr.id = d.closer_rep_id
    LEFT JOIN reps sr ON sr.id = d.setter_rep_id
    LEFT JOIN deal_statuses ds ON ds.id = d.status_id
    LEFT JOIN installers inst ON inst.id = d.installer_id
    LEFT JOIN financiers fin ON fin.id = d.financier_id
    WHERE 1=1
  `;
  const args = [];
  // statusId (single) is kept for any older caller; statusIds (array) is what the board's
  // multi-select filter actually sends, same shape as the dashboard's CRM status filter.
  const statusIdList = (statusIds ? (Array.isArray(statusIds) ? statusIds : [statusIds]) : (statusId ? [statusId] : []))
    .map(Number).filter((n) => !isNaN(n));
  if (statusIdList.length) { sql += ` AND d.status_id IN (${statusIdList.map(() => '?').join(',')})`; args.push(...statusIdList); }
  const fundingStatusList = fundingStatuses === undefined || fundingStatuses === null ? [] : (Array.isArray(fundingStatuses) ? fundingStatuses : [fundingStatuses]);
  if (fundingStatusList.length) {
    sql += ` AND COALESCE(NULLIF(d.funding_status_override, ''), d.funding_status) IN (${fundingStatusList.map(() => '?').join(',')})`;
    args.push(...fundingStatusList);
  }
  if (repId) { sql += ` AND (d.closer_rep_id = ? OR d.setter_rep_id = ?)`; args.push(repId, repId); }
  if (installerId) { sql += ` AND d.installer_id = ?`; args.push(installerId); }
  if (phase) { sql += ` AND ds.phase = ?`; args.push(phase); }
  if (search) { sql += ` AND (d.customer_name LIKE ? OR d.customer_address LIKE ?)`; args.push(`%${search}%`, `%${search}%`); }
  // Anchored on Solar Date (install_completed_date) per Joy's request — same anchor the
  // dashboard's contract-value pie chart uses.
  if (startDate) { sql += ` AND d.install_completed_date >= ?`; args.push(startDate); }
  if (endDate) { sql += ` AND d.install_completed_date <= ?`; args.push(endDate); }
  sql += ` ORDER BY ds.sort_order ASC, d.updated_at DESC`;
  return all(sql, args);
}

async function getDeal(id) {
  // deal/adders/advances/clawbacks/auditLog/fileRows are all independent of each other's
  // results — only adderFileRows has a true dependency (needs the adder ids first) — so
  // firing the rest concurrently turns ~6 sequential network round-trips to Turso into
  // roughly the time of the single slowest one. This runs on every deal-page load and every
  // mutation (override, recalculate, approve, etc., which all call getDeal() to return the
  // fresh state), so it's worth keeping fast.
  const [deal, adders, advances, clawbacks, auditLogEntries, fileRows] = await Promise.all([
    get(`
      SELECT d.*, cr.full_name as closer_name, cr.display_name as closer_display, cr.pay_scale_id as closer_pay_scale_id,
             sr.full_name as setter_name, sr.display_name as setter_display,
             ds.label as status_label, ds.phase as status_phase,
             inst.name as installer_name, fin.name as financier_name
      FROM deals d
      LEFT JOIN reps cr ON cr.id = d.closer_rep_id
      LEFT JOIN reps sr ON sr.id = d.setter_rep_id
      LEFT JOIN deal_statuses ds ON ds.id = d.status_id
      LEFT JOIN installers inst ON inst.id = d.installer_id
      LEFT JOIN financiers fin ON fin.id = d.financier_id
      WHERE d.id = ?
    `, [id]),
    all(`SELECT * FROM deal_adders WHERE deal_id = ? ORDER BY sort_order ASC, id ASC`, [id]),
    all(`SELECT a.*, r.full_name as rep_name FROM advances a LEFT JOIN reps r ON r.id = a.rep_id WHERE a.deal_id = ?`, [id]),
    all(`SELECT c.*, r.full_name as rep_name FROM clawbacks c LEFT JOIN reps r ON r.id = c.rep_id WHERE c.deal_id = ?`, [id]),
    // Attached here (not just on the dedicated GET /:id route) so every mutation — override,
    // recalculate, payment, approve, adders — returns the full audit history too. Every one of
    // those calls getDeal() and hands its result straight back to the frontend, which replaces
    // its local DEAL object wholesale; if auditLog wasn't on it, the page's history list would
    // go blank on every single action even though the rows were never touched in the database.
    auditLog.getLogFor('deals', id, { limit: 50 }),
    // Metadata only — file_data (the actual bytes) is deliberately excluded here and only ever
    // fetched by the dedicated download route, so attaching a large file never slows down every
    // load of this deal (or, on listDeals, every deal on the whole Board). At most one row per
    // slot, so this is at most 2 rows total.
    all(`SELECT slot, id, file_name, file_type, file_size, uploaded_at FROM deal_estimate_files WHERE deal_id = ?`, [id])
  ]);
  if (!deal) return null;
  // Receipt/Proof metadata per adder — admin-only, batch-fetched (no N+1), file_data itself
  // excluded here for the same reason as the deal-level estimate files above.
  if (adders.length) {
    const adderFileRows = await all(
      `SELECT adder_id, id, file_name, file_type, file_size, uploaded_at FROM deal_adder_files WHERE adder_id IN (${adders.map(() => '?').join(',')})`,
      adders.map((a) => a.id)
    );
    const fileByAdderId = {};
    adderFileRows.forEach((row) => { fileByAdderId[row.adder_id] = row; });
    adders.forEach((a) => { a.receiptFile = fileByAdderId[a.id] || null; });
  }
  const files = { estimate: null, final: null };
  for (const row of fileRows) {
    if (row.slot === 'estimate' || row.slot === 'final') files[row.slot] = row;
  }
  return { ...deal, adders, advances, clawbacks, auditLog: auditLogEntries, estimateFiles: files };
}

async function createDeal(data, userId) {
  if (data.status_id === undefined || data.status_id === null) {
    const firstStatus = await get(`SELECT id FROM deal_statuses WHERE active = 1 ORDER BY sort_order ASC LIMIT 1`);
    if (firstStatus) data.status_id = firstStatus.id;
  }
  // Starting point only, not a dependency — defaults to whatever scale the closer is
  // currently assigned (or Standard), but from here on it's the deal's own field, editable
  // independently of the rep on the Commission Calculator.
  if (data.pay_scale_id === undefined || data.pay_scale_id === null) {
    const repScale = data.closer_rep_id ? await get(`SELECT pay_scale_id FROM reps WHERE id = ?`, [data.closer_rep_id]) : null;
    const standard = await get(`SELECT id FROM pay_scales WHERE name = 'Standard'`);
    data.pay_scale_id = (repScale && repScale.pay_scale_id) || (standard && standard.id) || null;
  }
  const fields = EDITABLE_FIELDS.filter((f) => data[f] !== undefined);
  const placeholders = fields.map(() => '?').join(', ');
  const values = fields.map((f) => data[f]);
  const res = await run(
    `INSERT INTO deals (${fields.join(', ')}, created_by) VALUES (${placeholders}, ?)`,
    [...values, userId]
  );
  const id = Number(res.lastInsertRowid);
  await auditLog.logChange('deals', id, '_created', null, data.customer_name, userId, 'Deal created');
  await recalculate(id, userId);
  return getDeal(id);
}

async function updateDeal(id, data, userId, reason = null) {
  const oldRow = await get(`SELECT * FROM deals WHERE id = ?`, [id]);
  if (!oldRow) throw new Error('Deal not found');
  const fields = EDITABLE_FIELDS.filter((f) => data[f] !== undefined);
  if (fields.length === 0) return getDeal(id);
  const setClause = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => data[f]);
  await run(`UPDATE deals SET ${setClause}, updated_at = datetime('now') WHERE id = ?`, [...values, id]);
  await auditLog.logDiff('deals', id, oldRow, data, userId, reason);
  // A plain general field save (customer info, dates, notes, etc.) deliberately does NOT
  // auto-recalculate — recalculation is a separate, explicit action (the Recalculate button,
  // adding/editing an adder, or creating the deal) so it never looks like a save produced a
  // second, surprise change to the commission numbers. setter_calc_* inputs are the one
  // exception: they're commission-relevant the same way adders are, so saving one of them
  // auto-recalculates the Setter Calculator's outputs immediately, with no extra click needed.
  if (fields.some((f) => RECALC_TRIGGER_FIELDS.includes(f))) {
    // Pass the already-read deal (with updates merged in) so recalculate() can skip its own
    // duplicate SELECT — saves one Turso round trip on every setter-calc or pay-scale save.
    const updatedDeal = { ...oldRow };
    fields.forEach((f, i) => { updatedDeal[f] = values[i]; });
    return recalculate(id, userId, { _deal: updatedDeal });
  }
  return getDeal(id);
}

function parseOverriddenFields(deal) {
  try { return JSON.parse(deal.overridden_fields || '[]'); } catch (e) { return []; }
}

function parseFieldOverrideReasons(deal) {
  try { return JSON.parse(deal.field_override_reasons || '{}'); } catch (e) { return {}; }
}

async function recalculate(id, userId, { force = false, _deal = null } = {}) {
  // _deal: pre-read deal row passed from updateDeal to avoid a duplicate SELECT. Only safe
  // when force=false (force clears override flags in the DB and needs a fresh read after).
  let deal = (!force && _deal) ? _deal : await get(`SELECT * FROM deals WHERE id = ?`, [id]);
  if (!deal) throw new Error('Deal not found');
  // force clears every lock and recomputes the whole deal fresh; otherwise any individually
  // locked field (e.g. just Joey's bonus) is skipped while everything else still recalculates.
  const lockedFields = force ? [] : parseOverriddenFields(deal);
  if (force) {
    await run(`UPDATE deals SET manual_override = 0, overridden_fields = '[]', field_override_reasons = '{}' WHERE id = ?`, [id]);
  }

  const [adders, payScale, settings, installer] = await Promise.all([
    all(`SELECT amount, counts_as_hard_cost FROM deal_adders WHERE deal_id = ?`, [id]),
    getPayScaleById(deal.pay_scale_id),
    getCommissionSettings(),
    deal.installer_id ? get(`SELECT m1_pct, m2_pct FROM installers WHERE id = ?`, [deal.installer_id]) : Promise.resolve(null)
  ]);

  const result = calculateRepCommission({
    deal: {
      contract_value: deal.contract_value || 0,
      system_size_kw: deal.system_size_kw || 0,
      pay_split: deal.pay_split || 0.5,
      cashback_amount: deal.cashback_amount || 0,
      setter_rep_id: deal.setter_rep_id,
      advance_deduction: deal.advance_deduction || 0,
      deduction_other: deal.deduction_other || 0
    },
    adders,
    payScale,
    settings
  });

  const owner = calculateOwnerDistribution({
    settings,
    m1Approved: !!deal.m1_approved_date,
    m2Approved: !!deal.m2_approved_date
  });
  const joeyBonus = calculateJoeyBonus({
    netPPW: result.netPPW,
    m1Approved: !!deal.m1_approved_date,
    m2Approved: !!deal.m2_approved_date,
    settings
  });

  const epcCost = computeEpcCost(deal.epc_rate_per_watt, deal.system_size_kw || 0);
  const allAddersTotal = sumAllAdders(adders);
  const gross = round2(computeGross(deal.contract_value || 0, epcCost, allAddersTotal));
  const { expectedM1, expectedM2 } = computeExpectedFunding(gross, installer);

  // setter_pay is deliberately NOT result.setterPay (which is derived from the real, still-
  // changing deal data) — it only ever comes from Joy's separate, manually-entered preliminary
  // numbers, since setters get paid before the deal is funded and before costs are final.
  const setterPrelim = calculateSetterPreliminaryPay({
    contractValue: deal.setter_calc_contract_value,
    mpuAmount: deal.setter_calc_mpu_amount,
    roofAmount: deal.setter_calc_roof_amount,
    batteryAmount: deal.setter_calc_battery_amount,
    miscAmount: deal.setter_calc_misc_amount,
    systemSizeKw: deal.setter_calc_system_size_kw,
    paySplit: deal.pay_split || 0.5,
    payScale,
    settings
  });

  const newValues = {
    net_ppw: result.netPPW,
    pay_scale_rate: result.payScaleRate,
    rep_pool: result.repPool,
    closer_pay_gross: result.closerPayGross,
    closer_pay_net: result.closerPayNet,
    setter_pay: deal.setter_rep_id ? setterPrelim.setterPay : 0,
    setter_calc_net_ppw: setterPrelim.netPPW,
    setter_calc_pay_scale_rate: setterPrelim.payScaleRate,
    setter_calc_rep_pool: setterPrelim.repPool,
    setter_calc_below_floor: setterPrelim.belowFloor ? 1 : 0,
    owner_etai_total: owner.etaiTotal,
    owner_etai_m1_amount: owner.etaiM1,
    owner_etai_m2_amount: owner.etaiM2,
    owner_noy_total: owner.noyTotal,
    owner_noy_m1_amount: owner.noyM1,
    owner_noy_m2_amount: owner.noyM2,
    joey_m1_bonus: joeyBonus.m1,
    joey_m2_bonus: joeyBonus.m2,
    below_floor: result.belowFloor ? 1 : 0,
    gross_amount: gross,
    expected_m1_amount: expectedM1,
    expected_m2_amount: expectedM2
  };

  // owner_etai_total/owner_noy_total always mirror their own M1+M2, so if either half is
  // locked, lock the total along with it rather than letting it drift out of sync.
  if (lockedFields.includes('owner_etai_m1_amount') || lockedFields.includes('owner_etai_m2_amount')) {
    lockedFields.push('owner_etai_total');
  }
  if (lockedFields.includes('owner_noy_m1_amount') || lockedFields.includes('owner_noy_m2_amount')) {
    lockedFields.push('owner_noy_total');
  }

  const fieldsToWrite = Object.keys(newValues).filter((f) => !lockedFields.includes(f));
  if (fieldsToWrite.length) {
    const setClause = fieldsToWrite.map((f) => `${f} = ?`).join(', ');
    const values = fieldsToWrite.map((f) => newValues[f]);
    await run(`UPDATE deals SET ${setClause}, updated_at = datetime('now') WHERE id = ?`, [...values, id]);
  }

  // A forced recalc on a deal that had locked fields is the one case that actually discards
  // someone's saved numbers — log exactly what got overwritten so it's recoverable from the
  // audit trail even if this happens again.
  if (force && deal.manual_override) {
    await auditLog.logDiff('deals', id, deal, newValues, userId, 'Recalculated over a manual override — previous values shown as "old"');
  }

  return getDeal(id);
}

async function addAdder(dealId, { label, category = 'misc', amount = 0, counts_as_hard_cost = true }, userId) {
  await run(
    `INSERT INTO deal_adders (deal_id, label, category, amount, counts_as_hard_cost) VALUES (?, ?, ?, ?, ?)`,
    [dealId, label, category, amount, counts_as_hard_cost ? 1 : 0]
  );
  await auditLog.logChange('deal_adders', dealId, 'adder_added', null, `${label}: $${amount}`, userId);
  return recalculate(dealId, userId);
}

async function updateAdder(adderId, data, userId) {
  const adder = await get(`SELECT * FROM deal_adders WHERE id = ?`, [adderId]);
  if (!adder) throw new Error('Adder not found');
  const fields = ['label', 'category', 'amount', 'counts_as_hard_cost'].filter((f) => data[f] !== undefined);
  const setClause = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => (f === 'counts_as_hard_cost' ? (data[f] ? 1 : 0) : data[f]));
  await run(`UPDATE deal_adders SET ${setClause} WHERE id = ?`, [...values, adderId]);
  await auditLog.logDiff('deal_adders', adderId, adder, data, userId);
  return recalculate(adder.deal_id, userId);
}

async function deleteAdder(adderId, userId) {
  const adder = await get(`SELECT * FROM deal_adders WHERE id = ?`, [adderId]);
  if (!adder) throw new Error('Adder not found');
  await run(`DELETE FROM deal_adder_files WHERE adder_id = ?`, [adderId]);
  await run(`DELETE FROM deal_adders WHERE id = ?`, [adderId]);
  await auditLog.logChange('deal_adders', adder.deal_id, 'adder_removed', `${adder.label}: $${adder.amount}`, null, userId);
  return recalculate(adder.deal_id, userId);
}

// Receipt/Proof — one file per adder, admin-only. Replaces whatever was there before, same
// pattern as the deal-level estimate files.
async function setAdderFile(adderId, { fileName, fileType, fileSize, fileData }, userId) {
  const adder = await get(`SELECT deal_id FROM deal_adders WHERE id = ?`, [adderId]);
  if (!adder) throw new Error('Adder not found');
  await run(`DELETE FROM deal_adder_files WHERE adder_id = ?`, [adderId]);
  await run(
    `INSERT INTO deal_adder_files (adder_id, file_name, file_type, file_size, file_data, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)`,
    [adderId, fileName, fileType || null, fileSize, fileData, userId]
  );
  await auditLog.logChange('deal_adders', adderId, 'receipt_file', null, fileName, userId, 'Receipt/Proof uploaded');
  return getDeal(adder.deal_id);
}

async function getAdderFileBlob(adderId) {
  return get(`SELECT file_name, file_type, file_data FROM deal_adder_files WHERE adder_id = ?`, [adderId]);
}

async function deleteAdderFile(adderId, userId) {
  const adder = await get(`SELECT deal_id FROM deal_adders WHERE id = ?`, [adderId]);
  if (!adder) throw new Error('Adder not found');
  await run(`DELETE FROM deal_adder_files WHERE adder_id = ?`, [adderId]);
  await auditLog.logChange('deal_adders', adderId, 'receipt_file', 'attached', null, userId, 'Receipt/Proof removed');
  return getDeal(adder.deal_id);
}

async function setApproval(dealId, role, approved, userId) {
  const field = role === 'closer' ? 'closer_breakdown_approved' : 'setter_breakdown_approved';
  const atField = role === 'closer' ? 'closer_approved_at' : 'setter_approved_at';
  const byField = role === 'closer' ? 'closer_approved_by' : 'setter_approved_by';
  await run(
    `UPDATE deals SET ${field} = ?, ${atField} = ?, ${byField} = ?, updated_at = datetime('now') WHERE id = ?`,
    [approved ? 1 : 0, approved ? new Date().toISOString() : null, approved ? userId : null, dealId]
  );
  await auditLog.logChange('deals', dealId, field, !approved, approved, userId,
    approved ? `Approved for ${role} view` : `Approval revoked for ${role} view`);
  return getDeal(dealId);
}

async function setPaymentFlag(dealId, recipient, paid, date, userId, na = false) {
  const map = {
    closer: ['closer_paid', 'closer_paid_date'],
    setter: ['setter_paid', 'setter_paid_date'],
    owner_etai_m1: ['owner_etai_m1_paid', 'owner_etai_m1_paid_date'],
    owner_etai_m2: ['owner_etai_m2_paid', 'owner_etai_m2_paid_date'],
    owner_noy_m1: ['owner_noy_m1_paid', 'owner_noy_m1_paid_date'],
    owner_noy_m2: ['owner_noy_m2_paid', 'owner_noy_m2_paid_date'],
    joey_m1: ['joey_m1_paid', 'joey_m1_paid_date'],
    joey: ['joey_paid', 'joey_paid_date'],
    austin: ['austin_paid', 'austin_paid_date']
  };
  const [flagField, dateField] = map[recipient];
  if (dateField) {
    await run(`UPDATE deals SET ${flagField} = ?, ${dateField} = ?, updated_at = datetime('now') WHERE id = ?`,
      [paid ? 1 : 0, paid ? (date || new Date().toISOString().slice(0, 10)) : null, dealId]);
  } else {
    await run(`UPDATE deals SET ${flagField} = ?, updated_at = datetime('now') WHERE id = ?`, [paid ? 1 : 0, dealId]);
  }
  // N/A flag stored separately so it survives independently of the paid boolean
  const current = await get(`SELECT payment_na_flags FROM deals WHERE id = ?`, [dealId]);
  const flags = (() => { try { return JSON.parse(current.payment_na_flags || '{}'); } catch (e) { return {}; } })();
  if (na) { flags[recipient] = true; } else { delete flags[recipient]; }
  await run(`UPDATE deals SET payment_na_flags = ? WHERE id = ?`, [JSON.stringify(flags), dealId]);
  await auditLog.logChange('deals', dealId, flagField, !paid, paid, userId, `Marked ${recipient} as ${na ? 'N/A' : paid ? 'paid' : 'unpaid'}`);
  return getDeal(dealId);
}

// Locks specific computed fields at admin-supplied values. Each call ADDS to whatever's
// already locked on the deal (e.g. overriding Joey's bonus today doesn't disturb a Net PPW
// override saved last week) — only "Turn Off & Recalculate" (recalculate with force) clears
// every lock at once.
async function setOverride(dealId, { override, reason, fields }, userId) {
  if (override === false) {
    // When fields is an array (not the locking object below), this is a SCOPED unlock — e.g.
    // turning off just the Setter Calculator's override without disturbing a Closer override
    // that's still active on the same deal. Full clear (legacy behavior) when no fields given.
    if (Array.isArray(fields) && fields.length) {
      const oldRow = await get(`SELECT * FROM deals WHERE id = ?`, [dealId]);
      const remaining = parseOverriddenFields(oldRow).filter((f) => !fields.includes(f));
      const reasonsMap = parseFieldOverrideReasons(oldRow);
      fields.forEach((f) => { delete reasonsMap[f]; });
      await run(
        `UPDATE deals SET manual_override = ?, overridden_fields = ?, field_override_reasons = ? WHERE id = ?`,
        [remaining.length ? 1 : 0, JSON.stringify(remaining), JSON.stringify(reasonsMap), dealId]
      );
      await auditLog.logChange('deals', dealId, 'manual_override', 'partial', `cleared: ${fields.join(', ')}`, userId, reason);
      return getDeal(dealId);
    }
    await run(`UPDATE deals SET manual_override = 0, overridden_fields = '[]', field_override_reasons = '{}', override_reason = ?, override_by = ?, override_at = datetime('now') WHERE id = ?`,
      [reason || null, userId, dealId]);
    await auditLog.logChange('deals', dealId, 'manual_override', true, false, userId, reason);
    return getDeal(dealId);
  }

  if (fields) {
    // Only fields actually present with a real value get touched — leaving a field blank
    // means "don't change this," not "set it to zero/null."
    const allowed = Object.keys(fields).filter((f) => COMPUTED_FIELDS.includes(f) && fields[f] !== null && fields[f] !== undefined && fields[f] !== '');
    if (allowed.length) {
      const oldRow = await get(`SELECT * FROM deals WHERE id = ?`, [dealId]);
      const finalFields = {};
      allowed.forEach((f) => { finalFields[f] = fields[f]; });

      // Etai/Noy totals are always derived from their own M1+M2 amounts, never edited
      // directly, so they can never drift out of sync with what's actually overridden.
      if ('owner_etai_m1_amount' in finalFields || 'owner_etai_m2_amount' in finalFields) {
        const m1 = finalFields.owner_etai_m1_amount ?? oldRow.owner_etai_m1_amount ?? 0;
        const m2 = finalFields.owner_etai_m2_amount ?? oldRow.owner_etai_m2_amount ?? 0;
        finalFields.owner_etai_total = m1 + m2;
      }
      if ('owner_noy_m1_amount' in finalFields || 'owner_noy_m2_amount' in finalFields) {
        const m1 = finalFields.owner_noy_m1_amount ?? oldRow.owner_noy_m1_amount ?? 0;
        const m2 = finalFields.owner_noy_m2_amount ?? oldRow.owner_noy_m2_amount ?? 0;
        finalFields.owner_noy_total = m1 + m2;
      }

      const finalKeys = Object.keys(finalFields);
      const setClause = finalKeys.map((f) => `${f} = ?`).join(', ');
      const values = finalKeys.map((f) => finalFields[f]);

      const lockedFields = Array.from(new Set([...parseOverriddenFields(oldRow), ...finalKeys]));
      // Reason is tracked per field, not as one shared deal-wide note — otherwise overriding
      // Joey's bonus in Payment Status would overwrite the reason shown for a Net PPW override
      // saved earlier from the Commission Calculator, and vice versa.
      const fieldReasons = parseFieldOverrideReasons(oldRow);
      finalKeys.forEach((f) => { fieldReasons[f] = reason || null; });
      await run(
        `UPDATE deals SET ${setClause}, manual_override = 1, overridden_fields = ?, field_override_reasons = ?, override_reason = ?, override_by = ?, override_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
        [...values, JSON.stringify(lockedFields), JSON.stringify(fieldReasons), reason || null, userId, dealId]
      );
      await auditLog.logDiff('deals', dealId, oldRow, finalFields, userId, reason || 'Manual override of computed values');
    }
  }
  return getDeal(dealId);
}

async function deleteDeal(id, userId) {
  await auditLog.logChange('deals', id, '_deleted', null, null, userId, 'Deal deleted');
  await run(`DELETE FROM deal_adder_files WHERE adder_id IN (SELECT id FROM deal_adders WHERE deal_id = ?)`, [id]);
  await run(`DELETE FROM deal_adders WHERE deal_id = ?`, [id]);
  await run(`DELETE FROM deal_estimate_files WHERE deal_id = ?`, [id]);
  await run(`DELETE FROM deals WHERE id = ?`, [id]);
}

const FILE_SLOTS = ['estimate', 'final'];

// Replaces whatever was in that SAME slot before — one file per slot per deal (Estimate and
// Final each hold their own single reference document, not a growing attachment list).
async function setEstimateFile(dealId, slot, { fileName, fileType, fileSize, fileData }, userId) {
  if (!FILE_SLOTS.includes(slot)) throw new Error('slot must be "estimate" or "final"');
  await run(`DELETE FROM deal_estimate_files WHERE deal_id = ? AND slot = ?`, [dealId, slot]);
  await run(
    `INSERT INTO deal_estimate_files (deal_id, slot, file_name, file_type, file_size, file_data, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [dealId, slot, fileName, fileType || null, fileSize, fileData, userId]
  );
  await auditLog.logChange('deals', dealId, `${slot}_file`, null, fileName, userId, `${slot === 'final' ? 'Final' : 'Estimate'} file uploaded`);
  return getDeal(dealId);
}

// The only place file_data is actually read — kept separate from getDeal() on purpose.
async function getEstimateFileBlob(dealId, slot) {
  if (!FILE_SLOTS.includes(slot)) throw new Error('slot must be "estimate" or "final"');
  return get(`SELECT file_name, file_type, file_data FROM deal_estimate_files WHERE deal_id = ? AND slot = ?`, [dealId, slot]);
}

async function deleteEstimateFile(dealId, slot, userId) {
  if (!FILE_SLOTS.includes(slot)) throw new Error('slot must be "estimate" or "final"');
  await run(`DELETE FROM deal_estimate_files WHERE deal_id = ? AND slot = ?`, [dealId, slot]);
  await auditLog.logChange('deals', dealId, `${slot}_file`, 'attached', null, userId, `${slot === 'final' ? 'Final' : 'Estimate'} file removed`);
  return getDeal(dealId);
}

module.exports = {
  listDeals, getDeal, createDeal, updateDeal, recalculate,
  addAdder, updateAdder, deleteAdder, setApproval, setPaymentFlag, setOverride, deleteDeal,
  getCommissionSettings, getPayScaleById,
  setEstimateFile, getEstimateFileBlob, deleteEstimateFile,
  setAdderFile, getAdderFileBlob, deleteAdderFile
};
