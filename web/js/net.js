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
export async function loopbackSignIn(buildAuthUrl) {
  const invoke = window.__TAURI__.core.invoke;
  const port = await invoke('oauth_listen');
  const redirectUri = `http://127.0.0.1:${port}`;
  await invoke('open_url', { url: buildAuthUrl(redirectUri) });
  const url = await invoke('oauth_wait', { port });
  return { url, redirectUri };
}

export async function openExternal(url) {
  if (isApp()) return window.__TAURI__.core.invoke('open_url', { url });
  window.open(url, '_blank', 'noopener');
}
