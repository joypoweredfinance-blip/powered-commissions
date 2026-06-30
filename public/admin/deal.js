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

// Disables a button for the duration of an async action so a fast double-click (or a slow
// network response) can never fire the same create/save/delete request twice.
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

// Any rep can be a Closer or a Setter — the role is decided per-deal here, not pre-assigned
// on the Reps page, so this shows the full active roster for both dropdowns.
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
  // If the deal already has a value that isn't in the list (e.g. legacy free-text data), keep it visible and selected.
  if (!hasCurrent) html += `<option value="${currentValue}" selected>${currentValue}</option>`;
  el.innerHTML = html;
}

// Funding Status is a fixed, closed list (not the flexible admin-editable CRM status list) —
// plus a free-text override for the rare case that doesn't fit one of these.
const FUNDING_STATUSES = [
  'M1 Pending', 'M1 Approved - Awaiting Funding', 'M1 Rejected',
  'M2 Pending', 'M2 Approved - Awaiting Funding', 'M2 Rejected Clawback',
  'M1 Funded', 'M1+M2 Funded'
];
const ADDER_CATEGORY_LABELS = { mpu: 'MPU', battery: 'Battery', reroof_sow: 'Roof Costs', permit: 'Permit', misc: 'Miscellaneous', other: 'Other' };

function selectOptions(list, selected, placeholder, labelKey = 'label') {
  let html = `<option value="">${placeholder}</option>`;
  list.forEach((item) => {
    html += `<option value="${item.id}" ${String(item.id) === String(selected) ? 'selected' : ''}>${item[labelKey] || item.name}</option>`;
  });
  return html;
}

