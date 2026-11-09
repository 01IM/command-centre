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
const SYNODIC = 29.530588853;
const KNOWN_NEW = Date.UTC(2000, 0, 6, 18, 14); // reference new moon
export function moonInfo(date = new Date()) {
  const days = (date.getTime() - KNOWN_NEW) / 86400000;
  const age = ((days % SYNODIC) + SYNODIC) % SYNODIC; // 0..29.53
  const phase = age / SYNODIC; // 0 new, .5 full
  const illum = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  const name = names[Math.floor(((phase * 8) + 0.5) % 8)];
  const nextIn = (target) => { let d = (target * SYNODIC) - age; if (d <= 0.2) d += SYNODIC; return new Date(date.getTime() + d * 86400000); };
  return { age, phase, illum, name, nextFull: nextIn(0.5), nextNew: nextIn(1) };
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
