const express = require('express');
const router = express.Router();
const dashboardService = require('../services/dashboardService');

// Safe to reuse the same service the admin uses for staff dashboards: it's already scoped
// to a single staff_id. Visibility here is gated by Commission Summary pay-run status
// (approved/paid only) rather than the sales-rep approval flags, which only govern reps.
router.get('/dashboard', async (req, res) => {
  try {
    const data = await dashboardService.getStaffDashboard(req.user.staff_id);
    if (!data) return res.status(404).json({ error: 'Staff profile not found' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
