// Kuwait official holidays and Islamic dates, worked out on the device (no internet, no account).
// Islamic dates use the Umm al-Qura calendar; the real day follows the moon sighting, so it can move by a day.
const FIXED = [ // [month, day, name]
  [1, 1, "New Year's Day"], [2, 25, 'Kuwait National Day'], [2, 26, 'Kuwait Liberation Day'],
];
const HIJRI = [ // [hijri month, day, name, official day off in Kuwait]
  [1, 1, 'Islamic New Year', true], [1, 10, 'Ashura', false],
  [3, 12, "Prophet's Birthday (Mawlid)", true],
  [7, 27, "Isra & Mi'raj", true],
  [9, 1, 'Ramadan begins', false], [9, 27, 'Laylat al-Qadr', false],
  [10, 1, 'Eid al-Fitr', true], [10, 2, 'Eid al-Fitr (day 2)', true], [10, 3, 'Eid al-Fitr (day 3)', true],
  [12, 9, 'Day of Arafah', true], [12, 10, 'Eid al-Adha', true], [12, 11, 'Eid al-Adha (day 2)', true], [12, 12, 'Eid al-Adha (day 3)', true],
];
export const HOLIDAY_COLOR = '#3fae7a';
let fmt = null;
function hijri(d) {
  try {
    fmt ||= new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'numeric', year: 'numeric' });
    const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
    return { y: parseInt(p.year, 10), m: +p.month, d: +p.day };
  } catch { return null; }
}
const cache = new Map();
// Corrections for the moon sighting: { 'hijriYear-month': days }, e.g. { '1448-10': 1 } moves Eid al-Fitr 1448 one day later.
let shifts = {};
export function setHijriShifts(s) { const next = s || {}; if (JSON.stringify(next) !== JSON.stringify(shifts)) { shifts = next; cache.clear(); } }
function forDay(d) {
  const key = d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
  if (cache.has(key)) return cache.get(key);
  const out = [];
  for (const [m, day, name] of FIXED) if (d.getMonth() + 1 === m && d.getDate() === day) out.push({ name, official: true, islamic: false });
  for (const s of [-2, -1, 0, 1, 2]) { // a month moved by s days shows on the day that is s days later
    const base = new Date(d); base.setDate(base.getDate() - s);
    const h = hijri(base); if (!h) break;
    const hkey = h.y + '-' + h.m;
    if ((shifts[hkey] || 0) !== s) continue;
    for (const [m, day, name, official] of HIJRI) if (h.m === m && h.d === day) out.push({ name, official, islamic: true, hkey, shift: s });
  }
  cache.set(key, out);
  return out;
}
// All-day "events" for every holiday between two dates.
export function holidaysBetween(from, to) {
  const out = [];
  for (let d = new Date(from.getFullYear(), from.getMonth(), from.getDate()); d <= to; d.setDate(d.getDate() + 1)) {
    for (const h of forDay(d)) {
      const start = new Date(d), end = new Date(d); end.setDate(end.getDate() + 1);
      out.push({ id: 'hol-' + start.getTime() + h.name, title: h.name, start, end, allDay: true, holiday: true, calId: 'holidays', calendar: 'Holidays', color: HOLIDAY_COLOR, official: h.official, hkey: h.hkey || null, shift: h.shift || 0,
        note: h.official ? 'Kuwait public holiday' + (h.islamic ? ' · date may shift a day with the moon sighting' : '') : 'Islamic date · may shift a day with the moon sighting' });
    }
  }
  return out;
}
export const holidaysOn = (d) => forDay(d);
