const runId = new URLSearchParams(window.location.search).get('id');
let DATA = null;

function statusBadge(status) {
  const map = { draft: 'muted', submitted: 'amber', approved: 'green', paid: 'green', rejected: 'muted' };
  return `<span class="badge ${map[status] || 'muted'}">${status}</span>`;
}

async function load() {
  DATA = await api('GET', `/api/pay-runs/${runId}`);
  document.querySelector('.topbar h1').textContent = `Pay Run — ${fmtDate(DATA.payRun.pay_period_date)}`;
  render();
}

function render() {
  const d = DATA;
  document.getElementById('pageContent').innerHTML = `
    <div class="card" style="margin-bottom:20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div class="field-row" style="flex:1;">
          <div><label>Pay Period Date</label><input type="date" id="hdr_date" value="${d.payRun.pay_period_date}"></div>
          <div><label>Notes</label><input type="text" id="hdr_notes" value="${(d.payRun.notes || '').replace(/"/g, '&quot;')}"></div>
        </div>
        <div style="text-align:right;">${statusBadge(d.payRun.status)}<div style="margin-top:8px;"><button class="btn secondary small" id="saveHdrBtn" style="width:auto;">Save</button></div></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px;">
      <p class="section-title">Section 1 · Rep Commissions <span style="font-weight:400; text-transform:none; font-size:12px;">(Closer &amp; Setter pay)</span></p>
      <table class="data-table"><thead><tr><th>Rep</th><th>Customer</th><th>Role</th><th>Net Payable</th><th></th></tr></thead>
      <tbody id="repRows"></tbody></table>
      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn secondary small" id="addRepCandidatesBtn" style="width:auto;">+ Add Deals</button>
        <button class="btn secondary small" id="addWeeklyRepBtn" style="width:auto;">+ Add Weekly-Pay Rep</button>
        <button class="btn secondary small" id="addAdhocBtn" style="width:auto;">+ Add Flat Pay (e.g. weekly contractor)</button>
      </div>
      <div id="repCandidatesPanel" style="display:none; margin-top:10px;"></div>
      <div id="weeklyRepPanel" style="display:none; margin-top:10px;"></div>
      <div id="adhocForm" style="display:none; margin-top:10px;"></div>
      <div class="calc-line total" style="margin-top:10px;"><span class="lbl">REP TOTAL</span><span class="val">${fmtMoney(d.sections.rep.total)}</span></div>
    </div>

    <div class="card" style="margin-bottom:20px;">
      <p class="section-title">Section 2 · Distribution — Noy</p>
      <table class="data-table"><thead><tr><th>Customer</th><th>M1 ($500)</th><th>M2 ($500)</th><th>Total</th></tr></thead>
      <tbody id="noyRows"></tbody></table>
      <button class="btn secondary small" id="addNoyCandidatesBtn" style="width:auto; margin-top:10px;">+ Add Deals</button>
      <div id="noyCandidatesPanel" style="display:none; margin-top:10px;"></div>
      <div class="calc-line total" style="margin-top:10px;"><span class="lbl">TOTAL TO NOY</span><span class="val">${fmtMoney(d.sections.noy.total)}</span></div>
    </div>

    <div class="card" style="margin-bottom:20px;">
      <p class="section-title">Section 3 · Distribution — Etai</p>
      <table class="data-table"><thead><tr><th>Customer</th><th>M1 ($500)</th><th>M2 ($500)</th><th>Total</th></tr></thead>
      <tbody id="etaiRows"></tbody></table>
      <button class="btn secondary small" id="addEtaiCandidatesBtn" style="width:auto; margin-top:10px;">+ Add Deals</button>
      <div id="etaiCandidatesPanel" style="display:none; margin-top:10px;"></div>
      <div class="calc-line total" style="margin-top:10px;"><span class="lbl">TOTAL TO ETAI</span><span class="val">${fmtMoney(d.sections.etai.total)}</span></div>
    </div>

    <div class="card" style="margin-bottom:20px;">
      <p class="section-title">Section 4 · Joey's Weekly Pay and Bonus</p>
      <table class="data-table"><thead><tr><th>Customer</th><th>Net PPW</th><th>Bonus</th></tr></thead>
      <tbody id="joeyRows"></tbody></table>
      <button class="btn secondary small" id="addJoeyCandidatesBtn" style="width:auto; margin-top:10px;">+ Add Deals</button>
      <div id="joeyCandidatesPanel" style="display:none; margin-top:10px;"></div>
      <div class="calc-line" style="margin-top:10px;"><span class="lbl">Weekly Salary (Fixed)</span><span class="val">${fmtMoney(d.sections.joey.weeklySalary)}</span></div>
      <div class="calc-line total"><span class="lbl">TOTAL TO JOEY</span><span class="val">${fmtMoney(d.sections.joey.total)}</span></div>
    </div>

    <div class="card" style="margin-bottom:20px;">
      <p class="section-title">Section 5 · Austin <span style="font-weight:400; text-transform:none; font-size:12px;">(linked by Solar Date — kW × $${d.sections.austin.ratePerKw}/kW, vs. $${d.sections.austin.base} base)</span></p>
      <table class="data-table"><thead><tr><th>Customer</th><th>Solar Date</th><th>kW</th><th>kW × Rate</th><th></th></tr></thead>
      <tbody id="austinRows"></tbody></table>
      <button class="btn secondary small" id="addAustinCandidatesBtn" style="width:auto; margin-top:10px;">+ Add Jobs</button>
      <div id="austinCandidatesPanel" style="display:none; margin-top:10px;"></div>
      <div class="calc-line" style="margin-top:10px;"><span class="lbl">Total kW Linked</span><span class="val">${d.sections.austin.totalKw} kW</span></div>
      <div class="calc-line"><span class="lbl">Base ($${d.sections.austin.base}) vs. Top-Up</span><span class="val">${fmtMoney(d.sections.austin.topUp)} top-up</span></div>
      <div class="calc-line total"><span class="lbl">TOTAL TO AUSTIN</span><span class="val">${fmtMoney(d.sections.austin.total)}</span></div>
    </div>

    <div class="detail-grid">
      <div class="card" style="margin-bottom:20px;">
        <p class="section-title">Summary — Totals by Recipient</p>
        <div id="summaryByRecipient"></div>
        <div class="calc-line total" style="margin-top:10px;"><span class="lbl">GRAND TOTAL</span><span class="val">${fmtMoney(d.grandTotal)}</span></div>
      </div>
      <div class="card" style="margin-bottom:20px;">
        <p class="section-title">Approval Log</p>
        <div id="approvalLog" style="margin-bottom:12px;"></div>
        <label>Status</label>
        <select id="ap_status">
          <option value="submitted">Submitted (awaiting approval)</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <label>Approved By</label><input type="text" id="ap_by" placeholder="Etai">
        <label>Notes</label><input type="text" id="ap_notes">
        <button class="btn secondary small" id="addApprovalBtn" style="width:auto;">Log Entry</button>
      </div>
    </div>

    <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:10px;">
      <button class="btn secondary small" id="backBtn" style="width:auto;">Back to Pay Runs</button>
      <button class="btn small" id="finalizeBtn" style="width:auto;">Finalize — Mark All Paid</button>
    </div>
  `;

  renderSection('rep', 'repRows', d.sections.rep.rows, d.sections.rep.adhoc);
  renderOwnerSection('noy', 'noyRows', d.sections.noy.rows);
  renderOwnerSection('etai', 'etaiRows', d.sections.etai.rows);
  renderJoeySection(d.sections.joey.rows);
  renderAustinSection(d.sections.austin.rows);

  document.getElementById('summaryByRecipient').innerHTML = d.summaryByRecipient.length === 0
    ? '<p style="color:var(--brand-muted); font-size:13px;">Nothing included yet.</p>'
    : d.summaryByRecipient.map((r) => `<div class="calc-line"><span class="lbl">${r.name}</span><span class="val">${fmtMoney(r.total)}</span></div>`).join('');

  document.getElementById('approvalLog').innerHTML = d.approvals.length === 0
    ? '<p style="color:var(--brand-muted); font-size:13px;">No approval activity logged yet.</p>'
    : d.approvals.map((a) => `
      <div class="audit-item">
        ${statusBadge(a.status)} by <strong>${a.approved_by || '—'}</strong>
        <div class="meta">${new Date(a.created_at).toLocaleString()}${a.notes ? ' · ' + a.notes : ''}</div>
      </div>
    `).join('');

  wireEvents();
}

