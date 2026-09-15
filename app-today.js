// ============================================
// DASHBOARD AUJOURD'HUI — avec Pilotage Coaching
// ============================================

let currentUser = null;
let categoryById = {};
let currentPeriodType = 'semaine';
let currentOffset = 0;
let chartInstance = null;

function todayISOLocal() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().split('T')[0];
}

function formatDateFR(isoDate) {
  const d = new Date(isoDate + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatEuro(amount) {
  return Math.round(amount || 0).toLocaleString('fr-FR') + '€';
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  initThemeToggle();

  document.getElementById('logout-btn').addEventListener('click', (e) => { e.preventDefault(); logout(); });

  document.getElementById('greeting-text').textContent = 'Bonjour Benjamin 👋';
  document.getElementById('today-date').textContent = formatDateFR(todayISOLocal());

  document.getElementById('qa-tache').addEventListener('click', () => window.location.href = 'tasks.html?new=1');
  document.getElementById('qa-cours').addEventListener('click', () => window.location.href = 'coaching.html?new=1');
  document.getElementById('qa-entrainement').addEventListener('click', () => window.location.href = 'running.html?new=1');
  document.getElementById('capture-card').addEventListener('click', quickCapture);

  document.querySelectorAll('#period-segmented button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#period-segmented button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPeriodType = btn.dataset.period;
      currentOffset = 0;
      loadPilotage();
    });
  });

  document.getElementById('period-prev').addEventListener('click', () => { currentOffset -= 1; loadPilotage(); });
  document.getElementById('period-next').addEventListener('click', () => { currentOffset += 1; loadPilotage(); });

  document.getElementById('close-list-modal').addEventListener('click', () => {
    document.getElementById('list-modal-overlay').classList.remove('open');
  });

  document.querySelectorAll('.pipeline-block').forEach(block => {
    block.addEventListener('click', () => showPipelineDetail(block.dataset.pipeline));
  });

  document.getElementById('alert-encaisser').addEventListener('click', showEncaisserDetail);

  const { data: cats } = await supabaseClient.from('categories').select('id, key, label');
  (cats || []).forEach(c => { categoryById[c.id] = c; });

  setupWM();
  await loadWeekMonthTasks();
  await loadPilotage();
  await loadFocusAndPlan();
  await loadUniverses();
}

async function quickCapture() {
  const content = window.prompt("Capture rapide — qu'est-ce que tu veux noter ?");
  if (!content || !content.trim()) return;
  await supabaseClient.from('inbox_items').insert({ user_id: currentUser.id, content: content.trim() });
  alert('Ajouté à ton Inbox 💡');
}

// ============================================
// PILOTAGE COACHING
// ============================================

let lastKPIs = null; // gardé en mémoire pour les clics pipeline / à encaisser

