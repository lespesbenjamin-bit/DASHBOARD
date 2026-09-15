// ============================================
// MOTEUR DE CALCUL FINANCIER — COACHING PADEL
// ============================================
// Toute la logique décrite aux sections 11 à 14 du cahier des charges :
// tarifs, redevance club (standard + heures pleines), provision, net estimé.
//
// IMPORTANT : ce fichier ne fait AUCUN appel réseau lui-même (sauf
// getOrCreateCoachingSettings). Les montants qu'il calcule sont ensuite
// stockés directement sur chaque coaching_session au moment de l'enregistrement,
// et ne sont plus jamais recalculés rétroactivement (section 30).

// Récupère les paramètres de tarifs/redevances de l'utilisateur.
// Si aucune ligne n'existe encore (première utilisation), on en crée une
// avec les valeurs par défaut du cahier des charges.
async function getOrCreateCoachingSettings(userId) {
  const { data: existing } = await supabaseClient
    .from('coaching_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) return existing;

  const defaults = {
    user_id: userId,
    tarif_individuel_montant: 45,
    tarif_individuel_duree_ref_min: 60,
    tarif_collectif_montant: 25,
    tarif_collectif_duree_ref_min: 90,
    redevance_1_joueur_heure: 7.5,
    redevance_2plus_par_joueur_heure: 5,
    redevance_hp_montant: 52,
    redevance_hp_heure_debut: '18:00',
    redevance_hp_heure_fin: '21:00',
    provision_taux: 30,
  };

  const { data: created } = await supabaseClient
    .from('coaching_settings')
    .insert(defaults)
    .select()
    .single();

  return created;
}

// Détermine si l'heure de début tombe dans la plage "heures pleines" définie
// dans les paramètres (ex. 18h-21h).
function isHeurePleine(time, settings) {
  if (!time) return false;
  const t = time.slice(0, 5); // "HH:MM"
  const debut = settings.redevance_hp_heure_debut?.slice(0, 5) || '18:00';
  const fin = settings.redevance_hp_heure_fin?.slice(0, 5) || '21:00';
  return t >= debut && t < fin;
}

// Calcule l'ensemble des montants d'un cours à partir de ses caractéristiques
// et des paramètres actuels. Retourne un objet prêt à être stocké tel quel
// sur la ligne coaching_sessions.
function calculateSession({ type, durationMinutes, nbPlayers, time, tarifOverride }, settings) {
  // 1. CA brut
  let caBrut;
  if (tarifOverride !== null && tarifOverride !== undefined && tarifOverride !== '') {
    caBrut = Number(tarifOverride);
  } else if (type === 'collectif') {
    caBrut = (settings.tarif_collectif_montant / settings.tarif_collectif_duree_ref_min) * durationMinutes * nbPlayers;
  } else {
    caBrut = (settings.tarif_individuel_montant / settings.tarif_individuel_duree_ref_min) * durationMinutes;
  }

  // 2. Redevance club — HP prioritaire et exclusive si le créneau correspond
  let redevanceRule, redevanceMontant;
  if (isHeurePleine(time, settings)) {
    redevanceRule = 'terrain_hp';
    redevanceMontant = Number(settings.redevance_hp_montant);
  } else {
    redevanceRule = 'standard';
    if (nbPlayers <= 1) {
      redevanceMontant = settings.redevance_1_joueur_heure * (durationMinutes / 60);
    } else {
      redevanceMontant = settings.redevance_2plus_par_joueur_heure * nbPlayers * (durationMinutes / 60);
    }
  }

  // 3. Marge avant cotisations
  const marge = caBrut - redevanceMontant;

  // 4. Provision de pilotage (non fiscale)
  const provisionTaux = Number(settings.provision_taux);
  const provisionMontant = marge * (provisionTaux / 100);

  // 5. Net estimé après provision
  const netEstime = marge - provisionMontant;

  return {
    ca_brut: round2(caBrut),
    redevance_rule: redevanceRule,
    redevance_montant: round2(redevanceMontant),
    marge: round2(marge),
    provision_taux: provisionTaux,
    provision_montant: round2(provisionMontant),
    net_estime: round2(netEstime),
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
