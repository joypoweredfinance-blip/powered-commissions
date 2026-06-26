const express = require('express');
const router = express.Router();
const { run, get, all } = require('../db/client');
const auditLog = require('../services/auditLog');

router.get('/', async (req, res) => {
  try {
    res.json({
      installers: await all(`SELECT * FROM installers ORDER BY active DESC, name`),
      financiers: await all(`SELECT * FROM financiers ORDER BY active DESC, name`)
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/installers', async (req, res) => {
  try {
    const { name, rate_per_watt, m1_pct, m2_pct, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const result = await run(`INSERT INTO installers (name, rate_per_watt, m1_pct, m2_pct, notes) VALUES (?, ?, ?, ?, ?)`,
      [name, rate_per_watt || null, m1_pct || null, m2_pct || null, notes || null]);
    res.status(201).json(await get(`SELECT * FROM installers WHERE id = ?`, [Number(result.lastInsertRowid)]));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/installers/:id', async (req, res) => {
  try {
    const old = await get(`SELECT * FROM installers WHERE id = ?`, [req.params.id]);
    if (!old) return res.status(404).json({ error: 'Installer not found' });
    const fields = ['name', 'rate_per_watt', 'm1_pct', 'm2_pct', 'notes', 'active'].filter((f) => req.body[f] !== undefined);
    const setClause = fields.map((f) => `${f} = ?`).join(', ');
    await run(`UPDATE installers SET ${setClause} WHERE id = ?`, [...fields.map((f) => req.body[f]), req.params.id]);
    await auditLog.logDiff('installers', req.params.id, old, req.body, req.user.id);
    res.json(await get(`SELECT * FROM installers WHERE id = ?`, [req.params.id]));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/installers/:id', async (req, res) => {
  try {
    const installer = await get(`SELECT * FROM installers WHERE id = ?`, [req.params.id]);
    if (!installer) return res.status(404).json({ error: 'Installer not found' });
    const inUse = await get(`SELECT COUNT(*) c FROM deals WHERE installer_id = ?`, [req.params.id]);
    if (inUse.c > 0) {
      return res.status(400).json({ error: `Can't delete — ${inUse.c} deal(s) still reference this installer. Deactivate it instead.` });
    }
    await run(`DELETE FROM installers WHERE id = ?`, [req.params.id]);
    await auditLog.logChange('installers', req.params.id, '_deleted', installer.name, null, req.user.id);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/financiers', async (req, res) => {
  try {
    const { name, min_fico, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const result = await run(`INSERT INTO financiers (name, min_fico, notes) VALUES (?, ?, ?)`, [name, min_fico || null, notes || null]);
    res.status(201).json(await get(`SELECT * FROM financiers WHERE id = ?`, [Number(result.lastInsertRowid)]));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/financiers/:id', async (req, res) => {
  try {
    const old = await get(`SELECT * FROM financiers WHERE id = ?`, [req.params.id]);
    if (!old) return res.status(404).json({ error: 'Financier not found' });
    const fields = ['name', 'min_fico', 'notes', 'active'].filter((f) => req.body[f] !== undefined);
    const setClause = fields.map((f) => `${f} = ?`).join(', ');
    await run(`UPDATE financiers SET ${setClause} WHERE id = ?`, [...fields.map((f) => req.body[f]), req.params.id]);
    await auditLog.logDiff('financiers', req.params.id, old, req.body, req.user.id);
    res.json(await get(`SELECT * FROM financiers WHERE id = ?`, [req.params.id]));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/financiers/:id', async (req, res) => {
  try {
    const financier = await get(`SELECT * FROM financiers WHERE id = ?`, [req.params.id]);
    if (!financier) return res.status(404).json({ error: 'Financier not found' });
    const inUse = await get(`SELECT COUNT(*) c FROM deals WHERE financier_id = ?`, [req.params.id]);
    if (inUse.c > 0) {
      return res.status(400).json({ error: `Can't delete — ${inUse.c} deal(s) still reference this financier. Deactivate it instead.` });
    }
    await run(`DELETE FROM financiers WHERE id = ?`, [req.params.id]);
    await auditLog.logChange('financiers', req.params.id, '_deleted', financier.name, null, req.user.id);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
