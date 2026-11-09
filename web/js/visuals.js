// Animated weather icons, moon phase maths + drawing, and mini analog clocks. All SVG, no images.

// ---------- weather icons ----------
const SUN = (cx = 32, cy = 32, r = 10) => `<g class="wx-sun"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#f2c14e"/>
  <g class="wx-rays" stroke="#f2c14e" stroke-width="2.4" stroke-linecap="round" style="transform-origin:${cx}px ${cy}px">
  ${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => { const rad = (a * Math.PI) / 180; const r1 = r + 5, r2 = r + 10; return `<line x1="${(cx + r1 * Math.cos(rad)).toFixed(1)}" y1="${(cy + r1 * Math.sin(rad)).toFixed(1)}" x2="${(cx + r2 * Math.cos(rad)).toFixed(1)}" y2="${(cy + r2 * Math.sin(rad)).toFixed(1)}"/>`; }).join('')}
  </g></g>`;
const MOON = (cx = 30, cy = 30) => `<g class="wx-moonicon"><path d="M${cx + 8} ${cy - 13}a14 14 0 1 0 8 20 11 11 0 1 1 -8 -20z" fill="#d9d4c7"/></g>`;
const CLOUD = (x = 0, y = 0, fill = '#c9cdd4', cls = 'wx-cloud') => `<g transform="translate(${x} ${y})"><g class="${cls}"><path d="M18 46h28a10 10 0 0 0 0-20 14 14 0 0 0-27-3A10 10 0 0 0 18 46z" fill="${fill}"/></g></g>`;
const DROPS = (n = 3, cls = 'wx-rain') => `<g class="${cls}" stroke="#7ea6d8" stroke-width="2.2" stroke-linecap="round">${Array.from({ length: n }, (_, i) => `<line x1="${24 + i * 9}" y1="50" x2="${21 + i * 9}" y2="57" style="animation-delay:${i * 0.25}s"/>`).join('')}</g>`;
const FLAKES = () => `<g class="wx-snow" fill="#e8eef6">${[0, 1, 2].map((i) => `<circle cx="${24 + i * 9}" cy="53" r="2" style="animation-delay:${i * 0.35}s"/>`).join('')}</g>`;
const BOLT = () => `<path class="wx-bolt" d="M34 44l-6 10h5l-3 9 9-12h-5l3-7z" fill="#f2c14e"/>`;
const FOG = () => `<g class="wx-fog" stroke="#a8a49b" stroke-width="2.4" stroke-linecap="round"><line x1="14" y1="50" x2="50" y2="50"/><line x1="18" y1="56" x2="46" y2="56" style="animation-delay:.6s"/></g>`;

export function wxIcon(code, isDay = true, size = 48) {
  let inner;
  const celestial = isDay ? SUN(24, 24, 9) : MOON(26, 24);
  if (code === 0) inner = isDay ? SUN() : MOON(30, 32);
  else if (code === 1 || code === 2) inner = celestial + CLOUD(4, 4, code === 1 ? '#d5d8de' : '#c9cdd4');
  else if (code === 3) inner = CLOUD(-4, -2, '#8f949c', 'wx-cloud wx-cloud-back') + CLOUD(4, 4, '#c3c7ce');
  else if (code === 45 || code === 48) inner = CLOUD(0, -4, '#a9adb4') + FOG();
  else if ([51, 53, 55, 56, 57].includes(code)) inner = CLOUD(0, -6, '#b9bdc4') + DROPS(2);
  else if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) inner = CLOUD(0, -6, '#9aa0a8') + DROPS(code === 65 || code === 82 ? 4 : 3);
  else if ([71, 73, 75, 77, 85, 86].includes(code)) inner = CLOUD(0, -6, '#c9cdd4') + FLAKES();
  else if ([95, 96, 99].includes(code)) inner = CLOUD(0, -8, '#7d838c') + BOLT() + DROPS(2);
  else inner = CLOUD(0, 0);
  return `<svg class="wx-svg" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">${inner}</svg>`;
}