async function loadPilotage() {
  const range = getPeriodRange(currentPeriodType, currentOffset);
  document.getElementById('period-label').textContent = range.label;

  const [sessions, prevSessions, tournaments, prevTournaments] = await Promise.all([
    fetchSessionsInRange(range.start, range.end),
    fetchSessionsInRange(range.prevStart, range.prevEnd),
    fetchTournamentsInRange(range.start, range.end),
    fetchTournamentsInRange(range.prevStart, range.prevEnd),
  ]);

  const sessionKpis = computeCoachingKPIs(sessions);
  const prevSessionKpis = computeCoachingKPIs(prevSessions);
  const tournamentKpis = computeTournamentKPIs(tournaments);
  const prevTournamentKpis = computeTournamentKPIs(prevTournaments);

  // Padel = Coaching (cours) + Tournois, combinés pour le CA/net affichés en haut.
  // Les autres indicateurs (redevance, marge, provision, heures, activité,
  // pipeline) restent spécifiques aux cours, les tournois n'ayant ni redevance
  // club ni provision URSSAF dans le modèle que tu m'as donné.
  const kpis = {
    ...sessionKpis,
    caRealise: round2(sessionKpis.caRealise + tournamentKpis.caRealise),
    caPlanifie: round2(sessionKpis.caPlanifie + tournamentKpis.caPlanifie),
    netEstime: round2(sessionKpis.netEstime + tournamentKpis.netEstime),
  };
  const prevKpis = {
    ...prevSessionKpis,
    caRealise: round2(prevSessionKpis.caRealise + prevTournamentKpis.caRealise),
    caPlanifie: round2(prevSessionKpis.caPlanifie + prevTournamentKpis.caPlanifie),
    netEstime: round2(prevSessionKpis.netEstime + prevTournamentKpis.netEstime),
  };
  lastKPIs = kpis;

  renderKPI('kpi-ca-realise', kpis.caRealise, prevKpis.caRealise, range.isCurrent);
  renderKPI('kpi-ca-planifie', kpis.caPlanifie, prevKpis.caPlanifie, range.isCurrent);
  renderKPI('kpi-net', kpis.netEstime, prevKpis.netEstime, range.isCurrent);
  renderKPIHeures(kpis.heures, prevKpis.heures, range.isCurrent);

  document.getElementById('kpi-redevance').textContent = formatEuro(kpis.redevance);
  document.getElementById('kpi-provision').textContent = formatEuro(kpis.provision);
  document.getElementById('kpi-a-encaisser-inline').textContent = formatEuro(kpis.aEncaisser);

  document.getElementById('kpi-split-cours').textContent = formatEuro(sessionKpis.caRealise);
  document.getElementById('kpi-split-tournois').textContent = formatEuro(tournamentKpis.caRealise);
  document.getElementById('kpi-split-total').textContent = formatEuro(kpis.caRealise);

  await renderObjective(range, kpis);
  renderChart(range, sessions);
  renderActivity(kpis);
  renderPipeline(kpis);
  renderAlert(kpis);
}

function renderKPI(prefix, current, previous, isCurrent) {
  document.getElementById(prefix).textContent = formatEuro(current);
  const delta = computeDelta(current, previous);
  const el = document.getElementById(prefix + '-delta');
  renderDeltaEl(el, delta, isCurrent);
}

function renderKPIHeures(current, previous, isCurrent) {
  const h = Math.floor(current);
  const m = Math.round((current - h) * 60);
  document.getElementById('kpi-heures').textContent = `${h}h${m > 0 ? m.toString().padStart(2, '0') : ''}`;
  const delta = computeDelta(current, previous);
  renderDeltaEl(document.getElementById('kpi-heures-delta'), delta, isCurrent);
}

function renderDeltaEl(el, delta, isCurrent) {
  if (delta.direction === 'flat') { el.innerHTML = ''; return; }
  const arrow = delta.direction === 'up' ? '↑' : '↓';
  const vsLabel = isCurrent ? 'vs période équiv. précédente' : 'vs période précédente';
  el.className = `kpi-hero-delta ${delta.direction}`;
  el.innerHTML = `${arrow} ${delta.pct}% <span class="vs">${vsLabel}</span>`;
}

async function renderObjective(range, kpis) {
  const card = document.getElementById('objective-card');
  if (range.type === 'jour') {
    const objectif = await fetchObjective(currentUser.id, range);
    if (!objectif) { card.style.display = 'none'; return; }
    showObjective(kpis.caPlanifie, objectif);
    return;
  }
  const objectif = await fetchObjective(currentUser.id, range);
  if (!objectif) { card.style.display = 'none'; return; }
  showObjective(kpis.caPlanifie, objectif);
}

function showObjective(current, target) {
  const card = document.getElementById('objective-card');
  card.style.display = 'block';
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  document.getElementById('obj-current').textContent = formatEuro(current);
  document.getElementById('obj-target').textContent = formatEuro(target);
  document.getElementById('obj-pct').textContent = pct + '%';
  document.getElementById('obj-bar-fill').style.width = pct + '%';
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
        {
          label: 'CA réalisé',
          data: series.realiseCumule,
          borderColor: padelColor,
          backgroundColor: padelColor + '26',
          fill: true,
          tension: 0.35,
          pointRadius: 2,
        },
        {
          label: 'CA planifié',
          data: series.planifieCumule,
          borderColor: accentColor,
          borderDash: [5, 4],
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.35,
          pointRadius: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, labels: { color: inkFaint, boxWidth: 10, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            afterBody: (items) => {
              const idx = items[0]?.dataIndex;
              const d = series.details[idx];
              if (!d) return '';
              return [`${d.nbCours} cours · ${d.heures}h`];
            },
          },
        },
      },
      scales: {
        x: { grid: { color: border }, ticks: { color: inkFaint, font: { size: 11 } } },
        y: { grid: { color: border }, ticks: { color: inkFaint, font: { size: 11 }, callback: v => v + '€' } },
      },
    },
  });
}

