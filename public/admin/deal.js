const params = new URLSearchParams(window.location.search);
const dealId = params.get('id');
let META = null;
let DEAL = null;
let SETTINGS = null;

function val(id) { const el = document.getElementById(id); return el ? el.value : null; }
function intval(id) { const v = val(id); return v === '' || v === null ? null : Number(v); }
function floatval(id) { const v = val(id); return v === '' || v === null ? null : parseFloat(v); }
function checked(id) { const el = document.getElementById(id); return el ? el.checked : false; }
function dateOrNull(v) { return v || null; }
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

async function guardedClick(button, busyLabel, fn) {
  if (button.disabled) return;
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    await fn();
  } finally {
    if (document.body.contains(button)) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}

function repOptions(type, selected) {
  let html = `<option value="">${type === 'setter' ? '— None —' : '— Select —'}</option>`;
  META.reps.forEach((r) => {
    html += `<option value="${r.id}" ${String(r.id) === String(selected) ? 'selected' : ''}>${r.display_name || r.full_name}</option>`;
  });
  return html;
}
function populateDropdownSelect(elId, category, currentValue) {
  const options = (META.dropdownOptions && META.dropdownOptions[category]) || [];
  const el = document.getElementById(elId);
  let html = `<option value="">— Select —</option>`;
  let hasCurrent = !currentValue;
  for (const opt of options) {
    if (opt.value === currentValue) hasCurrent = true;
    html += `<option value="${opt.value}" ${opt.value === currentValue ? 'selected' : ''}>${opt.value}</option>`;
  }
  if (!hasCurrent) html += `<option value="${currentValue}" selected>${currentValue}</option>`;
  el.innerHTML = html;
}

const FUNDING_STATUSES = [
  'Advance 1 Pending', 'Advance 2 Pending', 'M1 Funds Pending', 'M2 Funds Pending',
  '100% Funded', 'Clawback'
];
const ADDER_CATEGORY_LABELS = { mpu: 'MPU', battery: 'Battery', reroof_sow: 'Roof Costs', permit: 'Permit', misc: 'Miscellaneous', other: 'Other' };

function selectOptions(list, selected, placeholder, labelKey = 'label') {
  let html = `<option value="">${placeholder}</option>`;
  list.forEach((item) => {
    html += `<option value="${item.id}" ${String(item.id) === String(selected) ? 'selected' : ''}>${item[labelKey] || item.name}</option>`;
  });
  return html;
}

// --- Per-section display/edit state ---
const EDITING = new Set();
const EDITING_ADDER = new Set();

// Display-mode helpers
function dv(v) { return (v === null || v === undefined || v === '') ? '—' : String(v); }
function dm(v) { return (v === null || v === undefined || v === '') ? '—' : fmtMoney(v); }
function dd(v) { return v ? fmtDate(v.slice(0, 10)) : '—'; }
function fdi(label, value) {
  return `<div class="fd-item"><div class="fdl">${label}</div><div class="fdv">${value}</div></div>`;
}
function sectionSaveBtns(key) {
  return `<div style="display:flex; gap:8px; margin-top:16px;">
    <button class="btn small" style="width:auto;" onclick="saveSection('${key}')">Save</button>
    <button class="btn secondary small" style="width:auto;" onclick="cancelEdit('${key}')">Cancel</button>
  </div>`;
}

// --- Section edit mode control ---
function startEdit(key) { EDITING.add(key); renderSectionById(key); }
function cancelEdit(key) { EDITING.delete(key); renderSectionById(key); }
function renderSectionById(key) {
  if (key === 'project') renderProjectDetails();
  else if (key === 'finance') renderSystemFinance();
  else if (key === 'milestones') renderMilestoneDates();
  else if (key === 'notes') renderAdminNotes();
  else if (key === 'funds') renderFundsReceived();
  else if (key === 'payment') renderPayment();
  else if (key === 'estimate') renderOriginalEstimate();
  else if (key === 'adders') renderAdders();
}

async function saveSection(key) {
  let data = {};
  if (key === 'project') {
    data = {
      customer_name: val('f_customer_name'),
      customer_address: val('f_customer_address'),
      status_id: intval('f_status_id'),
      funding_status: val('f_funding_status') || null,
      funding_status_override: val('f_funding_status_override') || null,
      closer_rep_id: intval('f_closer_rep_id') || null,
      setter_rep_id: intval('f_setter_rep_id') || null,
      install_1_date: dateOrNull(val('f_install_1_date')),
      install_date: dateOrNull(val('f_install_date')),
      install_completed_date: dateOrNull(val('f_install_completed_date')),
      roof_date: dateOrNull(val('f_roof_date')),
    };
  } else if (key === 'finance') {
    data = {
      installer_id: intval('f_installer_id') || null,
      financier_id: intval('f_financier_id') || null,
      date_signed: dateOrNull(val('f_date_signed')),
      module_type: val('f_module_type'),
      battery_type: val('f_battery_type'),
      num_batteries: intval('f_num_batteries'),
      system_size_kw: floatval('f_system_size_kw'),
      panel_count: intval('f_panel_count'),
      panel_watts: floatval('f_panel_watts'),
      annual_production_kwh: floatval('f_annual_production_kwh'),
      contract_value: floatval('f_contract_value'),
      epc_rate_per_watt: floatval('f_epc_rate_per_watt'),
      monthly_payment: floatval('f_monthly_payment'),
      rate_per_kwh: floatval('f_rate_per_kwh'),
      escalator_pct: floatval('f_escalator_pct'),
      cashback_amount: floatval('f_cashback_amount') ?? 0,
      is_referral: checked('f_is_referral') ? 1 : 0,
      pay_split: floatval('f_pay_split'),
    };
  } else if (key === 'milestones') {
    data = {
      ntp_approved_date: dateOrNull(val('f_ntp_approved_date')),
      m1_approved_date: dateOrNull(val('f_m1_approved_date')),
      m1_paid_date: dateOrNull(val('f_m1_paid_date')),
      pto_granted_date: dateOrNull(val('f_pto_granted_date')),
      m2_approved_date: dateOrNull(val('f_m2_approved_date')),
      m2_paid_date: dateOrNull(val('f_m2_paid_date')),
    };
  } else if (key === 'notes') {
    const updatedReasons = (() => { try { return JSON.parse(DEAL.field_override_reasons || '{}'); } catch (e) { return {}; } })();
    document.querySelectorAll('.override-reason-input').forEach((inp) => { updatedReasons[inp.dataset.field] = inp.value; });
    data = { admin_notes: val('f_admin_notes'), field_override_reasons: JSON.stringify(updatedReasons) };
  }

  // Optimistically apply field values and close edit mode immediately — the UI feels
  // instant. The server request runs in the background and the authoritative response
  // (with computed fields, join names, audit log) is applied when it arrives.
  const prevDeal = DEAL;
  DEAL = { ...DEAL, ...data };
  EDITING.delete(key);
  function rerenderSection() {
    renderSectionById(key);
    if (key === 'project') {
      document.querySelector('.topbar h1').textContent = DEAL.customer_name;
      renderSetterCalc();
      renderApproval();
      renderPayment();
    }
    if (key === 'finance') renderCalc();
    if (key === 'milestones') renderCalc();
  }
  rerenderSection();

  try {
    const updated = await api('PUT', `/api/deals/${dealId}`, data);
    DEAL = updated;
    rerenderSection();
    renderAudit();
  } catch (e) {
    DEAL = prevDeal;
    EDITING.add(key);
    rerenderSection();
    alert(e.message);
  }
}

// --- Section renderers ---

function renderProjectDetails() {
  const d = DEAL;
  const el = document.getElementById('card-project');
  if (EDITING.has('project')) {
    const fsOptions = FUNDING_STATUSES.map((s) => `<option value="${s}" ${s === d.funding_status ? 'selected' : ''}>${s}</option>`).join('');
    el.innerHTML = `<div class="card" style="margin-bottom:20px;">
      <p class="section-title">Project Details</p>
      <div class="field-row">
        <div><label>Customer Name</label><input type="text" id="f_customer_name" value="${(d.customer_name || '').replace(/"/g, '&quot;')}"></div>
        <div><label>Customer Address</label><input type="text" id="f_customer_address" value="${(d.customer_address || '').replace(/"/g, '&quot;')}"></div>
      </div>
      <div class="field-row">
        <div><label>CRM Status</label><select id="f_status_id">${selectOptions(META.statuses, d.status_id, 'No status')}</select></div>
        <div><label>Roof Date</label><input type="date" id="f_roof_date" value="${(d.roof_date || '').slice(0, 10)}"></div>
      </div>
      <div class="field-row">
        <div><label>Funding Status</label><select id="f_funding_status"><option value="">— Select —</option>${fsOptions}</select></div>
        <div><label>Funding Status Override <span style="font-weight:400; text-transform:none; font-size:12px; color:var(--brand-muted);">(takes precedence if filled in)</span></label>
          <input type="text" id="f_funding_status_override" value="${(d.funding_status_override || '').replace(/"/g, '&quot;')}" placeholder="leave blank to use dropdown"></div>
      </div>
      <div class="field-row">
        <div><label>Closer</label><select id="f_closer_rep_id">${repOptions('closer', d.closer_rep_id)}</select></div>
        <div><label>Setter (optional)</label><select id="f_setter_rep_id">${repOptions('setter', d.setter_rep_id)}</select></div>
      </div>
      <div class="field-row cols-3">
        <div><label>Install 1 Date</label><input type="date" id="f_install_1_date" value="${(d.install_1_date || '').slice(0, 10)}"></div>
        <div><label>Install Completed Date</label><input type="date" id="f_install_date" value="${(d.install_date || '').slice(0, 10)}"></div>
        <div><label>Solar Date</label><input type="date" id="f_install_completed_date" value="${(d.install_completed_date || '').slice(0, 10)}"></div>
      </div>
      ${sectionSaveBtns('project')}
    </div>`;
  } else {
    const closer = META.reps.find((r) => String(r.id) === String(d.closer_rep_id));
    const setter = META.reps.find((r) => String(r.id) === String(d.setter_rep_id));
    const status = META.statuses.find((s) => String(s.id) === String(d.status_id));
    const effectiveFunding = d.funding_status_override || d.funding_status;
    el.innerHTML = `<div class="card" style="margin-bottom:20px;">
      <div class="section-header">
        <p class="section-title">Project Details</p>
        <button class="btn secondary small" onclick="startEdit('project')" style="flex-shrink:0;">Edit</button>
      </div>
      <div class="fd-grid">
        <div class="fd-item" style="grid-column:span 2"><div class="fdl">Customer Name</div><div class="fdv">${dv(d.customer_name)}</div></div>
        <div class="fd-item" style="grid-column:span 2"><div class="fdl">Customer Address</div><div class="fdv">${dv(d.customer_address)}</div></div>
        ${fdi('Closer', closer ? dv(closer.display_name || closer.full_name) : '—')}
        ${fdi('Setter', setter ? dv(setter.display_name || setter.full_name) : '— None —')}
        ${fdi('Solar Date', dd(d.install_completed_date))}
        ${fdi('Roof Date', dd(d.roof_date))}
        ${fdi('Install 1 Date', dd(d.install_1_date))}
        ${fdi('Install Completed Date', dd(d.install_date))}
        ${fdi('CRM Status', status ? dv(status.label) : '—')}
        ${fdi('Funding Status', dv(effectiveFunding))}
        ${d.funding_status_override ? `<div class="fd-item" style="grid-column:span 2"><div class="fdl">Funding Status Override</div><div class="fdv">${dv(d.funding_status_override)}</div></div>` : ''}
      </div>
    </div>`;
  }
}