// ---------- moon ----------
// Exact phase times from Jean Meeus, "Astronomical Algorithms" ch. 49 (accurate to a few minutes).
const rad = (d) => (d * Math.PI) / 180;
function phaseTime(k) { // k = integer (+0 new, +.25 first quarter, +.5 full, +.75 last quarter)
  const T = k / 1236.85, T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T2 - 0.00000015 * T3 + 0.00000000073 * T4;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const M = rad(2.5534 + 29.1053567 * k - 0.0000014 * T2 - 0.00000011 * T3);
  const Mp = rad(201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4);
  const F = rad(160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4);
  const O = rad(124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3);
  const sin = Math.sin, cos = Math.cos, frac = ((k % 1) + 1) % 1;
  let c;
  if (frac === 0 || frac === 0.5) {
    const n = frac === 0;
    c = (n ? -0.4072 : -0.40614) * sin(Mp) + (n ? 0.17241 : 0.17302) * E * sin(M) + (n ? 0.01608 : 0.01614) * sin(2 * Mp)
      + (n ? 0.01039 : 0.01043) * sin(2 * F) + (n ? 0.00739 : 0.00734) * E * sin(Mp - M) - (n ? 0.00514 : 0.00515) * E * sin(Mp + M)
      + (n ? 0.00208 : 0.00209) * E * E * sin(2 * M) - 0.00111 * sin(Mp - 2 * F) - 0.00057 * sin(Mp + 2 * F) + 0.00056 * E * sin(2 * Mp + M)
      - 0.00042 * sin(3 * Mp) + 0.00042 * E * sin(M + 2 * F) + 0.00038 * E * sin(M - 2 * F) - 0.00024 * E * sin(2 * Mp - M) - 0.00017 * sin(O);
  } else {
    c = -0.62801 * sin(Mp) + 0.17172 * E * sin(M) - 0.01183 * E * sin(Mp + M) + 0.00862 * sin(2 * Mp) + 0.00804 * sin(2 * F)
      + 0.00454 * E * sin(Mp - M) + 0.00204 * E * E * sin(2 * M) - 0.0018 * sin(Mp - 2 * F) - 0.0007 * sin(Mp + 2 * F) - 0.0004 * sin(3 * Mp)
      - 0.00034 * E * sin(2 * Mp - M) + 0.00032 * E * sin(M + 2 * F) + 0.00032 * E * sin(M - 2 * F) - 0.00028 * E * E * sin(Mp + 2 * M)
      + 0.00027 * E * sin(2 * Mp + M) - 0.00017 * sin(O);
    const W = 0.00306 - 0.00038 * E * cos(M) + 0.00026 * cos(Mp) - 0.00002 * cos(Mp - M) + 0.00002 * cos(Mp + M) + 0.00002 * cos(2 * F);
    c += frac === 0.25 ? W : -W;
  }
  return (jde + c - 2440587.5) * 86400000 - 69000; // TT → UTC (ΔT ≈ 69 s)
}
export function moonInfo(date = new Date()) {
  const now = date.getTime();
  const years = (now - Date.UTC(2000, 0, 1)) / (365.25 * 86400000);
  const base = Math.floor(years * 12.3685) - 2;
  const events = [];
  for (let k = base; k < base + 5; k++) for (const q of [0, 0.25, 0.5, 0.75]) events.push({ q, t: phaseTime(k + q) });
  events.sort((a, b) => a.t - b.t);
  const i = events.findIndex((e) => e.t > now);
  const prev = events[i - 1], next = events[i];
  // phase 0..1 (0 = new, .5 = full), interpolated between the exact quarter instants
  const phase = (prev.q + 0.25 * ((now - prev.t) / (next.t - prev.t))) % 1;
  const illum = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  const name = names[Math.floor((phase * 8 + 0.5) % 8)];
  const upcoming = (q) => new Date(events.find((e) => e.t > now && e.q === q).t);
  const lastNew = [...events].reverse().find((e) => e.t <= now && e.q === 0);
  return { phase, illum, name, age: lastNew ? (now - lastNew.t) / 86400000 : 0, nextFull: upcoming(0.5), nextNew: upcoming(0) };
}
export function moonSVG(phase, size = 56) {
  // Lit part = semicircle on the lit side + an ellipse (terminator) that grows/shrinks.
  const r = 24, c = 28;
  const waxing = phase < 0.5;
  const k = Math.cos(2 * Math.PI * phase); // 1 new → -1 full
  const rx = Math.abs(k) * r;
  const sweepOuter = waxing ? 1 : 0;
  const sweepInner = (waxing ? k > 0 : k < 0) ? 0 : 1;
  const d = `M${c} ${c - r} A${r} ${r} 0 0 ${sweepOuter} ${c} ${c + r} A${rx.toFixed(2)} ${r} 0 0 ${sweepInner} ${c} ${c - r}Z`;
  return `<svg class="moon-svg" width="${size}" height="${size}" viewBox="0 0 56 56" aria-hidden="true">
    <defs><radialGradient id="mg" cx="40%" cy="38%" r="70%"><stop offset="0" stop-color="#f4efe2"/><stop offset="1" stop-color="#cfc8b6"/></radialGradient></defs>
    <circle cx="${c}" cy="${c}" r="${r}" fill="#34343a"/>
    <path d="${d}" fill="url(#mg)"/>
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(255,255,255,.08)"/></svg>`;
}

// ---------- mini analog clock ----------
export function clockFace(size = 40) {
  return `<svg class="mini-clock" width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="20" r="18.5" class="face"/>
    ${Array.from({ length: 12 }, (_, i) => { const a = (i * 30 * Math.PI) / 180; return `<line x1="${20 + 15 * Math.sin(a)}" y1="${20 - 15 * Math.cos(a)}" x2="${20 + 16.6 * Math.sin(a)}" y2="${20 - 16.6 * Math.cos(a)}" class="tick"/>`; }).join('')}
    <line x1="20" y1="20" x2="20" y2="11" class="hand h" />
    <line x1="20" y1="20" x2="20" y2="7" class="hand m" />
    <circle cx="20" cy="20" r="1.6" class="pin"/></svg>`;
}
export function zoneTime(tz, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true, weekday: 'short' }).formatToParts(now).map((p) => [p.type, p.value]));
  const h24 = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now));
  const local = now.toLocaleDateString('en-US', { weekday: 'short' });
  return { text: `${parts.hour}:${parts.minute} ${parts.dayPeriod.toLowerCase()}`, h: h24, m: Number(parts.minute), dayDiff: parts.weekday !== local ? parts.weekday : '' };
}
