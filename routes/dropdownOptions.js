const express = require('express');
const router = express.Router();
const { run, get, all } = require('../db/client');
const auditLog = require('../services/auditLog');

router.get('/', async (req, res) => {
  try {
    const rows = await all(`SELECT * FROM dropdown_options WHERE active = 1 ORDER BY category, sort_order, value`);
    const grouped = {};
    for (const r of rows) {
      grouped[r.category] = grouped[r.category] || [];
      grouped[r.category].push(r);
    }
    res.json(grouped);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { category, value } = req.body;
    if (!category || !value) return res.status(400).json({ error: 'category and value are required' });
    const existing = await get(`SELECT id FROM dropdown_options WHERE category = ? AND value = ?`, [category, value]);
    if (existing) {
      if (!existing.active) await run(`UPDATE dropdown_options SET active = 1 WHERE id = ?`, [existing.id]);
      return res.status(200).json(await get(`SELECT * FROM dropdown_options WHERE id = ?`, [existing.id]));
    }
    const maxOrder = await get(`SELECT MAX(sort_order) as m FROM dropdown_options WHERE category = ?`, [category]);
    const result = await run(
      `INSERT INTO dropdown_options (category, value, sort_order) VALUES (?, ?, ?)`,
      [category, value, (maxOrder.m ?? -1) + 1]
    );
    await auditLog.logChange('dropdown_options', Number(result.lastInsertRowid), '_added', null, `${category}: ${value}`, req.user.id);
    res.status(201).json(await get(`SELECT * FROM dropdown_options WHERE id = ?`, [Number(result.lastInsertRowid)]));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const old = await get(`SELECT * FROM dropdown_options WHERE id = ?`, [req.params.id]);
    await run(`UPDATE dropdown_options SET active = 0 WHERE id = ?`, [req.params.id]);
    await auditLog.logChange('dropdown_options', req.params.id, '_removed', old ? `${old.category}: ${old.value}` : null, null, req.user.id);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
