const express = require('express');
const router = express.Router();
const { run, get, all } = require('../db/client');
const auditLog = require('../services/auditLog');

router.get('/', async (req, res) => {
  try {
    const rows = await all(`
      SELECT rb.*, r.full_name as referring_rep_name, rr.full_name as referred_rep_name
      FROM referral_bonuses rb
      LEFT JOIN reps r ON r.id = rb.referring_rep_id
      LEFT JOIN reps rr ON rr.id = rb.referred_rep_id
      ORDER BY rb.created_at DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { referring_rep_id, referred_rep_id, referred_name, join_date, first_install_date, first_install_deal, amount, notes } = req.body;
    if (!referring_rep_id) return res.status(400).json({ error: 'referring_rep_id is required' });
    const result = await run(
      `INSERT INTO referral_bonuses (referring_rep_id, referred_rep_id, referred_name, join_date, first_install_date, first_install_deal, amount, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [referring_rep_id, referred_rep_id || null, referred_name || null, join_date || null, first_install_date || null, first_install_deal || null, amount || 1000, notes || null]
    );
    const id = Number(result.lastInsertRowid);
    await auditLog.logChange('referral_bonuses', id, '_created', null, referred_name || '', req.user.id);
    res.status(201).json(await get(`SELECT * FROM referral_bonuses WHERE id = ?`, [id]));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const old = await get(`SELECT * FROM referral_bonuses WHERE id = ?`, [req.params.id]);
    if (!old) return res.status(404).json({ error: 'Referral bonus not found' });
    const fields = ['referring_rep_id', 'referred_rep_id', 'referred_name', 'join_date', 'first_install_date', 'first_install_deal', 'amount', 'date_paid', 'notes']
      .filter((f) => req.body[f] !== undefined);
    if (fields.length) {
      const setClause = fields.map((f) => `${f} = ?`).join(', ');
      await run(`UPDATE referral_bonuses SET ${setClause} WHERE id = ?`, [...fields.map((f) => req.body[f]), req.params.id]);
      await auditLog.logDiff('referral_bonuses', req.params.id, old, req.body, req.user.id);
    }
    res.json(await get(`SELECT * FROM referral_bonuses WHERE id = ?`, [req.params.id]));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await auditLog.logChange('referral_bonuses', req.params.id, '_deleted', null, null, req.user.id);
    await run(`DELETE FROM referral_bonuses WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
