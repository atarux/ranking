'use strict';

/* ================== Dati ================== */

const STORE_KEY = 'classifica.v1';
const VER_KEY = 'classifica.versione';
const PIN_KEY = 'classifica.pin';
const APP_VERSION = 13;

// Database condiviso su Supabase (tabelle e funzioni in supabase.sql).
// La chiave "publishable" è fatta per stare nel codice pubblico: i dati li protegge il PIN.
// Se restano vuoti, i dati stanno solo su questo telefono.
const SUPABASE_URL = 'https://mdxogalrfifgiebqqvhh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_lNg2oEL_S25oQPVVZA73qw_HJep55Jo';
const CLOUD = Boolean(SUPABASE_URL && SUPABASE_KEY);
const COLORS = ['#8b7cf6', '#f472b6', '#38bdf8', '#f59e0b', '#34d399', '#fb7185', '#a3e635', '#94a3b8'];
const EMOJIS = ['🦊', '🐼', '🐯', '🐸', '🐨', '🦁', '🐵', '🐙', '🦄', '🐶', '🐱', '🐻', '🐰', '🐲', '🐧', '🦉',
  '👑', '🚀', '🔥', '⭐️', '⚽️', '🏀', '🎯', '🎲', '🎸', '🍕', '🌵', '👻', '🤖', '😎', '🥷', '🧙'];

const $ = (sel, el = document) => el.querySelector(sel);
const uid = () => Math.random().toString(36).slice(2, 10);

const DEFAULT_TITLE = '2026/2027';
const DEFAULT_NAMES = ['Marco', 'Muzzi', 'Paola', 'Puddu'];

function defaultState() {
  return {
    title: DEFAULT_TITLE,
    players: [
      { id: uid(), name: DEFAULT_NAMES[0], emoji: '🦊', color: COLORS[0], photo: null },
      { id: uid(), name: DEFAULT_NAMES[1], emoji: '🐼', color: COLORS[1], photo: null },
      { id: uid(), name: DEFAULT_NAMES[2], emoji: '🐯', color: COLORS[2], photo: null },
      { id: uid(), name: DEFAULT_NAMES[3], emoji: '🐸', color: COLORS[3], photo: null },
    ],
    // Punti a ogni vincitore nelle modalità singola e a squadre.
    winPoints: 2,
    // Ogni voce: { id, ts, type: 'round' | 'adjust', mode?: 'classic' | 'single' | 'team', deltas: { [playerId]: number } }
    // I punti di un giocatore sono sempre la somma dei suoi delta.
    history: [],
  };
}

function isValidState(s) {
  return s && typeof s === 'object' && Array.isArray(s.players) && s.players.length > 0 &&
    Array.isArray(s.history) && s.players.every(p => p && p.id && typeof p.name === 'string');
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (isValidState(s)) return s;
  } catch { /* dati assenti o corrotti: si riparte da zero */ }
  return defaultState();
}

// Sostituisce i vecchi valori di esempio con quelli nuovi, senza toccare ciò che l'utente ha già cambiato.
function migrateDefaults(s) {
  let changed = false;
  if (s.title === 'La nostra sfida') { s.title = DEFAULT_TITLE; changed = true; }
  s.players.forEach((p, i) => {
    if (p.name === `Giocatore ${i + 1}` && DEFAULT_NAMES[i]) { p.name = DEFAULT_NAMES[i]; changed = true; }
  });
  return changed;
}

let state = load();
let version = Number(localStorage.getItem(VER_KEY)) || 0;
if (migrateDefaults(state)) saveLocal();

// Copia locale: la classifica si vede subito, anche offline.
function saveLocal() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    localStorage.setItem(VER_KEY, String(version));
  } catch {
    toast('Memoria piena: prova a usare foto più piccole');
  }
}

// Chiede al browser di non cancellare i dati in caso di poco spazio.
navigator.storage?.persist?.().catch(() => {});

/* ================== Sincronizzazione ================== */

let pin = CLOUD ? localStorage.getItem(PIN_KEY) : null;
let base = JSON.stringify(state); // ultimo stato confermato dal server
let pending = [];                 // modifiche di questo telefono non ancora sul server
let syncing = null;

// Ogni modifica passa da qui: si vede subito e poi parte verso il server.
// mutate(s) cambia lo stato s oppure ne restituisce uno nuovo; se un altro telefono
// ha salvato nel frattempo, viene riapplicata sui suoi dati.
function change(mutate) {
  state = mutate(state) ?? state;
  saveLocal();
  renderAll();
  if (CLOUD) {
    pending.push(mutate);
    sync();
  }
}

async function rpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`Server: ${res.status}`);
  const out = await res.json();
  if (out.errore === 'pin' || out.errore === 'troppi_tentativi') {
    throw Object.assign(new Error(out.errore), { code: out.errore });
  }
  return out;
}

