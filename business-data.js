// ============================================
// BUSINESS DATA — source de vérité unique
// ============================================
// Toute la logique d'agrégation financière Coaching Padel passe par ici,
// pour garantir que l'accueil et le futur dashboard Business affichent
// TOUJOURS exactement les mêmes chiffres (exigence section 19).
//
// Dépend de coaching-engine.js pour le calcul par cours (déjà stocké en base)
// — ce fichier ne fait qu'AGRÉGER des cours déjà calculés, il ne relance
// jamais le moteur de calcul lui-même.

// ---------- Utilitaires dates (local, pas de dépendance) ----------

function toISO(d) {
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().split('T')[0];
}

function parseISO(iso) {
  return new Date(iso + 'T00:00:00');
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function getMonday(d) {
  const day = d.getDay(); // 0 = dimanche
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(d, diff);
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function isoWeekNumber(d) {
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  return 1 + Math.round((firstThursday - target.valueOf()) / (7 * 24 * 3600 * 1000));
}

// ---------- Calcul de période ----------
// type: 'jour' | 'semaine' | 'mois'
// offset: 0 = période actuelle, -1 = précédente, +1 = suivante
function getPeriodRange(type, offset) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let start, end, label;

  if (type === 'jour') {
    start = addDays(today, offset);
    end = start;
    label = start.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
  } else if (type === 'semaine') {
    const monday = getMonday(today);
    start = addDays(monday, offset * 7);
    end = addDays(start, 6);
    label = `Semaine ${isoWeekNumber(start)}`;
  } else { // mois
    const y = today.getFullYear();
    const m = today.getMonth() + offset;
    start = new Date(y, m, 1);
    end = new Date(y, m, daysInMonth(start.getFullYear(), start.getMonth()));
    label = start.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  }

  const isCurrent = offset === 0;

  // Période de comparaison : période équivalente précédente.
  // Si la période actuelle est en cours (isCurrent), on ne compare qu'à la
  // portion déjà écoulée de la période précédente, pour ne pas fausser le %.
  let prevStart, prevEnd;
  if (type === 'jour') {
    prevStart = addDays(start, -1);
    prevEnd = prevStart;
  } else if (type === 'semaine') {
    prevStart = addDays(start, -7);
    if (isCurrent) {
      const elapsedDays = Math.round((today - start) / (24 * 3600 * 1000));
      prevEnd = addDays(prevStart, elapsedDays);
    } else {
      prevEnd = addDays(prevStart, 6);
    }
  } else {
    const prevMonthDate = new Date(start.getFullYear(), start.getMonth() - 1, 1);
    prevStart = prevMonthDate;
    if (isCurrent) {
      const dayOfMonth = today.getDate();
      const capped = Math.min(dayOfMonth, daysInMonth(prevMonthDate.getFullYear(), prevMonthDate.getMonth()));
      prevEnd = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth(), capped);
    } else {
      prevEnd = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth(), daysInMonth(prevMonthDate.getFullYear(), prevMonthDate.getMonth()));
    }
  }

  return {
    type, offset, isCurrent,
    start: toISO(start), end: toISO(end), label,
    prevStart: toISO(prevStart), prevEnd: toISO(prevEnd),
  };
}

// ---------- Récupération des cours d'une plage de dates ----------
async function fetchSessionsInRange(startISO, endISO) {
  const { data, error } = await supabaseClient
    .from('coaching_sessions')
    .select('*')
    .gte('date', startISO)
    .lte('date', endISO)
    .order('date', { ascending: true })
    .order('time', { ascending: true });

  if (error) {
    console.error('Erreur de chargement des cours :', error);
    return [];
  }
  return data || [];
}

// ---------- Agrégation KPI (la vraie source de vérité) ----------
const TYPE_GROUPS = {
  individuels: ['individuel', 'partie_coachee', 'autre'],
  duos: ['duo'],
  collectifs: ['collectif'],
};

function sum(arr, field) {
  return arr.reduce((total, item) => total + Number(item[field] || 0), 0);
}

