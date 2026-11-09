// Local-first storage. Everything lives in IndexedDB on this device.
// Collections hold items shaped like { id, updatedAt, deleted?, ...fields }.
// "deleted" items are kept as tombstones so sync can propagate deletions.

const DB_NAME = 'imran-dashboard';
const DB_VERSION = 1;
let dbPromise;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(storeName, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
  });
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function kvGet(key, fallback = null) {
  const v = await tx('kv', 'readonly', (s) => reqP(s.get(key)));
  return v === undefined ? fallback : v;
}
export async function kvSet(key, value) {
  return tx('kv', 'readwrite', (s) => reqP(s.put(value, key)));
}
export async function fileGet(key) {
  return tx('files', 'readonly', (s) => reqP(s.get(key)));
}
export async function fileSet(key, blob) {
  return tx('files', 'readwrite', (s) => reqP(s.put(blob, key)));
}
export async function fileDel(key) {
  return tx('files', 'readwrite', (s) => reqP(s.delete(key)));
}
export async function fileKeys() {
  return tx('files', 'readonly', (s) => reqP(s.getAllKeys()));
}

// ---------- app state ----------
export const COLLECTIONS = ['plans', 'goals', 'docs', 'trips', 'notes', 'seasons', 'localTasks', 'flights'];

export const state = {
  data: Object.fromEntries(COLLECTIONS.map((c) => [c, []])),
  settings: {},
};

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(what) { listeners.forEach((fn) => fn(what)); }

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export async function loadState() {
  for (const c of COLLECTIONS) state.data[c] = await kvGet('col:' + c, []);
  state.settings = await kvGet('settings', {});
}

export function list(collection) {
  return state.data[collection].filter((i) => !i.deleted);
}

export async function upsert(collection, item) {
  const now = Date.now();
  const arr = state.data[collection];
  const idx = arr.findIndex((i) => i.id === item.id);
  const next = { ...(idx >= 0 ? arr[idx] : {}), ...item, id: item.id || uid(), updatedAt: now };
  if (idx >= 0) arr[idx] = next; else arr.push(next);
  await kvSet('col:' + collection, arr);
  emit({ type: 'data', collection });
  return next;
}

export async function remove(collection, id) {
  const arr = state.data[collection];
  const idx = arr.findIndex((i) => i.id === id);
  if (idx < 0) return;
  arr[idx] = { id, deleted: true, updatedAt: Date.now() };
  await kvSet('col:' + collection, arr);
  emit({ type: 'data', collection });
}

export async function replaceCollection(collection, arr, silent = false) {
  state.data[collection] = arr;
  await kvSet('col:' + collection, arr);
  if (!silent) emit({ type: 'data', collection });
}

export async function setSetting(key, value) {
  state.settings[key] = value;
  state.settings.updatedAt = Date.now();
  await kvSet('settings', state.settings);
  emit({ type: 'settings', key });
}

// Merge two copies of a collection: newest updatedAt wins per item.
export function mergeCollection(a = [], b = []) {
  const map = new Map();
  for (const item of [...a, ...b]) {
    const cur = map.get(item.id);
    if (!cur || (item.updatedAt || 0) > (cur.updatedAt || 0)) map.set(item.id, item);
  }
  return [...map.values()];
}

export function snapshot() {
  return { version: 1, exportedAt: new Date().toISOString(), data: state.data, settings: publicSettings() };
}

// Settings that are safe and useful to carry between devices (no tokens).
export function publicSettings() {
  const { googleClientId, msClientId, location, notifyMeetings, notifyDocs, prayerMethod, owSeasonsSeeded, people, calendarLinks, calendars, hiddenCalendars, theme, updatedAt } = state.settings;
  return { googleClientId, msClientId, location, notifyMeetings, notifyDocs, prayerMethod, owSeasonsSeeded, people, calendarLinks, calendars, hiddenCalendars, theme, updatedAt };
}

export async function importSnapshot(snap, { merge = true } = {}) {
  if (!snap || !snap.data) throw new Error('Not a dashboard backup file');
  for (const c of COLLECTIONS) {
    const incoming = snap.data[c] || [];
    const next = merge ? mergeCollection(state.data[c], incoming) : incoming;
    await replaceCollection(c, next, true);
  }
  if (snap.settings && (!state.settings.updatedAt || (snap.settings.updatedAt || 0) > state.settings.updatedAt)) {
    for (const [k, v] of Object.entries(snap.settings)) if (v !== undefined) state.settings[k] = v;
    await kvSet('settings', state.settings);
  }
  emit({ type: 'data', collection: '*' });
}

export { emit };