async function init() {
  META = await api('GET', '/api/meta');
  if (dealId) {
    DEAL = await api('GET', `/api/deals/${dealId}`);
    const settingsResp = await api('GET', '/api/settings');
    SETTINGS = settingsResp.commissionSettings;
    renderFull();
  } else {
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
      <button class="btn" id="createBtn">Create Deal</button>
    </div>
  `;
  document.getElementById('createBtn').addEventListener('click', (e) => guardedClick(e.target, 'Creating…', async () => {
    const data = {
      customer_name: val('f_customer_name'),
      customer_address: val('f_customer_address'),
      status_id: intval('f_status_id'),
      closer_rep_id: intval('f_closer_rep_id'),
      setter_rep_id: intval('f_setter_rep_id'),
      system_size_kw: floatval('f_system_size_kw'),
      contract_value: floatval('f_contract_value'),
      pay_split: 0.5
    };
    if (!data.customer_name) { alert('Customer name is required.'); return; }
    try {
      const deal = await api('POST', '/api/deals', data);
      window.location.href = `/admin/deal.html?id=${deal.id}`;
    } catch (e) { alert(e.message); }
  }));
}

function renderFull() {
  document.querySelector('.topbar h1').textContent = DEAL.customer_name;
  document.getElementById('pageContent').innerHTML = `
    <div class="detail-grid">
      <div>
        <div class="card" style="margin-bottom:20px;">
          <p class="section-title">Project Details</p>
          <div class="field-row">
            <div><label>Customer Name</label><input type="text" id="f_customer_name"></div>
            <div><label>Customer Address</label><input type="text" id="f_customer_address"></div>
          </div>
          <div class="field-row">
            <div><label>Customer Phone</label><input type="text" id="f_customer_phone"></div>
            <div><label>CRM Status</label><select id="f_status_id"></select></div>
          </div>
          <div class="field-row">
            <div>
              <label>Funding Status</label>
              <select id="f_funding_status">
                <option value="">— Select —</option>
                ${FUNDING_STATUSES.map((s) => `<option value="${s}">${s}</option>`).join('')}
              </select>
            </div>
            <div><label>Funding Status Override <span style="font-weight:400; text-transform:none; font-size:12px; color:var(--brand-muted);">(free text, takes precedence if filled in)</span></label><input type="text" id="f_funding_status_override" placeholder="leave blank to use the dropdown above"></div>
          </div>
          <div class="field-row">
            <div><label>Closer</label><select id="f_closer_rep_id"></select></div>
            <div><label>Setter (optional)</label><select id="f_setter_rep_id"></select></div>
          </div>
          <div class="field-row cols-3">
            <div><label>Date Signed</label><input type="date" id="f_date_signed"></div>
            <div><label>Install Date</label><input type="date" id="f_install_date"></div>
            <div><label>Solar Date</label><input type="date" id="f_install_completed_date"></div>
          </div>
        </div>

        <div class="card" style="margin-bottom:20px;">
          <p class="section-title">System &amp; Finance</p>
          <div class="field-row cols-3">
            <div><label>Installer</label><select id="f_installer_id"></select></div>
            <div><label>Financier</label><select id="f_financier_id"></select></div>
            <div><label>Module Type</label>
              <div style="display:flex; gap:6px;">
                <select id="f_module_type" style="flex:1;"></select>
                <button type="button" class="icon-btn add-option-btn" data-category="module_type" data-target="f_module_type" title="Add a new option" style="border:1px solid var(--brand-border); border-radius:8px;">+</button>
              </div>
            </div>
          </div>
          <div class="field-row cols-3">
            <div><label>Battery Type</label>
              <div style="display:flex; gap:6px;">
                <select id="f_battery_type" style="flex:1;"></select>
                <button type="button" class="icon-btn add-option-btn" data-category="battery_type" data-target="f_battery_type" title="Add a new option" style="border:1px solid var(--brand-border); border-radius:8px;">+</button>
              </div>
            </div>
            <div><label># Batteries</label><input type="number" id="f_num_batteries"></div>
            <div><label>System Size (kW)</label><input type="number" step="0.01" id="f_system_size_kw"></div>
          </div>
          <div class="field-row cols-3">
            <div><label>Panel Count</label><input type="number" id="f_panel_count"></div>
            <div><label>Panel Watts</label><input type="number" id="f_panel_watts"></div>
            <div><label>Annual Production (kWh)</label><input type="number" id="f_annual_production_kwh"></div>
          </div>
          <div class="field-row cols-3">
            <div><label>Contract Value ($)</label><input type="number" step="0.01" id="f_contract_value"></div>
            <div><label>EPC Rate ($/W, informational)</label><input type="number" step="0.01" id="f_epc_rate_per_watt"></div>
            <div><label>Monthly Payment ($)</label><input type="number" step="0.01" id="f_monthly_payment"></div>
          </div>
          <div class="field-row cols-3">
            <div><label>Rate per kWh</label><input type="number" step="0.0001" id="f_rate_per_kwh"></div>
            <div><label>Escalator (%)</label><input type="number" step="0.01" id="f_escalator_pct"></div>
            <div><label>Cashback Amount ($)</label><input type="number" step="0.01" id="f_cashback_amount"></div>
          </div>
          <div class="field-row">
            <div>
              <label><input type="checkbox" id="f_is_referral" style="width:auto; margin-right:6px;">Referral deal (75% pay split)</label>
            </div>
            <div><label>Pay Split</label><input type="number" step="0.01" id="f_pay_split"></div>
          </div>
        </div>

        <div class="card" style="margin-bottom:20px;">
          <p class="section-title">Adders <span style="font-weight:400; text-transform:none; font-size:12px;">— everything here counts toward Net PPW unless "EPC/excluded" is checked</span></p>
          <div id="addersList"></div>
          <button class="btn secondary small" id="addAdderBtn">+ Add Line Item</button>
        </div>

        <div class="card" style="margin-bottom:20px;">
          <p class="section-title">Milestone Dates</p>
          <div class="field-row cols-3">
            <div><label>NTP Approved</label><input type="date" id="f_ntp_approved_date"></div>
            <div><label>M1 Approved</label><input type="date" id="f_m1_approved_date"></div>
            <div><label>M1 Commission Paid</label><input type="date" id="f_m1_paid_date"></div>
          </div>
          <div class="field-row cols-3">
            <div><label>PTO Granted</label><input type="date" id="f_pto_granted_date"></div>
            <div><label>M2 Approved</label><input type="date" id="f_m2_approved_date"></div>
            <div><label>M2 Commission Paid</label><input type="date" id="f_m2_paid_date"></div>
          </div>
        </div>

        <div class="card">
          <p class="section-title">Payment Status</p>
          <div id="paymentBox"></div>
        </div>

      </div>

      <div>
        <div class="card" style="margin-bottom:20px;">
          <p class="section-title">Closer Commission Calculator</p>
          <p style="font-size:12px; color:var(--brand-muted); margin:-8px 0 12px;">
            These numbers only update when you click Recalculate (or add/edit a line item below) —
            saving the form on the left never silently changes them.
          </p>
          <div id="closerCalcLines"></div>
          <div style="display:flex; gap:8px; margin-top:14px;">
            <button class="btn secondary small" id="recalcBtn">Recalculate</button>
            <button class="btn secondary small" id="closerOverrideBtn"></button>
          </div>
          <div id="closerOverrideForm" style="display:none; margin-top:14px; border-top:1px solid var(--brand-border); padding-top:14px;"></div>
          <div style="margin-top:14px; border-top:1px solid var(--brand-border); padding-top:14px;">
            <label>Original Commission Calculator Estimate ($) <span style="font-weight:400; color:var(--brand-muted); font-size:12px;">— just for comparison, never used in any calculation</span></label>
            <div style="display:flex; gap:8px;">
              <input type="number" step="0.01" id="f_original_estimate_amount" style="margin:0;">
              <button class="btn secondary small" id="saveOriginalEstimateBtn" style="width:auto;">Save</button>
            </div>
            <div style="margin-top:12px;">
              <label style="font-size:12px;">1 — Estimate</label>
              <div id="fileBox_estimate"></div>
            </div>
            <div style="margin-top:12px;">
              <label style="font-size:12px;">2 — Final</label>
              <div id="fileBox_final"></div>
            </div>
          </div>
        </div>

        <div class="card" style="margin-bottom:20px; display:none;" id="setterCalcCard">
          <p class="section-title">Setter Commission Calculator</p>
          <p style="font-size:12px; color:var(--brand-muted); margin:-8px 0 12px;">
            Setters are paid about a week after install, before the deal is funded and before
            real costs are final — so enter your own preliminary numbers below rather than
            relying on the live Closer/Company data above. This is the only thing that
            determines Setter Pay, and the only thing the setter ever sees for this job.
          </p>
          <div id="setterCalcInputs"></div>
          <div id="setterCalcLines" style="margin-top:14px;"></div>
          <div style="display:flex; gap:8px; margin-top:14px;">
            <button class="btn secondary small" id="setterOverrideBtn"></button>
          </div>
          <div id="setterOverrideForm" style="display:none; margin-top:14px; border-top:1px solid var(--brand-border); padding-top:14px;"></div>
        </div>

        <div class="card" style="margin-bottom:20px;">
          <p class="section-title">Funds Received <span style="font-weight:400; text-transform:none; font-size:12px;">— money POWERED actually receives from the installer</span></p>
          <div id="fundsReceivedBox"></div>
        </div>

        <div class="card" style="margin-bottom:20px;">
          <p class="section-title">Approval Gate</p>
          <div id="approvalBox"></div>
        </div>

        <div class="card" style="margin-bottom:20px;">
          <p class="section-title">Admin Notes <span style="font-weight:400; text-transform:none;">(never visible to reps)</span></p>
          <textarea id="f_admin_notes" rows="4"></textarea>
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
      <button class="btn small" id="saveBtn" style="width:auto;">Save Changes</button>
    </div>
  `;

  populateFields();
  renderAdders();
  renderCalc();
  renderFundsReceived();
  renderApproval();
  renderPayment();
  renderAudit();
  renderOriginalEstimate();
  wireEvents();
}

function populateFields() {
  const d = DEAL;
  document.getElementById('f_customer_name').value = d.customer_name || '';
  document.getElementById('f_customer_address').value = d.customer_address || '';
  document.getElementById('f_customer_phone').value = d.customer_phone || '';
  document.getElementById('f_status_id').innerHTML = selectOptions(META.statuses, d.status_id, 'No status');
  document.getElementById('f_funding_status').value = d.funding_status || '';
  document.getElementById('f_funding_status_override').value = d.funding_status_override || '';
  document.getElementById('f_closer_rep_id').innerHTML = repOptions('closer', d.closer_rep_id);
  document.getElementById('f_setter_rep_id').innerHTML = repOptions('setter', d.setter_rep_id);
  document.getElementById('f_date_signed').value = (d.date_signed || '').slice(0, 10);
  document.getElementById('f_install_date').value = (d.install_date || '').slice(0, 10);
  document.getElementById('f_install_completed_date').value = (d.install_completed_date || '').slice(0, 10);

  document.getElementById('f_installer_id').innerHTML = selectOptions(META.installers, d.installer_id, '— Select —');
  document.getElementById('f_financier_id').innerHTML = selectOptions(META.financiers, d.financier_id, '— Select —');
  populateDropdownSelect('f_module_type', 'module_type', d.module_type);
  populateDropdownSelect('f_battery_type', 'battery_type', d.battery_type);
  document.getElementById('f_num_batteries').value = d.num_batteries ?? '';
  document.getElementById('f_system_size_kw').value = d.system_size_kw ?? '';
  document.getElementById('f_panel_count').value = d.panel_count ?? '';
  document.getElementById('f_panel_watts').value = d.panel_watts ?? '';
  document.getElementById('f_annual_production_kwh').value = d.annual_production_kwh ?? '';
  document.getElementById('f_contract_value').value = d.contract_value ?? '';
  document.getElementById('f_epc_rate_per_watt').value = d.epc_rate_per_watt ?? '';
  document.getElementById('f_monthly_payment').value = d.monthly_payment ?? '';
  document.getElementById('f_rate_per_kwh').value = d.rate_per_kwh ?? '';
  document.getElementById('f_escalator_pct').value = d.escalator_pct ?? '';
  document.getElementById('f_cashback_amount').value = d.cashback_amount ?? '';
  document.getElementById('f_is_referral').checked = !!d.is_referral;
  document.getElementById('f_pay_split').value = d.pay_split ?? 0.5;

  document.getElementById('f_ntp_approved_date').value = (d.ntp_approved_date || '').slice(0, 10);
  document.getElementById('f_m1_approved_date').value = (d.m1_approved_date || '').slice(0, 10);
  document.getElementById('f_m1_paid_date').value = (d.m1_paid_date || '').slice(0, 10);
  document.getElementById('f_pto_granted_date').value = (d.pto_granted_date || '').slice(0, 10);
  document.getElementById('f_m2_approved_date').value = (d.m2_approved_date || '').slice(0, 10);
  document.getElementById('f_m2_paid_date').value = (d.m2_paid_date || '').slice(0, 10);

  document.getElementById('f_admin_notes').value = d.admin_notes || '';
  document.getElementById('f_original_estimate_amount').value = d.original_estimate_amount ?? '';
}

// Receipt/Proof is admin-only internal documentation — it's never sent to any rep-facing
// route (those only ever get computeAdderCategoryTotals() output), so there's no risk of a
// rep seeing this regardless of what's rendered here.
function renderAdders() {
  const list = document.getElementById('addersList');
  if (!DEAL.adders.length) {
    list.innerHTML = `<p style="color:var(--brand-muted); font-size:13px;">No line items yet — add MPU, battery, re-roof, permits, etc.</p>`;
  } else {
    list.innerHTML = DEAL.adders.map((a) => `
      <div class="adder-row" data-id="${a.id}">
        <input type="text" class="a-label" value="${(a.label || '').replace(/"/g, '&quot;')}" placeholder="Label">
        <select class="a-category">
          ${Object.entries(ADDER_CATEGORY_LABELS).map(([c, label]) => `<option value="${c}" ${c === a.category ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
        <input type="number" step="0.01" class="a-amount" value="${a.amount}">
        <label style="display:flex; align-items:center; gap:4px; font-size:12px; white-space:nowrap;">
          <input type="checkbox" class="a-hardcost" ${a.counts_as_hard_cost ? 'checked' : ''} style="width:auto;">Counts toward PPW
        </label>
        <button class="icon-btn a-delete" title="Remove">✕</button>
      </div>
      <div class="adder-receipt-row" data-id="${a.id}" style="display:flex; align-items:center; gap:8px; margin:-4px 0 10px 2px; font-size:12px; flex-wrap:wrap;">
        <span style="color:var(--brand-muted); font-weight:600;">Receipt / Proof:</span>
        ${a.receiptFile
          ? `<a href="/api/deals/${dealId}/adders/${a.id}/file" target="_blank" rel="noopener">${a.receiptFile.file_name}</a><button class="icon-btn a-receipt-remove" title="Remove" style="padding:0 4px;">✕</button>`
          : '<span style="color:var(--brand-muted);">No file attached</span>'}
        <input type="file" class="a-receipt-input" style="font-size:11px; max-width:150px; margin:0;">
        <button class="btn secondary small a-receipt-upload" style="width:auto; padding:3px 10px; font-size:11px;">${a.receiptFile ? 'Replace' : 'Attach'}</button>
      </div>
    `).join('');
  }
  list.querySelectorAll('.adder-row').forEach((row) => {
    const id = row.dataset.id;
    const save = async () => {
      try {
        DEAL = await api('PUT', `/api/deals/${dealId}/adders/${id}`, {
          label: row.querySelector('.a-label').value,
          category: row.querySelector('.a-category').value,
          amount: parseFloat(row.querySelector('.a-amount').value) || 0,
          counts_as_hard_cost: row.querySelector('.a-hardcost').checked
        });
        renderCalc();
      } catch (e) { alert(e.message); }
    };
    row.querySelector('.a-label').addEventListener('blur', save);
    row.querySelector('.a-category').addEventListener('change', save);
    row.querySelector('.a-amount').addEventListener('blur', save);
    row.querySelector('.a-hardcost').addEventListener('change', save);
    row.querySelector('.a-delete').addEventListener('click', async () => {
      try {
        DEAL = await api('DELETE', `/api/deals/${dealId}/adders/${id}`);
        renderAdders();
        renderCalc();
      } catch (e) { alert(e.message); }
    });
  });
  list.querySelectorAll('.adder-receipt-row').forEach((row) => {
    const id = row.dataset.id;
    row.querySelector('.a-receipt-upload').addEventListener('click', async () => {
      const input = row.querySelector('.a-receipt-input');
      const file = input.files[0];
      if (!file) { alert('Choose a file first.'); return; }
      const formData = new FormData();
      formData.append('file', file);
      try {
        const res = await fetch(`/api/deals/${dealId}/adders/${id}/file`, { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        DEAL = data;
        renderAdders();
      } catch (e) { alert(e.message); }
    });
    const removeBtn = row.querySelector('.a-receipt-remove');
    if (removeBtn) removeBtn.addEventListener('click', async () => {
      if (!confirm('Remove this Receipt/Proof file?')) return;
      try {
        DEAL = await api('DELETE', `/api/deals/${dealId}/adders/${id}/file`);
        renderAdders();
      } catch (e) { alert(e.message); }
    });
  });
}

function calcRow(label, value, opts = {}) {
  const cls = opts.total ? 'calc-line total' : 'calc-line';
  return `<div class="${cls}"><span class="lbl">${label}</span><span class="val">${value}</span></div>`;
}

// Pay Scale Rate is a dollar value (per kW), so it follows the same $ xx,xxx.xx convention as
// every other money figure — just with "/kW" appended.
function fmtRate2(n) { return (n === null || n === undefined || n === '') ? '—' : `${fmtMoney(n)}/kW`; }

// Plain manual deductions (same treatment as cashback_amount) — editable right where they're
// used, since seeing the Total respond immediately is the point.
function calcEditableRow(label, value, fieldName) {
  return `
    <div class="calc-line">
      <span class="lbl">${label}</span>
      <span class="val" style="display:flex; align-items:center; gap:6px; font-weight:400;">
        <input type="number" step="0.01" class="calc-amount-input" data-field="${fieldName}" value="${value ?? ''}" style="margin:0; max-width:100px; padding:4px 8px; font-weight:700;">
        <button class="btn secondary small calc-amount-save" data-field="${fieldName}" style="width:auto; padding:4px 10px;">Save</button>
      </span>
    </div>
  `;
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

// Closer and Setter are computed from the same shared upstream inputs (Net PPW, Gross, Pay
// Scale Rate, Rep Pool) but are otherwise independent from here down — separate totals,
// separate overrides, separate approval for each role's own view. Cashback/Advance/Other
// deductions only ever touch the Closer's number, matching the engine's existing rule that
// the setter is never touched by any deduction.
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

function renderCalc() {
  renderCloserCalc();
  renderSetterCalc();
  // Wired once, after both cards exist in the DOM — wiring it inside each render function
  // would double-attach listeners on Closer's buttons (still in the DOM from the first call)
  // every time the Setter card also rendered.
  wireCalcAmountSaveButtons();
  wirePayScaleSelector();
  renderFundsReceived();
}

// Auto-filled from the deal's real adders below — same category folding ("other" -> misc) as
// the rep-facing computeAdderCategoryTotals(), just computed locally since DEAL.adders is
// already loaded client-side and this is admin-only (Permit included too, unlike the Setter
// Calculator's preliminary form which is deliberately limited to MPU/Roof/Battery/Misc).
function closerAdderCategoryTotals(adders) {
  const totals = { mpu: 0, reroof_sow: 0, battery: 0, permit: 0, misc: 0 };
  (adders || []).forEach((a) => {
    const cat = a.category === 'other' ? 'misc' : a.category;
    if (totals[cat] !== undefined) totals[cat] = round2(totals[cat] + (Number(a.amount) || 0));
  });
  return totals;
}

// Small, deliberate: Joy's own direct pick of which tier table this deal uses, independent of
// whichever scale the closer rep happens to be assigned on the Reps page. Drives both this
// card's calculation and the Setter Calculator's (they always share one scale per deal).
function payScaleSelectorHtml(d) {
  const options = (META.payScales || []).map((p) => `<option value="${p.id}" ${String(p.id) === String(d.pay_scale_id) ? 'selected' : ''}>${p.name}</option>`).join('');
  return `
    <div class="calc-line">
      <span class="lbl">Pay Scale</span>
      <span class="val" style="display:flex; align-items:center; gap:6px; font-weight:400;">
        <select id="payScaleSelect" style="margin:0; max-width:170px; padding:4px 8px; font-weight:700;">${options}</select>
        <button class="btn secondary small" id="payScaleSaveBtn" style="width:auto; padding:4px 10px;">Save</button>
      </span>
    </div>
  `;
}

function wirePayScaleSelector() {
  const btn = document.getElementById('payScaleSaveBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const value = document.getElementById('payScaleSelect').value;
    try {
      DEAL = await api('PUT', `/api/deals/${dealId}`, { pay_scale_id: Number(value) });
      renderCalc();
    } catch (e) { alert(e.message); }
  });
}

function renderCloserCalc() {
  const d = DEAL;
  let html = '';
  html += payScaleSelectorHtml(d);
  if (d.below_floor) {
    html += `<div class="error-msg show" style="margin-bottom:14px;">Below the pay-scale hard floor — needs manual approval before any commission is paid.</div>`;
  }
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

// Entirely separate from the Closer card above — Joy's own preliminary numbers, not the
// deal's real contract_value/adders/system_size_kw, since the setter gets paid before those
// are final. These inputs are the ONLY thing that drives setter_pay, and the ONLY thing the
// setter ever sees for this job.
function renderSetterCalc() {
  const d = DEAL;
  const card = document.getElementById('setterCalcCard');
  card.style.display = d.setter_rep_id ? 'block' : 'none';
  if (!d.setter_rep_id) return;

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
  if (d.setter_calc_below_floor) {
    html += `<div class="error-msg show" style="margin-bottom:14px;">Below the pay-scale hard floor on these preliminary numbers — needs manual review before any setter pay is paid.</div>`;
  }
  html += calcRow('Net PPW', d.setter_calc_net_ppw ?? '—');
  html += calcRow('Pay Scale Rate', fmtRate2(d.setter_calc_pay_scale_rate));
  html += calcRow('Rep Pool', fmtMoney(d.setter_calc_rep_pool));
  html += calcRow('Setter Pay', fmtMoney(d.setter_pay), { total: true });
  html += overrideBadgeHtml(lockedFieldsFor(SETTER_CALC_FIELDS));
  document.getElementById('setterCalcLines').innerHTML = html;
  document.getElementById('setterOverrideBtn').textContent = lockedFieldsFor(SETTER_CALC_FIELDS).length ? 'Edit Override' : 'Manual Override';
}

// `parseFloat(x) || null` turns an explicit 0 into null, since 0 is falsy in JS — every plain
// amount save in this file should go through this instead so a real $0 entry actually sticks.
function numOrNull(v) {
  const n = parseFloat(v);
  return v === '' || v === null || v === undefined || isNaN(n) ? null : n;
}

function fieldOverrideReason(deal, field) {
  try { return JSON.parse(deal.field_override_reasons || '{}')[field] || null; } catch (e) { return null; }
}

function expectedAmountRow(label, amount, overrideField, reason) {
  return `
    <div style="margin-bottom:6px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span class="lbl" style="color:var(--brand-muted);">${label}</span>
        <div style="display:flex; align-items:center; gap:8px;">
          <input type="number" step="0.01" class="amount-override" data-field="${overrideField}" value="${amount ?? ''}" style="margin:0; max-width:130px;">
          <button class="btn secondary small amount-save" data-field="${overrideField}" style="width:auto;">Save</button>
        </div>
      </div>
      ${reason ? `<div style="font-size:11px; color:var(--brand-muted); margin-top:2px;">Override reason: ${reason}</div>` : ''}
    </div>
  `;
}

function renderFundsReceived() {
  const d = DEAL;
  const totalReceived = (d.funds_received_m1 || 0) + (d.funds_received_m2 || 0);
  document.getElementById('fundsReceivedBox').innerHTML = `
    ${expectedAmountRow('Expected M1', d.expected_m1_amount, 'expected_m1_amount', fieldOverrideReason(d, 'expected_m1_amount'))}
    <div class="field-row" style="margin:6px 0 14px;">
      <div><label>Funds Pending M1 ($)</label><input type="number" step="0.01" id="fp_m1_amount" value="${d.funds_pending_m1 ?? ''}"></div>
      <div><label>Received M1 ($)</label><input type="number" step="0.01" id="fr_m1_amount" value="${d.funds_received_m1 ?? ''}"></div>
      <div><label>Date Received</label><input type="date" id="fr_m1_date" value="${(d.funds_received_m1_date || '').slice(0, 10)}"></div>
    </div>
    ${expectedAmountRow('Expected M2', d.expected_m2_amount, 'expected_m2_amount', fieldOverrideReason(d, 'expected_m2_amount'))}
    <div class="field-row" style="margin:6px 0 14px;">
      <div><label>Funds Pending M2 ($)</label><input type="number" step="0.01" id="fp_m2_amount" value="${d.funds_pending_m2 ?? ''}"></div>
      <div><label>Received M2 ($)</label><input type="number" step="0.01" id="fr_m2_amount" value="${d.funds_received_m2 ?? ''}"></div>
      <div><label>Date Received</label><input type="date" id="fr_m2_date" value="${(d.funds_received_m2_date || '').slice(0, 10)}"></div>
    </div>
    <div class="calc-line total"><span class="lbl">Total Received</span><span class="val">${fmtMoney(totalReceived)}</span></div>
    <button class="btn secondary small" id="saveFundsBtn" style="width:auto; margin-top:10px;">Save Funds Pending / Received</button>
  `;
  document.getElementById('saveFundsBtn').addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      DEAL = await api('PUT', `/api/deals/${dealId}`, {
        funds_pending_m1: numOrNull(val('fp_m1_amount')),
        funds_pending_m2: numOrNull(val('fp_m2_amount')),
        funds_received_m1: numOrNull(val('fr_m1_amount')),
        funds_received_m1_date: val('fr_m1_date') || null,
        funds_received_m2: numOrNull(val('fr_m2_amount')),
        funds_received_m2_date: val('fr_m2_date') || null
      });
      renderFundsReceived();
    } catch (err) { alert(err.message); }
    btn.disabled = false;
    btn.textContent = 'Save Funds Pending / Received';
  });
  wireAmountOverrideButtons();
}

