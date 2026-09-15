// ============================================
// PAGE COACHING PADEL
// ============================================

let currentUser = null;
let coachingSettings = null;
let allSessions = [];
let activeStatusFilter = 'upcoming';
const RECURRENCE_WINDOW_DAYS = 56;

function todayISO() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().split('T')[0];
}

function addDaysISO(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().split('T')[0];
}

function formatDateShort(iso) {
  const d = new Date(iso + 'T00:00:00');
  const today = todayISO();
  if (iso === today) return "Aujourd'hui";
  if (iso === addDaysISO(today, 1)) return "Demain";
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

const TYPE_LABELS = {
  individuel: 'Individuel', duo: 'Duo', collectif: 'Collectif',
  partie_coachee: 'Partie coachée', autre: 'Autre',
};

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  coachingSettings = await getOrCreateCoachingSettings(currentUser.id);

  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeStatusFilter = tab.dataset.status;
      renderSessions();
    });
  });

  setupModal();
  await loadSessions();
}

async function loadSessions() {
  const { data, error } = await supabaseClient
    .from('coaching_sessions')
    .select('*')
    .order('date', { ascending: true })
    .order('time', { ascending: true });

  if (error) {
    document.getElementById('session-list').innerHTML = '<p class="empty">Erreur de chargement.</p>';
    console.error(error);
    return;
  }
  allSessions = data || [];
  renderSessions();
}

function renderSessions() {
  let list = allSessions;
  const today = todayISO();

  if (activeStatusFilter === 'upcoming') {
    list = list.filter(s => s.status !== 'annule' && (s.status === 'prevu' || s.date >= today));
  } else if (activeStatusFilter === 'realise') {
    list = list.filter(s => s.status === 'realise');
  }
  // 'all' => pas de filtre

  const upcomingCount = allSessions.filter(s => s.status === 'prevu').length;
  document.getElementById('session-count-sub').textContent = `${upcomingCount} cours à venir`;

  const container = document.getElementById('session-list');
  if (list.length === 0) {
    container.innerHTML = '<p class="empty">Aucun cours ici.</p>';
    return;
  }

  container.innerHTML = list.map(s => `
    <div class="session-card" data-id="${s.id}">
      <div class="session-top">
        <div>
          <div class="session-when">${formatDateShort(s.date)} · ${s.time?.slice(0, 5)}</div>
          <div class="session-sub">${TYPE_LABELS[s.type] || s.type} · ${s.nb_players} joueur${s.nb_players > 1 ? 's' : ''} · ${s.duration_minutes} min</div>
        </div>
        <div class="actions-menu">
          <button class="icon-btn" data-action="menu">⋯</button>
          <div class="actions-dropdown">
            ${s.status === 'prevu' ? '<button data-action="realise">Marquer réalisé</button>' : ''}
            ${s.payment_status === 'a_payer' ? '<button data-action="paye">Marquer payé</button>' : ''}
            <button data-action="edit">Modifier</button>
            <button data-action="duplicate">Dupliquer</button>
            ${s.status !== 'annule' ? '<button data-action="cancel" class="danger">Annuler</button>' : ''}
            <button data-action="delete" class="danger">Supprimer</button>
          </div>
        </div>
      </div>
      <div class="session-badges">
        <span class="badge ${s.status}">${s.status === 'prevu' ? 'Prévu' : s.status === 'realise' ? 'Réalisé' : 'Annulé'}</span>
        <span class="badge ${s.payment_status}">${s.payment_status === 'paye' ? 'Payé' : s.payment_status === 'a_payer' ? 'À payer' : 'Offert'}</span>
      </div>
      <div class="session-amounts">
        <div class="amount-block"><div class="amount-num">${s.ca_brut}€</div><div class="amount-label">CA BRUT</div></div>
        <div class="amount-block"><div class="amount-num">${s.redevance_montant}€</div><div class="amount-label">REDEVANCE</div></div>
        <div class="amount-block"><div class="amount-num">${s.marge}€</div><div class="amount-label">MARGE</div></div>
        <div class="amount-block"><div class="amount-num">${s.net_estime}€</div><div class="amount-label">NET EST.</div></div>
      </div>
    </div>
  `).join('');

  attachRowEvents();
}