function applyServer(dati, ver) {
  version = ver;
  base = JSON.stringify(dati);
  state = JSON.parse(base);
  for (const m of pending) {
    try { state = m(state) ?? state; } catch { /* la modifica non ha senso sui nuovi dati */ }
  }
  saveLocal();
  renderAll();
}

function sync() {
  if (!pin) return Promise.resolve();
  syncing ??= push().finally(() => { syncing = null; });
  return syncing;
}

async function push() {
  try {
    for (let conflicts = 0; pending.length;) {
      const sent = pending.length;
      const snap = JSON.stringify(state);
      const out = await rpc('salva_classifica', { p_pin: pin, p_dati: state, p_versione: version });
      if (out.errore === 'conflitto') {
        if (++conflicts > 5) throw new Error('conflitto');
        // Server vuoto (es. database ricreato): si ricarica la classifica di questo telefono.
        if (!isValidState(out.dati)) version = 0;
        else applyServer(out.dati, out.versione);
        continue;
      }
      version = out.versione;
      base = snap;
      pending.splice(0, sent);
      saveLocal();
    }
  } catch (e) {
    // Senza conferma dal server si torna all'ultimo stato salvato,
    // così questo telefono non mostra punti che gli altri non vedono.
    pending = [];
    state = JSON.parse(base);
    saveLocal();
    renderAll();
    syncError(e, 'Nessuna connessione: modifica non salvata');
  }
}

async function pull() {
  if (!pin || syncing || pending.length) return;
  try {
    const out = await rpc('leggi_classifica', { p_pin: pin });
    if (syncing || pending.length) return; // nel frattempo è partita una modifica: vince quella
    if (!isValidState(out.dati)) {
      // Server ancora vuoto: si parte dalla classifica di questo telefono.
      version = 0;
      change(s => s);
    } else if (JSON.stringify(out.dati) !== JSON.stringify(state) || out.versione !== version) {
      applyServer(out.dati, out.versione);
    }
  } catch (e) {
    syncError(e); // offline si continua a vedere la copia locale
  }
}

function syncError(e, offlineMsg) {
  if (e.code === 'pin') {
    pin = null;
    localStorage.removeItem(PIN_KEY);
    askPin('Il PIN è cambiato: inseriscilo di nuovo');
  } else if (e.code === 'troppi_tentativi') {
    toast('Troppi PIN sbagliati: riprova tra 15 minuti');
  } else if (offlineMsg) {
    toast(offlineMsg);
  }
}

function askPin(hint) {
  $('#pinHint').textContent = hint;
  $('#pinError').textContent = '';
  $('#pinInput').value = '';
  openSheet('#sheetPin');
}

$('#pinForm').addEventListener('submit', async e => {
  e.preventDefault();
  const value = $('#pinInput').value.trim();
  if (!value) return;
  const btn = $('#pinForm button');
  btn.disabled = true;
  try {
    await rpc('leggi_classifica', { p_pin: value });
    pin = value;
    localStorage.setItem(PIN_KEY, pin);
    pending = [];
    $('#pinInput').blur();
    closeSheet('#sheetPin');
    await pull();
    toast('Classifica collegata ✓');
  } catch (err) {
    $('#pinError').textContent =
      err.code === 'pin' ? 'PIN sbagliato' :
      err.code === 'troppi_tentativi' ? 'Troppi tentativi: riprova tra 15 minuti' :
      'Nessuna connessione: riprova';
  } finally {
    btn.disabled = false;
  }
});

/* ================== Calcoli ================== */

function totals(upTo = state.history.length) {
  const t = Object.fromEntries(state.players.map(p => [p.id, 0]));
  for (let i = 0; i < upTo; i++) {
    for (const [id, d] of Object.entries(state.history[i].deltas)) if (id in t) t[id] += d;
  }
  return t;
}

function standings(upTo) {
  const t = totals(upTo);
  const list = state.players.map((p, order) => ({ ...p, points: t[p.id], order }));
  list.sort((a, b) => b.points - a.points || a.order - b.order);
  let rank = 0, prev = null;
  list.forEach((r, i) => {
    if (r.points !== prev) { rank = i + 1; prev = r.points; }
    r.rank = rank;
  });
  return list;
}

function rounds() { return state.history.filter(h => h.type === 'round'); }
const roundMode = r => r.mode || 'classic';
const winPoints = () => Number.isFinite(state.winPoints) ? state.winPoints : 2;

// Posizione di ogni giocatore in un round: chi ha più punti è 1°, chi non ne ha preso nessuno è ultimo.
function roundPlaces(r) {
  const n = state.players.length;
  const pts = state.players.map(p => r.deltas[p.id] || 0);
  return Object.fromEntries(state.players.map((p, i) =>
    [p.id, pts[i] > 0 ? 1 + pts.filter(v => v > pts[i]).length : n]));
}

