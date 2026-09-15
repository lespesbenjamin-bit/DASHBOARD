// ============================================
// PAGE TÂCHES
// ============================================

let currentUser = null;
let categories = [];
let categoryByKey = {};
let categoryById = {};
let allTasks = [];
let activeCategoryFilter = 'all';
let showDone = false;
const RECURRENCE_WINDOW_DAYS = 56; // ~8 semaines d'occurrences générées d'avance

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

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  const { data: cats, error: catError } = await supabaseClient.from('categories').select('id, key, label');

  if (catError || !cats || cats.length === 0) {
    document.getElementById('task-list').innerHTML =
      `<p class="empty">Impossible de charger les catégories. Vérifie dans Supabase que la table "categories" contient bien 4 lignes et qu'elle est accessible en lecture.</p>`;
    console.error('Erreur de chargement des catégories :', catError);
    return; // on stoppe ici, inutile d'aller plus loin sans catégories
  }

  categories = cats;
  categories.forEach(c => { categoryByKey[c.key] = c; categoryById[c.id] = c; });

  document.getElementById('toggle-done').addEventListener('click', () => {
    showDone = !showDone;
    document.getElementById('toggle-done').textContent = showDone
      ? 'Masquer les tâches terminées'
      : 'Afficher les tâches terminées';
    renderTasks();
  });

  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeCategoryFilter = tab.dataset.cat;
      renderTasks();
    });
  });

  setupModal();
  await loadTasks();
  await loadInbox();
}

async function loadTasks() {
  const { data, error } = await supabaseClient
    .from('tasks')
    .select('*')
    .neq('status', 'annule')
    .order('date', { ascending: true })
    .order('priority', { ascending: true });

  if (error) {
    document.getElementById('task-list').innerHTML = `<p class="empty">Erreur de chargement.</p>`;
    return;
  }
  allTasks = data || [];
  renderTasks();
}

