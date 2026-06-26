const { all } = require('../db/client');

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

// Single source of truth for "what role does this rep have on this deal" — used both by the
// rep's own /api/myjobs routes and by the admin's read-only preview of a rep's view. Never
// duplicate this logic; a second copy is how the two views would eventually drift apart.
function viewRoleFor(deal, repId) {
  if (deal.closer_rep_id === repId && deal.closer_breakdown_approved) return 'closer';
  if (deal.setter_rep_id === repId && deal.setter_breakdown_approved) return 'setter';
  return null;
}

async function visibleDeals(repId) {
  const rows = await all(`
    SELECT d.*, ds.label as status_label, inst.name as installer_name, fin.name as financier_name,
           cr.full_name as closer_name, cr.display_name as closer_display,
           sr.full_name as setter_name, sr.display_name as setter_display,
           (SELECT COALESCE(SUM(amount), 0) FROM deal_adders WHERE deal_id = d.id) as total_adders
    FROM deals d
    LEFT JOIN deal_statuses ds ON ds.id = d.status_id
    LEFT JOIN installers inst ON inst.id = d.installer_id
    LEFT JOIN financiers fin ON fin.id = d.financier_id
    LEFT JOIN reps cr ON cr.id = d.closer_rep_id
    LEFT JOIN reps sr ON sr.id = d.setter_rep_id
    WHERE (d.closer_rep_id = ? AND d.closer_breakdown_approved = 1)
       OR (d.setter_rep_id = ? AND d.setter_breakdown_approved = 1)
    ORDER BY d.updated_at DESC
  `, [repId, repId]);
  return rows.map((d) => ({ ...d, viewRole: viewRoleFor(d, Number(repId)) }));
}

// Strips fields the viewing rep shouldn't see (the other party's pay, admin-only notes/overrides).
// Only ever called on rows already filtered by visibleDeals(), so viewRole is guaranteed to be
// 'closer' or 'setter' here, never null — never call this on an unfiltered deal row.
function shapeForRole(deal) {
  const shared = {
    id: deal.id, customer_name: deal.customer_name, customer_address: deal.customer_address,
    status_label: deal.status_label, installer_name: deal.installer_name, financier_name: deal.financier_name,
    module_type: deal.module_type, battery_type: deal.battery_type, num_batteries: deal.num_batteries,
    system_size_kw: deal.system_size_kw, panel_count: deal.panel_count, panel_watts: deal.panel_watts,
    annual_production_kwh: deal.annual_production_kwh, contract_value: deal.contract_value,
    monthly_payment: deal.monthly_payment, rate_per_kwh: deal.rate_per_kwh, escalator_pct: deal.escalator_pct,
    date_signed: deal.date_signed, install_date: deal.install_date, install_completed_date: deal.install_completed_date,
    net_ppw: deal.net_ppw, pay_scale_rate: deal.pay_scale_rate, below_floor: deal.below_floor,
    total_adders: deal.total_adders || 0,
    closer_display: deal.closer_display || deal.closer_name,
    setter_display: deal.setter_display || deal.setter_name,
    viewRole: deal.viewRole
  };
  if (deal.viewRole === 'closer') {
    return {
      ...shared,
      payAmount: deal.closer_pay_net,
      payGross: deal.closer_pay_gross,
      cashbackDeduction: deal.cashback_amount ? round2(deal.cashback_amount * 0.5) : 0,
      paid: !!deal.closer_paid,
      paidDate: deal.closer_paid_date
    };
  }
  return {
    ...shared,
    payAmount: deal.setter_pay,
    paid: !!deal.setter_paid,
    paidDate: deal.setter_paid_date
  };
}

module.exports = { viewRoleFor, visibleDeals, shapeForRole, round2 };
