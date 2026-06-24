const express = require('express');
const router = express.Router();
const dashboardService = require('../services/dashboardService');

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

module.exports = router;
