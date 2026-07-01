require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const path = require('path');

const LibsqlSessionStore = require('./middleware/libsqlSessionStore');
const { initDatabase } = require('./db/database');
const { guardPage, requireRole, homePathFor } = require('./middleware/authMiddleware');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new LibsqlSessionStore(),
  secret: process.env.SESSION_SECRET || 'powered-commissions-change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

require('./config/passport');
app.use(passport.initialize());
app.use(passport.session());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/deals', requireRole('admin', 'super_admin'), require('./routes/deals'));
app.use('/api/meta', requireRole('admin', 'super_admin'), require('./routes/meta'));
app.use('/api/reps', requireRole('admin', 'super_admin'), require('./routes/reps'));
app.use('/api/payroll-staff', requireRole('admin', 'super_admin'), require('./routes/payrollStaff'));
app.use('/api/reference', requireRole('admin', 'super_admin'), require('./routes/installers'));
app.use('/api/dropdown-options', requireRole('admin', 'super_admin'), require('./routes/dropdownOptions'));
app.use('/api/settings', requireRole('admin', 'super_admin'), require('./routes/settings'));
app.use('/api/advances', requireRole('admin', 'super_admin'), require('./routes/advances'));
app.use('/api/clawbacks', requireRole('admin', 'super_admin'), require('./routes/clawbacks'));
app.use('/api/referrals', requireRole('admin', 'super_admin'), require('./routes/referrals'));
app.use('/api/audit', requireRole('super_admin'), require('./routes/audit'));
app.use('/api/dashboard', requireRole('admin', 'super_admin'), require('./routes/dashboard'));
app.use('/api/admins', requireRole('super_admin'), require('./routes/admins'));
app.use('/api/pay-runs', requireRole('admin', 'super_admin'), require('./routes/payRuns'));
app.use('/api/myjobs', requireRole('sales_rep'), require('./routes/myjobs'));
app.use('/api/mypayroll', requireRole('payroll_staff'), require('./routes/mypayroll'));

for (const page of ['board', 'deal', 'adders-report', 'dashboard', 'monthly', 'reps', 'rep-dashboard', 'rep-job-view', 'payroll-staff', 'staff-dashboard', 'installers', 'settings', 'advances', 'clawbacks', 'referrals', 'pay-runs', 'pay-run']) {
  app.get(`/admin/${page}.html`, guardPage(`admin/${page}.html`, 'admin', 'super_admin'));
}
app.get('/admin/admins.html', guardPage('admin/admins.html', 'super_admin'));
app.get('/admin/audit.html', guardPage('admin/audit.html', 'super_admin'));
for (const page of ['dashboard', 'jobs', 'job', 'commissions', 'profile']) {
  app.get(`/rep/${page}.html`, guardPage(`rep/${page}.html`, 'sales_rep'));
}
for (const page of ['dashboard', 'profile']) {
  app.get(`/staff/${page}.html`, guardPage(`staff/${page}.html`, 'payroll_staff'));
}

app.get('/', (req, res) => {
  if (req.isAuthenticated()) return res.redirect(homePathFor(req.user));
  res.redirect('/login.html');
});

app.get('/change-password.html', (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'change-password.html'));
});

// Static assets (CSS/JS/SVG/login page, etc.) — registered LAST so it never has a chance to
// serve a protected .html page directly. Every protected page above is matched by its own
// guarded route first; this only ever serves what nothing above already claimed.
app.use(express.static(path.join(__dirname, 'public')));

async function start() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`\nPOWERED Commissions running at http://localhost:${PORT}\n`);
  });
  // Keep the Turso connection alive. Without this, the WebSocket connection drops after
  // ~5 minutes of idle and the next request pays a multi-second reconnect penalty.
  const { get: dbPing } = require('./db/client');
  setInterval(() => { dbPing('SELECT 1').catch(() => {}); }, 4 * 60 * 1000);
}

start().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
