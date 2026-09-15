// ============================================
// MENU ➕ — bottom sheet partagé
// ============================================
// Injecte le HTML du sheet dans la page et gère son ouverture/fermeture.
// Chaque page doit avoir un élément avec id="nav-add" comme déclencheur.

function injectAddMenu() {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="sheet-overlay" id="add-sheet-overlay">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <button class="sheet-option" id="opt-tache">
          <span class="icon">📋</span> Tâche
        </button>
        <button class="sheet-option" id="opt-idee">
          <span class="icon">💡</span> Idée (capture rapide)
        </button>
        <button class="sheet-option" id="opt-cours">
          <span class="icon">🎾</span> Cours Padel
        </button>
        <button class="sheet-option" id="opt-revenu">
          <span class="icon">💶</span> Revenu
        </button>
        <button class="sheet-option" id="opt-entrainement">
          <span class="icon">🏃</span> Entraînement
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap.firstElementChild);

  const overlay = document.getElementById('add-sheet-overlay');

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('open');
  });

  document.getElementById('opt-tache').addEventListener('click', () => {
    overlay.classList.remove('open');
    // Sur la page Tâches : on ouvre directement la modale de création.
    // Sur une autre page : on redirige vers tasks.html avec le paramètre ?new=1
    if (typeof openTaskModal === 'function') {
      openTaskModal();
    } else {
      window.location.href = 'tasks.html?new=1';
    }
  });

  document.getElementById('opt-cours').addEventListener('click', () => {
    overlay.classList.remove('open');
    if (typeof openCoachingModal === 'function') {
      openCoachingModal();
    } else {
      window.location.href = 'coaching.html?new=1';
    }
  });

  document.getElementById('opt-revenu').addEventListener('click', () => {
    overlay.classList.remove('open');
    if (typeof openMokaRevenueModal === 'function') {
      openMokaRevenueModal();
    } else {
      window.location.href = 'moka.html?new=revenu';
    }
  });

  document.getElementById('opt-entrainement').addEventListener('click', () => {
    overlay.classList.remove('open');
    if (typeof openRunningModal === 'function') {
      openRunningModal();
    } else {
      window.location.href = 'running.html?new=1';
    }
  });

  document.getElementById('opt-idee').addEventListener('click', async () => {
    overlay.classList.remove('open');
    const content = window.prompt("Capture rapide — qu'est-ce que tu veux noter ?");
    if (!content || !content.trim()) return;
    const { data: { session } } = await supabaseClient.auth.getSession();
    await supabaseClient.from('inbox_items').insert({
      user_id: session.user.id,
      content: content.trim(),
    });
    alert('Ajouté à ton Inbox 💡');
  });

  const navAddButtons = document.querySelectorAll('#nav-add, .nav-add');
  navAddButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      overlay.classList.add('open');
    });
  });

  // Ouverture automatique si on arrive avec ?new=1 dans l'URL (redirection depuis une autre page)
  const params = new URLSearchParams(window.location.search);
  if (params.get('new') === '1') {
    setTimeout(() => {
      if (typeof openTaskModal === 'function') openTaskModal();
      else if (typeof openCoachingModal === 'function') openCoachingModal();
      else if (typeof openRunningModal === 'function') openRunningModal();
    }, 150);
  }
}

document.addEventListener('DOMContentLoaded', injectAddMenu);