function placeCounts(id) {
  const counts = state.players.map(() => 0);
  for (const r of rounds()) if (roundMode(r) === 'classic') counts[roundPlaces(r)[id] - 1]++;
  return counts;
}

function playerStats() {
  const rs = rounds();
  const t = totals();
  // Chi era primo in classifica generale dopo ogni round (a pari merito lo sono tutti).
  const leaders = [];
  state.history.forEach((h, i) => {
    if (h.type === 'round') leaders.push(new Set(standings(i + 1).filter(r => r.rank === 1).map(r => r.id)));
  });
  return state.players.map(p => {
    const vals = rs.filter(r => p.id in r.deltas).map(r => r.deltas[p.id]);
    const wins = rs.filter(r => {
      const max = Math.max(...Object.values(r.deltas));
      return max > 0 && r.deltas[p.id] === max;
    }).length;
    // Record: il maggior numero di round di fila in testa alla classifica generale.
    let streak = 0, run = 0;
    for (const l of leaders) { run = l.has(p.id) ? run + 1 : 0; streak = Math.max(streak, run); }
    return {
      ...p,
      total: t[p.id],
      played: vals.length,
      wins,
      avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0,
      streak,
    };
  });
}

/* ================== Utility ================== */

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n).toLocaleString('it-IT', { maximumFractionDigits: 1 });
const signed = n => (n > 0 ? '+' : '') + fmt(n);
const dateFmt = ts => new Date(ts).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function avatarHTML(p, crown = false) {
  const inner = p.photo ? `<img src="${p.photo}" alt="">` : esc(p.emoji || '🙂');
  return `<span class="avatar" style="--c:${p.color}">${inner}${crown ? CROWN : ''}</span>`;
}

const CROWN = `<svg class="crown" viewBox="0 0 24 16"><path d="M2 14 3.5 4l5 4.5L12 1l3.5 7.5 5-4.5L22 14z" fill="#f5b82e" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

const LAUREL = (() => {
  const leaves = [];
  // Ramo sinistro lungo un arco dal basso verso l'alto, poi specchiato a destra.
  for (let i = 0; i < 5; i++) {
    const deg = 110 + i * 30;
    const a = deg * Math.PI / 180;
    const x = 24 + 17 * Math.cos(a), y = 21 + 15 * Math.sin(a);
    const rot = deg + 25;
    for (const [cx, r] of [[x, rot], [48 - x, -rot]]) {
      leaves.push(`<ellipse cx="${cx.toFixed(1)}" cy="${y.toFixed(1)}" rx="2.2" ry="4.4" transform="rotate(${r.toFixed(0)} ${cx.toFixed(1)} ${y.toFixed(1)})"/>`);
    }
  }
  return `<svg class="laurel" viewBox="0 0 48 40" fill="currentColor">${leaves.join('')}</svg>`;
})();

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ================== Classifica ================== */

const shownPoints = {};

function renderRanking() {
  $('#boardTitle').textContent = state.title;
  const rs = rounds();
  const last = state.history[state.history.length - 1];
  $('#boardMeta').textContent = rs.length
    ? `${rs.length} round · aggiornata ${dateFmt(last.ts)}`
    : 'Nessun round ancora: tocca + per iniziare';

  const list = standings();
  const prevRank = state.history.length
    ? Object.fromEntries(standings(state.history.length - 1).map(p => [p.id, p.rank]))
    : null;

  const ol = $('#rankList');
  const before = new Map([...ol.children].map(li => [li.dataset.id, li.getBoundingClientRect().top]));

  ol.innerHTML = list.map((p, i) => {
    const move = prevRank ? prevRank[p.id] - p.rank : 0;
    const trend = move > 0 ? '<span class="trend up">▲</span>' : move < 0 ? '<span class="trend down">▼</span>' : '';
    const first = i === 0;
    return `<li class="row${first ? ' first' : ''}" data-id="${p.id}">
      <span class="rank">${first ? LAUREL : ''}<b>${state.history.length ? p.rank : i + 1}</b>${trend}</span>
      ${avatarHTML(p, first)}
      <span class="name">${esc(p.name)}</span>
      <span class="pts" data-id="${p.id}">${fmt(shownPoints[p.id] ?? p.points)}</span>
    </li>`;
  }).join('');

  // Animazione di riordino (FLIP)
  for (const li of ol.children) {
    const top = before.get(li.dataset.id);
    if (top == null) continue;
    const dy = top - li.getBoundingClientRect().top;
    if (dy) li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 500, easing: 'cubic-bezier(.2,.9,.3,1)' });
  }

  // Punti che "contano" fino al nuovo valore
  for (const p of list) {
    const el = ol.querySelector(`.pts[data-id="${p.id}"]`);
    const from = shownPoints[p.id] ?? p.points;
    shownPoints[p.id] = p.points;
    if (from === p.points) continue;
    const t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / 700);
      el.textContent = fmt(Math.round(from + (p.points - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

/* ================== Statistiche ================== */

function renderStats() {
  const body = $('#statsBody');
  const rs = rounds();
  const list = standings();
  const stats = playerStats();

  if (!state.history.length) {
    body.innerHTML = `<div class="card empty"><b>Ancora nessun dato</b>Aggiungi il primo round con il pulsante + in basso.</div>`;
    return;
  }

  const gap = list.length > 1 ? list[0].points - list[1].points : 0;
  const maxTotal = Math.max(1, ...stats.map(s => Math.abs(s.total)));

  body.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="v">${rs.length}</div><div class="l">Round giocati</div></div>
      <div class="kpi"><div class="v">${list[0].photo ? '🏆' : esc(list[0].emoji)}</div><div class="l">${esc(list[0].name)}</div></div>
      <div class="kpi"><div class="v">${fmt(gap)}</div><div class="l">Distacco 1°–2°</div></div>
    </div>

    <div class="card">
      <h3 class="card-title">Andamento punti</h3>
      ${chartSVG()}
      <div class="legend">${state.players.map(p => `<span style="--c:${p.color}"><i></i>${esc(p.name)}</span>`).join('')}</div>
    </div>

    <div class="card">
      <h3 class="card-title">Giocatori</h3>
      ${stats.sort((a, b) => b.total - a.total).map(s => `
        <button class="pstat" data-player="${s.id}">
          ${avatarHTML(s)}
          <div>
            <div class="top"><span class="nm">${esc(s.name)}</span><span class="tot">${fmt(s.total)} pt</span></div>
            <div class="mini">
              <span>Vittorie <b>${s.wins}</b></span>
              <span>Media <b>${fmt(s.avg)}</b></span>
              <span>Record <b>${s.streak}</b> di fila</span>
            </div>
            <div class="bar" style="--c:${s.color}"><i style="width:${Math.max(0, s.total) / maxTotal * 100}%"></i></div>
          </div>
        </button>`).join('')}
    </div>

    <div class="card">
      <h3 class="card-title">Storico</h3>
      ${historyHTML()}
    </div>`;
}