function renderSection(type, tbodyId, rows, adhocRows) {
  let html = rows.map((r) => `
    <tr>
      <td>${r.repName}</td>
      <td>${r.customerName}<br><span style="color:var(--brand-muted); font-size:12px;">${r.customerAddress || ''}</span></td>
      <td>${r.role}</td>
      <td>${fmtMoney(r.netPayable)}</td>
      <td><button class="icon-btn remove-inc" data-deal="${r.dealId}" data-type="${r.role.toLowerCase()}">✕</button></td>
    </tr>
  `).join('');
  html += (adhocRows || []).map((a) => `
    <tr>
      <td>${a.recipient_name}</td>
      <td colspan="2" style="color:var(--brand-muted); font-size:12px;">Flat pay — ${a.notes || ''}</td>
      <td>${fmtMoney(a.amount)}</td>
      <td><button class="icon-btn remove-adhoc" data-id="${a.id}">✕</button></td>
    </tr>
  `).join('');
  document.getElementById(tbodyId).innerHTML = html || '<tr><td colspan="5" style="text-align:center; color:var(--brand-muted); padding:16px;">Nothing included yet.</td></tr>';
}

function renderOwnerSection(type, tbodyId, rows) {
  document.getElementById(tbodyId).innerHTML = rows.length === 0
    ? '<tr><td colspan="4" style="text-align:center; color:var(--brand-muted); padding:16px;">Nothing included yet.</td></tr>'
    : rows.map((r) => `
      <tr>
        <td>${r.customerName}<br><span style="color:var(--brand-muted); font-size:12px;">${r.customerAddress || ''}</span></td>
        <td>${fmtMoney(r.m1)}</td>
        <td>${fmtMoney(r.m2)}</td>
        <td>${fmtMoney(r.m1 + r.m2)} <button class="icon-btn remove-inc" data-deal="${r.dealId}" data-type="${type}">✕</button></td>
      </tr>
    `).join('');
}

