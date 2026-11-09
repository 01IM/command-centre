import * as S from './store.js';
import { getPrayerSchedule, getWeather, wmo, loc, DEFAULT_SEASONS, DEFAULT_LOCATION } from './services.js';
import * as I from './integrations.js';
import { disconnect } from './oauth.js';
import { isApp, openExternal } from './net.js';
import { mountCube } from './cube.js';

const ICON_PATHS = {
  home: 'M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  schedule: 'M4 6h16v14H4z M4 10h16 M9 3v4 M15 3v4',
  tasks: 'M9 11l3 3 8-8 M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11',
  goals: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z M12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8z M12 12h.01',
  documents: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 13h7 M9 17h5',
  travel: 'M2 16l20-8-6 13-3-6z M13 15l-4-3',
  health: 'M3 12h4l2-5 4 10 2-5h6',
  notes: 'M4 20h4L19 9l-4-4L4 16z M14 6l4 4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6A7 7 0 0 0 19 12z',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
};
const icon = (k) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON_PATHS[k]}"/></svg>`;

const { state, list, upsert, remove, setSetting, kvGet, kvSet } = S;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TZ = undefined; // use device time zone

// ---------- formatting ----------
const fmtTime = (d) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const fmtDate = (d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => new Date(d).toLocaleDateString('en-GB', { ...opts, timeZone: TZ });
const fmtDay = (d) => new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const daysUntil = (d) => Math.round((startOfDay(new Date(d)) - startOfDay()) / 86400000);
const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();
function countdown(ms) {
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}
const relDays = (n) => n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n > 0 ? `in ${n} days` : `${-n} days ago`;
const minsToHM = (m) => m == null ? '—' : `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`;

// ---------- toast ----------
function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3500);
}

// ---------- modal forms ----------
// fields: [{name,label,type,options,required,placeholder,value}]
function openForm({ title, fields, submitLabel = 'Save', onSubmit, onDelete }) {
  const dlg = $('#modal');
  dlg.innerHTML = `<form method="dialog" class="form">
    <h3>${esc(title)}</h3>
    ${fields.map((f) => {
      const v = f.value ?? '';
      const req = f.required ? 'required' : '';
      let input;
      if (f.type === 'textarea') input = `<textarea name="${f.name}" rows="${f.rows || 4}" placeholder="${esc(f.placeholder || '')}" ${req}>${esc(v)}</textarea>`;
      else if (f.type === 'select') input = `<select name="${f.name}" ${req}>${f.options.map((o) => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`; }).join('')}</select>`;
      else if (f.type === 'file') input = `<input type="file" name="${f.name}" accept="${f.accept || ''}" ${f.multiple ? 'multiple' : ''}>`;
      else input = `<input type="${f.type || 'text'}" name="${f.name}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" ${req} ${f.step ? `step="${f.step}"` : ''}>`;
      return `<label class="${f.wide ? 'wide' : ''}"><span>${esc(f.label)}</span>${input}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</label>`;
    }).join('')}
    <div class="form-actions">
      ${onDelete ? '<button type="button" class="btn danger" data-act="delete">Delete</button>' : ''}
      <span class="spacer"></span>
      <button type="button" class="btn ghost" data-act="cancel">Cancel</button>
      <button type="submit" class="btn primary">${esc(submitLabel)}</button>
    </div>
  </form>`;
  const form = $('form', dlg);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const values = {};
    for (const f of fields) values[f.name] = f.type === 'file' ? fd.getAll(f.name).filter((x) => x.size) : (fd.get(f.name) ?? '').toString().trim();
    try { await onSubmit(values); dlg.close(); } catch (err) { toast(err.message, 'error'); }
  });
  $('[data-act=cancel]', form).onclick = () => dlg.close();
  if (onDelete) $('[data-act=delete]', form).onclick = async () => { if (confirmInline(form)) { await onDelete(); dlg.close(); } };
  dlg.showModal();
}
function confirmInline(form) {
  const b = $('[data-act=delete]', form);
  if (b.dataset.armed) return true;
  b.dataset.armed = '1'; b.textContent = 'Tap again to delete';
  return false;
}

// ---------- navigation ----------
const VIEWS = [
  ['home', 'Home'], ['schedule', 'Schedule'], ['tasks', 'To-do'], ['goals', 'Goals'],
  ['documents', 'Documents'], ['travel', 'Travel'], ['health', 'Sleep & HR'], ['notes', 'Notes'], ['settings', 'Settings'],
];
const MOBILE_TABS = ['home', 'schedule', 'tasks', 'documents', 'more'];
let current = 'home';

function renderNav() {
  $('#nav').innerHTML = VIEWS.map(([id, label]) => `<a href="#${id}" class="${id === current ? 'active' : ''}">${icon(id)}<span>${label}</span></a>`).join('');
  $('#tabs').innerHTML = MOBILE_TABS.map((id) => {
    if (id === 'more') return `<a href="#more" class="${!MOBILE_TABS.includes(current) ? 'active' : ''}">${icon('more')}<span>More</span></a>`;
    const [, label] = VIEWS.find((v) => v[0] === id);
    return `<a href="#${id}" class="${id === current ? 'active' : ''}">${icon(id)}<span>${label}</span></a>`;
  }).join('');
}

function route() {
  const id = (location.hash || '#home').slice(1);
  current = id === 'more' || VIEWS.some((v) => v[0] === id) ? id : 'home';
  renderNav();
  render();
  window.scrollTo(0, 0);
}

async function render() {
  const main = $('#main');
  const fn = VIEW_RENDER[current];
  main.innerHTML = await fn();
  bindView(main);
}

// ---------- shared data getters ----------
const cache = { calendar: null, todo: null, health: null, weather: null, prayer: null };
async function loadCaches() {
  cache.calendar = await kvGet('cache:calendar');
  cache.todo = await kvGet('cache:todo');
  cache.health = await kvGet('cache:health');
}

function upcomingDocs(withinDays = 120) {
  return list('docs').filter((d) => d.expiry).map((d) => ({ ...d, days: daysUntil(d.expiry) }))
    .filter((d) => d.days <= withinDays).sort((a, b) => a.days - b.days);
}
function goalProgress(g) {
  const cps = g.checkpoints || [];
  if (!cps.length) return 0;
  return Math.round((cps.filter((c) => c.done).length / cps.length) * 100);
}
function nextSeasonEvent() {
  const now = Date.now();
  return list('seasons').map((s) => ({ ...s, t: new Date(s.date).getTime() })).filter((s) => s.t > now).sort((a, b) => a.t - b.t)[0];
}
function currentSeason() {
  const now = Date.now();
  return list('seasons').filter((s) => s.kind === 'season').map((s) => ({ ...s, t: new Date(s.date).getTime() })).filter((s) => s.t <= now).sort((a, b) => b.t - a.t)[0];
}

// ---------- cards ----------
function card(title, body, { action = '', cls = '', link = '' } = {}) {
  return `<section class="card ${cls}"><header><h2>${link ? `<a href="#${link}">${esc(title)}</a>` : esc(title)}</h2>${action}</header>${body}</section>`;
}
const empty = (text, cta = '') => `<div class="empty">${esc(text)}${cta}</div>`;

function connectCta(provider, what) {
  const name = provider === 'google' ? 'Google' : 'Microsoft';
  return `<div class="connect"><p>${esc(what)}</p><button class="btn primary sm" data-connect="${provider}">Connect ${name}</button></div>`;
}

async function meetingsBlock({ days = 1, max = 6 } = {}) {
  const evs = cache.calendar?.events || [];
  if (!state.settings.calendarLinks) return `<div class="connect"><p>Paste your Google Calendar's private link to see your Zoom, Teams and Meet calls.</p><a class="btn primary sm" href="#settings">Add link</a></div>`;
  const now = new Date();
  const until = startOfDay(); until.setDate(until.getDate() + days);
  const items = evs.filter((e) => new Date(e.end) > now && new Date(e.start) < until).slice(0, max);
  const reconnect = cache.calendarError ? `<div class="warn">${esc(cache.calendarError)}</div>` : '';
  if (!items.length) return reconnect + empty(days === 1 ? 'No more meetings today' : 'Nothing scheduled.');
  return reconnect + `<ul class="events">${items.map((e) => {
    const live = new Date(e.start) <= now && new Date(e.end) > now;
    const soon = !live && new Date(e.start) - now < 15 * 60000;
    return `<li class="${live ? 'live' : ''}">
      <div class="when">${e.allDay ? 'All day' : fmtTime(e.start)}${days > 1 ? `<small>${fmtDay(e.start)}</small>` : ''}</div>
      <div class="what"><b>${esc(e.title)}</b><small>${e.platform ? `<span class="pill ${e.platform.toLowerCase()}">${e.platform}</span>` : ''}${esc(e.calendar || '')}</small></div>
      ${e.join ? `<a class="btn ${live || soon ? 'primary' : 'ghost'} sm" href="${esc(e.join)}" target="_blank" rel="noopener">${live ? 'Join now' : 'Join'}</a>` : ''}
    </li>`;
  }).join('')}</ul>`;
}