function chartSVG() {
  const W = 320, H = 170, L = 30, R = 8, T = 10, B = 22;
  const n = state.history.length;
  const series = state.players.map(p => {
    let acc = 0;
    return [0, ...state.history.map(h => (acc += h.deltas[p.id] || 0))];
  });
  const all = series.flat();
  let min = Math.min(0, ...all), max = Math.max(1, ...all);
  const pad = (max - min) * 0.08; max += pad; if (min < 0) min -= pad;
  const x = i => L + (W - L - R) * (n ? i / n : 0);
  const y = v => T + (H - T - B) * (1 - (v - min) / (max - min));

  const ticks = [min, (min + max) / 2, max].map(v => Math.round(v));
  const grid = ticks.map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${fmt(v)}</text>`).join('');
  const xLabels = `<text class="axis" x="${L}" y="${H - 6}">inizio</text><text class="axis" x="${W - R}" y="${H - 6}" text-anchor="end">oggi</text>`;
  const lines = series.map((s, k) => {
    const c = state.players[k].color;
    const d = s.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
    return `<path class="line" d="${d}" stroke="${c}"/><circle cx="${x(n)}" cy="${y(s[n])}" r="4.5" fill="${c}" stroke="#fff" stroke-width="2"/>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Andamento dei punti">${grid}${xLabels}${lines}</svg>`;
}

function historyHTML() {
  const byId = Object.fromEntries(state.players.map(p => [p.id, p]));
  let roundNo = 0;
  const items = state.history.map(h => ({ h, no: h.type === 'round' ? ++roundNo : null }));
  return items.reverse().map(({ h, no }) => `
    <div class="hist-item">
      <div>
        <div class="when"><b>${no ? `Round ${no}` : 'Correzione manuale'}</b>${no && roundMode(h) !== 'classic' ? ` · ${MODES[roundMode(h)].label}` : ''} · ${dateFmt(h.ts)}</div>
        <div class="chips">${Object.entries(h.deltas).filter(([id, d]) => byId[id] && d !== 0).map(([id, d]) =>
          `<span class="chip ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}">${esc(byId[id].name)} ${signed(d)}</span>`).join('')}</div>
      </div>
      <button class="icon-btn" data-del="${h.id}" aria-label="Elimina">
        <svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
      </button>
    </div>`).join('');
}

