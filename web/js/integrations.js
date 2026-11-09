// Calendar (private iCal link), Fitbit Air sleep + heart rate (Google Health) and Microsoft
// To Do (optional). Every result is cached locally so the dashboard still works offline.
import { state, kvSet } from './store.js';
import { authFetch, signIn, connectionStatus } from './oauth.js';
import { netFetch } from './net.js';
import { parseICS } from './ical.js';

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
export async function syncCalendar() {
  const links = (state.settings.calendarLinks || '').split(/\s+/).filter((l) => /^(https?|webcal):\/\//.test(l));
  if (!links.length) return [];
  const texts = [];
  for (const link of links) {
    const res = await netFetch(link.replace(/^webcal:/, 'https:'));
    if (!res.ok) throw new Error(`Calendar link returned ${res.status} — check it in Settings`);
    const text = await res.text();
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('That link is not an iCal calendar — copy the “Secret address in iCal format”');
    texts.push(text);
  }
  await kvSet('cache:ics', texts);
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = new Date(from); to.setDate(to.getDate() + 15);
  const events = eventsBetween(texts, from, to);
  await kvSet('cache:calendar', { at: Date.now(), events });
  return events;
}

// Parse cached calendar text(s) for any date range (used by the month view).
export function eventsBetween(texts, from, to) {
  const out = [];
  for (const t of texts || []) out.push(...parseICS(t, { from, to }));
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
    const pts = await listPoints('sleep', `sleep.interval.end_time >= "${weekAgo.toISOString()}"`, 25);
    out.sleep = pts.map((p) => {
      const s = p.sleep || p;
      const start = asDate(deepFind(s, ['startTime'])); const end = asDate(deepFind(s, ['endTime']));
      const asleepMin = deepFind(s, ['minutesAsleep', 'asleepMinutes', 'totalSleepMinutes']);
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
