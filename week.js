// ============================================
// PAGE SEMAINE
// ============================================

let currentUser = null;
let weekOffset = 0;
let selectedDayIndex = 0;
let weekTasks = [];
let weekSessions = [];
let weekRuns = [];
let weekDates = [];
let externalEvents = [];

function escapeHTMLW(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  document.getElementById('week-prev').addEventListener('click', () => { weekOffset -= 1; loadWeek(); });
  document.getElementById('week-next').addEventListener('click', () => { weekOffset += 1; loadWeek(); });

  await setupICSSync();
  await loadWeek();
}

// ============================================
// SYNCHRONISATION AGENDA EXTERNE
// ============================================

async function setupICSSync() {
  const saved = await getAppSetting(currentUser.id, 'ics_url');
  if (saved?.url) document.getElementById('ics-url-input').value = saved.url;

  document.getElementById('save-ics-url').addEventListener('click', async () => {
    const url = document.getElementById('ics-url-input').value.trim();
    if (!url) return;
    await setAppSetting(currentUser.id, 'ics_url', { url });
    sessionStorage.removeItem('ics_events_cache');
    setSyncStatus('Lien enregistré. Synchronisation...', 'ok');
    await syncICSNow();
  });

  document.getElementById('sync-ics-now').addEventListener('click', syncICSNow);

  if (saved?.url) await syncICSNow();
}

async function syncICSNow() {
  const url = document.getElementById('ics-url-input').value.trim();
  if (!url) {
    setSyncStatus("Ajoute d'abord le lien d'abonnement de ton appli de réservation.", 'error');
    return;
  }
  setSyncStatus('Synchronisation en cours...', '');
  try {
    externalEvents = await fetchICSEvents(url);
    setSyncStatus(`✓ ${externalEvents.length} événement(s) synchronisé(s).`, 'ok');
    renderDayTabs();
    renderDayItems();
  } catch (e) {
    setSyncStatus("Échec de la synchronisation — vérifie le lien, ou réessaie plus tard.", 'error');
    console.error(e);
  }
}

function setSyncStatus(text, kind) {
  const el = document.getElementById('sync-status');
  el.textContent = text;
  el.className = 'sync-status' + (kind ? ' ' + kind : '');
}

async function loadWeek() {
  const range = getPeriodRange('semaine', weekOffset);
  document.getElementById('week-label').textContent = range.label;
  document.getElementById('week-range-label').textContent =
    `${formatDayMonth(range.start)} → ${formatDayMonth(range.end)}`;

  weekDates = [];
  const start = parseISO(range.start);
  for (let i = 0; i < 7; i++) weekDates.push(toISO(addDays(start, i)));

  const todayIso = toISO(new Date());
  selectedDayIndex = weekDates.indexOf(todayIso);
  if (selectedDayIndex === -1) selectedDayIndex = 0;

  const [{ data: tasks }, { data: sessions }, { data: runs }] = await Promise.all([
    supabaseClient.from('tasks').select('*').gte('date', range.start).lte('date', range.end).neq('status', 'annule'),
    supabaseClient.from('coaching_sessions').select('*').gte('date', range.start).lte('date', range.end).neq('status', 'annule'),
    supabaseClient.from('running_sessions').select('*').gte('date', range.start).lte('date', range.end),
  ]);

  weekTasks = tasks || [];
  weekSessions = sessions || [];
  weekRuns = runs || [];

  renderDayTabs();
  renderDayItems();
}