function openPlayer(id) {
  const p = state.players.find(x => x.id === id);
  const counts = placeCounts(id);
  const max = Math.max(1, ...counts);
  const rs = rounds();
  const total = rs.filter(r => roundMode(r) === 'classic').length;
  // Nelle modalità singola e a squadre conta solo chi ha vinto.
  const other = ['single', 'team'].map(m => {
    const played = rs.filter(r => roundMode(r) === m);
    const won = played.filter(r => r.deltas[id] > 0).length;
    return played.length ? `${MODES[m].label}: <b>${won}</b> vinti su ${played.length}` : '';
  }).filter(Boolean);
  $('#plTitle').textContent = p.name;
  $('#plBody').innerHTML = `
    <div class="av-preview">${avatarHTML(p)}</div>
    <p class="sheet-hint">Piazzamenti nei ${total} round classici</p>
    <div class="histo" style="--c:${p.color}">
      ${counts.map((c, i) => `
        <div class="col">
          <span class="cnt">${c}</span>
          <div class="track"><i style="height:${c / max * 100}%"></i></div>
          <span class="lbl">${MEDALS[i] || ''} ${i + 1}°</span>
          <span class="pct">${total ? Math.round(c / total * 100) : 0}%</span>
        </div>`).join('')}
    </div>
    ${other.length ? `<p class="sheet-hint">${other.join(' · ')}</p>` : ''}`;
  openSheet('#sheetPlayer');
}

$('#statsBody').addEventListener('click', e => {
  const pl = e.target.closest('[data-player]');
  if (pl) { openPlayer(pl.dataset.player); return; }
  const btn = e.target.closest('[data-del]');
  if (!btn) return;
  if (!confirm('Eliminare questa voce? I punti verranno ricalcolati.')) return;
  const id = btn.dataset.del;
  change(s => { s.history = s.history.filter(h => h.id !== id); });
  toast('Voce eliminata');
});

/* ================== Aggiorna punti ================== */

// Punti per chi arriva 1°, 2° e 3°: si toccano i giocatori in ordine di arrivo.
const PLACE_POINTS = [5, 3, 1];
const MEDALS = ['🥇', '🥈', '🥉'];

// Classica: podio 5/3/1. Singola: un vincitore. A squadre: due vincitori.
// Nelle ultime due ogni vincitore prende winPoints().
const MODES = {
  classic: { label: 'Classica', winners: PLACE_POINTS.length },
  single: { label: 'Singola', winners: 1 },
  team: { label: 'A squadre', winners: 2 },
};

let mode = 'classic';
let picks = [];

const pickPoints = i => mode === 'classic' ? PLACE_POINTS[i] : winPoints();

function openUpdate() {
  mode = 'classic';
  picks = [];
  const t = totals();
  $('#updRows').innerHTML = standings().map(p => `
    <button class="upd-row" data-id="${p.id}">
      ${avatarHTML(p)}
      <div style="min-width:0"><div class="nm">${esc(p.name)}</div><div class="cur">${fmt(t[p.id])} pt</div></div>
      <span class="place"></span>
    </button>`).join('');
  renderPicks();
  openSheet('#sheetUpdate');
}

function renderPicks() {
  const max = MODES[mode].winners;
  for (const b of $('#updModes').children) {
    const on = b.dataset.mode === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  }
  for (const row of $('#updRows').children) {
    const i = picks.indexOf(row.dataset.id);
    row.disabled = i >= 0 || picks.length >= max;
    row.classList.toggle('picked', i >= 0);
    row.querySelector('.place').innerHTML = i >= 0 ? `${mode === 'classic' ? MEDALS[i] : '🏆'} <b>+${pickPoints(i)}</b>` : '';
  }
  const pts = winPoints();
  let hint;
  if (picks.length >= max) hint = mode === 'classic' ? 'Podio completo: tocca Salva' : mode === 'team' ? 'Squadra completa: tocca Salva' : 'Vincitore scelto: tocca Salva';
  else if (mode === 'classic') hint = `Tocca chi è arrivato ${picks.length + 1}° (+${PLACE_POINTS[picks.length]} pt)`;
  else if (mode === 'single') hint = `Tocca il vincitore (+${pts} pt)`;
  else hint = picks.length ? `Tocca il secondo vincitore (+${pts} pt)` : `Tocca i 2 vincitori (+${pts} pt ciascuno)`;
  $('#updHint').textContent = hint;
  $('#btnResetPicks').hidden = !picks.length;
}

$('#updModes').addEventListener('click', e => {
  const b = e.target.closest('[data-mode]');
  if (!b || b.dataset.mode === mode) return;
  mode = b.dataset.mode;
  picks = [];
  renderPicks();
});

