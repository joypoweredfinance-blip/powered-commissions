const { get, all } = require('../db/client');
const { round2, computeEpcCost } = require('./commissionEngine');

const ADDER_CATEGORY_LABELS = { mpu: 'MPU', battery: 'Battery', reroof_sow: 'Roof Costs', permit: 'Permit', misc: 'Miscellaneous', other: 'Other' };

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

  // None of these ~16 queries depend on another's result (they only share the statusFilterSql/
  // fundingStatusFilterSql strings, which are built synchronously above) — firing them all at
  // once cuts dashboard load time from "16 sequential network round-trips to Turso" down to
  // roughly the time of the single slowest one. All the processing below is unchanged, just
  // reading from variables that are now resolved up front instead of one at a time.
  const [
    activeDeals, totalDeals, allDeals, repNameRows,
    outstandingAdvances, openClawbacks, pendingReferrals, payRows,
    pieDeals, adderRows, installerJobRows, pipeline, recentActivity,
    awaitingM1Rows, awaitingM2Rows, jobRows
  ] = await Promise.all([
    get(`
      SELECT COUNT(*) c FROM deals d LEFT JOIN deal_statuses ds ON ds.id = d.status_id
      WHERE COALESCE(ds.phase, 'pre_install') != 'closed'
    `),
    get(`SELECT COUNT(*) c FROM deals`),
    all(`
      SELECT d.id, d.closer_rep_id, d.setter_rep_id, d.closer_pay_net, d.setter_pay,
             d.closer_paid, d.closer_paid_date, d.setter_paid, d.setter_paid_date,
             d.closer_breakdown_approved, d.setter_breakdown_approved,
             d.m1_paid_date, d.net_ppw, d.system_size_kw, d.gross_amount, d.rep_pool,
             d.owner_etai_total, d.owner_noy_total, d.joey_m1_bonus, d.joey_m2_bonus,
             d.funds_received_m1, d.funds_received_m2, d.install_completed_date,
             d.expected_m1_amount, d.expected_m2_amount
      FROM deals d
      WHERE 1=1 ${statusFilterSql}${fundingStatusFilterSql}
    `, fundingStatusArgs),
    // Rep names looked up separately so the filtered query above stays simple to read.
    all(`SELECT id, full_name, display_name FROM reps`),
    get(`SELECT COALESCE(SUM(amount - amount_deducted), 0) c FROM advances WHERE status != 'deducted'`),
    get(`SELECT COUNT(*) cnt, COALESCE(SUM(total_clawback), 0) total FROM clawbacks WHERE deducted = 0`),
    get(`SELECT COUNT(*) cnt, COALESCE(SUM(amount), 0) total FROM referral_bonuses WHERE date_paid IS NULL`),
    all(`
      SELECT d.owner_etai_m1_paid, d.owner_etai_m1_paid_date, d.owner_etai_m1_amount,
             d.owner_etai_m2_paid, d.owner_etai_m2_paid_date, d.owner_etai_m2_amount,
             d.owner_noy_m1_paid, d.owner_noy_m1_paid_date, d.owner_noy_m1_amount,
             d.owner_noy_m2_paid, d.owner_noy_m2_paid_date, d.owner_noy_m2_amount,
             d.joey_m1_paid, d.joey_m1_paid_date, d.joey_m1_bonus,
             d.joey_paid, d.joey_paid_date, d.joey_m2_bonus,
             d.funds_received_m1, d.funds_received_m1_date, d.funds_received_m2, d.funds_received_m2_date,
             fin.name as financier_name
      FROM deals d LEFT JOIN financiers fin ON fin.id = d.financier_id
      WHERE 1=1 ${statusFilterSql}${fundingStatusFilterSql}
    `, fundingStatusArgs),
    all(`SELECT id, contract_value, epc_rate_per_watt, system_size_kw, install_completed_date FROM deals d WHERE 1=1 ${statusFilterSql}${fundingStatusFilterSql}`, fundingStatusArgs),
    all(`SELECT da.category, da.amount, da.deal_id FROM deal_adders da JOIN deals d ON d.id = da.deal_id WHERE 1=1 ${statusFilterSql}${fundingStatusFilterSql}`, fundingStatusArgs),
    all(
      `SELECT d.id, inst.name as installer_name FROM deals d JOIN installers inst ON inst.id = d.installer_id WHERE 1=1 ${statusFilterSql}${fundingStatusFilterSql}`,
      fundingStatusArgs
    ),
    all(`
      SELECT ds.id, ds.label, ds.phase, ds.sort_order, COUNT(d.id) as count
      FROM deal_statuses ds LEFT JOIN deals d ON d.status_id = ds.id
      GROUP BY ds.id ORDER BY ds.sort_order
    `),
    all(`
      SELECT a.*, u.email as changed_by_email, d.customer_name
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.changed_by
      LEFT JOIN deals d ON d.id = a.record_id AND a.table_name = 'deals'
      WHERE a.table_name = 'deals' AND a.field_name IN ('closer_breakdown_approved', 'setter_breakdown_approved', 'closer_paid', 'setter_paid', '_created')
      ORDER BY a.changed_at DESC LIMIT 10
    `),
    all(`
      SELECT id, expected_m1_amount FROM deals d
      WHERE m1_approved_date IS NOT NULL AND funds_received_m1_date IS NULL ${statusFilterSql}${fundingStatusFilterSql}
    `, fundingStatusArgs),
    all(`
      SELECT id, expected_m2_amount FROM deals d
      WHERE m2_approved_date IS NOT NULL AND funds_received_m2_date IS NULL ${statusFilterSql}${fundingStatusFilterSql}
    `, fundingStatusArgs),
    all(`
      SELECT d.id, d.customer_name,
             d.closer_paid, d.closer_paid_date, d.closer_pay_net,
             d.setter_paid, d.setter_paid_date, d.setter_pay,
             d.funds_received_m1_date, d.funds_received_m1, d.funds_received_m2_date, d.funds_received_m2
      FROM deals d WHERE 1=1 ${statusFilterSql}${fundingStatusFilterSql}
    `, fundingStatusArgs)
  ]);

  const repNameMap = {};
  repNameRows.forEach((r) => { repNameMap[r.id] = r.display_name || r.full_name; });

  let fundedCount = 0;
  let commissionsPaid = 0;
  let pendingApproval = 0;
  const repTotals = {};
  // Averages describe deals actually FUNDED within the selected period (same condition as
  // fundedCount) — unlike Awaiting M1/M2/Incoming below, these must go to 0/— when nothing
  // was funded in the period, not fall back to whatever's outstanding "right now".
  const periodSystemSizes = [], periodNetPpws = [], periodGross = [];
  // Total Net (Actual/Projected) are scoped by Solar Date (install_completed_date), matching
  // this page's "Filter by Solar Date" framing — every deal whose install falls in the
  // selected period contributes, regardless of whether its funding has landed yet.
  let totalNetActual = 0;
  let totalNetProjected = 0;

  for (const d of allDeals) {
    if (d.m1_paid_date && (!hasPeriod || inRange(d.m1_paid_date, startDate, endDate))) {
      fundedCount++;
      if (d.system_size_kw !== null && d.system_size_kw !== undefined) periodSystemSizes.push(d.system_size_kw);
      if (d.net_ppw !== null && d.net_ppw !== undefined) periodNetPpws.push(d.net_ppw);
      if (d.gross_amount !== null && d.gross_amount !== undefined) periodGross.push(d.gross_amount);
    }
    if (d.install_completed_date && (!hasPeriod || inRange(d.install_completed_date, startDate, endDate))) {
      // Same deductions either way — these are already fully computed by the engine
      // regardless of funding status, only the PAYOUT timing depends on it.
      const totalDeductions = (d.closer_pay_net || 0) + (d.setter_pay || 0)
        + (d.owner_etai_total || 0) + (d.owner_noy_total || 0) + (d.joey_m1_bonus || 0) + (d.joey_m2_bonus || 0);
      const m1Received = d.funds_received_m1 || 0;
      const m2Received = d.funds_received_m2 || 0;
      const totalReceived = m1Received + m2Received;
      // Actual: only money that's genuinely landed — $0 (never negative) for a deal that
      // hasn't been funded at all yet, same guard used for the Monthly Tracker.
      totalNetActual += totalReceived > 0 ? (totalReceived - totalDeductions) : 0;
      // Projected: the full eventual total assuming everything funds as currently expected —
      // confirmed actual amount per milestone where we have it, the engine's own expected
      // amount where we don't yet.
      const m1Final = d.funds_received_m1 ? m1Received : (d.expected_m1_amount || 0);
      const m2Final = d.funds_received_m2 ? m2Received : (d.expected_m2_amount || 0);
      totalNetProjected += (m1Final + m2Final) - totalDeductions;
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

  // Staff Pay (Etai + Noy + Joey) and Funds Received — attributed by the date each piece
  // actually got marked paid/received, filtered to the selected period (or all-time if none).
  // Etai and Noy each have their own paid flag/date/amount now, so this reflects whatever
  // was actually overridden per person rather than assuming the standard $500/$500 split.
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
    if (r.joey_m1_paid && r.joey_m1_paid_date && (!hasPeriod || inRange(r.joey_m1_paid_date, startDate, endDate))) {
      staffPay += r.joey_m1_bonus || 0;
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
  // each adder category, and what's left as POWERED's own margin. Anchored on Solar Date
  // (install_completed_date) per Joy's request, filtered by the same status/date selection
  // as the rest of the dashboard.
  const pieMatchedIds = new Set(pieDeals.filter((d) => !hasPeriod || inRange(d.install_completed_date, startDate, endDate)).map((d) => d.id));
  let totalContractValue = 0, totalEpcCost = 0;
  for (const d of pieDeals) {
    if (!pieMatchedIds.has(d.id)) continue;
    totalContractValue += d.contract_value || 0;
    totalEpcCost += computeEpcCost(d.epc_rate_per_watt, d.system_size_kw || 0);
  }
  const categoryTotals = {};
  for (const a of adderRows) {
    if (!pieMatchedIds.has(a.deal_id)) continue;
    categoryTotals[a.category] = (categoryTotals[a.category] || 0) + (a.amount || 0);
  }
  const totalAdders = Object.values(categoryTotals).reduce((s, v) => s + v, 0);
  const totalGross = round2(totalContractValue - totalEpcCost - totalAdders);

  // Adders cost comparison BY INSTALLER, averaged per job (not raw totals) so an installer
  // with more deals in the period doesn't just look "more expensive" by volume alone.
  const installerNameByDeal = {};
  const jobCountByInstaller = {};
  for (const r of installerJobRows) {
    if (!pieMatchedIds.has(r.id)) continue;
    installerNameByDeal[r.id] = r.installer_name;
    jobCountByInstaller[r.installer_name] = (jobCountByInstaller[r.installer_name] || 0) + 1;
  }
  const installerCategoryTotals = {};
  for (const a of adderRows) {
    const installerName = installerNameByDeal[a.deal_id];
    if (!installerName) continue;
    installerCategoryTotals[installerName] = installerCategoryTotals[installerName] || {};
    installerCategoryTotals[installerName][a.category] = (installerCategoryTotals[installerName][a.category] || 0) + (a.amount || 0);
  }
  const adderCategoryKeys = Object.keys(ADDER_CATEGORY_LABELS);
  const installerAddersComparison = Object.keys(jobCountByInstaller).map((name) => {
    const jobCount = jobCountByInstaller[name];
    const totals = installerCategoryTotals[name] || {};
    const perJobByCategory = {};
    adderCategoryKeys.forEach((c) => { perJobByCategory[c] = jobCount ? round2((totals[c] || 0) / jobCount) : 0; });
    return { installerName: name, jobCount, perJobByCategory };
  }).sort((a, b) => b.jobCount - a.jobCount);

  const contractBreakdown = {
    totalContractValue: round2(totalContractValue),
    totalAdders: round2(totalAdders),
    slices: [
      { label: 'EPC Cost', amount: round2(totalEpcCost) },
      ...Object.entries(categoryTotals).map(([cat, amt]) => ({ label: ADDER_CATEGORY_LABELS[cat] || cat, amount: round2(amt) })),
      { label: 'POWERED Net (Gross)', amount: totalGross }
    ].filter((s) => s.amount > 0)
  };

  const leaderboard = Object.values(repTotals).sort((a, b) => b.total - a.total).slice(0, 8);

  // Awaiting M1/M2/Incoming are a "right now" snapshot (what's currently owed) — deliberately
  // not affected by the date filter, only the status filter. The averages below are NOT part
  // of that snapshot: they describe deals funded within the selected period, so they go to
  // 0/— when nothing was funded in that period, same as every other period-scoped KPI.
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
    avgNetPpw: avgOfPeriod(periodNetPpws),
    avgSystemSizeKw: avgOfPeriod(periodSystemSizes),
    totalGross: round2(periodGross.reduce((s, v) => s + v, 0)),
    totalNetProjected: round2(totalNetProjected),
    totalNetActual: round2(totalNetActual)
  };

  // Per-job comparison: Total Funds Received vs Commission Paid for each individual job,
  // rather than two independently time-bucketed totals — bucketing by time made the two bars
  // line up by coincidence of timing, not by which job they actually belonged to, so a job
  // funded in February and paid out in June looked like two unrelated, disconnected events.
  // A job is included if any of its relevant dates falls in the selected period (or always,
  // when no period is selected).
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
    installerAddersComparison,
    jobComparison, jobComparisonTruncated,
    pipeline,
    leaderboard,
    recentActivity
  };
}