function formatDayMonth(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function renderDayTabs() {
  const todayIso = toISO(new Date());
  const container = document.getElementById('day-tabs');

  container.innerHTML = weekDates.map((iso, i) => {
    const d = new Date(iso + 'T00:00:00');
    const label = d.toLocaleDateString('fr-FR', { weekday: 'short' });
    const num = d.getDate();
    const hasItems = weekTasks.some(t => t.date === iso) || weekSessions.some(s => s.date === iso)
      || weekRuns.some(r => r.date === iso) || externalEvents.some(e => e.start?.date === iso);
    const classes = ['day-tab'];
    if (iso === todayIso) classes.push('today');
    if (i === selectedDayIndex) classes.push('selected');
    if (hasItems) classes.push('has-items');

    return `
      <div class="${classes.join(' ')}" data-index="${i}">
        <div class="dt-label">${label}</div>
        <div class="dt-num">${num}</div>
        <div class="dt-dot"></div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.day-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      selectedDayIndex = parseInt(tab.dataset.index, 10);
      renderDayTabs();
      renderDayItems();
    });
  });
}

function renderDayItems() {
  const iso = weekDates[selectedDayIndex];
  const container = document.getElementById('day-items');

  const items = [
    ...weekSessions.filter(s => s.date === iso).map(s => ({
      sortKey: s.time || '99:99', type: 'session', data: s,
    })),
    ...weekTasks.filter(t => t.date === iso).map(t => ({
      sortKey: t.time || '99:99', type: 'task', data: t,
    })),
    ...weekRuns.filter(r => r.date === iso).map(r => ({
      sortKey: '99:99', type: 'run', data: r,
    })),
    ...externalEvents.filter(e => e.start?.date === iso).map(e => ({
      sortKey: e.start?.time || '00:00', type: 'external', data: e,
    })),
  ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  if (items.length === 0) {
    container.innerHTML = '<p class="empty">Rien de prévu ce jour-là.</p>';
    return;
  }

  container.innerHTML = items.map(item => renderItem(item)).join('');
  attachItemEvents();
}

function renderItem(item) {
  if (item.type === 'external') {
    const e = item.data;
    return `
      <div class="week-item-row">
        <div class="week-item-time">${e.start?.time || ''}</div>
        <div class="week-item-body">
          <div class="week-item-title">📆 ${escapeHTMLW(e.title || 'Réservation')}</div>
          <div class="task-meta">Depuis ton agenda de réservation</div>
        </div>
        <span class="badge externe">Résa club</span>
      </div>
    `;
  }
  if (item.type === 'session') {
    const s = item.data;
    return `
      <div class="week-item-row" onclick="window.location.href='coaching.html'" style="cursor:pointer;">
        <div class="week-item-time">${s.time?.slice(0, 5) || ''}</div>
        <div class="week-item-body">
          <div class="week-item-title">🎾 Cours ${TYPE_LABELS_FR[s.type] || s.type}</div>
          <div class="task-meta">${s.nb_players} joueur${s.nb_players > 1 ? 's' : ''} · ${s.ca_brut}€</div>
        </div>
        <span class="badge ${s.status}">${s.status === 'prevu' ? 'Prévu' : 'Réalisé'}</span>
      </div>
    `;
  }
  if (item.type === 'run') {
    const r = item.data;
    return `
      <div class="week-item-row" onclick="window.location.href='running.html'" style="cursor:pointer;">
        <div class="week-item-time"></div>
        <div class="week-item-body">
          <div class="week-item-title">🏃 ${escapeHTMLW(r.type)}</div>
          <div class="task-meta">${r.distance_km ? r.distance_km + ' km' : ''} ${r.duration_minutes ? '· ' + r.duration_minutes + ' min' : ''}</div>
        </div>
        ${!r.realized ? '<span class="badge prevu">Prévue</span>' : ''}
      </div>
    `;
  }
  // task
  const t = item.data;
  return `
    <div class="week-item-row ${t.status === 'termine' ? 'done' : ''}" data-task-id="${t.id}">
      <div class="checkbox ${t.status === 'termine' ? 'checked' : ''}" data-action="toggle">${t.status === 'termine' ? '✓' : ''}</div>
      <div class="week-item-body">
        <div class="week-item-title">${escapeHTMLW(t.title)}</div>
        <div class="day-picker-row" style="display:none;" id="picker-${t.id}"></div>
      </div>
      <button class="icon-btn" data-action="move" title="Déplacer">↔</button>
    </div>
  `;
}

function attachItemEvents() {
  document.querySelectorAll('.week-item-row[data-task-id]').forEach(row => {
    const id = row.dataset.taskId;
    const task = weekTasks.find(t => t.id === id);

    row.querySelector('[data-action="toggle"]').addEventListener('click', async () => {
      const newStatus = task.status === 'termine' ? 'a_faire' : 'termine';
      await supabaseClient.from('tasks').update({
        status: newStatus, completed_at: newStatus === 'termine' ? new Date().toISOString() : null,
      }).eq('id', id);
      await loadWeek();
    });

    row.querySelector('[data-action="move"]').addEventListener('click', () => {
      const picker = document.getElementById(`picker-${id}`);
      if (picker.style.display === 'flex') { picker.style.display = 'none'; return; }
      picker.style.display = 'flex';
      picker.innerHTML = weekDates.map((iso, i) => {
        const d = new Date(iso + 'T00:00:00');
        const label = d.toLocaleDateString('fr-FR', { weekday: 'short' }) + ' ' + d.getDate();
        return `<div class="chip ${iso === task.date ? 'selected' : ''}" data-move-date="${iso}">${label}</div>`;
      }).join('');

      picker.querySelectorAll('[data-move-date]').forEach(chip => {
        chip.addEventListener('click', async () => {
          await supabaseClient.from('tasks').update({ date: chip.dataset.moveDate }).eq('id', id);
          await loadWeek();
        });
      });
    });
  });
}

init();
