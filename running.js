// ============================================
// PAGE COURSE À PIED
// ============================================

let currentUser = null;
let allSessions = [];
let activeFilter = 'all';

function todayISOR() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().split('T')[0];
}

function addDaysR(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().split('T')[0];
}

function getMondayR() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDaysR(todayISOR(), diff);
}

function formatDateShortR(iso) {
  const d = new Date(iso + 'T00:00:00');
  const today = todayISOR();
  if (iso === today) return "Aujourd'hui";
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

function escapeHTMLR(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function rpeColor(rpe) {
  if (rpe <= 3) return '#0F6B5C';
  if (rpe <= 6) return '#C1841E';
  return '#E5484D';
}

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  document.getElementById('week-sub').textContent = 'Semaine du ' + formatDateShortR(getMondayR());

  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeFilter = tab.dataset.filter;
      renderSessions();
    });
  });

  setupModal();
  await loadSessions();
}

async function loadSessions() {
  const { data, error } = await supabaseClient
    .from('running_sessions').select('*')
    .order('date', { ascending: false });

  if (error) {
    document.getElementById('session-list').innerHTML = '<p class="empty">Erreur de chargement.</p>';
    console.error(error);
    return;
  }
  allSessions = data || [];
  renderWeekStats();
  renderSessions();
}

function renderWeekStats() {
  const monday = getMondayR();
  const sunday = addDaysR(monday, 6);
  const weekSessions = allSessions.filter(s => s.date >= monday && s.date <= sunday && s.realized);

  const km = weekSessions.reduce((t, s) => t + Number(s.distance_km || 0), 0);
  const dplus = weekSessions.reduce((t, s) => t + Number(s.d_plus || 0), 0);
  const minutes = weekSessions.reduce((t, s) => t + Number(s.duration_minutes || 0), 0);

  document.getElementById('week-km').textContent = (Math.round(km * 10) / 10) + ' km';
  document.getElementById('week-dplus').textContent = dplus + ' m';
  document.getElementById('week-temps').textContent = `${Math.floor(minutes / 60)}h${(minutes % 60).toString().padStart(2, '0')}`;
  document.getElementById('week-count').textContent = weekSessions.length;
}

function renderSessions() {
  let list = allSessions;
  if (activeFilter === 'realized') list = list.filter(s => s.realized);
  if (activeFilter === 'planned') list = list.filter(s => !s.realized);

  const container = document.getElementById('session-list');
  if (list.length === 0) {
    container.innerHTML = '<p class="empty">Aucune séance ici.</p>';
    return;
  }

  container.innerHTML = list.map(s => `
    <div class="run-card" data-id="${s.id}">
      <div class="run-top">
        <div>
          <div class="run-type">${escapeHTMLR(s.type)} ${s.realized ? '' : '<span class="badge prevu" style="margin-left:6px;">Prévue</span>'}</div>
          <div class="run-sub">${formatDateShortR(s.date)}${s.comment ? ' · ' + escapeHTMLR(s.comment) : ''}</div>
        </div>
        <div class="actions-menu">
          <button class="icon-btn" data-action="menu">⋯</button>
          <div class="actions-dropdown">
            <button data-action="edit">Modifier</button>
            <button data-action="delete" class="danger">Supprimer</button>
          </div>
        </div>
      </div>
      <div class="run-stats">
        ${s.distance_km ? `<div><div class="r-num">${s.distance_km} km</div><div class="r-label">DISTANCE</div></div>` : ''}
        ${s.duration_minutes ? `<div><div class="r-num">${s.duration_minutes} min</div><div class="r-label">DURÉE</div></div>` : ''}
        ${s.d_plus ? `<div><div class="r-num">${s.d_plus} m</div><div class="r-label">D+</div></div>` : ''}
        ${s.rpe ? `<div><span class="rpe-dot" style="background:${rpeColor(s.rpe)}">${s.rpe}</span><div class="r-label">RPE</div></div>` : ''}
      </div>
    </div>
  `).join('');

  attachRowEvents();
}