function renderSystemFinance() {
  const d = DEAL;
  const el = document.getElementById('card-finance');
  if (EDITING.has('finance')) {
    el.innerHTML = `<div class="card" style="margin-bottom:20px;">
      <p class="section-title">System &amp; Finance</p>
      <div class="field-row cols-3">
        <div><label>Installer</label><select id="f_installer_id">${selectOptions(META.installers, d.installer_id, '— Select —')}</select></div>
        <div><label>Financier</label><select id="f_financier_id">${selectOptions(META.financiers, d.financier_id, '— Select —')}</select></div>
        <div><label>Contract Signed Date</label><input type="date" id="f_date_signed" value="${(d.date_signed || '').slice(0, 10)}"></div>
      </div>
      <div class="field-row cols-3">
        <div><label>Contract Value ($)</label><input type="number" step="0.01" id="f_contract_value" value="${d.contract_value ?? ''}"></div>
        <div><label>EPC Rate ($/W, informational)</label><input type="number" step="0.01" id="f_epc_rate_per_watt" value="${d.epc_rate_per_watt ?? ''}"></div>
        <div><label>Monthly Payment ($)</label><input type="number" step="0.01" id="f_monthly_payment" value="${d.monthly_payment ?? ''}"></div>
      </div>
      <div class="field-row cols-3">
        <div><label>Cashback Amount ($)</label><input type="number" step="0.01" id="f_cashback_amount" value="${d.cashback_amount ?? ''}"></div>
        <div><label>Rate per kWh</label><input type="number" step="0.0001" id="f_rate_per_kwh" value="${d.rate_per_kwh ?? ''}"></div>
        <div><label>Escalator (%)</label><input type="number" step="0.01" id="f_escalator_pct" value="${d.escalator_pct ?? ''}"></div>
      </div>
      <div class="field-row cols-3">
        <div><label>System Size (kW)</label><input type="number" step="0.01" id="f_system_size_kw" value="${d.system_size_kw ?? ''}"></div>
        <div><label>Panel Count</label><input type="number" id="f_panel_count" value="${d.panel_count ?? ''}"></div>
        <div><label>Panel Watts</label><input type="number" id="f_panel_watts" value="${d.panel_watts ?? ''}"></div>
      </div>
      <div class="field-row cols-3">
        <div><label>Annual Production (kWh)</label><input type="number" id="f_annual_production_kwh" value="${d.annual_production_kwh ?? ''}"></div>
        <div><label>Module Type</label>
          <div style="display:flex; gap:6px;">
            <select id="f_module_type" style="flex:1;"></select>
            <button type="button" class="icon-btn add-option-btn" data-category="module_type" data-target="f_module_type" title="Add option" style="border:1px solid var(--brand-border); border-radius:8px;">+</button>
          </div>
        </div>
        <div><label>Battery Type</label>
          <div style="display:flex; gap:6px;">
            <select id="f_battery_type" style="flex:1;"></select>
            <button type="button" class="icon-btn add-option-btn" data-category="battery_type" data-target="f_battery_type" title="Add option" style="border:1px solid var(--brand-border); border-radius:8px;">+</button>
          </div>
        </div>
      </div>
      <div class="field-row">
        <div><label># Batteries</label><input type="number" id="f_num_batteries" value="${d.num_batteries ?? ''}"></div>
        <div>
          <label style="display:block; margin-top:20px;"><input type="checkbox" id="f_is_referral" style="width:auto; margin-right:6px;" ${d.is_referral ? 'checked' : ''}>Referral deal (75% pay split)</label>
          <label>Pay Split</label><input type="number" step="0.01" id="f_pay_split" value="${d.pay_split ?? 0.5}">
        </div>
      </div>
      ${sectionSaveBtns('finance')}
    </div>`;
    populateDropdownSelect('f_module_type', 'module_type', d.module_type);
    populateDropdownSelect('f_battery_type', 'battery_type', d.battery_type);
    el.querySelectorAll('.add-option-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const newVal = prompt('New option to add to this list:');
        if (!newVal || !newVal.trim()) return;
        try {
          await api('POST', '/api/dropdown-options', { category: btn.dataset.category, value: newVal.trim() });
          META = await api('GET', '/api/meta');
          populateDropdownSelect(btn.dataset.target, btn.dataset.category, newVal.trim());
        } catch (e) { alert(e.message); }
      });
    });
    const isReferralCb = document.getElementById('f_is_referral');
    if (isReferralCb) isReferralCb.addEventListener('change', (e) => {
      const ps = document.getElementById('f_pay_split');
      if (ps) ps.value = e.target.checked ? 0.75 : 0.50;
    });
  } else {
    const installer = META.installers.find((i) => String(i.id) === String(d.installer_id));
    const financier = META.financiers.find((f) => String(f.id) === String(d.financier_id));
    el.innerHTML = `<div class="card" style="margin-bottom:20px;">
      <div class="section-header">
        <p class="section-title">System &amp; Finance</p>
        <button class="btn secondary small" onclick="startEdit('finance')" style="flex-shrink:0;">Edit</button>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:0 24px; align-items:start;">
        <div style="display:flex; flex-direction:column; gap:14px;">
          ${fdi('System Size', d.system_size_kw != null ? `${d.system_size_kw} kW` : '—')}
          ${fdi('System Size (Watts)', d.system_size_kw != null ? `${(d.system_size_kw * 1000).toLocaleString('en-US')} W` : '—')}
          ${fdi('Annual Production', d.annual_production_kwh != null ? `${d.annual_production_kwh} kWh` : '—')}
          ${fdi('EPC Rate ($/W)', d.epc_rate_per_watt != null ? `$${parseFloat(d.epc_rate_per_watt).toFixed(2)}/W` : '—')}
          ${fdi('Pay Split', d.pay_split != null ? `${(d.pay_split * 100).toFixed(0)}%` : '—')}
          ${fdi('Cashback', dm(d.cashback_amount || 0))}
        </div>
        <div style="display:flex; flex-direction:column; gap:14px;">
          ${fdi('Financier', financier ? dv(financier.name) : '—')}
          ${fdi('Contract Signed Date', dd(d.date_signed))}
          ${fdi('Contract Value', dm(d.contract_value))}
          ${fdi('Monthly Payment', dm(d.monthly_payment))}
          ${fdi('Rate per kWh', d.rate_per_kwh != null ? `$${parseFloat(d.rate_per_kwh).toFixed(3)}` : '—')}
          ${fdi('Escalator', d.escalator_pct != null ? `${d.escalator_pct}%` : '—')}
        </div>
        <div style="display:flex; flex-direction:column; gap:14px;">
          ${fdi('Installer', installer ? dv(installer.name) : '—')}
          ${fdi('Panel Count', dv(d.panel_count))}
          ${fdi('Panel Watts', dv(d.panel_watts))}
          ${fdi('Module Type', dv(d.module_type))}
          ${fdi('# Batteries', dv(d.num_batteries))}
          ${fdi('Battery Type', dv(d.battery_type))}
        </div>
      </div>
      ${d.is_referral ? `<p style="font-size:12px; color:var(--brand-muted); font-style:italic; margin-top:12px; margin-bottom:0;">Referral deal — 75% pay split</p>` : ''}
    </div>`;
  }
}

function renderMilestoneDates() {
  const d = DEAL;
  const el = document.getElementById('card-milestones');
  if (EDITING.has('milestones')) {
    el.innerHTML = `<div class="card" style="margin-bottom:20px;">
      <p class="section-title">Milestone Dates</p>
      <div class="field-row cols-3">
        <div><label>NTP Approved</label><input type="date" id="f_ntp_approved_date" value="${(d.ntp_approved_date || '').slice(0, 10)}"></div>
        <div><label>M1 Approved</label><input type="date" id="f_m1_approved_date" value="${(d.m1_approved_date || '').slice(0, 10)}"></div>
        <div><label>M1 Commission Paid</label><input type="date" id="f_m1_paid_date" value="${(d.m1_paid_date || '').slice(0, 10)}"></div>
      </div>
      <div class="field-row cols-3">
        <div><label>PTO Granted</label><input type="date" id="f_pto_granted_date" value="${(d.pto_granted_date || '').slice(0, 10)}"></div>
        <div><label>M2 Approved</label><input type="date" id="f_m2_approved_date" value="${(d.m2_approved_date || '').slice(0, 10)}"></div>
        <div><label>M2 Commission Paid</label><input type="date" id="f_m2_paid_date" value="${(d.m2_paid_date || '').slice(0, 10)}"></div>
      </div>
      ${sectionSaveBtns('milestones')}
    </div>`;
  } else {
    el.innerHTML = `<div class="card" style="margin-bottom:20px;">
      <div class="section-header">
        <p class="section-title">Milestone Dates</p>
        <button class="btn secondary small" onclick="startEdit('milestones')" style="flex-shrink:0;">Edit</button>
      </div>
      <div class="fd-grid cols-3">
        ${fdi('NTP Approved', dd(d.ntp_approved_date))}
        ${fdi('M1 Approved', dd(d.m1_approved_date))}
        ${fdi('M1 Commission Paid', dd(d.m1_paid_date))}
        ${fdi('PTO Granted', dd(d.pto_granted_date))}
        ${fdi('M2 Approved', dd(d.m2_approved_date))}
        ${fdi('M2 Commission Paid', dd(d.m2_paid_date))}
      </div>
    </div>`;
  }
}