function renderActivity(kpis) {
  document.getElementById('act-realises').textContent = kpis.pipeline.realise.count;
  document.getElementById('act-restants').textContent = kpis.pipeline.prevu.count;
  document.getElementById('act-annules').textContent = kpis.pipeline.annule.count;
  document.getElementById('act-heures').textContent =
    `${Math.round(kpis.heuresRealisees * 10) / 10}h / ${Math.round(kpis.heuresPlanifiees * 10) / 10}h`;

  const labels = { individuels: 'Individuels', duos: 'Duos', collectifs: 'Collectifs' };
  Object.entries(kpis.typeBreakdown).forEach(([key, val]) => {
    document.getElementById(`type-${key}-num`).textContent = `${val.count} cours`;
    document.getElementById(`type-${key}-sub`).textContent = `${formatEuro(val.ca)} · ${Math.round(val.heures * 10) / 10}h`;
  });
}

function renderPipeline(kpis) {
  document.getElementById('pipe-realise-count').textContent = kpis.pipeline.realise.count;
  document.getElementById('pipe-realise-amount').textContent = formatEuro(kpis.pipeline.realise.ca);
  document.getElementById('pipe-prevu-count').textContent = kpis.pipeline.prevu.count;
  document.getElementById('pipe-prevu-amount').textContent = formatEuro(kpis.pipeline.prevu.ca);
  document.getElementById('pipe-annule-count').textContent = kpis.pipeline.annule.count;
  document.getElementById('pipe-annule-amount').textContent = formatEuro(kpis.pipeline.annule.ca) + ' perdus';
}

function renderAlert(kpis) {
  document.getElementById('alert-num').textContent = formatEuro(kpis.aEncaisser);
  document.getElementById('alert-sub').textContent = `${kpis.aEncaisserSessions.length} cours`;
}

function showPipelineDetail(key) {
  if (!lastKPIs) return;
  const map = { realise: lastKPIs.sessionsRealise, prevu: lastKPIs.sessionsPrevu, annule: lastKPIs.sessionsAnnule };
  const titles = { realise: 'Cours réalisés', prevu: 'Cours prévus', annule: 'Cours annulés' };
  const sessions = map[key];

  const body = document.getElementById('list-modal-body');
  if (sessions.length === 0) {
    body.innerHTML = '<p class="empty">Aucun cours ici.</p>';
  } else {
    body.innerHTML = sessions.map(s => `
      <div class="list-modal-row">
        <span>${s.date} · ${s.time?.slice(0, 5)} · ${TYPE_LABELS_FR[s.type] || s.type}</span>
        <span><b>${formatEuro(s.ca_brut)}</b></span>
      </div>
    `).join('');
  }
  document.getElementById('list-modal-title').textContent = titles[key];
  document.getElementById('list-modal-overlay').classList.add('open');
}

function showEncaisserDetail() {
  if (!lastKPIs) return;
  const sessions = lastKPIs.aEncaisserSessions;
  const body = document.getElementById('list-modal-body');

  if (sessions.length === 0) {
    body.innerHTML = '<p class="empty">Rien à encaisser sur cette période 🎉</p>';
  } else {
    body.innerHTML = sessions.map(s => `
      <div class="list-modal-row" data-session-id="${s.id}">
        <span>${s.date} · ${s.time?.slice(0, 5)} · ${TYPE_LABELS_FR[s.type] || s.type} — <b>${formatEuro(s.ca_brut)}</b></span>
        <button class="icon-btn" data-mark-paid="${s.id}" title="Marquer payé">✓</button>
      </div>
    `).join('');

    body.querySelectorAll('[data-mark-paid]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await supabaseClient.from('coaching_sessions').update({ payment_status: 'paye' }).eq('id', btn.dataset.markPaid);
        document.getElementById('list-modal-overlay').classList.remove('open');
        await loadPilotage();
      });
    });
  }
  document.getElementById('list-modal-title').textContent = 'À encaisser';
  document.getElementById('list-modal-overlay').classList.add('open');
}

