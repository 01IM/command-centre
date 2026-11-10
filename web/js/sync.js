// Cross-device sync (Windows app, iPhone, iPad) through your own free Supabase project.
// Everything is encrypted on the device before upload (see crypto.js); Supabase only stores ciphertext.
//
// Table `items` holds one row per synced thing:  (user_id, collection, id, updated_at, deleted, payload)
//   collections: plans, goals, docs, … (app data) · _settings (one row per setting) · _meta (profile photo,
//   encryption check) · _cube (solves) · _relay (calendar + Fitbit snapshots from the Windows app) · _files (vault index)
// Vault files themselves are encrypted blobs in the private Storage bucket `vault`.
import { state, kvGet, kvSet, COLLECTIONS, mergeCollection, replaceCollection, setSetting, emit } from './store.js';
import { deriveKey, newSalt, encryptJSON, decryptJSON, encryptBytes, decryptBytes, sha256Hex } from './crypto.js';
import * as V from './vault.js';
import { isApp } from './net.js';

// Settings that follow you between devices (device-only things like theme, sign-ins and secrets stay put).
const SYNC_SETTINGS = ['people', 'calendars', 'calendarLinks', 'hiddenCalendars', 'location', 'notifyMeetings', 'notifyPrayer', 'notifyDocs', 'prayerMethod', 'icsProxy', 'currency'];

let cfg = null;      // { url, anon, email, uid, refresh_token, access_token, expires_at, salt }
let key = null;      // CryptoKey (non-extractable), kept in IndexedDB so you only type the passphrase once per device
let running = null;
const listeners = new Set();
export const status = { state: 'off', last: null, error: null, files: { up: 0, down: 0 } };
export function onStatus(fn) { listeners.add(fn); }
function setStatus(patch) { Object.assign(status, patch); listeners.forEach((f) => f(status)); }

export async function init() {
  cfg = await kvGet('sync:cfg');
  key = await kvGet('sync:key');
  status.last = await kvGet('sync:last');
  setStatus({ state: !cfg ? 'off' : !key ? 'locked' : 'ready' });
}
export const config = () => cfg;
export const enabled = () => !!(cfg && key && cfg.refresh_token);

