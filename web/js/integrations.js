// Calendar (private iCal link), Fitbit Air sleep + heart rate (Google Health) and Microsoft
// To Do (optional). Every result is cached locally so the dashboard still works offline.
import { state, kvSet, kvGet } from './store.js';
import { authFetch, signIn, connectionStatus } from './oauth.js';
import { netFetch } from './net.js';
import { parseICS } from './ical.js';
import * as CalDAV from './caldav.js';
import { isApp } from './net.js';

export const getClient = (provider) => provider === 'google'
  ? { clientId: state.settings.googleClientId, clientSecret: state.settings.googleClientSecret }
  : { clientId: state.settings.msClientId };

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
];
export const MS_SCOPES = ['offline_access', 'Tasks.ReadWrite'];

export function connect(provider) {
  const client = getClient(provider);
  if (!client.clientId) throw new Error(`Add your ${provider === 'google' ? 'Google' : 'Microsoft'} client ID in Settings first`);
  return signIn(provider, { ...client, scopes: provider === 'google' ? GOOGLE_SCOPES : MS_SCOPES });
}

const gFetch = (url, opts) => authFetch('google', getClient, url, opts);
const mFetch = (url, opts) => authFetch('microsoft', getClient, url, opts);

async function json(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

// ---------------- Calendar (Google Calendar private iCal link — no sign-in needed) ----------------
export const CAL_COLORS = ['#c9a96b', '#7ea6d8', '#7fb38d', '#d9705f', '#a49be0', '#e0874f', '#5fb8b0', '#d68fb8'];
// [{ id, name, url, color }]. Older versions stored plain links in `calendarLinks`.
export function calendars() {
  if (Array.isArray(state.settings.calendars)) return state.settings.calendars;
  return (state.settings.calendarLinks || '').split(/\s+/).filter((l) => /^(https?|webcal):\/\//.test(l))
    .map((url, i) => ({ id: 'c' + i, name: i === 0 ? 'Personal' : 'Calendar ' + (i + 1), url, color: CAL_COLORS[i % CAL_COLORS.length] }));
}

export async function syncCalendar(fetchVia = null) {
  const cals = calendars();
  if (!cals.length) { await kvSet('cache:ics', []); await kvSet('cache:calendar', { at: Date.now(), events: [] }); return []; }
  const texts = [], errors = [];
  for (const cal of cals) {
    if (cal.type === 'caldav' && !isApp()) continue; // phones get these through sync from the Windows app
    try {
      if (cal.type === 'caldav') {
        const password = await kvGet('calsecret:' + cal.id);
        if (!password) throw new Error('needs its password — open Settings → Calendars and edit it');
        const acct = { server: cal.url, user: cal.user, password, principal: cal.principal };
        let cols = await kvGet('caldav:cols:' + cal.id);
        const colsAt = (await kvGet('caldav:colsAt:' + cal.id)) || 0;
        if (!cols?.length || Date.now() - colsAt > 6 * 3600000) { cols = await CalDAV.discover(acct); await kvSet('caldav:cols:' + cal.id, cols); await kvSet('caldav:colsAt:' + cal.id, Date.now()); }
        const from = new Date(Date.now() - 45 * 86400000), to = new Date(Date.now() + 120 * 86400000);
        let text;
        try { text = await CalDAV.fetchEvents(acct, cols, from, to); }
        catch (e) { cols = await CalDAV.discover(acct); await kvSet('caldav:cols:' + cal.id, cols); text = await CalDAV.fetchEvents(acct, cols, from, to); }
        texts.push({ id: cal.id, name: cal.name, color: cal.color, text });
        await kvSet('cal:status:' + cal.id, { ok: true, at: Date.now(), count: (text.match(/BEGIN:VEVENT/g) || []).length, calendars: cols.map((c) => c.name) });
        continue;
      }
      const link = cal.url.replace(/^webcal:/, 'https:');
      let text;
      if (fetchVia) text = await fetchVia(link);
      else { const res = await netFetch(link); if (!res.ok) throw new Error(`returned ${res.status}`); text = await res.text(); }
      if (!text.includes('BEGIN:VCALENDAR')) throw new Error('is not an iCal link');
      texts.push({ id: cal.id, name: cal.name, color: cal.color, text });
      await kvSet('cal:status:' + cal.id, { ok: true, at: Date.now(), count: (text.match(/BEGIN:VEVENT/g) || []).length });
    } catch (e) {
      if (!(e && e.code === 'NOPROXY')) await kvSet('cal:status:' + cal.id, { ok: false, at: Date.now(), error: typeof e === 'string' ? e : e.message });
      if (e && e.code === 'NOPROXY') throw e;
      errors.push(`“${cal.name}” ${typeof e === 'string' ? e : e.message}`);
      const old = (await kvGet('cache:ics', [])).find((t) => t && t.id === cal.id);
      if (old) texts.push(old); // keep showing the last good copy
    }
  }
  await kvSet('cache:ics', texts);
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = new Date(from); to.setDate(to.getDate() + 15);
  const events = eventsBetween(texts, from, to);
  await kvSet('cache:calendar', { at: Date.now(), events });
  if (errors.length) throw new Error('Calendar ' + errors.join(', ') + ' — check the link in Settings');
  return events;
}

// Parse cached calendar text(s) for any date range (used by the month view).
export function eventsBetween(texts, from, to, { includeHidden = false } = {}) {
  const out = [];
  const hidden = new Set(includeHidden ? [] : state.settings.hiddenCalendars || []);
  for (const t of texts || []) {
    if (typeof t === 'string') { out.push(...parseICS(t, { from, to })); continue; } // old cache format
    if (!t || hidden.has(t.id)) continue;
    out.push(...parseICS(t.text, { from, to, calendarName: t.name }).map((e) => ({ ...e, id: t.id + ':' + e.id, calendar: t.name, color: t.color, calId: t.id })));
  }
  const seen = new Set();
  return out.filter((e) => (seen.has(e.id) ? false : seen.add(e.id))).sort((a, b) => new Date(a.start) - new Date(b.start));
}

// ---------------- Google Health (Fitbit Air) ----------------
// Only sleep and heart rate, as asked. The API is new (2026), so parsing is defensive.
const HEALTH = 'https://health.googleapis.com/v4/users/me/dataTypes';

function deepFind(obj, keys) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) if (obj[k] !== undefined) return obj[k];
  for (const v of Object.values(obj)) { const r = deepFind(v, keys); if (r !== undefined) return r; }
  return undefined;
}
const asDate = (v) => (typeof v === 'string' ? new Date(v) : v?.physicalTime ? new Date(v.physicalTime) : null);

