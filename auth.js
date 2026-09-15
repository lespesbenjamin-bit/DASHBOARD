// ============================================
// AUTH — helpers partagés
// ============================================

// Sur login.html : si une session existe déjà, on saute directement au dashboard.
async function redirectIfLoggedIn() {
  const { data } = await supabaseClient.auth.getSession();
  if (data.session) {
    window.location.href = 'index.html';
  }
}

// Sur toute page protégée (index.html, etc.) : si pas de session, retour au login.
// Renvoie l'utilisateur connecté si la session est valide.
async function requireAuth() {
  const { data } = await supabaseClient.auth.getSession();
  if (!data.session) {
    window.location.href = 'login.html';
    return null;
  }
  return data.session.user;
}

async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = 'login.html';
}
