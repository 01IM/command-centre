// OAuth 2.0 authorization-code + PKCE, desktop style: sign-in opens in your normal browser
// and returns to a temporary local address handled by the app. No server, no libraries.
// Tokens are kept only on this computer (inside the app's storage).
import { kvGet, kvSet } from './store.js';
import { netFetch, isApp, loopbackSignIn } from './net.js';

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = (n = 48) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = (text) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));

export const PROVIDERS = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    extraAuth: { access_type: 'offline', prompt: 'consent' },
  },
  microsoft: {
    authUrl: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
    extraAuth: { prompt: 'select_account' },
  },
};

async function tokenRequest(provider, body) {
  const res = await netFetch(PROVIDERS[provider].tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.error || 'Sign-in failed');
  return json;
}

async function storeTokens(provider, json, prev = {}) {
  const t = {
    access_token: json.access_token,
    refresh_token: json.refresh_token || prev.refresh_token,
    expires_at: Date.now() + (json.expires_in || 3600) * 1000 - 60_000,
    connectedAt: prev.connectedAt || Date.now(),
  };
  await kvSet('tokens:' + provider, t);
  return t;
}

// Full sign-in. Resolves when connected.
export async function signIn(provider, { clientId, clientSecret, scopes }) {
  if (!isApp()) throw new Error('Sign-in works inside the Windows app');
  const p = PROVIDERS[provider];
  const verifier = randomString(64);
  const challenge = b64url(await sha256(verifier));
  const stateVal = randomString(16);
  const { url, redirectUri } = await loopbackSignIn((redirect) => `${p.authUrl}?${new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: redirect, scope: scopes.join(' '),
    code_challenge: challenge, code_challenge_method: 'S256', state: stateVal, ...p.extraAuth,
  })}`);
  const params = new URL(url, 'http://127.0.0.1').searchParams;
  if (params.get('error')) throw new Error(`Sign-in cancelled (${params.get('error')})`);
  if (params.get('state') !== stateVal) throw new Error('Sign-in failed: state mismatch');
  const body = { client_id: clientId, grant_type: 'authorization_code', code: params.get('code'), redirect_uri: redirectUri, code_verifier: verifier };
  if (clientSecret) body.client_secret = clientSecret;
  await storeTokens(provider, await tokenRequest(provider, body));
}

// Returns a valid access token (refreshing silently), or null if a reconnect is needed.
export async function getAccessToken(provider, getClient) {
  const t = await kvGet('tokens:' + provider);
  if (!t) return null;
  if (t.access_token && Date.now() < t.expires_at) return t.access_token;
  if (!t.refresh_token) return null;
  try {
    const { clientId, clientSecret } = getClient(provider);
    const body = { client_id: clientId, grant_type: 'refresh_token', refresh_token: t.refresh_token };
    if (clientSecret) body.client_secret = clientSecret;
    return (await storeTokens(provider, await tokenRequest(provider, body), t)).access_token;
  } catch (e) {
    console.warn(provider, 'refresh failed', e);
    await kvSet('tokens:' + provider, { ...t, access_token: null, refresh_token: null, needsReconnect: true });
    return null;
  }
}

export async function connectionStatus(provider) {
  const t = await kvGet('tokens:' + provider);
  if (!t) return 'disconnected';
  if (t.needsReconnect || (!t.refresh_token && Date.now() > t.expires_at)) return 'reconnect';
  return 'connected';
}

export const disconnect = (provider) => kvSet('tokens:' + provider, null);

export async function authFetch(provider, getClient, url, opts = {}) {
  const token = await getAccessToken(provider, getClient);
  if (!token) { const e = new Error('Not connected'); e.code = 'AUTH'; throw e; }
  const res = await netFetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token } });
  if (res.status === 401) {
    await kvSet('tokens:' + provider, { ...(await kvGet('tokens:' + provider)), expires_at: 0 });
    const e = new Error('Session expired'); e.code = 'AUTH'; throw e;
  }
  return res;
}