function computeCoachingKPIs(sessions) {
  const nonAnnule = sessions.filter(s => s.status !== 'annule');
  const realise = nonAnnule.filter(s => s.status === 'realise');
  const prevu = nonAnnule.filter(s => s.status === 'prevu');
  const annule = sessions.filter(s => s.status === 'annule');

  const caRealise = sum(realise, 'ca_brut');
  const caPlanifie = sum(nonAnnule, 'ca_brut'); // réalisé + prévu
  const heures = sum(nonAnnule, 'duration_minutes') / 60;
  const heuresRealisees = sum(realise, 'duration_minutes') / 60;
  const heuresPlanifiees = sum(prevu, 'duration_minutes') / 60;
  const redevance = sum(nonAnnule, 'redevance_montant');
  const marge = sum(nonAnnule, 'marge');
  const provision = sum(nonAnnule, 'provision_montant');
  const netEstime = sum(nonAnnule, 'net_estime');

  const aEncaisserSessions = realise.filter(s => s.payment_status === 'a_payer');
  const aEncaisser = sum(aEncaisserSessions, 'ca_brut');

  const typeBreakdown = {};
  Object.entries(TYPE_GROUPS).forEach(([key, types]) => {
    const group = nonAnnule.filter(s => types.includes(s.type));
    typeBreakdown[key] = {
      count: group.length,
      ca: sum(group, 'ca_brut'),
      heures: sum(group, 'duration_minutes') / 60,
    };
  });

  return {
    caRealise: round2(caRealise),
    caPlanifie: round2(caPlanifie),
    heures: round2(heures),
    heuresRealisees: round2(heuresRealisees),
    heuresPlanifiees: round2(heuresPlanifiees),
    redevance: round2(redevance),
    marge: round2(marge),
    provision: round2(provision),
    netEstime: round2(netEstime),
    aEncaisser: round2(aEncaisser),
    aEncaisserSessions,
    pipeline: {
      realise: { count: realise.length, ca: round2(sum(realise, 'ca_brut')) },
      prevu: { count: prevu.length, ca: round2(sum(prevu, 'ca_brut')) },
      annule: { count: annule.length, ca: round2(sum(annule, 'ca_brut')) },
    },
    typeBreakdown,
    sessionsRealise: realise,
    sessionsPrevu: prevu,
    sessionsAnnule: annule,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Calcule un delta en % entre deux valeurs, avec gestion propre du cas "0 avant".
function computeDelta(current, previous) {
  if (previous === 0) {
    return current === 0 ? { pct: 0, direction: 'flat' } : { pct: 100, direction: 'up' };
  }
  const pct = ((current - previous) / previous) * 100;
  return { pct: Math.round(Math.abs(pct) * 10) / 10, direction: pct >= 0 ? 'up' : 'down' };
}

// ---------- Séries pour le graphique ----------

// Semaine : progression cumulée jour par jour (Lun -> Dim)
function buildWeeklySeries(sessions, startISO) {
  const start = parseISO(startISO);
  const labels = [];
  const realiseCumule = [];
  const planifieCumule = [];
  const details = [];

  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    const dayISO = toISO(day);
    labels.push(day.toLocaleDateString('fr-FR', { weekday: 'short' }));

    const upToDay = sessions.filter(s => s.date <= dayISO && s.status !== 'annule');
    const realiseUpToDay = upToDay.filter(s => s.status === 'realise');

    realiseCumule.push(round2(sum(realiseUpToDay, 'ca_brut')));
    planifieCumule.push(round2(sum(upToDay, 'ca_brut')));

    const dayOnly = sessions.filter(s => s.date === dayISO && s.status !== 'annule');
    details.push({
      date: dayISO,
      caRealise: round2(sum(dayOnly.filter(s => s.status === 'realise'), 'ca_brut')),
      caPrevu: round2(sum(dayOnly.filter(s => s.status === 'prevu'), 'ca_brut')),
      nbCours: dayOnly.length,
      heures: round2(sum(dayOnly, 'duration_minutes') / 60),
    });
  }

  return { labels, realiseCumule, planifieCumule, details };
}

// Mois : regroupement par semaine
function buildMonthlySeries(sessions, startISO, endISO) {
  const start = parseISO(startISO);
  const end = parseISO(endISO);
  const labels = [];
  const realiseCumule = [];
  const planifieCumule = [];
  const details = [];

  let cursor = new Date(start);
  let weekIndex = 1;
  while (cursor <= end) {
    const weekEnd = new Date(Math.min(addDays(cursor, 6).getTime(), end.getTime()));
    const weekEndISO = toISO(weekEnd);
    labels.push(`S${weekIndex}`);

    const upToWeek = sessions.filter(s => s.date <= weekEndISO && s.status !== 'annule');
    const realiseUpToWeek = upToWeek.filter(s => s.status === 'realise');

    realiseCumule.push(round2(sum(realiseUpToWeek, 'ca_brut')));
    planifieCumule.push(round2(sum(upToWeek, 'ca_brut')));

    const weekOnly = sessions.filter(s => s.date >= toISO(cursor) && s.date <= weekEndISO && s.status !== 'annule');
    details.push({
      date: `${toISO(cursor)} → ${weekEndISO}`,
      caRealise: round2(sum(weekOnly.filter(s => s.status === 'realise'), 'ca_brut')),
      caPrevu: round2(sum(weekOnly.filter(s => s.status === 'prevu'), 'ca_brut')),
      nbCours: weekOnly.length,
      heures: round2(sum(weekOnly, 'duration_minutes') / 60),
    });

    cursor = addDays(cursor, 7);
    weekIndex++;
  }

  return { labels, realiseCumule, planifieCumule, details };
}

// Jour : répartition par créneau (un point par cours)
function buildDailySeries(sessions, dayISO) {
  const dayOnly = sessions.filter(s => s.date === dayISO && s.status !== 'annule')
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  const labels = dayOnly.map(s => s.time?.slice(0, 5) || '');
  const realiseCumule = [];
  const planifieCumule = [];
  let runningRealise = 0, runningTotal = 0;

  dayOnly.forEach(s => {
    runningTotal += Number(s.ca_brut || 0);
    if (s.status === 'realise') runningRealise += Number(s.ca_brut || 0);
    realiseCumule.push(round2(runningRealise));
    planifieCumule.push(round2(runningTotal));
  });

  const details = dayOnly.map(s => ({
    date: `${s.time?.slice(0, 5)} — ${TYPE_LABELS_FR[s.type] || s.type}`,
    caRealise: s.status === 'realise' ? round2(Number(s.ca_brut)) : 0,
    caPrevu: s.status === 'prevu' ? round2(Number(s.ca_brut)) : 0,
    nbCours: 1,
    heures: round2(s.duration_minutes / 60),
  }));

  return { labels, realiseCumule, planifieCumule, details };
}

const TYPE_LABELS_FR = {
  individuel: 'Individuel', duo: 'Duo', collectif: 'Collectif',
  partie_coachee: 'Partie coachée', autre: 'Autre',
};

function buildChartSeries(periodRange, sessions) {
  if (periodRange.type === 'semaine') return buildWeeklySeries(sessions, periodRange.start);
  if (periodRange.type === 'mois') return buildMonthlySeries(sessions, periodRange.start, periodRange.end);
  return buildDailySeries(sessions, periodRange.start);
}

// ---------- Objectif (weekly_goals / monthly_goals) ----------
// Pas de table dédiée pour un objectif "jour" dans le schéma : on approxime
// l'objectif quotidien à objectif hebdo / 7 s'il existe, à défaut de créer
// une table dédiée pour un cas d'usage marginal.
async function fetchObjective(userId, periodRange) {
  if (periodRange.type === 'semaine') {
    const { data } = await supabaseClient
      .from('weekly_goals').select('ca_objectif')
      .eq('user_id', userId).eq('week_start_date', periodRange.start)
      .maybeSingle();
    return data?.ca_objectif ? Number(data.ca_objectif) : null;
  }
  if (periodRange.type === 'mois') {
    const { data } = await supabaseClient
      .from('monthly_goals').select('ca_objectif')
      .eq('user_id', userId).eq('month', periodRange.start)
      .maybeSingle();
    return data?.ca_objectif ? Number(data.ca_objectif) : null;
  }
  // jour : approximation à partir de l'objectif hebdo courant
  const monday = toISO(getMonday(new Date()));
  const { data } = await supabaseClient
    .from('weekly_goals').select('ca_objectif')
    .eq('user_id', userId).eq('week_start_date', monday)
    .maybeSingle();
  return data?.ca_objectif ? round2(Number(data.ca_objectif) / 7) : null;
}

// ---------- MOKA STUDIO ----------
// MRR = somme des abonnements/options actifs (moka_subscriptions.active = true).
// CA du mois = MRR (approximation : montant mensuel courant, sans prorata sur
// les dates exactes de début/fin en cours de mois) + revenus ponctuels du mois.
async function fetchMokaKPIs(userId, monthRange) {
  const { data: subs } = await supabaseClient
    .from('moka_subscriptions').select('*, moka_clients(name, status)')
    .eq('active', true);

  const { data: oneShots } = await supabaseClient
    .from('revenue_entries').select('*')
    .gte('date', monthRange.start).lte('date', monthRange.end)
    .in('type', ['one_shot', 'autre']);

  const { data: activeClients } = await supabaseClient
    .from('moka_clients').select('id').eq('status', 'actif');

  const mrr = round2(sum(subs || [], 'montant_mensuel'));
  const revenuPonctuel = round2(sum(oneShots || [], 'montant'));

  return {
    mrr,
    revenuPonctuel,
    caDuMois: round2(mrr + revenuPonctuel),
    clientsActifs: (activeClients || []).length,
    subscriptions: subs || [],
  };
}

// ---------- Réglages génériques (app_settings) ----------
async function getAppSetting(userId, key) {
  const { data } = await supabaseClient
    .from('app_settings').select('value')
    .eq('user_id', userId).eq('key', key).maybeSingle();
  return data?.value || null;
}

async function setAppSetting(userId, key, value) {
  await supabaseClient
    .from('app_settings')
    .upsert({ user_id: userId, key, value }, { onConflict: 'user_id,key' });
}

// ---------- TOURNOIS ----------
async function fetchTournamentsInRange(startISO, endISO) {
  const { data, error } = await supabaseClient
    .from('tournaments').select('*')
    .gte('date', startISO).lte('date', endISO);
  if (error) { console.error('Erreur de chargement des tournois :', error); return []; }
  return data || [];
}

function computeTournamentKPIs(tournaments) {
  const nonAnnule = tournaments.filter(t => t.status !== 'annule');
  const realise = nonAnnule.filter(t => t.status === 'realise');
  const prevu = nonAnnule.filter(t => t.status === 'prevu');

  return {
    caRealise: round2(sum(realise, 'ca_brut')),
    caPlanifie: round2(sum(nonAnnule, 'ca_brut')),
    netEstime: round2(sum(nonAnnule, 'net')),
    pipeline: {
      realise: { count: realise.length, ca: round2(sum(realise, 'ca_brut')) },
      prevu: { count: prevu.length, ca: round2(sum(prevu, 'ca_brut')) },
    },
  };
}