// ============================================
// TÂCHES À VENIR (SEMAINE / MOIS)
// ============================================

let wmRangeType = 'semaine';

function setupWM() {
  document.querySelectorAll('#wm-segmented button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#wm-segmented button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      wmRangeType = btn.dataset.range;
      loadWeekMonthTasks();
    });
  });
}

async function loadWeekMonthTasks() {
  const range = getPeriodRange(wmRangeType, 0);
  const { data: tasks } = await supabaseClient
    .from('tasks').select('id, title, category_id, status, date, priority')
    .gte('date', range.start).lte('date', range.end)
    .neq('status', 'annule').neq('status', 'termine')
    .order('date', { ascending: true });

  renderWMList(tasks || []);
}

function renderWMList(tasks) {
  const el = document.getElementById('wm-list');
  if (tasks.length === 0) {
    el.innerHTML = '<p class="empty">Rien à venir sur cette période.</p>';
    return;
  }
  el.innerHTML = tasks.map(t => {
    const cat = categoryById[t.category_id];
    return `
      <div class="task-row" data-id="${t.id}">
        <div class="checkbox" data-action="toggle"></div>
        <div class="task-body">
          <div class="task-title">${escapeHTML(t.title)}</div>
          <div class="task-meta">
            <span class="cat-badge ${cat?.key || ''}">${cat?.label || ''}</span>
            <span class="priority-dot ${t.priority}"></span>
            <span>${formatDateShortWM(t.date)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  el.querySelectorAll('.task-row').forEach(row => {
    row.querySelector('[data-action="toggle"]').addEventListener('click', async () => {
      await supabaseClient.from('tasks').update({
        status: 'termine', completed_at: new Date().toISOString(),
      }).eq('id', row.dataset.id);
      await loadWeekMonthTasks();
      await loadFocusAndPlan();
    });
  });
}

function formatDateShortWM(iso) {
  const today = todayISOLocal();
  if (iso === today) return "Aujourd'hui";
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

// ============================================
// FOCUS DU JOUR + PLANNING DU JOUR
// ============================================

async function loadFocusAndPlan() {
  const today = todayISOLocal();

  const { data: tasks } = await supabaseClient
    .from('tasks').select('id, title, category_id, status, is_focus, time')
    .eq('date', today).neq('status', 'annule');

  const { data: sessions } = await supabaseClient
    .from('coaching_sessions').select('id, time, type, nb_players, status')
    .eq('date', today).neq('status', 'annule').order('time', { ascending: true });

  renderFocus((tasks || []).filter(t => t.is_focus));
  renderTodayPlan(tasks || [], sessions || []);
}

function renderFocus(focusTasks) {
  const el = document.getElementById('focus-list');
  if (focusTasks.length === 0) {
    el.innerHTML = '<p class="empty">Aucune priorité définie pour aujourd\'hui.</p>';
    return;
  }
  el.innerHTML = focusTasks.map(t => `
    <div class="focus-item ${t.status === 'termine' ? 'done' : ''}" data-id="${t.id}" data-status="${t.status}">
      <div class="checkbox ${t.status === 'termine' ? 'checked' : ''}">${t.status === 'termine' ? '✓' : ''}</div>
      <div class="focus-title">${escapeHTML(t.title)}</div>
    </div>
  `).join('');

  el.querySelectorAll('.focus-item').forEach(item => {
    item.addEventListener('click', async () => {
      const id = item.dataset.id;
      const newStatus = item.dataset.status === 'termine' ? 'a_faire' : 'termine';
      await supabaseClient.from('tasks').update({
        status: newStatus, completed_at: newStatus === 'termine' ? new Date().toISOString() : null,
      }).eq('id', id);
      loadFocusAndPlan();
    });
  });
}

function renderTodayPlan(tasks, sessions) {
  const el = document.getElementById('today-plan');
  const items = [
    ...sessions.map(s => ({
      sortKey: s.time || '99:99',
      html: `<div class="task-row">
        <span class="badge realise" style="background:var(--padel-soft);color:var(--padel);">${s.time?.slice(0,5)}</span>
        <div class="task-body"><div class="task-title">Cours ${TYPE_LABELS_FR[s.type] || s.type} · ${s.nb_players} joueur${s.nb_players > 1 ? 's' : ''}</div></div>
      </div>`,
    })),
    ...tasks.map(t => ({
      sortKey: t.time || '99:99',
      html: `<div class="task-row">
        <div class="checkbox ${t.status === 'termine' ? 'checked' : ''}">${t.status === 'termine' ? '✓' : ''}</div>
        <div class="task-body"><div class="task-title" style="${t.status === 'termine' ? 'text-decoration:line-through;color:var(--ink-faint);' : ''}">${escapeHTML(t.title)}</div></div>
      </div>`,
    })),
  ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  el.innerHTML = items.length > 0 ? items.map(i => i.html).join('') : '<p class="empty">Rien de prévu aujourd\'hui.</p>';
}

// ============================================
// AUTRES UNIVERS (Thalgo / Moka / Running)
// ============================================

async function loadUniverses() {
  const today = todayISOLocal();
  const { data: tasks } = await supabaseClient
    .from('tasks').select('category_id, status').neq('status', 'annule').eq('date', today);

  // Carte Coaching : indépendante du filtre de période du bloc Pilotage,
  // pour toujours voir tes cours même si tu regardes "Jour" ou "Mois" plus haut.
  const { data: nextSessions } = await supabaseClient
    .from('coaching_sessions').select('date, time, type')
    .eq('status', 'prevu').gte('date', today)
    .order('date', { ascending: true }).order('time', { ascending: true }).limit(1);

  const monday = toISO(getMonday(new Date()));
  const { data: weekSessions } = await supabaseClient
    .from('coaching_sessions').select('status')
    .gte('date', monday).lte('date', toISO(addDays(parseISO(monday), 6)))
    .neq('status', 'annule');

  const realiseCount = (weekSessions || []).filter(s => s.status === 'realise').length;
  const nextSession = (nextSessions || [])[0];

  const OTHER_UNIVERSES = [
    { key: 'thalgo', label: 'Thalgo', icon: '💼' },
    { key: 'moka', label: 'Moka Studio', icon: '☕' },
    { key: 'running', label: 'Course à pied', icon: '🏃' },
  ];

  const grid = document.getElementById('universe-grid');

  const padelMeta = nextSession
    ? `Prochain cours : ${formatDateShortUniv(nextSession.date)} ${nextSession.time?.slice(0, 5)}`
    : 'Aucun cours à venir';

  let html = `
    <div class="universe-card padel" onclick="window.location.href='coaching.html'" style="cursor:pointer">
      <div class="universe-head">
        <span>🎾 Coaching Padel</span>
        <span>${realiseCount} réalisé${realiseCount > 1 ? 's' : ''} cette sem.</span>
      </div>
      <div class="universe-meta">${padelMeta}</div>
    </div>
  `;

  html += OTHER_UNIVERSES.map(u => {
    const catId = Object.keys(categoryById).find(id => categoryById[id].key === u.key);
    const universeTasks = (tasks || []).filter(t => t.category_id === catId);
    const remaining = universeTasks.filter(t => t.status !== 'termine');
    const total = universeTasks.length;
    const done = total - remaining.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const clickable = u.key === 'running' ? " onclick=\"window.location.href='running.html'\" style=\"cursor:pointer\"" : '';

    return `
      <div class="universe-card ${u.key}"${clickable}>
        <div class="universe-head">
          <span>${u.icon} ${u.label}</span>
          <span>${remaining.length} tâche${remaining.length > 1 ? 's' : ''}</span>
        </div>
        <div class="universe-meta">${remaining[0] ? 'Tâche du jour en attente' : 'Rien de prévu'}</div>
        ${total > 0 ? `<div class="universe-bar"><div class="universe-bar-fill" style="width:${pct}%"></div></div>` : ''}
      </div>
    `;
  }).join('');

  grid.innerHTML = html;
}

function formatDateShortUniv(iso) {
  const today = todayISOLocal();
  if (iso === today) return "aujourd'hui";
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

init();
