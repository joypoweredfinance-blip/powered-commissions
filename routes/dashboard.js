const express = require('express');
const router = express.Router();
const dashboardService = require('../services/dashboardService');
const { get, all } = require('../db/client');
const { visibleDeals, shapeForRole } = require('../services/repViewService');

router.get('/overall', async (req, res) => {
  try {
    const data = await dashboardService.getOverallDashboard(req.query);
    // Recent Activity surfaces audit-trail-style entries — restricted to super_admin,
    // same as the Audit Log page itself.
    if (req.user.role !== 'super_admin') delete data.recentActivity;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/rep/:id', async (req, res) => {
  try {
    const data = await dashboardService.getRepDashboard(req.params.id);
    if (!data) return res.status(404).json({ error: 'Rep not found' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/staff/:id', async (req, res) => {
  try {
    const data = await dashboardService.getStaffDashboard(req.params.id);
    if (!data) return res.status(404).json({ error: 'Staff member not found' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Read-only "what does this rep actually see" preview — reuses the exact same
// visibleDeals()/shapeForRole() logic the rep's own /api/myjobs/:id uses, so this can never
// drift into showing admin-only fields or the wrong role's pay. Approval-gated the same way:
// if the deal isn't approved for this rep's role yet, it 404s here too, since the rep
// genuinely can't see it yet either.
router.get('/rep/:repId/job/:dealId', async (req, res) => {
  try {
    const rep = await get(`SELECT id, full_name, display_name FROM reps WHERE id = ?`, [req.params.repId]);
    if (!rep) return res.status(404).json({ error: 'Rep not found' });
    const deals = await visibleDeals(req.params.repId);
    const deal = deals.find((d) => String(d.id) === String(req.params.dealId));
    if (!deal) return res.status(404).json({ error: `Not approved for ${rep.display_name || rep.full_name}'s view yet, or doesn't involve this rep.` });
    const adders = await all(`SELECT label, category, amount FROM deal_adders WHERE deal_id = ? ORDER BY sort_order, id`, [deal.id]);
    res.json({ rep, ...shapeForRole(deal), adders });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