function renderJoeySection(rows) {
  document.getElementById('joeyRows').innerHTML = rows.length === 0
    ? '<tr><td colspan="3" style="text-align:center; color:var(--brand-muted); padding:16px;">Nothing included yet.</td></tr>'
    : rows.map((r) => `
      <tr>
        <td>${r.customerName}<br><span style="color:var(--brand-muted); font-size:12px;">${r.customerAddress || ''}</span></td>
        <td>${r.netPpw ?? '—'}</td>
        <td>${fmtMoney(r.bonus)} <button class="icon-btn remove-inc" data-deal="${r.dealId}" data-type="joey">✕</button></td>
      </tr>
    `).join('');
}

function renderAustinSection(rows) {
  document.getElementById('austinRows').innerHTML = rows.length === 0
    ? '<tr><td colspan="5" style="text-align:center; color:var(--brand-muted); padding:16px;">Nothing linked yet.</td></tr>'
    : rows.map((r) => `
      <tr>
        <td>${r.customerName}<br><span style="color:var(--brand-muted); font-size:12px;">${r.customerAddress || ''}</span></td>
        <td>${fmtDate(r.solarDate)}</td>
        <td><input type="number" step="0.01" class="austin-kw-input" data-deal="${r.dealId}" value="${r.kw}" style="margin:0; max-width:90px;"></td>
        <td>${fmtMoney(r.lineAmount)}</td>
        <td><button class="icon-btn remove-inc" data-deal="${r.dealId}" data-type="austin">✕</button></td>
      </tr>
    `).join('');
  document.querySelectorAll('.austin-kw-input').forEach((input) => {
    input.addEventListener('change', async () => {
      try {
        DATA = await api('PUT', `/api/pay-runs/${runId}/deals/${input.dataset.deal}/austin-kw`, { kw: input.value === '' ? null : parseFloat(input.value) });
        render();
      } catch (e) { alert(e.message); }
    });
  });
}

