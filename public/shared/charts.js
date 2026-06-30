function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short' });
}

function renderTrendChart(canvasId, trend, { color = '#6B3FD4', label = 'Paid' } = {}) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: trend.map((t) => monthLabel(t.month)),
      datasets: [{
        label,
        data: trend.map((t) => t.total),
        backgroundColor: color,
        borderRadius: 6,
        maxBarThickness: 36
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: (v) => '$' + v.toLocaleString() }, grid: { color: '#EFEDF6' } },
        x: { grid: { display: false } }
      }
    }
  });
}

// Per-job comparison — Funds Received as its own bar, Commission Paid + Staff Pay stacked
// together as a second bar (same "stack" group), so each job shows "what came in" next to
// "what went out, broken into who got it" rather than two independently time-bucketed
// totals that may not actually relate to the same work. Horizontal bars read better than
// vertical ones once labels are customer names.
function renderJobComparisonChart(canvasId, jobComparison) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: jobComparison.map((j) => j.customerName),
      datasets: [
        { label: 'Funds Received', data: jobComparison.map((j) => j.fundsReceived), backgroundColor: '#1B5E45', stack: 'received', borderRadius: 4, maxBarThickness: 18 },
        { label: 'Commission Paid', data: jobComparison.map((j) => j.commissionPaid), backgroundColor: '#6B3FD4', stack: 'paidOut', borderRadius: 4, maxBarThickness: 18 },
        { label: 'Staff Pay', data: jobComparison.map((j) => j.staffPaid || 0), backgroundColor: '#B6760F', stack: 'paidOut', borderRadius: 4, maxBarThickness: 18 }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 12, font: { size: 12 } } } },
      scales: {
        x: { stacked: true, beginAtZero: true, ticks: { callback: (v) => '$' + v.toLocaleString() }, grid: { color: '#EFEDF6' } },
        y: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  });
}

const PIE_COLORS = ['#6B3FD4', '#1B5E45', '#B6760F', '#C9526B', '#3F7FB6', '#8A8DAA', '#D4A23F', '#5E3FA0'];

function renderContractPieChart(canvasId, breakdown) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  const slices = breakdown.slices;
  const total = breakdown.totalContractValue || slices.reduce((s, x) => s + x.amount, 0);
  return new Chart(ctx, {
    type: 'pie',
    data: {
      labels: slices.map((s) => s.label),
      datasets: [{ data: slices.map((s) => s.amount), backgroundColor: slices.map((_, i) => PIE_COLORS[i % PIE_COLORS.length]) }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const amount = ctx.parsed;
              const pct = total > 0 ? ((amount / total) * 100).toFixed(1) : '0.0';
              return `${ctx.label}: $${amount.toLocaleString()} (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

// Stacked bar, one bar per installer, segments = adder category — values are the AVERAGE per
// job (not raw totals), so an installer with more deals in the period doesn't just look
// "more expensive" purely from volume. This is the actual cost comparison Joy asked for.
const INSTALLER_CHART_COLORS = ['#6B3FD4', '#1B5E45', '#B6760F', '#C9526B', '#3F7FB6', '#8A8DAA'];

function renderInstallerAddersChart(canvasId, comparison, categoryLabels) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  const categories = Object.keys(categoryLabels);
  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: comparison.map((c) => `${c.installerName} (${c.jobCount} job${c.jobCount === 1 ? '' : 's'})`),
      datasets: categories.map((cat, i) => ({
        label: categoryLabels[cat],
        data: comparison.map((c) => c.perJobByCategory[cat] || 0),
        backgroundColor: INSTALLER_CHART_COLORS[i % INSTALLER_CHART_COLORS.length],
        borderRadius: 3
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: $${ctx.parsed.y.toLocaleString()} avg/job`
          }
        }
      },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => '$' + v.toLocaleString() }, grid: { color: '#EFEDF6' } }
      }
    }
  });
}

// Net Profit Generated (purple) vs $ Funded M1+M2 (green) — same color convention as the
// Funds Received vs Commission Paid chart above (green always means money that actually came
// in), grouped side-by-side per month rather than stacked, since the two numbers aren't parts
// of a whole — they're two independent series worth comparing month to month.
function renderMonthlyTrackerChart(canvasId, monthly) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: monthly.map((m) => monthNames[m.month - 1]),
      datasets: [
        { label: 'Net Profit Generated', data: monthly.map((m) => m.netProfit), backgroundColor: '#6B3FD4', borderRadius: 5, maxBarThickness: 28 },
        { label: '$ Funded (M1+M2)', data: monthly.map((m) => m.funded), backgroundColor: '#1B5E45', borderRadius: 5, maxBarThickness: 28 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top', labels: { boxWidth: 12, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: (c) => {
              const val = c.parsed.y;
              const funded = c.chart.data.datasets.find((d) => d.label === '$ Funded (M1+M2)')?.data[c.dataIndex] || 0;
              const pctStr = funded && c.dataset.label !== '$ Funded (M1+M2)'
                ? ` (${((val / funded) * 100).toFixed(1)}% of funded)` : '';
              return `${c.dataset.label}: $${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${pctStr}`;
            }
          }
        }
      },
      scales: {
        y: { beginAtZero: true, ticks: { callback: (v) => '$' + v.toLocaleString() }, grid: { color: '#EFEDF6' } },
        x: { grid: { display: false } }
      }
    }
  });
}

function renderFunnelChart(canvasId, pipeline) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: pipeline.map((p) => p.label),
      datasets: [{
        data: pipeline.map((p) => p.count),
        backgroundColor: pipeline.map((p) => (p.phase === 'closed' ? '#C9C6D6' : p.phase === 'post_install' ? '#1B5E45' : '#6B3FD4')),
        borderRadius: 5
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#EFEDF6' } },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  });
}