function attachRowEvents() {
  document.querySelectorAll('.run-card').forEach(card => {
    const id = card.dataset.id;
    const session = allSessions.find(s => s.id === id);

    const menuBtn = card.querySelector('[data-action="menu"]');
    const dropdown = card.querySelector('.actions-dropdown');
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.actions-dropdown.open').forEach(d => { if (d !== dropdown) d.classList.remove('open'); });
      dropdown.classList.toggle('open');
    });

    dropdown.querySelector('[data-action="edit"]').addEventListener('click', () => { dropdown.classList.remove('open'); openRunModal(session); });
    dropdown.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      dropdown.classList.remove('open');
      if (!window.confirm('Supprimer cette séance ?')) return;
      await supabaseClient.from('running_sessions').delete().eq('id', id);
      await loadSessions();
    });
  });

  document.addEventListener('click', () => {
    document.querySelectorAll('.actions-dropdown.open').forEach(d => d.classList.remove('open'));
  }, { once: true });
}

// ============================================
// MODALE
// ============================================
let editingRunId = null;

function setupModal() {
  document.getElementById('cancel-run-modal').addEventListener('click', closeRunModal);
  document.getElementById('run-modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'run-modal-overlay') closeRunModal();
  });

  document.querySelectorAll('#ru-type .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#ru-type .chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
    });
  });

  document.getElementById('ru-realized-yes').addEventListener('click', () => {
    document.getElementById('ru-realized-yes').classList.add('selected');
    document.getElementById('ru-realized-no').classList.remove('selected');
  });
  document.getElementById('ru-realized-no').addEventListener('click', () => {
    document.getElementById('ru-realized-no').classList.add('selected');
    document.getElementById('ru-realized-yes').classList.remove('selected');
  });

  document.getElementById('ru-rpe').addEventListener('input', (e) => {
    document.getElementById('ru-rpe-value').textContent = e.target.value;
  });

  document.getElementById('run-form').addEventListener('submit', handleSubmit);
}

function openRunModal(session = null) {
  editingRunId = session ? session.id : null;
  document.getElementById('run-error').style.display = 'none';
  document.getElementById('run-modal-title').textContent = session ? 'Modifier la séance' : 'Nouvelle séance';

  document.getElementById('ru-date').value = session?.date || todayISOR();
  document.getElementById('ru-duration').value = session?.duration_minutes || '';
  document.getElementById('ru-distance').value = session?.distance_km || '';
  document.getElementById('ru-dplus').value = session?.d_plus || '';
  document.getElementById('ru-rpe').value = session?.rpe || 5;
  document.getElementById('ru-rpe-value').textContent = session?.rpe || 5;
  document.getElementById('ru-comment').value = session?.comment || '';

  const typeKey = session?.type || 'Footing';
  document.querySelectorAll('#ru-type .chip').forEach(c => c.classList.toggle('selected', c.dataset.key === typeKey));

  const realized = session ? session.realized : true;
  document.getElementById('ru-realized-yes').classList.toggle('selected', realized);
  document.getElementById('ru-realized-no').classList.toggle('selected', !realized);

  document.getElementById('run-modal-overlay').classList.add('open');
}

function closeRunModal() {
  document.getElementById('run-modal-overlay').classList.remove('open');
}

async function handleSubmit(e) {
  e.preventDefault();
  const typeChip = document.querySelector('#ru-type .chip.selected');
  const date = document.getElementById('ru-date').value;
  const duration = document.getElementById('ru-duration').value || null;
  const distance = document.getElementById('ru-distance').value || null;
  const dplus = document.getElementById('ru-dplus').value || null;
  const rpe = parseInt(document.getElementById('ru-rpe').value, 10);
  const comment = document.getElementById('ru-comment').value.trim() || null;
  const realized = document.getElementById('ru-realized-yes').classList.contains('selected');

  if (!date || !typeChip) {
    const err = document.getElementById('run-error');
    err.textContent = 'Merci de remplir la date et le type.';
    err.style.display = 'block';
    return;
  }

  const row = {
    date, type: typeChip.dataset.key,
    duration_minutes: duration ? parseInt(duration, 10) : null,
    distance_km: distance ? parseFloat(distance) : null,
    d_plus: dplus ? parseInt(dplus, 10) : null,
    rpe, comment, realized,
  };

  if (editingRunId) {
    await supabaseClient.from('running_sessions').update(row).eq('id', editingRunId);
  } else {
    await supabaseClient.from('running_sessions').insert({ ...row, user_id: currentUser.id });
  }

  closeRunModal();
  await loadSessions();
}

function openRunningModal() { openRunModal(); }

init();