async function loadInbox() {
  const { data } = await supabaseClient
    .from('inbox_items')
    .select('*')
    .is('converted_task_id', null)
    .order('created_at', { ascending: false });

  const card = document.getElementById('inbox-card');
  const list = document.getElementById('inbox-list');

  if (!data || data.length === 0) {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';
  list.innerHTML = data.map(item => `
    <div class="task-row" data-inbox-id="${item.id}">
      <div class="task-body">
        <div class="task-title">${escapeHTML(item.content)}</div>
      </div>
      <div class="task-actions">
        <button class="icon-btn" data-action="convert" title="Transformer en tâche">📋</button>
        <button class="icon-btn" data-action="discard" title="Supprimer">✕</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-action="convert"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.target.closest('[data-inbox-id]').dataset.inboxId;
      const item = data.find(i => i.id === id);
      openTaskModal(null, { title: item.content, fromInboxId: id });
    });
  });

  list.querySelectorAll('[data-action="discard"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.closest('[data-inbox-id]').dataset.inboxId;
      await supabaseClient.from('inbox_items').delete().eq('id', id);
      loadInbox();
    });
  });
}

function renderTasks() {
  let list = allTasks;

  if (activeCategoryFilter !== 'all') {
    const cat = categoryByKey[activeCategoryFilter];
    list = list.filter(t => t.category_id === cat?.id);
  }
  if (!showDone) {
    list = list.filter(t => t.status !== 'termine');
  }

  const remaining = allTasks.filter(t => t.status !== 'termine').length;
  document.getElementById('task-count-sub').textContent = `${remaining} tâche${remaining > 1 ? 's' : ''} restante${remaining > 1 ? 's' : ''}`;

  const container = document.getElementById('task-list');
  if (list.length === 0) {
    container.innerHTML = '<p class="empty">Aucune tâche ici.</p>';
    return;
  }

  container.innerHTML = list.map(t => {
    const cat = categoryById[t.category_id];
    const isDone = t.status === 'termine';
    return `
      <div class="task-row ${isDone ? 'done' : ''}" data-id="${t.id}">
        <div class="checkbox ${isDone ? 'checked' : ''}" data-action="toggle">${isDone ? '✓' : ''}</div>
        <div class="task-body">
          <div class="task-title">${escapeHTML(t.title)}</div>
          <div class="task-meta">
            <span class="cat-badge ${cat?.key || ''}">${cat?.label || ''}</span>
            <span class="priority-dot ${t.priority}"></span>
            <span>${formatDateShort(t.date)}${t.time ? ' · ' + t.time.slice(0, 5) : ''}</span>
          </div>
        </div>
        <div class="task-actions actions-menu">
          <button class="icon-btn" data-action="menu">⋯</button>
          <div class="actions-dropdown">
            <button data-action="edit">Modifier</button>
            <button data-action="duplicate">Dupliquer</button>
            <button data-action="tomorrow">Reporter à demain</button>
            <button data-action="nextweek">Reporter +7 jours</button>
            <button data-action="delete" class="danger">Supprimer</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  attachRowEvents();
}

function formatDateShort(iso) {
  const d = new Date(iso + 'T00:00:00');
  const today = todayISO();
  const tomorrow = addDaysISO(today, 1);
  if (iso === today) return "Aujourd'hui";
  if (iso === tomorrow) return "Demain";
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function attachRowEvents() {
  document.querySelectorAll('.task-row[data-id]').forEach(row => {
    const id = row.dataset.id;
    const task = allTasks.find(t => t.id === id);

    row.querySelector('[data-action="toggle"]').addEventListener('click', () => toggleTask(task));

    const menuBtn = row.querySelector('[data-action="menu"]');
    const dropdown = row.querySelector('.actions-dropdown');
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.actions-dropdown.open').forEach(d => { if (d !== dropdown) d.classList.remove('open'); });
      dropdown.classList.toggle('open');
    });

    dropdown.querySelector('[data-action="edit"]').addEventListener('click', () => {
      dropdown.classList.remove('open');
      openTaskModal(task);
    });
    dropdown.querySelector('[data-action="duplicate"]').addEventListener('click', () => {
      dropdown.classList.remove('open');
      duplicateTask(task);
    });
    dropdown.querySelector('[data-action="tomorrow"]').addEventListener('click', () => {
      dropdown.classList.remove('open');
      rescheduleTask(task, addDaysISO(task.date, 1));
    });
    dropdown.querySelector('[data-action="nextweek"]').addEventListener('click', () => {
      dropdown.classList.remove('open');
      rescheduleTask(task, addDaysISO(task.date, 7));
    });
    dropdown.querySelector('[data-action="delete"]').addEventListener('click', () => {
      dropdown.classList.remove('open');
      deleteTask(task);
    });
  });

  document.addEventListener('click', () => {
    document.querySelectorAll('.actions-dropdown.open').forEach(d => d.classList.remove('open'));
  }, { once: true });
}

async function toggleTask(task) {
  const newStatus = task.status === 'termine' ? 'a_faire' : 'termine';
  await supabaseClient.from('tasks').update({
    status: newStatus,
    completed_at: newStatus === 'termine' ? new Date().toISOString() : null,
  }).eq('id', task.id);
  await loadTasks();
}

async function duplicateTask(task) {
  const copy = { ...task };
  delete copy.id;
  copy.status = 'a_faire';
  copy.completed_at = null;
  copy.created_at = new Date().toISOString();
  copy.user_id = currentUser.id;
  await supabaseClient.from('tasks').insert(copy);
  await loadTasks();
}

async function rescheduleTask(task, newDate) {
  await supabaseClient.from('tasks').update({ date: newDate }).eq('id', task.id);
  await loadTasks();
}

async function deleteTask(task) {
  if (task.recurrence_id) {
    const deleteAll = window.confirm(
      "Cette tâche fait partie d'une série récurrente.\n\nOK = supprimer TOUTE la série (occurrences à venir)\nAnnuler = supprimer seulement cette occurrence"
    );
    if (deleteAll) {
      await supabaseClient.from('task_recurrences').update({ active: false }).eq('id', task.recurrence_id);
      await supabaseClient.from('tasks')
        .delete()
        .eq('recurrence_id', task.recurrence_id)
        .gte('date', todayISO());
      await loadTasks();
      return;
    }
  }
  const confirmed = task.recurrence_id ? true : window.confirm('Supprimer cette tâche ?');
  if (!confirmed) return;
  await supabaseClient.from('tasks').delete().eq('id', task.id);
  await loadTasks();
}

// ============================================
// MODALE CRÉATION / ÉDITION
// ============================================

let editingTaskId = null;
let editingFromInboxId = null;

function setupModal() {
  const overlay = document.getElementById('task-modal-overlay');
  const form = document.getElementById('task-form');

  document.getElementById('cancel-modal').addEventListener('click', () => closeTaskModal());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeTaskModal(); });

  document.querySelectorAll('#f-category .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#f-category .chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
    });
  });

  document.querySelectorAll('#f-priority .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#f-priority .chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
    });
  });

  document.querySelectorAll('#f-days .chip').forEach(chip => {
    chip.addEventListener('click', () => chip.classList.toggle('selected'));
  });

  document.getElementById('f-recurrence').addEventListener('change', (e) => {
    document.getElementById('days-field').style.display = e.target.value === 'hebdomadaire' ? 'block' : 'none';
    document.getElementById('custom-field').style.display = e.target.value === 'personnalisee' ? 'block' : 'none';
  });

  form.addEventListener('submit', handleSubmit);
}

