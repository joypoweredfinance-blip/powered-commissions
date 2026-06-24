const express = require('express');
const router = express.Router();
const { run, get, all } = require('../db/client');
const auditLog = require('../services/auditLog');

router.get('/', async (req, res) => {
  try {
    const rows = await all(`
      SELECT a.*, r.full_name as rep_name, d.customer_name
      FROM advances a
      LEFT JOIN reps r ON r.id = a.rep_id
      LEFT JOIN deals d ON d.id = a.deal_id
      ORDER BY a.created_at DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { rep_id, deal_id, amount, date_sent, notes } = req.body;
    if (!rep_id || !amount) return res.status(400).json({ error: 'rep_id and amount are required' });
    const result = await run(
      `INSERT INTO advances (rep_id, deal_id, amount, date_sent, notes) VALUES (?, ?, ?, ?, ?)`,
      [rep_id, deal_id || null, amount, date_sent || null, notes || null]
    );
    const id = Number(result.lastInsertRowid);
    await auditLog.logChange('advances', id, '_created', null, `$${amount} to rep ${rep_id}`, req.user.id);
    res.status(201).json(await get(`SELECT * FROM advances WHERE id = ?`, [id]));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const old = await get(`SELECT * FROM advances WHERE id = ?`, [req.params.id]);
    if (!old) return res.status(404).json({ error: 'Advance not found' });
    const fields = ['rep_id', 'deal_id', 'amount', 'date_sent', 'status', 'amount_deducted', 'date_deducted', 'notes']
      .filter((f) => req.body[f] !== undefined);
    const setClause = fields.map((f) => `${f} = ?`).join(', ');
    await run(`UPDATE advances SET ${setClause} WHERE id = ?`, [...fields.map((f) => req.body[f]), req.params.id]);
    await auditLog.logDiff('advances', req.params.id, old, req.body, req.user.id);
    res.json(await get(`SELECT * FROM advances WHERE id = ?`, [req.params.id]));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await auditLog.logChange('advances', req.params.id, '_deleted', null, null, req.user.id);
    await run(`DELETE FROM advances WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
