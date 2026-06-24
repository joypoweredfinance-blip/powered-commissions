const express = require('express');
const router = express.Router();
const { get, all } = require('../db/client');

function viewRoleFor(deal, repId) {
  if (deal.closer_rep_id === repId && deal.closer_breakdown_approved) return 'closer';
  if (deal.setter_rep_id === repId && deal.setter_breakdown_approved) return 'setter';
  return null;
}

async function visibleDeals(repId) {
  const rows = await all(`
    SELECT d.*, ds.label as status_label, inst.name as installer_name, fin.name as financier_name,
           cr.full_name as closer_name, cr.display_name as closer_display,
           sr.full_name as setter_name, sr.display_name as setter_display
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
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

function lastNMonths(n) {
  const months = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

// Built entirely from visibleDeals() (approved-only) — never reuses the admin dashboard
// service, which deliberately includes unapproved deals for Joy's oversight.
router.get('/dashboard', async (req, res) => {
  try {
    const rep = await get(`SELECT id, full_name, display_name FROM reps WHERE id = ?`, [req.user.rep_id]);
    if (!rep) return res.status(404).json({ error: 'Rep profile not found' });
    const deals = (await visibleDeals(req.user.rep_id)).map(shapeForRole);

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
        const mk = (d.paidDate || '').slice(0, 7);
        allTimeCommission += amt;
        if (mk === thisMonth) thisMonthCommission += amt;
        if (mk.startsWith(thisYear)) ytdCommission += amt;
        if (mk in monthlyTotals) monthlyTotals[mk] += amt;
      }
    }

    res.json({
      rep,
      kpis: {
        thisMonthCommission: round2(thisMonthCommission),
        ytdCommission: round2(ytdCommission),
        allTimeCommission: round2(allTimeCommission),
        avgNetPPW: ppwCount ? round2(ppwSum / ppwCount) : null
      },
      monthlyTrend: lastNMonths(6).map((m) => ({ month: m, total: round2(monthlyTotals[m]) })),
      recentJobs: deals.slice(0, 8)
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/', async (req, res) => {
  try {
    const deals = await visibleDeals(req.user.rep_id);
    res.json(deals.map(shapeForRole));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/commissions', async (req, res) => {
  try {
    const deals = await visibleDeals(req.user.rep_id);
    const shaped = deals.map(shapeForRole).filter((d) => d.paid);
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const thisYear = String(now.getFullYear());
    let thisMonthTotal = 0, ytdTotal = 0, allTimeTotal = 0;
    for (const d of shaped) {
      allTimeTotal += d.payAmount || 0;
      const mk = (d.paidDate || '').slice(0, 7);
      if (mk === thisMonth) thisMonthTotal += d.payAmount || 0;
      if (mk.startsWith(thisYear)) ytdTotal += d.payAmount || 0;
    }
    res.json({
      totals: { thisMonth: round2(thisMonthTotal), ytd: round2(ytdTotal), allTime: round2(allTimeTotal) },
      history: shaped.sort((a, b) => new Date(b.paidDate) - new Date(a.paidDate))
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const deals = await visibleDeals(req.user.rep_id);
    const deal = deals.find((d) => String(d.id) === String(req.params.id));
    if (!deal) return res.status(404).json({ error: 'Job not found or not yet approved for your view.' });
    res.json(shapeForRole(deal));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
