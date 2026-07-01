const express = require('express');
const router = express.Router();
const { run, get, all } = require('../db/client');
const userService = require('../services/userService');
const { genPassword } = require('../services/passwordUtil');
const auditLog = require('../services/auditLog');

router.get('/', async (req, res) => {
  try {
    const reps = await all(`
      SELECT r.*, ps.name as pay_scale_name,
        (SELECT u.email FROM users u WHERE u.rep_id = r.id AND u.role = 'sales_rep' LIMIT 1) as login_email
      FROM reps r LEFT JOIN pay_scales ps ON ps.id = r.pay_scale_id
      ORDER BY r.active DESC, r.full_name
    `);
    res.json(reps);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { first_name, last_name, display_name, rep_type, email, phone, account_info, pay_type, weekly_amount, pay_scale_id, notes } = req.body;
    let full_name = req.body.full_name;
    if (!full_name && (first_name || last_name)) full_name = [first_name, last_name].filter(Boolean).join(' ');
    if (!full_name) return res.status(400).json({ error: 'full_name (or first_name/last_name) is required' });
    const result = await run(
      `INSERT INTO reps (full_name, first_name, last_name, display_name, rep_type, email, phone, account_info, pay_type, weekly_amount, pay_scale_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [full_name, first_name || null, last_name || null, display_name || null, rep_type || 'both', email || null, phone || null,
       account_info || null, pay_type || 'commission', weekly_amount || null, pay_scale_id || null, notes || null]
    );
    res.status(201).json(await get(`SELECT * FROM reps WHERE id = ?`, [Number(result.lastInsertRowid)]));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const old = await get(`SELECT * FROM reps WHERE id = ?`, [req.params.id]);
    if (!old) return res.status(404).json({ error: 'Rep not found' });
    const body = { ...req.body };
    // Keep full_name in sync with first/last unless the caller explicitly sent its own
    // full_name (e.g. a future bulk-import path) — the editable UI only ever sends first/last.
    if ((body.first_name !== undefined || body.last_name !== undefined) && body.full_name === undefined) {
      const first = body.first_name !== undefined ? body.first_name : old.first_name;
      const last = body.last_name !== undefined ? body.last_name : old.last_name;
      body.full_name = [first, last].filter(Boolean).join(' ') || old.full_name;
    }
    const fields = ['full_name', 'first_name', 'last_name', 'display_name', 'rep_type', 'email', 'phone',
      'account_info', 'pay_type', 'weekly_amount', 'pay_scale_id', 'active', 'notes']
      .filter((f) => body[f] !== undefined);
    const setClause = fields.map((f) => `${f} = ?`).join(', ');
    const values = fields.map((f) => body[f]);
    await run(`UPDATE reps SET ${setClause} WHERE id = ?`, [...values, req.params.id]);
    await auditLog.logDiff('reps', req.params.id, old, body, req.user.id);
    res.json(await get(`SELECT * FROM reps WHERE id = ?`, [req.params.id]));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/create-login', async (req, res) => {
  try {
    const rep = await get(`SELECT * FROM reps WHERE id = ?`, [req.params.id]);
    if (!rep) return res.status(404).json({ error: 'Rep not found' });
    const email = (req.body.email || rep.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'An email is required to create a login.' });
    const existing = await get(`SELECT id FROM users WHERE email = ?`, [email]);
    if (existing) return res.status(400).json({ error: 'That email already has a login.' });
    const tempPassword = genPassword();
    await userService.createLogin({ email, role: 'sales_rep', rep_id: rep.id, tempPassword });
    if (!rep.email) await run(`UPDATE reps SET email = ? WHERE id = ?`, [email, rep.id]);
    await auditLog.logChange('reps', rep.id, 'login_created', null, email, req.user.id);
    res.json({ ok: true, email, tempPassword });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const rep = await get(`SELECT * FROM reps WHERE id = ?`, [req.params.id]);
    if (!rep) return res.status(404).json({ error: 'Rep not found' });
    const [deals, advances, clawbacks] = await Promise.all([
      all(`SELECT id, customer_name FROM deals WHERE closer_rep_id = ? OR setter_rep_id = ? LIMIT 20`, [req.params.id, req.params.id]),
      all(`SELECT id FROM advances WHERE rep_id = ? LIMIT 1`, [req.params.id]),
      all(`SELECT id FROM clawbacks WHERE rep_id = ? LIMIT 1`, [req.params.id])
    ]);
    if (deals.length || advances.length || clawbacks.length) {
      const parts = [];
      if (deals.length) parts.push(`${deals.length} deal(s): ${deals.map((d) => d.customer_name || `#${d.id}`).join(', ')}`);
      if (advances.length) parts.push('advances');
      if (clawbacks.length) parts.push('clawbacks');
      return res.status(409).json({ error: `Cannot delete ${rep.full_name} — they are attached to ${parts.join('; ')}. Remove them from all deals/advances/clawbacks first.` });
    }
    await run(`DELETE FROM users WHERE rep_id = ?`, [req.params.id]);
    await run(`DELETE FROM reps WHERE id = ?`, [req.params.id]);
    await auditLog.logChange('reps', req.params.id, 'deleted', rep.full_name, null, req.user.id, 'Rep profile permanently deleted');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/reset-password', async (req, res) => {
  try {
    const rep = await get(`SELECT * FROM reps WHERE id = ?`, [req.params.id]);
    if (!rep) return res.status(404).json({ error: 'Rep not found' });
    const user = await get(`SELECT id FROM users WHERE rep_id = ? AND role = 'sales_rep'`, [rep.id]);
    if (!user) return res.status(400).json({ error: 'This rep does not have a login yet.' });
    const tempPassword = genPassword();
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(tempPassword, 10);
    await run(`UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?`, [hash, user.id]);
    await auditLog.logChange('reps', rep.id, 'password_reset', null, null, req.user.id, 'Password reset by admin');
    res.json({ ok: true, email: rep.email, tempPassword });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
