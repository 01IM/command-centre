// CalDAV reader for calendars that live on a mail server (e.g. Plot.it's cPanel mail at
// mail.plotoit.com:2080). Signs in with the work email + password, finds the calendars, and
// asks for the events in a date range. Returns ordinary iCalendar text for ical.js to read.
// Runs in the Windows app (requests go through the app, so browser security limits don't apply).
import { netFetch } from './net.js';

const DAV = 'DAV:', CAL = 'urn:ietf:params:xml:ns:caldav';
const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const utc = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

async function dav(method, url, { user, password, depth, body }) {
  const res = await netFetch(url, {
    method,
    headers: { Authorization: 'Basic ' + b64(`${user}:${password}`), 'Content-Type': 'application/xml; charset=utf-8', ...(depth != null ? { Depth: String(depth) } : {}) },
    body,
  });
  if (res.status === 401 || res.status === 403) throw new Error('the email or password was rejected');
  if (res.status >= 400) throw new Error(`server replied ${res.status}`);
  return new DOMParser().parseFromString(await res.text(), 'application/xml');
}
const hrefIn = (doc, ns, tag) => { const el = doc.getElementsByTagNameNS(ns, tag)[0]; return el?.getElementsByTagNameNS(DAV, 'href')[0]?.textContent?.trim() || null; };

// Find the calendar collections for this account. Result is cached by the caller.
export async function discover({ server, user, password, principal }) {
  const base = server.replace(/\/+$/, '');
  let principalUrl = principal ? new URL(principal, base + '/').href : null;
  if (!principalUrl) {
    for (const start of ['/.well-known/caldav', '/']) {
      try {
        const doc = await dav('PROPFIND', base + start, { user, password, depth: 0, body: '<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>' });
        const h = hrefIn(doc, DAV, 'current-user-principal');
        if (h) { principalUrl = new URL(h, base + '/').href; break; }
      } catch (e) { if (/rejected/.test(e.message)) throw e; }
    }
    if (!principalUrl) principalUrl = `${base}/principals/${encodeURIComponent(user)}/`;
  }
  const pdoc = await dav('PROPFIND', principalUrl, { user, password, depth: 0, body: `<d:propfind xmlns:d="DAV:" xmlns:c="${CAL}"><d:prop><c:calendar-home-set/></d:prop></d:propfind>` });
  const home = new URL(hrefIn(pdoc, CAL, 'calendar-home-set') || `/calendars/${encodeURIComponent(user)}/`, base + '/').href;
  const hdoc = await dav('PROPFIND', home, { user, password, depth: 1, body: `<d:propfind xmlns:d="DAV:" xmlns:c="${CAL}"><d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/></d:prop></d:propfind>` });
  const out = [];
  for (const r of hdoc.getElementsByTagNameNS(DAV, 'response')) {
    const href = r.getElementsByTagNameNS(DAV, 'href')[0]?.textContent?.trim();
    const isCal = r.getElementsByTagNameNS(CAL, 'calendar').length > 0;
    const comps = [...r.getElementsByTagNameNS(CAL, 'comp')].map((c) => c.getAttribute('name'));
    if (href && isCal && (!comps.length || comps.includes('VEVENT'))) {
      out.push({ url: new URL(href, base + '/').href, name: r.getElementsByTagNameNS(DAV, 'displayname')[0]?.textContent?.trim() || 'Calendar' });
    }
  }
  if (!out.length) throw new Error('no calendars were found on this account');
  return out;
}

const blocksIn = (ics) => ics.match(/BEGIN:(VTIMEZONE|VEVENT)[\s\S]*?END:\1/g) || [];
const dataIn = (doc) => [...doc.getElementsByTagNameNS(CAL, 'calendar-data')].flatMap((el) => blocksIn(el.textContent || ''));

// Events between two dates from all the account's calendars, as one VCALENDAR text.
// Servers differ (cPanel's included), so this tries, in order: a date-range query, a full query,
// and finally listing every event file and downloading each one.
export async function fetchEvents({ user, password }, collections, from, to) {
  const parts = [];
  const q = (filter) => `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="${CAL}"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR">${filter}</c:comp-filter></c:filter></c:calendar-query>`;
  const ranged = q(`<c:comp-filter name="VEVENT"><c:time-range start="${utc(from)}" end="${utc(to)}"/></c:comp-filter>`);
  const all = q('<c:comp-filter name="VEVENT"/>');
  for (const col of collections) {
    let blocks = [];
    try { blocks = dataIn(await dav('REPORT', col.url, { user, password, depth: 1, body: ranged })); } catch (e) { if (/rejected/.test(e.message)) throw e; }
    if (!blocks.some((b) => b.startsWith('BEGIN:VEVENT'))) {
      try { blocks = dataIn(await dav('REPORT', col.url, { user, password, depth: 1, body: all })); } catch (e) { if (/rejected/.test(e.message)) throw e; }
    }
    if (!blocks.some((b) => b.startsWith('BEGIN:VEVENT'))) {
      // last resort: list the .ics files in the calendar and download them
      const doc = await dav('PROPFIND', col.url, { user, password, depth: 1, body: '<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:getcontenttype/></d:prop></d:propfind>' });
      const hrefs = [...doc.getElementsByTagNameNS(DAV, 'response')].map((r) => r.getElementsByTagNameNS(DAV, 'href')[0]?.textContent?.trim()).filter((h) => h && /\.ics$/i.test(h)).slice(0, 400);
      for (const h of hrefs) {
        const res = await netFetch(new URL(h, col.url).href, { headers: { Authorization: 'Basic ' + b64(`${user}:${password}`) } });
        if (res.ok) blocks.push(...blocksIn(await res.text()));
      }
    }
    parts.push(...blocks);
  }
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Command Centre//CalDAV//EN\r\n${parts.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
}

