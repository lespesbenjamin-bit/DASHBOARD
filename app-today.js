// ============================================
// DASHBOARD AUJOURD'HUI
// ============================================

const UNIVERSES = [
  { key: 'padel', label: 'Coaching Padel', icon: '🎾' },
  { key: 'thalgo', label: 'Thalgo', icon: '💼' },
  { key: 'moka', label: 'Moka Studio', icon: '☕' },
  { key: 'running', label: 'Course à pied', icon: '🏃' },
];

// Renvoie la date du jour au format YYYY-MM-DD (attendu par Postgres `date`)
function todayISO() {
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
  return (amount || 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + '€';
}

async function init() {
  const user = await requireAuth();
  if (!user) return; // requireAuth redirige déjà vers login.html

  document.getElementById('logout-btn').addEventListener('click', (e) => {
    e.preventDefault();
    logout();
  });

  document.getElementById('greeting-text').textContent = 'Bonjour Benjamin 👋';
  const today = todayISO();
  document.getElementById('today-date').textContent = formatDateFR(today);

  // Catégories : on a besoin de la table pour relier category_id -> key ('padel', etc.)
  const { data: categories } = await supabaseClient
    .from('categories')
    .select('id, key, label');

  const categoryById = {};
  (categories || []).forEach(c => { categoryById[c.id] = c; });

  // Tâches du jour
  const { data: tasks } = await supabaseClient
    .from('tasks')
    .select('id, title, category_id, status, is_focus')
    .eq('date', today)
    .neq('status', 'annule');

  // Cours du jour
  const { data: sessions } = await supabaseClient
    .from('coaching_sessions')
    .select('id, time, status, ca_brut, type')
    .eq('date', today)
    .neq('status', 'annule')
    .order('time', { ascending: true });

  renderFocus((tasks || []).filter(t => t.is_focus));
  renderKPIs(tasks || [], sessions || []);
  renderUniverses(tasks || [], sessions || [], categoryById);
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
      const currentlyDone = item.dataset.status === 'termine';
      const newStatus = currentlyDone ? 'a_faire' : 'termine';
      const { error } = await supabaseClient
        .from('tasks')
        .update({ status: newStatus, completed_at: newStatus === 'termine' ? new Date().toISOString() : null })
        .eq('id', id);
      if (!error) init(); // on recharge tout simplement pour rester cohérent
    });
  });
}

function renderKPIs(tasks, sessions) {
  const remaining = tasks.filter(t => t.status !== 'termine').length;
  const done = tasks.filter(t => t.status === 'termine').length;
  const total = tasks.length;

  const caPrevu = sessions.filter(s => s.status === 'prevu').reduce((sum, s) => sum + Number(s.ca_brut || 0), 0);
  const caRealise = sessions.filter(s => s.status === 'realise').reduce((sum, s) => sum + Number(s.ca_brut || 0), 0);

  document.getElementById('kpi-tasks').textContent = remaining;
  document.getElementById('kpi-sessions').textContent = sessions.length;
  document.getElementById('kpi-ca-prevu').textContent = formatEuro(caPrevu);
  document.getElementById('kpi-ca-realise').textContent = formatEuro(caRealise);

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  document.getElementById('progress-fill').style.width = pct + '%';
}

function renderUniverses(tasks, sessions, categoryById) {
  const grid = document.getElementById('universe-grid');

  grid.innerHTML = UNIVERSES.map(u => {
    const universeTasks = tasks.filter(t => categoryById[t.category_id]?.key === u.key);
    const remaining = universeTasks.filter(t => t.status !== 'termine');
    const total = universeTasks.length;
    const doneCount = total - remaining.length;
    const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

    const nextTask = remaining[0];
    const nextSession = u.key === 'padel' && sessions.length > 0 ? sessions[0] : null;

    let metaLine = '';
    if (nextSession) {
      metaLine = `Prochain cours ${nextSession.time?.slice(0, 5)}`;
    } else if (nextTask) {
      metaLine = escapeHTML(nextTask.title);
    } else {
      metaLine = 'Rien de prévu';
    }

    return `
      <div class="universe-card ${u.key}">
        <div class="universe-head">
          <span>${u.icon} ${u.label}</span>
          <span>${remaining.length} tâche${remaining.length > 1 ? 's' : ''}</span>
        </div>
        <div class="universe-meta">${metaLine}</div>
        ${total > 0 ? `
          <div class="universe-bar">
            <div class="universe-bar-fill" style="width: ${pct}%"></div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

init();
