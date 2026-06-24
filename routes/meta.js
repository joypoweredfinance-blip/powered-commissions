const express = require('express');
const router = express.Router();
const { all } = require('../db/client');

router.get('/', async (req, res) => {
  try {
    const [reps, installers, financiers, statuses, payScales, dropdownRows] = await Promise.all([
      all(`SELECT id, full_name, display_name, rep_type, pay_scale_id, active FROM reps WHERE active = 1 ORDER BY full_name`),
      all(`SELECT id, name, rate_per_watt, m1_pct, m2_pct FROM installers WHERE active = 1 ORDER BY name`),
      all(`SELECT id, name, min_fico FROM financiers WHERE active = 1 ORDER BY name`),
      all(`SELECT id, label, phase, sort_order FROM deal_statuses WHERE active = 1 ORDER BY sort_order`),
      all(`SELECT id, name FROM pay_scales WHERE active = 1 ORDER BY name`),
      all(`SELECT id, category, value FROM dropdown_options WHERE active = 1 ORDER BY category, sort_order, value`)
    ]);
    const dropdownOptions = {};
    for (const r of dropdownRows) {
      dropdownOptions[r.category] = dropdownOptions[r.category] || [];
      dropdownOptions[r.category].push(r);
    }
    res.json({ reps, installers, financiers, statuses, payScales, dropdownOptions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
