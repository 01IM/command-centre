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

// Events between two dates from all the account's calendars, as one VCALENDAR text.
export async function fetchEvents({ user, password }, collections, from, to) {
  const parts = [];
  const body = `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="${CAL}"><d:prop><c:calendar-data/></d:prop>
    <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${utc(from)}" end="${utc(to)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  for (const col of collections) {
    const doc = await dav('REPORT', col.url, { user, password, depth: 1, body });
    for (const el of doc.getElementsByTagNameNS(CAL, 'calendar-data')) {
      const ics = el.textContent || '';
      // keep the time zones and events from each object
      const blocks = ics.match(/BEGIN:(VTIMEZONE|VEVENT)[\s\S]*?END:\1/g) || [];
      parts.push(...blocks);
    }
  }
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Command Centre//CalDAV//EN\r\n${parts.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
}
