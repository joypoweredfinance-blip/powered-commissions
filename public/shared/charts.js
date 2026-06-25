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

// Simple least-squares fit over (0..n-1, values) — no extra chart.js plugin needed for a
// straight trendline.
function linearRegression(values) {
  const n = values.length;
  if (n < 2) return values.map(() => values[0] || 0);
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  values.forEach((y, x) => { sumX += x; sumY += y; sumXY += x * y; sumXX += x * x; });
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX || 1);
  const intercept = (sumY - slope * sumX) / n;
  return values.map((_, x) => slope * x + intercept);
}

function renderWeeklyComparisonChart(canvasId, weeklyBreakdown) {
  const ctx = document.getElementById(canvasId).getContext('2d');
  const commissionsPaid = weeklyBreakdown.map((w) => w.commissionsPaid);
  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: weeklyBreakdown.map((w) => w.label),
      datasets: [
        { label: 'Commissions Paid', data: commissionsPaid, backgroundColor: '#6B3FD4', borderRadius: 6, maxBarThickness: 32 },
        { label: 'Funds Received', data: weeklyBreakdown.map((w) => w.fundsReceived), backgroundColor: '#1B5E45', borderRadius: 6, maxBarThickness: 32 },
        {
          type: 'line', label: 'Trend (Commissions Paid)', data: linearRegression(commissionsPaid),
          borderColor: '#B6760F', borderWidth: 2, borderDash: [6, 4], pointRadius: 0, fill: false, tension: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 12, font: { size: 12 } } } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: (v) => '$' + v.toLocaleString() }, grid: { color: '#EFEDF6' } },
        x: { grid: { display: false } }
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