async function todoBlock({ max = 7, showAdd = true } = {}) {
  const status = await I.connectionStatus('microsoft');
  const ms = status === 'disconnected' ? [] : cache.todo?.tasks || [];
  const tasks = [...list('localTasks').filter((t) => !t.done).map((t) => ({ ...t, local: true })), ...ms];
  const sorted = [...tasks].sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (b.importance === 'high') - (a.importance === 'high'));
  const add = showAdd ? `<form class="quick-add" data-form="todo"><input name="title" placeholder="Add a task…" autocomplete="off"><input name="due" type="date" title="Due date (optional)"><button class="btn primary sm">Add</button></form>` : '';
  const note = '';
  const reconnect = status === 'reconnect' ? `<div class="warn">Microsoft needs a quick reconnect. <button class="link" data-connect="microsoft">Reconnect</button></div>` : '';
  const items = sorted.slice(0, max);
  return reconnect + add + (items.length ? `<ul class="tasks">${items.map((t) => {
    const dd = t.due ? daysUntil(t.due) : null;
    return `<li><button class="check" data-done="${esc(t.id)}" data-list="${esc(t.listId || '')}" data-local="${t.local ? 1 : ''}" aria-label="Complete"></button>
      <span class="t">${t.importance === 'high' ? '<b class="star">★</b> ' : ''}${esc(t.title)}</span>
      ${dd != null ? `<small class="${dd < 0 ? 'overdue' : dd <= 1 ? 'soon' : ''}">${relDays(dd)}</small>` : t.list ? `<small>${esc(t.list)}</small>` : ''}${t.local ? `<button class="icon-btn sm" data-edit-task="${esc(t.id)}" title="Edit">✎</button>` : ''}</li>`;
  }).join('')}</ul>${sorted.length > max ? `<a class="more" href="#tasks">+${sorted.length - max} more</a>` : ''}` : empty('All clear.')) + note;
}

function prayerBlock() {
  const p = cache.prayer;
  if (!p) return empty('Loading prayer times…');
  if (p.error) return empty('Prayer times will appear once online.');
  return `<div class="prayer-next"><span>Next: <b>${p.next.name}</b> at ${fmtTime(p.next.time)}</span><strong data-countdown="${p.next.time.getTime()}">${countdown(p.next.time - Date.now())}</strong></div>
    <ul class="prayers">${p.list.map((x) => `<li class="${x.name === p.next.name && sameDay(x.time, p.next.time) ? 'next' : x.time < new Date() ? 'past' : ''}"><span>${x.name}</span><b>${fmtTime(x.time)}</b></li>`).join('')}</ul>
    <small class="muted">${esc(p.hijri)} · ${esc(loc().name)}</small>`;
}

function weatherBlock() {
  const w = cache.weather;
  if (!w) return empty('Loading weather…');
  if (w.error) return empty('Weather will appear once online.');
  const [desc, icon] = wmo(w.current.weather_code);
  return `<div class="wx-now"><span class="wx-icon">${icon}</span><div><strong>${Math.round(w.current.temperature_2m)}°C</strong><small>${desc} · feels ${Math.round(w.current.apparent_temperature)}°C</small><small>Humidity ${w.current.relative_humidity_2m}% · Wind ${Math.round(w.current.wind_speed_10m)} km/h</small></div></div>
    <ul class="wx-days">${w.daily.time.map((d, i) => `<li><span>${i === 0 ? 'Today' : new Date(d).toLocaleDateString('en-GB', { weekday: 'short' })}</span><i>${wmo(w.daily.weather_code[i])[1]}</i><b>${Math.round(w.daily.temperature_2m_max[i])}°</b><small>${Math.round(w.daily.temperature_2m_min[i])}°</small></li>`).join('')}</ul>
    ${w.stale ? '<small class="muted">Offline — showing last update</small>' : ''}`;
}

const PLAN_ICONS = new Proxy({}, { get: (_, k) => `<i class="dot ${String(k)}"></i>` });
function plansBlock({ max = 4 } = {}) {
  const items = list('plans').filter((p) => new Date(p.end || p.date) >= startOfDay()).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, max);
  if (!items.length) return empty('No plans yet.', ' <button class="link" data-add="plan">Add one</button>');
  return `<ul class="plans">${items.map((p) => `<li data-edit-plan="${p.id}"><span class="ic">${PLAN_ICONS[p.type || 'other']}</span><div><b>${esc(p.title)}</b><small>${fmtDay(p.date)}${p.time ? ' · ' + esc(p.time) : ''}${p.end && p.end !== p.date ? ' → ' + fmtDay(p.end) : ''}${p.where ? ' · ' + esc(p.where) : ''}</small></div><small class="rel">${relDays(daysUntil(p.date))}</small></li>`).join('')}</ul>`;
}

