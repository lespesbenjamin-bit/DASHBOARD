// ============================================
// PAGE TOURNOIS
// ============================================

let currentUser = null;
let coachingSettings = null;
let allTournaments = [];
let activeStatusFilter = 'all';

function todayISOT() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().split('T')[0];
}

function formatEuroT(amount) {
  return Math.round(amount || 0).toLocaleString('fr-FR') + '€';
}

function formatDateT(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  coachingSettings = await getOrCreateCoachingSettings(currentUser.id);

  document.getElementById('btn-add-tournament').addEventListener('click', () => openTournamentModal());

  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeStatusFilter = tab.dataset.status;
      renderTournaments();
    });
  });

  setupModal();
  await loadTournaments();
}

async function loadTournaments() {
  const { data, error } = await supabaseClient
    .from('tournaments').select('*')
    .order('date', { ascending: false });

  if (error) {
    document.getElementById('tournament-list').innerHTML = '<p class="empty">Erreur de chargement.</p>';
    console.error(error);
    return;
  }
  allTournaments = data || [];
  renderKPIs();
  renderTournaments();
}

function renderKPIs() {
  const yearStart = todayISOT().slice(0, 4) + '-01-01';
  const thisYear = allTournaments.filter(t => t.date >= yearStart && t.status !== 'annule');
  const realise = thisYear.filter(t => t.status === 'realise');

  document.getElementById('kpi-ca').textContent = formatEuroT(realise.reduce((s, t) => s + Number(t.ca_brut), 0));
  document.getElementById('kpi-net').textContent = formatEuroT(realise.reduce((s, t) => s + Number(t.net), 0));
}

function renderTournaments() {
  let list = allTournaments;
  if (activeStatusFilter !== 'all') list = list.filter(t => t.status === activeStatusFilter);

  const container = document.getElementById('tournament-list');
  if (list.length === 0) {
    container.innerHTML = '<p class="empty">Aucun tournoi ici.</p>';
    return;
  }

  container.innerHTML = list.map(t => `
    <div class="session-card" data-id="${t.id}">
      <div class="session-top">
        <div>
          <div class="session-when">${formatDateT(t.date)}</div>
          <div class="session-sub">${t.nb_teams} équipes</div>
        </div>
        <div class="actions-menu">
          <button class="icon-btn" data-action="menu">⋯</button>
          <div class="actions-dropdown">
            <button data-action="edit">Modifier</button>
            <button data-action="delete" class="danger">Supprimer</button>
          </div>
        </div>
      </div>
      <div class="session-badges">
        <span class="badge ${t.level}">${t.level}</span>
        <span class="badge ${t.status}">${t.status === 'prevu' ? 'Prévu' : t.status === 'realise' ? 'Réalisé' : 'Annulé'}</span>
      </div>
      <div class="session-amounts">
        <div class="amount-block"><div class="amount-num">${t.ca_brut}€</div><div class="amount-label">CA</div></div>
        <div class="amount-block"><div class="amount-num">${t.homologation_cout}€</div><div class="amount-label">HOMOLOG.</div></div>
        <div class="amount-block"><div class="amount-num">${t.net}€</div><div class="amount-label">NET</div></div>
      </div>
    </div>
  `).join('');

  attachRowEvents();
}

function attachRowEvents() {
  document.querySelectorAll('.session-card').forEach(card => {
    const id = card.dataset.id;
    const tournament = allTournaments.find(t => t.id === id);

    const menuBtn = card.querySelector('[data-action="menu"]');
    const dropdown = card.querySelector('.actions-dropdown');
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.actions-dropdown.open').forEach(d => { if (d !== dropdown) d.classList.remove('open'); });
      dropdown.classList.toggle('open');
    });

    dropdown.querySelector('[data-action="edit"]').addEventListener('click', () => { dropdown.classList.remove('open'); openTournamentModal(tournament); });
    dropdown.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      dropdown.classList.remove('open');
      if (!window.confirm('Supprimer ce tournoi ?')) return;
      await supabaseClient.from('tournaments').delete().eq('id', id);
      await loadTournaments();
    });
  });

  document.addEventListener('click', () => {
    document.querySelectorAll('.actions-dropdown.open').forEach(d => d.classList.remove('open'));
  }, { once: true });
}

// ============================================
// MODALE
// ============================================
let editingTournamentId = null;

function setupModal() {
  document.getElementById('cancel-tournament-modal').addEventListener('click', closeTournamentModal);
  document.getElementById('tournament-modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'tournament-modal-overlay') closeTournamentModal();
  });

  document.querySelectorAll('#to-level .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#to-level .chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      updateCalcPreview();
    });
  });

  document.getElementById('to-teams').addEventListener('input', updateCalcPreview);
  document.getElementById('tournament-form').addEventListener('submit', handleSubmit);
}

function openTournamentModal(tournament = null) {
  editingTournamentId = tournament ? tournament.id : null;
  document.getElementById('tournament-error').style.display = 'none';
  document.getElementById('tournament-modal-title').textContent = tournament ? 'Modifier le tournoi' : 'Nouveau tournoi';

  document.getElementById('to-date').value = tournament?.date || todayISOT();
  document.getElementById('to-teams').value = tournament?.nb_teams || 8;
  document.getElementById('to-status').value = tournament?.status || 'prevu';
  document.getElementById('to-notes').value = tournament?.notes || '';

  const level = tournament?.level || 'P50';
  document.querySelectorAll('#to-level .chip').forEach(c => c.classList.toggle('selected', c.dataset.key === level));

  updateCalcPreview();
  document.getElementById('tournament-modal-overlay').classList.add('open');
}

function closeTournamentModal() {
  document.getElementById('tournament-modal-overlay').classList.remove('open');
}

function readFormValuesT() {
  const levelChip = document.querySelector('#to-level .chip.selected');
  return {
    level: levelChip?.dataset.key || 'P50',
    nbTeams: parseInt(document.getElementById('to-teams').value, 10) || 0,
  };
}

function updateCalcPreview() {
  const values = readFormValuesT();
  const calc = calculateTournament(values, coachingSettings);
  document.getElementById('to-prev-ca').textContent = calc.ca_brut + '€';
  document.getElementById('to-prev-homolog').textContent = calc.homologation_cout + '€';
  document.getElementById('to-prev-net').textContent = calc.net + '€';
}

async function handleSubmit(e) {
  e.preventDefault();
  const errorEl = document.getElementById('tournament-error');
  errorEl.style.display = 'none';

  const date = document.getElementById('to-date').value;
  const status = document.getElementById('to-status').value;
  const notes = document.getElementById('to-notes').value.trim() || null;
  const values = readFormValuesT();

  if (!date || !values.nbTeams) {
    errorEl.textContent = 'Merci de remplir la date et le nombre d\'équipes.';
    errorEl.style.display = 'block';
    return;
  }

  const calc = calculateTournament(values, coachingSettings);

  const row = {
    date, level: values.level, nb_teams: values.nbTeams,
    status, notes, ...calc,
  };

  if (editingTournamentId) {
    await supabaseClient.from('tournaments').update(row).eq('id', editingTournamentId);
  } else {
    await supabaseClient.from('tournaments').insert({ ...row, user_id: currentUser.id });
  }

  closeTournamentModal();
  await loadTournaments();
}

function openTournamentModalGlobal() { openTournamentModal(); }

init();
