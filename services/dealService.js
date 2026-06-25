const { run, get, all } = require('../db/client');
const {
  calculateRepCommission, calculateOwnerDistribution, calculateJoeyM2Bonus,
  computeEpcCost, computeGross, computeExpectedFunding, sumAllAdders, round2
} = require('./commissionEngine');
const auditLog = require('./auditLog');

const EDITABLE_FIELDS = [
  'customer_name', 'customer_address', 'customer_phone', 'status_id', 'closer_rep_id', 'setter_rep_id',
  'pay_split', 'is_referral', 'installer_id', 'financier_id', 'module_type', 'battery_type', 'num_batteries',
  'system_size_kw', 'panel_count', 'panel_watts', 'annual_production_kwh', 'contract_value', 'epc_rate_per_watt',
  'monthly_payment', 'rate_per_kwh', 'escalator_pct', 'cashback_amount', 'date_signed', 'install_date',
  'install_completed_date', 'ntp_approved_date', 'm1_approved_date', 'm1_paid_date', 'pto_granted_date',
  'm2_approved_date', 'm2_paid_date', 'admin_notes',
  'funds_received_m1', 'funds_received_m1_date', 'funds_received_m2', 'funds_received_m2_date'
];

const COMPUTED_FIELDS = [
  'net_ppw', 'pay_scale_rate', 'rep_pool', 'closer_pay_gross', 'closer_pay_net', 'setter_pay',
  'owner_etai_total', 'owner_etai_m1_amount', 'owner_etai_m2_amount',
  'owner_noy_total', 'owner_noy_m1_amount', 'owner_noy_m2_amount',
  'joey_m2_bonus', 'below_floor',
  'gross_amount', 'expected_m1_amount', 'expected_m2_amount'
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
  // Deliberately does NOT auto-recalculate here. A general field save (customer info, dates,
  // notes, etc.) should only persist what was actually edited — recalculation is a separate,
  // explicit action (the Recalculate button, adding/editing an adder, or creating the deal)
  // so it never looks like a save produced a second, surprise change to the commission numbers.
  return getDeal(id);
}

function parseOverriddenFields(deal) {
  try { return JSON.parse(deal.overridden_fields || '[]'); } catch (e) { return []; }
}

async function recalculate(id, userId, { force = false } = {}) {
  const deal = await get(`SELECT * FROM deals WHERE id = ?`, [id]);
  if (!deal) throw new Error('Deal not found');
  // force clears every lock and recomputes the whole deal fresh; otherwise any individually
  // locked field (e.g. just Joey's bonus) is skipped while everything else still recalculates.
  const lockedFields = force ? [] : parseOverriddenFields(deal);
  if (force) {
    await run(`UPDATE deals SET manual_override = 0, overridden_fields = '[]' WHERE id = ?`, [id]);
  }

  const adders = await all(`SELECT amount, counts_as_hard_cost FROM deal_adders WHERE deal_id = ?`, [id]);
  const payScale = await getPayScaleForRep(deal.closer_rep_id);
  const settings = await getCommissionSettings();
  const installer = deal.installer_id ? await get(`SELECT m1_pct, m2_pct FROM installers WHERE id = ?`, [deal.installer_id]) : null;

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

  const epcCost = computeEpcCost(deal.epc_rate_per_watt, deal.system_size_kw || 0);
  const allAddersTotal = sumAllAdders(adders);
  const gross = round2(computeGross(deal.contract_value || 0, epcCost, allAddersTotal));
  const { expectedM1, expectedM2 } = computeExpectedFunding(gross, installer);

  const newValues = {
    net_ppw: result.netPPW,
    pay_scale_rate: result.payScaleRate,
    rep_pool: result.repPool,
    closer_pay_gross: result.closerPayGross,
    closer_pay_net: result.closerPayNet,
    setter_pay: result.setterPay,
    owner_etai_total: owner.etaiTotal,
    owner_etai_m1_amount: owner.etaiM1,
    owner_etai_m2_amount: owner.etaiM2,
    owner_noy_total: owner.noyTotal,
    owner_noy_m1_amount: owner.noyM1,
    owner_noy_m2_amount: owner.noyM2,
    joey_m2_bonus: joeyBonus,
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
    owner_etai_m1: ['owner_etai_m1_paid', 'owner_etai_m1_paid_date'],
    owner_etai_m2: ['owner_etai_m2_paid', 'owner_etai_m2_paid_date'],
    owner_noy_m1: ['owner_noy_m1_paid', 'owner_noy_m1_paid_date'],
    owner_noy_m2: ['owner_noy_m2_paid', 'owner_noy_m2_paid_date'],
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
  await auditLog.logChange('deals', dealId, flagField, !paid, paid, userId, `Marked ${recipient} as ${paid ? 'paid' : 'unpaid'}`);
  return getDeal(dealId);
}

// Locks specific computed fields at admin-supplied values. Each call ADDS to whatever's
// already locked on the deal (e.g. overriding Joey's bonus today doesn't disturb a Net PPW
// override saved last week) — only "Turn Off & Recalculate" (recalculate with force) clears
// every lock at once.
async function setOverride(dealId, { override, reason, fields }, userId) {
  if (override === false) {
    await run(`UPDATE deals SET manual_override = 0, overridden_fields = '[]', override_reason = ?, override_by = ?, override_at = datetime('now') WHERE id = ?`,
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
      await run(
        `UPDATE deals SET ${setClause}, manual_override = 1, overridden_fields = ?, override_reason = ?, override_by = ?, override_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
        [...values, JSON.stringify(lockedFields), reason || null, userId, dealId]
      );
      await auditLog.logDiff('deals', dealId, oldRow, finalFields, userId, reason || 'Manual override of computed values');
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
