const express = require('express');
const passport = require('passport');
const router = express.Router();
const userService = require('../services/userService');

router.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.status(401).json({ error: (info && info.message) || 'Invalid email or password.' });
    req.logIn(user, (err2) => {
      if (err2) return next(err2);
      res.json({
        ok: true,
        mustChangePassword: !!user.must_change_password,
        redirect: user.must_change_password ? '/change-password.html' : userService.homePathFor(user)
      });
    });
  })(req, res, next);
});

router.post('/logout', (req, res) => {
  req.logout(() => {
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated' });
  const { id, email, role, rep_id, staff_id } = req.user;
  res.json({ id, email, role, rep_id, staff_id });
});

router.post('/change-password', async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated' });
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  await userService.setPassword(req.user.id, newPassword);
  res.json({ ok: true, redirect: userService.homePathFor(req.user) });
});

module.exports = router;
