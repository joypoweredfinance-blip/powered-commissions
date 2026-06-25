const { get, all } = require('../db/client');
const { calculateAustinPay, round2 } = require('./commissionEngine');

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

// Builds chart buckets covering [startDate, endDate] at a granularity that scales with the
// span, so a week filter gets daily bars, a year filter gets monthly bars, etc.
function generateBuckets(startDate, endDate) {
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  const fmt = (d) => d.toISOString().slice(0, 10);
  const spanDays = Math.round((end - start) / 86400000) + 1;
  const buckets = [];

  if (spanDays <= 14) {
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const ds = fmt(d);
      buckets.push({ label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), startDate: ds, endDate: ds });
    }
  } else if (spanDays <= 90) {
    for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 7)) {
      const chunkStart = fmt(cur);
      const chunkEndRaw = new Date(cur); chunkEndRaw.setDate(chunkEndRaw.getDate() + 6);
      const chunkEnd = fmt(chunkEndRaw > end ? end : chunkEndRaw);
      buckets.push({ label: cur.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), startDate: chunkStart, endDate: chunkEnd });
    }
  } else if (spanDays <= 731) {
    for (let cur = new Date(start.getFullYear(), start.getMonth(), 1); cur <= end; cur.setMonth(cur.getMonth() + 1)) {
      const y = cur.getFullYear(), m = cur.getMonth();
      const chunkStartRaw = new Date(y, m, 1);
      const chunkStart = fmt(chunkStartRaw < start ? start : chunkStartRaw);
      const lastDay = new Date(y, m + 1, 0);
      const chunkEnd = fmt(lastDay < end ? lastDay : end);
      buckets.push({ label: cur.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), startDate: chunkStart, endDate: chunkEnd });
    }
  } else {
    for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
      const chunkStartRaw = new Date(y, 0, 1);
      const chunkStart = fmt(chunkStartRaw < start ? start : chunkStartRaw);
      const lastOfYear = new Date(y, 11, 31);
      const chunkEnd = fmt(lastOfYear < end ? lastOfYear : end);
      buckets.push({ label: String(y), startDate: chunkStart, endDate: chunkEnd });
    }
  }
  return buckets;
}

function inRange(dateStr, startDate, endDate) {
  if (!dateStr) return false;
  const d = dateStr.slice(0, 10);
  if (startDate && d < startDate) return false;
  if (endDate && d > endDate) return false;
  return true;
}