function fmtFileSize(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Self-contained per slot: the Save/Upload/Remove actions here only ever re-render this one
// box, never the rest of the page — these are purely reference attachments with no bearing on
// any calculation, so nothing else should ever need to refresh because of them.
function renderEstimateFileSlot(slot) {
  const f = DEAL.estimateFiles ? DEAL.estimateFiles[slot] : null;
  const box = document.getElementById(`fileBox_${slot}`);
  box.innerHTML = f
    ? `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px; background:var(--brand-bg); border-radius:8px;">
        <div style="font-size:13px;">
          📎 <a href="/api/deals/${dealId}/files/${slot}" target="_blank" rel="noopener">${f.file_name}</a>
          <span style="color:var(--brand-muted);">(${fmtFileSize(f.file_size)} · uploaded ${fmtDate(f.uploaded_at)})</span>
        </div>
        <button class="icon-btn remove-file-btn" data-slot="${slot}" title="Remove">✕</button>
      </div>
    `
    : `<p style="color:var(--brand-muted); font-size:12px; margin:0;">No file attached yet.</p>`;
  box.insertAdjacentHTML('beforeend', `
    <div style="margin-top:8px; display:flex; gap:8px; align-items:center;">
      <input type="file" class="estimate-file-input" data-slot="${slot}" style="margin:0; font-size:12px;">
      <button class="btn secondary small upload-file-btn" data-slot="${slot}" style="width:auto;">${f ? 'Replace File' : 'Attach File'}</button>
    </div>
  `);

  box.querySelector('.upload-file-btn').addEventListener('click', async () => {
    const input = box.querySelector('.estimate-file-input');
    const file = input.files[0];
    if (!file) { alert('Choose a file first.'); return; }
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`/api/deals/${dealId}/files/${slot}`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      DEAL = data;
      renderEstimateFileSlot(slot);
    } catch (err) { alert(err.message); }
  });

  const removeBtn = box.querySelector('.remove-file-btn');
  if (removeBtn) removeBtn.addEventListener('click', async () => {
    if (!confirm('Remove this attached file?')) return;
    try {
      DEAL = await api('DELETE', `/api/deals/${dealId}/files/${slot}`);
      renderEstimateFileSlot(slot);
    } catch (err) { alert(err.message); }
  });
}