$('#updRows').addEventListener('click', e => {
  const row = e.target.closest('.upd-row');
  // Un giocatore già scelto non si può più toccare.
  if (!row || row.disabled || picks.includes(row.dataset.id)) return;
  picks.push(row.dataset.id);
  renderPicks();
});

$('#btnResetPicks').addEventListener('click', () => {
  picks = [];
  renderPicks();
});

$('#btnSaveRound').addEventListener('click', () => {
  if (!picks.length || (mode !== 'classic' && picks.length < MODES[mode].winners)) {
    toast(mode === 'classic' ? 'Tocca chi è arrivato primo' : mode === 'team' ? 'Scegli i 2 vincitori' : 'Tocca il vincitore');
    return;
  }
  const deltas = Object.fromEntries(state.players.map(p => [p.id, 0]));
  picks.forEach((id, i) => { deltas[id] = pickPoints(i); });
  const round = { id: uid(), ts: Date.now(), type: 'round', mode, deltas };
  closeSheet('#sheetUpdate');
  go('ranking');
  change(s => { s.history.push(round); });
  toast('Round salvato ✓');
});

/* ================== Modifica ================== */

function renderEdit() {
  $('#titleInput').value = state.title;
  $('#winPointsInput').value = winPoints();
  const t = totals();
  $('#editPlayers').innerHTML = state.players.map(p => `
    <div class="card edit-player" data-id="${p.id}">
      <button class="av-btn" data-act="avatar" aria-label="Cambia avatar">
        ${avatarHTML(p)}
        <span class="badge"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></span>
      </button>
      <div class="edit-fields">
        <input type="text" data-field="name" value="${esc(p.name)}" maxlength="24" autocomplete="off" aria-label="Nome">
        <input type="text" class="num-input" data-field="points" inputmode="numeric" value="${t[p.id]}" aria-label="Punti">
      </div>
    </div>`).join('');
}

$('#titleInput').addEventListener('change', e => {
  const title = e.target.value.trim() || 'Classifica';
  change(s => { s.title = title; });
});

$('#winPointsInput').addEventListener('change', e => {
  const n = parseInt(e.target.value.replace(/\D/g, ''), 10);
  if (!(n > 0) || n === winPoints()) { e.target.value = winPoints(); return; }
  change(s => { s.winPoints = n; });
  toast(`Vittoria singola e a squadre: ${n} pt`);
});

$('#editPlayers').addEventListener('change', e => {
  const card = e.target.closest('[data-id]');
  const id = card.dataset.id;
  const p = state.players.find(x => x.id === id);
  if (e.target.dataset.field === 'name') {
    const name = e.target.value.trim() || p.name;
    change(s => { s.players.find(x => x.id === id).name = name; });
    toast('Nome aggiornato');
  }
  if (e.target.dataset.field === 'points') {
    const wanted = parseInt(e.target.value.replace(/[^\d-]/g, ''), 10);
    const current = totals()[p.id];
    if (!Number.isFinite(wanted) || wanted === current) { e.target.value = current; return; }
    // La modifica diretta diventa una "correzione" nello storico, così le statistiche restano coerenti.
    const adjust = { id: uid(), ts: Date.now(), type: 'adjust', deltas: { [id]: wanted - current } };
    change(s => { s.history.push(adjust); });
    toast(`Punti di ${p.name} impostati a ${fmt(wanted)}`);
  }
});

$('#editPlayers').addEventListener('click', e => {
  const btn = e.target.closest('[data-act="avatar"]');
  if (btn) openAvatar(btn.closest('[data-id]').dataset.id);
});

$('#btnReset').addEventListener('click', () => {
  if (!confirm('Azzerare tutti i punteggi e lo storico? Nomi e avatar restano.')) return;
  change(s => { s.history = []; });
  toast('Classifica azzerata');
});