function docsAlertBlock() {
  const items = upcomingDocs(120);
  if (!list('docs').length) return empty('Add your passport, civil ID, visas and licences to get expiry reminders.', ' <a class="link" href="#documents">Add documents</a>');
  if (!items.length) return empty('Nothing expires in the next 4 months');
  return `<ul class="alerts">${items.slice(0, 5).map((d) => `<li class="${d.days < 0 ? 'expired' : d.days <= 30 ? 'urgent' : d.days <= 90 ? 'soon' : ''}"><b>${esc(d.name)}</b><small>${d.days < 0 ? 'Expired ' + relDays(d.days) : 'Expires ' + relDays(d.days)} · ${fmtDate(d.expiry)}</small></li>`).join('')}</ul>`;
}

function goalsBlock({ max = 4 } = {}) {
  const goals = list('goals').filter((g) => !g.archived);
  if (!goals.length) return empty('Set a goal and break it into checkpoints.', ' <button class="link" data-add="goal">Add a goal</button>');
  return `<ul class="goals">${goals.slice(0, max).map((g) => {
    const pct = goalProgress(g);
    const next = (g.checkpoints || []).find((c) => !c.done);
    return `<li><a href="#goals"><div class="row"><b>${esc(g.title)}</b><span>${pct}%</span></div><div class="bar"><i style="width:${pct}%"></i></div>${next ? `<small>Next: ${esc(next.title)}${next.date ? ' · ' + fmtDate(next.date, { day: 'numeric', month: 'short' }) : ''}</small>` : '<small>All checkpoints done</small>'}</a></li>`;
  }).join('')}</ul>`;
}

function overwatchBlock() {
  const next = nextSeasonEvent();
  const cur = currentSeason();
  if (!next && !cur) return empty('Add season dates in Settings.');
  return `<div class="ow">${cur ? `<small>Current: <b>${esc(cur.name)}</b></small>` : ''}
    ${next ? `<div class="ow-next"><span>${esc(next.name)}${next.kind === 'mid' ? ' (mid-season)' : ''}</span><strong data-countdown="${next.t}">${countdown(next.t - Date.now())}</strong><small>${fmtDate(next.t, { weekday: 'short', day: 'numeric', month: 'short' })} · ${fmtTime(next.t)} your time${next.note ? ' · ' + esc(next.note) : ''}</small></div>` : ''}</div>`;
}

function sparkline(points, w = 300, h = 60) {
  if (points.length < 2) return '';
  const xs = points.map((p) => p.t.getTime()), ys = points.map((p) => p.bpm);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys) - 3, y1 = Math.max(...ys) + 3;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${(((p.t - x0) / (x1 - x0 || 1)) * w).toFixed(1)},${(h - ((p.bpm - y0) / (y1 - y0 || 1)) * h).toFixed(1)}`).join('');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${d}" /></svg>`;
}

async function healthBlock({ detail = false } = {}) {
  const status = await I.connectionStatus('google');
  const h = cache.health;
  if (!h) return status === 'connected' ? empty('Syncing sleep and heart rate…') : connectCta('google', 'Show last night’s sleep and your heart rate from your Fitbit Air.');
  const last = h.sleep?.[0];
  const avg = h.sleep?.length ? Math.round(h.sleep.reduce((s, x) => s + (x.minutes || 0), 0) / h.sleep.length) : null;
  const latest = h.hr?.[h.hr.length - 1];
  const rest = h.resting?.sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  const hrs = h.hr || [];
  const min = hrs.length ? Math.min(...hrs.map((x) => x.bpm)) : null, max = hrs.length ? Math.max(...hrs.map((x) => x.bpm)) : null;
  let html = `<div class="stats">
    <div><small>Last night</small><strong>${last ? minsToHM(last.minutes) : '—'}</strong><small>${last ? `${fmtTime(last.start)} → ${fmtTime(last.end)}` : h.sleepError ? 'Not available' : 'No data'}</small></div>
    <div><small>7-night avg</small><strong>${minsToHM(avg)}</strong><small>${h.sleep?.length || 0} nights</small></div>
    <div><small>Resting HR</small><strong>${rest ? rest.bpm + ' <em>bpm</em>' : '—'}</strong><small>${rest?.date || ''}</small></div>
    <div><small>Latest HR</small><strong>${latest ? latest.bpm + ' <em>bpm</em>' : '—'}</strong><small>${latest ? fmtTime(latest.t) : h.hrError ? 'Not available' : ''}</small></div>
  </div>`;
  if (hrs.length > 1) html += `<div class="spark-wrap">${sparkline(hrs)}<small>24 h heart rate · ${min}–${max} bpm</small></div>`;
  if (detail && h.sleep?.length) {
    html += `<h3 class="sub">Recent nights</h3><ul class="nights">${h.sleep.map((s) => `<li><span>${fmtDay(s.start)}</span><div class="bar"><i style="width:${Math.min(100, ((s.minutes || 0) / 540) * 100)}%"></i></div><b>${minsToHM(s.minutes)}</b></li>`).join('')}</ul>`;
  }
  html += `<small class="muted">Updated ${fmtTime(h.at)} · syncs every hour${status === 'reconnect' ? ` · <button class="link" data-connect="google">Reconnect</button>` : ''}</small>`;
  return html;
}

