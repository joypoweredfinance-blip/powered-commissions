const express = require('express');
const router = express.Router();
const { run, get, all } = require('../db/client');
const userService = require('../services/userService');
const { genPassword } = require('../services/passwordUtil');
const auditLog = require('../services/auditLog');

router.get('/', async (req, res) => {
  try {
    const staff = await all(`
      SELECT s.*,
        (SELECT u.email FROM users u WHERE u.staff_id = s.id AND u.role = 'payroll_staff' LIMIT 1) as login_email
      FROM payroll_staff s ORDER BY s.active DESC, s.full_name
    `);
    res.json(staff);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { first_name, last_name, staff_type, email, phone, account_info, notes } = req.body;
    let full_name = req.body.full_name;
    if (!full_name && (first_name || last_name)) full_name = [first_name, last_name].filter(Boolean).join(' ');
    if (!full_name || !staff_type) return res.status(400).json({ error: 'full_name (or first_name/last_name) and staff_type are required' });
    const result = await run(
      `INSERT INTO payroll_staff (full_name, first_name, last_name, staff_type, email, phone, account_info, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [full_name, first_name || null, last_name || null, staff_type, email || null, phone || null, account_info || null, notes || null]
    );
    res.status(201).json(await get(`SELECT * FROM payroll_staff WHERE id = ?`, [Number(result.lastInsertRowid)]));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const old = await get(`SELECT * FROM payroll_staff WHERE id = ?`, [req.params.id]);
    if (!old) return res.status(404).json({ error: 'Staff member not found' });
    const body = { ...req.body };
    if ((body.first_name !== undefined || body.last_name !== undefined) && body.full_name === undefined) {
      const first = body.first_name !== undefined ? body.first_name : old.first_name;
      const last = body.last_name !== undefined ? body.last_name : old.last_name;
      body.full_name = [first, last].filter(Boolean).join(' ') || old.full_name;
    }
    const fields = ['full_name', 'first_name', 'last_name', 'staff_type', 'email', 'phone', 'account_info', 'active', 'notes']
      .filter((f) => body[f] !== undefined);
    const setClause = fields.map((f) => `${f} = ?`).join(', ');
    const values = fields.map((f) => body[f]);
    await run(`UPDATE payroll_staff SET ${setClause} WHERE id = ?`, [...values, req.params.id]);
    await auditLog.logDiff('payroll_staff', req.params.id, old, body, req.user.id);
    res.json(await get(`SELECT * FROM payroll_staff WHERE id = ?`, [req.params.id]));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/create-login', async (req, res) => {
  try {
    const staff = await get(`SELECT * FROM payroll_staff WHERE id = ?`, [req.params.id]);
    if (!staff) return res.status(404).json({ error: 'Staff member not found' });
    const email = (req.body.email || staff.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'An email is required to create a login.' });
    const existing = await get(`SELECT id FROM users WHERE email = ?`, [email]);
    if (existing) return res.status(400).json({ error: 'That email already has a login.' });
    const tempPassword = genPassword();
    await userService.createLogin({ email, role: 'payroll_staff', staff_id: staff.id, tempPassword });
    if (!staff.email) await run(`UPDATE payroll_staff SET email = ? WHERE id = ?`, [email, staff.id]);
    await auditLog.logChange('payroll_staff', staff.id, 'login_created', null, email, req.user.id);
    res.json({ ok: true, email, tempPassword });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/reset-password', async (req, res) => {
  try {
    const staff = await get(`SELECT * FROM payroll_staff WHERE id = ?`, [req.params.id]);
    if (!staff) return res.status(404).json({ error: 'Staff member not found' });
    const user = await get(`SELECT id FROM users WHERE staff_id = ? AND role = 'payroll_staff'`, [staff.id]);
    if (!user) return res.status(400).json({ error: 'This person does not have a login yet.' });
    const tempPassword = genPassword();
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(tempPassword, 10);
    await run(`UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?`, [hash, user.id]);
    await auditLog.logChange('payroll_staff', staff.id, 'password_reset', null, null, req.user.id, 'Password reset by admin');
    res.json({ ok: true, email: staff.email, tempPassword });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
