'use strict';

/* ================== Dati ================== */

const STORE_KEY = 'classifica.v1';
const APP_VERSION = 6;
const COLORS = ['#8b7cf6', '#f472b6', '#38bdf8', '#f59e0b', '#34d399', '#fb7185', '#a3e635', '#94a3b8'];
const EMOJIS = ['🦊', '🐼', '🐯', '🐸', '🐨', '🦁', '🐵', '🐙', '🦄', '🐶', '🐱', '🐻', '🐰', '🐲', '🐧', '🦉',
  '👑', '🚀', '🔥', '⭐️', '⚽️', '🏀', '🎯', '🎲', '🎸', '🍕', '🌵', '👻', '🤖', '😎', '🥷', '🧙'];

const $ = (sel, el = document) => el.querySelector(sel);
const uid = () => Math.random().toString(36).slice(2, 10);

function defaultState() {
  return {
    title: 'La nostra sfida',
    players: [
      { id: uid(), name: 'Giocatore 1', emoji: '🦊', color: COLORS[0], photo: null },
      { id: uid(), name: 'Giocatore 2', emoji: '🐼', color: COLORS[1], photo: null },
      { id: uid(), name: 'Giocatore 3', emoji: '🐯', color: COLORS[2], photo: null },
      { id: uid(), name: 'Giocatore 4', emoji: '🐸', color: COLORS[3], photo: null },
    ],
    // Ogni voce: { id, ts, type: 'round' | 'adjust', deltas: { [playerId]: number } }
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

let state = load();

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    toast('Memoria piena: prova a usare foto più piccole');
  }
}

// Chiede al browser di non cancellare i dati in caso di poco spazio.
navigator.storage?.persist?.().catch(() => {});

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

function playerStats() {
  const rs = rounds();
  const t = totals();
  return state.players.map(p => {
    const vals = rs.filter(r => p.id in r.deltas).map(r => r.deltas[p.id]);
    const wins = rs.filter(r => {
      const max = Math.max(...Object.values(r.deltas));
      return max > 0 && r.deltas[p.id] === max;
    }).length;
    return {
      ...p,
      total: t[p.id],
      played: vals.length,
      wins,
      avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0,
      best: vals.length ? Math.max(...vals) : 0,
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
        <div class="pstat">
          ${avatarHTML(s)}
          <div>
            <div class="top"><span class="nm">${esc(s.name)}</span><span class="tot">${fmt(s.total)} pt</span></div>
            <div class="mini">
              <span>Vittorie <b>${s.wins}</b></span>
              <span>Media <b>${fmt(s.avg)}</b></span>
              <span>Record <b>${fmt(s.best)}</b></span>
            </div>
            <div class="bar" style="--c:${s.color}"><i style="width:${Math.max(0, s.total) / maxTotal * 100}%"></i></div>
          </div>
        </div>`).join('')}
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
        <div class="when"><b>${no ? `Round ${no}` : 'Correzione manuale'}</b> · ${dateFmt(h.ts)}</div>
        <div class="chips">${Object.entries(h.deltas).filter(([id, d]) => byId[id] && d !== 0).map(([id, d]) =>
          `<span class="chip ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}">${esc(byId[id].name)} ${signed(d)}</span>`).join('')}</div>
      </div>
      <button class="icon-btn" data-del="${h.id}" aria-label="Elimina">
        <svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
      </button>
    </div>`).join('');
}

$('#statsBody').addEventListener('click', e => {
  const btn = e.target.closest('[data-del]');
  if (!btn) return;
  if (!confirm('Eliminare questa voce? I punti verranno ricalcolati.')) return;
  state.history = state.history.filter(h => h.id !== btn.dataset.del);
  save();
  renderAll();
  toast('Voce eliminata');
});

/* ================== Aggiorna punti ================== */

let draft = {};

function openUpdate() {
  draft = Object.fromEntries(state.players.map(p => [p.id, 0]));
  const t = totals();
  $('#updRows').innerHTML = standings().map(p => `
    <div class="upd-row" data-id="${p.id}">
      ${avatarHTML(p)}
      <div style="min-width:0"><div class="nm">${esc(p.name)}</div><div class="cur">${fmt(t[p.id])} pt</div></div>
      <div class="stepper">
        <button class="sign" data-act="sign" aria-label="Cambia segno">±</button>
        <button data-act="dec" aria-label="Meno uno">−</button>
        <input class="num-input" inputmode="numeric" pattern="[0-9]*" value="0" aria-label="Punti per ${esc(p.name)}">
        <button data-act="inc" aria-label="Più uno">+</button>
      </div>
    </div>`).join('');
  openSheet('#sheetUpdate');
}

function setDraft(row, val) {
  const id = row.dataset.id;
  draft[id] = Number.isFinite(val) ? val : 0;
  const input = row.querySelector('.num-input');
  input.value = draft[id] > 0 ? '+' + draft[id] : draft[id];
  input.classList.toggle('pos', draft[id] > 0);
  input.classList.toggle('neg', draft[id] < 0);
}

$('#updRows').addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const row = btn.closest('.upd-row');
  const v = draft[row.dataset.id];
  if (btn.dataset.act === 'inc') setDraft(row, v + 1);
  if (btn.dataset.act === 'dec') setDraft(row, v - 1);
  if (btn.dataset.act === 'sign') setDraft(row, -v);
});
$('#updRows').addEventListener('focusin', e => {
  if (e.target.matches('.num-input')) {
    const row = e.target.closest('.upd-row');
    e.target.value = draft[row.dataset.id] ? Math.abs(draft[row.dataset.id]) : '';
  }
});
$('#updRows').addEventListener('focusout', e => {
  if (!e.target.matches('.num-input')) return;
  const row = e.target.closest('.upd-row');
  const typed = parseInt(e.target.value.replace(/[^\d]/g, ''), 10) || 0;
  // Il segno resta quello impostato con ±
  setDraft(row, draft[row.dataset.id] < 0 ? -typed : typed);
});
$('#updRows').addEventListener('keydown', e => {
  if (e.key === 'Enter') e.target.blur();
});