// Joy's "Monthly Tracker" for her boss.
//   $ Funded (M1+M2)     = M1/M2 amounts on the date each was actually RECEIVED
//   Net Profit Generated = realized profit, recognized progressively as funding actually
//     lands — never before. A deal's total deductions (closer/setter/staff pay) get split
//     between M1 and M2 in proportion to how much of the deal's total funding each milestone
//     represents, so M1's recognized profit shows up in M1's month and M2's in M2's month. A
//     deal with no M2 milestone at all (a 100%-at-M1 installer) naturally recognizes its full
//     profit at M1, since total received only ever equals M1 for that deal — no special case
//     needed, the proportional math just falls out that way. A deal with nothing received yet
//     contributes $0 everywhere, by design (no funding, no realized profit).
// A deal installed in one month can still have funding land in a later month (or even a later
// year), so the query pulls in any deal touching the selected year on EITHER install or
// funding dates — otherwise a January funding event for a December install from last year
// would silently go missing from either row.
async function getMonthlyTracker(year) {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const rows = await all(`
    SELECT d.id, d.customer_name, d.install_completed_date,
           d.closer_pay_net, d.setter_pay,
           d.owner_etai_total, d.owner_noy_total, d.joey_m1_bonus, d.joey_m2_bonus,
           d.funds_received_m1, d.funds_received_m1_date, d.funds_received_m2, d.funds_received_m2_date,
           cr.display_name as closer_display, cr.full_name as closer_name,
           sr.display_name as setter_display, sr.full_name as setter_name
    FROM deals d
    LEFT JOIN reps cr ON cr.id = d.closer_rep_id
    LEFT JOIN reps sr ON sr.id = d.setter_rep_id
    WHERE (d.install_completed_date BETWEEN ? AND ?)
       OR (d.funds_received_m1_date BETWEEN ? AND ?)
       OR (d.funds_received_m2_date BETWEEN ? AND ?)
  `, [yearStart, yearEnd, yearStart, yearEnd, yearStart, yearEnd]);

  const netProfitByMonth = {};
  const fundedByMonth = {};
  for (let m = 1; m <= 12; m++) { netProfitByMonth[m] = 0; fundedByMonth[m] = 0; }
  const deals = [];
  const yearStr = String(year);

  for (const d of rows) {
    const totalDeductions = (d.closer_pay_net || 0) + (d.setter_pay || 0)
      + (d.owner_etai_total || 0) + (d.owner_noy_total || 0) + (d.joey_m1_bonus || 0) + (d.joey_m2_bonus || 0);
    const m1 = d.funds_received_m1 || 0;
    const m2 = d.funds_received_m2 || 0;
    const totalReceived = m1 + m2;
    const realizedProfit = totalReceived - totalDeductions;
    // Each milestone's slice of the realized profit is proportional to its slice of the
    // money actually received so far — not a 50/50 or M1/M2-schedule split.
    const m1Profit = totalReceived > 0 ? (m1 / totalReceived) * realizedProfit : 0;
    const m2Profit = totalReceived > 0 ? (m2 / totalReceived) * realizedProfit : 0;

    if (d.funds_received_m1 && d.funds_received_m1_date && d.funds_received_m1_date.slice(0, 4) === yearStr) {
      const m = Number(d.funds_received_m1_date.slice(5, 7));
      fundedByMonth[m] += m1;
      netProfitByMonth[m] += m1Profit;
    }
    if (d.funds_received_m2 && d.funds_received_m2_date && d.funds_received_m2_date.slice(0, 4) === yearStr) {
      const m = Number(d.funds_received_m2_date.slice(5, 7));
      fundedByMonth[m] += m2;
      netProfitByMonth[m] += m2Profit;
    }
    if (d.install_completed_date && d.install_completed_date.slice(0, 4) === yearStr) {
      deals.push({
        id: d.id,
        customerName: d.customer_name,
        installDate: d.install_completed_date,
        closer: d.closer_display || d.closer_name,
        setter: d.setter_display || d.setter_name,
        fundsReceived: round2(totalReceived),
        // Same m1Profit+m2Profit used for the month buckets, not a separately-computed
        // realizedProfit — a deal with nothing received yet must show $0 here too, never a
        // negative number just because a deduction is already on file but no cash is in hand.
        netProfit: round2(m1Profit + m2Profit)
      });
    }
  }

  const monthly = [];
  for (let m = 1; m <= 12; m++) {
    monthly.push({ month: m, netProfit: round2(netProfitByMonth[m]), funded: round2(fundedByMonth[m]) });
  }
  deals.sort((a, b) => new Date(b.installDate) - new Date(a.installDate));

  return {
    year,
    monthly,
    ytdNetProfit: round2(monthly.reduce((s, r) => s + r.netProfit, 0)),
    ytdFunded: round2(monthly.reduce((s, r) => s + r.funded, 0)),
    deals
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

  // Fetching every approved run's data one at a time (one getPayRun() call after another) is
  // an N+1 round-trip pattern over a remote DB — fire them all concurrently instead, then
  // process the results in order exactly as before.
  const payRunDataList = await Promise.all(approvedRuns.map((run) => payRunService.getPayRun(run.id)));
  approvedRuns.forEach((run, i) => {
    const data = payRunDataList[i];
    const section = data.sections[sectionKey];
    if (!section || !section.total) return;
    const mk = monthKey(run.pay_period_date);
    allTimeTotal += section.total;
    if (mk && mk.startsWith(thisYear)) ytdTotal += section.total;
    if (mk in monthlyTotals) monthlyTotals[mk] += section.total;
    ledger.push({ payRunId: run.id, payPeriodDate: run.pay_period_date, status: run.status, total: section.total, rows: section.rows });
  });
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

module.exports = { getOverallDashboard, getStaffDashboard, getMonthlyTracker };
