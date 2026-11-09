// End-to-end encryption for sync. Your passphrase never leaves your devices; the cloud only ever
// stores scrambled data it cannot read. AES-256-GCM with a key derived by PBKDF2-SHA256.
const enc = new TextEncoder(), dec = new TextDecoder();
const ITERATIONS = 310000;

export const b64 = {
  from: (buf) => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); },
  to: (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0)),
};

export function newSalt() { return b64.from(crypto.getRandomValues(new Uint8Array(16))); }

export async function deriveKey(passphrase, saltB64) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64.to(saltB64), iterations: ITERATIONS },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return out;
}
export async function decryptBytes(key, data) {
  const u = new Uint8Array(data);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12) }, key, u.subarray(12)));
}
export async function encryptJSON(key, obj) { return b64.from(await encryptBytes(key, enc.encode(JSON.stringify(obj)))); }
export async function decryptJSON(key, str) { return JSON.parse(dec.decode(await decryptBytes(key, b64.to(str)))); }

export async function sha256Hex(text) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
