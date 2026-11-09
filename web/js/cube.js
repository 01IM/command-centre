// 3x3 scramble + timer.
// Scrambles follow WCA notation (20 moves, no redundant moves). Official WCA scrambles are
// random-state (TNoodle); this is a random-move scramble, which is fine for practice.
import { kvGet, kvSet } from './store.js';

const FACES = ['U', 'D', 'L', 'R', 'F', 'B'];
const AXIS = { U: 0, D: 0, L: 1, R: 1, F: 2, B: 2 };
const SUFFIX = ['', "'", '2'];

export function scramble(length = 20) {
  const moves = [];
  while (moves.length < length) {
    const f = FACES[Math.floor(Math.random() * 6)];
    const last = moves[moves.length - 1]?.[0];
    const prev = moves[moves.length - 2]?.[0];
    if (f === last) continue;
    if (last && prev && AXIS[f] === AXIS[last] && AXIS[f] === AXIS[prev]) continue; // e.g. R L R
    if (last && AXIS[f] === AXIS[last] && f === prev) continue;
    moves.push(f + SUFFIX[Math.floor(Math.random() * 3)]);
  }
  return moves.join(' ');
}

// ---------- cube simulation for the preview net (white top, green front) ----------
const COLORS = { U: '#f5f3ee', D: '#f2c94c', F: '#2f9e5b', B: '#2f6fd6', R: '#d64545', L: '#ef8a2f' };
const NORMAL_FACE = (n) => n[1] === 1 ? 'U' : n[1] === -1 ? 'D' : n[2] === 1 ? 'F' : n[2] === -1 ? 'B' : n[0] === 1 ? 'R' : 'L';

function solved() {
  const s = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
    const p = [x, y, z];
    for (let a = 0; a < 3; a++) if (p[a] !== 0) { const n = [0, 0, 0]; n[a] = p[a]; s.push({ p: [...p], n, c: COLORS[NORMAL_FACE(n)] }); }
  }
  return s;
}
const MOVE = { R: [0, 1], L: [0, -1], U: [1, 1], D: [1, -1], F: [2, 1], B: [2, -1] };
function rot(v, axis, sign) { // quarter turn clockwise as seen from the face
  const [x, y, z] = v;
  if (axis === 0) return sign > 0 ? [x, z, -y] : [x, -z, y];
  if (axis === 1) return sign > 0 ? [-z, y, x] : [z, y, -x];
  return sign > 0 ? [y, -x, z] : [-y, x, z];
}
function apply(stickers, alg) {
  for (const m of alg.split(' ').filter(Boolean)) {
    const [axis, layer] = MOVE[m[0]];
    const turns = m[1] === '2' ? 2 : m[1] === "'" ? 3 : 1;
    for (let t = 0; t < turns; t++) for (const s of stickers) if (s.p[axis] === layer) { s.p = rot(s.p, axis, layer); s.n = rot(s.n, axis, layer); }
  }
  return stickers;
}
const OFFSET = { U: [3, 0], L: [0, 3], F: [3, 3], R: [6, 3], B: [9, 3], D: [3, 6] };
function cell(face, [x, y, z]) {
  switch (face) {
    case 'U': return [x + 1, z + 1];
    case 'D': return [x + 1, 1 - z];
    case 'F': return [x + 1, 1 - y];
    case 'B': return [1 - x, 1 - y];
    case 'R': return [1 - z, 1 - y];
    default: return [z + 1, 1 - y]; // L
  }
}
export function netSVG(alg, size = 11) {
  const st = apply(solved(), alg);
  const rects = st.map((s) => {
    const f = NORMAL_FACE(s.n); const [c, r] = cell(f, s.p); const [ox, oy] = OFFSET[f];
    return `<rect x="${(ox + c) * size + 1}" y="${(oy + r) * size + 1}" width="${size - 2}" height="${size - 2}" rx="1.5" fill="${s.c}"/>`;
  }).join('');
  return `<svg class="cube-net" viewBox="0 0 ${12 * size} ${9 * size}" role="img" aria-label="Scrambled cube preview">${rects}</svg>`;
}

// ---------- stats ----------
const DNF = Infinity;
const value = (s) => (s.dnf ? DNF : s.ms + (s.plus2 ? 2000 : 0));
export function fmt(ms) {
  if (ms === DNF) return 'DNF';
  if (ms == null || Number.isNaN(ms)) return '—';
  const total = ms / 1000;
  const m = Math.floor(total / 60);
  const s = (total - m * 60).toFixed(2);
  return m ? `${m}:${s.padStart(5, '0')}` : s;
}
export function average(solves, n) { // WCA-style: drop best and worst, mean of the rest
  if (solves.length < n) return null;
  const v = solves.slice(0, n).map(value).sort((a, b) => a - b);
  const trimmed = v.slice(1, -1);
  if (trimmed.includes(DNF)) return DNF;
  return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
}

