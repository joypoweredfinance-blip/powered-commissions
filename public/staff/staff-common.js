const STAFF_TABS = [
  { href: '/staff/dashboard.html', icon: '🏠', label: 'Dashboard' },
  { href: '/staff/profile.html', icon: '👤', label: 'Profile' }
];

function injectFavicon() {
  const link = document.createElement('link');
  link.rel = 'icon';
  link.href = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='6' fill='%2315131A'/%3E%3Cpath d='M13 2 L6 14 H11 L9 22 L18 9 H12 Z' fill='%236B3FD4'/%3E%3C/svg%3E";
  document.head.appendChild(link);
}
injectFavicon();

function renderStaffShell(activeHref) {
  const tabsHtml = STAFF_TABS.map((t) => `
    <a href="${t.href}" class="tab ${t.href === activeHref ? 'active' : ''}">
      <span class="ico">${t.icon}</span><span>${t.label}</span>
    </a>
  `).join('');

  document.body.insertAdjacentHTML('afterbegin', `
    <div class="rep-shell">
      <header class="rep-header">
        <div class="brand-logo"><img src="/shared/logo.svg" alt="POWERED"></div>
        <button class="icon-btn" id="logoutBtn" title="Log out">⎋</button>
      </header>
      <main class="rep-content" id="pageContent"></main>
      <nav class="rep-tabbar">${tabsHtml}</nav>
    </div>
  `);

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });
}

function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '—';
  const num = Number(n);
  const sign = num < 0 ? '-' : '';
  return `${sign}$${Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch (e) { return d; }
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
