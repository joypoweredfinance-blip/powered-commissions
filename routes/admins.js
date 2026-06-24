const express = require('express');
const router = express.Router();
const { run, get, all } = require('../db/client');
const { genPassword } = require('../services/passwordUtil');
const bcrypt = require('bcryptjs');
const auditLog = require('../services/auditLog');

router.get('/', async (req, res) => {
  try {
    const rows = await all(`SELECT id, email, role, active, must_change_password, created_at, last_login_at FROM users WHERE role IN ('admin','super_admin') ORDER BY role DESC, email`);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const email = (req.body.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'Email is required.' });
    const existing = await get(`SELECT id FROM users WHERE email = ?`, [email]);
    if (existing) return res.status(400).json({ error: 'That email already has a login.' });
    const tempPassword = genPassword();
    const hash = await bcrypt.hash(tempPassword, 10);
    // Always 'admin' — there is no UI path to create a second super_admin.
    const result = await run(
      `INSERT INTO users (email, password_hash, role, must_change_password) VALUES (?, ?, 'admin', 1)`,
      [email, hash]
    );
    await auditLog.logChange('users', Number(result.lastInsertRowid), '_admin_created', null, email, req.user.id);
    res.status(201).json({ ok: true, email, tempPassword });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const target = await get(`SELECT * FROM users WHERE id = ?`, [req.params.id]);
    if (!target) return res.status(404).json({ error: 'Admin not found' });
    if (target.role === 'super_admin') return res.status(400).json({ error: 'The super admin account cannot be deactivated.' });
    if (req.body.active !== undefined) {
      await run(`UPDATE users SET active = ? WHERE id = ?`, [req.body.active ? 1 : 0, req.params.id]);
      await auditLog.logChange('users', req.params.id, 'active', target.active, req.body.active, req.user.id);
    }
    res.json(await get(`SELECT id, email, role, active FROM users WHERE id = ?`, [req.params.id]));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/reset-password', async (req, res) => {
  try {
    const target = await get(`SELECT * FROM users WHERE id = ?`, [req.params.id]);
    if (!target) return res.status(404).json({ error: 'Admin not found' });
    const tempPassword = genPassword();
    const hash = await bcrypt.hash(tempPassword, 10);
    await run(`UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?`, [hash, req.params.id]);
    await auditLog.logChange('users', req.params.id, 'password_reset', null, null, req.user.id, 'Password reset by super admin');
    res.json({ ok: true, email: target.email, tempPassword });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
