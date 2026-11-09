// File vault. In the Windows app, files are real files in
//   Documents\Command Centre Vault\<Person>\<Category>\<file>
// so you can also open that folder in File Explorer and back it up however you like.
// In a plain browser (development only) files are kept in IndexedDB instead.
import { isApp } from './net.js';
import { kvGet, kvSet, fileGet, fileSet, fileDel } from './store.js';

const invoke = (...a) => window.__TAURI__.core.invoke(...a);
export const CATEGORIES = ['Passport & ID', 'Visas', 'Civil ID & Residency', 'Job & Career', 'Education', 'Medical', 'Finance', 'Travel', 'Other'];

const clean = (s) => String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '').trim().slice(0, 120) || 'file';
export const relPath = (person, category, name) => [clean(person), clean(category), clean(name)].join('/');

// -> [{ path, person, category, name, size, modified }]
export async function listFiles() {
  if (isApp()) {
    const entries = await invoke('vault_list');
    return entries.filter((e) => !e.is_dir).map(split);
  }
  return (await kvGet('vault:index', [])).map(split);
}
function split(e) {
  const parts = e.path.split('/');
  return { ...e, person: parts[0] || '', category: parts.length > 2 ? parts[1] : '', name: parts[parts.length - 1] };
}

async function uniquePath(rel) {
  const existing = new Set((await listFiles()).map((f) => f.path.toLowerCase()));
  if (!existing.has(rel.toLowerCase())) return rel;
  const dot = rel.lastIndexOf('.');
  const base = dot > rel.lastIndexOf('/') ? rel.slice(0, dot) : rel, ext = dot > rel.lastIndexOf('/') ? rel.slice(dot) : '';
  for (let i = 2; ; i++) { const p = `${base} (${i})${ext}`; if (!existing.has(p.toLowerCase())) return p; }
}

export async function saveFile(person, category, file) {
  const rel = await uniquePath(relPath(person, category, file.name));
  if (isApp()) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await invoke('vault_write', bytes, { headers: { 'x-path': encodeURIComponent(rel) } });
  } else {
    await fileSet('vault:' + rel, file);
    const idx = await kvGet('vault:index', []);
    idx.push({ path: rel, size: file.size, modified: Date.now(), is_dir: false });
    await kvSet('vault:index', idx);
  }
  return rel;
}

export async function openFile(rel) {
  if (isApp()) return invoke('vault_open', { path: rel });
  const blob = await fileGet('vault:' + rel);
  if (blob) window.open(URL.createObjectURL(blob), '_blank');
}

export async function revealFolder(rel = '') {
  if (isApp()) return invoke('vault_reveal', { path: rel });
}

export async function deleteFile(rel) {
  if (isApp()) return invoke('vault_delete', { path: rel }); // moved to the vault's .trash folder
  await fileDel('vault:' + rel);
  await kvSet('vault:index', (await kvGet('vault:index', [])).filter((e) => e.path !== rel));
}

export async function moveFile(rel, person, category) {
  const name = rel.split('/').pop();
  const target = await uniquePath(relPath(person, category, name));
  if (isApp()) return invoke('vault_move', { from: rel, to: target });
  const blob = await fileGet('vault:' + rel);
  await fileSet('vault:' + target, blob); await fileDel('vault:' + rel);
  await kvSet('vault:index', (await kvGet('vault:index', [])).map((e) => (e.path === rel ? { ...e, path: target } : e)));
}

export async function vaultRoot() { return isApp() ? invoke('vault_root') : 'this device (and your encrypted sync, if it’s on)'; }

export async function thumbnailURL(rel) {
  if (!/\.(png|jpe?g|webp|gif)$/i.test(rel)) return null;
  if (isApp()) {
    const b64 = await invoke('vault_read_thumb', { path: rel }).catch(() => null);
    return b64 ? `data:image/*;base64,${b64}` : null;
  }
  const blob = await fileGet('vault:' + rel);
  return blob ? URL.createObjectURL(blob) : null;
}

// ----- used by sync -----
export async function readFile(rel) {
  if (isApp()) return new Uint8Array(await invoke('vault_read', { path: rel }));
  const blob = await fileGet('vault:' + rel);
  if (!blob) throw new Error('File not found');
  return new Uint8Array(await blob.arrayBuffer());
}
// Write to an exact path (overwrites). Used when a file arrives from another device.
export async function writeFileAt(rel, bytes, mime = '') {
  if (isApp()) return invoke('vault_write', bytes, { headers: { 'x-path': encodeURIComponent(rel) } });
  await fileSet('vault:' + rel, new Blob([bytes], { type: mime }));
  const idx = (await kvGet('vault:index', [])).filter((e) => e.path !== rel);
  idx.push({ path: rel, size: bytes.length, modified: Date.now(), is_dir: false });
  await kvSet('vault:index', idx);
}