const OVERRIDE_FIELD_LABELS = {
  net_ppw: 'Net PPW',
  gross_amount: 'Gross',
  pay_scale_rate: 'Pay Scale Rate',
  rep_pool: 'Rep Pool',
  closer_pay_gross: 'Closer Pay (gross)',
  closer_pay_net: 'Closer Pay (net)',
  setter_calc_net_ppw: 'Setter Net PPW',
  setter_calc_pay_scale_rate: 'Setter Pay Scale Rate',
  setter_calc_rep_pool: 'Setter Rep Pool',
  setter_pay: 'Setter Pay',
  owner_etai_m1_amount: 'Etai — M1',
  owner_etai_m2_amount: 'Etai — M2',
  owner_noy_m1_amount: 'Noy — M1',
  owner_noy_m2_amount: 'Noy — M2',
  joey_m1_bonus: "Joey's Bonus — M1",
  joey_m2_bonus: "Joey's Bonus — M2",
  expected_m1_amount: 'Expected M1',
  expected_m2_amount: 'Expected M2',
};

function overrideNotesHtml() {
  const reasonsMap = (() => { try { return JSON.parse(DEAL.field_override_reasons || '{}'); } catch (e) { return {}; } })();
  const entries = Object.entries(reasonsMap).filter(([, r]) => r);
  if (!entries.length) return '';
  return `<div style="margin-top:14px; border-top:1px solid var(--brand-border); padding-top:12px;">
    <p style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.4px; color:var(--brand-muted); margin-bottom:8px;">Override Notes</p>
    ${entries.map(([field, reason]) => `<div style="font-size:13px; margin-bottom:6px;"><span style="font-weight:600;">${OVERRIDE_FIELD_LABELS[field] || field}:</span> ${reason}</div>`).join('')}
  </div>`;
}

function renderAdminNotes() {
  const d = DEAL;
  const el = document.getElementById('card-notes');
  const reasonsMap = (() => { try { return JSON.parse(DEAL.field_override_reasons || '{}'); } catch (e) { return {}; } })();
  const overrideEntries = Object.entries(reasonsMap).filter(([, r]) => r);
  if (EDITING.has('notes')) {
    const overrideEditHtml = overrideEntries.length
      ? `<div style="margin-top:14px; border-top:1px solid var(--brand-border); padding-top:12px;">
          <p style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.4px; color:var(--brand-muted); margin-bottom:8px;">Override Notes</p>
          ${overrideEntries.map(([field, reason]) => `
            <div style="margin-bottom:10px;">
              <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">${OVERRIDE_FIELD_LABELS[field] || field}</label>
              <input type="text" class="override-reason-input" data-field="${field}" value="${(reason || '').replace(/"/g, '&quot;')}" style="width:100%;">
            </div>`).join('')}
        </div>`
      : '';
    el.innerHTML = `<div class="card" style="margin-bottom:20px;">
      <p class="section-title">Admin Notes <span style="font-weight:400; text-transform:none;">(never visible to reps)</span></p>
      <textarea id="f_admin_notes" rows="4">${(d.admin_notes || '').replace(/</g, '&lt;')}</textarea>
      ${overrideEditHtml}
      ${sectionSaveBtns('notes')}
    </div>`;
  } else {
    el.innerHTML = `<div class="card" style="margin-bottom:20px;">
      <div class="section-header">
        <p class="section-title">Admin Notes <span style="font-weight:400; text-transform:none;">(never visible to reps)</span></p>
        <button class="btn secondary small" onclick="startEdit('notes')" style="flex-shrink:0;">Edit</button>
      </div>
      <div style="font-size:14px; white-space:pre-wrap; color:${d.admin_notes ? 'var(--brand-text)' : 'var(--brand-muted)'};">${d.admin_notes ? d.admin_notes.replace(/</g, '&lt;') : 'No notes yet.'}</div>
      ${overrideNotesHtml()}
    </div>`;
  }
}

// Receipt/Proof row HTML — used by renderAdders() in both display and edit mode
function receiptRowHtml(a) {
  return `<div class="adder-receipt-row" data-id="${a.id}" style="display:flex; align-items:center; gap:8px; margin:-4px 0 10px 2px; font-size:12px; flex-wrap:wrap;">
    <span style="color:var(--brand-muted); font-weight:600;">Receipt / Proof:</span>
    ${a.receiptFile
      ? `<a href="/api/deals/${dealId}/adders/${a.id}/file" target="_blank" rel="noopener">${a.receiptFile.file_name}</a><button class="icon-btn a-receipt-remove" title="Remove" style="padding:0 4px;">✕</button>`
      : '<span style="color:var(--brand-muted);">No file attached</span>'}
    <input type="file" class="a-receipt-input" style="display:none;">
    <button class="btn secondary small a-receipt-upload" style="width:auto; padding:2px 8px; font-size:11px;">📎 ${a.receiptFile ? 'Replace' : 'Attach'}</button>
  </div>`;
}

function renderAdders() {
  const el = document.getElementById('card-adders');
  const sectionEditing = EDITING.has('adders');
  const catOptions = (a) => Object.entries(ADDER_CATEGORY_LABELS).map(([c, label]) => `<option value="${c}" ${c === a.category ? 'selected' : ''}>${label}</option>`).join('');

  // Category display order for grouping
  const CAT_ORDER = ['mpu', 'battery', 'reroof_sow', 'permit', 'misc', 'other'];

  let addersHtml;
  if (!DEAL.adders.length) {
    addersHtml = `<p style="color:var(--brand-muted); font-size:13px;">No line items yet — add MPU, battery, re-roof, permits, etc.</p>`;
  } else if (sectionEditing) {
    addersHtml = DEAL.adders.map((a) => `
      <div class="adder-row" data-id="${a.id}">
        <input type="text" class="a-label" value="${(a.label || '').replace(/"/g, '&quot;')}" placeholder="Label">
        <select class="a-category">${catOptions(a)}</select>
        <input type="number" step="0.01" class="a-amount" value="${a.amount}">
        <label style="display:flex; align-items:center; gap:4px; font-size:12px; white-space:nowrap;">
          <input type="checkbox" class="a-hardcost" ${a.counts_as_hard_cost ? 'checked' : ''} style="width:auto;">Counts toward PPW
        </label>
        <button class="btn small a-save-btn" data-id="${a.id}" style="width:auto;">Save</button>
        <button class="icon-btn a-delete" data-id="${a.id}" title="Remove">✕</button>
      </div>
      ${receiptRowHtml(a)}`).join('');
  } else {
    // Group by category for display
    const grouped = {};
    CAT_ORDER.forEach((c) => { grouped[c] = []; });
    DEAL.adders.forEach((a) => { const c = a.category || 'misc'; (grouped[c] || (grouped['misc'])).push(a); });
    addersHtml = CAT_ORDER.filter((c) => grouped[c] && grouped[c].length).map((cat) => {
      const items = grouped[cat];
      const itemsHtml = items.map((a) => `
        <div class="adder-display-row" style="display:flex; align-items:center; gap:10px; padding:6px 0; border-bottom:1px solid var(--brand-border); flex-wrap:wrap;">
          <span style="flex:2; font-size:13px; font-weight:500;">${a.label || '—'}</span>
          <span style="flex:0 0 90px; font-size:13px; font-weight:600; text-align:right;">${fmtMoney(a.amount)}</span>
          <span style="flex:0 0 auto; font-size:11px; color:${a.counts_as_hard_cost ? 'var(--brand-accent)' : 'var(--brand-muted)'};">${a.counts_as_hard_cost ? 'Counts toward PPW' : 'Client Covered Cost'}</span>
        </div>
        ${receiptRowHtml(a)}`).join('');
      return `<div style="margin-top:12px;">
        <p style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:var(--brand-muted); margin:0 0 4px;">${ADDER_CATEGORY_LABELS[cat] || cat}</p>
        ${itemsHtml}
      </div>`;
    }).join('');
  }

  el.innerHTML = `<div class="card" style="margin-bottom:20px;">
    <div class="section-header">
      <p class="section-title" style="margin:0;">Adders <span style="font-weight:400; text-transform:none; font-size:12px;">— Counts toward PPW or Client Covered Cost</span></p>
      ${sectionEditing
        ? `<button class="btn secondary small" id="doneAddersBtn" style="flex-shrink:0;">Done</button>`
        : `<button class="btn secondary small" id="editAddersBtn" style="flex-shrink:0;">Edit</button>`}
    </div>
    <div id="addersList">${addersHtml}</div>
    <button class="btn secondary small" id="addAdderBtn" style="margin-top:10px;">+ Add Line Item</button>
  </div>`;

  const editBtn = el.querySelector('#editAddersBtn');
  if (editBtn) editBtn.addEventListener('click', () => { EDITING.add('adders'); renderAdders(); });
  const doneBtn = el.querySelector('#doneAddersBtn');
  if (doneBtn) doneBtn.addEventListener('click', () => { EDITING.delete('adders'); renderAdders(); });

  if (sectionEditing) {
    el.querySelectorAll('.adder-row').forEach((row) => {
      const id = row.dataset.id;
      const doSave = async () => {
        try {
          DEAL = await api('PUT', `/api/deals/${dealId}/adders/${id}`, {
            label: row.querySelector('.a-label').value,
            category: row.querySelector('.a-category').value,
            amount: parseFloat(row.querySelector('.a-amount').value) || 0,
            counts_as_hard_cost: row.querySelector('.a-hardcost').checked
          });
          renderAdders();
          renderCalc();
        } catch (e) { alert(e.message); }
      };
      const saveBtn = row.querySelector('.a-save-btn');
      if (saveBtn) saveBtn.addEventListener('click', doSave);
    });
    el.querySelectorAll('.a-delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          DEAL = await api('DELETE', `/api/deals/${dealId}/adders/${btn.dataset.id}`);
          renderAdders();
          renderCalc();
        } catch (e) { alert(e.message); }
      });
    });
  }

  el.querySelectorAll('.adder-receipt-row').forEach((row) => {
    const id = row.dataset.id;
    const uploadBtn = row.querySelector('.a-receipt-upload');
    const receiptInput = row.querySelector('.a-receipt-input');
    if (uploadBtn && receiptInput) {
      uploadBtn.addEventListener('click', () => receiptInput.click());
      receiptInput.addEventListener('change', async () => {
        const file = receiptInput.files[0];
        if (!file) return;
        const origLabel = uploadBtn.textContent;
        uploadBtn.disabled = true; uploadBtn.textContent = 'Uploading…';
        const fd = new FormData(); fd.append('file', file);
        try {
          const res = await fetch(`/api/deals/${dealId}/adders/${id}/file`, { method: 'POST', body: fd });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Upload failed');
          DEAL = data; renderAdders();
        } catch (e) { alert(e.message); uploadBtn.disabled = false; uploadBtn.textContent = origLabel; }
      });
    }
    const removeBtn = row.querySelector('.a-receipt-remove');
    if (removeBtn) removeBtn.addEventListener('click', async () => {
      if (!confirm('Remove this Receipt/Proof file?')) return;
      try { DEAL = await api('DELETE', `/api/deals/${dealId}/adders/${id}/file`); renderAdders(); } catch (e) { alert(e.message); }
    });
  });

  const addAdderBtn = el.querySelector('#addAdderBtn');
  if (addAdderBtn) addAdderBtn.addEventListener('click', (e) => guardedClick(e.target, 'Adding…', async () => {
    try {
      DEAL = await api('POST', `/api/deals/${dealId}/adders`, { label: 'New item', category: 'misc', amount: 0, counts_as_hard_cost: true });
      EDITING.add('adders');
      renderAdders();
      renderCalc();
    } catch (e2) { alert(e2.message); }
  }));
}


