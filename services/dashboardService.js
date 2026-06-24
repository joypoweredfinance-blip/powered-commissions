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

async function getOverallDashboard() {
  const thisMonth = monthKey(new Date().toISOString());
  const thisYear = String(new Date().getFullYear());

  const activeDeals = await get(`
    SELECT COUNT(*) c FROM deals d LEFT JOIN deal_statuses ds ON ds.id = d.status_id
    WHERE COALESCE(ds.phase, 'pre_install') != 'closed'
  `);
  const totalDeals = await get(`SELECT COUNT(*) c FROM deals`);

  const allDeals = await all(`
    SELECT d.id, d.closer_rep_id, d.setter_rep_id, d.closer_pay_net, d.setter_pay,
           d.closer_paid, d.closer_paid_date, d.setter_paid, d.setter_paid_date,
           d.closer_breakdown_approved, d.setter_breakdown_approved,
           d.m1_paid_date, d.net_ppw,
           cr.full_name as closer_name, cr.display_name as closer_display,
           sr.full_name as setter_name, sr.display_name as setter_display
    FROM deals d
    LEFT JOIN reps cr ON cr.id = d.closer_rep_id
    LEFT JOIN reps sr ON sr.id = d.setter_rep_id
  `);

  let fundedThisMonth = 0, fundedYTD = 0;
  let paidThisMonth = 0, paidYTD = 0;
  let pendingApproval = 0;
  const monthlyTotals = {};
  lastNMonths(6).forEach((m) => { monthlyTotals[m] = 0; });
  const repTotals = {};

  for (const d of allDeals) {
    if (d.m1_paid_date) {
      const mk = monthKey(d.m1_paid_date);
      if (mk === thisMonth) fundedThisMonth++;
      if (mk && mk.startsWith(thisYear)) fundedYTD++;
    }
    if (d.closer_rep_id && !d.closer_breakdown_approved) pendingApproval += d.closer_pay_net || 0;
    if (d.setter_rep_id && !d.setter_breakdown_approved) pendingApproval += d.setter_pay || 0;

    if (d.closer_paid && d.closer_paid_date) {
      const mk = monthKey(d.closer_paid_date);
      const amt = d.closer_pay_net || 0;
      if (mk === thisMonth) paidThisMonth += amt;
      if (mk && mk.startsWith(thisYear)) paidYTD += amt;
      if (mk in monthlyTotals) monthlyTotals[mk] += amt;
      const key = d.closer_rep_id;
      repTotals[key] = repTotals[key] || { name: d.closer_display || d.closer_name, dealCount: 0, total: 0 };
      repTotals[key].total += amt;
      repTotals[key].dealCount += 1;
    }
    if (d.setter_paid && d.setter_paid_date) {
      const mk = monthKey(d.setter_paid_date);
      const amt = d.setter_pay || 0;
      if (mk === thisMonth) paidThisMonth += amt;
      if (mk && mk.startsWith(thisYear)) paidYTD += amt;
      if (mk in monthlyTotals) monthlyTotals[mk] += amt;
      const key = d.setter_rep_id;
      repTotals[key] = repTotals[key] || { name: d.setter_display || d.setter_name, dealCount: 0, total: 0 };
      repTotals[key].total += amt;
      repTotals[key].dealCount += 1;
    }
  }

  const outstandingAdvances = await get(`SELECT COALESCE(SUM(amount - amount_deducted), 0) c FROM advances WHERE status != 'deducted'`);
  const openClawbacks = await get(`SELECT COUNT(*) cnt, COALESCE(SUM(total_clawback), 0) total FROM clawbacks WHERE deducted = 0`);

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

  return {
    kpis: {
      activeDeals: activeDeals.c,
      totalDeals: totalDeals.c,
      fundedThisMonth, fundedYTD,
      paidThisMonth: round2(paidThisMonth), paidYTD: round2(paidYTD),
      pendingApproval: round2(pendingApproval),
      outstandingAdvances: round2(outstandingAdvances.c),
      openClawbackCount: openClawbacks.cnt, openClawbackTotal: round2(openClawbacks.total)
    },
    monthlyTrend: lastNMonths(6).map((m) => ({ month: m, total: round2(monthlyTotals[m]) })),
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
