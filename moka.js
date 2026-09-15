// ============================================
// PAGE MOKA STUDIO
// ============================================

let currentUser = null;
let clients = [];
let subscriptions = [];
let revenueEntries = [];

function formatEuroM(amount) {
  return Math.round(amount || 0).toLocaleString('fr-FR') + '€';
}

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  document.getElementById('header-sub').textContent = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  setupClientModal();
  setupSubModal();
  setupRevenueModal();

  await loadAll();

  const params = new URLSearchParams(window.location.search);
  if (params.get('new') === 'revenu') openRevenueModal();
}

async function loadAll() {
  const [{ data: cli }, { data: subs }, { data: rev }] = await Promise.all([
    supabaseClient.from('moka_clients').select('*').order('created_at', { ascending: false }),
    supabaseClient.from('moka_subscriptions').select('*').eq('active', true),
    supabaseClient.from('revenue_entries').select('*').order('date', { ascending: false }).limit(30),
  ]);

  clients = cli || [];
  subscriptions = subs || [];
  revenueEntries = rev || [];

  const monthRange = getPeriodRange('mois', 0);
  const kpis = await fetchMokaKPIs(currentUser.id, monthRange);

  document.getElementById('kpi-mrr').textContent = formatEuroM(kpis.mrr);
  document.getElementById('kpi-clients').textContent = kpis.clientsActifs;
  document.getElementById('kpi-ponctuel').textContent = formatEuroM(kpis.revenuPonctuel);
  document.getElementById('kpi-ca-mois').textContent = formatEuroM(kpis.caDuMois);

  renderClients();
  renderRevenue();
  fillClientSelect();
}

function renderClients() {
  const el = document.getElementById('clients-list');
  if (clients.length === 0) {
    el.innerHTML = '<p class="empty">Aucun client pour l\'instant.</p>';
    return;
  }
  el.innerHTML = clients.map(c => {
    const clientSubs = subscriptions.filter(s => s.client_id === c.id);
    const mrr = clientSubs.reduce((t, s) => t + Number(s.montant_mensuel || 0), 0);
    return `
      <div class="client-card" data-id="${c.id}">
        <div class="client-top">
          <div>
            <span class="client-name">${escapeHTML(c.name)}</span>
            <span class="badge ${c.status}" style="margin-left:8px;">${c.status === 'actif' ? 'Actif' : 'Inactif'}</span>
          </div>
          <span class="client-mrr">${mrr > 0 ? formatEuroM(mrr) + '/mois' : ''}</span>
        </div>
        ${clientSubs.map(s => `
          <div class="sub-row">
            <span class="sub-label">${escapeHTML(s.label)}</span>
            <span class="sub-amount">${formatEuroM(s.montant_mensuel)}/mois
              <button class="icon-btn" data-cancel-sub="${s.id}" title="Arrêter cet abonnement">✕</button>
            </span>
          </div>
        `).join('')}
        <div class="sub-row" style="border-top:none;">
          <button class="icon-btn" data-add-sub="${c.id}" style="color:var(--moka);">+ Abonnement / option</button>
          <button class="icon-btn" data-delete-client="${c.id}" title="Supprimer le client">🗑</button>
        </div>
      </div>
    `;
  }).join('');

  el.querySelectorAll('[data-add-sub]').forEach(btn => {
    btn.addEventListener('click', () => openSubModal(btn.dataset.addSub));
  });
  el.querySelectorAll('[data-cancel-sub]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!window.confirm('Arrêter cet abonnement ?')) return;
      await supabaseClient.from('moka_subscriptions').update({ active: false, date_fin: todayISOM() }).eq('id', btn.dataset.cancelSub);
      await loadAll();
    });
  });
  el.querySelectorAll('[data-delete-client]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!window.confirm('Supprimer ce client et ses abonnements ?')) return;
      await supabaseClient.from('moka_subscriptions').delete().eq('client_id', btn.dataset.deleteClient);
      await supabaseClient.from('moka_clients').delete().eq('id', btn.dataset.deleteClient);
      await loadAll();
    });
  });
}

function renderRevenue() {
  const el = document.getElementById('revenue-list');
  if (revenueEntries.length === 0) {
    el.innerHTML = '<p class="empty">Aucun revenu ponctuel enregistré.</p>';
    return;
  }
  el.innerHTML = revenueEntries.map(r => `
    <div class="entry-row">
      <div>
        <div class="e-label">${escapeHTML(r.label)}</div>
        <div class="e-meta">${formatDateShortM(r.date)} · ${r.type === 'one_shot' ? 'One-shot' : 'Autre'}</div>
      </div>
      <div class="e-amount">${formatEuroM(r.montant)}</div>
    </div>
  `).join('');
}

function fillClientSelect() {
  const select = document.getElementById('r-client');
  select.innerHTML = '<option value="">— Aucun —</option>' +
    clients.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');
}