// --- Calculator helpers ---

function calcRow(label, value, opts = {}) {
  const cls = opts.total ? 'calc-line total' : 'calc-line';
  return `<div class="${cls}"><span class="lbl">${label}</span><span class="val">${value}</span></div>`;
}
function fmtRate2(n) { return (n === null || n === undefined || n === '') ? '—' : `${fmtMoney(n)}/kW`; }

function calcEditableRow(label, value, fieldName) {
  return `<div class="calc-line">
    <span class="lbl">${label}</span>
    <span class="val" style="display:flex; align-items:center; gap:6px; font-weight:400;">
      <input type="number" step="0.01" class="calc-amount-input" data-field="${fieldName}" value="${value ?? ''}" style="margin:0; max-width:100px; padding:4px 8px; font-weight:700;">
      <button class="btn secondary small calc-amount-save" data-field="${fieldName}" style="width:auto; padding:7px 14px;">Save</button>
    </span>
  </div>`;
}

function wireCalcAmountSaveButtons() {
  document.querySelectorAll('.calc-amount-save').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const field = btn.dataset.field;
      const input = document.querySelector(`.calc-amount-input[data-field="${field}"]`);
      try {
        DEAL = await api('PUT', `/api/deals/${dealId}`, { [field]: numOrNull(input.value) });
        renderCalc();
      } catch (e) { alert(e.message); }
    });
  });
}

const CLOSER_CALC_FIELDS = ['net_ppw', 'gross_amount', 'pay_scale_rate', 'rep_pool', 'closer_pay_gross', 'closer_pay_net'];
const SETTER_CALC_FIELDS = ['setter_calc_net_ppw', 'setter_calc_pay_scale_rate', 'setter_calc_rep_pool', 'setter_pay'];

function lockedFieldsFor(fieldList) {
  try { return JSON.parse(DEAL.overridden_fields || '[]').filter((f) => fieldList.includes(f)); } catch (e) { return []; }
}

function overrideBadgeHtml(lockedFields) {
  if (!lockedFields.length) return '';
  const reasonsMap = (() => { try { return JSON.parse(DEAL.field_override_reasons || '{}'); } catch (e) { return {}; } })();
  const reasons = Array.from(new Set(lockedFields.map((f) => reasonsMap[f]).filter(Boolean)));
  return `<div class="badge amber" style="margin-top:10px;">Manual override active${reasons.length ? ': ' + reasons.join('; ') : ''}</div>`;
}

function approvalBadgeFor(role) {
  const d = DEAL;
  const approved = role === 'closer' ? d.closer_breakdown_approved : d.setter_breakdown_approved;
  const label = role === 'closer' ? "Closer's" : "Setter's";
  return approved
    ? `<span class="badge ${role === 'closer' ? 'green' : 'amber'}">Approved for ${label} view</span>`
    : `<span class="badge muted">Not yet approved for ${label} view</span>`;
}

function payScaleSelectorHtml(d) {
  const options = (META.payScales || []).map((p) => `<option value="${p.id}" ${String(p.id) === String(d.pay_scale_id) ? 'selected' : ''}>${p.name}</option>`).join('');
  return `<div class="calc-line">
    <span class="lbl">Pay Scale</span>
    <span class="val" style="display:flex; align-items:center; gap:6px; font-weight:400;">
      <select id="payScaleSelect" style="margin:0; max-width:170px; padding:4px 8px; font-weight:700;">${options}</select>
      <button class="btn secondary small" id="payScaleSaveBtn" style="width:auto; padding:4px 10px;">Save</button>
    </span>
  </div>`;
}

function wirePayScaleSelector() {
  const btn = document.getElementById('payScaleSaveBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const value = document.getElementById('payScaleSelect').value;
    try { DEAL = await api('PUT', `/api/deals/${dealId}`, { pay_scale_id: Number(value) }); renderCalc(); } catch (e) { alert(e.message); }
  });
}

function closerAdderCategoryTotals(adders) {
  const totals = { mpu: 0, reroof_sow: 0, battery: 0, permit: 0, misc: 0 };
  (adders || []).forEach((a) => {
    const cat = a.category === 'other' ? 'misc' : a.category;
    if (totals[cat] !== undefined) totals[cat] = round2(totals[cat] + (Number(a.amount) || 0));
  });
  return totals;
}

function renderCloserCalc() {
  const d = DEAL;
  let html = '';
  html += payScaleSelectorHtml(d);
  if (d.below_floor) html += `<div class="error-msg show" style="margin-bottom:14px;">Below the pay-scale hard floor — needs manual approval before any commission is paid.</div>`;
  html += `<div style="margin-bottom:10px;">${approvalBadgeFor('closer')}</div>`;
  const catTotals = closerAdderCategoryTotals(d.adders);
  html += calcRow('MPU', fmtMoney(catTotals.mpu));
  html += calcRow('Roof', fmtMoney(catTotals.reroof_sow));
  html += calcRow('Battery', fmtMoney(catTotals.battery));
  if (catTotals.permit) html += calcRow('Permit', fmtMoney(catTotals.permit));
  html += calcRow('Miscellaneous', fmtMoney(catTotals.misc));
  html += calcRow('System Size', d.system_size_kw ? `${d.system_size_kw} kW` : '—');
  html += calcRow('Net PPW', d.net_ppw ?? '—');
  html += calcRow('Gross', fmtMoney(d.gross_amount));
  html += calcRow('Pay Scale Rate', fmtRate2(d.pay_scale_rate));
  html += calcRow('Rep Pool', fmtMoney(d.rep_pool));
  html += calcRow('Closer Pay (gross)', fmtMoney(d.closer_pay_gross));
  if (d.cashback_amount) html += calcRow('Cashback Deduction', `−${fmtMoney(d.cashback_amount * 0.5)}`);
  html += calcEditableRow('Advance Deduction', d.advance_deduction, 'advance_deduction');
  html += calcEditableRow('Deduction (Other)', d.deduction_other, 'deduction_other');
  html += calcRow('Closer Pay (net)', fmtMoney(d.closer_pay_net), { total: true });
  html += overrideBadgeHtml(lockedFieldsFor(CLOSER_CALC_FIELDS));
  document.getElementById('closerCalcLines').innerHTML = html;
  document.getElementById('closerOverrideBtn').textContent = lockedFieldsFor(CLOSER_CALC_FIELDS).length ? 'Edit Override' : 'Manual Override';
}

function renderSetterCalc() {
  const d = DEAL;
  const card = document.getElementById('setterCalcCard');
  card.style.display = 'block';
  if (!d.setter_rep_id) {
    document.getElementById('setterCalcInputs').innerHTML = `<p style="color:var(--brand-muted); font-size:13px; margin:0;">No setter assigned. Edit Project Details to assign a setter and unlock this calculator.</p>`;
    document.getElementById('setterCalcLines').innerHTML = '';
    document.getElementById('setterOverrideBtn').style.display = 'none';
    return;
  }
  document.getElementById('setterOverrideBtn').style.display = '';
  let inputsHtml = '';
  inputsHtml += calcRow('Customer Name', d.customer_name || '—');
  inputsHtml += calcRow('Property Address', d.customer_address || '—');
  inputsHtml += calcEditableRow('Contract Value ($)', d.setter_calc_contract_value, 'setter_calc_contract_value');
  inputsHtml += calcEditableRow('MPU ($)', d.setter_calc_mpu_amount, 'setter_calc_mpu_amount');
  inputsHtml += calcEditableRow('Roof ($)', d.setter_calc_roof_amount, 'setter_calc_roof_amount');
  inputsHtml += calcEditableRow('Battery ($)', d.setter_calc_battery_amount, 'setter_calc_battery_amount');
  inputsHtml += calcEditableRow('Miscellaneous ($)', d.setter_calc_misc_amount, 'setter_calc_misc_amount');
  inputsHtml += calcEditableRow('System Size (kW)', d.setter_calc_system_size_kw, 'setter_calc_system_size_kw');
  inputsHtml += calcEditableRow('Rate per kWh ($)', d.setter_calc_rate_per_kwh, 'setter_calc_rate_per_kwh');
  inputsHtml += calcEditableRow('Monthly Payment ($)', d.setter_calc_monthly_payment, 'setter_calc_monthly_payment');
  document.getElementById('setterCalcInputs').innerHTML = inputsHtml;
  let html = '';
  html += `<div style="margin-bottom:10px;">${approvalBadgeFor('setter')}</div>`;
  if (d.setter_calc_below_floor) html += `<div class="error-msg show" style="margin-bottom:14px;">Below the pay-scale hard floor on these preliminary numbers — needs manual review before any setter pay is paid.</div>`;
  html += calcRow('Net PPW', d.setter_calc_net_ppw ?? '—');
  html += calcRow('Pay Scale Rate', fmtRate2(d.setter_calc_pay_scale_rate));
  html += calcRow('Rep Pool', fmtMoney(d.setter_calc_rep_pool));
  html += calcRow('Setter Pay', fmtMoney(d.setter_pay), { total: true });
  html += overrideBadgeHtml(lockedFieldsFor(SETTER_CALC_FIELDS));
  document.getElementById('setterCalcLines').innerHTML = html;
  document.getElementById('setterOverrideBtn').textContent = lockedFieldsFor(SETTER_CALC_FIELDS).length ? 'Edit Override' : 'Manual Override';
}

function renderCalc() {
  renderCloserCalc();
  renderSetterCalc();
  wireCalcAmountSaveButtons();
  wirePayScaleSelector();
  renderFundsReceived();
}

function numOrNull(v) {
  const n = parseFloat(v);
  return v === '' || v === null || v === undefined || isNaN(n) ? null : n;
}

function fieldOverrideReason(deal, field) {
  try { return JSON.parse(deal.field_override_reasons || '{}')[field] || null; } catch (e) { return null; }
}

