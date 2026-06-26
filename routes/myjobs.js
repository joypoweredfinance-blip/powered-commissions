const express = require('express');
const router = express.Router();
const { get, all } = require('../db/client');
const { visibleDeals, shapeForRole, round2 } = require('../services/repViewService');

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

    res.json({
      rep,
      kpis: {
        thisMonthCommission: round2(thisMonthCommission),
        ytdCommission: round2(ytdCommission),
        allTimeCommission: round2(allTimeCommission),
        avgNetPPW: ppwCount ? round2(ppwSum / ppwCount) : null
      },
      monthlyTrend: lastNMonths(6).map((m) => ({ month: m, total: round2(monthlyTotals[m]) })),
      // Unsliced — this is now the dashboard's primary "my deals" list, not just a preview.
      recentJobs: deals
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
    const adders = await all(`SELECT label, category, amount FROM deal_adders WHERE deal_id = ? ORDER BY sort_order, id`, [deal.id]);
    res.json({ ...shapeForRole(deal), adders });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