function attachRowEvents() {
  document.querySelectorAll('.session-card').forEach(card => {
    const id = card.dataset.id;
    const session = allSessions.find(s => s.id === id);

    const menuBtn = card.querySelector('[data-action="menu"]');
    const dropdown = card.querySelector('.actions-dropdown');
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.actions-dropdown.open').forEach(d => { if (d !== dropdown) d.classList.remove('open'); });
      dropdown.classList.toggle('open');
    });

    dropdown.querySelector('[data-action="edit"]')?.addEventListener('click', () => { dropdown.classList.remove('open'); openSessionModal(session); });
    dropdown.querySelector('[data-action="duplicate"]')?.addEventListener('click', () => { dropdown.classList.remove('open'); duplicateSession(session); });
    dropdown.querySelector('[data-action="realise"]')?.addEventListener('click', () => { dropdown.classList.remove('open'); markRealise(session); });
    dropdown.querySelector('[data-action="paye"]')?.addEventListener('click', () => { dropdown.classList.remove('open'); markPaye(session); });
    dropdown.querySelector('[data-action="cancel"]')?.addEventListener('click', () => { dropdown.classList.remove('open'); cancelSession(session); });
    dropdown.querySelector('[data-action="delete"]')?.addEventListener('click', () => { dropdown.classList.remove('open'); deleteSession(session); });
  });

  document.addEventListener('click', () => {
    document.querySelectorAll('.actions-dropdown.open').forEach(d => d.classList.remove('open'));
  }, { once: true });
}

async function markRealise(session) {
  await supabaseClient.from('coaching_sessions').update({
    status: 'realise', realized_at: new Date().toISOString(),
  }).eq('id', session.id);
  await loadSessions();
}

async function markPaye(session) {
  await supabaseClient.from('coaching_sessions').update({ payment_status: 'paye' }).eq('id', session.id);
  await loadSessions();
}

async function cancelSession(session) {
  if (!window.confirm('Annuler ce cours ?')) return;
  await supabaseClient.from('coaching_sessions').update({ status: 'annule' }).eq('id', session.id);
  await loadSessions();
}

async function deleteSession(session) {
  if (session.recurrence_id) {
    const deleteAll = window.confirm(
      "Ce cours fait partie d'une série récurrente.\n\nOK = supprimer TOUTE la série (occurrences à venir)\nAnnuler = supprimer seulement ce cours"
    );
    if (deleteAll) {
      await supabaseClient.from('coaching_recurrences').update({ active: false }).eq('id', session.recurrence_id);
      await supabaseClient.from('coaching_sessions').delete().eq('recurrence_id', session.recurrence_id).gte('date', todayISO());
      await loadSessions();
      return;
    }
  } else if (!window.confirm('Supprimer ce cours ?')) {
    return;
  }
  await supabaseClient.from('coaching_sessions').delete().eq('id', session.id);
  await loadSessions();
}

async function duplicateSession(session) {
  const copy = { ...session };
  delete copy.id;
  copy.status = 'prevu';
  copy.payment_status = 'a_payer';
  copy.realized_at = null;
  copy.recurrence_id = null;
  copy.created_at = new Date().toISOString();
  copy.user_id = currentUser.id;
  await supabaseClient.from('coaching_sessions').insert(copy);
  await loadSessions();
}

// ============================================
// MODALE CRÉATION / ÉDITION + APERÇU DE CALCUL
// ============================================

let editingSessionId = null;

function setupModal() {
  const overlay = document.getElementById('session-modal-overlay');
  document.getElementById('cancel-session-modal').addEventListener('click', closeSessionModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSessionModal(); });

  document.querySelectorAll('#s-type .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#s-type .chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      updateCalcPreview();
    });
  });

  ['s-time', 's-duration', 's-players', 's-tarif-override'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateCalcPreview);
  });

  document.getElementById('session-form').addEventListener('submit', handleSubmit);
}