// ============================================
// MODALE CLIENT
// ============================================
function setupClientModal() {
  document.getElementById('btn-add-client').addEventListener('click', () => openClientModal());
  document.getElementById('cancel-client-modal').addEventListener('click', closeClientModal);
  document.getElementById('client-modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'client-modal-overlay') closeClientModal();
  });
  document.getElementById('client-form').addEventListener('submit', handleClientSubmit);
}

function openClientModal() {
  document.getElementById('client-error').style.display = 'none';
  document.getElementById('client-modal-title').textContent = 'Nouveau client';
  document.getElementById('c-name').value = '';
  document.getElementById('c-contact').value = '';
  document.getElementById('c-status').value = 'actif';
  document.getElementById('client-modal-overlay').classList.add('open');
}

function closeClientModal() {
  document.getElementById('client-modal-overlay').classList.remove('open');
}

async function handleClientSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('c-name').value.trim();
  const contact = document.getElementById('c-contact').value.trim() || null;
  const status = document.getElementById('c-status').value;

  if (!name) {
    const err = document.getElementById('client-error');
    err.textContent = 'Le nom est obligatoire.';
    err.style.display = 'block';
    return;
  }

  await supabaseClient.from('moka_clients').insert({ user_id: currentUser.id, name, contact, status });
  closeClientModal();
  await loadAll();
}

// ============================================
// MODALE ABONNEMENT
// ============================================
function setupSubModal() {
  document.getElementById('cancel-sub-modal').addEventListener('click', closeSubModal);
  document.getElementById('sub-modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'sub-modal-overlay') closeSubModal();
  });
  document.getElementById('sub-form').addEventListener('submit', handleSubSubmit);
}

function openSubModal(clientId) {
  document.getElementById('sub-error').style.display = 'none';
  document.getElementById('sub-client-id').value = clientId;
  document.getElementById('sub-label').value = '';
  document.getElementById('sub-montant').value = '';
  document.getElementById('sub-date-debut').value = todayISOM();
  document.getElementById('sub-modal-overlay').classList.add('open');
}

function closeSubModal() {
  document.getElementById('sub-modal-overlay').classList.remove('open');
}

async function handleSubSubmit(e) {
  e.preventDefault();
  const clientId = document.getElementById('sub-client-id').value;
  const label = document.getElementById('sub-label').value.trim();
  const montant = parseFloat(document.getElementById('sub-montant').value);
  const dateDebut = document.getElementById('sub-date-debut').value;

  if (!label || !montant || !dateDebut) {
    const err = document.getElementById('sub-error');
    err.textContent = 'Merci de remplir tous les champs.';
    err.style.display = 'block';
    return;
  }

  await supabaseClient.from('moka_subscriptions').insert({
    user_id: currentUser.id, client_id: clientId, label,
    montant_mensuel: montant, date_debut: dateDebut, active: true,
  });
  closeSubModal();
  await loadAll();
}

// ============================================
// MODALE REVENU PONCTUEL
// ============================================
function setupRevenueModal() {
  document.getElementById('btn-add-revenue').addEventListener('click', () => openRevenueModal());
  document.getElementById('cancel-revenue-modal').addEventListener('click', closeRevenueModal);
  document.getElementById('revenue-modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'revenue-modal-overlay') closeRevenueModal();
  });
  document.querySelectorAll('#r-type .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#r-type .chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
    });
  });
  document.getElementById('revenue-form').addEventListener('submit', handleRevenueSubmit);
}

function openRevenueModal() {
  document.getElementById('revenue-error').style.display = 'none';
  document.getElementById('r-label').value = '';
  document.getElementById('r-montant').value = '';
  document.getElementById('r-date').value = todayISOM();
  document.getElementById('r-client').value = '';
  document.querySelectorAll('#r-type .chip').forEach((c, i) => c.classList.toggle('selected', i === 0));
  document.getElementById('revenue-modal-overlay').classList.add('open');
}

function closeRevenueModal() {
  document.getElementById('revenue-modal-overlay').classList.remove('open');
}

async function handleRevenueSubmit(e) {
  e.preventDefault();
  const typeChip = document.querySelector('#r-type .chip.selected');
  const label = document.getElementById('r-label').value.trim();
  const montant = parseFloat(document.getElementById('r-montant').value);
  const date = document.getElementById('r-date').value;
  const clientId = document.getElementById('r-client').value || null;

  if (!label || !montant || !date) {
    const err = document.getElementById('revenue-error');
    err.textContent = 'Merci de remplir tous les champs.';
    err.style.display = 'block';
    return;
  }

  const { data: cat } = await supabaseClient.from('categories').select('id').eq('key', 'moka').single();

  await supabaseClient.from('revenue_entries').insert({
    user_id: currentUser.id, category_id: cat.id,
    type: typeChip.dataset.key, client_id: clientId,
    label, montant, date,
  });
  closeRevenueModal();
  await loadAll();
}

// ============================================
// UTILS
// ============================================
function todayISOM() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().split('T')[0];
}

function formatDateShortM(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function openMokaRevenueModal() { openRevenueModal(); }

init();
