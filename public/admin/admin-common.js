const NAV_ITEMS = [
  { section: 'Overview' },
  { href: '/admin/dashboard.html', label: '📊 Dashboard' },
  { href: '/admin/monthly.html', label: '📅 Monthly' },
  { section: 'Deals' },
  { href: '/admin/board.html', label: '📋 Deals Board' },
  { href: '/admin/adders-report.html', label: '🧾 Adders Report' },
  { section: 'People' },
  { href: '/admin/reps.html', label: '🧑‍💼 Sales Reps' },
  { href: '/admin/payroll-staff.html', label: '🧾 Payroll Staff' },
  { section: 'Money' },
  { href: '/admin/pay-runs.html', label: '🧮 Run Commission' },
  { href: '/admin/advances.html', label: '💸 Advances' },
  { href: '/admin/clawbacks.html', label: '↩️ Clawbacks' },
  { href: '/admin/referrals.html', label: '🤝 Referrals' },
  { section: 'Configuration' },
  { href: '/admin/settings.html', label: '⚙️ Commission Rules' },
  { href: '/admin/installers.html', label: '🏗️ Installers & Financiers' },
  { href: '/admin/admins.html', label: '🔐 Admins', superAdminOnly: true },
  { href: '/admin/audit.html', label: '🕓 Audit Log', superAdminOnly: true }
];

function injectFavicon() {
  const link = document.createElement('link');
  link.rel = 'icon';
  link.href = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='6' fill='%2315131A'/%3E%3Cpath d='M13 2 L6 14 H11 L9 22 L18 9 H12 Z' fill='%236B3FD4'/%3E%3C/svg%3E";
  document.head.appendChild(link);
}
injectFavicon();

function renderAdminShell(activeHref, pageTitle) {
  const navHtml = NAV_ITEMS.map((item) => {
    if (item.section) return `<div class="section-label">${item.section}</div>`;
    const active = item.href === activeHref ? 'active' : '';
    const hidden = item.superAdminOnly ? 'style="display:none;" data-super-admin-only="1"' : '';
    return `<a href="${item.href}" class="${active}" ${hidden}>${item.label}</a>`;
  }).join('');

  document.body.insertAdjacentHTML('afterbegin', `
    <div class="app-shell">
      <div class="sidebar-backdrop" id="sidebarBackdrop"></div>
      <aside class="sidebar" id="sidebar">
        <div class="brand-logo"><img src="/shared/logo-white.svg" alt="POWERED"></div>
        <nav>${navHtml}</nav>
      </aside>
      <div class="main-area">
        <div class="topbar">
          <div style="display:flex; align-items:center; gap:12px;">
            <button class="icon-btn menu-toggle" id="menuToggle" aria-label="Menu">☰</button>
            <h1>${pageTitle}</h1>
          </div>
          <div class="user-chip">
            <span id="userEmail"></span>
            <button class="btn secondary small" id="logoutBtn">Log out</button>
          </div>
        </div>
        <div class="page-content" id="pageContent"></div>
      </div>
    </div>
  `);

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  document.getElementById('menuToggle').addEventListener('click', () => {
    sidebar.classList.toggle('open');
    backdrop.classList.toggle('show');
  });
  backdrop.addEventListener('click', () => {
    sidebar.classList.remove('open');
    backdrop.classList.remove('show');
  });

  fetch('/api/auth/me').then((r) => r.json()).then((me) => {
    document.getElementById('userEmail').textContent = me.email || '';
    if (me.role === 'super_admin') {
      document.querySelectorAll('[data-super-admin-only]').forEach((el) => { el.style.display = ''; });
    }
  }).catch(() => {});
}

function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '—';
  const num = Number(n);
  const sign = num < 0 ? '-' : '';
  return `${sign}$${Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (e) { return d; }
}

// headers: array of column names. rows: array of arrays, same column order as headers.
// Values are coerced to strings and CSV-escaped (quoted whenever they contain a comma, quote,
// or newline) — this is the one shared place that escaping happens, so every export page gets
// it right instead of each one rolling its own.
function downloadCsv(filename, headers, rows) {
  const escapeCell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
