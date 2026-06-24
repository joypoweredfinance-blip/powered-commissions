const { run, get, all } = require('../db/client');
const { calculateRepCommission, calculateOwnerDistribution, calculateJoeyM2Bonus } = require('./commissionEngine');
const auditLog = require('./auditLog');

const EDITABLE_FIELDS = [
  'customer_name', 'customer_address', 'customer_phone', 'status_id', 'closer_rep_id', 'setter_rep_id',
  'pay_split', 'is_referral', 'installer_id', 'financier_id', 'module_type', 'battery_type', 'num_batteries',
  'system_size_kw', 'panel_count', 'panel_watts', 'annual_production_kwh', 'contract_value', 'epc_rate_per_watt',
  'monthly_payment', 'rate_per_kwh', 'escalator_pct', 'cashback_amount', 'date_signed', 'install_date',
  'install_completed_date', 'ntp_approved_date', 'm1_approved_date', 'm1_paid_date', 'pto_granted_date',
  'm2_approved_date', 'm2_paid_date', 'admin_notes'
];

const COMPUTED_FIELDS = [
  'net_ppw', 'pay_scale_rate', 'rep_pool', 'closer_pay_gross', 'closer_pay_net', 'setter_pay',
  'owner_etai_total', 'owner_noy_total', 'joey_m2_bonus', 'below_floor'
];

async function getCommissionSettings() {
  return get(`SELECT * FROM commission_settings WHERE id = 1`);
}

async function getPayScaleForRep(repId) {
  if (!repId) return getStandardScale();
  const rep = await get(`SELECT pay_scale_id FROM reps WHERE id = ?`, [repId]);
  if (!rep || !rep.pay_scale_id) return getStandardScale();
  const scale = await get(`SELECT * FROM pay_scales WHERE id = ?`, [rep.pay_scale_id]);
  const tiers = await all(`SELECT net_ppw_threshold, dollar_per_kw FROM pay_scale_tiers WHERE pay_scale_id = ? ORDER BY net_ppw_threshold ASC`, [rep.pay_scale_id]);
  return { id: scale.id, name: scale.name, hard_floor_ppw: scale.hard_floor_ppw, tiers };
}

async function getStandardScale() {
  const scale = await get(`SELECT * FROM pay_scales WHERE name = 'Standard'`);
  const tiers = await all(`SELECT net_ppw_threshold, dollar_per_kw FROM pay_scale_tiers WHERE pay_scale_id = ? ORDER BY net_ppw_threshold ASC`, [scale.id]);
  return { id: scale.id, name: scale.name, hard_floor_ppw: scale.hard_floor_ppw, tiers };
}

async function listDeals({ statusId, repId, installerId, search, phase } = {}) {
  let sql = `
    SELECT d.*, cr.full_name as closer_name, cr.display_name as closer_display,
           sr.full_name as setter_name, sr.display_name as setter_display,
           ds.label as status_label, ds.phase as status_phase, ds.sort_order as status_sort,
           inst.name as installer_name, fin.name as financier_name
    FROM deals d
    LEFT JOIN reps cr ON cr.id = d.closer_rep_id
    LEFT JOIN reps sr ON sr.id = d.setter_rep_id
    LEFT JOIN deal_statuses ds ON ds.id = d.status_id
    LEFT JOIN installers inst ON inst.id = d.installer_id
    LEFT JOIN financiers fin ON fin.id = d.financier_id
    WHERE 1=1
  `;
  const args = [];
  if (statusId) { sql += ` AND d.status_id = ?`; args.push(statusId); }
  if (repId) { sql += ` AND (d.closer_rep_id = ? OR d.setter_rep_id = ?)`; args.push(repId, repId); }
  if (installerId) { sql += ` AND d.installer_id = ?`; args.push(installerId); }
  if (phase) { sql += ` AND ds.phase = ?`; args.push(phase); }
  if (search) { sql += ` AND (d.customer_name LIKE ? OR d.customer_address LIKE ?)`; args.push(`%${search}%`, `%${search}%`); }
  sql += ` ORDER BY ds.sort_order ASC, d.updated_at DESC`;
  return all(sql, args);
}

async function getDeal(id) {
  const deal = await get(`
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
  `, [id]);
  if (!deal) return null;
  const adders = await all(`SELECT * FROM deal_adders WHERE deal_id = ? ORDER BY sort_order ASC, id ASC`, [id]);
  const advances = await all(`SELECT a.*, r.full_name as rep_name FROM advances a LEFT JOIN reps r ON r.id = a.rep_id WHERE a.deal_id = ?`, [id]);
  const clawbacks = await all(`SELECT c.*, r.full_name as rep_name FROM clawbacks c LEFT JOIN reps r ON r.id = c.rep_id WHERE c.deal_id = ?`, [id]);
  return { ...deal, adders, advances, clawbacks };
}

