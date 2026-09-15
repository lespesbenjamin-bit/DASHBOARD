// ============================================
// SYNCHRONISATION AGENDA EXTERNE (iCal / webcal)
// ============================================
// Lecture seule : on affiche les événements du flux, on ne crée jamais
// automatiquement de cours Coaching à partir de ça (choix de Benjamin).

const ICS_CACHE_KEY = 'ics_events_cache';
const ICS_CACHE_TTL_MS = 15 * 60 * 1000; // 15 min

function icsUrlToFetchable(url) {
  return url.replace(/^webcal:\/\//i, 'https://');
}

async function fetchICSEvents(rawUrl) {
  const url = icsUrlToFetchable(rawUrl.trim());

  // Cache court (sessionStorage) pour éviter de solliciter le flux à chaque rendu.
  try {
    const cached = JSON.parse(sessionStorage.getItem(ICS_CACHE_KEY) || 'null');
    if (cached && cached.url === url && Date.now() - cached.fetchedAt < ICS_CACHE_TTL_MS) {
      return cached.events;
    }
  } catch (e) { /* cache corrompu, on ignore */ }

  let text = null;

  // 1. Tentative directe (fonctionne si le fournisseur autorise le CORS)
  try {
    const res = await fetch(url);
    if (res.ok) text = await res.text();
  } catch (e) { /* on tente le proxy ensuite */ }

  // 2. Repli via un proxy CORS public, nécessaire pour la plupart des flux iCal
  if (!text) {
    try {
      const proxied = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
      const res2 = await fetch(proxied);
      if (res2.ok) text = await res2.text();
    } catch (e) { /* échec complet, on remontera une erreur */ }
  }

  if (!text) throw new Error("Impossible de récupérer l'agenda externe.");

  const events = parseICS(text);
  try {
    sessionStorage.setItem(ICS_CACHE_KEY, JSON.stringify({ url, events, fetchedAt: Date.now() }));
  } catch (e) { /* stockage plein, tant pis */ }

  return events;
}

function parseICS(icsText) {
  const unfolded = icsText.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const lines = unfolded.split('\n');
  const events = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith('BEGIN:VEVENT')) {
      current = {};
    } else if (line.startsWith('END:VEVENT')) {
      if (current && current.start) events.push(current);
      current = null;
    } else if (current) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).split(';')[0];
      const value = line.slice(idx + 1);

      if (key === 'SUMMARY') current.title = value;
      else if (key === 'DTSTART') current.start = parseICSDate(value);
      else if (key === 'DTEND') current.end = parseICSDate(value);
      else if (key === 'UID') current.uid = value;
      else if (key === 'STATUS') current.status = value;
    }
  }
  return events;
}

function parseICSDate(value) {
  if (/^\d{8}$/.test(value)) {
    return { date: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`, time: null, allDay: true };
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;

  const dateObj = z === 'Z'
    ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
    : new Date(+y, +mo - 1, +d, +h, +mi, +s);

  const offset = dateObj.getTimezoneOffset();
  const local = new Date(dateObj.getTime() - offset * 60000);
  const dateISO = local.toISOString().split('T')[0];
  const hh = dateObj.getHours().toString().padStart(2, '0');
  const mm = dateObj.getMinutes().toString().padStart(2, '0');

  return { date: dateISO, time: `${hh}:${mm}`, allDay: false };
}

// Filtre les événements d'un flux déjà parsé sur une plage de dates (incluse).
function filterICSEventsInRange(events, startISO, endISO) {
  return events.filter(e => e.start && e.start.date >= startISO && e.start.date <= endISO);
}