function renderFundsReceived() {
  const d = DEAL;
  const editing = EDITING.has('funds');
  const el = document.getElementById('card-funds');
  const totalReceived = (d.adv1_received || 0) + (d.adv2_received || 0) + (d.funds_received_m1 || 0) + (d.funds_received_m2 || 0);
  const totalExpected = (d.expected_adv1_amount ?? 500) + (d.expected_adv2_amount ?? 500) + (d.expected_m1_amount || 0) + (d.expected_m2_amount || 0);
  const difference = totalExpected - totalReceived;

  const thStyle = 'text-align:right; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.4px; color:var(--brand-muted); padding:0 0 8px 8px; border-bottom:1px solid var(--brand-border);';
  const thStyleLeft = 'text-align:left; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.4px; color:var(--brand-muted); padding:0 8px 8px 0; border-bottom:1px solid var(--brand-border); width:36%;';
  const cellBorder = 'border-bottom:1px solid var(--brand-border);';

  if (!editing) {
    const rows = [
      ['Advance 1', d.expected_adv1_amount ?? 500, d.adv1_received, d.adv1_received_date],
      ['Advance 2', d.expected_adv2_amount ?? 500, d.adv2_received, d.adv2_received_date],
      ['Milestone 1 (M1)', d.expected_m1_amount, d.funds_received_m1, d.funds_received_m1_date],
      ['Milestone 2 (M2)', d.expected_m2_amount, d.funds_received_m2, d.funds_received_m2_date],
    ];
    el.innerHTML = `<div class="card" style="margin-bottom:20px;">
      <div class="section-header">
        <p class="section-title">Funds Received <span style="font-weight:400; text-transform:none; font-size:12px;">— money POWERED actually receives</span></p>
        <button class="btn secondary small" onclick="startEdit('funds')" style="flex-shrink:0;">Edit</button>
      </div>
      <table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead><tr>
          <th style="${thStyleLeft}">Payment</th>
          <th style="${thStyle} width:20%;">Expected</th>
          <th style="${thStyle} width:20%;">Received</th>
          <th style="${thStyle} width:24%;">Date received</th>
        </tr></thead>
        <tbody>
          ${rows.map(([label, exp, rec, date]) => `<tr>
            <td style="padding:7px 8px 7px 0; color:var(--brand-muted); ${cellBorder}">${label}</td>
            <td style="padding:7px 8px; text-align:right; ${cellBorder}">${exp != null ? fmtMoney(exp) : '—'}</td>
            <td style="padding:7px 8px; text-align:right; ${cellBorder} ${rec ? 'color:#1D9E75; font-weight:600;' : 'color:var(--brand-muted);'}">${rec != null ? fmtMoney(rec) : '—'}</td>
            <td style="padding:7px 0 7px 8px; text-align:right; font-size:12px; color:${date ? 'var(--brand-text)' : 'var(--brand-muted)'}; ${cellBorder}">${date ? fmtDate(date.slice(0, 10)) : 'Pending'}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td style="padding:8px 8px 2px 0; font-weight:600; border-top:2px solid var(--brand-border);">Total</td>
            <td style="padding:8px 8px 2px; text-align:right; font-weight:600; border-top:2px solid var(--brand-border);">${fmtMoney(totalExpected)}</td>
            <td style="padding:8px 8px 2px; text-align:right; font-weight:600; color:#1D9E75; border-top:2px solid var(--brand-border);">${fmtMoney(totalReceived)}</td>
            <td style="border-top:2px solid var(--brand-border);"></td>
          </tr>
          ${difference !== 0 ? `<tr>
            <td></td><td></td>
            <td colspan="2" style="text-align:right; font-size:12px; color:var(--brand-muted); padding:2px 0 8px;">${difference > 0 ? '−' : '+'} ${fmtMoney(Math.abs(difference))}</td>
          </tr>` : ''}
        </tfoot>
      </table>
      ${d.funds_received_notes ? `<div style="margin-top:10px; padding:8px 10px; background:var(--brand-bg); border-radius:8px; border:1px solid var(--brand-border);"><div style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.4px; color:var(--brand-muted); margin-bottom:3px;">Notes</div><div style="font-size:13px; color:var(--brand-text); white-space:pre-wrap;">${d.funds_received_notes.replace(/</g, '&lt;')}</div></div>` : ''}
    </div>`;
    return;
  }

  const overrideReasonM1 = fieldOverrideReason(d, 'expected_m1_amount');
  const overrideReasonM2 = fieldOverrideReason(d, 'expected_m2_amount');

  el.innerHTML = `<div class="card" style="margin-bottom:20px;">
    <p class="section-title">Funds Received <span style="font-weight:400; text-transform:none; font-size:12px;">— money POWERED actually receives</span></p>

    <p style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.4px; color:var(--brand-muted); margin:0 0 6px;">Advance 1</p>
    <div class="field-row" style="margin-bottom:14px;">
      <div><label>Expected ($)</label><input type="number" step="0.01" id="f_exp_adv1" value="${d.expected_adv1_amount ?? 500}"></div>
      <div><label>Received ($)</label><input type="number" step="0.01" id="fr_adv1_amount" value="${d.adv1_received ?? ''}"></div>
      <div><label>Date Received</label><input type="date" id="fr_adv1_date" value="${(d.adv1_received_date || '').slice(0, 10)}"></div>
    </div>

    <p style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.4px; color:var(--brand-muted); margin:0 0 6px;">Advance 2</p>
    <div class="field-row" style="margin-bottom:14px;">
      <div><label>Expected ($)</label><input type="number" step="0.01" id="f_exp_adv2" value="${d.expected_adv2_amount ?? 500}"></div>
      <div><label>Received ($)</label><input type="number" step="0.01" id="fr_adv2_amount" value="${d.adv2_received ?? ''}"></div>
      <div><label>Date Received</label><input type="date" id="fr_adv2_date" value="${(d.adv2_received_date || '').slice(0, 10)}"></div>
    </div>

    <p style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.4px; color:var(--brand-muted); margin:0 0 6px;">Milestone 1 (M1)</p>
    <div style="margin-bottom:6px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span class="lbl" style="color:var(--brand-muted);">Expected M1</span>
        <div style="display:flex; align-items:center; gap:8px;">
          <input type="number" step="0.01" class="amount-override" data-field="expected_m1_amount" value="${d.expected_m1_amount ?? ''}" style="margin:0; max-width:130px;">
          <button class="btn secondary small amount-save" data-field="expected_m1_amount" style="width:auto; padding:2px 8px; font-size:11px;">Save</button>
        </div>
      </div>
      ${overrideReasonM1 ? `<div style="font-size:11px; color:var(--brand-muted); margin-top:2px;">Override reason: ${overrideReasonM1}</div>` : ''}
    </div>
    <div class="field-row" style="margin:6px 0 14px;">
      <div><label>Received M1 ($)</label><input type="number" step="0.01" id="fr_m1_amount" value="${d.funds_received_m1 ?? ''}"></div>
      <div><label>Date Received</label><input type="date" id="fr_m1_date" value="${(d.funds_received_m1_date || '').slice(0, 10)}"></div>
    </div>

    <p style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.4px; color:var(--brand-muted); margin:0 0 6px;">Milestone 2 (M2)</p>
    <div style="margin-bottom:6px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span class="lbl" style="color:var(--brand-muted);">Expected M2</span>
        <div style="display:flex; align-items:center; gap:8px;">
          <input type="number" step="0.01" class="amount-override" data-field="expected_m2_amount" value="${d.expected_m2_amount ?? ''}" style="margin:0; max-width:130px;">
          <button class="btn secondary small amount-save" data-field="expected_m2_amount" style="width:auto; padding:2px 8px; font-size:11px;">Save</button>
        </div>
      </div>
      ${overrideReasonM2 ? `<div style="font-size:11px; color:var(--brand-muted); margin-top:2px;">Override reason: ${overrideReasonM2}</div>` : ''}
    </div>
    <div class="field-row" style="margin:6px 0 14px;">
      <div><label>Received M2 ($)</label><input type="number" step="0.01" id="fr_m2_amount" value="${d.funds_received_m2 ?? ''}"></div>
      <div><label>Date Received</label><input type="date" id="fr_m2_date" value="${(d.funds_received_m2_date || '').slice(0, 10)}"></div>
    </div>

    <div style="margin-bottom:12px;">
      <label style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.4px; color:var(--brand-muted); display:block; margin-bottom:6px;">Notes</label>
      <textarea id="f_funds_notes" style="width:100%; box-sizing:border-box; padding:8px 10px; font-size:13px; font-family:inherit; color:var(--brand-text); background:var(--brand-card); border:1px solid var(--brand-border); border-radius:8px; resize:vertical; min-height:60px;">${(d.funds_received_notes || '').replace(/</g, '&lt;')}</textarea>
    </div>

    <div style="display:flex; gap:8px; margin-top:4px;">
      <button class="btn small" id="saveFundsBtn" style="width:auto;">Save</button>
      <button class="btn secondary small" onclick="cancelEdit('funds')" style="width:auto;">Cancel</button>
    </div>
  </div>`;

  document.getElementById('saveFundsBtn').addEventListener('click', async (e) => {
    const btn = e.target; btn.disabled = true; btn.textContent = 'Saving…';
    try {
      DEAL = await api('PUT', `/api/deals/${dealId}`, {
        expected_adv1_amount: numOrNull(val('f_exp_adv1')),
        expected_adv2_amount: numOrNull(val('f_exp_adv2')),
        adv1_received: numOrNull(val('fr_adv1_amount')),
        adv1_received_date: val('fr_adv1_date') || null,
        adv2_received: numOrNull(val('fr_adv2_amount')),
        adv2_received_date: val('fr_adv2_date') || null,
        funds_received_m1: numOrNull(val('fr_m1_amount')),
        funds_received_m1_date: val('fr_m1_date') || null,
        funds_received_m2: numOrNull(val('fr_m2_amount')),
        funds_received_m2_date: val('fr_m2_date') || null,
        funds_received_notes: val('f_funds_notes') || null,
      });
      EDITING.delete('funds');
      renderFundsReceived();
    } catch (err) { alert(err.message); btn.disabled = false; btn.textContent = 'Save'; }
  });

  wireAmountOverrideButtons();
}

function fmtFileSize(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderEstimateFileSlot(slot) {
  const f = DEAL.estimateFiles ? DEAL.estimateFiles[slot] : null;
  const box = document.getElementById(`fileBox_${slot}`);
  box.innerHTML = f
    ? `<div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px; background:var(--brand-bg); border-radius:8px;">
        <div style="font-size:13px;">📎 <a href="/api/deals/${dealId}/files/${slot}" target="_blank" rel="noopener">${f.file_name}</a>
          <span style="color:var(--brand-muted);">(${fmtFileSize(f.file_size)} · uploaded ${fmtDate(f.uploaded_at)})</span>
        </div>
        <button class="icon-btn remove-file-btn" data-slot="${slot}" title="Remove">✕</button>
      </div>`
    : `<p style="color:var(--brand-muted); font-size:12px; margin:0;">No file attached yet.</p>`;
  const uploadBtnId = `uploadFileBtn_${slot}`;
  const fileInputId = `fileInput_${slot}`;
  box.insertAdjacentHTML('beforeend', `<div style="margin-top:8px;">
    <input type="file" id="${fileInputId}" style="display:none;">
    <button class="btn secondary small" id="${uploadBtnId}" style="width:auto; padding:2px 8px; font-size:11px;">📎 ${f ? 'Replace File' : 'Attach File'}</button>
  </div>`);
  const uploadBtn = document.getElementById(uploadBtnId);
  const fileInput = document.getElementById(fileInputId);
  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0]; if (!file) return;
    uploadBtn.disabled = true; uploadBtn.textContent = 'Uploading…';
    const fd = new FormData(); fd.append('file', file);
    try {
      const res = await fetch(`/api/deals/${dealId}/files/${slot}`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      DEAL = data; renderEstimateFileSlot(slot);
    } catch (err) { alert(err.message); uploadBtn.disabled = false; uploadBtn.textContent = f ? 'Replace File' : 'Attach File'; }
  });
  const removeBtn = box.querySelector('.remove-file-btn');
  if (removeBtn) removeBtn.addEventListener('click', async () => {
    if (!confirm('Remove this attached file?')) return;
    try { DEAL = await api('DELETE', `/api/deals/${dealId}/files/${slot}`); renderEstimateFileSlot(slot); } catch (err) { alert(err.message); }
  });
}

function renderOriginalEstimate() {
  const el = document.getElementById('estimateField');
  if (!el) return;
  const d = DEAL;
  const editing = EDITING.has('estimate');

  if (editing) {
    el.innerHTML = `
      <label>Original Commission Calculator Estimate ($) <span style="font-weight:400; color:var(--brand-muted); font-size:12px;">— just for comparison, never used in any calculation</span></label>
      <div style="display:flex; gap:8px; align-items:center;">
        <input type="number" step="0.01" id="f_original_estimate_amount" value="${d.original_estimate_amount ?? ''}" style="margin:0;">
        <button class="btn small" id="saveOriginalEstimateBtn" style="width:auto;">Save</button>
        <button class="btn secondary small" onclick="cancelEdit('estimate')" style="width:auto;">Cancel</button>
      </div>
      <div style="margin-top:12px;"><label style="font-size:12px;">1 — Estimate</label><div id="fileBox_estimate"></div></div>
      <div style="margin-top:12px;"><label style="font-size:12px;">2 — Final</label><div id="fileBox_final"></div></div>
    `;
    document.getElementById('saveOriginalEstimateBtn').addEventListener('click', async (e) => {
      const btn = e.target; btn.disabled = true;
      try {
        DEAL = await api('PUT', `/api/deals/${dealId}`, { original_estimate_amount: numOrNull(val('f_original_estimate_amount')) });
        EDITING.delete('estimate');
        renderOriginalEstimate();
      } catch (err) { alert(err.message); btn.disabled = false; }
    });
  } else {
    const hasValue = d.original_estimate_amount != null;
    el.innerHTML = `
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px;">
        <div>
          <label>Original Commission Calculator Estimate <span style="font-weight:400; color:var(--brand-muted); font-size:12px;">— just for comparison, never used in any calculation</span></label>
          <div style="font-size:16px; font-weight:600; color:${hasValue ? 'var(--brand-text)' : 'var(--brand-muted)'}; margin-top:4px;">${hasValue ? fmtMoney(d.original_estimate_amount) : '— Not set —'}</div>
        </div>
        <button class="btn secondary small" onclick="startEdit('estimate')" style="flex-shrink:0;">Edit</button>
      </div>
      <div style="margin-top:12px;"><label style="font-size:12px;">1 — Estimate</label><div id="fileBox_estimate"></div></div>
      <div style="margin-top:12px;"><label style="font-size:12px;">2 — Final</label><div id="fileBox_final"></div></div>
    `;
  }
  renderEstimateFileSlot('estimate');
  renderEstimateFileSlot('final');
}

function renderApproval() {
  const d = DEAL;
  let html = '';
  if (d.closer_rep_id) {
    html += `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--brand-border);">
      <div><strong>Closer</strong> — ${d.closer_display || d.closer_name}<br>${d.closer_breakdown_approved ? '<span class="badge green">Approved for view</span>' : '<span class="badge muted">Not visible to rep</span>'}</div>
      <button class="btn ${d.closer_breakdown_approved ? 'secondary' : ''} small" id="toggleCloserApproval">${d.closer_breakdown_approved ? 'Revoke' : 'Approve'}</button>
    </div>`;
  }
  if (d.setter_rep_id) {
    html += `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0;">
      <div><strong>Setter</strong> — ${d.setter_display || d.setter_name}<br>${d.setter_breakdown_approved ? '<span class="badge amber">Approved for view</span>' : '<span class="badge muted">Not visible to rep</span>'}</div>
      <button class="btn ${d.setter_breakdown_approved ? 'secondary' : ''} small" id="toggleSetterApproval">${d.setter_breakdown_approved ? 'Revoke' : 'Approve'}</button>
    </div>`;
  }
  if (!html) html = '<p style="color:var(--brand-muted); font-size:13px;">Assign a closer or setter to enable approval.</p>';
  document.getElementById('approvalBox').innerHTML = html;
  const c = document.getElementById('toggleCloserApproval');
  if (c) c.addEventListener('click', () => setApproval('closer', !d.closer_breakdown_approved));
  const s = document.getElementById('toggleSetterApproval');
  if (s) s.addEventListener('click', () => setApproval('setter', !d.setter_breakdown_approved));
}

async function setApproval(role, approved) {
  try { DEAL = await api('POST', `/api/deals/${dealId}/approve`, { role, approved }); renderApproval(); } catch (e) { alert(e.message); }
}

function wireAmountOverrideButtons() {
  document.querySelectorAll('.amount-save:not([data-wired])').forEach((btn) => {
    btn.dataset.wired = '1';
    btn.addEventListener('click', async () => {
      const field = btn.dataset.field;
      const input = document.querySelector(`.amount-override[data-field="${field}"]`);
      const value = numOrNull(input.value);
      if (value === null) { alert('Enter an amount before saving.'); return; }
      const reason = prompt('Reason for overriding this amount (required):');
      if (!reason) return;
      try {
        DEAL = await api('POST', `/api/deals/${dealId}/override`, { override: true, reason, fields: { [field]: value } });
        if (field.startsWith('expected_')) { renderFundsReceived(); } else { renderPayment(); }
        renderAudit();
      } catch (e) { alert(e.message); }
    });
  });
}

function renderPayment() {
  const d = DEAL;
  const editing = EDITING.has('payment');
  const el = document.getElementById('card-payment');
  const naFlags = (() => { try { return JSON.parse(d.payment_na_flags || '{}'); } catch (e) { return {}; } })();

  const NA_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="color:var(--brand-muted); vertical-align:-2px;" aria-hidden="true"><circle cx="12" cy="12" r="9"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;
  const PENDING_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="color:var(--brand-muted); vertical-align:-2px;" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>`;

  // Returns [iconHtml, textHtml] as two separate cells for the 3-col grid.
  function statusCols(recipient, paid, paidDate) {
    if (naFlags[recipient]) {
      return [
        `<div style="text-align:center;">${NA_ICON}</div>`,
        `<div style="font-size:12px; color:var(--brand-muted);">N/A</div>`
      ];
    }
    if (paid) {
      return [
        `<div style="text-align:center; font-size:15px; line-height:1;">✅</div>`,
        `<div style="font-size:12px;">Paid ${fmtDate((paidDate || '').slice(0, 10))}</div>`
      ];
    }
    return [
      `<div style="text-align:center;">${PENDING_ICON}</div>`,
      `<div style="font-size:12px; color:var(--brand-muted);">Not yet paid</div>`
    ];
  }

  function statusSelect(recipient, paid, paidDate) {
    const cur = naFlags[recipient] ? 'na' : paid ? 'paid' : 'pending';
    return `<div style="grid-column:2/4; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
      <select class="pay-select" data-recipient="${recipient}" style="margin:0; padding:4px 6px; font-size:13px; width:auto;">
        <option value="pending" ${cur === 'pending' ? 'selected' : ''}>⏳ Not yet paid</option>
        <option value="paid" ${cur === 'paid' ? 'selected' : ''}>✅ Paid</option>
        <option value="na" ${cur === 'na' ? 'selected' : ''}>N/A</option>
      </select>
      <input type="date" class="pay-date" data-recipient="${recipient}" value="${(paidDate || '').slice(0, 10)}" style="margin:0; padding:4px 6px;${cur === 'paid' ? '' : ' display:none;'}">
    </div>`;
  }

  function labelCell(name, amount) {
    return `<div style="display:flex; flex-direction:column; gap:1px;">
      <span style="font-size:13px; font-weight:600;">${name}</span>
      ${amount != null ? `<span style="font-size:12px; color:var(--brand-muted);">${dm(amount)}</span>` : ''}
    </div>`;
  }

  // 3-col grid: [name+amount] [icon] [status text]. In edit mode the select spans cols 2-3.
  function payRow(label, recipient, paid, amount, paidDate) {
    const [ic, tx] = statusCols(recipient, paid, paidDate);
    return `<div style="display:grid; grid-template-columns:1fr 28px 150px; align-items:center; padding:8px 0; border-bottom:1px solid var(--brand-border);">
      ${labelCell(label, amount)}
      ${editing ? statusSelect(recipient, paid, paidDate) : `${ic}${tx}`}
    </div>`;
  }

  function internalRow(label, recipient, paid, amount, paidDate, overrideField, reason) {
    const [ic, tx] = statusCols(recipient, paid, paidDate);
    const overrideHtml = editing
      ? `<div style="margin-top:6px; display:flex; align-items:center; gap:8px;">
           <input type="number" step="0.01" class="amount-override" data-field="${overrideField}" value="${amount ?? ''}" style="margin:0; max-width:140px;">
           <button class="btn secondary small amount-save" data-field="${overrideField}" style="width:auto; padding:2px 8px; font-size:11px;">Save</button>
         </div>
         ${reason ? `<div style="font-size:11px; color:var(--brand-muted); margin-top:2px;">Override reason: ${reason}</div>` : ''}`
      : '';
    return `<div style="padding:8px 0 8px 14px; border-bottom:1px solid var(--brand-border);">
      <div style="display:grid; grid-template-columns:1fr 28px 150px; align-items:center;">
        ${labelCell(label, amount)}
        ${editing ? statusSelect(recipient, paid, paidDate) : `${ic}${tx}`}
      </div>
      ${overrideHtml}
    </div>`;
  }

  let html = `<div class="card" style="margin-bottom:20px;">
    <div class="section-header">
      <p class="section-title">Payment Status</p>
      ${editing
        ? `<button class="btn secondary small" onclick="cancelEdit('payment')" style="flex-shrink:0;">Done</button>`
        : `<button class="btn secondary small" onclick="startEdit('payment')" style="flex-shrink:0;">Edit</button>`}
    </div>`;

  if (d.closer_rep_id) html += payRow('Closer', 'closer', d.closer_paid, d.closer_pay_net, d.closer_paid_date);
  if (d.setter_rep_id) html += payRow('Setter', 'setter', d.setter_paid, d.setter_pay, d.setter_paid_date);
  html += `<div style="margin:12px 0 2px; padding-bottom:4px; border-bottom:1px solid var(--brand-border);">
    <span style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:var(--brand-muted);">Internal Payroll</span>
    <span style="font-size:11px; color:var(--brand-muted);"> — admin only${editing ? ', save each row to override amount' : ''}</span>
  </div>`;
  html += internalRow('Etai — M1', 'owner_etai_m1', d.owner_etai_m1_paid, d.owner_etai_m1_amount, d.owner_etai_m1_paid_date, 'owner_etai_m1_amount', fieldOverrideReason(d, 'owner_etai_m1_amount'));
  html += internalRow('Etai — M2', 'owner_etai_m2', d.owner_etai_m2_paid, d.owner_etai_m2_amount, d.owner_etai_m2_paid_date, 'owner_etai_m2_amount', fieldOverrideReason(d, 'owner_etai_m2_amount'));
  html += internalRow('Noy — M1', 'owner_noy_m1', d.owner_noy_m1_paid, d.owner_noy_m1_amount, d.owner_noy_m1_paid_date, 'owner_noy_m1_amount', fieldOverrideReason(d, 'owner_noy_m1_amount'));
  html += internalRow('Noy — M2', 'owner_noy_m2', d.owner_noy_m2_paid, d.owner_noy_m2_amount, d.owner_noy_m2_paid_date, 'owner_noy_m2_amount', fieldOverrideReason(d, 'owner_noy_m2_amount'));
  html += internalRow("Joey's Bonus — M1", 'joey_m1', d.joey_m1_paid, d.joey_m1_bonus, d.joey_m1_paid_date, 'joey_m1_bonus', fieldOverrideReason(d, 'joey_m1_bonus'));
  html += internalRow("Joey's Bonus — M2", 'joey', d.joey_paid, d.joey_m2_bonus, d.joey_paid_date, 'joey_m2_bonus', fieldOverrideReason(d, 'joey_m2_bonus'));
  html += `</div>`;
  el.innerHTML = html;

  if (editing) {
    async function sendPayment(recipient, status, date) {
      const paid = status === 'paid';
      const na = status === 'na';
      try {
        DEAL = await api('POST', `/api/deals/${dealId}/payment`, { recipient, paid, date: paid ? date : null, na });
        renderPayment();
        renderAudit();
      } catch (e) { alert(e.message); }
    }
    el.querySelectorAll('.pay-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const dateInput = el.querySelector(`.pay-date[data-recipient="${sel.dataset.recipient}"]`);
        if (dateInput) dateInput.style.display = sel.value === 'paid' ? '' : 'none';
        if (sel.value !== 'paid') {
          sendPayment(sel.dataset.recipient, sel.value, null);
        }
      });
    });
    el.querySelectorAll('.pay-date').forEach((input) => {
      input.addEventListener('change', () => { sendPayment(input.dataset.recipient, 'paid', input.value); });
    });
    wireAmountOverrideButtons();
  }
}