// ---------- views ----------
const VIEW_RENDER = {
  async home() {
    const now = new Date();
    const hr = now.getHours();
    const greet = hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    return `<div class="hero"><div><h1>${greet}, Imran</h1><p data-clock-date>${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div><div class="clock" data-clock>${fmtTime(now)}</div></div>
    <div class="grid home-grid">
      ${card('Meetings today', await meetingsBlock(), { link: 'schedule', cls: 'span2', action: '<button class="icon-btn" data-refresh="calendar" title="Refresh">↻</button>' })}
      ${card('Prayer times', prayerBlock(), { cls: 'prayer' })}
      ${card('To-do', await todoBlock(), { link: 'tasks', action: '<button class="icon-btn" data-refresh="todo" title="Refresh">↻</button>' })}
      ${card('Weather', weatherBlock())}
      ${card('Plans', plansBlock(), { link: 'schedule', action: '<button class="icon-btn" data-add="plan" title="Add plan">+</button>' })}
      ${card('Document expiry', docsAlertBlock(), { link: 'documents' })}
      ${card('Sleep & heart rate', await healthBlock(), { link: 'health', action: '<button class="icon-btn" data-refresh="health" title="Refresh">↻</button>' })}
      ${card('Goals', goalsBlock(), { link: 'goals', action: '<button class="icon-btn" data-add="goal" title="Add goal">+</button>' })}
      ${card('Overwatch', overwatchBlock(), { cls: 'ow-card' })}
      ${card('Quick note', `<form data-form="quicknote" class="quick-note"><textarea name="text" rows="3" placeholder="Jot something down…"></textarea><button class="btn primary sm">Save note</button></form>${(() => { const n = list('notes').sort((a, b) => b.updatedAt - a.updatedAt)[0]; return n ? `<a class="more" href="#notes">Last: ${esc(n.text.slice(0, 60))}${n.text.length > 60 ? '…' : ''}</a>` : ''; })()}`)}
    </div>`;
  },

  async schedule() {
    const evs = cache.calendar?.events || [];
    const plans = list('plans').filter((p) => new Date(p.end || p.date) >= startOfDay());
    const all = [
      ...evs.filter((e) => new Date(e.end) >= new Date()).map((e) => ({ kind: 'meeting', date: new Date(e.start), e })),
      ...plans.map((p) => ({ kind: 'plan', date: new Date(p.date + (p.time ? 'T' + p.time : 'T00:00')), p })),
    ].sort((a, b) => a.date - b.date);
    const byDay = new Map();
    for (const it of all) { const k = startOfDay(it.date).toISOString(); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(it); }
    const body = byDay.size ? [...byDay.entries()].map(([k, items]) => `<div class="day"><h3>${fmtDay(k)} <small>${relDays(daysUntil(k))}</small></h3><ul class="events">${items.map((it) => it.kind === 'meeting'
      ? `<li><div class="when">${it.e.allDay ? 'All day' : fmtTime(it.e.start)}</div><div class="what"><b>${esc(it.e.title)}</b><small>${it.e.platform ? `<span class="pill ${it.e.platform.toLowerCase()}">${it.e.platform}</span>` : ''}${esc(it.e.calendar || '')}${it.e.location && !it.e.join ? ' · ' + esc(it.e.location) : ''}</small></div>${it.e.join ? `<a class="btn ghost sm" href="${esc(it.e.join)}" target="_blank" rel="noopener">Join</a>` : ''}</li>`
      : `<li class="plan" data-edit-plan="${it.p.id}"><div class="when">${it.p.time ? esc(it.p.time) : PLAN_ICONS[it.p.type || 'other']}</div><div class="what"><b>${esc(it.p.title)}</b><small><span class="pill plan">${esc(it.p.type)}</span>${it.p.where ? esc(it.p.where) : ''}${it.p.end && it.p.end !== it.p.date ? ' · until ' + fmtDay(it.p.end) : ''}</small></div></li>`).join('')}</ul></div>`).join('') : empty('Nothing in the next two weeks.');
    return `<div class="page-head"><h1>Schedule</h1><div class="actions"><button class="btn ghost" data-refresh="calendar">↻ Refresh</button><button class="btn primary" data-add="plan">+ Add plan</button></div></div>
      ${!state.settings.calendarLinks ? card('Meetings', `<div class="connect"><p>Add your Google Calendar's private link in Settings to see meetings here.</p><a class="btn primary sm" href="#settings">Settings</a></div>`) : ''}
      <section class="card">${body}</section>`;
  },

  async tasks() {
    const lists = cache.todo?.lists || [];
    return `<div class="page-head"><h1>To-do</h1><div class="actions"><button class="btn ghost" data-refresh="todo">↻ Refresh</button></div></div>
      <section class="card">${await todoBlock({ max: 200 })}${lists.length ? `<small class="muted">Includes Microsoft To Do · ${lists.map((l) => esc(l.name)).join(', ')}</small>` : ''}</section>
      ${(() => { const done = list('localTasks').filter((t) => t.done).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10); return done.length ? `<section class="card"><h2>Recently completed</h2><ul class="tasks done-list">${done.map((t) => `<li><button class="check on" data-undo="${esc(t.id)}" title="Mark as not done"></button><span class="t">${esc(t.title)}</span><small>${fmtDate(t.updatedAt, { day: 'numeric', month: 'short' })}</small></li>`).join('')}</ul></section>` : ''; })()}`;
  },

  async goals() {
    const goals = list('goals').sort((a, b) => (a.archived ? 1 : 0) - (b.archived ? 1 : 0) || (a.target || '9').localeCompare(b.target || '9'));
    return `<div class="page-head"><h1>Goals</h1><div class="actions"><button class="btn primary" data-add="goal">+ New goal</button></div></div>
    ${goals.length ? `<div class="grid">${goals.map((g) => {
      const pct = goalProgress(g);
      return `<section class="card goal ${g.archived ? 'archived' : ''}"><header><h2>${esc(g.title)}</h2><button class="icon-btn" data-edit-goal="${g.id}" title="Edit">✎</button></header>
        ${g.why ? `<p class="muted">${esc(g.why)}</p>` : ''}
        <div class="row"><small>${g.target ? 'Target ' + fmtDate(g.target) + ' · ' + relDays(daysUntil(g.target)) : 'No target date'}</small><b>${pct}%</b></div><div class="bar"><i style="width:${pct}%"></i></div>
        <ul class="checkpoints">${(g.checkpoints || []).map((c, i) => `<li class="${c.done ? 'done' : ''}"><button class="check ${c.done ? 'on' : ''}" data-cp="${g.id}:${i}"></button><span>${esc(c.title)}</span>${c.date ? `<small class="${!c.done && daysUntil(c.date) < 0 ? 'overdue' : ''}">${fmtDate(c.date, { day: 'numeric', month: 'short' })}</small>` : ''}</li>`).join('')}</ul>
        <form class="quick-add" data-form="checkpoint" data-goal="${g.id}"><input name="title" placeholder="Add checkpoint…"><input name="date" type="date"><button class="btn sm">Add</button></form>
      </section>`;
    }).join('')}</div>` : card('No goals yet', empty('Examples: “Finish Revit course”, “Pass CFA Level I”, “Sub-15s cube average”.', ' <button class="link" data-add="goal">Create your first goal</button>'))}`;
  },

  async documents() {
    const docs = list('docs').map((d) => ({ ...d, days: d.expiry ? daysUntil(d.expiry) : null })).sort((a, b) => (a.days ?? 99999) - (b.days ?? 99999));
    const groups = [['Visas', (d) => /visa/i.test(d.type)], ['IDs & passports', (d) => /passport|civil|id|licen/i.test(d.type) && !/visa/i.test(d.type)], ['Other', () => true]];
    const used = new Set();
    const sections = groups.map(([title, test]) => {
      const items = docs.filter((d) => !used.has(d.id) && test(d)); items.forEach((d) => used.add(d.id));
      return items.length ? `<h3 class="sub">${title}</h3><div class="doc-grid">${items.map(docCard).join('')}</div>` : '';
    }).join('');
    return `<div class="page-head"><h1>Documents & visas</h1><div class="actions"><button class="btn primary" data-add="doc">+ Add document</button></div></div>
      <p class="muted">Stored on your devices and in your own OneDrive only. You'll get reminders 90, 30 and 7 days before anything expires.</p>
      ${docs.length ? sections : card('Nothing added yet', empty('Add your passport, Kuwait civil ID, e-visas, visa stickers and driving licence. You can attach a photo or scan of each.', ' <button class="link" data-add="doc">Add the first one</button>'))}`;
  },

  async travel() {
    const trips = list('trips').sort((a, b) => b.from.localeCompare(a.from));
    const countries = new Map();
    for (const t of trips) countries.set(t.country, (countries.get(t.country) || 0) + 1);
    const daysAbroad = trips.reduce((s, t) => s + Math.max(1, Math.round((new Date(t.to || t.from) - new Date(t.from)) / 86400000) + 1), 0);
    const years = new Map();
    for (const t of trips) { const y = t.from.slice(0, 4); years.set(y, (years.get(y) || 0) + 1); }
    const thisYear = String(new Date().getFullYear());
    return `<div class="page-head"><h1>Travel history</h1><div class="actions"><button class="btn ghost" data-import="trips">Import CSV</button><button class="btn primary" data-add="trip">+ Add trip</button></div></div>
      <div class="stat-row">
        <div class="stat"><strong>${trips.length}</strong><small>trips</small></div>
        <div class="stat"><strong>${countries.size}</strong><small>countries</small></div>
        <div class="stat"><strong>${daysAbroad}</strong><small>days away</small></div>
        <div class="stat"><strong>${years.get(thisYear) || 0}</strong><small>trips in ${thisYear}</small></div>
      </div>
      ${trips.length ? `<section class="card"><h2>Countries</h2><div class="chips">${[...countries.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `<span class="chip">${esc(c)} <b>${n}</b></span>`).join('')}</div></section>
      <section class="card"><table class="table"><thead><tr><th>Dates</th><th>Country</th><th>Purpose</th><th>Cities</th></tr></thead><tbody>
      ${trips.map((t) => `<tr data-edit-trip="${t.id}"><td>${fmtDate(t.from)}${t.to && t.to !== t.from ? ' – ' + fmtDate(t.to) : ''}</td><td>${esc(t.country)}</td><td>${esc(t.purpose || '')}</td><td>${esc(t.cities || '')}</td></tr>`).join('')}
      </tbody></table></section>` : card('No trips yet', empty('Import your travel log (CSV with columns: from, to, country, purpose, cities) or add trips one by one.'))}`;
  },

  async health() {
    return `<div class="page-head"><h1>Sleep & heart rate</h1><div class="actions"><button class="btn ghost" data-refresh="health">↻ Sync now</button></div></div>
      <section class="card">${await healthBlock({ detail: true })}</section>
      <p class="muted">Data comes from your Fitbit Air through the Google Health app. It refreshes every hour while the dashboard is open (the Windows app stays running in the system tray).</p>`;
  },

  async notes() {
    const notes = list('notes').sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
    return `<div class="page-head"><h1>Notes</h1></div>
      <section class="card"><form data-form="quicknote" class="quick-note"><textarea name="text" rows="3" placeholder="New note…"></textarea><button class="btn primary sm">Save</button></form></section>
      <div class="notes">${notes.map((n) => `<article class="note ${n.pinned ? 'pinned' : ''}"><p>${esc(n.text).replace(/\n/g, '<br>')}</p><footer><small>${fmtDate(n.updatedAt, { day: 'numeric', month: 'short' })} ${fmtTime(n.updatedAt)}</small><span><button class="link" data-pin="${n.id}">${n.pinned ? 'Unpin' : 'Pin'}</button> <button class="link" data-edit-note="${n.id}">Edit</button></span></footer></article>`).join('') || empty('No notes yet.')}</div>`;
  },

  async more() {
    return `<div class="page-head"><h1>More</h1></div><div class="more-grid">${VIEWS.filter(([id]) => !MOBILE_TABS.includes(id)).map(([id, label]) => `<a href="#${id}" class="card more-tile">${icon(id)}<span>${label}</span></a>`).join('')}</div>`;
  },

  async settings() {
    const gs = await I.connectionStatus('google');
    const ms = await I.connectionStatus('microsoft');
    const badge = (s) => `<span class="badge ${s}">${s === 'connected' ? 'Connected' : s === 'reconnect' ? 'Needs reconnect' : 'Not connected'}</span>`;
    const l = loc();
    const calAt = cache.calendar?.at;
    return `<div class="page-head"><h1>Settings</h1></div>
    <div class="grid">
      ${card('Calendar (meetings)', `<p class="muted">In Google Calendar on the web: Settings → your calendar → <b>Integrate calendar</b> → copy <b>Secret address in iCal format</b> and paste it here. Add more than one link (e.g. work and personal) on separate lines.</p>
        <form data-form="calendar" class="stack"><label><span>Private iCal link(s)</span><textarea name="calendarLinks" rows="3" placeholder="https://calendar.google.com/calendar/ical/…/private-…/basic.ics">${esc(state.settings.calendarLinks || '')}</textarea><small>Treat this link like a password — anyone with it can read your calendar.</small></label>
        <div class="row">${calAt ? `<small class="muted">Last updated ${fmtTime(calAt)}${cache.calendar?.events ? ' · ' + cache.calendar.events.length + ' events in the next 2 weeks' : ''}</small>` : ''}<span class="spacer"></span><button class="btn primary sm">Save</button></div></form>`)}
      ${card('Fitbit Air — sleep & heart rate', `<p class="muted">Needs a free Google Cloud “Desktop app” client (10-minute setup, see the guide). Your health data goes straight from Google to this computer.</p>
        <form data-form="google-settings" class="stack"><label><span>Client ID</span><input name="googleClientId" value="${esc(state.settings.googleClientId || '')}" placeholder="xxxx.apps.googleusercontent.com"></label>
        <label><span>Client secret</span><input name="googleClientSecret" type="password" value="${esc(state.settings.googleClientSecret || '')}" placeholder="GOCSPX-…"><small>Stays on this computer only.</small></label>
        <div class="row">${badge(gs)}<span class="spacer"></span><button class="btn ghost sm" type="submit">Save</button>${gs !== 'disconnected' ? '<button type="button" class="btn ghost sm" data-disconnect="google">Disconnect</button>' : ''}<button type="button" class="btn primary sm" data-connect="google">${gs === 'connected' ? 'Reconnect' : 'Connect'}</button></div></form>`)}
      ${card('Microsoft To Do (optional)', `<p class="muted">Your to-do list already works inside the app. Connect this only if you also want tasks from the Microsoft To Do app to show up.</p>
        <form data-form="ms-settings" class="stack"><label><span>Application (client) ID</span><input name="msClientId" value="${esc(state.settings.msClientId || '')}" placeholder="00000000-0000-0000-0000-000000000000"></label>
        <div class="row">${badge(ms)}<span class="spacer"></span><button class="btn ghost sm" type="submit">Save</button>${ms !== 'disconnected' ? '<button type="button" class="btn ghost sm" data-disconnect="microsoft">Disconnect</button>' : ''}<button type="button" class="btn primary sm" data-connect="microsoft">${ms === 'connected' ? 'Reconnect' : 'Connect'}</button></div></form>`)}
      ${card('Location', `<form data-form="location" class="stack"><label><span>Name</span><input name="name" value="${esc(l.name)}"></label><div class="row2"><label><span>Latitude</span><input name="lat" type="number" step="0.0001" value="${l.lat}"></label><label><span>Longitude</span><input name="lon" type="number" step="0.0001" value="${l.lon}"></label></div><div class="row"><button type="button" class="btn ghost sm" data-reset-loc>Kuwait City</button><span class="spacer"></span><button class="btn primary sm">Save</button></div></form><small class="muted">Used for prayer times (Kuwait method) and weather. Units: °C, km/h.</small>`)}
      ${card('Notifications', `<form data-form="notify" class="stack">
        <label class="toggle"><input type="checkbox" name="notifyMeetings" ${state.settings.notifyMeetings !== false ? 'checked' : ''}><span>Alert 10 minutes before meetings</span></label>
        <label class="toggle"><input type="checkbox" name="notifyPrayer" ${state.settings.notifyPrayer ? 'checked' : ''}><span>Alert at each prayer time</span></label>
        <label class="toggle"><input type="checkbox" name="notifyDocs" ${state.settings.notifyDocs !== false ? 'checked' : ''}><span>Document expiry reminders (90 / 30 / 7 days)</span></label>
        <div class="row"><small class="muted">Shown as Windows notifications while the app runs (it keeps running in the system tray).</small><span class="spacer"></span><button class="btn primary sm">Save</button></div></form>`)}
      ${card('Overwatch dates', `<ul class="seasons">${list('seasons').sort((a, b) => a.date.localeCompare(b.date)).map((s) => `<li data-edit-season="${s.id}"><b>${esc(s.name)}</b><small>${s.kind === 'mid' ? 'Mid-season · ' : ''}${fmtDate(s.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} ${fmtTime(s.date)}${s.note ? ' · ' + esc(s.note) : ''}</small></li>`).join('')}</ul><button class="btn ghost sm" data-add="season">+ Add date</button>`)}
      ${card('Backup', `<p class="muted">Download everything as a file, or restore from one.</p><div class="row"><button class="btn ghost sm" data-export>Download backup</button><button class="btn ghost sm" data-import="backup">Restore backup</button></div>`)}
    </div>`;
  },
};

function docCard(d) {
  const cls = d.days == null ? '' : d.days < 0 ? 'expired' : d.days <= 30 ? 'urgent' : d.days <= 90 ? 'soon' : 'ok';
  return `<article class="doc ${cls}" data-edit-doc="${d.id}">
    <div class="thumb" data-thumb="${esc((d.images || [])[0] || '')}">${(d.images || []).length ? '' : '<span>▤</span>'}</div>
    <div class="info"><b>${esc(d.name)}</b><small>${esc(d.type)}${d.country ? ' · ' + esc(d.country) : ''}${d.entries ? ' · ' + esc(d.entries) : ''}</small>
    ${d.expiry ? `<span class="exp">${d.days < 0 ? 'Expired' : 'Expires'} ${fmtDate(d.expiry)} <em>${relDays(d.days)}</em></span>` : '<span class="exp">No expiry</span>'}
    ${d.stay ? `<small>Max stay: ${esc(d.stay)}</small>` : ''}</div></article>`;
}

// ---------- forms ----------
function planForm(p = {}) {
  openForm({
    title: p.id ? 'Edit plan' : 'New plan',
    fields: [
      { name: 'title', label: 'What', required: true, value: p.title, placeholder: 'Family dinner, outing with friends, trip to…', wide: true },
      { name: 'type', label: 'Type', type: 'select', options: [['family', 'Family'], ['friends', 'Friends'], ['travel', 'Travel'], ['work', 'Work'], ['other', 'Other']], value: p.type || 'family' },
      { name: 'date', label: 'Date', type: 'date', required: true, value: p.date },
      { name: 'time', label: 'Time (optional)', type: 'time', value: p.time },
      { name: 'end', label: 'Until (multi-day)', type: 'date', value: p.end },
      { name: 'where', label: 'Where', value: p.where, wide: true },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 3, value: p.notes, wide: true },
    ],
    onSubmit: (v) => upsert('plans', { ...p, ...v }),
    onDelete: p.id ? () => remove('plans', p.id) : null,
  });
}

function goalForm(g = {}) {
  openForm({
    title: g.id ? 'Edit goal' : 'New goal',
    fields: [
      { name: 'title', label: 'Goal', required: true, value: g.title, wide: true },
      { name: 'why', label: 'Why it matters (optional)', value: g.why, wide: true },
      { name: 'target', label: 'Target date', type: 'date', value: g.target },
      { name: 'archived', label: 'Status', type: 'select', options: [['', 'Active'], ['1', 'Archived']], value: g.archived ? '1' : '' },
      { name: 'checkpoints', label: 'Checkpoints — one per line, optional date after “|”', type: 'textarea', rows: 6, wide: true,
        value: (g.checkpoints || []).map((c) => `${c.done ? '[x] ' : ''}${c.title}${c.date ? ' | ' + c.date : ''}`).join('\n'),
        placeholder: 'Finish AutoCAD module 1 | 2026-11-30\nStart Revit basics | 2026-12-15' },
    ],
    onSubmit: (v) => upsert('goals', {
      ...g, title: v.title, why: v.why, target: v.target, archived: !!v.archived,
      checkpoints: v.checkpoints.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const done = /^\[x\]\s*/i.test(l); l = l.replace(/^\[x\]\s*/i, '');
        const [title, date] = l.split('|').map((x) => x.trim());
        return { title, date: date || '', done };
      }),
    }),
    onDelete: g.id ? () => remove('goals', g.id) : null,
  });
}

async function compressImage(file, maxDim = 1800) {
  if (!file.type.startsWith('image/')) return file; // PDFs etc. stored as-is
  const img = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
}

function docForm(d = {}) {
  openForm({
    title: d.id ? 'Edit document' : 'Add document',
    fields: [
      { name: 'name', label: 'Name', required: true, value: d.name, placeholder: 'e.g. UK e-Visa, Pakistan passport', wide: true },
      { name: 'type', label: 'Type', type: 'select', options: ['Passport', 'Civil ID', 'E-visa', 'Visa sticker', 'Residence permit', 'Driving licence', 'Insurance', 'Other'], value: d.type || 'Passport' },
      { name: 'country', label: 'Country', value: d.country },
      { name: 'issued', label: 'Issue date', type: 'date', value: d.issued },
      { name: 'expiry', label: 'Expiry date', type: 'date', value: d.expiry },
      { name: 'entries', label: 'Entries (visas)', type: 'select', options: ['', 'Single entry', 'Double entry', 'Multiple entry'], value: d.entries || '' },
      { name: 'stay', label: 'Max stay (visas)', value: d.stay, placeholder: 'e.g. 90 days per visit' },
      { name: 'ref', label: 'Reference (last 4 digits only)', value: d.ref, placeholder: 'e.g. …4417', hint: 'Avoid full document numbers.' },
      { name: 'files', label: d.images?.length ? `Replace scan/photo (${d.images.length} attached)` : 'Scan or photo (optional)', type: 'file', accept: 'image/*,application/pdf', multiple: true, wide: true },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, value: d.notes, wide: true },
    ],
    onSubmit: async (v) => {
      let images = d.images || [];
      if (v.files.length) {
        images = [];
        for (const f of v.files) { const key = 'doc-' + S.uid() + (f.type === 'application/pdf' ? '.pdf' : '.jpg'); await S.fileSet(key, await compressImage(f)); images.push(key); }
      }
      const { files, ...rest } = v;
      await upsert('docs', { ...d, ...rest, images });
    },
    onDelete: d.id ? () => remove('docs', d.id) : null,
  });
}

function tripForm(t = {}) {
  openForm({
    title: t.id ? 'Edit trip' : 'Add trip',
    fields: [
      { name: 'from', label: 'From', type: 'date', required: true, value: t.from },
      { name: 'to', label: 'To', type: 'date', value: t.to },
      { name: 'country', label: 'Country', required: true, value: t.country },
      { name: 'purpose', label: 'Purpose', type: 'select', options: ['Leisure', 'Studies', 'Home visit', 'Umrah', 'Transit', 'Work', 'Other'], value: t.purpose || 'Leisure' },
      { name: 'cities', label: 'Cities', value: t.cities, wide: true },
    ],
    onSubmit: (v) => upsert('trips', { ...t, ...v }),
    onDelete: t.id ? () => remove('trips', t.id) : null,
  });
}

function seasonForm(s = {}) {
  const local = s.date ? new Date(new Date(s.date).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  openForm({
    title: s.id ? 'Edit Overwatch date' : 'Add Overwatch date',
    fields: [
      { name: 'name', label: 'Name', required: true, value: s.name, placeholder: 'Season 6 / Season 6 mid-season patch' },
      { name: 'kind', label: 'Kind', type: 'select', options: [['season', 'New season'], ['mid', 'Mid-season update'], ['event', 'Event']], value: s.kind || 'season' },
      { name: 'date', label: 'Date & time (your time)', type: 'datetime-local', required: true, value: local },
      { name: 'note', label: 'Note', value: s.note },
    ],
    onSubmit: (v) => upsert('seasons', { ...s, ...v, date: new Date(v.date).toISOString() }),
    onDelete: s.id ? () => remove('seasons', s.id) : null,
  });
}

function taskForm(t) {
  openForm({ title: 'Edit task', fields: [
      { name: 'title', label: 'Task', required: true, value: t.title, wide: true },
      { name: 'due', label: 'Due date', type: 'date', value: t.due || '' },
      { name: 'important', label: 'Priority', type: 'select', options: [['', 'Normal'], ['1', 'Important']], value: t.importance === 'high' ? '1' : '' },
    ],
    onSubmit: (v) => upsert('localTasks', { ...t, title: v.title, due: v.due || null, importance: v.important ? 'high' : 'normal' }),
    onDelete: () => remove('localTasks', t.id) });
}

function noteForm(n) {
  openForm({ title: 'Edit note', fields: [{ name: 'text', label: 'Note', type: 'textarea', rows: 8, value: n.text, wide: true, required: true }],
    onSubmit: (v) => upsert('notes', { ...n, text: v.text }), onDelete: () => remove('notes', n.id) });
}

// CSV parser that handles quoted fields
function parseCSV(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
const toISO = (s) => { s = s.trim(); const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : s; };

function pickFile(accept) {
  return new Promise((resolve) => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept;
    inp.onchange = () => resolve(inp.files[0]); inp.click();
  });
}

// ---------- event binding ----------
function bindView(root) {
  root.onclick = async (e) => {
    const ext = e.target.closest('a[target=_blank]');
    if (ext && isApp()) { e.preventDefault(); return openExternal(ext.href); }
    const t = e.target.closest('button, [data-edit-plan], [data-edit-doc], [data-edit-trip], [data-edit-season]');
    if (!t) return;
    const ds = t.dataset;
    try {
      if (ds.connect) {
        toast('Finish signing in in your browser…');
        await I.connect(ds.connect);
        toast('Connected', 'ok');
        await refresh(ds.connect === 'google' ? 'health' : 'todo');
        return render();
      }
      if (ds.disconnect) { await disconnect(ds.disconnect); await kvSet(ds.disconnect === 'google' ? 'cache:health' : 'cache:todo', null); await loadCaches(); return render(); }
      if (ds.undo) { const lt = list('localTasks').find((x) => x.id === ds.undo); return upsert('localTasks', { ...lt, done: false }); }
      if (ds.editTask) { const lt = list('localTasks').find((x) => x.id === ds.editTask); return taskForm(lt); }
      if (ds.refresh) { t.classList.add('spin'); await refresh(ds.refresh, true); t.classList.remove('spin'); return; }
      if (ds.add === 'plan') return planForm();
      if (ds.add === 'goal') return goalForm();
      if (ds.add === 'doc') return docForm();
      if (ds.add === 'trip') return tripForm();
      if (ds.add === 'season') return seasonForm();
      if (ds.editPlan) return planForm(list('plans').find((x) => x.id === ds.editPlan));
      if (ds.editGoal) return goalForm(list('goals').find((x) => x.id === ds.editGoal));
      if (ds.editDoc) return docForm(list('docs').find((x) => x.id === ds.editDoc));
      if (ds.editTrip) return tripForm(list('trips').find((x) => x.id === ds.editTrip));
      if (ds.editSeason) return seasonForm(list('seasons').find((x) => x.id === ds.editSeason));
      if (ds.editNote) return noteForm(list('notes').find((x) => x.id === ds.editNote));
      if (ds.pin) { const n = list('notes').find((x) => x.id === ds.pin); return upsert('notes', { ...n, pinned: !n.pinned }); }
      if (ds.cp) {
        const [gid, idx] = ds.cp.split(':'); const g = list('goals').find((x) => x.id === gid);
        const cps = g.checkpoints.map((c, i) => (i === +idx ? { ...c, done: !c.done } : c));
        return upsert('goals', { ...g, checkpoints: cps });
      }
      if (ds.done !== undefined && t.classList.contains('check')) {
        t.classList.add('on');
        if (ds.local) { const lt = list('localTasks').find((x) => x.id === ds.done); return upsert('localTasks', { ...lt, done: true }); }
        await I.completeTodo(ds.list, ds.done);
        cache.todo.tasks = cache.todo.tasks.filter((x) => x.id !== ds.done); await kvSet('cache:todo', cache.todo);
        return render();
      }
      if (ds.resetLoc !== undefined) { await setSetting('location', DEFAULT_LOCATION); await refresh('weather', true); await refresh('prayer'); return render(); }
      if (ds.export !== undefined) {
        const blob = new Blob([JSON.stringify(S.snapshot(), null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `dashboard-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
        return;
      }
      if (ds.import === 'backup') { const f = await pickFile('application/json'); if (!f) return; await S.importSnapshot(JSON.parse(await f.text()), { merge: true }); return toast('Backup restored', 'ok'); }
      if (ds.import === 'trips') {
        const f = await pickFile('.csv,text/csv'); if (!f) return;
        const rows = parseCSV(await f.text());
        const header = rows[0].map((h) => h.trim().toLowerCase());
        const col = (n) => header.indexOf(n);
        const existing = new Set(list('trips').map((t) => `${t.from}|${t.country}`));
        let added = 0;
        for (const r of rows.slice(1)) {
          const trip = { from: toISO(r[col('from')] || ''), to: toISO(r[col('to')] || ''), country: (r[col('country')] || '').trim(), purpose: (r[col('purpose')] || '').trim(), cities: (r[col('cities')] || '').trim() };
          if (!trip.from || !trip.country || existing.has(`${trip.from}|${trip.country}`)) continue;
          await upsert('trips', trip); added++;
        }
        return toast(`Imported ${added} trips`, 'ok');
      }
    } catch (err) { toast(err.message, 'error'); }
  };

  root.onsubmit = async (e) => {
    const form = e.target; const kind = form.dataset.form; if (!kind) return;
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form).entries());
    try {
      if (kind === 'todo') {
        if (!v.title.trim()) return;
        await upsert('localTasks', { title: v.title.trim(), due: v.due || null, done: false });
      } else if (kind === 'quicknote') {
        if (!v.text.trim()) return; await upsert('notes', { text: v.text.trim() }); toast('Note saved', 'ok');
      } else if (kind === 'checkpoint') {
        if (!v.title.trim()) return; const g = list('goals').find((x) => x.id === form.dataset.goal);
        await upsert('goals', { ...g, checkpoints: [...(g.checkpoints || []), { title: v.title.trim(), date: v.date, done: false }] });
      } else if (kind === 'calendar') {
        await setSetting('calendarLinks', v.calendarLinks.trim()); toast('Saved — loading calendar…', 'ok'); await refresh('calendar', true);
      } else if (kind === 'google-settings') {
        await setSetting('googleClientId', v.googleClientId.trim()); await setSetting('googleClientSecret', v.googleClientSecret.trim()); toast('Saved', 'ok');
      } else if (kind === 'ms-settings') {
        await setSetting('msClientId', v.msClientId.trim()); toast('Saved', 'ok');
      } else if (kind === 'location') {
        await setSetting('location', { name: v.name || 'Custom', lat: +v.lat, lon: +v.lon }); await refresh('weather', true); await refresh('prayer'); toast('Location saved', 'ok');
      } else if (kind === 'notify') {
        await setSetting('notifyMeetings', !!v.notifyMeetings); await setSetting('notifyPrayer', !!v.notifyPrayer); await setSetting('notifyDocs', !!v.notifyDocs);
        if (!isApp() && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
        toast('Saved', 'ok'); render();
      }
    } catch (err) { toast(err.message, 'error'); }
  };

  // load document thumbnails from IndexedDB
  $$('[data-thumb]', root).forEach(async (el) => {
    const key = el.dataset.thumb; if (!key) return;
    const blob = await S.fileGet(key);
    if (!blob) { el.innerHTML = '<span title="Syncing">⟳</span>'; return; }
    if (key.endsWith('.pdf')) { el.innerHTML = '<span>PDF</span>'; el.onclick = (ev) => { ev.stopPropagation(); window.open(URL.createObjectURL(blob)); }; return; }
    const url = URL.createObjectURL(blob);
    el.style.backgroundImage = `url(${url})`;
    el.onclick = (ev) => { ev.stopPropagation(); const v = $('#viewer'); v.innerHTML = `<img src="${url}"><button class="btn ghost" onclick="this.closest('dialog').close()">Close</button>`; v.showModal(); };
  });
}