async function listPoints(type, filter, pageSize) {
  const params = new URLSearchParams({ filter });
  if (pageSize) params.set('pageSize', pageSize);
  const res = await json(await gFetch(`${HEALTH}/${type}/dataPoints?${params}`));
  return res.dataPoints || [];
}

export async function syncHealth() {
  const now = new Date();
  const dayAgo = new Date(now - 24 * 3600 * 1000);
  const weekAgo = new Date(now - 7 * 24 * 3600 * 1000);
  const out = { at: Date.now(), sleep: [], hr: [], resting: [] };

  // Sleep sessions (last 7 nights)
  try {
    const pts = await listPoints('sleep', `sleep.interval.end_time >= "${new Date(now - 9 * 24 * 3600 * 1000).toISOString()}"`, 50);
    out.sleep = pts.map((p) => {
      const s = p.sleep || p;
      const start = asDate(deepFind(s, ['startTime'])); const end = asDate(deepFind(s, ['endTime']));
      // Google sends some numbers as text and some as durations ("21600s"); app.js normalises them.
      const asleepMin = deepFind(s, ['minutesAsleep', 'asleepMinutes', 'totalSleepMinutes', 'minutesAsleepTotal', 'asleepDuration', 'sleepDuration', 'totalSleepTime']);
      const stages = deepFind(s, ['stagesSummary', 'stageSummaries', 'summary']);
      return { start, end, minutes: asleepMin ?? (start && end ? Math.round((end - start) / 60000) : null), stages };
    }).filter((s) => s.start).sort((a, b) => b.start - a.start);
  } catch (e) { out.sleepError = e.message; }

  // Heart rate samples (last 24 h)
  try {
    const pts = await listPoints('heart-rate', `heart_rate.sample_time.physical_time >= "${dayAgo.toISOString()}"`, 1440);
    out.hr = pts.map((p) => ({
      t: asDate(deepFind(p.heartRate || p, ['sampleTime', 'physicalTime', 'startTime'])),
      bpm: Number(deepFind(p.heartRate || p, ['beatsPerMinute', 'bpm', 'value'])),
    })).filter((x) => x.t && x.bpm).sort((a, b) => a.t - b.t);
  } catch (e) { out.hrError = e.message; }

  // Daily resting heart rate (last 7 days)
  try {
    const d = (x) => x.toISOString().slice(0, 10);
    const pts = await listPoints('daily-resting-heart-rate', `daily_resting_heart_rate.date >= "${d(weekAgo)}"`);
    out.resting = pts.map((p) => {
      const r = p.dailyRestingHeartRate || p;
      const date = deepFind(r, ['date']);
      return { date: typeof date === 'object' ? `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}` : date, bpm: Number(deepFind(r, ['beatsPerMinute', 'bpm', 'value'])) };
    }).filter((x) => x.bpm);
  } catch (e) { out.restingError = e.message; }

  if (out.sleepError && out.hrError && out.restingError) throw new Error(out.hrError);
  await kvSet('cache:health', out);
  return out;
}

// ---------------- Microsoft To Do ----------------
const GRAPH = 'https://graph.microsoft.com/v1.0';

export async function syncTodo() {
  const lists = (await json(await mFetch(`${GRAPH}/me/todo/lists`))).value;
  const tasks = [];
  for (const l of lists) {
    const res = await json(await mFetch(`${GRAPH}/me/todo/lists/${l.id}/tasks?$filter=status ne 'completed'&$top=100`));
    for (const t of res.value) {
      tasks.push({ id: t.id, listId: l.id, list: l.displayName, title: t.title, importance: t.importance,
        due: t.dueDateTime ? t.dueDateTime.dateTime.slice(0, 10) : null, created: t.createdDateTime });
    }
  }
  const defaultList = lists.find((l) => l.wellknownListName === 'defaultList') || lists[0];
  await kvSet('cache:todo', { at: Date.now(), tasks, lists: lists.map((l) => ({ id: l.id, name: l.displayName })), defaultListId: defaultList?.id });
  return tasks;
}

export async function addTodo(title, listId, due) {
  const body = { title };
  if (due) body.dueDateTime = { dateTime: `${due}T00:00:00`, timeZone: 'Arab Standard Time' };
  return json(await mFetch(`${GRAPH}/me/todo/lists/${listId}/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}

export async function completeTodo(listId, taskId) {
  return json(await mFetch(`${GRAPH}/me/todo/lists/${listId}/tasks/${taskId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) }));
}

export { connectionStatus };