async function getOverallDashboard({ statusIds, startDate, endDate } = {}) {
  const statusIdsArr = statusIds === undefined || statusIds === null ? [] : (Array.isArray(statusIds) ? statusIds : [statusIds]);
  const statusIdList = statusIdsArr.map(Number).filter((n) => !isNaN(n));
  const statusFilterSql = statusIdList.length ? ` AND d.status_id IN (${statusIdList.join(',')})` : '';
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
           d.m1_paid_date, d.net_ppw
    FROM deals d
    WHERE 1=1 ${statusFilterSql}
  `);
  // Rep names looked up separately so the filtered query above stays simple to read.
  const repNameRows = await all(`SELECT id, full_name, display_name FROM reps`);
  const repNameMap = {};
  repNameRows.forEach((r) => { repNameMap[r.id] = r.display_name || r.full_name; });

  let fundedCount = 0;
  let commissionsPaid = 0;
  let pendingApproval = 0;
  const repTotals = {};

  for (const d of allDeals) {
    if (d.m1_paid_date && (!hasPeriod || inRange(d.m1_paid_date, startDate, endDate))) fundedCount++;
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

  // Staff Pay (Etai + Noy + Joey) and Funds Received — attributed by the date each piece
  // actually got marked paid/received, filtered to the selected period (or all-time if none).
  const settings = await get(`SELECT owner_etai_m1, owner_etai_m2, owner_noy_m1, owner_noy_m2 FROM commission_settings WHERE id = 1`);
  const payRows = await all(`
    SELECT d.owner_m1_paid, d.owner_m1_paid_date, d.owner_m2_paid, d.owner_m2_paid_date,
           d.joey_paid, d.joey_paid_date, d.joey_m2_bonus,
           d.funds_received_m1, d.funds_received_m1_date, d.funds_received_m2, d.funds_received_m2_date,
           fin.name as financier_name
    FROM deals d LEFT JOIN financiers fin ON fin.id = d.financier_id
    WHERE 1=1 ${statusFilterSql}
  `);
  let staffPay = 0;
  let fundsReceived = 0;
  const financierTotals = {};
  for (const r of payRows) {
    if (r.owner_m1_paid && r.owner_m1_paid_date && (!hasPeriod || inRange(r.owner_m1_paid_date, startDate, endDate))) {
      staffPay += (settings.owner_etai_m1 || 0) + (settings.owner_noy_m1 || 0);
    }
    if (r.owner_m2_paid && r.owner_m2_paid_date && (!hasPeriod || inRange(r.owner_m2_paid_date, startDate, endDate))) {
      staffPay += (settings.owner_etai_m2 || 0) + (settings.owner_noy_m2 || 0);
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
  const fundsByFinancier = Object.entries(financierTotals)
    .map(([name, total]) => ({ name, total: round2(total) }))
    .sort((a, b) => b.total - a.total);

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

  // Funding status is a "right now" snapshot (what's currently owed), not affected by the
  // date filter — only by the status filter, same as before.
  const awaitingM1Rows = await all(`
    SELECT id, expected_m1_amount, system_size_kw, net_ppw, gross_amount, rep_pool FROM deals d
    WHERE m1_approved_date IS NOT NULL AND funds_received_m1_date IS NULL ${statusFilterSql}
  `);
  const awaitingM2Rows = await all(`
    SELECT id, expected_m2_amount, system_size_kw, net_ppw, gross_amount, rep_pool FROM deals d
    WHERE m2_approved_date IS NOT NULL AND funds_received_m2_date IS NULL ${statusFilterSql}
  `);
  const awaitingM1Total = round2(awaitingM1Rows.reduce((s, r) => s + (r.expected_m1_amount || 0), 0));
  const awaitingM2Total = round2(awaitingM2Rows.reduce((s, r) => s + (r.expected_m2_amount || 0), 0));
  const unionMap = new Map();
  [...awaitingM1Rows, ...awaitingM2Rows].forEach((r) => unionMap.set(r.id, r));
  const unionDeals = [...unionMap.values()];

  const avgOf = (key) => {
    const vals = unionDeals.map((d) => d[key]).filter((v) => v !== null && v !== undefined);
    return vals.length ? round2(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
  };
  const avgPoweredNet = (() => {
    const vals = unionDeals.filter((d) => d.gross_amount !== null && d.gross_amount !== undefined)
      .map((d) => (d.gross_amount || 0) - (d.rep_pool || 0));
    return vals.length ? round2(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
  })();

  const fundingStatus = {
    awaitingM1: { total: awaitingM1Total, count: awaitingM1Rows.length },
    awaitingM2: { total: awaitingM2Total, count: awaitingM2Rows.length },
    incoming: { total: round2(awaitingM1Total + awaitingM2Total), count: unionDeals.length },
    avgSystemSizeKw: avgOf('system_size_kw'),
    avgNetPpw: avgOf('net_ppw'),
    avgGross: avgOf('gross_amount'),
    avgPoweredNet
  };

  // Chart: commissions paid vs funds received, bucketed to fit the selected period.
  // Defaults to the last 12 months when no period is selected.
  let chartStart = startDate, chartEnd = endDate;
  if (!hasPeriod) {
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    chartStart = twelveMonthsAgo.toISOString().slice(0, 10);
    chartEnd = now.toISOString().slice(0, 10);
  }
  const buckets = generateBuckets(chartStart, chartEnd);
  const chartDeals = await all(`
    SELECT closer_paid_date, closer_pay_net, setter_paid_date, setter_pay,
           funds_received_m1_date, funds_received_m1, funds_received_m2_date, funds_received_m2
    FROM deals d WHERE 1=1 ${statusFilterSql}
  `);
  const chartBreakdown = buckets.map((b) => {
    let bCommissionsPaid = 0, bFundsReceived = 0;
    for (const d of chartDeals) {
      if (inRange(d.closer_paid_date, b.startDate, b.endDate)) bCommissionsPaid += d.closer_pay_net || 0;
      if (inRange(d.setter_paid_date, b.startDate, b.endDate)) bCommissionsPaid += d.setter_pay || 0;
      if (inRange(d.funds_received_m1_date, b.startDate, b.endDate)) bFundsReceived += d.funds_received_m1 || 0;
      if (inRange(d.funds_received_m2_date, b.startDate, b.endDate)) bFundsReceived += d.funds_received_m2 || 0;
    }
    return { label: b.label, commissionsPaid: round2(bCommissionsPaid), fundsReceived: round2(bFundsReceived) };
  });

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
      openClawbackCount: openClawbacks.cnt, openClawbackTotal: round2(openClawbacks.total)
    },
    periodLabel,
    fundingStatus,
    fundsByFinancier,
    chartBreakdown,
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

async function getStaffDashboard(staffId) {
  const staff = await get(`SELECT * FROM payroll_staff WHERE id = ?`, [staffId]);
  if (!staff) return null;
  const settings = await get(`SELECT * FROM commission_settings WHERE id = 1`);

  if (staff.staff_type === 'owner') {
    const isEtai = /etai/i.test(staff.full_name);
    const col = isEtai ? 'owner_etai_total' : 'owner_noy_total';
    const deals = await all(`
      SELECT id, customer_name, m1_approved_date, m2_approved_date, ${col} as amount, owner_m1_paid, owner_m2_paid
      FROM deals WHERE ${col} > 0 ORDER BY COALESCE(m2_approved_date, m1_approved_date) DESC
    `);
    const monthlyTotals = {};
    lastNMonths(6).forEach((m) => { monthlyTotals[m] = 0; });
    let ytdTotal = 0, allTimeTotal = 0;
    const thisYear = String(new Date().getFullYear());
    for (const d of deals) {
      const mk = monthKey(d.m2_approved_date || d.m1_approved_date);
      allTimeTotal += d.amount || 0;
      if (mk && mk.startsWith(thisYear)) ytdTotal += d.amount || 0;
      if (mk in monthlyTotals) monthlyTotals[mk] += d.amount || 0;
    }
    return {
      staff, type: 'owner',
      kpis: { ytdTotal: round2(ytdTotal), allTimeTotal: round2(allTimeTotal), dealCount: deals.length },
      monthlyTrend: lastNMonths(6).map((m) => ({ month: m, total: round2(monthlyTotals[m]) })),
      ledger: deals.slice(0, 20)
    };
  }

  if (staff.staff_type === 'pm') {
    const deals = await all(`
      SELECT id, customer_name, m2_approved_date, joey_m2_bonus, joey_paid, net_ppw
      FROM deals WHERE joey_m2_bonus > 0 ORDER BY m2_approved_date DESC
    `);
    let ytdBonus = 0, allTimeBonus = 0;
    const thisYear = String(new Date().getFullYear());
    const monthlyTotals = {};
    lastNMonths(6).forEach((m) => { monthlyTotals[m] = 0; });
    for (const d of deals) {
      const mk = monthKey(d.m2_approved_date);
      allTimeBonus += d.joey_m2_bonus || 0;
      if (mk && mk.startsWith(thisYear)) ytdBonus += d.joey_m2_bonus || 0;
      if (mk in monthlyTotals) monthlyTotals[mk] += d.joey_m2_bonus || 0;
    }
    return {
      staff, type: 'pm',
      kpis: { weeklySalary: settings.joey_weekly_salary, ytdBonus: round2(ytdBonus), allTimeBonus: round2(allTimeBonus), bonusCount: deals.length },
      monthlyTrend: lastNMonths(6).map((m) => ({ month: m, total: round2(monthlyTotals[m]) })),
      ledger: deals.slice(0, 20)
    };
  }

  // ops (Austin) — company-wide monthly installed kW, not deal-attributed
  const months = lastNMonths(6);
  const monthlyPay = [];
  for (const m of months) {
    const row = await get(`
      SELECT COALESCE(SUM(system_size_kw), 0) as kw FROM deals
      WHERE install_completed_date IS NOT NULL AND strftime('%Y-%m', install_completed_date) = ?
    `, [m]);
    const pay = calculateAustinPay({ monthlyInstalledKw: row.kw || 0, settings });
    monthlyPay.push({ month: m, kw: round2(row.kw || 0), ...pay });
  }
  const currentMonth = monthlyPay[monthlyPay.length - 1];
  return {
    staff, type: 'ops',
    kpis: { currentMonthKw: currentMonth.kw, currentMonthPay: currentMonth.total, base: settings.austin_base, ratePerKw: settings.austin_rate_per_kw },
    monthlyTrend: monthlyPay.map((m) => ({ month: m.month, total: m.total })),
    ledger: monthlyPay
  };
}

module.exports = { getOverallDashboard, getRepDashboard, getStaffDashboard };