function renderAudit() {
  const log = DEAL.auditLog || [];
  if (!log.length) { document.getElementById('auditBox').innerHTML = '<p style="color:var(--brand-muted); font-size:13px;">No changes logged yet.</p>'; return; }
  document.getElementById('auditBox').innerHTML = log.map((entry) => `
    <div class="audit-item">
      <strong>${entry.field_name}</strong>: ${entry.old_value ?? '∅'} → ${entry.new_value ?? '∅'}
      <div class="meta">${entry.changed_by_email || 'system'} · ${new Date(entry.changed_at).toLocaleString()}${entry.reason ? ' · ' + entry.reason : ''}</div>
    </div>
  `).join('');
}

function wireCloserOverrideForm() {
  let overrideMode = false;
  document.getElementById('closerOverrideBtn').addEventListener('click', () => {
    overrideMode = !overrideMode;
    const box = document.getElementById('closerOverrideForm');
    if (!overrideMode) { box.style.display = 'none'; box.innerHTML = ''; return; }
    const d = DEAL;
    const isLocked = lockedFieldsFor(CLOSER_CALC_FIELDS).length > 0;
    box.style.display = 'block';
    box.innerHTML = `
      <p style="font-size:12px; color:var(--brand-muted); margin-top:0;">Every field here is optional — leave blank to keep it as-is. Typing a Pay Scale Rate auto-fills Rep Pool / Closer Pay (gross) / Closer Pay (net) below (still editable afterward).</p>
      <label>Net PPW <span style="color:var(--brand-muted); font-weight:400;">(current: ${d.net_ppw ?? '—'})</span></label>
      <input type="number" step="0.0001" id="ov_net_ppw" placeholder="leave blank to keep current">
      <label>Gross <span style="color:var(--brand-muted); font-weight:400;">(current: ${fmtMoney(d.gross_amount)})</span></label>
      <input type="number" step="0.01" id="ov_gross_amount" placeholder="leave blank to keep current">
      <label>Pay Scale Rate ($/kW) <span style="color:var(--brand-muted); font-weight:400;">(current: ${fmtRate2(d.pay_scale_rate)})</span></label>
      <input type="number" step="0.01" id="ov_pay_scale_rate" placeholder="leave blank to keep current">
      <label>Rep Pool <span style="color:var(--brand-muted); font-weight:400;">(current: ${fmtMoney(d.rep_pool)})</span></label>
      <input type="number" step="0.01" id="ov_rep_pool" placeholder="leave blank to keep current">
      <label>Closer Pay (gross) <span style="color:var(--brand-muted); font-weight:400;">(current: ${fmtMoney(d.closer_pay_gross)})</span></label>
      <input type="number" step="0.01" id="ov_closer_pay_gross" placeholder="leave blank to keep current">
      <label>Closer Pay (net) <span style="color:var(--brand-muted); font-weight:400;">(current: ${fmtMoney(d.closer_pay_net)})</span></label>
      <input type="number" step="0.01" id="ov_closer_pay_net" placeholder="leave blank to keep current">
      <label>Reason for override (required)</label><textarea id="ov_reason" rows="2"></textarea>
      <div style="display:flex; gap:8px;">
        <button class="btn small" id="saveCloserOverrideBtn" style="width:auto;">Save Override</button>
        ${isLocked ? '<button class="btn secondary small" id="clearCloserOverrideBtn" style="width:auto;">Turn Off &amp; Recalculate</button>' : ''}
      </div>`;
    const userEdited = { rep_pool: false, closer_pay_gross: false, closer_pay_net: false };
    ['ov_rep_pool', 'ov_closer_pay_gross', 'ov_closer_pay_net'].forEach((inputId) => {
      const field = inputId.slice(3);
      document.getElementById(inputId).addEventListener('input', () => { userEdited[field] = true; });
    });
    document.getElementById('ov_pay_scale_rate').addEventListener('input', (e) => {
      const rate = parseFloat(e.target.value);
      if (isNaN(rate) || !SETTINGS) return;
      const kw = DEAL.system_size_kw || 0, paySplit = DEAL.pay_split || 0.5, pool = rate * kw * paySplit;
      const hasSetter = !!DEAL.setter_rep_id, closerPayGross = hasSetter ? pool * SETTINGS.closer_split_pct : pool;
      const cashbackDeduction = (DEAL.cashback_amount || 0) * SETTINGS.cashback_split_pct;
      const closerNet = closerPayGross - cashbackDeduction - (DEAL.advance_deduction || 0) - (DEAL.deduction_other || 0);
      if (!userEdited.rep_pool) document.getElementById('ov_rep_pool').value = round2(pool);
      if (!userEdited.closer_pay_gross) document.getElementById('ov_closer_pay_gross').value = round2(closerPayGross);
      if (!userEdited.closer_pay_net) document.getElementById('ov_closer_pay_net').value = round2(closerNet);
    });
    document.getElementById('saveCloserOverrideBtn').addEventListener('click', async () => {
      const reason = val('ov_reason');
      if (!reason) { alert('Please give a reason for the override — this is logged for the audit trail.'); return; }
      try {
        DEAL = await api('POST', `/api/deals/${dealId}/override`, { override: true, reason, fields: { net_ppw: floatval('ov_net_ppw'), gross_amount: floatval('ov_gross_amount'), pay_scale_rate: floatval('ov_pay_scale_rate'), rep_pool: floatval('ov_rep_pool'), closer_pay_gross: floatval('ov_closer_pay_gross'), closer_pay_net: floatval('ov_closer_pay_net') } });
        overrideMode = false; box.style.display = 'none'; renderCalc(); renderAudit();
      } catch (e) { alert(e.message); }
    });
    const clearBtn = document.getElementById('clearCloserOverrideBtn');
    if (clearBtn) clearBtn.addEventListener('click', async () => {
      if (!confirm('This will discard the Closer override and replace it with freshly computed numbers. This cannot be undone — continue?')) return;
      try {
        DEAL = await api('POST', `/api/deals/${dealId}/override`, { override: false, fields: CLOSER_CALC_FIELDS, reason: 'Closer override removed' });
        DEAL = await api('POST', `/api/deals/${dealId}/recalculate`, {});
        overrideMode = false; box.style.display = 'none'; renderCalc(); renderAudit();
      } catch (e) { alert(e.message); }
    });
  });
}