async function createDeal(data, userId) {
  if (data.status_id === undefined || data.status_id === null) {
    const firstStatus = await get(`SELECT id FROM deal_statuses WHERE active = 1 ORDER BY sort_order ASC LIMIT 1`);
    if (firstStatus) data.status_id = firstStatus.id;
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
  await recalculate(id, userId);
  return getDeal(id);
}

async function recalculate(id, userId, { force = false } = {}) {
  const deal = await get(`SELECT * FROM deals WHERE id = ?`, [id]);
  if (!deal) throw new Error('Deal not found');
  if (deal.manual_override && !force) return deal;

  const adders = await all(`SELECT amount, counts_as_hard_cost FROM deal_adders WHERE deal_id = ?`, [id]);
  const payScale = await getPayScaleForRep(deal.closer_rep_id);
  const settings = await getCommissionSettings();

  const result = calculateRepCommission({
    deal: {
      contract_value: deal.contract_value || 0,
      system_size_kw: deal.system_size_kw || 0,
      pay_split: deal.pay_split || 0.5,
      cashback_amount: deal.cashback_amount || 0,
      setter_rep_id: deal.setter_rep_id
    },
    adders,
    payScale,
    settings,
    advanceAlreadyTaken: 0,
    clawbackAmount: 0
  });

  const owner = calculateOwnerDistribution({
    settings,
    m1Approved: !!deal.m1_approved_date,
    m2Approved: !!deal.m2_approved_date
  });
  const joeyBonus = calculateJoeyM2Bonus({
    netPPW: result.netPPW,
    m2Approved: !!deal.m2_approved_date,
    settings
  });

  const newValues = {
    net_ppw: result.netPPW,
    pay_scale_rate: result.payScaleRate,
    rep_pool: result.repPool,
    closer_pay_gross: result.closerPayGross,
    closer_pay_net: result.closerPayNet,
    setter_pay: result.setterPay,
    owner_etai_total: owner.etaiTotal,
    owner_noy_total: owner.noyTotal,
    joey_m2_bonus: joeyBonus,
    below_floor: result.belowFloor ? 1 : 0
  };

  await run(
    `UPDATE deals SET net_ppw=?, pay_scale_rate=?, rep_pool=?, closer_pay_gross=?, closer_pay_net=?, setter_pay=?,
     owner_etai_total=?, owner_noy_total=?, joey_m2_bonus=?, below_floor=?, updated_at = datetime('now') WHERE id=?`,
    [newValues.net_ppw, newValues.pay_scale_rate, newValues.rep_pool, newValues.closer_pay_gross,
      newValues.closer_pay_net, newValues.setter_pay, newValues.owner_etai_total, newValues.owner_noy_total,
      newValues.joey_m2_bonus, newValues.below_floor, id]
  );

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
  await run(`DELETE FROM deal_adders WHERE id = ?`, [adderId]);
  await auditLog.logChange('deal_adders', adder.deal_id, 'adder_removed', `${adder.label}: $${adder.amount}`, null, userId);
  return recalculate(adder.deal_id, userId);
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

async function setPaymentFlag(dealId, recipient, paid, date, userId) {
  const map = {
    closer: ['closer_paid', 'closer_paid_date'],
    setter: ['setter_paid', 'setter_paid_date'],
    owner_m1: ['owner_m1_paid', null],
    owner_m2: ['owner_m2_paid', null],
    joey: ['joey_paid', null]
  };
  const [flagField, dateField] = map[recipient];
  if (dateField) {
    await run(`UPDATE deals SET ${flagField} = ?, ${dateField} = ?, updated_at = datetime('now') WHERE id = ?`,
      [paid ? 1 : 0, paid ? (date || new Date().toISOString().slice(0, 10)) : null, dealId]);
  } else {
    await run(`UPDATE deals SET ${flagField} = ?, updated_at = datetime('now') WHERE id = ?`, [paid ? 1 : 0, dealId]);
  }
  await auditLog.logChange('deals', dealId, flagField, !paid, paid, userId, `Marked ${recipient} as ${paid ? 'paid' : 'unpaid'}`);
  return getDeal(dealId);
}

async function setOverride(dealId, { override, reason, fields }, userId) {
  await run(`UPDATE deals SET manual_override = ?, override_reason = ?, override_by = ?, override_at = datetime('now') WHERE id = ?`,
    [override ? 1 : 0, reason || null, userId, dealId]);
  await auditLog.logChange('deals', dealId, 'manual_override', !override, override, userId, reason);
  if (override && fields) {
    const allowed = fields && Object.keys(fields).filter((f) => COMPUTED_FIELDS.includes(f));
    if (allowed.length) {
      const oldRow = await get(`SELECT * FROM deals WHERE id = ?`, [dealId]);
      const setClause = allowed.map((f) => `${f} = ?`).join(', ');
      const values = allowed.map((f) => fields[f]);
      await run(`UPDATE deals SET ${setClause}, updated_at = datetime('now') WHERE id = ?`, [...values, dealId]);
      await auditLog.logDiff('deals', dealId, oldRow, fields, userId, reason || 'Manual override of computed values');
    }
  }
  return getDeal(dealId);
}

async function deleteDeal(id, userId) {
  await auditLog.logChange('deals', id, '_deleted', null, null, userId, 'Deal deleted');
  await run(`DELETE FROM deal_adders WHERE deal_id = ?`, [id]);
  await run(`DELETE FROM deals WHERE id = ?`, [id]);
}

module.exports = {
  listDeals, getDeal, createDeal, updateDeal, recalculate,
  addAdder, updateAdder, deleteAdder, setApproval, setPaymentFlag, setOverride, deleteDeal,
  getCommissionSettings, getPayScaleForRep
};