function openSessionModal(session = null) {
  editingSessionId = session ? session.id : null;

  document.getElementById('session-error').style.display = 'none';
  document.getElementById('modal-title').textContent = session ? 'Modifier le cours' : 'Nouveau cours';
  document.getElementById('s-recurrence-field').style.display = session ? 'none' : 'block';

  document.getElementById('s-date').value = session?.date || todayISO();
  document.getElementById('s-time').value = session?.time?.slice(0, 5) || '18:00';
  document.getElementById('s-duration').value = session?.duration_minutes || 60;
  document.getElementById('s-players').value = session?.nb_players || 1;
  document.getElementById('s-tarif-override').value = '';
  document.getElementById('s-status').value = session?.status || 'prevu';
  document.getElementById('s-payment').value = session?.payment_status || 'a_payer';
  document.getElementById('s-notes').value = session?.notes || '';
  document.getElementById('s-recurrence').value = 'ponctuel';

  const typeKey = session?.type || 'individuel';
  document.querySelectorAll('#s-type .chip').forEach(c => c.classList.toggle('selected', c.dataset.key === typeKey));

  updateCalcPreview();
  document.getElementById('session-modal-overlay').classList.add('open');
}

function closeSessionModal() {
  document.getElementById('session-modal-overlay').classList.remove('open');
}

function readFormValues() {
  const typeChip = document.querySelector('#s-type .chip.selected');
  return {
    type: typeChip?.dataset.key || 'individuel',
    durationMinutes: parseInt(document.getElementById('s-duration').value, 10),
    nbPlayers: parseInt(document.getElementById('s-players').value, 10) || 1,
    time: document.getElementById('s-time').value,
    tarifOverride: document.getElementById('s-tarif-override').value,
  };
}

function updateCalcPreview() {
  const values = readFormValues();
  const calc = calculateSession(values, coachingSettings);
  document.getElementById('prev-ca').textContent = calc.ca_brut + '€';
  document.getElementById('prev-redevance').textContent = calc.redevance_montant + '€';
  document.getElementById('prev-marge').textContent = calc.marge + '€';
  document.getElementById('prev-net').textContent = calc.net_estime + '€';
}

async function handleSubmit(e) {
  e.preventDefault();
  const errorEl = document.getElementById('session-error');
  errorEl.style.display = 'none';

  const date = document.getElementById('s-date').value;
  const status = document.getElementById('s-status').value;
  const paymentStatus = document.getElementById('s-payment').value;
  const notes = document.getElementById('s-notes').value.trim() || null;
  const recurrenceMode = document.getElementById('s-recurrence').value;
  const values = readFormValues();

  if (!date || !values.time) {
    errorEl.textContent = "Merci de remplir la date et l'heure.";
    errorEl.style.display = 'block';
    return;
  }

  const calc = calculateSession(values, coachingSettings);

  const baseRow = {
    date, time: values.time, duration_minutes: values.durationMinutes,
    type: values.type, nb_players: values.nbPlayers,
    status, payment_status: paymentStatus, notes,
    ...calc,
  };

  if (editingSessionId) {
    await supabaseClient.from('coaching_sessions').update(baseRow).eq('id', editingSessionId);
  } else if (recurrenceMode === 'ponctuel') {
    await supabaseClient.from('coaching_sessions').insert({
      ...baseRow, user_id: currentUser.id,
      realized_at: status === 'realise' ? new Date().toISOString() : null,
    });
  } else {
    await createRecurringSession(baseRow, date);
  }

  closeSessionModal();
  await loadSessions();
}

async function createRecurringSession(baseRow, startDate) {
  const dayOfWeek = new Date(startDate + 'T00:00:00').getDay();

  const { data: rec } = await supabaseClient.from('coaching_recurrences').insert({
    user_id: currentUser.id,
    day_of_week: dayOfWeek,
    time: baseRow.time,
    duration_minutes: baseRow.duration_minutes,
    type: baseRow.type,
    nb_players: baseRow.nb_players,
    start_date: startDate,
    active: true,
  }).select().single();

  const rows = [];
  for (let i = 0; i < RECURRENCE_WINDOW_DAYS; i++) {
    const d = addDaysISO(startDate, i);
    if (new Date(d + 'T00:00:00').getDay() === dayOfWeek) {
      rows.push({
        ...baseRow, date: d, user_id: currentUser.id,
        recurrence_id: rec.id,
        realized_at: null,
      });
    }
  }
  if (rows.length > 0) {
    await supabaseClient.from('coaching_sessions').insert(rows);
  }
}

function openCoachingModal() { openSessionModal(); }

init();
