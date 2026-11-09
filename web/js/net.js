// Network helper. Inside the Windows app, requests go through the app's Rust side, which
// avoids browser CORS limits (needed for the calendar link and sign-in token exchange).
// In a normal browser (for development) it falls back to fetch().
export const isApp = () => !!window.__TAURI__?.core?.invoke;

export async function netFetch(url, opts = {}) {
  if (!isApp()) return fetch(url, opts);
  let body = opts.body;
  if (body instanceof URLSearchParams) body = body.toString();
  const r = await window.__TAURI__.core.invoke('net_request', {
    method: opts.method || 'GET',
    url,
    headers: opts.headers || {},
    body: body ?? null,
  });
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    text: async () => r.body,
    json: async () => JSON.parse(r.body),
  };
}

// Opens the system browser for sign-in and waits for the redirect to a temporary
// local address (http://127.0.0.1:<port>). Returns { url, redirectUri }.
export async function loopbackSignIn(buildAuthUrl, host = '127.0.0.1') {
  const invoke = window.__TAURI__.core.invoke;
  const port = await invoke('oauth_listen');
  const redirectUri = `http://${host}:${port}`;
  await invoke('open_url', { url: buildAuthUrl(redirectUri) });
  const url = await invoke('oauth_wait', { port });
  return { url, redirectUri };
}

export async function openExternal(url) {
  if (isApp()) return window.__TAURI__.core.invoke('open_url', { url });
  window.open(url, '_blank', 'noopener');
}

// Turn a meeting link into a link that opens the desktop app directly.
//   Zoom  https://us02web.zoom.us/j/123?pwd=abc → zoommtg://us02web.zoom.us/join?action=join&confno=123&pwd=abc
//   Teams https://teams.microsoft.com/l/meetup-join/… → msteams:/l/meetup-join/…
export function appLink(url) {
  try {
    const u = new URL(url);
    if (/(^|\.)zoom\.us$/.test(u.hostname)) {
      const m = u.pathname.match(/\/(?:j|w|s|wc\/join)\/(\d+)/);
      if (m) {
        const q = new URLSearchParams({ action: 'join', confno: m[1] });
        if (u.searchParams.get('pwd')) q.set('pwd', u.searchParams.get('pwd'));
        return `zoommtg://${u.hostname}/join?${q}`;
      }
      if (u.pathname.startsWith('/my/')) return `zoommtg://${u.hostname}/join?action=join&confno=${encodeURIComponent(u.pathname.slice(4))}`;
    }
    if (u.hostname === 'teams.microsoft.com' && u.pathname.startsWith('/l/')) return 'msteams:' + u.pathname + u.search;
  } catch { /* fall through */ }
  return url;
}

// Open a meeting: desktop app first, browser link as a fallback.
export async function joinMeeting(url) {
  const direct = appLink(url);
  if (direct !== url) {
    try { await openExternal(direct); return; } catch { /* app not installed */ }
  }
  return openExternal(url);
}
