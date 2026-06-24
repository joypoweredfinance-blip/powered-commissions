const bcrypt = require('bcryptjs');
const { run, get } = require('../db/client');

async function findByEmail(email) {
  return get(`SELECT * FROM users WHERE email = ? AND active = 1`, [email.toLowerCase().trim()]);
}

async function findById(id) {
  return get(`SELECT * FROM users WHERE id = ?`, [id]);
}

async function verifyPassword(user, password) {
  return bcrypt.compare(password, user.password_hash);
}

async function setPassword(userId, newPassword) {
  const hash = await bcrypt.hash(newPassword, 10);
  await run(`UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`, [hash, userId]);
}

async function touchLastLogin(userId) {
  await run(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`, [userId]);
}

async function createLogin({ email, role, rep_id = null, staff_id = null, tempPassword }) {
  const hash = await bcrypt.hash(tempPassword, 10);
  const res = await run(
    `INSERT INTO users (email, password_hash, role, rep_id, staff_id, must_change_password) VALUES (?, ?, ?, ?, ?, 1)`,
    [email.toLowerCase().trim(), hash, role, rep_id, staff_id]
  );
  return res.lastInsertRowid;
}

function homePathFor(user) {
  if (user.role === 'admin') return '/admin/dashboard.html';
  if (user.role === 'sales_rep') return '/rep/dashboard.html';
  if (user.role === 'payroll_staff') return '/staff/dashboard.html';
  return '/login.html';
}

module.exports = { findByEmail, findById, verifyPassword, setPassword, touchLastLogin, createLogin, homePathFor };
