// Small iCalendar (.ics) reader for Google Calendar's "secret address in iCal format".
// Handles time zones, all-day events, recurring events (RRULE), exceptions (EXDATE) and
// moved/edited occurrences (RECURRENCE-ID).

function unfold(text) { return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, ''); }
const unescapeText = (s) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function parseLine(line) {
  const i = line.indexOf(':'); if (i < 0) return null;
  const [name, ...paramParts] = line.slice(0, i).split(';');
  const params = Object.fromEntries(paramParts.map((p) => { const [k, v] = p.split('='); return [k.toUpperCase(), (v || '').replace(/"/g, '')]; }));
  return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}

// offset (ms) of a time zone at a given UTC instant
function tzOffset(utcMs, tz) {
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
  } catch { return -new Date(utcMs).getTimezoneOffset() * 60000; }
}
// wall-clock fields in tz -> UTC ms
function wallToUtc(w, tz) {
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  if (!tz) return new Date(w.y, w.m - 1, w.d, w.h, w.mi, w.s).getTime(); // floating time = local
  if (tz === 'UTC') return guess;
  let t = guess - tzOffset(guess, tz);
  t = guess - tzOffset(t, tz);
  return t;
}
function parseDate(prop) {
  const v = prop.value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const w = { y: +m[1], m: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) };
  const allDay = !m[4] || prop.params.VALUE === 'DATE';
  const tz = m[7] ? 'UTC' : prop.params.TZID || null;
  return { w, tz, allDay, utc: allDay ? new Date(w.y, w.m - 1, w.d).getTime() : wallToUtc(w, tz) };
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const addDaysW = (w, n) => { const d = new Date(Date.UTC(w.y, w.m - 1, w.d + n)); return { ...w, y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; };
const dow = (w) => new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay();
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function* expandRule(start, rule, windowEnd) {
  const r = Object.fromEntries(rule.split(';').map((p) => p.split('=')));
  const freq = r.FREQ, interval = +(r.INTERVAL || 1), count = r.COUNT ? +r.COUNT : Infinity;
  const until = r.UNTIL ? parseDate({ value: r.UNTIL, params: {} }).utc : Infinity;
  const byDay = r.BYDAY ? r.BYDAY.split(',') : null;
  const byMonthDay = r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : null;
  const toUtc = (w) => (start.allDay ? new Date(w.y, w.m - 1, w.d).getTime() : wallToUtc(w, start.tz));
  let n = 0, guard = 0;
  const emit = function* (w) {
    const t = toUtc(w);
    if (t < start.utc) return;
    if (t > until || n >= count || t > windowEnd) { n = Infinity; return; }
    n++; yield t;
  };
  if (freq === 'DAILY') {
    for (let w = start.w; n < count && guard++ < 40000; w = addDaysW(w, interval)) yield* emit(w);
  } else if (freq === 'WEEKLY') {
    const days = (byDay || [DAYS[dow(start.w)]]).map((d) => DAYS.indexOf(d.slice(-2))).sort();
    let weekStart = addDaysW(start.w, -dow(start.w));
    while (n < count && guard++ < 10000) {
      for (const d of days) { yield* emit(addDaysW(weekStart, d)); if (n === Infinity) return; }
      weekStart = addDaysW(weekStart, 7 * interval);
    }
  } else if (freq === 'MONTHLY' || freq === 'YEARLY') {
    let y = start.w.y, m = start.w.m;
    while (n < count && guard++ < 5000) {
      const dim = daysInMonth(y, m);
      let dates = [];
      if (byDay) {
        for (const spec of byDay) {
          const mm = spec.match(/^([+-]?\d+)?([A-Z]{2})$/); if (!mm) continue;
          const wd = DAYS.indexOf(mm[2]);
          const all = []; for (let d = 1; d <= dim; d++) if (dow({ y, m, d }) === wd) all.push(d);
          if (mm[1]) { const k = +mm[1]; const pick = k > 0 ? all[k - 1] : all[all.length + k]; if (pick) dates.push(pick); } else dates.push(...all);
        }
      } else if (byMonthDay) dates = byMonthDay.map((d) => (d < 0 ? dim + d + 1 : d)).filter((d) => d >= 1 && d <= dim);
      else if (start.w.d <= dim) dates = [start.w.d];
      if (freq === 'YEARLY' && m !== start.w.m && !r.BYMONTH) dates = [];
      for (const d of dates.sort((a, b) => a - b)) { yield* emit({ ...start.w, y, m, d }); if (n === Infinity) return; }
      if (freq === 'YEARLY') { if (r.BYMONTH) { m++; if (m > 12) { m = 1; y += interval; } } else y += interval; }
      else { m += interval; while (m > 12) { m -= 12; y++; } }
    }
  }
}

const JOIN_RE = [
  /https:\/\/[\w.-]*zoom\.us\/(j|my|w)\/[^\s"<>)\\]+/i,
  /https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"<>)\\]+/i,
  /https:\/\/teams\.live\.com\/meet\/[^\s"<>)\\]+/i,
  /https:\/\/meet\.google\.com\/[a-z-]+/i,
  /https:\/\/[\w.-]*webex\.com\/[^\s"<>)\\]+/i,
];
export function findJoin(text) {
  for (const re of JOIN_RE) { const m = (text || '').match(re); if (m) return m[0].replace(/&amp;/g, '&'); }
  return null;
}
export const platformOf = (url) => !url ? null : /zoom/.test(url) ? 'Zoom' : /teams/.test(url) ? 'Teams' : /meet\.google/.test(url) ? 'Meet' : /webex/.test(url) ? 'Webex' : 'Link';

export function parseICS(text, { from, to, calendarName = '' } = {}) {
  const lines = unfold(text).split('\n');
  const events = []; let cur = null; let calName = calendarName;
  for (const raw of lines) {
    const line = raw.trimEnd(); if (!line) continue;
    if (line === 'BEGIN:VEVENT') { cur = { exdates: new Set() }; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    const p = parseLine(line); if (!p) continue;
    if (!cur) { if (p.name === 'X-WR-CALNAME' && !calName) calName = unescapeText(p.value); continue; }
    switch (p.name) {
      case 'UID': cur.uid = p.value; break;
      case 'SUMMARY': cur.title = unescapeText(p.value); break;
      case 'LOCATION': cur.location = unescapeText(p.value); break;
      case 'DESCRIPTION': cur.description = unescapeText(p.value); break;
      case 'DTSTART': cur.start = parseDate(p); break;
      case 'DTEND': cur.end = parseDate(p); break;
      case 'DURATION': cur.duration = p.value; break;
      case 'RRULE': cur.rrule = p.value; break;
      case 'EXDATE': for (const v of p.value.split(',')) { const d = parseDate({ value: v, params: p.params }); if (d) cur.exdates.add(d.utc); } break;
      case 'RECURRENCE-ID': cur.recurrenceId = parseDate(p)?.utc; break;
      case 'STATUS': cur.status = p.value; break;
      case 'X-GOOGLE-CONFERENCE': cur.conference = p.value; break;
      default: if (p.name.startsWith('X-') && /zoom|teams|meet/i.test(p.value)) cur.extraLink = cur.extraLink || p.value;
    }
  }
  const fromMs = from.getTime(), toMs = to.getTime();
  const overrides = new Map();
  for (const e of events) if (e.recurrenceId != null) overrides.set(`${e.uid}|${e.recurrenceId}`, e);
  const durationOf = (e) => {
    if (e.end) return e.end.utc - e.start.utc;
    const m = (e.duration || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
    return m ? ((+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60) * 1000 : (e.start.allDay ? 86400000 : 3600000);
  };
  const out = [];
  const push = (e, startMs) => {
    if (e.status === 'CANCELLED') return;
    const endMs = startMs + durationOf(e);
    if (endMs < fromMs || startMs > toMs) return;
    const join = findJoin(e.conference) || findJoin(e.location) || findJoin(e.description) || findJoin(e.extraLink);
    out.push({ id: `${e.uid}|${startMs}`, title: e.title || '(No title)', calendar: calName, start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(),
      allDay: e.start.allDay, location: e.location || '', join, platform: platformOf(join) });
  };
  for (const e of events) {
    if (!e.start || e.recurrenceId != null) continue;
    if (!e.rrule) { push(e, e.start.utc); continue; }
    for (const t of expandRule(e.start, e.rrule, toMs)) {
      if (e.exdates.has(t)) continue;
      const ov = overrides.get(`${e.uid}|${t}`);
      if (ov) { if (ov.start) push(ov, ov.start.utc); } else push(e, t);
    }
  }
  // overrides whose original time was outside the window but moved into it
  for (const ov of overrides.values()) if (ov.start && !out.some((o) => o.id.startsWith(ov.uid + '|') && o.start === new Date(ov.start.utc).toISOString())) {
    const s = ov.start.utc; if (s >= fromMs && s <= toMs) push(ov, s);
  }
  return out.sort((a, b) => new Date(a.start) - new Date(b.start));
}
