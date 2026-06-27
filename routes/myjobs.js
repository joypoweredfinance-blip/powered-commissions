const express = require('express');
const router = express.Router();
const { all } = require('../db/client');
const { visibleDeals, shapeForRole, computeAdderCategoryTotals, computeRepDashboard, round2 } = require('../services/repViewService');

router.get('/dashboard', async (req, res) => {
  try {
    const data = await computeRepDashboard(req.user.rep_id);
    if (!data) return res.status(404).json({ error: 'Rep profile not found' });
    res.json(data);
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
    // Category totals only — never an individual item's label, which could describe something
    // internal (e.g. a specific receipt line) that's none of the rep's business.
    const adders = await all(`SELECT category, amount FROM deal_adders WHERE deal_id = ?`, [deal.id]);
    res.json({ ...shapeForRole(deal), adderCategoryTotals: computeAdderCategoryTotals(adders) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