function renderOriginalEstimate() {
  document.getElementById('saveOriginalEstimateBtn').addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    try {
      DEAL = await api('PUT', `/api/deals/${dealId}`, { original_estimate_amount: numOrNull(val('f_original_estimate_amount')) });
      btn.textContent = 'Saved ✓';
      setTimeout(() => { if (document.body.contains(btn)) { btn.textContent = 'Save'; btn.disabled = false; } }, 1200);
    } catch (err) { alert(err.message); btn.disabled = false; }
  });
  renderEstimateFileSlot('estimate');
  renderEstimateFileSlot('final');
}

function renderApproval() {
  const d = DEAL;
  let html = '';
  if (d.closer_rep_id) {
    html += `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--brand-border);">
        <div><strong>Closer</strong> — ${d.closer_display || d.closer_name}<br>${d.closer_breakdown_approved ? '<span class="badge green">Approved for view</span>' : '<span class="badge muted">Not visible to rep</span>'}</div>
        <button class="btn ${d.closer_breakdown_approved ? 'secondary' : ''} small" id="toggleCloserApproval">${d.closer_breakdown_approved ? 'Revoke' : 'Approve'}</button>
      </div>`;
  }
  if (d.setter_rep_id) {
    html += `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0;">
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
  try {
    DEAL = await api('POST', `/api/deals/${dealId}/approve`, { role, approved });
    renderApproval();
  } catch (e) { alert(e.message); }
}

function paymentRow(label, recipient, paid, amount, paidDate) {
  return `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--brand-border); flex-wrap:wrap; gap:6px;">
      <div><strong>${label}</strong> ${amount !== undefined ? `— ${fmtMoney(amount)}` : ''}</div>
      <div style="display:flex; align-items:center; gap:10px;">
        <input type="date" class="pay-date" data-recipient="${recipient}" value="${(paidDate || '').slice(0, 10)}" style="margin:0; padding:6px 8px; ${paid ? '' : 'display:none;'}">
        <label style="display:flex; align-items:center; gap:6px; font-size:13px;">
          <input type="checkbox" class="pay-toggle" data-recipient="${recipient}" ${paid ? 'checked' : ''} style="width:auto;"> Paid
        </label>
      </div>
    </div>`;
}

// Owner/Joey rows get an editable amount on top of paid+date, since these are the figures
// Joy needs to manually override directly (not via the Commission Calculator's override form).
function editableAmountRow(label, recipient, paid, amount, paidDate, overrideField, reason) {
  return `
    <div style="padding:10px 0; border-bottom:1px solid var(--brand-border);">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
        <strong>${label}</strong>
        <div style="display:flex; align-items:center; gap:10px;">
          <input type="date" class="pay-date" data-recipient="${recipient}" value="${(paidDate || '').slice(0, 10)}" style="margin:0; padding:6px 8px; ${paid ? '' : 'display:none;'}">
          <label style="display:flex; align-items:center; gap:6px; font-size:13px;">
            <input type="checkbox" class="pay-toggle" data-recipient="${recipient}" ${paid ? 'checked' : ''} style="width:auto;"> Paid
          </label>
        </div>
      </div>
      <div style="margin-top:6px; display:flex; align-items:center; gap:8px;">
        <input type="number" step="0.01" class="amount-override" data-field="${overrideField}" value="${amount ?? ''}" style="margin:0; max-width:140px;">
        <button class="btn secondary small amount-save" data-field="${overrideField}" style="width:auto;">Save</button>
      </div>
      ${reason ? `<div style="font-size:11px; color:var(--brand-muted); margin-top:2px;">Override reason: ${reason}</div>` : ''}
    </div>`;
}

// Shared by both the Funds Received section (Expected M1/M2) and Payment Status (Etai/Noy/
// Joey amounts) — each amount-override input always saves through setOverride with its OWN
// reason, never a value coerced away from an explicit 0.
function wireAmountOverrideButtons() {
  document.querySelectorAll('.amount-save').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const field = btn.dataset.field;
      const input = document.querySelector(`.amount-override[data-field="${field}"]`);
      const value = numOrNull(input.value);
      if (value === null) { alert('Enter an amount before saving.'); return; }
      const reason = prompt(`Reason for overriding this amount (required):`);
      if (!reason) return;
      try {
        DEAL = await api('POST', `/api/deals/${dealId}/override`, { override: true, reason, fields: { [field]: value } });
        // Only refresh the ONE section this field actually lives in — none of these fields
        // (Expected M1/M2, Etai/Noy, Joey) are shown by the Commission Calculator itself, so
        // there's never a reason to rebuild it (or, via its own internal cascade, Funds
        // Received too) just because a Payment Status amount was saved. Rebuilding sections
        // that don't need it is exactly what was silently discarding whatever date or amount
        // Joy had mid-typed in an unrelated section at the same time.
        if (field.startsWith('expected_')) {
          renderFundsReceived();
        } else {
          renderPayment();
        }
        renderAudit();
      } catch (e) { alert(e.message); }
    });
  });
}

function renderPayment() {
  const d = DEAL;
  let html = '';
  if (d.closer_rep_id) html += paymentRow('Closer', 'closer', d.closer_paid, d.closer_pay_net, d.closer_paid_date);
  if (d.setter_rep_id) html += paymentRow('Setter', 'setter', d.setter_paid, d.setter_pay, d.setter_paid_date);
  html += `<p class="section-title" style="margin-top:16px;">Internal Payroll (admin only) <span style="font-weight:400; text-transform:none; font-size:12px;">— amounts are editable, click Save to override</span></p>`;
  html += editableAmountRow('Etai — M1', 'owner_etai_m1', d.owner_etai_m1_paid, d.owner_etai_m1_amount, d.owner_etai_m1_paid_date, 'owner_etai_m1_amount', fieldOverrideReason(d, 'owner_etai_m1_amount'));
  html += editableAmountRow('Etai — M2', 'owner_etai_m2', d.owner_etai_m2_paid, d.owner_etai_m2_amount, d.owner_etai_m2_paid_date, 'owner_etai_m2_amount', fieldOverrideReason(d, 'owner_etai_m2_amount'));
  html += editableAmountRow('Noy — M1', 'owner_noy_m1', d.owner_noy_m1_paid, d.owner_noy_m1_amount, d.owner_noy_m1_paid_date, 'owner_noy_m1_amount', fieldOverrideReason(d, 'owner_noy_m1_amount'));
  html += editableAmountRow('Noy — M2', 'owner_noy_m2', d.owner_noy_m2_paid, d.owner_noy_m2_amount, d.owner_noy_m2_paid_date, 'owner_noy_m2_amount', fieldOverrideReason(d, 'owner_noy_m2_amount'));
  html += editableAmountRow("Joey's Bonus — M1", 'joey_m1', d.joey_m1_paid, d.joey_m1_bonus, d.joey_m1_paid_date, 'joey_m1_bonus', fieldOverrideReason(d, 'joey_m1_bonus'));
  html += editableAmountRow("Joey's Bonus — M2", 'joey', d.joey_paid, d.joey_m2_bonus, d.joey_paid_date, 'joey_m2_bonus', fieldOverrideReason(d, 'joey_m2_bonus'));
  document.getElementById('paymentBox').innerHTML = html;

  async function sendPayment(recipient, paid, date) {
    try {
      DEAL = await api('POST', `/api/deals/${dealId}/payment`, { recipient, paid, date });
      renderPayment();
    } catch (e) { alert(e.message); }
  }

  document.querySelectorAll('.pay-toggle').forEach((box) => {
    box.addEventListener('change', () => {
      const dateInput = document.querySelector(`.pay-date[data-recipient="${box.dataset.recipient}"]`);
      sendPayment(box.dataset.recipient, box.checked, dateInput ? dateInput.value : null);
    });
  });
  document.querySelectorAll('.pay-date').forEach((input) => {
    input.addEventListener('change', () => {
      sendPayment(input.dataset.recipient, true, input.value);
    });
  });
  wireAmountOverrideButtons();
}

function renderAudit() {
  const log = DEAL.auditLog || [];
  if (!log.length) {
    document.getElementById('auditBox').innerHTML = '<p style="color:var(--brand-muted); font-size:13px;">No changes logged yet.</p>';
    return;
  }
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
      <p style="font-size:12px; color:var(--brand-muted); margin-top:0;">
        Every field here is optional — leave blank to keep it as-is. Typing a Pay Scale Rate
        auto-fills Rep Pool / Closer Pay (gross) / Closer Pay (net) below (still editable afterward).
      </p>
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
      </div>
    `;
    // Once Joy types into one of these herself, a later tweak to Pay Scale Rate (fixing a typo,
    // say) should never silently overwrite what she just typed — auto-fill only ever applies to
    // a field she hasn't manually touched yet.
    const userEdited = { rep_pool: false, closer_pay_gross: false, closer_pay_net: false };
    ['ov_rep_pool', 'ov_closer_pay_gross', 'ov_closer_pay_net'].forEach((inputId) => {
      const field = inputId.slice(3);
      document.getElementById(inputId).addEventListener('input', () => { userEdited[field] = true; });
    });
    document.getElementById('ov_pay_scale_rate').addEventListener('input', (e) => {
      const rate = parseFloat(e.target.value);
      if (isNaN(rate) || !SETTINGS) return;
      const kw = DEAL.system_size_kw || 0;
      const paySplit = DEAL.pay_split || 0.5;
      const pool = rate * kw * paySplit;
      const hasSetter = !!DEAL.setter_rep_id;
      const closerPayGross = hasSetter ? pool * SETTINGS.closer_split_pct : pool;
      const cashbackDeduction = (DEAL.cashback_amount || 0) * SETTINGS.cashback_split_pct;
      const advanceDeduction = DEAL.advance_deduction || 0;
      const otherDeduction = DEAL.deduction_other || 0;
      const closerNet = closerPayGross - cashbackDeduction - advanceDeduction - otherDeduction;
      if (!userEdited.rep_pool) document.getElementById('ov_rep_pool').value = round2(pool);
      if (!userEdited.closer_pay_gross) document.getElementById('ov_closer_pay_gross').value = round2(closerPayGross);
      if (!userEdited.closer_pay_net) document.getElementById('ov_closer_pay_net').value = round2(closerNet);
    });
    document.getElementById('saveCloserOverrideBtn').addEventListener('click', async () => {
      const reason = val('ov_reason');
      if (!reason) { alert('Please give a reason for the override — this is logged for the audit trail.'); return; }
      try {
        DEAL = await api('POST', `/api/deals/${dealId}/override`, {
          override: true,
          reason,
          fields: {
            net_ppw: floatval('ov_net_ppw'),
            gross_amount: floatval('ov_gross_amount'),
            pay_scale_rate: floatval('ov_pay_scale_rate'),
            rep_pool: floatval('ov_rep_pool'),
            closer_pay_gross: floatval('ov_closer_pay_gross'),
            closer_pay_net: floatval('ov_closer_pay_net')
          }
        });
        overrideMode = false;
        box.style.display = 'none';
        renderCalc();
        renderAudit();
      } catch (e) { alert(e.message); }
    });
    const clearBtn = document.getElementById('clearCloserOverrideBtn');
    if (clearBtn) clearBtn.addEventListener('click', async () => {
      if (!confirm('This will discard the Closer override and replace it with freshly computed numbers. This cannot be undone — continue?')) return;
      try {
        DEAL = await api('POST', `/api/deals/${dealId}/override`, { override: false, fields: CLOSER_CALC_FIELDS, reason: 'Closer override removed' });
        DEAL = await api('POST', `/api/deals/${dealId}/recalculate`, {});
        overrideMode = false;
        box.style.display = 'none';
        renderCalc();
        renderAudit();
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
      <p style="font-size:12px; color:var(--brand-muted); margin-top:0;">
        Every field here is optional — leave blank to keep it as-is. Typing a Pay Scale Rate
        auto-fills Rep Pool / Setter Pay below (still editable afterward).
      </p>
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
      </div>
    `;
    const userEdited = { rep_pool: false, pay: false };
    document.getElementById('ov_setter_rep_pool').addEventListener('input', () => { userEdited.rep_pool = true; });
    document.getElementById('ov_setter_pay_only').addEventListener('input', () => { userEdited.pay = true; });
    document.getElementById('ov_setter_pay_scale_rate').addEventListener('input', (e) => {
      const rate = parseFloat(e.target.value);
      if (isNaN(rate) || !SETTINGS) return;
      const kw = DEAL.setter_calc_system_size_kw || 0;
      const paySplit = DEAL.pay_split || 0.5;
      const pool = rate * kw * paySplit;
      const setterPay = pool * SETTINGS.setter_split_pct;
      if (!userEdited.rep_pool) document.getElementById('ov_setter_rep_pool').value = round2(pool);
      if (!userEdited.pay) document.getElementById('ov_setter_pay_only').value = round2(setterPay);
    });
    document.getElementById('saveSetterOverrideBtn').addEventListener('click', async () => {
      const reason = val('ov_setter_reason');
      if (!reason) { alert('Please give a reason for the override — this is logged for the audit trail.'); return; }
      try {
        DEAL = await api('POST', `/api/deals/${dealId}/override`, {
          override: true,
          reason,
          fields: {
            setter_calc_net_ppw: floatval('ov_setter_net_ppw'),
            setter_calc_pay_scale_rate: floatval('ov_setter_pay_scale_rate'),
            setter_calc_rep_pool: floatval('ov_setter_rep_pool'),
            setter_pay: floatval('ov_setter_pay_only')
          }
        });
        overrideMode = false;
        box.style.display = 'none';
        renderCalc();
        renderAudit();
      } catch (e) { alert(e.message); }
    });
    const clearBtn = document.getElementById('clearSetterOverrideBtn');
    if (clearBtn) clearBtn.addEventListener('click', async () => {
      if (!confirm('This will discard the Setter override and replace it with a freshly computed number. This cannot be undone — continue?')) return;
      try {
        DEAL = await api('POST', `/api/deals/${dealId}/override`, { override: false, fields: SETTER_CALC_FIELDS, reason: 'Setter override removed' });
        DEAL = await api('POST', `/api/deals/${dealId}/recalculate`, {});
        overrideMode = false;
        box.style.display = 'none';
        renderCalc();
        renderAudit();
      } catch (e) { alert(e.message); }
    });
  });
}

function wireEvents() {
  document.getElementById('f_is_referral').addEventListener('change', (e) => {
    document.getElementById('f_pay_split').value = e.target.checked ? 0.75 : 0.50;
  });

  document.querySelectorAll('.add-option-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const value = prompt('New option to add to this list:');
      if (!value || !value.trim()) return;
      try {
        await api('POST', '/api/dropdown-options', { category: btn.dataset.category, value: value.trim() });
        META = await api('GET', '/api/meta');
        populateDropdownSelect(btn.dataset.target, btn.dataset.category, value.trim());
      } catch (e) { alert(e.message); }
    });
  });

  document.getElementById('addAdderBtn').addEventListener('click', (e) => guardedClick(e.target, 'Adding…', async () => {
    try {
      DEAL = await api('POST', `/api/deals/${dealId}/adders`, { label: 'New item', category: 'misc', amount: 0, counts_as_hard_cost: true });
      renderAdders();
      renderCalc();
    } catch (e2) { alert(e2.message); }
  }));

  document.getElementById('recalcBtn').addEventListener('click', (e) => guardedClick(e.target, 'Recalculating…', async () => {
    if (DEAL.manual_override) {
      alert('This deal has a manual override active on one or more fields, so Recalculate won\'t touch those — your saved numbers are safe. To discard a specific override and recompute it fresh, use that calculator\'s "Edit Override" → "Turn Off & Recalculate" instead.');
      return;
    }
    try {
      DEAL = await api('POST', `/api/deals/${dealId}/recalculate`, {});
      renderCalc();
    } catch (e2) { alert(e2.message); }
  }));

  document.getElementById('deleteBtn').addEventListener('click', (e) => guardedClick(e.target, 'Deleting…', async () => {
    if (!confirm(`Delete "${DEAL.customer_name}" permanently? This cannot be undone.`)) return;
    try {
      await api('DELETE', `/api/deals/${dealId}`);
      window.location.href = '/admin/board.html';
    } catch (e2) { alert(e2.message); }
  }));

  wireCloserOverrideForm();
  wireSetterOverrideForm();

  document.getElementById('backBtn').addEventListener('click', () => { window.location.href = '/admin/board.html'; });

  document.getElementById('saveBtn').addEventListener('click', async (e) => {
    const btn = e.target;
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const data = {
      customer_name: val('f_customer_name'),
      customer_address: val('f_customer_address'),
      customer_phone: val('f_customer_phone'),
      status_id: intval('f_status_id'),
      funding_status: val('f_funding_status') || null,
      funding_status_override: val('f_funding_status_override') || null,
      closer_rep_id: intval('f_closer_rep_id'),
      setter_rep_id: intval('f_setter_rep_id'),
      date_signed: dateOrNull(val('f_date_signed')),
      install_date: dateOrNull(val('f_install_date')),
      install_completed_date: dateOrNull(val('f_install_completed_date')),
      installer_id: intval('f_installer_id'),
      financier_id: intval('f_financier_id'),
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
      cashback_amount: floatval('f_cashback_amount'),
      is_referral: checked('f_is_referral'),
      pay_split: floatval('f_pay_split'),
      ntp_approved_date: dateOrNull(val('f_ntp_approved_date')),
      m1_approved_date: dateOrNull(val('f_m1_approved_date')),
      m1_paid_date: dateOrNull(val('f_m1_paid_date')),
      pto_granted_date: dateOrNull(val('f_pto_granted_date')),
      m2_approved_date: dateOrNull(val('f_m2_approved_date')),
      m2_paid_date: dateOrNull(val('f_m2_paid_date')),
      admin_notes: val('f_admin_notes')
    };
    try {
      DEAL = await api('PUT', `/api/deals/${dealId}`, data);
      document.querySelector('.topbar h1').textContent = DEAL.customer_name;
      renderCalc();
      renderApproval();
      renderPayment();
      renderAudit();
      btn.textContent = 'Saved ✓';
      setTimeout(() => { if (document.body.contains(btn)) { btn.textContent = 'Save Changes'; btn.disabled = false; } }, 1200);
      return;
    } catch (e2) { alert(e2.message); }
    btn.disabled = false;
    btn.textContent = 'Save Changes';
  });
}

init();
