const path = require('path');
const userService = require('../services/userService');

function requireAuth(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
    return res.redirect('/login.html');
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
      return res.redirect('/login.html');
    }
    if (!roles.includes(req.user.role)) {
      if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Forbidden' });
      return res.status(403).sendFile(path.join(__dirname, '..', 'public', '403.html'));
    }
    next();
  };
}

// Serves a static page, but redirects to the role-appropriate home if the user must change
// their password first, or to login if not authenticated.
function guardPage(file, ...roles) {
  return (req, res) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) return res.redirect('/login.html');
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).sendFile(path.join(__dirname, '..', 'public', '403.html'));
    }
    if (req.user.must_change_password && file !== 'change-password.html') {
      return res.redirect('/change-password.html');
    }
    res.sendFile(path.join(__dirname, '..', 'public', file));
  };
}

module.exports = { requireAuth, requireRole, guardPage, homePathFor: userService.homePathFor };
