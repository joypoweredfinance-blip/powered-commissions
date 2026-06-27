const { get, all } = require('../db/client');

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
    SELECT d.*, ds.label as status_label,
           cr.full_name as closer_name, cr.display_name as closer_display,
           sr.full_name as setter_name, sr.display_name as setter_display
    FROM deals d
    LEFT JOIN deal_statuses ds ON ds.id = d.status_id
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
  // Installer/Financier and a raw total_adders figure are deliberately left out — no rep-facing
  // page renders them anymore (category totals replaced total_adders; Installer/Financier was
  // removed from the rep's view entirely), so they're excluded from the payload itself rather
  // than just left unrendered.
  const shared = {
    id: deal.id, customer_name: deal.customer_name, customer_address: deal.customer_address,
    status_label: deal.status_label,
    module_type: deal.module_type, battery_type: deal.battery_type, num_batteries: deal.num_batteries,
    system_size_kw: deal.system_size_kw, panel_count: deal.panel_count, panel_watts: deal.panel_watts,
    annual_production_kwh: deal.annual_production_kwh, contract_value: deal.contract_value,
    monthly_payment: deal.monthly_payment, rate_per_kwh: deal.rate_per_kwh, escalator_pct: deal.escalator_pct,
    date_signed: deal.date_signed, install_date: deal.install_date, install_completed_date: deal.install_completed_date,
    net_ppw: deal.net_ppw, pay_scale_rate: deal.pay_scale_rate, below_floor: deal.below_floor,
    closer_display: deal.closer_display || deal.closer_name,
    setter_display: deal.setter_display || deal.setter_name,
    viewRole: deal.viewRole
  };
  if (deal.viewRole === 'closer') {
    return {
      ...shared,
      payAmount: deal.closer_pay_net,
      payGross: deal.closer_pay_gross,
      // Each of these is 0 when not applicable — the frontend only renders the row when truthy,
      // since these deductions are already baked into payAmount and showing a $0 line for a
      // deduction that never applied would just be confusing.
      cashbackDeduction: deal.cashback_amount ? round2(deal.cashback_amount * 0.5) : 0,
      advanceDeduction: deal.advance_deduction || 0,
      otherDeduction: deal.deduction_other || 0,
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

// Rep-visible classification only — never an individual item's label/description. "Other" is
// an internal-only classification and folds into Miscellaneous here so reps never see it as
// its own category.
const REP_ADDER_CATEGORIES = ['reroof_sow', 'mpu', 'battery', 'permit', 'misc'];
function computeAdderCategoryTotals(adders) {
  const totals = { reroof_sow: 0, mpu: 0, battery: 0, permit: 0, misc: 0 };
  for (const a of adders) {
    const cat = a.category === 'other' ? 'misc' : a.category;
    if (totals[cat] !== undefined) totals[cat] = round2(totals[cat] + (a.amount || 0));
  }
  return totals;
}

function lastNMonths(n) {
  const months = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

// The ONE place "this rep's dashboard" is computed — used both by the rep's own login
// (/api/myjobs/dashboard) and by admin's read-only view of a rep (Sales Reps -> a rep). Built
// entirely from visibleDeals() (approved-only), so nothing unapproved ever shows up on either
// side, and the two can never drift into showing different numbers for the same rep.
async function computeRepDashboard(repId) {
  const rep = await get(`SELECT id, full_name, display_name FROM reps WHERE id = ?`, [repId]);
  if (!rep) return null;
  const deals = (await visibleDeals(repId)).map(shapeForRole);

  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisYear = String(now.getFullYear());
  let thisMonthCommission = 0, ytdCommission = 0, allTimeCommission = 0;
  let ppwSum = 0, ppwCount = 0;
  const monthlyTotals = {};
  lastNMonths(6).forEach((m) => { monthlyTotals[m] = 0; });

  for (const d of deals) {
    if (d.net_ppw !== null && d.net_ppw !== undefined) { ppwSum += d.net_ppw; ppwCount++; }
    if (d.paid && d.paidDate) {
      const amt = d.payAmount || 0;
      // All-Time stays anchored on when it was actually paid — This Month / YTD / the trend
      // chart are anchored on Solar Date (install_completed_date) instead, so a rep's period
      // totals reflect when the job itself went solar, not whenever the payment happened to
      // get processed.
      allTimeCommission += amt;
      const solarMk = (d.install_completed_date || '').slice(0, 7);
      if (solarMk === thisMonth) thisMonthCommission += amt;
      if (solarMk.startsWith(thisYear)) ytdCommission += amt;
      if (solarMk in monthlyTotals) monthlyTotals[solarMk] += amt;
    }
  }

  return {
    rep,
    kpis: {
      thisMonthCommission: round2(thisMonthCommission),
      ytdCommission: round2(ytdCommission),
      allTimeCommission: round2(allTimeCommission),
      avgNetPPW: ppwCount ? round2(ppwSum / ppwCount) : null
    },
    monthlyTrend: lastNMonths(6).map((m) => ({ month: m, total: round2(monthlyTotals[m]) })),
    // Unsliced — this is the primary "my deals" list, not just a preview.
    recentJobs: deals
  };
}

module.exports = { viewRoleFor, visibleDeals, shapeForRole, computeAdderCategoryTotals, computeRepDashboard, REP_ADDER_CATEGORIES, round2 };