// ---------- UI ----------
export async function mountCube(root) {
  let solves = await kvGet('cube:solves', []); // newest first
  let current = scramble();
  let phase = 'idle'; // idle | holding | ready | running
  let t0 = 0, holdTimer = null, raf = null;
  let open = await kvGet('cube:open', true);

  root.innerHTML = `<div class="cube-bar ${open ? '' : 'collapsed'}">
    <button class="cube-toggle" title="Show / hide cube timer" aria-label="Toggle cube timer">
      <svg viewBox="0 0 24 24"><path d="M12 2 3 7v10l9 5 9-5V7z M3 7l9 5 9-5 M12 12v10"/></svg>
    </button>
    <div class="cube-scramble"><small>3×3 scramble</small><code data-scr></code></div>
    <div class="cube-net-wrap" data-net></div>
    <button class="cube-timer" data-timer aria-label="Timer: hold space or press and hold here, release to start, tap to stop">0.00</button>
    <div class="cube-stats" data-stats></div>
    <button class="icon-btn" data-new title="New scramble">↻</button>
  </div>`;
  const bar = root.firstElementChild;
  const $ = (s) => bar.querySelector(s);
  const timerEl = $('[data-timer]');

  const draw = () => {
    $('[data-scr]').textContent = current;
    $('[data-net]').innerHTML = netSVG(current);
    const last = solves[0];
    const best = solves.length ? Math.min(...solves.map(value)) : null;
    $('[data-stats]').innerHTML = `
      <div><small>ao5</small><b>${fmt(average(solves, 5))}</b></div>
      <div><small>ao12</small><b>${fmt(average(solves, 12))}</b></div>
      <div><small>best</small><b>${fmt(best)}</b></div>
      <div class="last">${last ? `<small>last ${fmt(value(last))}</small><span><button data-p2 class="${last.plus2 ? 'on' : ''}">+2</button><button data-dnf class="${last.dnf ? 'on' : ''}">DNF</button><button data-del title="Delete last solve">✕</button></span>` : `<small>${solves.length} solves</small>`}</div>`;
  };
  const save = () => kvSet('cube:solves', solves.slice(0, 1000));

  const setPhase = (p) => { phase = p; timerEl.dataset.phase = p; };
  const loop = () => { timerEl.textContent = fmt(performance.now() - t0).replace(/\d$/, ''); raf = requestAnimationFrame(loop); };

  function press() {
    if (phase === 'running') { // stop
      cancelAnimationFrame(raf);
      const ms = Math.round(performance.now() - t0);
      timerEl.textContent = fmt(ms);
      solves.unshift({ ms, scramble: current, at: Date.now() });
      save(); current = scramble(); setPhase('stopped'); draw();
      return;
    }
    if (phase === 'idle' || phase === 'stopped') {
      setPhase('holding');
      holdTimer = setTimeout(() => { if (phase === 'holding') { setPhase('ready'); timerEl.textContent = '0.00'; } }, 300);
    }
  }
  function release() {
    clearTimeout(holdTimer);
    if (phase === 'ready') { setPhase('running'); t0 = performance.now(); loop(); }
    else if (phase === 'holding') setPhase('idle');
    else if (phase === 'stopped') setPhase('idle');
  }

  const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.querySelector('dialog[open]');
  document.addEventListener('keydown', (e) => {
    if (!open || typing()) return;
    if (phase === 'running') { e.preventDefault(); press(); return; }
    if (e.code === 'Space' && !e.repeat) { e.preventDefault(); press(); }
  });
  document.addEventListener('keyup', (e) => { if (!open || typing()) return; if (e.code === 'Space' || phase === 'stopped') { e.preventDefault(); release(); } });
  timerEl.addEventListener('pointerdown', (e) => { e.preventDefault(); press(); });
  timerEl.addEventListener('pointerup', (e) => { e.preventDefault(); release(); });
  timerEl.addEventListener('pointerleave', () => { if (phase === 'holding' || phase === 'ready') { clearTimeout(holdTimer); setPhase('idle'); } });

  bar.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b || b === timerEl) return;
    if (b.classList.contains('cube-toggle')) { open = !open; bar.classList.toggle('collapsed', !open); await kvSet('cube:open', open); return; }
    if (b.dataset.new !== undefined) { current = scramble(); draw(); }
    if (b.dataset.p2 !== undefined && solves[0]) { solves[0].plus2 = !solves[0].plus2; solves[0].dnf = false; save(); draw(); }
    if (b.dataset.dnf !== undefined && solves[0]) { solves[0].dnf = !solves[0].dnf; solves[0].plus2 = false; save(); draw(); }
    if (b.dataset.del !== undefined && solves[0]) { solves.shift(); save(); timerEl.textContent = '0.00'; draw(); }
    b.blur();
  });
  draw();
}