// ---------- syncing ----------
const LAST = {};
async function refresh(what, manual = false) {
  try {
    if (what === 'calendar') {
      if (!state.settings.calendarLinks) return;
      try { await I.syncCalendar(); cache.calendarError = null; } catch (e) { cache.calendarError = navigator.onLine ? e.message : null; throw e; }
      cache.calendar = await kvGet('cache:calendar');
    }
    if (what === 'todo') { if (await I.connectionStatus('microsoft') === 'disconnected') return; await I.syncTodo(); cache.todo = await kvGet('cache:todo'); }
    if (what === 'health') { if (await I.connectionStatus('google') === 'disconnected') return; await I.syncHealth(); cache.health = await kvGet('cache:health'); }
    if (what === 'weather') { cache.weather = await getWeather({ force: manual }).catch((e) => ({ error: e.message })); }
    if (what === 'prayer') { cache.prayer = await getPrayerSchedule().catch((e) => ({ error: e.message })); }
    LAST[what] = Date.now();
    if (manual) toast('Updated', 'ok');
  } catch (e) {
    if (e.code === 'AUTH') { if (manual) toast('Please reconnect your account', 'error'); }
    else if (manual) toast(e.message, 'error');
    else console.warn(what, e);
  }
  render();
}

const EVERY = { calendar: 10, todo: 15, weather: 30, prayer: 60, health: 60 }; // minutes
async function tick() {
  for (const [what, mins] of Object.entries(EVERY)) {
    if (!LAST[what] || Date.now() - LAST[what] > mins * 60000) await refresh(what);
  }
  checkNotifications();
}

