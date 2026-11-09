import * as S from './store.js';
import { getPrayerSchedule, getWeather, wmo, loc, DEFAULT_SEASONS, DEFAULT_LOCATION } from './services.js';
import * as I from './integrations.js';
import { disconnect } from './oauth.js';
import { isApp, openExternal, joinMeeting } from './net.js';
import { wxIcon, moonInfo, moonSVG, clockFace, zoneTime } from './visuals.js';
import { mountCube } from './cube.js';
import * as V from './vault.js';

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
  files: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  weather: 'M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 11 3.5 3.5 0 0 0 7 18z',
};
const icon = (k) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON_PATHS[k]}"/></svg>`;

const { state, list, upsert, remove, setSetting, kvGet, kvSet } = S;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TZ = undefined; // use device time zone

// ---------- formatting ----------
// 'YYYY-MM-DD' strings are calendar dates in local time (new Date('2026-11-10') would be UTC midnight).
const D = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) : new Date(d));
const fmtTime = (d) => D(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ }).replace(/\s?([AP])M/, (_, x) => ' ' + x.toLowerCase() + 'm');
const fmtDate = (d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => D(d).toLocaleDateString('en-GB', { ...opts, timeZone: TZ });
const fmtDay = (d) => D(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const startOfDay = (d = new Date()) => { const x = D(d); x.setHours(0, 0, 0, 0); return x; };
const daysUntil = (d) => Math.round((startOfDay(d) - startOfDay()) / 86400000);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

// Tauri reports errors as plain strings; browsers as Error objects.
const errText = (e) => (typeof e === 'string' ? e : e?.message || String(e));

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
  const np = form.querySelector('[name=newPerson]');
  if (np) { const sel = form.querySelector('[name=person]'); const sync = () => { np.closest('label').style.display = sel.value === '__new__' ? '' : 'none'; if (sel.value === '__new__') np.focus(); }; sel.onchange = sync; sync(); }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const values = {};
    for (const f of fields) values[f.name] = f.type === 'file' ? fd.getAll(f.name).filter((x) => x.size) : (fd.get(f.name) ?? '').toString().trim();
    try { await onSubmit(values); dlg.close(); } catch (err) { toast(errText(err), 'error'); }
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
  ['home', 'Home'], ['schedule', 'Calendar'], ['tasks', 'To-do'], ['weather', 'Weather'], ['goals', 'Goals'],
  ['files', 'Files'], ['documents', 'Expiry dates'], ['travel', 'Travel'], ['health', 'Sleep & HR'], ['notes', 'Notes'], ['settings', 'Settings'],
];
const MOBILE_TABS = ['home', 'schedule', 'tasks', 'files', 'more'];
const people = () => (state.settings.people?.length ? state.settings.people : ['Imran']);
const filesView = { person: null, category: 'All', q: '' };
let docsPerson = 'All';
const travelView = { tab: 'trips' };
const fmtSize = (b) => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
const WORLD = [['London', 'Europe/London'], ['New York', 'America/New_York'], ['Karachi', 'Asia/Karachi']];
const calView = { y: new Date().getFullYear(), m: new Date().getMonth(), sel: null };
const fmt24 = (d) => { const x = D(d); return String(x.getHours()).padStart(2, '0') + String(x.getMinutes()).padStart(2, '0'); };
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
  doRender(true);
  window.scrollTo({ top: 0 });
}