function candidatePanelHtml(candidates, type) {
  if (candidates.length === 0) return '<p style="color:var(--brand-muted); font-size:13px;">No eligible deals right now.</p>';

  if (type === 'rep') {
    // Closer and setter are independent here too — a deal can offer either, both, or neither
    // checkbox depending on what's actually approved-and-unpaid for each role.
    return `
      <div class="card" style="background:var(--brand-bg);">
        ${candidates.map((c) => {
          const inc = DATA.included[c.id] || {};
          let row = `<div style="padding:6px 0; border-bottom:1px solid var(--brand-border);">
            <div style="font-weight:600;">${c.customer_name} <span style="color:var(--brand-muted); font-weight:400; font-size:12px;">${c.customer_address || ''}</span></div>
            <div style="display:flex; gap:16px; margin-top:4px;">`;
          if (c.closer_rep_id && c.closer_breakdown_approved && !c.closer_paid) {
            row += `<label style="display:flex; align-items:center; gap:6px; font-weight:400;">
              <input type="checkbox" class="candidate-cb" data-deal="${c.id}" data-type="closer" ${inc.include_closer ? 'checked' : ''} style="width:auto;">
              Closer (${c.closer_display || c.closer_name}) — ${fmtMoney(c.closer_pay_net)}
            </label>`;
          }
          if (c.setter_rep_id && c.setter_breakdown_approved && !c.setter_paid) {
            row += `<label style="display:flex; align-items:center; gap:6px; font-weight:400;">
              <input type="checkbox" class="candidate-cb" data-deal="${c.id}" data-type="setter" ${inc.include_setter ? 'checked' : ''} style="width:auto;">
              Setter (${c.setter_display || c.setter_name}) — ${fmtMoney(c.setter_pay)}
            </label>`;
          }
          row += `</div></div>`;
          return row;
        }).join('')}
        <button class="btn small candidate-apply" data-type="rep" style="width:auto; margin-top:8px;">Apply</button>
      </div>
    `;
  }

  const includeKey = `include_${type}`;
  return `
    <div class="card" style="background:var(--brand-bg);">
      ${candidates.map((c) => {
        const already = DATA.included[c.id] && DATA.included[c.id][includeKey];
        return `<label style="display:flex; align-items:center; gap:8px; padding:4px 0; font-weight:400;">
          <input type="checkbox" class="candidate-cb" data-deal="${c.id}" data-type="${type}" ${already ? 'checked' : ''} style="width:auto;">
          ${c.customer_name} <span style="color:var(--brand-muted); font-size:12px;">${c.customer_address || ''}</span>
        </label>`;
      }).join('')}
      <button class="btn small candidate-apply" data-type="${type}" style="width:auto; margin-top:8px;">Apply</button>
    </div>
  `;
}

