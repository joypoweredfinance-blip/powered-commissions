const express = require('express');
const router = express.Router();
const { run, get, all } = require('../db/client');
const auditLog = require('../services/auditLog');

router.get('/', async (req, res) => {
  try {
    const rows = await all(`
      SELECT c.*, r.full_name as rep_name, d.customer_name
      FROM clawbacks c
      LEFT JOIN reps r ON r.id = c.rep_id
      LEFT JOIN deals d ON d.id = c.deal_id
      ORDER BY c.created_at DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { deal_id, rep_id, total_clawback, rep_share, pwrd_share, notes } = req.body;
    if (!rep_id || total_clawback === undefined) return res.status(400).json({ error: 'rep_id and total_clawback are required' });
    const result = await run(
      `INSERT INTO clawbacks (deal_id, rep_id, total_clawback, rep_share, pwrd_share, notes) VALUES (?, ?, ?, ?, ?, ?)`,
      [deal_id || null, rep_id, total_clawback, rep_share || 0, pwrd_share || 0, notes || null]
    );
    const id = Number(result.lastInsertRowid);
    await auditLog.logChange('clawbacks', id, '_created', null, `$${total_clawback} from rep ${rep_id}`, req.user.id);
    res.status(201).json(await get(`SELECT * FROM clawbacks WHERE id = ?`, [id]));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const old = await get(`SELECT * FROM clawbacks WHERE id = ?`, [req.params.id]);
    if (!old) return res.status(404).json({ error: 'Clawback not found' });
    const fields = ['deal_id', 'rep_id', 'total_clawback', 'rep_share', 'pwrd_share', 'deducted', 'deducted_date', 'notes']
      .filter((f) => req.body[f] !== undefined);
    const setClause = fields.map((f) => `${f} = ?`).join(', ');
    await run(`UPDATE clawbacks SET ${setClause} WHERE id = ?`, [...fields.map((f) => req.body[f]), req.params.id]);
    await auditLog.logDiff('clawbacks', req.params.id, old, req.body, req.user.id);
    res.json(await get(`SELECT * FROM clawbacks WHERE id = ?`, [req.params.id]));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await auditLog.logChange('clawbacks', req.params.id, '_deleted', null, null, req.user.id);
    await run(`DELETE FROM clawbacks WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