// Step-by-step connection test: returns a readable log of what the server answers.
export async function diagnose({ server, user, password, principal }) {
  const log = [];
  const base = server.replace(/\/+$/, '');
  const auth = { Authorization: 'Basic ' + b64(`${user}:${password}`), 'Content-Type': 'application/xml; charset=utf-8' };
  const call = async (method, url, depth, body) => {
    try {
      const res = await netFetch(url, { method, headers: { ...auth, ...(depth != null ? { Depth: String(depth) } : {}) }, body });
      const text = await res.text();
      return { status: res.status, text };
    } catch (e) { return { status: 0, text: String(e?.message || e) }; }
  };
  const parse = (t) => { try { return new DOMParser().parseFromString(t, 'application/xml'); } catch { return null; } };
  const short = (t) => (t || '').replace(/\s+/g, ' ').slice(0, 300);
  const pURL = new URL(principal || `/principals/${user}/`, base + '/').href;
  log.push(`Server: ${base}`, `Principal: ${pURL}`);
  let r = await call('PROPFIND', pURL, 0, `<d:propfind xmlns:d="DAV:" xmlns:c="${CAL}"><d:prop><c:calendar-home-set/><d:current-user-principal/><d:displayname/></d:prop></d:propfind>`);
  log.push(`1) PROPFIND principal → ${r.status}`);
  let doc = parse(r.text);
  const home = doc && hrefIn(doc, CAL, 'calendar-home-set');
  log.push(`   calendar-home-set: ${home || '(none) ' + short(r.text)}`);
  const homeURL = new URL(home || `/calendars/${user}/`, base + '/').href;
  r = await call('PROPFIND', homeURL, 1, `<d:propfind xmlns:d="DAV:" xmlns:c="${CAL}"><d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/><d:getctag xmlns:cs="http://calendarserver.org/ns/"/></d:prop></d:propfind>`);
  log.push(`2) PROPFIND home (${homeURL}) → ${r.status}`);
  doc = parse(r.text);
  const cols = [];
  for (const resp of doc ? doc.getElementsByTagNameNS(DAV, 'response') : []) {
    const href = resp.getElementsByTagNameNS(DAV, 'href')[0]?.textContent?.trim();
    const types = [...(resp.getElementsByTagNameNS(DAV, 'resourcetype')[0]?.children || [])].map((c) => c.localName).join(',');
    const name = resp.getElementsByTagNameNS(DAV, 'displayname')[0]?.textContent?.trim() || '';
    const comps = [...resp.getElementsByTagNameNS(CAL, 'comp')].map((c) => c.getAttribute('name')).join(',');
    log.push(`   • ${href}  [${types}]  "${name}"  ${comps}`);
    if (/calendar/.test(types) && !/schedule/.test(types)) cols.push(new URL(href, base + '/').href);
  }
  if (!cols.length) log.push('   (no calendar collections found) ' + short(r.text));
  const from = new Date(Date.now() - 45 * 86400000), to = new Date(Date.now() + 120 * 86400000);
  for (const col of cols) {
    log.push(`3) Calendar ${col}`);
    const q = (f) => `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="${CAL}"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR">${f}</c:comp-filter></c:filter></c:calendar-query>`;
    for (const [label, body] of [['REPORT date range', q(`<c:comp-filter name="VEVENT"><c:time-range start="${utc(from)}" end="${utc(to)}"/></c:comp-filter>`)], ['REPORT all', q('<c:comp-filter name="VEVENT"/>')]]) {
      r = await call('REPORT', col, 1, body);
      const d = parse(r.text);
      const n = d ? d.getElementsByTagNameNS(DAV, 'response').length : 0;
      const data = d ? [...d.getElementsByTagNameNS(CAL, 'calendar-data')].length : 0;
      log.push(`   ${label} → ${r.status}, ${n} responses, ${data} with event data${n === 0 ? ' · ' + short(r.text) : ''}`);
    }
    r = await call('PROPFIND', col, 1, '<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:getcontenttype/></d:prop></d:propfind>');
    const d = parse(r.text);
    const hrefs = d ? [...d.getElementsByTagNameNS(DAV, 'response')].map((x) => x.getElementsByTagNameNS(DAV, 'href')[0]?.textContent?.trim()) : [];
    log.push(`   PROPFIND items → ${r.status}, ${hrefs.length} entries: ${hrefs.slice(0, 6).join(' | ')}`);
    const firstItem = hrefs.find((h) => h && !new URL(h, base + '/').href.replace(/\/$/, '').endsWith(new URL(col).pathname.replace(/\/$/, '')));
    if (firstItem) {
      r = await call('GET', new URL(firstItem, base + '/').href, null);
      log.push(`   GET first item → ${r.status}: ${short(r.text).slice(0, 160)}`);
    }
  }
  return log.join('\n');
}