// ---------------- Supabase REST helpers (no SDK needed) ----------------
async function auth(path, body) {
  const res = await fetch(`${cfg.url}/auth/v1/${path}`, { method: 'POST', headers: { apikey: cfg.anon, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.msg || j.error_description || j.message || j.error || `Sign-in failed (${res.status})`);
  return j;
}
async function saveSession(j) {
  cfg = { ...cfg, uid: j.user?.id || cfg.uid, access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000 - 60000 };
  await kvSet('sync:cfg', cfg);
}
async function token() {
  if (cfg.access_token && Date.now() < cfg.expires_at) return cfg.access_token;
  const j = await auth('token?grant_type=refresh_token', { refresh_token: cfg.refresh_token });
  await saveSession(j);
  return cfg.access_token;
}
async function api(path, opts = {}) {
  const t = await token();
  const res = await fetch(`${cfg.url}${path}`, { ...opts, headers: { apikey: cfg.anon, Authorization: `Bearer ${t}`, ...(opts.headers || {}) } });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Sync error ${res.status}${txt ? ': ' + txt.slice(0, 160) : ''}`);
  }
  return res;
}
const rest = (q, opts) => api(`/rest/v1/${q}`, opts);

async function upsertRows(rows) {
  for (let i = 0; i < rows.length; i += 200) {
    await rest('items?on_conflict=user_id,collection,id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(i, i + 200).map((r) => ({ user_id: cfg.uid, ...r }))),
    });
  }
}
async function fetchRows(since) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const q = `items?select=collection,id,updated_at,deleted,payload,server_ts&order=server_ts.asc${since ? `&server_ts=gt.${encodeURIComponent(since)}` : ''}&limit=1000&offset=${offset}`;
    const rows = await (await rest(q)).json();
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

// ---------------- setup: connect / sign in / passphrase ----------------
export async function connect({ url, anon, email, password, passphrase, create }) {
  url = url.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url) && !/^http:\/\/localhost:\d+$/.test(url)) throw new Error('Project URL should look like https://abcdxyz.supabase.co');
  cfg = { url, anon: anon.trim(), email: email.trim() };
  let j;
  if (create) {
    j = await auth('signup', { email: cfg.email, password });
    if (!j.access_token) throw new Error('Account created — but Supabase wants the email confirmed first. Turn off “Confirm email” (see the guide) or click the link in your inbox, then sign in.');
  } else j = await auth('token?grant_type=password', { email: cfg.email, password });
  await saveSession(j);

  // encryption: first device creates the salt + a check value; other devices must match it
  const meta = await (await rest('items?select=payload&collection=eq._meta&id=eq.crypto')).json();
  if (meta.length) {
    const { salt, check } = JSON.parse(meta[0].payload);
    const k = await deriveKey(passphrase, salt);
    try { if ((await decryptJSON(k, check)) !== 'command-centre') throw 0; } catch { throw new Error('That passphrase doesn’t match the one used on your other device'); }
    key = k; cfg.salt = salt;
  } else {
    if (!passphrase || passphrase.length < 8) throw new Error('Choose a passphrase of at least 8 characters');
    const salt = newSalt();
    key = await deriveKey(passphrase, salt);
    const check = await encryptJSON(key, 'command-centre');
    await upsertRows([{ collection: '_meta', id: 'crypto', updated_at: Date.now(), deleted: false, payload: JSON.stringify({ salt, check, v: 1 }) }]);
    cfg.salt = salt;
  }
  await kvSet('sync:cfg', cfg);
  await kvSet('sync:key', key);
  await kvSet('sync:since', null);       // full pull on a new connection
  await kvSet('sync:pushed', {});        // and push everything we have
  await kvSet('sync:remoteFiles', {}); await kvSet('sync:knownFiles', {}); await kvSet('sync:haveFiles', {});
  setStatus({ state: 'ready', error: null });
  return syncNow();
}

export async function disconnect() {
  cfg = null; key = null;
  await kvSet('sync:cfg', null); await kvSet('sync:key', null); await kvSet('sync:since', null); await kvSet('sync:pushed', {});
  setStatus({ state: 'off', error: null });
}

// ---------------- the sync cycle ----------------
export function syncNow() {
  if (!enabled()) return Promise.resolve();
  if (running) { running.again = true; return running.p; }
  running = { again: false };
  running.p = (async () => {
    setStatus({ state: 'syncing', error: null });
    try {
      do { running.again = false; await cycle(); } while (running.again);
      const last = Date.now(); await kvSet('sync:last', last);
      setStatus({ state: 'ready', last, error: null });
    } catch (e) {
      console.warn('sync', e);
      setStatus({ state: navigator.onLine ? 'error' : 'offline', error: typeof e === 'string' ? e : e.message });
    } finally { running = null; }
  })();
  return running.p;
}

// `pushed` remembers, per item, the updatedAt we last uploaded or received, so only real changes move.
async function cycle() {
  const pushed = (await kvGet('sync:pushed', {})) || {};
  const since = await kvGet('sync:since');
  let changed = false;

  // ---- 1. pull ----
  const rows = await fetchRows(since);
  const incoming = {};
  let maxTs = since;
  for (const r of rows) {
    if (!maxTs || r.server_ts > maxTs) maxTs = r.server_ts;
    if (r.collection === '_meta' && r.id === 'crypto') continue;
    let value = null;
    if (!r.deleted && r.payload) { try { value = await decryptJSON(key, r.payload); } catch { console.warn('cannot decrypt', r.collection, r.id); continue; } }
    (incoming[r.collection] ||= []).push({ id: r.id, updated_at: r.updated_at, deleted: r.deleted, value });
    pushed[`${r.collection}|${r.id}`] = r.updated_at;
  }

  for (const c of COLLECTIONS) {
    const inc = (incoming[c] || []).map((r) => (r.deleted ? { id: r.id, deleted: true, updatedAt: r.updated_at } : { ...r.value, id: r.id, updatedAt: r.updated_at }));
    if (!inc.length) continue;
    const merged = mergeCollection(state.data[c], inc);
    await replaceCollection(c, merged, true); changed = true;
  }
  for (const r of incoming._settings || []) {
    if (!SYNC_SETTINGS.includes(r.id)) continue;
    const localAt = state.settings._ts?.[r.id] || 0;
    if (r.updated_at > localAt) { await setSetting(r.id, r.deleted ? undefined : r.value, { silent: true, at: r.updated_at }); changed = true; }
  }
  for (const r of incoming._meta || []) {
    if (r.id === 'profilePhoto' && r.updated_at > ((await kvGet('profilePhotoAt')) || 0)) {
      await kvSet('profilePhoto', r.deleted ? null : r.value); await kvSet('profilePhotoAt', r.updated_at); changed = true;
      emit({ type: 'profilePhoto' });
    }
  }
  for (const r of incoming._cube || []) {
    if (r.id !== 'solves' || r.deleted) continue;
    const mine = (await kvGet('cube:solves', [])) || [];
    const seen = new Set(mine.map((x) => x.at));
    const merged = [...mine, ...(r.value || []).filter((x) => x.at && !seen.has(x.at))].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 1000);
    if (merged.length !== mine.length) { await kvSet('cube:solves', merged); emit({ type: 'cube' }); }
  }
  for (const r of incoming._relay || []) {
    if (r.deleted) continue;
    // Only devices that can't fetch this themselves use relayed copies (the Windows app is the source).
    if (r.id === 'calendar' && !isApp()) { await kvSet('relay:calendar', { ...r.value, at: r.updated_at }); changed = true; }
    if (r.id === 'health' && !isApp()) { await kvSet('cache:health', r.value); changed = true; }
  }

  // ---- 2. push local changes ----
  const out = [];
  for (const c of COLLECTIONS) {
    for (const item of state.data[c]) {
      const k = `${c}|${item.id}`;
      if ((item.updatedAt || 0) > (pushed[k] || 0)) {
        const { id, updatedAt, deleted, ...value } = item;
        out.push({ collection: c, id, updated_at: updatedAt || Date.now(), deleted: !!deleted, payload: deleted ? null : await encryptJSON(key, value) });
        pushed[k] = updatedAt;
      }
    }
  }
  for (const s of SYNC_SETTINGS) {
    // settings saved before sync existed have no timestamp: send them once with the oldest possible time
    const at = state.settings._ts?.[s] || (state.settings[s] !== undefined ? 1 : 0); const k = `_settings|${s}`;
    if (at > (pushed[k] || 0) && state.settings[s] !== undefined) {
      out.push({ collection: '_settings', id: s, updated_at: at, deleted: false, payload: await encryptJSON(key, state.settings[s]) }); pushed[k] = at;
    }
  }
  const photoAt = (await kvGet('profilePhotoAt')) || 0;
  if (photoAt > (pushed['_meta|profilePhoto'] || 0)) {
    const photo = await kvGet('profilePhoto');
    out.push({ collection: '_meta', id: 'profilePhoto', updated_at: photoAt, deleted: !photo, payload: photo ? await encryptJSON(key, photo) : null });
    pushed['_meta|profilePhoto'] = photoAt;
  }
  const solves = (await kvGet('cube:solves', [])) || [];
  const solvesSig = solves.length ? solves.length + ':' + (solves[0].at || 0) : '';
  if (solvesSig && solvesSig !== (await kvGet('sync:solvesSig'))) {
    out.push({ collection: '_cube', id: 'solves', updated_at: Date.now(), deleted: false, payload: await encryptJSON(key, solves.filter((x) => x.at).slice(0, 1000)) });
    await kvSet('sync:solvesSig', solvesSig);
  }
  if (isApp()) { // the Windows app relays what phones can't fetch themselves
    for (const [id, cacheKey] of [['calendar', 'relay:out:calendar'], ['health', 'cache:health']]) {
      const v = await kvGet(cacheKey);
      if (v && v.at && v.at > (pushed[`_relay|${id}`] || 0)) {
        out.push({ collection: '_relay', id, updated_at: v.at, deleted: false, payload: await encryptJSON(key, v) }); pushed[`_relay|${id}`] = v.at;
      }
    }
  }
  if (out.length) await upsertRows(out);

  // ---- 3. files ----
  const fileChanged = await syncFiles(incoming._files || [], pushed);

  await kvSet('sync:pushed', pushed);
  // Only advance to what we actually pulled: our own writes come back once next time (harmless, they're
  // recognised as already-known), but nothing another device wrote meanwhile can be skipped.
  await kvSet('sync:since', maxTs);
  if (changed || fileChanged) emit({ type: 'data', collection: '*' });
}

// ---------------- vault files ----------------
const fileId = (path) => sha256Hex('vault:' + path.toLowerCase());
const objectPath = (id) => `${cfg.uid}/${id}`;
const mimeOf = (name) => ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }[(name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream');

async function syncFiles(incomingFiles, pushed) {
  let changed = false;
  const remote = (await kvGet('sync:remoteFiles', {})) || {}; // id -> { path, size, modified, deleted, updated_at }
  for (const r of incomingFiles) remote[r.id] = r.deleted ? { deleted: true, updated_at: r.updated_at, path: remote[r.id]?.path } : { ...r.value, updated_at: r.updated_at };
  const known = (await kvGet('sync:knownFiles', {})) || {}; // path -> local modified time at last sync (this device)
  const have = (await kvGet('sync:haveFiles', {})) || {};   // id -> cloud version (updated_at) our local copy matches
  const local = await V.listFiles().catch(() => []);
  const localByPath = new Map(local.map((f) => [f.path, f]));
  const rows = [];

  // 1) local → cloud (new or edited files)
  for (const f of local) {
    const id = await fileId(f.path);
    const r = remote[id];
    const k = known[f.path];
    if (k !== undefined && f.modified <= k) continue;                         // unchanged since last sync
    if (k === undefined && r && !r.deleted && r.size === f.size) {            // same file already in the cloud
      known[f.path] = f.modified; have[id] = r.updated_at; continue;
    }
    const bytes = await V.readFile(f.path);
    await api(`/storage/v1/object/vault/${objectPath(id)}`, { method: 'POST', headers: { 'x-upsert': 'true', 'Content-Type': 'application/octet-stream' }, body: await encryptBytes(key, bytes) });
    const meta = { path: f.path, size: f.size, modified: f.modified };
    const at = Date.now();
    rows.push({ collection: '_files', id, updated_at: at, deleted: false, payload: await encryptJSON(key, meta) });
    remote[id] = { ...meta, updated_at: at }; known[f.path] = f.modified; have[id] = at; pushed[`_files|${id}`] = at;
    status.files.up++; changed = true;
  }
  // The iPhone / iPad versions don't show Files: they only upload scans attached there (e.g. to an
  // expiry date) and never download the whole vault.
  if (!isApp()) {
    if (rows.length) await upsertRows(rows);
    await kvSet('sync:remoteFiles', remote); await kvSet('sync:knownFiles', known); await kvSet('sync:haveFiles', have);
    return changed;
  }
  // 2) local deletions → cloud (only if the cloud copy is the one we had)
  for (const path of Object.keys(known)) {
    if (localByPath.has(path)) continue;
    const id = await fileId(path);
    const r = remote[id];
    if (r && !r.deleted && (have[id] || 0) >= r.updated_at) {
      const at = Date.now();
      rows.push({ collection: '_files', id, updated_at: at, deleted: true, payload: null });
      remote[id] = { deleted: true, updated_at: at, path }; have[id] = at;
      await api(`/storage/v1/object/vault/${objectPath(id)}`, { method: 'DELETE' }).catch(() => {});
      changed = true;
    }
    delete known[path];
  }
  // 3) cloud → local (new, edited and deleted files from other devices)
  for (const [id, r] of Object.entries(remote)) {
    if ((have[id] || 0) >= r.updated_at) continue;
    const lf = r.path && localByPath.get(r.path);
    if (r.deleted) {
      if (lf && known[r.path] !== undefined && lf.modified <= known[r.path]) { await V.deleteFile(r.path).catch(() => {}); delete known[r.path]; changed = true; }
      have[id] = r.updated_at; continue;
    }
    if (lf && known[r.path] === undefined && lf.size === r.size) { known[r.path] = lf.modified; have[id] = r.updated_at; continue; }
    const res = await api(`/storage/v1/object/authenticated/vault/${objectPath(id)}`).catch(() => null);
    if (!res) continue;
    const bytes = await decryptBytes(key, await res.arrayBuffer());
    await V.writeFileAt(r.path, bytes, mimeOf(r.path));
    const after = (await V.listFiles()).find((x) => x.path === r.path);
    known[r.path] = after ? after.modified : Date.now(); have[id] = r.updated_at;
    status.files.down++; changed = true;
  }
  if (rows.length) await upsertRows(rows);
  await kvSet('sync:remoteFiles', remote);
  await kvSet('sync:knownFiles', known);
  await kvSet('sync:haveFiles', have);
  return changed;
}

// ---------------- scheduling ----------------
let timer = null, debounce = null;
export function start() {
  if (timer) return;
  const tick = () => { if (enabled() && (!document.hidden || isApp())) syncNow(); };
  timer = setInterval(tick, 45000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  addEventListener('online', tick);
  addEventListener('focus', tick);
  tick();
}
export function soon(ms = 3000) { clearTimeout(debounce); debounce = setTimeout(() => syncNow(), ms); }

// ---------------- calendar helper for iPhone / iPad ----------------
// Phones can't read Google/Outlook calendar links directly (browser security), so they use a tiny
// "ics" function in your Supabase project (optional, see guide). Without it, phones show the copy
// relayed by the Windows app.
let proxyState = { ok: null, checked: 0 };
export async function proxyFetchICS(url) {
  if (!enabled()) { const e = new Error('no sync'); e.code = 'NOPROXY'; throw e; }
  if (proxyState.ok === false && Date.now() - proxyState.checked < 3600000) { const e = new Error('no helper'); e.code = 'NOPROXY'; throw e; }
  const t = await token();
  const res = await fetch(`${cfg.url}/functions/v1/ics?url=${encodeURIComponent(url)}`, { headers: { apikey: cfg.anon, Authorization: `Bearer ${t}` } }).catch(() => null);
  proxyState.checked = Date.now();
  if (!res || res.status === 404) { proxyState.ok = false; const e = new Error('no helper'); e.code = 'NOPROXY'; throw e; }
  proxyState.ok = true;
  if (!res.ok) throw new Error(`returned ${res.status}`);
  return res.text();
}