$('#btnExport').addEventListener('click', async () => {
  const name = `classifica-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify(state, null, 2)], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Backup classifica' }); } catch { /* annullato */ }
    return;
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#btnImport').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!isValidState(data)) throw new Error();
    if (!confirm('Sostituire i dati attuali con il backup?')) return;
    change(() => structuredClone(data));
    toast('Backup importato');
  } catch {
    toast('File di backup non valido');
  }
});

/* ================== Avatar ================== */

let avatarFor = null;

function openAvatar(id) {
  avatarFor = id;
  renderAvatarSheet();
  openSheet('#sheetAvatar');
}

function renderAvatarSheet() {
  const p = state.players.find(x => x.id === avatarFor);
  $('#avTitle').textContent = p.name;
  $('#avPreview').innerHTML = avatarHTML(p);
  $('#emojiGrid').innerHTML = EMOJIS.map(e =>
    `<button data-emoji="${e}" class="${!p.photo && p.emoji === e ? 'sel' : ''}">${e}</button>`).join('');
  $('#colorRow').innerHTML = COLORS.map(c =>
    `<button data-color="${c}" style="--c:${c}" class="${p.color === c ? 'sel' : ''}" aria-label="Colore ${c}"></button>`).join('');
}

function updateAvatar(patch) {
  const id = avatarFor;
  change(s => { Object.assign(s.players.find(x => x.id === id), patch); });
  renderAvatarSheet();
}

$('#emojiGrid').addEventListener('click', e => {
  const b = e.target.closest('[data-emoji]');
  if (b) updateAvatar({ emoji: b.dataset.emoji, photo: null });
});
$('#colorRow').addEventListener('click', e => {
  const b = e.target.closest('[data-color]');
  if (b) updateAvatar({ color: b.dataset.color });
});
$('#avFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    updateAvatar({ photo: await resizeImage(file, 240) });
  } catch {
    toast('Impossibile leggere la foto');
  }
});

// Ritaglia al centro e riduce la foto, così occupa pochi KB in memoria.
async function resizeImage(file, size) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const m = Math.min(img.naturalWidth, img.naturalHeight);
    const c = Object.assign(document.createElement('canvas'), { width: size, height: size });
    c.getContext('2d').drawImage(img, (img.naturalWidth - m) / 2, (img.naturalHeight - m) / 2, m, m, 0, 0, size, size);
    return c.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ================== Condividi ================== */

function shareText() {
  const lines = standings().map(p => `${MEDALS[p.rank - 1] || p.rank + '.'} ${p.name} — ${fmt(p.points)} pt`);
  return `🏆 ${state.title}\n${lines.join('\n')}\n\n${rounds().length} round · ${new Date().toLocaleDateString('it-IT')}`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

let shareBlob = null;

async function renderShareImage() {
  const W = 1080, H = 1350;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = c.getContext('2d');
  const SANS = '-apple-system, "SF Pro Rounded", system-ui, sans-serif';
  const TITLE = 'Fredoka, -apple-system, system-ui, sans-serif';
  await document.fonts?.load?.('700 96px Fredoka').catch(() => {});

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#2f6bea'); bg.addColorStop(.5, '#5b8ff5'); bg.addColorStop(1, '#a9c8ff');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // raggi di luce
  ctx.save(); ctx.translate(W / 2, -100); ctx.fillStyle = 'rgba(255,255,255,.07)';
  for (let a = 0; a < 360; a += 14) {
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.arc(0, 0, 2000, a * Math.PI / 180, (a + 6) * Math.PI / 180); ctx.fill();
  }
  ctx.restore();

  // card
  const cx = 70, cy = 170, cw = W - 140, ch = H - 230;
  ctx.save();
  ctx.shadowColor = 'rgba(25, 60, 150,.35)'; ctx.shadowBlur = 60; ctx.shadowOffsetY = 20;
  roundRect(ctx, cx, cy, cw, ch, 56); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.restore();

  // medaglia
  ctx.save();
  ctx.beginPath(); ctx.arc(W / 2, cy, 86, 0, Math.PI * 2);
  const mg = ctx.createLinearGradient(W / 2 - 80, cy - 80, W / 2 + 80, cy + 80);
  mg.addColorStop(0, '#2fd1b5'); mg.addColorStop(1, '#2563eb');
  ctx.fillStyle = mg; ctx.fill();
  ctx.lineWidth = 12; ctx.strokeStyle = '#f5b82e'; ctx.stroke();
  ctx.font = '84px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('🏆', W / 2, cy + 6);
  ctx.restore();

  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#16213e';
  ctx.font = `700 92px ${TITLE}`;
  ctx.fillStyle = '#2563eb';
  ctx.fillText('CLASSIFICA', W / 2, cy + 200);
  ctx.fillStyle = '#16213e';
  ctx.font = `800 46px ${SANS}`;
  ctx.fillText(state.title, W / 2, cy + 270, cw - 80);
  ctx.fillStyle = '#e3e9f4'; ctx.fillRect(cx + 80, cy + 310, cw - 160, 3);
  ctx.fillStyle = '#74809a'; ctx.font = `500 34px ${SANS}`;
  ctx.fillText(`${rounds().length} round · ${new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}`, W / 2, cy + 375);

  const list = standings();
  const imgs = await Promise.all(list.map(async p => {
    if (!p.photo) return null;
    const im = new Image(); im.src = p.photo;
    try { await im.decode(); return im; } catch { return null; }
  }));

  let y = cy + 410;
  list.forEach((p, i) => {
    const first = i === 0;
    const rh = first ? 170 : 140;
    const rx = first ? cx - 30 : cx + 40;
    const rw = first ? cw + 60 : cw - 80;
    ctx.save();
    if (first) {
      ctx.shadowColor = 'rgba(37, 99, 235,.5)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 14;
      const g = ctx.createLinearGradient(rx, 0, rx + rw, 0);
      g.addColorStop(0, '#6aa6ff'); g.addColorStop(1, '#2e6ae6');
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = '#f1f5fd';
    }
    roundRect(ctx, rx, y, rw, rh, 36); ctx.fill();
    ctx.restore();

    const mid = y + rh / 2;
    const ink = first ? '#fff' : '#16213e';
    ctx.fillStyle = ink; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.font = `900 ${first ? 62 : 50}px ${SANS}`;
    ctx.fillText(String(p.rank), rx + (first ? 80 : 60), mid);

    const ar = first ? 56 : 46, ax = rx + (first ? 200 : 160);
    ctx.save();
    ctx.beginPath(); ctx.arc(ax, mid, ar + 6, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.beginPath(); ctx.arc(ax, mid, ar, 0, Math.PI * 2); ctx.fillStyle = p.color; ctx.fill();
    if (imgs[i]) { ctx.clip(); ctx.drawImage(imgs[i], ax - ar, mid - ar, ar * 2, ar * 2); }
    else {
      ctx.font = `${ar * 1.15}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      ctx.fillText(p.emoji, ax, mid + 4);
    }
    ctx.restore();
    if (first) {
      ctx.font = '54px "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('👑', ax, mid - ar - 14);
    }

    ctx.fillStyle = ink; ctx.textAlign = 'left';
    ctx.font = `${first ? 700 : 600} ${first ? 52 : 44}px ${SANS}`;
    ctx.fillText(p.name, ax + ar + 34, mid, rw - (ax - rx) - ar - 300);
    ctx.textAlign = 'right';
    ctx.font = `900 ${first ? 76 : 54}px ${SANS}`;
    ctx.fillText(fmt(p.points), rx + rw - 44, mid + 2);

    y += rh + 26;
  });

  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = `600 30px ${SANS}`;
  ctx.fillText('Classifica · aggiornata il ' + new Date().toLocaleDateString('it-IT'), W / 2, H - 26);

  shareBlob = await new Promise(r => c.toBlob(r, 'image/png'));
  const img = $('#shareImg');
  if (img.src) URL.revokeObjectURL(img.src);
  img.src = URL.createObjectURL(shareBlob);
}

