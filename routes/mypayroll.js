const express = require('express');
const router = express.Router();
const dashboardService = require('../services/dashboardService');

// Safe to reuse the same service the admin uses for staff dashboards: it's already scoped
// to a single staff_id, and owner/PM/ops payroll isn't gated by the rep approval workflow
// (that gate only governs what sales reps see about their own deals).
router.get('/dashboard', async (req, res) => {
  try {
    const data = await dashboardService.getStaffDashboard(req.user.staff_id);
    if (!data) return res.status(404).json({ error: 'Staff profile not found' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