function openTaskModal(task = null, prefill = null) {
  editingTaskId = task ? task.id : null;
  editingFromInboxId = prefill?.fromInboxId || null;

  document.getElementById('task-error').style.display = 'none';
  document.getElementById('modal-title').textContent = task ? 'Modifier la tâche' : 'Nouvelle tâche';
  document.getElementById('recurrence-field').style.display = task ? 'none' : 'block'; // pas de récurrence en édition simple
  document.getElementById('days-field').style.display = 'none';
  document.getElementById('custom-field').style.display = 'none';

  document.getElementById('f-title').value = task?.title || prefill?.title || '';
  document.getElementById('f-date').value = task?.date || todayISO();
  document.getElementById('f-time').value = task?.time?.slice(0, 5) || '';
  document.getElementById('f-notes').value = task?.notes || '';
  document.getElementById('f-recurrence').value = 'aucune';
  document.getElementById('f-custom-dates').value = '';

  const catKey = task ? categoryById[task.category_id]?.key : 'padel';
  document.querySelectorAll('#f-category .chip').forEach(c => c.classList.toggle('selected', c.dataset.key === catKey));

  const priority = task?.priority || 'normale';
  document.querySelectorAll('#f-priority .chip').forEach(c => c.classList.toggle('selected', c.dataset.key === priority));

  document.querySelectorAll('#f-days .chip').forEach(c => c.classList.remove('selected'));

  document.getElementById('task-modal-overlay').classList.add('open');
}

function closeTaskModal() {
  document.getElementById('task-modal-overlay').classList.remove('open');
}

async function handleSubmit(e) {
  e.preventDefault();
  const errorEl = document.getElementById('task-error');
  errorEl.style.display = 'none';

  const title = document.getElementById('f-title').value.trim();
  const catChip = document.querySelector('#f-category .chip.selected');
  const priorityChip = document.querySelector('#f-priority .chip.selected');
  const date = document.getElementById('f-date').value;
  const time = document.getElementById('f-time').value || null;
  const notes = document.getElementById('f-notes').value.trim() || null;
  const recurrence = document.getElementById('f-recurrence').value;

  if (!title || !catChip || !priorityChip || !date) {
    errorEl.textContent = 'Merci de remplir tous les champs obligatoires.';
    errorEl.style.display = 'block';
    return;
  }

  const category = categoryByKey[catChip.dataset.key];

  if (!category) {
    errorEl.textContent = "Les catégories ne sont pas chargées correctement. Recharge la page et réessaie.";
    errorEl.style.display = 'block';
    return;
  }

  const priority = priorityChip.dataset.key;

  if (editingTaskId) {
    // Édition simple d'une tâche existante
    await supabaseClient.from('tasks').update({
      title, category_id: category.id, date, time, priority, notes,
    }).eq('id', editingTaskId);
  } else if (recurrence === 'aucune') {
    const { data: inserted } = await supabaseClient.from('tasks').insert({
      user_id: currentUser.id, title, category_id: category.id, date, time, priority, notes,
      status: 'a_faire',
    }).select().single();

    if (editingFromInboxId && inserted) {
      await supabaseClient.from('inbox_items').update({ converted_task_id: inserted.id }).eq('id', editingFromInboxId);
    }
  } else {
    await createRecurringTask({ title, category, date, time, priority, notes, recurrence });
  }

  closeTaskModal();
  await loadTasks();
  await loadInbox();
}

async function createRecurringTask({ title, category, date, time, priority, notes, recurrence }) {
  let daysOfWeek = null;
  let customDates = null;

  if (recurrence === 'hebdomadaire') {
    daysOfWeek = Array.from(document.querySelectorAll('#f-days .chip.selected')).map(c => parseInt(c.dataset.day, 10));
    if (daysOfWeek.length === 0) daysOfWeek = [new Date(date + 'T00:00:00').getDay()];
  }
  if (recurrence === 'personnalisee') {
    customDates = document.getElementById('f-custom-dates').value
      .split('\n').map(s => s.trim()).filter(Boolean);
  }

  const { data: rec } = await supabaseClient.from('task_recurrences').insert({
    user_id: currentUser.id,
    title, category_id: category.id,
    frequency: recurrence,
    days_of_week: daysOfWeek,
    custom_rule: customDates ? { dates: customDates } : null,
    start_date: date,
    active: true,
  }).select().single();

  const occurrenceDates = generateOccurrenceDates(recurrence, date, daysOfWeek, customDates);

  const rows = occurrenceDates.map(d => ({
    user_id: currentUser.id,
    title, category_id: category.id, date: d, time, priority, notes,
    status: 'a_faire',
    recurrence_id: rec.id,
  }));

  if (rows.length > 0) {
    await supabaseClient.from('tasks').insert(rows);
  }
}

function generateOccurrenceDates(frequency, startDate, daysOfWeek, customDates) {
  if (frequency === 'personnalisee') {
    return customDates || [];
  }

  const dates = [];
  for (let i = 0; i < RECURRENCE_WINDOW_DAYS; i++) {
    const d = addDaysISO(startDate, i);
    const dayOfWeek = new Date(d + 'T00:00:00').getDay();

    if (frequency === 'quotidienne') {
      dates.push(d);
    } else if (frequency === 'hebdomadaire' && daysOfWeek.includes(dayOfWeek)) {
      dates.push(d);
    } else if (frequency === 'mensuelle') {
      const startDay = new Date(startDate + 'T00:00:00').getDate();
      const currentDay = new Date(d + 'T00:00:00').getDate();
      if (startDay === currentDay) dates.push(d);
    }
  }
  return dates;
}

init();
