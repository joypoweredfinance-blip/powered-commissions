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
    const { full_name, staff_type, email, notes } = req.body;
    if (!full_name || !staff_type) return res.status(400).json({ error: 'full_name and staff_type are required' });
    const result = await run(
      `INSERT INTO payroll_staff (full_name, staff_type, email, notes) VALUES (?, ?, ?, ?)`,
      [full_name, staff_type, email || null, notes || null]
    );
    res.status(201).json(await get(`SELECT * FROM payroll_staff WHERE id = ?`, [Number(result.lastInsertRowid)]));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const old = await get(`SELECT * FROM payroll_staff WHERE id = ?`, [req.params.id]);
    if (!old) return res.status(404).json({ error: 'Staff member not found' });
    const fields = ['full_name', 'staff_type', 'email', 'active', 'notes'].filter((f) => req.body[f] !== undefined);
    const setClause = fields.map((f) => `${f} = ?`).join(', ');
    const values = fields.map((f) => req.body[f]);
    await run(`UPDATE payroll_staff SET ${setClause} WHERE id = ?`, [...values, req.params.id]);
    await auditLog.logDiff('payroll_staff', req.params.id, old, req.body, req.user.id);
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

module.exports = router;