$('#btnShareImg').addEventListener('click', async () => {
  if (!shareBlob) await renderShareImage();
  const file = new File([shareBlob], 'classifica.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: state.title }); } catch { /* annullato */ }
  } else {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: 'classifica.png' });
    a.click();
    toast('Immagine scaricata');
  }
});

$('#btnShareText').addEventListener('click', async () => {
  if (navigator.share) {
    try { await navigator.share({ title: state.title, text: shareText() }); } catch { /* annullato */ }
  } else {
    copyText();
  }
});

async function copyText() {
  try {
    await navigator.clipboard.writeText(shareText());
    toast('Testo copiato');
  } catch {
    toast('Copia non disponibile');
  }
}
$('#btnCopy').addEventListener('click', copyText);

/* ================== Navigazione e sheet ================== */

let current = 'ranking';

function go(view) {
  current = view;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
  document.querySelectorAll('.tab[data-go]').forEach(t => t.classList.toggle('active', t.dataset.go === view));
  window.scrollTo(0, 0);
  if (view === 'share') renderShareImage();
}

document.querySelectorAll('.tab[data-go]').forEach(t => t.addEventListener('click', () => go(t.dataset.go)));
$('#btnUpdate').addEventListener('click', openUpdate);

function openSheet(sel) {
  const s = $(sel);
  s.classList.add('open');
  s.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}
function closeSheet(sel) {
  const s = $(sel);
  s.classList.remove('open');
  s.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}
document.querySelectorAll('.sheet').forEach(s =>
  s.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet('#' + s.id); }));

function renderAll() {
  renderRanking();
  renderStats();
  if (!document.activeElement?.closest?.('#view-edit')) renderEdit();
  shareBlob = null;
  if (current === 'share') renderShareImage();
}

renderAll();
$('#appVersion').textContent = `Versione ${APP_VERSION} · ${CLOUD ? 'dati condivisi online' : 'dati solo su questo telefono'}`;

if (CLOUD) {
  if (pin) pull();
  else askPin('Inserisci il PIN condiviso per vedere e aggiornare la classifica');
  // Ricontrolla il server quando riapri l'app e ogni 30 secondi mentre è aperta.
  const refresh = () => { if (document.visibilityState === 'visible') pull(); };
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('online', refresh);
  setInterval(refresh, 30000);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {}));
}
