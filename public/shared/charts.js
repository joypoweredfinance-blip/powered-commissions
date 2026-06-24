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