// ---------- notifications ----------
async function notify(key, title, body) {
  const inApp = isApp();
  if (!inApp && (!('Notification' in window) || Notification.permission !== 'granted')) return;
  const sent = await kvGet('notified', {});
  if (sent[key]) return;
  sent[key] = Date.now(); await kvSet('notified', sent);
  if (inApp) return window.__TAURI__.core.invoke('notify', { title, body }).catch(() => {});
  try { new Notification(title, { body, icon: 'icons/icon-192.png', tag: key }); } catch { /* ignore */ }
}
function checkNotifications() {
  const now = Date.now();
  if (state.settings.notifyMeetings !== false) {
    for (const e of cache.calendar?.events || []) {
      if (e.allDay) continue;
      const diff = new Date(e.start) - now;
      if (diff > 0 && diff <= 10 * 60000) notify('ev:' + e.id + e.start, `${e.title} in ${Math.ceil(diff / 60000)} min`, e.platform ? `${e.platform} — open the dashboard to join` : e.location || '');
    }
  }
  if (state.settings.notifyPrayer && cache.prayer?.list) {
    for (const p of cache.prayer.list) {
      if (p.name === 'Sunrise') continue;
      const diff = now - p.time;
      if (diff >= 0 && diff < 5 * 60000) notify('pr:' + p.time.toISOString(), `${p.name}`, `It's time for ${p.name} (${fmtTime(p.time)})`);
    }
  }
  if (state.settings.notifyDocs !== false) {
    for (const d of upcomingDocs(90)) {
      const stage = d.days < 0 ? 'expired' : d.days <= 7 ? '7' : d.days <= 30 ? '30' : '90';
      notify(`doc:${d.id}:${d.expiry}:${stage}`, `${d.name} ${d.days < 0 ? 'has expired' : 'expires ' + relDays(d.days)}`, `Expiry: ${fmtDate(d.expiry)}`);
    }
  }
}

// ---------- live clock / countdowns (no re-render) ----------
function liveUpdate() {
  const now = new Date();
  $$('[data-clock]').forEach((el) => (el.textContent = fmtTime(now)));
  $$('[data-countdown]').forEach((el) => (el.textContent = countdown(+el.dataset.countdown - now)));
  if (cache.prayer?.next && now > cache.prayer.next.time) refresh('prayer');
}

// ---------- startup ----------
async function start() {
  await S.loadState();
  if (!state.settings.owSeasonsSeeded) {
    for (const s of DEFAULT_SEASONS) await upsert('seasons', s);
    await setSetting('owSeasonsSeeded', true);
  }
  await loadCaches();
  mountCube($('#cube'));
  addEventListener('hashchange', route);
  route();
  S.onChange(() => render());
  await Promise.all([refresh('weather'), refresh('prayer')]);
  tick();
  setInterval(tick, 60_000);
  setInterval(liveUpdate, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  addEventListener('online', () => { for (const k of Object.keys(LAST)) LAST[k] = 0; tick(); });
}


start();