function wireEvents() {
  document.getElementById('saveHdrBtn').addEventListener('click', async () => {
    try {
      await api('PUT', `/api/pay-runs/${runId}`, {
        pay_period_date: document.getElementById('hdr_date').value,
        notes: document.getElementById('hdr_notes').value.trim() || null
      });
      load();
    } catch (e) { alert(e.message); }
  });

  const togglePanel = (btnId, panelId, candidates, type) => {
    document.getElementById(btnId).addEventListener('click', () => {
      const panel = document.getElementById(panelId);
      if (panel.style.display === 'none') {
        panel.innerHTML = candidatePanelHtml(candidates, type);
        panel.style.display = 'block';
        wireCandidatePanel(panel);
      } else {
        panel.style.display = 'none';
      }
    });
  };
  togglePanel('addRepCandidatesBtn', 'repCandidatesPanel', DATA.candidates.repCandidates, 'rep');
  togglePanel('addNoyCandidatesBtn', 'noyCandidatesPanel', DATA.candidates.noyCandidates, 'noy');
  togglePanel('addEtaiCandidatesBtn', 'etaiCandidatesPanel', DATA.candidates.etaiCandidates, 'etai');
  togglePanel('addJoeyCandidatesBtn', 'joeyCandidatesPanel', DATA.candidates.joeyCandidates, 'joey');
  togglePanel('addAustinCandidatesBtn', 'austinCandidatesPanel', DATA.candidates.austinCandidates, 'austin');

  document.getElementById('addWeeklyRepBtn').addEventListener('click', () => {
    const panel = document.getElementById('weeklyRepPanel');
    if (panel.style.display === 'none') {
      const candidates = DATA.candidates.weeklyRepCandidates;
      panel.innerHTML = candidates.length === 0
        ? '<p style="color:var(--brand-muted); font-size:13px;">No reps are set to Weekly Pay. Set that on a rep\'s profile under Sales Reps.</p>'
        : `<div class="card" style="background:var(--brand-bg);">
            ${candidates.map((c) => {
              const existing = DATA.adhoc.find((a) => a.rep_id === c.id);
              return `<div style="display:flex; align-items:center; gap:8px; padding:4px 0;">
                <input type="checkbox" class="weekly-rep-cb" data-rep="${c.id}" data-name="${c.display_name || c.full_name}" data-amount="${c.weekly_amount || 0}" ${existing ? 'checked' : ''} style="width:auto;">
                <span style="flex:1;">${c.display_name || c.full_name}</span>
                <span style="color:var(--brand-muted); font-size:12px;">${fmtMoney(c.weekly_amount)}/wk</span>
              </div>`;
            }).join('')}
            <button class="btn small" id="weeklyRepApplyBtn" style="width:auto; margin-top:8px;">Apply</button>
          </div>`;
      panel.style.display = 'block';
      if (candidates.length) {
        document.getElementById('weeklyRepApplyBtn').addEventListener('click', async () => {
          try {
            for (const cb of panel.querySelectorAll('.weekly-rep-cb')) {
              const existing = DATA.adhoc.find((a) => a.rep_id === Number(cb.dataset.rep));
              if (cb.checked && !existing) {
                DATA = await api('POST', `/api/pay-runs/${runId}/adhoc`, { recipient_name: cb.dataset.name, amount: Number(cb.dataset.amount), rep_id: Number(cb.dataset.rep), notes: 'Weekly Pay' });
              } else if (!cb.checked && existing) {
                DATA = await api('DELETE', `/api/pay-runs/${runId}/adhoc/${existing.id}`);
              }
            }
            render();
          } catch (e) { alert(e.message); }
        });
      }
    } else {
      panel.style.display = 'none';
    }
  });

  document.querySelectorAll('.remove-inc').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const field = `include_${btn.dataset.type}`;
      try {
        DATA = await api('POST', `/api/pay-runs/${runId}/deals/${btn.dataset.deal}`, { [field]: false });
        render();
      } catch (e) { alert(e.message); }
    });
  });

  document.getElementById('addAdhocBtn').addEventListener('click', () => {
    const box = document.getElementById('adhocForm');
    box.style.display = box.style.display === 'none' ? 'block' : 'none';
    box.innerHTML = `
      <div class="field-row cols-3">
        <div><label>Recipient Name</label><input type="text" id="ah_name"></div>
        <div><label>Amount ($)</label><input type="number" step="0.01" id="ah_amount"></div>
        <div><label>Note</label><input type="text" id="ah_notes" placeholder="e.g. Weekly Pay"></div>
      </div>
      <button class="btn small" id="saveAdhocBtn" style="width:auto;">Add</button>
    `;
    document.getElementById('saveAdhocBtn').addEventListener('click', async () => {
      const recipient_name = document.getElementById('ah_name').value.trim();
      const amount = parseFloat(document.getElementById('ah_amount').value);
      if (!recipient_name || isNaN(amount)) { alert('Name and amount are required.'); return; }
      try {
        DATA = await api('POST', `/api/pay-runs/${runId}/adhoc`, { recipient_name, amount, notes: document.getElementById('ah_notes').value.trim() || null });
        render();
      } catch (e) { alert(e.message); }
    });
  });

  document.querySelectorAll('.remove-adhoc').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try { DATA = await api('DELETE', `/api/pay-runs/${runId}/adhoc/${btn.dataset.id}`); render(); } catch (e) { alert(e.message); }
    });
  });

  document.getElementById('addApprovalBtn').addEventListener('click', async () => {
    try {
      DATA = await api('POST', `/api/pay-runs/${runId}/approval`, {
        status: document.getElementById('ap_status').value,
        approved_by: document.getElementById('ap_by').value.trim() || null,
        notes: document.getElementById('ap_notes').value.trim() || null
      });
      render();
    } catch (e) { alert(e.message); }
  });

  document.getElementById('finalizeBtn').addEventListener('click', async () => {
    if (!confirm('Mark every included rep/owner/Joey item as paid, dated to this pay period? This updates the underlying deals and cannot be undone.')) return;
    try {
      DATA = await api('POST', `/api/pay-runs/${runId}/finalize`, {});
      render();
      alert('Pay run finalized — all included items marked as paid.');
    } catch (e) { alert(e.message); }
  });

  document.getElementById('backBtn').addEventListener('click', () => { window.location.href = '/admin/pay-runs.html'; });
}

function wireCandidatePanel(panel) {
  panel.querySelector('.candidate-apply').addEventListener('click', async () => {
    // Each checkbox carries its own data-type (closer/setter/etai/noy/joey) — using that
    // directly, rather than one type for the whole panel, is what keeps closer and setter
    // independent on the rep picker.
    const checkboxes = panel.querySelectorAll('.candidate-cb');
    try {
      for (const cb of checkboxes) {
        const field = `include_${cb.dataset.type}`;
        await api('POST', `/api/pay-runs/${runId}/deals/${cb.dataset.deal}`, { [field]: cb.checked });
      }
      DATA = await api('GET', `/api/pay-runs/${runId}`);
      render();
    } catch (e) { alert(e.message); }
  });
}

load();
