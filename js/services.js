// Free, key-less data sources: prayer times (Aladhan) and weather (Open-Meteo).
// Responses are cached so the dashboard still shows them offline.
import { kvGet, kvSet, state } from './store.js';
import { netFetch } from './net.js';

export const DEFAULT_LOCATION = { name: 'Kuwait City', lat: 29.3759, lon: 47.9774 };
export const loc = () => state.settings.location || DEFAULT_LOCATION;

// ---------- prayer times ----------
const PRAYERS = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

async function fetchPrayerMonth(year, month) {
  const { lat, lon } = loc();
  const method = state.settings.prayerMethod ?? 9; // 9 = Kuwait
  const key = `prayer:${year}-${month}:${lat.toFixed(2)},${lon.toFixed(2)}:${method}`;
  const cached = await kvGet(key);
  if (cached) return cached;
  const url = `https://api.aladhan.com/v1/calendar/${year}/${month}?latitude=${lat}&longitude=${lon}&method=${method}`;
  const res = await netFetch(url);
  if (!res.ok) throw new Error('Prayer times unavailable');
  const json = await res.json();
  const days = json.data.map((d) => ({
    date: d.date.gregorian.date, // DD-MM-YYYY
    hijri: `${d.date.hijri.day} ${d.date.hijri.month.en} ${d.date.hijri.year}`,
    timings: Object.fromEntries(PRAYERS.map((p) => [p, d.timings[p].slice(0, 5)])),
  }));
  await kvSet(key, days);
  return days;
}

function ddmmyyyy(d) {
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

export async function getPrayerDay(date = new Date()) {
  const month = await fetchPrayerMonth(date.getFullYear(), date.getMonth() + 1);
  return month.find((d) => d.date === ddmmyyyy(date));
}

// Returns { today, list:[{name,time:Date}], next:{name,time} }
export async function getPrayerSchedule(now = new Date()) {
  const today = await getPrayerDay(now);
  if (!today) return null;
  const toDate = (base, hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(base); d.setHours(h, m, 0, 0); return d;
  };
  const list = PRAYERS.map((name) => ({ name, time: toDate(now, today.timings[name]) }));
  let next = list.find((p) => p.name !== 'Sunrise' && p.time > now);
  if (!next) {
    const tmr = new Date(now); tmr.setDate(tmr.getDate() + 1);
    const t = await getPrayerDay(tmr).catch(() => null);
    if (t) next = { name: 'Fajr', time: toDate(tmr, t.timings.Fajr) };
  }
  return { hijri: today.hijri, list, next };
}

// ---------- weather ----------
const WMO = {
  0: ['Clear', '☀️'], 1: ['Mostly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'],
  45: ['Fog', '🌫️'], 48: ['Fog', '🌫️'], 51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'],
  61: ['Light rain', '🌦️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'], 71: ['Light snow', '🌨️'], 73: ['Snow', '🌨️'],
  75: ['Heavy snow', '❄️'], 80: ['Showers', '🌦️'], 81: ['Showers', '🌧️'], 82: ['Violent showers', '⛈️'],
  95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm, hail', '⛈️'], 99: ['Thunderstorm, hail', '⛈️'],
};
export const wmo = (code) => WMO[code] || ['—', '🌡️'];

export async function getWeather({ force = false } = {}) {
  const { lat, lon } = loc();
  const cached = await kvGet('weather');
  if (!force && cached && cached.v === 2 && cached.lat === lat && Date.now() - cached.at < 30 * 60 * 1000) return cached;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day' +
      '&hourly=temperature_2m,weather_code,precipitation_probability,is_day' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,uv_index_max,wind_speed_10m_max' +
      '&timezone=auto&forecast_days=7&wind_speed_unit=kmh';
    const res = await netFetch(url);
    if (!res.ok) throw new Error('Weather unavailable');
    const json = await res.json();
    const data = { at: Date.now(), lat, v: 2, current: json.current, hourly: json.hourly, daily: json.daily };
    await kvSet('weather', data);
    return data;
  } catch (e) {
    if (cached) return { ...cached, stale: true };
    throw e;
  }
}

// ---------- Overwatch seasons (editable in the app; these are starting values) ----------
// Sources (checked Nov 2026): Season 4 began 11 Aug 2026; Season 6 is due 8 Dec 2026 per the
// in-game battle pass timer; a new story arc starts with Season 1 in 2027 (date not announced).
export const DEFAULT_SEASONS = [
  { name: 'Season 5', kind: 'season', date: '2026-10-13T18:00:00Z', note: 'Estimated (9 weeks after Season 4)' },
  { name: 'Season 6', kind: 'season', date: '2026-12-08T19:00:00Z' },
  { name: 'Season 1 (2027)', kind: 'season', date: '2027-02-09T19:00:00Z', note: 'Estimate — not announced yet' },
];