function wireSetterOverrideForm() {
  let overrideMode = false;
  document.getElementById('setterOverrideBtn').addEventListener('click', () => {
    overrideMode = !overrideMode;
    const box = document.getElementById('setterOverrideForm');
    if (!overrideMode) { box.style.display = 'none'; box.innerHTML = ''; return; }
    const d = DEAL;
    const isLocked = lockedFieldsFor(SETTER_CALC_FIELDS).length > 0;
    box.style.display = 'block';
    box.innerHTML = `
      <p style="font-size:12px; color:var(--brand-muted); margin-top:0;">Every field here is optional — leave blank to keep it as-is. Typing a Pay Scale Rate auto-fills Rep Pool / Setter Pay below (still editable afterward).</p>
      <label>Net PPW <span style="color:var(--brand-muted); font-weight:400;">(current: ${d.setter_calc_net_ppw ?? '—'})</span></label>
      <input type="number" step="0.0001" id="ov_setter_net_ppw" placeholder="leave blank to keep current">
      <label>Pay Scale Rate ($/kW) <span style="color:var(--brand-muted); font-weight:400;">(current: ${fmtRate2(d.setter_calc_pay_scale_rate)})</span></label>
      <input type="number" step="0.01" id="ov_setter_pay_scale_rate" placeholder="leave blank to keep current">
      <label>Rep Pool <span style="color:var(--brand-muted); font-weight:400;">(current: ${fmtMoney(d.setter_calc_rep_pool)})</span></label>
      <input type="number" step="0.01" id="ov_setter_rep_pool" placeholder="leave blank to keep current">
      <label>Setter Pay <span style="color:var(--brand-muted); font-weight:400;">(current: ${fmtMoney(d.setter_pay)})</span></label>
      <input type="number" step="0.01" id="ov_setter_pay_only" placeholder="leave blank to keep current">
      <label>Reason for override (required)</label><textarea id="ov_setter_reason" rows="2"></textarea>
      <div style="display:flex; gap:8px;">
        <button class="btn small" id="saveSetterOverrideBtn" style="width:auto;">Save Override</button>
        ${isLocked ? '<button class="btn secondary small" id="clearSetterOverrideBtn" style="width:auto;">Turn Off &amp; Recalculate</button>' : ''}
      </div>`;
    const userEdited = { rep_pool: false, pay: false };
    document.getElementById('ov_setter_rep_pool').addEventListener('input', () => { userEdited.rep_pool = true; });
    document.getElementById('ov_setter_pay_only').addEventListener('input', () => { userEdited.pay = true; });
    document.getElementById('ov_setter_pay_scale_rate').addEventListener('input', (e) => {
      const rate = parseFloat(e.target.value);
      if (isNaN(rate) || !SETTINGS) return;
      const kw = DEAL.setter_calc_system_size_kw || 0, paySplit = DEAL.pay_split || 0.5, pool = rate * kw * paySplit;
      if (!userEdited.rep_pool) document.getElementById('ov_setter_rep_pool').value = round2(pool);
      if (!userEdited.pay) document.getElementById('ov_setter_pay_only').value = round2(pool * SETTINGS.setter_split_pct);
    });
    document.getElementById('saveSetterOverrideBtn').addEventListener('click', async () => {
      const reason = val('ov_setter_reason');
      if (!reason) { alert('Please give a reason for the override — this is logged for the audit trail.'); return; }
      try {
        DEAL = await api('POST', `/api/deals/${dealId}/override`, { override: true, reason, fields: { setter_calc_net_ppw: floatval('ov_setter_net_ppw'), setter_calc_pay_scale_rate: floatval('ov_setter_pay_scale_rate'), setter_calc_rep_pool: floatval('ov_setter_rep_pool'), setter_pay: floatval('ov_setter_pay_only') } });
        overrideMode = false; box.style.display = 'none'; renderCalc(); renderAudit();
      } catch (e) { alert(e.message); }
    });
    const clearBtn = document.getElementById('clearSetterOverrideBtn');
    if (clearBtn) clearBtn.addEventListener('click', async () => {
      if (!confirm('This will discard the Setter override and replace it with a freshly computed number. This cannot be undone — continue?')) return;
      try {
        DEAL = await api('POST', `/api/deals/${dealId}/override`, { override: false, fields: SETTER_CALC_FIELDS, reason: 'Setter override removed' });
        DEAL = await api('POST', `/api/deals/${dealId}/recalculate`, {});
        overrideMode = false; box.style.display = 'none'; renderCalc(); renderAudit();
      } catch (e) { alert(e.message); }
    });
  });
}

