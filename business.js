// ============================================
// PAGE BUSINESS — analyse financière complète
// ============================================
// Utilise exclusivement business-data.js pour tous les calculs :
// mêmes chiffres que l'accueil, aucune duplication de logique (section 19).

let currentUser = null;
let currentPeriodType = 'semaine';
let currentOffset = 0;
let chartInstance = null;

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  document.querySelectorAll('#period-segmented button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#period-segmented button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPeriodType = btn.dataset.period;
      currentOffset = 0;
      loadAll();
    });
  });

  document.getElementById('period-prev').addEventListener('click', () => { currentOffset -= 1; loadAll(); });
  document.getElementById('period-next').addEventListener('click', () => { currentOffset += 1; loadAll(); });

  await loadAll();
  await loadWeeksComparison();
}

async function loadAll() {
  const range = getPeriodRange(currentPeriodType, currentOffset);
  document.getElementById('period-label').textContent = range.label;
  document.getElementById('period-sub').textContent = range.label;

  const sessions = await fetchSessionsInRange(range.start, range.end);
  const kpis = computeCoachingKPIs(sessions);

  document.getElementById('kpi-ca-realise').textContent = formatEuroB(kpis.caRealise);
  document.getElementById('kpi-ca-planifie').textContent = formatEuroB(kpis.caPlanifie);
  document.getElementById('kpi-marge').textContent = formatEuroB(kpis.marge);
  document.getElementById('kpi-net').textContent = formatEuroB(kpis.netEstime);
  document.getElementById('kpi-redevance').textContent = formatEuroB(kpis.redevance);
  document.getElementById('kpi-provision').textContent = formatEuroB(kpis.provision);
  document.getElementById('kpi-heures').textContent = `${Math.round(kpis.heures * 10) / 10}h`;

  document.getElementById('pay-realise').textContent = formatEuroB(kpis.caRealise);
  const encaisse = kpis.caRealise - kpis.aEncaisser;
  document.getElementById('pay-encaisse').textContent = formatEuroB(encaisse);
  document.getElementById('pay-a-encaisser').textContent = formatEuroB(kpis.aEncaisser);

  document.getElementById('pipe-realise-count').textContent = kpis.pipeline.realise.count;
  document.getElementById('pipe-realise-amount').textContent = formatEuroB(kpis.pipeline.realise.ca);
  document.getElementById('pipe-prevu-count').textContent = kpis.pipeline.prevu.count;
  document.getElementById('pipe-prevu-amount').textContent = formatEuroB(kpis.pipeline.prevu.ca);
  document.getElementById('pipe-annule-count').textContent = kpis.pipeline.annule.count;
  document.getElementById('pipe-annule-amount').textContent = formatEuroB(kpis.pipeline.annule.ca) + ' perdus';

  // Total entrepreneurial : Moka pas encore branché, donc = Coaching seul pour l'instant
  document.getElementById('total-ca').textContent = formatEuroB(kpis.caRealise);
  document.getElementById('total-net').textContent = formatEuroB(kpis.netEstime);

  renderChart(range, sessions);
}

function renderChart(range, sessions) {
  const series = buildChartSeries(range, sessions);
  const ctx = document.getElementById('ca-chart').getContext('2d');
  const styles = getComputedStyle(document.documentElement);
  const padelColor = styles.getPropertyValue('--padel').trim();
  const accentColor = styles.getPropertyValue('--accent').trim();
  const inkFaint = styles.getPropertyValue('--ink-faint').trim();
  const border = styles.getPropertyValue('--border').trim();

  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: series.labels,
      datasets: [
        { label: 'CA réalisé', data: series.realiseCumule, borderColor: padelColor, backgroundColor: padelColor + '26', fill: true, tension: 0.35, pointRadius: 2 },
        { label: 'CA planifié', data: series.planifieCumule, borderColor: accentColor, borderDash: [5, 4], backgroundColor: 'transparent', fill: false, tension: 0.35, pointRadius: 2 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: inkFaint, boxWidth: 10, font: { size: 11 } } } },
      scales: {
        x: { grid: { color: border }, ticks: { color: inkFaint, font: { size: 11 } } },
        y: { grid: { color: border }, ticks: { color: inkFaint, font: { size: 11 }, callback: v => v + '€' } },
      },
    },
  });
}

async function loadWeeksComparison() {
  const weeks = [];
  for (let offset = -3; offset <= 0; offset++) {
    const range = getPeriodRange('semaine', offset);
    const sessions = await fetchSessionsInRange(range.start, range.end);
    const kpis = computeCoachingKPIs(sessions);
    weeks.push({ label: range.label.replace('Semaine ', 'S'), ca: kpis.caRealise });
  }

  const max = Math.max(...weeks.map(w => w.ca), 1);
  const container = document.getElementById('weeks-compare');
  container.innerHTML = weeks.map(w => `
    <div class="week-bar-col">
      <div class="week-bar-value">${formatEuroB(w.ca)}</div>
      <div class="week-bar" style="height:${Math.max(4, (w.ca / max) * 100)}%"></div>
      <div class="week-bar-label">${w.label}</div>
    </div>
  `).join('');
}

function formatEuroB(amount) {
  return Math.round(amount || 0).toLocaleString('fr-FR') + '€';
}

init();