// Re-rendering is batched (one per frame) and postponed while you're typing in a field or
// have a form open, so background updates never wipe what you're writing.
let renderQueued = false, rendering = false, pendingAfter = false;
function render() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; doRender(false); });
}
function isBusy() {
  const a = document.activeElement;
  if ($('#modal')?.open) return true;
  return !!(a && $('#main').contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && (a.value || a.type === 'date'));
}
async function doRender(entering, force = false) {
  if (!entering && !force && isBusy()) { pendingAfter = true; return; }
  if (rendering) { pendingAfter = true; return; }
  rendering = true;
  try {
    const main = $('#main');
    const html = await VIEW_RENDER[current]();
    main.classList.toggle('enter', entering);
    main.innerHTML = html;
    if (entering) { void main.offsetWidth; requestAnimationFrame(() => main.classList.remove('enter')); }
    bindView(main);
    liveUpdate();
  } finally {
    rendering = false;
    if (pendingAfter && !isBusy()) { pendingAfter = false; render(); }
  }
}
document.addEventListener('focusout', () => setTimeout(() => { if (pendingAfter && !isBusy()) { pendingAfter = false; render(); } }, 50));

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
  if (!I.calendars().length) return `<div class="connect"><p>Add your calendars (Google, Plot.it…) to see your Zoom, Teams and Meet calls.</p><a class="btn primary sm" href="#settings">Add calendar</a></div>`;
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
      <div class="what"><b>${esc(e.title)}</b><small>${e.platform ? `<span class="pill ${e.platform.toLowerCase()}">${e.platform}</span>` : ''}${e.color ? `<i class="cal-dot" style="background:${esc(e.color)}"></i>` : ''}${esc(e.calendar || '')}</small></div>
      ${e.join ? `<button class="btn ${live || soon ? 'primary' : 'ghost'} sm" data-join="${esc(e.join)}">${live ? 'Join now' : 'Join'}</button>` : ''}
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
    <ul class="prayers">${p.list.map((x) => { const [t, ap] = fmtTime(x.time).split(' '); return `<li class="${x.name === p.next.name && sameDay(x.time, p.next.time) ? 'next' : x.time < new Date() ? 'past' : ''}"><span>${x.name}</span><b>${t}<i>${ap}</i></b></li>`; }).join('')}</ul>
    <small class="muted">${esc(p.hijri)} · ${esc(loc().name)}</small>`;
}

function weatherBlock({ detail = false } = {}) {
  const w = cache.weather;
  if (!w) return `<div class="skeleton" style="height:150px"></div>`;
  if (w.error) return empty('Weather will appear once online.');
  const c = w.current;
  const [desc] = wmo(c.weather_code);
  const moon = moonInfo();
  const days = w.daily.time.map((d, i) => ({ d, code: w.daily.weather_code[i], max: w.daily.temperature_2m_max[i], min: w.daily.temperature_2m_min[i], rain: w.daily.precipitation_probability_max?.[i] }));
  const lo = Math.min(...days.map((x) => x.min)), hi = Math.max(...days.map((x) => x.max));
  const range = (x) => `left:${((x.min - lo) / (hi - lo || 1)) * 100}%;right:${100 - ((x.max - lo) / (hi - lo || 1)) * 100}%`;
  const sunrise = w.daily.sunrise?.[0], sunset = w.daily.sunset?.[0];
  let html = `<div class="wx-top">
      <div class="wx-now">${wxIcon(c.weather_code, !!c.is_day, 72)}<div><strong>${Math.round(c.temperature_2m)}°C</strong><small>${desc} · feels ${Math.round(c.apparent_temperature)}°</small><small>Humidity ${c.relative_humidity_2m}% · Wind ${Math.round(c.wind_speed_10m)} km/h</small></div></div>
      <div class="wx-moon" title="${esc(moon.name)}">${moonSVG(moon.phase, 52)}<div><b>${moon.name}</b><small>${Math.round(moon.illum * 100)}% lit</small><small>Full ${fmtDate(moon.nextFull, { day: 'numeric', month: 'short' })} · New ${fmtDate(moon.nextNew, { day: 'numeric', month: 'short' })}</small></div></div>
    </div>
    ${sunrise ? `<div class="wx-sunline"><small>Sunrise ${fmtTime(sunrise)}</small><small>Sunset ${fmtTime(sunset)}</small></div>` : ''}
    <ul class="wx-week">${days.map((x, i) => `<li><span>${i === 0 ? 'Today' : D(x.d).toLocaleDateString('en-GB', { weekday: 'short' })}</span>${wxIcon(x.code, true, 30)}<small class="rain">${x.rain != null && x.rain >= 10 ? x.rain + '%' : ''}</small><em>${Math.round(x.min)}°</em><div class="trange"><i style="${range(x)}"></i></div><b>${Math.round(x.max)}°</b></li>`).join('')}</ul>`;
  if (detail && w.hourly) {
    const now = Date.now();
    const idx = w.hourly.time.findIndex((t) => new Date(t).getTime() > now - 3600000);
    const hrs = w.hourly.time.slice(idx, idx + 24).map((t, i) => ({ t, temp: w.hourly.temperature_2m[idx + i], code: w.hourly.weather_code[idx + i], day: w.hourly.is_day?.[idx + i], rain: w.hourly.precipitation_probability?.[idx + i] }));
    const tmin = Math.min(...hrs.map((h) => h.temp)) - 1, tmax = Math.max(...hrs.map((h) => h.temp)) + 1;
    const W = 960, H = 120, step = W / (hrs.length - 1);
    const pts = hrs.map((h, i) => [i * step, H - ((h.temp - tmin) / (tmax - tmin)) * (H - 20) - 10]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('');
    html += `<h3 class="sub">Next 24 hours</h3><div class="hourly"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="hourly-chart"><defs><linearGradient id="tg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".35"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs><path d="${line}L${W},${H}L0,${H}Z" fill="url(#tg)"/><path d="${line}" class="tline"/></svg>
      <ul class="hours">${hrs.filter((_, i) => i % 2 === 0).map((h) => `<li><small>${fmtTime(h.t).replace(':00', '')}</small>${wxIcon(h.code, !!h.day, 26)}<b>${Math.round(h.temp)}°</b>${h.rain >= 20 ? `<small class="rain">${h.rain}%</small>` : '<small>&nbsp;</small>'}</li>`).join('')}</ul></div>`;
  }
  html += w.stale ? '<small class="muted">Offline — showing last update</small>' : '<small class="muted src">Forecast: Open-Meteo</small>';
  return html;
}

const PLAN_ICONS = new Proxy({}, { get: (_, k) => `<i class="dot ${String(k)}"></i>` });
function plansBlock({ max = 4 } = {}) {
  const items = list('plans').filter((p) => new Date(p.end || p.date) >= startOfDay()).sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, max);
  if (!items.length) return empty('No plans yet.', ' <button class="link" data-add="plan">Add one</button>');
  return `<ul class="plans">${items.map((p) => `<li data-edit-plan="${p.id}"><span class="ic">${PLAN_ICONS[p.type || 'other']}</span><div><b>${esc(p.title)}</b><small>${fmtDay(p.date)}${p.time ? ' · ' + fmtTime(new Date(p.date + 'T' + p.time)) : ''}${p.end && p.end !== p.date ? ' → ' + fmtDay(p.end) : ''}${p.where ? ' · ' + esc(p.where) : ''}</small></div><small class="rel">${relDays(daysUntil(p.date))}</small></li>`).join('')}</ul>`;
}

function docsAlertBlock() {
  const items = upcomingDocs(120);
  if (!list('docs').length) return empty('Add your passport, civil ID, visas and licences to get expiry reminders.', ' <a class="link" href="#documents">Add documents</a>');
  if (!items.length) return empty('Nothing expires in the next 4 months');
  return `<ul class="alerts">${items.slice(0, 5).map((d) => `<li class="${d.days < 0 ? 'expired' : d.days <= 30 ? 'urgent' : d.days <= 90 ? 'soon' : ''}"><b>${esc(d.name)}${d.person && d.person !== people()[0] ? ` <em class="who">${esc(d.person)}</em>` : ''}</b><small>${d.days < 0 ? 'Expired ' + relDays(d.days) : 'Expires ' + relDays(d.days)} · ${fmtDate(d.expiry)}</small></li>`).join('')}</ul>`;
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
    <div><small>Resting HR</small><strong>${rest ? rest.bpm + ' <em>bpm</em>' : '—'}</strong><small>${rest?.date ? fmtDate(rest.date, { weekday: 'short', day: 'numeric', month: 'short' }) : ''}</small></div>
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
    return `<div class="hero"><div><h1>${greet}, Imran</h1><p data-clock-date>${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
      <div class="clocks"><div class="clock-main"><span class="clock" data-clock>${fmtTime(now)}</span><small>Kuwait</small></div>
      <ul class="world">${WORLD.map(([city, tz]) => `<li data-zone="${tz}">${clockFace(38)}<div><b data-zone-text>${zoneTime(tz, now).text}</b><small>${city}<em data-zone-day></em></small></div></li>`).join('')}</ul></div></div>
    <div class="grid home-grid">
      ${card('Meetings today', await meetingsBlock(), { link: 'schedule', cls: 'span2', action: '<button class="icon-btn" data-refresh="calendar" title="Refresh">↻</button>' })}
      ${card('Prayer times', prayerBlock(), { cls: 'prayer' })}
      ${card('To-do', await todoBlock(), { link: 'tasks', action: '<button class="icon-btn" data-refresh="todo" title="Refresh">↻</button>' })}
      ${card('Weather', weatherBlock(), { link: 'weather', cls: 'weather-card', action: '<button class="icon-btn" data-refresh="weather" title="Refresh">↻</button>' })}
      ${card('Plans', plansBlock(), { link: 'schedule', action: '<button class="icon-btn" data-add="plan" title="Add plan">+</button>' })}
      ${card('Document expiry', docsAlertBlock(), { link: 'documents' })}
      ${card('Sleep & heart rate', await healthBlock(), { link: 'health', action: '<button class="icon-btn" data-refresh="health" title="Refresh">↻</button>' })}
      ${card('Goals', goalsBlock(), { link: 'goals', action: '<button class="icon-btn" data-add="goal" title="Add goal">+</button>' })}
      ${card('Overwatch', overwatchBlock(), { cls: 'ow-card' })}
      ${card('Quick note', `<form data-form="quicknote" class="quick-note"><textarea name="text" rows="3" placeholder="Jot something down…"></textarea><button class="btn primary sm">Save note</button></form>${(() => { const n = list('notes').sort((a, b) => b.updatedAt - a.updatedAt)[0]; return n ? `<a class="more" href="#notes">Last: ${esc(n.text.slice(0, 60))}${n.text.length > 60 ? '…' : ''}</a>` : ''; })()}`)}
    </div>`;
  },

  async schedule() {
    const view = calView;
    const first = new Date(view.y, view.m, 1);
    const gridStart = new Date(first); gridStart.setDate(1 - ((first.getDay() + 6) % 7)); // weeks start Monday
    const gridEnd = new Date(gridStart); gridEnd.setDate(gridStart.getDate() + 42);
    const evs = I.eventsBetween(await kvGet('cache:ics', []), gridStart, gridEnd);
    const plans = list('plans');
    const byDay = new Map();
    const add = (key, item) => { if (!byDay.has(key)) byDay.set(key, []); byDay.get(key).push(item); };
    for (const e of evs) {
      const s0 = startOfDay(e.start), e0 = new Date(e.end);
      for (let d = new Date(s0); d < e0 || ymd(d) === ymd(s0); d.setDate(d.getDate() + 1)) { add(ymd(d), { kind: 'meeting', e }); if (!e.allDay) break; if (d > gridEnd) break; }
    }
    for (const p of plans) {
      const s0 = D(p.date), e0 = D(p.end || p.date);
      for (let d = new Date(s0); d <= e0 && d < gridEnd; d.setDate(d.getDate() + 1)) add(ymd(d), { kind: 'plan', p });
    }
    const order = (x) => (x.kind === 'plan' ? (x.p.time ? '1' + x.p.time : '0') : x.e.allDay ? '0' : '1' + fmt24(x.e.start));
    for (const arr of byDay.values()) arr.sort((a, b) => order(a).localeCompare(order(b)));
    const todayKey = ymd(new Date());
    const sel = view.sel || todayKey;
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart); d.setDate(gridStart.getDate() + i);
      const key = ymd(d); const items = byDay.get(key) || [];
      const chips = items.slice(0, 3).map((x) => x.kind === 'meeting'
        ? `<span class="chip-ev ${x.e.allDay ? 'allday' : ''}" style="--cal:${esc(x.e.color || 'var(--accent)')}" title="${esc(x.e.title)}${x.e.calendar ? ' · ' + esc(x.e.calendar) : ''}">${x.e.allDay ? '' : `<i>${fmtTime(x.e.start)}${x.e.platform ? ' · ' + x.e.platform : ''}</i>`}<span class="t">${esc(x.e.title)}</span></span>`
        : `<span class="chip-ev plan ${esc(x.p.type || 'other')}" title="${esc(x.p.title)}">${x.p.time ? `<i>${fmtTime(new Date(x.p.date + 'T' + x.p.time))}</i>` : ''}<span class="t">${esc(x.p.title)}</span></span>`).join('');
      cells.push(`<button class="cal-cell ${d.getMonth() !== view.m ? 'out' : ''} ${key === todayKey ? 'today' : ''} ${key === sel ? 'sel' : ''} ${d.getDay() === 5 || d.getDay() === 6 ? 'wknd' : ''}" data-day="${key}">
        <span class="dnum">${d.getDate()}</span><div class="cal-chips">${chips}${items.length > 3 ? `<span class="more-ev">+${items.length - 3} more</span>` : ''}</div></button>`);
    }
    const selItems = byDay.get(sel) || [];
    const agenda = selItems.length ? `<ul class="events">${selItems.map((x) => x.kind === 'meeting'
      ? `<li><div class="when">${x.e.allDay ? 'All day' : fmtTime(x.e.start)}</div><div class="what"><b>${esc(x.e.title)}</b><small>${x.e.platform ? `<span class="pill ${x.e.platform.toLowerCase()}">${x.e.platform}</span>` : ''}${x.e.allDay ? '' : 'until ' + fmtTime(x.e.end)}${x.e.location && !x.e.join ? ' · ' + esc(x.e.location) : ''}</small></div>${x.e.join ? `<button class="btn ghost sm" data-join="${esc(x.e.join)}">Join</button>` : ''}</li>`
      : `<li class="plan" data-edit-plan="${x.p.id}"><div class="when">${x.p.time ? fmtTime(new Date(x.p.date + 'T' + x.p.time)) : PLAN_ICONS[x.p.type || 'other']}</div><div class="what"><b>${esc(x.p.title)}</b><small><span class="pill plan">${esc(x.p.type || 'other')}</span>${x.p.where ? esc(x.p.where) : ''}${x.p.end && x.p.end !== x.p.date ? ' · until ' + fmtDay(x.p.end) : ''}</small></div></li>`).join('')}</ul>` : empty('Nothing on this day.');
    const monthName = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    return `<div class="page-head"><h1>${monthName}</h1><div class="actions">
        <div class="seg"><button class="btn ghost" data-cal="-1" aria-label="Previous month">‹</button><button class="btn ghost" data-cal="0">Today</button><button class="btn ghost" data-cal="1" aria-label="Next month">›</button></div>
        <button class="btn ghost" data-refresh="calendar" title="Refresh">↻</button><button class="btn primary" data-add="plan" data-date="${sel}">+ Add plan</button></div></div>
      ${!I.calendars().length ? `<section class="card banner"><div class="connect"><p>Add your calendars in Settings (e.g. Personal and Plot.it) to see all your meetings here.</p><a class="btn primary sm" href="#settings">Settings</a></div></section>` : `<div class="cal-legend">${I.calendars().map((c) => `<button class="legend ${(state.settings.hiddenCalendars || []).includes(c.id) ? 'off' : ''}" data-cal-toggle="${esc(c.id)}" title="Show / hide"><i style="background:${esc(c.color)}"></i>${esc(c.name)}</button>`).join('')}<span class="legend plans"><i></i>Your plans</span></div>`}
      <div class="cal-layout">
        <section class="card cal"><div class="cal-head">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<span>${d}</span>`).join('')}</div><div class="cal-grid">${cells.join('')}</div></section>
        <section class="card agenda"><header><h2>${sel === todayKey ? 'Today' : fmtDay(sel)}</h2><small>${relDays(daysUntil(sel))}</small></header>${agenda}</section>
      </div>`;
  },

  async weather() {
    return `<div class="page-head"><h1>Weather</h1><div class="actions"><button class="btn ghost" data-refresh="weather">↻ Refresh</button></div></div>
      <section class="card weather-card big">${weatherBlock({ detail: true })}</section>`;
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

  async files() {
    const ppl = people();
    if (!filesView.person || !ppl.includes(filesView.person)) filesView.person = ppl[0];
    let all = [];
    try { all = await V.listFiles(); } catch (e) { return `<div class="page-head"><h1>Files</h1></div>` + card('Files', empty('Could not open the vault folder: ' + errText(e))); }
    const mine = all.filter((f) => f.person === filesView.person);
    const counts = Object.fromEntries(V.CATEGORIES.map((c) => [c, mine.filter((f) => f.category === c).length]));
    const extraCats = [...new Set(mine.map((f) => f.category).filter((c) => c && !V.CATEGORIES.includes(c)))];
    const q = filesView.q.toLowerCase();
    const shown = (q ? all.filter((f) => f.path.toLowerCase().includes(q)) : mine.filter((f) => filesView.category === 'All' || f.category === filesView.category))
      .sort((a, b) => b.modified - a.modified);
    const typeOf = (n) => { const e = (n.split('.').pop() || '').toLowerCase(); return /^(png|jpe?g|webp|gif|heic)$/.test(e) ? 'img' : e === 'pdf' ? 'pdf' : /^(docx?|odt|rtf|txt)$/.test(e) ? 'doc' : /^(xlsx?|csv)$/.test(e) ? 'xls' : 'file'; };
    const root = await V.vaultRoot();
    const expiryOf = new Map(); for (const d of list('docs')) for (const p of docFiles(d)) if (d.expiry) expiryOf.set(p, d);
    return `<div class="page-head"><h1>Files</h1><div class="actions"><button class="btn ghost" data-vault-reveal="">Open folder</button><button class="btn primary" data-vault-upload>+ Add files</button></div></div>
      <div class="people-tabs">${ppl.map((p) => `<button class="person ${p === filesView.person && !q ? 'on' : ''}" data-person="${esc(p)}"><span class="avatar">${esc(p.slice(0, 1).toUpperCase())}</span>${esc(p)}<small>${all.filter((f) => f.person === p).length}</small></button>`).join('')}<button class="person add" data-add-person>+ Add family member</button></div>
      <div class="files-layout">
        <nav class="card cats">
          <button class="${filesView.category === 'All' ? 'on' : ''}" data-cat="All"><span>All files</span><small>${mine.length}</small></button>
          ${[...V.CATEGORIES, ...extraCats].map((c) => `<button class="${filesView.category === c ? 'on' : ''}" data-cat="${esc(c)}"><span>${esc(c)}</span><small>${counts[c] ?? mine.filter((f) => f.category === c).length}</small></button>`).join('')}
        </nav>
        <section class="card files-main" data-dropzone>
          <div class="files-toolbar"><input type="search" placeholder="Search all files…" value="${esc(filesView.q)}" data-files-search><small class="muted">${q ? `${shown.length} result${shown.length === 1 ? '' : 's'} across everyone` : `${esc(filesView.person)} · ${esc(filesView.category === 'All' ? 'All files' : filesView.category)}`}</small></div>
          ${shown.length ? `<div class="file-grid">${shown.map((f) => `<article class="file" data-file="${esc(f.path)}" title="${esc(f.path)}">
              <div class="file-thumb ${typeOf(f.name)}" data-file-thumb="${esc(f.path)}"><span>${typeOf(f.name) === 'img' ? '' : esc((f.name.split('.').pop() || '').toUpperCase().slice(0, 4))}</span></div>
              ${expiryOf.has(f.path) ? (() => { const d = expiryOf.get(f.path); const n = daysUntil(d.expiry); return `<span class="exp-badge ${n < 0 ? 'bad' : n <= 90 ? 'warn' : ''}" title="${esc(d.name)}">${n < 0 ? 'Expired' : 'Expires'} ${fmtDate(d.expiry, { day: 'numeric', month: 'short', year: 'numeric' })}</span>`; })() : ''}<div class="file-info"><b>${esc(f.name)}</b><small>${q ? esc(f.person) + ' · ' : ''}${esc(f.category || '—')} · ${fmtSize(f.size)} · ${fmtDate(f.modified, { day: 'numeric', month: 'short', year: 'numeric' })}</small></div>
              <div class="file-actions"><button class="icon-btn" data-vault-open="${esc(f.path)}" title="Open">↗</button><button class="icon-btn" data-vault-reveal="${esc(f.path)}" title="Show in folder">⌕</button><button class="icon-btn" data-vault-move="${esc(f.path)}" title="Move">⇄</button><button class="icon-btn danger" data-vault-del="${esc(f.path)}" title="Delete">✕</button></div>
            </article>`).join('')}</div>` : `<div class="drop-empty"><svg viewBox="0 0 24 24" class="ico big"><path d="M12 16V4 M7 9l5-5 5 5 M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg><p>${q ? 'No files match your search.' : 'Drag files here, or click <b>Add files</b>.'}</p><small>Passport copies, visas, civil IDs, CVs, interview documents — anything you need to find quickly.</small></div>`}
          <div class="drop-overlay"><span>Drop to add to ${esc(filesView.person)} · ${esc(filesView.category === 'All' ? 'Other' : filesView.category)}</span></div>
        </section>
      </div>
      <p class="muted vault-path">Stored on this PC in <code>${esc(root)}</code>. Deleted files go to a hidden <code>.trash</code> folder inside it.</p>`;
  },

  async documents() {
    const ppl = people();
    const pf = docsPerson;
    const docs = list('docs').filter((d) => pf === 'All' || (d.person || ppl[0]) === pf).map((d) => ({ ...d, days: d.expiry ? daysUntil(d.expiry) : null })).sort((a, b) => (a.days ?? 99999) - (b.days ?? 99999));
    const groups = [['Visas', (d) => /visa/i.test(d.type)], ['IDs & passports', (d) => /passport|civil|id|licen/i.test(d.type) && !/visa/i.test(d.type)], ['Other', () => true]];
    const used = new Set();
    const sections = groups.map(([title, test]) => {
      const items = docs.filter((d) => !used.has(d.id) && test(d)); items.forEach((d) => used.add(d.id));
      return items.length ? `<h3 class="sub">${title}</h3><div class="doc-grid">${items.map(docCard).join('')}</div>` : '';
    }).join('');
    return `<div class="page-head"><h1>Expiry dates</h1><div class="actions"><button class="btn primary" data-add="doc">+ Add document</button></div></div>
      <p class="muted">Passports, IDs, visas and licences for you and your family. You'll get reminders 90, 30 and 7 days before anything expires. Keep the scans themselves in <a class="link" href="#files">Files</a>.</p>
      <div class="people-tabs small">${['All', ...ppl].map((p) => `<button class="person ${p === pf ? 'on' : ''}" data-doc-person="${esc(p)}">${esc(p)}</button>`).join('')}<button class="person add" data-add-person>+ Add family member</button></div>
      ${docs.length ? sections : card('Nothing added yet', empty('Add your passport, Kuwait civil ID, e-visas, visa stickers and driving licence. You can attach a photo or scan of each.', ' <button class="link" data-add="doc">Add the first one</button>'))}`;
  },

  async travel() {
    const tabs = `<div class="seg tabs-seg"><button class="btn ${travelView.tab === 'trips' ? 'on' : 'ghost'}" data-travel-tab="trips">Trips</button><button class="btn ${travelView.tab === 'flights' ? 'on' : 'ghost'}" data-travel-tab="flights">Flights</button></div>`;
    if (travelView.tab === 'flights') return flightsView(tabs);
    const trips = list('trips').sort((a, b) => b.from.localeCompare(a.from));
    const countries = new Map();
    for (const t of trips) countries.set(t.country, (countries.get(t.country) || 0) + 1);
    const daysAbroad = trips.reduce((s, t) => s + Math.max(1, Math.round((D(t.to || t.from) - D(t.from)) / 86400000) + 1), 0);
    const years = new Map();
    for (const t of trips) { const y = t.from.slice(0, 4); years.set(y, (years.get(y) || 0) + 1); }
    const thisYear = String(new Date().getFullYear());
    return `<div class="page-head"><h1>Travel history</h1><div class="actions">${tabs}<button class="btn ghost" data-import="trips">Import CSV</button><button class="btn primary" data-add="trip">+ Add trip</button></div></div>
      <div class="stat-row">
        <div class="stat"><strong>${trips.length}</strong><small>trips</small></div>
        <div class="stat"><strong>${countries.size}</strong><small>countries</small></div>
        <div class="stat"><strong>${daysAbroad}</strong><small>days away</small></div>
        <div class="stat"><strong>${years.get(thisYear) || 0}</strong><small>trips in ${thisYear}</small></div>
      </div>
      ${trips.length ? `<section class="card"><h2>Countries</h2><div class="chips">${[...countries.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `<span class="chip">${esc(c)} <b>${n}</b></span>`).join('')}</div></section>
      <section class="card"><table class="table"><thead><tr><th>Dates</th><th>Country</th><th>Cities</th></tr></thead><tbody>
      ${trips.map((t) => `<tr data-edit-trip="${t.id}"><td>${fmtDate(t.from)}${t.to && t.to !== t.from ? ' – ' + fmtDate(t.to) : ''}</td><td>${esc(t.country)}</td><td>${esc(t.cities || '')}</td></tr>`).join('')}
      </tbody></table></section>` : card('No trips yet', empty('Import your travel log (CSV with columns: from, to, country, cities) or add trips one by one.'))}`;
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
      ${card('Calendars', `<p class="muted">Add each calendar you want to see — e.g. your Google calendar and your Plot.it work calendar. They're all merged into one view, each in its own colour.</p>
        <ul class="cal-list">${I.calendars().map((c) => `<li><i style="background:${esc(c.color)}"></i><div><b>${esc(c.name)}</b><small>${esc(c.url.replace(/^(https?:\/\/[^/]+).*/, '$1/…'))}</small></div><button class="icon-btn" data-cal-edit="${esc(c.id)}" title="Edit">✎</button></li>`).join('') || '<li class="empty">No calendars yet.</li>'}</ul>
        <div class="row">${calAt ? `<small class="muted">Updated ${fmtTime(calAt)}</small>` : ''}<span class="spacer"></span><button class="btn primary sm" data-cal-add>+ Add calendar</button></div>
        <details class="howto"><summary>Where do I find the link?</summary><p><b>Google Calendar:</b> calendar.google.com → ⚙ Settings → click the calendar under “Settings for my calendars” → Integrate calendar → copy <b>Secret address in iCal format</b>.</p><p><b>Outlook / Microsoft 365 (work):</b> outlook.office.com → ⚙ Settings → Calendar → Shared calendars → Publish a calendar → choose the calendar and “Can view all details” → Publish → copy the <b>ICS</b> link.</p><p>Treat these links like passwords — anyone with one can read that calendar.</p></details>`)}
      ${card('Fitbit Air — sleep & heart rate', `<p class="muted">Needs a free Google Cloud “Desktop app” client (10-minute setup, see the guide). Your health data goes straight from Google to this computer.</p>
        <form data-form="google-settings" class="stack"><label><span>Client ID</span><input name="googleClientId" value="${esc(state.settings.googleClientId || '')}" placeholder="xxxx.apps.googleusercontent.com"></label>
        <label><span>Client secret</span><input name="googleClientSecret" type="password" value="${esc(state.settings.googleClientSecret || '')}" placeholder="GOCSPX-…"><small>Stays on this computer only.</small></label>
        <div class="row">${badge(gs)}<span class="spacer"></span><button class="btn ghost sm" type="submit">Save</button>${gs !== 'disconnected' ? '<button type="button" class="btn ghost sm" data-disconnect="google">Disconnect</button>' : ''}<button type="button" class="btn primary sm" data-connect="google">${gs === 'connected' ? 'Reconnect' : 'Connect'}</button></div></form>`)}
      ${card('Microsoft To Do (optional)', `<p class="muted">Your to-do list already works inside the app. Connect this only if you also want tasks from the Microsoft To Do app to show up.</p>
        <form data-form="ms-settings" class="stack"><label><span>Application (client) ID</span><input name="msClientId" value="${esc(state.settings.msClientId || '')}" placeholder="00000000-0000-0000-0000-000000000000"></label>
        <div class="row">${badge(ms)}<span class="spacer"></span><button class="btn ghost sm" type="submit">Save</button>${ms !== 'disconnected' ? '<button type="button" class="btn ghost sm" data-disconnect="microsoft">Disconnect</button>' : ''}<button type="button" class="btn primary sm" data-connect="microsoft">${ms === 'connected' ? 'Reconnect' : 'Connect'}</button></div></form>`)}
      ${card('Appearance', `<form data-form="appearance" class="stack">
        <label><span>Theme</span><select name="theme">${[['system', 'Match Windows'], ['dark', 'Dark'], ['light', 'Light']].map(([v, l]) => `<option value="${v}" ${themePref() === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <div class="row"><button type="button" class="btn ghost sm" data-avatar-change>Change profile picture</button><button type="button" class="btn ghost sm" data-avatar-remove>Remove picture</button><span class="spacer"></span><button class="btn primary sm">Save</button></div></form>`)}
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

// ---------- flights (myFlightradar24 export) ----------
const ap = (s) => { const m = (s || '').match(/^(.*?)\s*\/\s*(.*?)\s*\(([A-Z0-9]{3})\/([A-Z0-9]{4})\)/); return m ? { city: m[1], name: m[2], iata: m[3] } : { city: s, name: s, iata: (s || '').slice(0, 3).toUpperCase() }; };
const airlineName = (s) => (s || '').replace(/\s*\(.*\)\s*$/, '');
const aircraftName = (s) => (s || '').replace(/\s*\(.*\)\s*$/, '');
const durMin = (s) => { const m = (s || '').match(/(\d+):(\d+)/); return m ? +m[1] * 60 + +m[2] : 0; };

function flightsView(tabs) {
  const fl = list('flights').sort((a, b) => (b.date + b.dep).localeCompare(a.date + a.dep));
  const head = `<div class="page-head"><h1>Flights</h1><div class="actions">${tabs}<button class="btn primary" data-import="flights">Import Flightradar24 CSV</button></div></div>`;
  if (!fl.length) return head + card('No flights yet', empty('In my.flightradar24.com go to Settings → Export and import the CSV here.'));
  const mins = fl.reduce((s, f) => s + durMin(f.duration), 0);
  const count = (key) => { const m = new Map(); for (const f of fl) { const k = key(f); if (k) m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const apSet = new Map();
  for (const f of fl) for (const a of [ap(f.from), ap(f.to)]) apSet.set(a.iata, { ...a, n: (apSet.get(a.iata)?.n || 0) + 1 });
  const airlines = count((f) => airlineName(f.airline));
  const aircraft = count((f) => aircraftName(f.aircraft));
  const routes = count((f) => [ap(f.from).iata, ap(f.to).iata].sort().join(' ⇄ '));
  const longest = [...fl].sort((a, b) => durMin(b.duration) - durMin(a.duration))[0];
  const thisYear = String(new Date().getFullYear());
  const bars = (rows, max = 6) => { const top = rows.slice(0, max); const hi = top[0]?.[1] || 1; return `<ul class="rank">${top.map(([k, n]) => `<li><span>${esc(k)}</span><div class="bar"><i style="width:${(n / hi) * 100}%"></i></div><b>${n}</b></li>`).join('')}</ul>`; };
  return head + `<div class="stat-row">
      <div class="stat"><strong>${fl.length}</strong><small>flights</small></div>
      <div class="stat"><strong>${Math.round(mins / 60)}<em class="unit">h</em></strong><small>in the air · ${(mins / 1440).toFixed(1)} days</small></div>
      <div class="stat"><strong>${apSet.size}</strong><small>airports</small></div>
      <div class="stat"><strong>${fl.filter((f) => f.date.startsWith(thisYear)).length}</strong><small>flights in ${thisYear}</small></div>
    </div>
    <div class="grid">
      ${card('Top routes', bars(routes))}
      ${card('Airlines', bars(airlines))}
      ${card('Aircraft', bars(aircraft))}
      ${card('Airports', bars([...apSet.values()].sort((a, b) => b.n - a.n).map((a) => [`${a.iata} · ${a.city}`, a.n])))}
      ${longest ? card('Longest flight', `<div class="longest"><strong>${ap(longest.from).iata} → ${ap(longest.to).iata}</strong><small>${esc(longest.number)} · ${esc(airlineName(longest.airline))} · ${minsToHM(durMin(longest.duration))}</small><small>${fmtDate(longest.date)} · ${esc(aircraftName(longest.aircraft))}</small></div>`) : ''}
    </div>
    <section class="card" style="margin-top:18px"><table class="table flights"><thead><tr><th>Date</th><th>Flight</th><th>Route</th><th>Airline</th><th>Aircraft</th><th>Time</th></tr></thead><tbody>
    ${fl.map((f) => { const a = ap(f.from), b = ap(f.to); return `<tr><td>${fmtDate(f.date)}</td><td>${esc(f.number)}</td><td><b>${a.iata}</b> → <b>${b.iata}</b><small class="route-cities">${esc(a.city)} → ${esc(b.city)}</small></td><td>${esc(airlineName(f.airline))}</td><td>${esc(aircraftName(f.aircraft))}</td><td>${minsToHM(durMin(f.duration))}</td></tr>`; }).join('')}
    </tbody></table></section>`;
}

function docCard(d) {
  const cls = d.days == null ? '' : d.days < 0 ? 'expired' : d.days <= 30 ? 'urgent' : d.days <= 90 ? 'soon' : 'ok';
  return `<article class="doc ${cls}" data-edit-doc="${d.id}">
    <div class="thumb" data-doc-thumb="${esc(docFiles(d)[0] || '')}">${docFiles(d).length ? `<span>${esc((docFiles(d)[0].split('.').pop() || '').toUpperCase())}</span>` : '<span>▤</span>'}${docFiles(d).length > 1 ? `<em class="count">${docFiles(d).length}</em>` : ''}</div>
    <div class="info"><b>${esc(d.name)}</b><small>${people().length > 1 ? esc(d.person || people()[0]) + ' · ' : ''}${esc(d.type)}${d.country ? ' · ' + esc(d.country) : ''}${d.entries ? ' · ' + esc(d.entries) : ''}</small>
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
  let img;
  try { img = await createImageBitmap(file); } catch { return file; } // e.g. HEIC: keep the original
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
}

const DOC_FOLDER = { 'Passport': 'Passport & ID', 'Civil ID': 'Civil ID & Residency', 'Residence permit': 'Civil ID & Residency', 'E-visa': 'Visas', 'Visa sticker': 'Visas', 'Driving licence': 'Passport & ID', 'Insurance': 'Finance', 'Other': 'Other' };
const docFiles = (d) => d.files || [];

async function docForm(d = {}) {
  const vaultFiles = await V.listFiles().catch(() => []);
  const linked = new Set(docFiles(d));
  const choices = [['', '— none —'], ...vaultFiles.filter((f) => !linked.has(f.path)).map((f) => [f.path, `${f.person} › ${f.category} › ${f.name}`])];
  openForm({
    title: d.id ? 'Edit document' : 'Add document',
    fields: [
      { name: 'name', label: 'Name', required: true, value: d.name, placeholder: 'e.g. UK e-Visa, Pakistan passport', wide: true },
      { name: 'person', label: 'Belongs to', type: 'select', options: [...people().map((p) => [p, p]), ['__new__', '+ Add family member…']], value: d.person || (docsPerson !== 'All' ? docsPerson : people()[0]) },
      { name: 'newPerson', label: 'New family member’s name', placeholder: 'Only if you picked “+ Add family member”' },
      { name: 'type', label: 'Type', type: 'select', options: Object.keys(DOC_FOLDER), value: d.type || 'Passport' },
      { name: 'country', label: 'Country', value: d.country, wide: true },
      { name: 'issued', label: 'Issue date', type: 'date', value: d.issued },
      { name: 'expiry', label: 'Expiry date', type: 'date', value: d.expiry },
      { name: 'entries', label: 'Entries (visas)', type: 'select', options: ['', 'Single entry', 'Double entry', 'Multiple entry'], value: d.entries || '' },
      { name: 'stay', label: 'Max stay (visas)', value: d.stay, placeholder: 'e.g. 90 days per visit' },
      { name: 'ref', label: 'Reference (last 4 digits only)', value: d.ref, placeholder: 'e.g. …4417', hint: 'Avoid full document numbers.' },
      { name: 'files', label: linked.size ? `Add more scans (${linked.size} attached)` : 'Upload scan or photo (saved to Files)', type: 'file', accept: 'image/*,application/pdf', multiple: true, wide: true },
      { name: 'link', label: 'Or link a file already in Files', type: 'select', options: choices, value: '', wide: true },
      ...(linked.size ? [{ name: 'unlink', label: 'Attached files', type: 'select', options: [['', `Keep all ${linked.size}`], ...[...linked].map((p) => [p, 'Detach ' + p.split('/').pop()])], value: '', wide: true, hint: 'Detaching keeps the file in Files.' }] : []),
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, value: d.notes, wide: true },
    ],
    onSubmit: async (v) => {
      if (v.person === '__new__') {
        const name = v.newPerson.replace(/[<>:"/\\|?*]/g, '').trim();
        if (!name) throw new Error('Type the new family member’s name');
        if (!people().some((p) => p.toLowerCase() === name.toLowerCase())) await setSetting('people', [...people(), name]);
        v.person = people().find((p) => p.toLowerCase() === name.toLowerCase());
      }
      delete v.newPerson;
      const files = docFiles(d).filter((p) => p !== v.unlink);
      for (const f of v.files) files.push(await V.saveFile(v.person, DOC_FOLDER[v.type] || 'Other', f));
      if (v.link && !files.includes(v.link)) files.push(v.link);
      const { files: _f, link, unlink, ...rest } = v;
      await upsert('docs', { ...d, ...rest, files, images: [] });
      if (v.files.length) toast(`Saved to Files › ${v.person} › ${DOC_FOLDER[v.type] || 'Other'}`, 'ok');
    },
    onDelete: d.id ? () => remove('docs', d.id) : null,
  });
}

// One-time move of scans attached in older versions (kept inside the app) into the Files vault.
async function migrateDocImages() {
  for (const d of list('docs')) {
    if (!d.images?.length) continue;
    const files = [...docFiles(d)];
    for (const key of d.images) {
      const blob = await S.fileGet(key).catch(() => null);
      if (!blob) continue;
      const ext = key.endsWith('.pdf') ? '.pdf' : '.jpg';
      const name = `${d.name}${d.images.length > 1 ? ' ' + (files.length + 1) : ''}${ext}`.replace(/[<>:"/\\|?*]/g, '_');
      try { files.push(await V.saveFile(d.person || people()[0], DOC_FOLDER[d.type] || 'Other', new File([blob], name, { type: blob.type || (ext === '.pdf' ? 'application/pdf' : 'image/jpeg') }))); } catch (e) { console.warn('migrate', e); continue; }
    }
    await upsert('docs', { ...d, files, images: [] });
  }
}

function tripForm(t = {}) {
  openForm({
    title: t.id ? 'Edit trip' : 'Add trip',
    fields: [
      { name: 'from', label: 'From', type: 'date', required: true, value: t.from },
      { name: 'to', label: 'To', type: 'date', value: t.to },
      { name: 'country', label: 'Country', required: true, value: t.country },
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

async function addFiles(person, category, files) {
  let n = 0;
  for (const f of files) { try { await V.saveFile(person, category, f); n++; } catch (e) { toast(`${f.name}: ${errText(e)}`, 'error'); } }
  if (n) toast(`Added ${n} file${n === 1 ? '' : 's'} to ${person} · ${category}`, 'ok');
  filesView.person = person; filesView.category = category; filesView.q = '';
  return doRender(false, true);
}

function uploadForm() {
  openForm({
    title: 'Add files',
    submitLabel: 'Add',
    fields: [
      { name: 'person', label: 'Whose files', type: 'select', options: people(), value: filesView.person || people()[0] },
      { name: 'category', label: 'Folder', type: 'select', options: V.CATEGORIES, value: filesView.category === 'All' ? 'Other' : filesView.category },
      { name: 'files', label: 'Files', type: 'file', multiple: true, wide: true, hint: 'You can also drag files straight onto the Files page.' },
    ],
    onSubmit: async (v) => { if (!v.files.length) throw new Error('Choose at least one file'); await addFiles(v.person, v.category, v.files); },
  });
}

function moveForm(rel) {
  const [person, category] = rel.split('/');
  openForm({
    title: 'Move file', submitLabel: 'Move',
    fields: [
      { name: 'person', label: 'Person', type: 'select', options: people(), value: person },
      { name: 'category', label: 'Folder', type: 'select', options: V.CATEGORIES, value: V.CATEGORIES.includes(category) ? category : 'Other' },
    ],
    onSubmit: async (v) => { await V.moveFile(rel, v.person, v.category); toast('Moved', 'ok'); doRender(false, true); },
  });
}

function personForm() {
  openForm({
    title: 'Add family member', submitLabel: 'Add',
    fields: [{ name: 'name', label: 'Name', required: true, placeholder: 'e.g. Mom, Dad, Sara', wide: true }],
    onSubmit: async (v) => {
      const name = v.name.replace(/[<>:"/\\|?*]/g, '').trim();
      if (!name) throw new Error('Enter a name');
      if (people().some((p) => p.toLowerCase() === name.toLowerCase())) throw new Error('Already added');
      await setSetting('people', [...people(), name]);
      filesView.person = name; filesView.category = 'All';
    },
  });
}

function calendarForm(c = {}) {
  const used = I.calendars().map((x) => x.color);
  const color = c.color || I.CAL_COLORS.find((x) => !used.includes(x)) || I.CAL_COLORS[0];
  openForm({
    title: c.id ? 'Edit calendar' : 'Add calendar',
    fields: [
      { name: 'name', label: 'Name', required: true, value: c.name || (I.calendars().length ? 'Plot.it' : 'Personal'), placeholder: 'Personal, Plot.it…' },
      { name: 'color', label: 'Colour', type: 'select', options: I.CAL_COLORS.map((x, i) => [x, ['Gold', 'Blue', 'Green', 'Red', 'Lilac', 'Orange', 'Teal', 'Pink'][i]]), value: color },
      { name: 'url', label: 'iCal / ICS link', required: true, value: c.url, wide: true, placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics', hint: 'Google: “Secret address in iCal format”. Outlook: Publish a calendar → ICS link.' },
    ],
    onSubmit: async (v) => {
      if (!/^(https?|webcal):\/\//i.test(v.url)) throw new Error('That doesn’t look like a link — it should start with https://');
      const list = I.calendars().filter((x) => x.id !== c.id);
      const item = { id: c.id || 'cal' + Date.now().toString(36), name: v.name, url: v.url.trim(), color: v.color };
      const idx = I.calendars().findIndex((x) => x.id === c.id);
      if (idx >= 0) list.splice(idx, 0, item); else list.push(item);
      await setSetting('calendars', list);
      toast('Saved — loading calendar…', 'ok'); refresh('calendar', true);
    },
    onDelete: c.id ? async () => { await setSetting('calendars', I.calendars().filter((x) => x.id !== c.id)); refresh('calendar', true); } : null,
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
    const fileCard = e.target.closest('[data-file]');
    if (fileCard && !e.target.closest('button')) { if (e.detail === 2) return V.openFile(fileCard.dataset.file); return; }
    const t = e.target.closest('button, [data-edit-plan], [data-edit-doc], [data-edit-trip], [data-edit-season], [data-day]');
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
      if (ds.join) return joinMeeting(ds.join);
      if (ds.avatarChange !== undefined) return pickAvatar();
      if (ds.calAdd !== undefined) return calendarForm();
      if (ds.calEdit) return calendarForm(I.calendars().find((c) => c.id === ds.calEdit));
      if (ds.calToggle) { const h = new Set(state.settings.hiddenCalendars || []); h.has(ds.calToggle) ? h.delete(ds.calToggle) : h.add(ds.calToggle); await setSetting('hiddenCalendars', [...h]); cache.calendar = { ...cache.calendar, events: I.eventsBetween(await kvGet('cache:ics', []), startOfDay(), new Date(Date.now() + 15 * 86400000)) }; return doRender(false, true); }
      if (ds.avatarRemove !== undefined) { await kvSet('profilePhoto', null); await loadAvatar(); return toast('Picture removed', 'ok'); }
      // ----- files vault -----
      if (ds.person) { filesView.person = ds.person; filesView.q = ''; filesView.category = 'All'; return doRender(false, true); }
      if (ds.cat) { filesView.category = ds.cat; filesView.q = ''; return doRender(false, true); }
      if (ds.addPerson !== undefined) return personForm();
      if (ds.vaultUpload !== undefined) return uploadForm();
      if (ds.vaultOpen) return V.openFile(ds.vaultOpen);
      if (ds.vaultReveal !== undefined) return V.revealFolder(ds.vaultReveal);
      if (ds.vaultMove) return moveForm(ds.vaultMove);
      if (ds.vaultDel) {
        if (!t.dataset.armed) { t.dataset.armed = '1'; t.classList.add('armed'); t.title = 'Click again to delete'; setTimeout(() => { delete t.dataset.armed; t.classList.remove('armed'); }, 3000); return; }
        await V.deleteFile(ds.vaultDel); toast('Moved to the vault’s trash', 'ok'); return doRender(false, true);
      }
      if (ds.docPerson) { docsPerson = ds.docPerson; return doRender(false, true); }
      if (ds.travelTab) { travelView.tab = ds.travelTab; return doRender(true); }
      if (ds.cal !== undefined) { const n = +ds.cal; if (n === 0) { const t = new Date(); calView.y = t.getFullYear(); calView.m = t.getMonth(); calView.sel = null; } else { const d = new Date(calView.y, calView.m + n, 1); calView.y = d.getFullYear(); calView.m = d.getMonth(); } return doRender(true); }
      if (ds.day) { calView.sel = ds.day; const d = D(ds.day); if (d.getMonth() !== calView.m) { calView.y = d.getFullYear(); calView.m = d.getMonth(); return doRender(true); } return render(); }
      if (ds.add === 'plan') return planForm(ds.date ? { date: ds.date } : {});
      if (ds.add === 'goal') return goalForm();
      if (ds.add === 'doc') return await docForm();
      if (ds.add === 'trip') return tripForm();
      if (ds.add === 'season') return seasonForm();
      if (ds.editPlan) return planForm(list('plans').find((x) => x.id === ds.editPlan));
      if (ds.editGoal) return goalForm(list('goals').find((x) => x.id === ds.editGoal));
      if (ds.editDoc) return await docForm(list('docs').find((x) => x.id === ds.editDoc));
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
      if (ds.import === 'flights') {
        const f = await pickFile('.csv,.xls,text/csv'); if (!f) return;
        const rows = parseCSV(await f.text());
        const h = rows[0].map((x) => x.trim().toLowerCase());
        const c = (n) => h.indexOf(n);
        if (c('flight number') < 0) throw new Error('This doesn’t look like a Flightradar24 export');
        const existing = new Set(list('flights').map((x) => `${x.date}|${x.number}|${x.dep}`));
        let added = 0;
        for (const r of rows.slice(1)) {
          const fl = { date: r[c('date')], number: r[c('flight number')], from: r[c('from')], to: r[c('to')], dep: r[c('dep time')], arr: r[c('arr time')], duration: r[c('duration')], airline: r[c('airline')], aircraft: r[c('aircraft')], registration: r[c('registration')] || '' };
          if (!fl.date || existing.has(`${fl.date}|${fl.number}|${fl.dep}`)) continue;
          await upsert('flights', fl); added++;
        }
        return toast(`Imported ${added} flights`, 'ok');
      }
      if (ds.import === 'trips') {
        const f = await pickFile('.csv,text/csv'); if (!f) return;
        const rows = parseCSV(await f.text());
        const header = rows[0].map((h) => h.trim().toLowerCase());
        const col = (n) => header.indexOf(n);
        const existing = new Set(list('trips').map((t) => `${t.from}|${t.country}`));
        let added = 0;
        for (const r of rows.slice(1)) {
          const trip = { from: toISO(r[col('from')] || ''), to: toISO(r[col('to')] || ''), country: (r[col('country')] || '').trim(), cities: (r[col('cities')] || '').trim() };
          if (!trip.from || !trip.country || existing.has(`${trip.from}|${trip.country}`)) continue;
          await upsert('trips', trip); added++;
        }
        return toast(`Imported ${added} trips`, 'ok');
      }
    } catch (err) { toast(errText(err), 'error'); }
  };

  root.onsubmit = async (e) => {
    const form = e.target; const kind = form.dataset.form; if (!kind) return;
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form).entries());
    // quick-entry forms: clear and release focus straight away so the list refreshes immediately
    if (['todo', 'quicknote', 'checkpoint'].includes(kind)) { form.reset(); document.activeElement?.blur(); }
    try {
      if (kind === 'todo') {
        if (!v.title.trim()) return;
        await upsert('localTasks', { title: v.title.trim(), due: v.due || null, done: false });
      } else if (kind === 'quicknote') {
        if (!v.text.trim()) return; await upsert('notes', { text: v.text.trim() }); toast('Note saved', 'ok');
      } else if (kind === 'checkpoint') {
        if (!v.title.trim()) return; const g = list('goals').find((x) => x.id === form.dataset.goal);
        await upsert('goals', { ...g, checkpoints: [...(g.checkpoints || []), { title: v.title.trim(), date: v.date, done: false }] });
      } else if (kind === 'appearance') {
        await setTheme(v.theme); toast('Saved', 'ok');
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
    } catch (err) { toast(errText(err), 'error'); }
  };

  // files: live search, drag & drop, thumbnails
  const search = $('[data-files-search]', root);
  if (search) {
    let tmr;
    search.oninput = () => { clearTimeout(tmr); tmr = setTimeout(async () => {
      filesView.q = search.value; const pos = search.selectionStart;
      await doRender(false, true);
      const again = $('[data-files-search]'); if (again) { again.focus(); again.setSelectionRange(pos, pos); }
    }, 180); };
  }
  const zone = $('[data-dropzone]', root);
  if (zone) {
    let depth = 0;
    zone.ondragenter = (e) => { e.preventDefault(); depth++; zone.classList.add('dragging'); };
    zone.ondragover = (e) => e.preventDefault();
    zone.ondragleave = () => { if (--depth <= 0) { depth = 0; zone.classList.remove('dragging'); } };
    zone.ondrop = async (e) => {
      e.preventDefault(); depth = 0; zone.classList.remove('dragging');
      const files = [...(e.dataTransfer?.files || [])];
      if (files.length) await addFiles(filesView.person, filesView.category === 'All' ? 'Other' : filesView.category, files);
    };
  }
  $$('[data-file-thumb]', root).forEach(async (el) => {
    const url = await V.thumbnailURL(el.dataset.fileThumb).catch(() => null);
    if (url) { el.style.backgroundImage = `url("${url}")`; el.classList.add('has-img'); }
  });

  // load document thumbnails from IndexedDB
  $$('[data-doc-thumb]', root).forEach(async (el) => {
    const path = el.dataset.docThumb; if (!path) return;
    const url = await V.thumbnailURL(path).catch(() => null);
    if (url) { el.style.backgroundImage = `url("${url}")`; el.querySelector('span')?.remove(); }
    el.title = 'Open file';
    el.onclick = (ev) => { ev.stopPropagation(); V.openFile(path); };
  });
}

// ---------- syncing ----------
const LAST = {};
async function refresh(what, manual = false) {
  try {
    if (what === 'calendar') {
      if (!I.calendars().length) return;
      const before = JSON.stringify(cache.calendar?.events || []);
      try { await I.syncCalendar(); cache.calendarError = null; } catch (e) { cache.calendarError = navigator.onLine ? errText(e) : null; throw e; }
      cache.calendar = await kvGet('cache:calendar');
      if (!manual && current !== 'schedule' && before === JSON.stringify(cache.calendar.events)) { LAST[what] = Date.now(); return; }
    }
    if (what === 'todo') { if (await I.connectionStatus('microsoft') === 'disconnected') return; await I.syncTodo(); cache.todo = await kvGet('cache:todo'); }
    if (what === 'health') { if (await I.connectionStatus('google') === 'disconnected') return; await I.syncHealth(); cache.health = await kvGet('cache:health'); }
    if (what === 'weather') { cache.weather = await getWeather({ force: manual }).catch((e) => ({ error: errText(e) })); }
    if (what === 'prayer') { cache.prayer = await getPrayerSchedule().catch((e) => ({ error: errText(e) })); }
    LAST[what] = Date.now();
    if (manual) toast('Updated', 'ok');
  } catch (e) {
    if (e.code === 'AUTH') { if (manual) toast('Please reconnect your account', 'error'); }
    else if (manual) toast(errText(e), 'error');
    else console.warn(what, e);
  }
  render();
}

const EVERY = { calendar: 1, todo: 5, weather: 30, prayer: 60, health: 60 }; // minutes
const HIDDEN_EVERY = { calendar: 5 }; // slower while the window is hidden in the tray
async function tick() {
  for (const [what, mins] of Object.entries(EVERY)) {
    const m = document.hidden && HIDDEN_EVERY[what] ? HIDDEN_EVERY[what] : mins;
    if (!LAST[what] || Date.now() - LAST[what] > m * 60000 - 2000) await refresh(what);
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
      if (diff > 0 && diff <= 10 * 60000) notify('ev:' + e.id + e.start, `${e.title} in ${Math.ceil(diff / 60000)} min`, e.platform ? `${e.platform} — open Command Centre and press Join` : e.location || '');
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
let prayerRefreshing = false;
function liveUpdate() {
  const now = new Date();
  $$('[data-clock]').forEach((el) => { const t = fmtTime(now); if (el.textContent !== t) el.textContent = t; });
  $$('[data-countdown]').forEach((el) => (el.textContent = countdown(+el.dataset.countdown - now)));
  $$('[data-zone]').forEach((li) => {
    const z = zoneTime(li.dataset.zone, now);
    const txt = li.querySelector('[data-zone-text]'); if (txt.textContent !== z.text) txt.textContent = z.text;
    li.querySelector('[data-zone-day]').textContent = z.dayDiff ? ' · ' + z.dayDiff : '';
    li.querySelector('.hand.h').style.transform = `rotate(${(z.h % 12) * 30 + z.m * 0.5}deg)`;
    li.querySelector('.hand.m').style.transform = `rotate(${z.m * 6}deg)`;
    li.classList.toggle('night', z.h < 6 || z.h >= 19);
  });
  if (!prayerRefreshing && cache.prayer?.next && now > cache.prayer.next.time) { prayerRefreshing = true; refresh('prayer').finally(() => { prayerRefreshing = false; }); }
}

// ---------- appearance: theme + profile picture ----------
const mql = matchMedia('(prefers-color-scheme: light)');
function themePref() { try { return localStorage.getItem('cc-theme') || 'system'; } catch { return state.settings.theme || 'system'; } }
function applyTheme() {
  const pref = themePref();
  const resolved = pref === 'system' ? (mql.matches ? 'light' : 'dark') : pref;
  document.documentElement.dataset.theme = resolved;
  const lbl = $('#themeToggle .t-label'); if (lbl) lbl.textContent = resolved === 'dark' ? 'Dark' : 'Light';
}
async function setTheme(pref) {
  try { localStorage.setItem('cc-theme', pref); } catch { /* ignore */ }
  await setSetting('theme', pref);
  applyTheme();
}
mql.addEventListener?.('change', () => { if (themePref() === 'system') applyTheme(); });

async function loadAvatar() {
  const btn = $('#avatar'); if (!btn) return;
  const photo = await kvGet('profilePhoto');
  btn.style.backgroundImage = photo ? `url("${photo}")` : '';
  btn.classList.toggle('has-photo', !!photo);
}
async function pickAvatar() {
  const f = await pickFile('image/*'); if (!f) return;
  try {
    const img = await createImageBitmap(f);
    const size = 320, side = Math.min(img.width, img.height);
    const c = document.createElement('canvas'); c.width = c.height = size;
    c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
    await kvSet('profilePhoto', c.toDataURL('image/jpeg', 0.88));
    await loadAvatar(); toast('Profile picture updated', 'ok');
  } catch { toast('That image format isn’t supported — try a JPG or PNG', 'error'); }
}

// ---------- startup ----------
async function start() {
  await S.loadState();
  if (!state.settings.owSeasonsSeeded) {
    for (const s of DEFAULT_SEASONS) await upsert('seasons', s);
    await setSetting('owSeasonsSeeded', true);
  }
  applyTheme(); loadAvatar();
  migrateDocImages().catch((e) => console.warn(e));
  $('#avatar').onclick = pickAvatar;
  $('#themeToggle').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  await loadCaches();
  mountCube($('#cube'));
  addEventListener('hashchange', route);
  route();
  S.onChange(() => render());
  await Promise.all([refresh('weather'), refresh('prayer')]);
  tick();
  setInterval(tick, 60_000);
  setInterval(liveUpdate, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { LAST.calendar = 0; tick(); } });
  addEventListener('focus', () => { if (Date.now() - (LAST.calendar || 0) > 20000) refresh('calendar'); });
  addEventListener('online', () => { for (const k of Object.keys(LAST)) LAST[k] = 0; tick(); });
}


start();