// --- Main page rendering ---

async function getCachedMeta() {
  const KEY = 'powered_meta_cache', TTL = 5 * 60 * 1000;
  try {
    const cached = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (cached && Date.now() - cached.ts < TTL) return cached.data;
  } catch (e) {}
  const data = await api('GET', '/api/meta');
  try { sessionStorage.setItem(KEY, JSON.stringify({ ts: Date.now(), data })); } catch (e) {}
  return data;
}

async function getCachedSettings() {
  const KEY = 'powered_settings_cache', TTL = 5 * 60 * 1000;
  try {
    const cached = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (cached && Date.now() - cached.ts < TTL) return cached.data;
  } catch (e) {}
  const data = await api('GET', '/api/settings');
  try { sessionStorage.setItem(KEY, JSON.stringify({ ts: Date.now(), data })); } catch (e) {}
  return data;
}

async function init() {
  if (dealId) {
    const [metaResp, dealResp, settingsResp] = await Promise.all([
      getCachedMeta(),
      api('GET', `/api/deals/${dealId}`),
      getCachedSettings()
    ]);
    META = metaResp; DEAL = dealResp; SETTINGS = settingsResp.commissionSettings;
    renderFull();
  } else {
    META = await getCachedMeta();
    renderCreateForm();
  }
}

function renderCreateForm() {
  document.getElementById('pageContent').innerHTML = `
    <div class="card" style="max-width:640px;">
      <p class="section-title">New Deal</p>
      <label>Customer Name</label><input type="text" id="f_customer_name">
      <label>Customer Address</label><input type="text" id="f_customer_address">
      <label>Status</label><select id="f_status_id">${selectOptions(META.statuses, '', 'Select status')}</select>
      <div class="field-row">
        <div><label>Closer</label><select id="f_closer_rep_id">${repOptions('closer', '')}</select></div>
        <div><label>Setter (optional)</label><select id="f_setter_rep_id">${repOptions('setter', '')}</select></div>
      </div>
      <div class="field-row">
        <div><label>System Size (kW)</label><input type="number" step="0.01" id="f_system_size_kw"></div>
        <div><label>Contract Value ($)</label><input type="number" step="0.01" id="f_contract_value"></div>
      </div>
      <button class="btn" id="createBtn" style="margin-top:8px;">Create Deal</button>
    </div>`;
  document.getElementById('createBtn').addEventListener('click', async (e) => {
    guardedClick(e.target, 'Creating…', async () => {
      try {
        const deal = await api('POST', '/api/deals', {
          customer_name: val('f_customer_name'), customer_address: val('f_customer_address'),
          status_id: intval('f_status_id'), closer_rep_id: intval('f_closer_rep_id'), setter_rep_id: intval('f_setter_rep_id'),
          system_size_kw: floatval('f_system_size_kw'), contract_value: floatval('f_contract_value')
        });
        window.location.href = `/admin/deal.html?id=${deal.id}`;
      } catch (e2) { alert(e2.message); }
    });
  });
}

function renderFull() {
  document.querySelector('.topbar h1').textContent = DEAL.customer_name;
  document.getElementById('pageContent').innerHTML = `
    <div class="detail-grid">
      <div>
        <div id="card-project"></div>
        <div id="card-finance"></div>
        <div id="card-adders"></div>
        <div id="card-milestones"></div>
        <div id="card-payment"></div>
        <div id="card-notes"></div>
      </div>
      <div>
        <div class="card" style="margin-bottom:20px;">
          <p class="section-title">Closer Commission Calculator</p>
          <p style="font-size:12px; color:var(--brand-muted); margin:-8px 0 12px;">These numbers only update when you click Recalculate (or add/edit a line item) — saving the form on the left never silently changes them.</p>
          <div id="closerCalcLines"></div>
          <div style="display:flex; gap:8px; margin-top:14px;">
            <button class="btn secondary small" id="recalcBtn">Recalculate</button>
            <button class="btn secondary small" id="closerOverrideBtn"></button>
          </div>
          <div id="closerOverrideForm" style="display:none; margin-top:14px; border-top:1px solid var(--brand-border); padding-top:14px;"></div>
          <div style="margin-top:14px; border-top:1px solid var(--brand-border); padding-top:14px;">
            <div id="estimateField"></div>
          </div>
        </div>

        <div class="card" style="margin-bottom:20px;" id="setterCalcCard">
          <p class="section-title">Setter Commission Calculator</p>
          <p style="font-size:12px; color:var(--brand-muted); margin:-8px 0 12px;">Setters are paid before the deal is funded — enter preliminary numbers here. This is the only thing that determines Setter Pay, and the only thing the setter ever sees for this job.</p>
          <div id="setterCalcInputs"></div>
          <div id="setterCalcLines" style="margin-top:14px;"></div>
          <div style="display:flex; gap:8px; margin-top:14px;">
            <button class="btn secondary small" id="setterOverrideBtn"></button>
          </div>
          <div id="setterOverrideForm" style="display:none; margin-top:14px; border-top:1px solid var(--brand-border); padding-top:14px;"></div>
        </div>

        <div id="card-funds"></div>

        <div class="card" style="margin-bottom:20px;">
          <p class="section-title">Approval Gate</p>
          <div id="approvalBox"></div>
        </div>

        <div class="card">
          <p class="section-title">Audit History</p>
          <div id="auditBox" style="max-height:320px; overflow-y:auto;"></div>
        </div>
      </div>
    </div>

    <div style="position:sticky; bottom:0; background:#fff; border-top:1px solid var(--brand-border); padding:14px 0; margin-top:20px; display:flex; gap:10px; justify-content:flex-end;">
      <button class="btn danger small" id="deleteBtn" style="width:auto; margin-right:auto;">Delete Deal</button>
      <button class="btn secondary small" id="backBtn">Back to Board</button>
    </div>
  `;

  renderProjectDetails();
  renderSystemFinance();
  renderAdders();
  renderMilestoneDates();
  renderAdminNotes();
  renderCalc();
  renderApproval();
  renderPayment();
  renderAudit();
  renderOriginalEstimate();
  wireEvents();
}

function wireEvents() {
  document.getElementById('recalcBtn').addEventListener('click', (e) => guardedClick(e.target, 'Recalculating…', async () => {
    if (DEAL.manual_override) {
      alert("This deal has a manual override active — Recalculate won't touch those fields. To discard a specific override, use that calculator's \"Edit Override\" → \"Turn Off & Recalculate\".");
      return;
    }
    try { DEAL = await api('POST', `/api/deals/${dealId}/recalculate`, {}); renderCalc(); } catch (e2) { alert(e2.message); }
  }));

  document.getElementById('deleteBtn').addEventListener('click', (e) => guardedClick(e.target, 'Deleting…', async () => {
    if (!confirm(`Delete "${DEAL.customer_name}" permanently? This cannot be undone.`)) return;
    try { await api('DELETE', `/api/deals/${dealId}`); window.location.href = '/admin/board.html'; } catch (e2) { alert(e2.message); }
  }));

  document.getElementById('backBtn').addEventListener('click', () => { window.location.href = '/admin/board.html'; });

  wireCloserOverrideForm();
  wireSetterOverrideForm();
}

init();
