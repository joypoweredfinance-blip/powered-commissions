const { get, all } = require('../db/client');
const { round2, computeEpcCost } = require('./commissionEngine');

const ADDER_CATEGORY_LABELS = { mpu: 'MPU', battery: 'Battery', reroof_sow: 'Roof Work', permit: 'Permit', misc: 'Miscellaneous', other: 'Other' };

function monthKey(dateStr) {
  if (!dateStr) return null;
  return String(dateStr).slice(0, 7); // YYYY-MM
}

function lastNMonths(n) {
  const months = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

function inRange(dateStr, startDate, endDate) {
  if (!dateStr) return false;
  const d = dateStr.slice(0, 10);
  if (startDate && d < startDate) return false;
  if (endDate && d > endDate) return false;
  return true;
}

async function getOverallDashboard({ statusIds, fundingStatuses, startDate, endDate } = {}) {
  const statusIdsArr = statusIds === undefined || statusIds === null ? [] : (Array.isArray(statusIds) ? statusIds : [statusIds]);
  const statusIdList = statusIdsArr.map(Number).filter((n) => !isNaN(n));
  const statusFilterSql = statusIdList.length ? ` AND d.status_id IN (${statusIdList.join(',')})` : '';

  // Funding Status is a second, independent status dimension (fixed list, separate from the
  // flexible CRM status above) — the override column takes precedence when set, same as it
  // does everywhere else this value is shown.
  const fundingStatusArr = fundingStatuses === undefined || fundingStatuses === null ? [] : (Array.isArray(fundingStatuses) ? fundingStatuses : [fundingStatuses]);
  const fundingStatusFilterSql = fundingStatusArr.length
    ? ` AND COALESCE(NULLIF(d.funding_status_override, ''), d.funding_status) IN (${fundingStatusArr.map(() => '?').join(',')})`
    : '';
  const fundingStatusArgs = fundingStatusArr.length ? fundingStatusArr : [];

  const hasPeriod = !!(startDate && endDate);
  const periodLabel = hasPeriod
    ? (startDate === endDate ? startDate : `${startDate} to ${endDate}`)
    : 'All Time';

  const activeDeals = await get(`
    SELECT COUNT(*) c FROM deals d LEFT JOIN deal_statuses ds ON ds.id = d.status_id
    WHERE COALESCE(ds.phase, 'pre_install') != 'closed'
  `);
  const totalDeals = await get(`SELECT COUNT(*) c FROM deals`);

  const allDeals = await all(`
    SELECT d.id, d.closer_rep_id, d.setter_rep_id, d.closer_pay_net, d.setter_pay,
           d.closer_paid, d.closer_paid_date, d.setter_paid, d.setter_paid_date,
           d.closer_breakdown_approved, d.setter_breakdown_approved,
           d.m1_paid_date, d.net_ppw, d.system_size_kw, d.gross_amount, d.rep_pool,
           d.owner_etai_total, d.owner_noy_total, d.joey_m2_bonus,
           d.funds_received_m1, d.funds_received_m2
    FROM deals d
    WHERE 1=1 ${statusFilterSql}${fundingStatusFilterSql}
  `, fundingStatusArgs);
  // Rep names looked up separately so the filtered query above stays simple to read.
  const repNameRows = await all(`SELECT id, full_name, display_name FROM reps`);
  const repNameMap = {};
  repNameRows.forEach((r) => { repNameMap[r.id] = r.display_name || r.full_name; });

  let fundedCount = 0;
  let commissionsPaid = 0;
  let pendingApproval = 0;
  const repTotals = {};
  // Averages describe deals actually FUNDED within the selected period (same condition as
  // fundedCount) — unlike Awaiting M1/M2/Incoming below, these must go to 0/— when nothing
  // was funded in the period, not fall back to whatever's outstanding "right now".
  const periodSystemSizes = [], periodNetPpws = [], periodGross = [], periodPoweredNet = [];

  for (const d of allDeals) {
    if (d.m1_paid_date && (!hasPeriod || inRange(d.m1_paid_date, startDate, endDate))) {
      fundedCount++;
      if (d.system_size_kw !== null && d.system_size_kw !== undefined) periodSystemSizes.push(d.system_size_kw);
      if (d.net_ppw !== null && d.net_ppw !== undefined) periodNetPpws.push(d.net_ppw);
      if (d.gross_amount !== null && d.gross_amount !== undefined) periodGross.push(d.gross_amount);
      // POWERED Net = Total Funds Received less (Closer Pay + Setter Pay + Staff Pay) for
      // that job — not Gross minus Rep Pool, which double-counted the installer's own EPC
      // split rather than reflecting cash actually in hand.
      const staffPay = (d.owner_etai_total || 0) + (d.owner_noy_total || 0) + (d.joey_m2_bonus || 0);
      const totalFundsReceived = (d.funds_received_m1 || 0) + (d.funds_received_m2 || 0);
      periodPoweredNet.push(totalFundsReceived - ((d.closer_pay_net || 0) + (d.setter_pay || 0) + staffPay));
    }
    if (d.closer_rep_id && !d.closer_breakdown_approved) pendingApproval += d.closer_pay_net || 0;
    if (d.setter_rep_id && !d.setter_breakdown_approved) pendingApproval += d.setter_pay || 0;

    if (d.closer_paid && d.closer_paid_date && (!hasPeriod || inRange(d.closer_paid_date, startDate, endDate))) {
      const amt = d.closer_pay_net || 0;
      commissionsPaid += amt;
      const key = d.closer_rep_id;
      repTotals[key] = repTotals[key] || { name: repNameMap[key], dealCount: 0, total: 0 };
      repTotals[key].total += amt;
      repTotals[key].dealCount += 1;
    }
    if (d.setter_paid && d.setter_paid_date && (!hasPeriod || inRange(d.setter_paid_date, startDate, endDate))) {
      const amt = d.setter_pay || 0;
      commissionsPaid += amt;
      const key = d.setter_rep_id;
      repTotals[key] = repTotals[key] || { name: repNameMap[key], dealCount: 0, total: 0 };
      repTotals[key].total += amt;
      repTotals[key].dealCount += 1;
    }
  }

  const outstandingAdvances = await get(`SELECT COALESCE(SUM(amount - amount_deducted), 0) c FROM advances WHERE status != 'deducted'`);
  const openClawbacks = await get(`SELECT COUNT(*) cnt, COALESCE(SUM(total_clawback), 0) total FROM clawbacks WHERE deducted = 0`);
  const pendingReferrals = await get(`SELECT COUNT(*) cnt, COALESCE(SUM(amount), 0) total FROM referral_bonuses WHERE date_paid IS NULL`);

  // Staff Pay (Etai + Noy + Joey) and Funds Received — attributed by the date each piece
  // actually got marked paid/received, filtered to the selected period (or all-time if none).
  // Etai and Noy each have their own paid flag/date/amount now, so this reflects whatever
  // was actually overridden per person rather than assuming the standard $500/$500 split.
  const payRows = await all(`
    SELECT d.owner_etai_m1_paid, d.owner_etai_m1_paid_date, d.owner_etai_m1_amount,
           d.owner_etai_m2_paid, d.owner_etai_m2_paid_date, d.owner_etai_m2_amount,
           d.owner_noy_m1_paid, d.owner_noy_m1_paid_date, d.owner_noy_m1_amount,
           d.owner_noy_m2_paid, d.owner_noy_m2_paid_date, d.owner_noy_m2_amount,
           d.joey_paid, d.joey_paid_date, d.joey_m2_bonus,
           d.funds_received_m1, d.funds_received_m1_date, d.funds_received_m2, d.funds_received_m2_date,
           fin.name as financier_name
    FROM deals d LEFT JOIN financiers fin ON fin.id = d.financier_id
    WHERE 1=1 ${statusFilterSql}${fundingStatusFilterSql}
  `, fundingStatusArgs);
  let staffPay = 0;
  let fundsReceived = 0;
  const financierTotals = {};
  for (const r of payRows) {
    if (r.owner_etai_m1_paid && r.owner_etai_m1_paid_date && (!hasPeriod || inRange(r.owner_etai_m1_paid_date, startDate, endDate))) {
      staffPay += r.owner_etai_m1_amount || 0;
    }
    if (r.owner_etai_m2_paid && r.owner_etai_m2_paid_date && (!hasPeriod || inRange(r.owner_etai_m2_paid_date, startDate, endDate))) {
      staffPay += r.owner_etai_m2_amount || 0;
    }
    if (r.owner_noy_m1_paid && r.owner_noy_m1_paid_date && (!hasPeriod || inRange(r.owner_noy_m1_paid_date, startDate, endDate))) {
      staffPay += r.owner_noy_m1_amount || 0;
    }
    if (r.owner_noy_m2_paid && r.owner_noy_m2_paid_date && (!hasPeriod || inRange(r.owner_noy_m2_paid_date, startDate, endDate))) {
      staffPay += r.owner_noy_m2_amount || 0;
    }
    if (r.joey_paid && r.joey_paid_date && (!hasPeriod || inRange(r.joey_paid_date, startDate, endDate))) {
      staffPay += r.joey_m2_bonus || 0;
    }
    if (r.funds_received_m1 && r.funds_received_m1_date && (!hasPeriod || inRange(r.funds_received_m1_date, startDate, endDate))) {
      fundsReceived += r.funds_received_m1;
      const fname = r.financier_name || 'Unknown';
      financierTotals[fname] = (financierTotals[fname] || 0) + r.funds_received_m1;
    }
    if (r.funds_received_m2 && r.funds_received_m2_date && (!hasPeriod || inRange(r.funds_received_m2_date, startDate, endDate))) {
      fundsReceived += r.funds_received_m2;
      const fname = r.financier_name || 'Unknown';
      financierTotals[fname] = (financierTotals[fname] || 0) + r.funds_received_m2;
    }
  }
  // Zero-amount financiers never get a key in financierTotals in the first place (the loop
  // above only adds when funds_received_m1/m2 is truthy), so this is already "hide if zero".
  const fundsByFinancier = Object.entries(financierTotals)
    .map(([name, total]) => ({ name, total: round2(total) }))
    .sort((a, b) => b.total - a.total);
  const fundsByFinancierTotal = round2(fundsByFinancier.reduce((s, f) => s + f.total, 0));

  // "Cut of the pie" breakdown — where each signed contract dollar actually goes: EPC cost,
  // each adder category, and what's left as POWERED's own margin. Anchored on date_signed
  // (when the contract value was actually established), filtered by the same status/date
  // selection as the rest of the dashboard.
  const pieDeals = await all(`SELECT id, contract_value, epc_rate_per_watt, system_size_kw, date_signed FROM deals d WHERE 1=1 ${statusFilterSql}${fundingStatusFilterSql}`, fundingStatusArgs);
  const pieMatchedIds = new Set(pieDeals.filter((d) => !hasPeriod || inRange(d.date_signed, startDate, endDate)).map((d) => d.id));
  let totalContractValue = 0, totalEpcCost = 0;
  for (const d of pieDeals) {
    if (!pieMatchedIds.has(d.id)) continue;
    totalContractValue += d.contract_value || 0;
    totalEpcCost += computeEpcCost(d.epc_rate_per_watt, d.system_size_kw || 0);
  }
  const adderRows = await all(`SELECT da.category, da.amount, da.deal_id FROM deal_adders da JOIN deals d ON d.id = da.deal_id WHERE 1=1 ${statusFilterSql}${fundingStatusFilterSql}`, fundingStatusArgs);
  const categoryTotals = {};
  for (const a of adderRows) {
    if (!pieMatchedIds.has(a.deal_id)) continue;
    categoryTotals[a.category] = (categoryTotals[a.category] || 0) + (a.amount || 0);
  }
  const totalAdders = Object.values(categoryTotals).reduce((s, v) => s + v, 0);
  const totalGross = round2(totalContractValue - totalEpcCost - totalAdders);
  const contractBreakdown = {
    totalContractValue: round2(totalContractValue),
    totalAdders: round2(totalAdders),
    slices: [
      { label: 'EPC Cost', amount: round2(totalEpcCost) },
      ...Object.entries(categoryTotals).map(([cat, amt]) => ({ label: ADDER_CATEGORY_LABELS[cat] || cat, amount: round2(amt) })),
      { label: 'POWERED Net (Gross)', amount: totalGross }
    ].filter((s) => s.amount > 0)
  };

  const pipeline = await all(`
    SELECT ds.id, ds.label, ds.phase, ds.sort_order, COUNT(d.id) as count
    FROM deal_statuses ds LEFT JOIN deals d ON d.status_id = ds.id
    GROUP BY ds.id ORDER BY ds.sort_order
  `);

  const leaderboard = Object.values(repTotals).sort((a, b) => b.total - a.total).slice(0, 8);

  const recentActivity = await all(`
    SELECT a.*, u.email as changed_by_email, d.customer_name
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.changed_by
    LEFT JOIN deals d ON d.id = a.record_id AND a.table_name = 'deals'
    WHERE a.table_name = 'deals' AND a.field_name IN ('closer_breakdown_approved', 'setter_breakdown_approved', 'closer_paid', 'setter_paid', '_created')
    ORDER BY a.changed_at DESC LIMIT 10
  `);

  // Awaiting M1/M2/Incoming are a "right now" snapshot (what's currently owed) — deliberately
  // not affected by the date filter, only the status filter. The averages below are NOT part
  // of that snapshot: they describe deals funded within the selected period, so they go to
  // 0/— when nothing was funded in that period, same as every other period-scoped KPI.
  const awaitingM1Rows = await all(`
    SELECT id, expected_m1_amount FROM deals d
    WHERE m1_approved_date IS NOT NULL AND funds_received_m1_date IS NULL ${statusFilterSql}${fundingStatusFilterSql}
  `, fundingStatusArgs);
  const awaitingM2Rows = await all(`
    SELECT id, expected_m2_amount FROM deals d
    WHERE m2_approved_date IS NOT NULL AND funds_received_m2_date IS NULL ${statusFilterSql}${fundingStatusFilterSql}
  `, fundingStatusArgs);
  const awaitingM1Total = round2(awaitingM1Rows.reduce((s, r) => s + (r.expected_m1_amount || 0), 0));
  const awaitingM2Total = round2(awaitingM2Rows.reduce((s, r) => s + (r.expected_m2_amount || 0), 0));
  const unionMap = new Map();
  [...awaitingM1Rows, ...awaitingM2Rows].forEach((r) => unionMap.set(r.id, r));
  const unionDeals = [...unionMap.values()];

  const avgOfPeriod = (vals) => (vals.length ? round2(vals.reduce((s, v) => s + v, 0) / vals.length) : null);

  const fundingStatus = {
    awaitingM1: { total: awaitingM1Total, count: awaitingM1Rows.length },
    awaitingM2: { total: awaitingM2Total, count: awaitingM2Rows.length },
    incoming: { total: round2(awaitingM1Total + awaitingM2Total), count: unionDeals.length },
    avgSystemSizeKw: avgOfPeriod(periodSystemSizes),
    avgNetPpw: avgOfPeriod(periodNetPpws),
    avgGross: avgOfPeriod(periodGross),
    avgPoweredNet: avgOfPeriod(periodPoweredNet)
  };

  // Per-job comparison: Total Funds Received vs Commission Paid for each individual job,
  // rather than two independently time-bucketed totals — bucketing by time made the two bars
  // line up by coincidence of timing, not by which job they actually belonged to, so a job
  // funded in February and paid out in June looked like two unrelated, disconnected events.
  // A job is included if any of its relevant dates falls in the selected period (or always,
  // when no period is selected).
  const jobRows = await all(`
    SELECT d.id, d.customer_name,
           d.closer_paid, d.closer_paid_date, d.closer_pay_net,
           d.setter_paid, d.setter_paid_date, d.setter_pay,
           d.funds_received_m1_date, d.funds_received_m1, d.funds_received_m2_date, d.funds_received_m2
    FROM deals d WHERE 1=1 ${statusFilterSql}${fundingStatusFilterSql}
  `, fundingStatusArgs);
  const jobComparisonAll = [];
  for (const d of jobRows) {
    const closerInRange = d.closer_paid && inRange(d.closer_paid_date, startDate, endDate);
    const setterInRange = d.setter_paid && inRange(d.setter_paid_date, startDate, endDate);
    const m1InRange = inRange(d.funds_received_m1_date, startDate, endDate);
    const m2InRange = inRange(d.funds_received_m2_date, startDate, endDate);
    const matches = !hasPeriod
      ? (d.closer_paid || d.setter_paid || d.funds_received_m1 || d.funds_received_m2)
      : (closerInRange || setterInRange || m1InRange || m2InRange);
    if (!matches) continue;
    const commissionPaid = round2((d.closer_paid ? d.closer_pay_net || 0 : 0) + (d.setter_paid ? d.setter_pay || 0 : 0));
    const fundsReceived = round2((d.funds_received_m1 || 0) + (d.funds_received_m2 || 0));
    if (!commissionPaid && !fundsReceived) continue;
    jobComparisonAll.push({ customerName: d.customer_name, fundsReceived, commissionPaid });
  }
  jobComparisonAll.sort((a, b) => (b.fundsReceived + b.commissionPaid) - (a.fundsReceived + a.commissionPaid));
  const jobComparisonTruncated = jobComparisonAll.length > 30;
  const jobComparison = jobComparisonAll.slice(0, 30);

  return {
    kpis: {
      activeDeals: activeDeals.c,
      totalDeals: totalDeals.c,
      fundedCount,
      commissionsPaid: round2(commissionsPaid),
      staffPay: round2(staffPay),
      fundsReceived: round2(fundsReceived),
      pendingApproval: round2(pendingApproval),
      outstandingAdvances: round2(outstandingAdvances.c),
      openClawbackCount: openClawbacks.cnt, openClawbackTotal: round2(openClawbacks.total),
      pendingReferralCount: pendingReferrals.cnt, pendingReferralTotal: round2(pendingReferrals.total)
    },
    periodLabel,
    fundingStatus,
    fundsByFinancier, fundsByFinancierTotal,
    contractBreakdown,
    jobComparison, jobComparisonTruncated,
    pipeline,
    leaderboard,
    recentActivity
  };
}

async function getRepDashboard(repId) {
  const rep = await get(`SELECT r.*, ps.name as pay_scale_name FROM reps r LEFT JOIN pay_scales ps ON ps.id = r.pay_scale_id WHERE r.id = ?`, [repId]);
  if (!rep) return null;
  const thisMonth = monthKey(new Date().toISOString());
  const thisYear = String(new Date().getFullYear());

  const deals = await all(`
    SELECT d.*, ds.label as status_label
    FROM deals d LEFT JOIN deal_statuses ds ON ds.id = d.status_id
    WHERE d.closer_rep_id = ? OR d.setter_rep_id = ?
    ORDER BY d.updated_at DESC
  `, [repId, repId]);

  let dealsThisMonth = 0, thisMonthCommission = 0, ytdCommission = 0, pendingApproval = 0, allTimeCommission = 0;
  let ppwSum = 0, ppwCount = 0;
  const monthlyTotals = {};
  lastNMonths(6).forEach((m) => { monthlyTotals[m] = 0; });

  for (const d of deals) {
    const isCloser = d.closer_rep_id === Number(repId);
    const isSetter = d.setter_rep_id === Number(repId);
    if (d.date_signed && monthKey(d.date_signed) === thisMonth) dealsThisMonth++;
    if (d.net_ppw !== null && d.net_ppw !== undefined) { ppwSum += d.net_ppw; ppwCount++; }

    if (isCloser) {
      if (!d.closer_breakdown_approved) pendingApproval += d.closer_pay_net || 0;
      if (d.closer_paid && d.closer_paid_date) {
        const amt = d.closer_pay_net || 0;
        const mk = monthKey(d.closer_paid_date);
        allTimeCommission += amt;
        if (mk === thisMonth) thisMonthCommission += amt;
        if (mk && mk.startsWith(thisYear)) ytdCommission += amt;
        if (mk in monthlyTotals) monthlyTotals[mk] += amt;
      }
    }
    if (isSetter) {
      if (!d.setter_breakdown_approved) pendingApproval += d.setter_pay || 0;
      if (d.setter_paid && d.setter_paid_date) {
        const amt = d.setter_pay || 0;
        const mk = monthKey(d.setter_paid_date);
        allTimeCommission += amt;
        if (mk === thisMonth) thisMonthCommission += amt;
        if (mk && mk.startsWith(thisYear)) ytdCommission += amt;
        if (mk in monthlyTotals) monthlyTotals[mk] += amt;
      }
    }
  }

  return {
    rep,
    kpis: {
      dealsThisMonth,
      thisMonthCommission: round2(thisMonthCommission),
      ytdCommission: round2(ytdCommission),
      allTimeCommission: round2(allTimeCommission),
      pendingApproval: round2(pendingApproval),
      avgNetPPW: ppwCount ? round2(ppwSum / ppwCount) : null
    },
    monthlyTrend: lastNMonths(6).map((m) => ({ month: m, total: round2(monthlyTotals[m]) })),
    recentJobs: deals.slice(0, 8)
  };
}

// Required here (not at top) since payRunService doesn't depend on dashboardService —
// no cycle, just keeping the staff-dashboard-specific require next to its one use.
const payRunService = require('./payRunService');

// A staff member's dashboard shows exactly what the Commission Summary says they're being
// paid — sourced from pay runs Joy has approved (or already paid), never live-computed from
// deal fields directly. This is "the Commission Summary is the final draft" requirement:
// nothing shows up here until that pay run has been through the approval step.
async function getStaffDashboard(staffId) {
  const staff = await get(`SELECT * FROM payroll_staff WHERE id = ?`, [staffId]);
  if (!staff) return null;
  const settings = await get(`SELECT * FROM commission_settings WHERE id = 1`);

  const sectionKey = staff.staff_type === 'owner' ? (/etai/i.test(staff.full_name) ? 'etai' : 'noy')
    : staff.staff_type === 'pm' ? 'joey' : 'austin';

  const approvedRuns = await all(`SELECT id, pay_period_date, status FROM pay_runs WHERE status IN ('approved', 'paid') ORDER BY pay_period_date ASC`);
  const monthlyTotals = {};
  lastNMonths(6).forEach((m) => { monthlyTotals[m] = 0; });
  let ytdTotal = 0, allTimeTotal = 0;
  const thisYear = String(new Date().getFullYear());
  const ledger = [];

  for (const run of approvedRuns) {
    const data = await payRunService.getPayRun(run.id);
    const section = data.sections[sectionKey];
    if (!section || !section.total) continue;
    const mk = monthKey(run.pay_period_date);
    allTimeTotal += section.total;
    if (mk && mk.startsWith(thisYear)) ytdTotal += section.total;
    if (mk in monthlyTotals) monthlyTotals[mk] += section.total;
    ledger.push({ payRunId: run.id, payPeriodDate: run.pay_period_date, status: run.status, total: section.total, rows: section.rows });
  }
  ledger.sort((a, b) => new Date(b.payPeriodDate) - new Date(a.payPeriodDate));
  const monthlyTrend = lastNMonths(6).map((m) => ({ month: m, total: round2(monthlyTotals[m]) }));

  if (staff.staff_type === 'owner') {
    return {
      staff, type: 'owner',
      kpis: { ytdTotal: round2(ytdTotal), allTimeTotal: round2(allTimeTotal), payRunCount: ledger.length },
      monthlyTrend, ledger: ledger.slice(0, 20)
    };
  }
  if (staff.staff_type === 'pm') {
    return {
      staff, type: 'pm',
      kpis: { weeklySalary: settings.joey_weekly_salary, ytdTotal: round2(ytdTotal), allTimeTotal: round2(allTimeTotal), payRunCount: ledger.length },
      monthlyTrend, ledger: ledger.slice(0, 20)
    };
  }
  // ops (Austin)
  const currentRun = ledger[0];
  return {
    staff, type: 'ops',
    kpis: {
      currentPeriodPay: currentRun ? currentRun.total : 0,
      base: settings.austin_base, ratePerKw: settings.austin_rate_per_kw,
      ytdTotal: round2(ytdTotal), allTimeTotal: round2(allTimeTotal)
    },
    monthlyTrend, ledger: ledger.slice(0, 20)
  };
}

module.exports = { getOverallDashboard, getRepDashboard, getStaffDashboard };