$('#btnSaveRound').addEventListener('click', () => {
  document.activeElement?.blur?.();
  if (Object.values(draft).every(v => v === 0)) {
    toast('Inserisci almeno un punteggio');
    return;
  }
  state.history.push({ id: uid(), ts: Date.now(), type: 'round', deltas: { ...draft } });
  save();
  closeSheet('#sheetUpdate');
  go('ranking');
  renderAll();
  toast('Round salvato ✓');
});

/* ================== Modifica ================== */

function renderEdit() {
  $('#titleInput').value = state.title;
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
  state.title = e.target.value.trim() || 'Classifica';
  save();
  renderAll();
});

$('#editPlayers').addEventListener('change', e => {
  const card = e.target.closest('[data-id]');
  const p = state.players.find(x => x.id === card.dataset.id);
  if (e.target.dataset.field === 'name') {
    p.name = e.target.value.trim() || p.name;
    save();
    renderAll();
    toast('Nome aggiornato');
  }
  if (e.target.dataset.field === 'points') {
    const wanted = parseInt(e.target.value.replace(/[^\d-]/g, ''), 10);
    const current = totals()[p.id];
    if (!Number.isFinite(wanted) || wanted === current) { e.target.value = current; return; }
    // La modifica diretta diventa una "correzione" nello storico, così le statistiche restano coerenti.
    state.history.push({ id: uid(), ts: Date.now(), type: 'adjust', deltas: { [p.id]: wanted - current } });
    save();
    renderAll();
    toast(`Punti di ${p.name} impostati a ${fmt(wanted)}`);
  }
});

$('#editPlayers').addEventListener('click', e => {
  const btn = e.target.closest('[data-act="avatar"]');
  if (btn) openAvatar(btn.closest('[data-id]').dataset.id);
});

$('#btnReset').addEventListener('click', () => {
  if (!confirm('Azzerare tutti i punteggi e lo storico? Nomi e avatar restano.')) return;
  state.history = [];
  save();
  renderAll();
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
    state = data;
    save();
    renderAll();
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

function updateAvatar(change) {
  const p = state.players.find(x => x.id === avatarFor);
  Object.assign(p, change);
  save();
  renderAvatarSheet();
  renderAll();
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
  const medals = ['🥇', '🥈', '🥉'];
  const lines = standings().map(p => `${medals[p.rank - 1] || p.rank + '.'} ${p.name} — ${fmt(p.points)} pt`);
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
$('#appVersion').textContent = `Versione ${APP_VERSION}`;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {}));
}
