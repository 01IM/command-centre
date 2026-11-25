// Custom title bar for the Windows app ("floating pills"): name on the left, date · time · sync in the middle,
// round minimise / maximise / close on the right. Drag anywhere on the bar; double-click to maximise.
// Flat shapes only (no blur, shadow or animation) so it costs nothing on the graphics card.
import * as Sync from './sync.js';

const I = {
  min: '<svg viewBox="0 0 12 12"><path d="M2.5 6h7"/></svg>',
  max: '<svg viewBox="0 0 12 12"><rect x="2.5" y="2.5" width="7" height="7" rx="1.6"/></svg>',
  restore: '<svg viewBox="0 0 12 12"><rect x="2" y="4" width="6" height="6" rx="1.3"/><path d="M4.5 4V3.3A1.3 1.3 0 0 1 5.8 2h2.9A1.3 1.3 0 0 1 10 3.3v2.9A1.3 1.3 0 0 1 8.7 7.5H8"/></svg>',
  close: '<svg viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6"/></svg>',
  logo: '<svg viewBox="0 0 24 24" class="tb-logo"><path d="M12 2 20 9 12 16 4 9z" fill="#7c93ff"/><path d="M12 8 20 15 12 22 4 15z" fill="#2dd4bf" opacity=".85"/></svg>',
};

export function mountTitlebar() {
  const win = window.__TAURI__?.window?.getCurrentWindow?.();
  if (!win) return;
  document.documentElement.classList.add('has-titlebar');
  const bar = document.createElement('header');
  bar.id = 'titlebar';
  bar.setAttribute('data-tauri-drag-region', '');
  bar.innerHTML = `
    <span class="tb-pill tb-name" data-tauri-drag-region>${I.logo}<span data-tauri-drag-region>Command Centre</span></span>
    <span class="tb-pill tb-now" data-tauri-drag-region><i class="tb-dot"></i><span class="tb-time" data-tauri-drag-region></span><em class="tb-sync" data-tauri-drag-region></em></span>
    <span class="tb-pill tb-win">
      <button class="tb-btn tb-min" title="Minimise" aria-label="Minimise">${I.min}</button>
      <button class="tb-btn tb-max" title="Maximise" aria-label="Maximise">${I.max}</button>
      <button class="tb-btn tb-close" title="Close to tray" aria-label="Close">${I.close}</button>
    </span>`;
  document.body.prepend(bar);
  bar.querySelector('.tb-min').onclick = () => win.minimize();
  bar.querySelector('.tb-max').onclick = () => win.toggleMaximize();
  bar.querySelector('.tb-close').onclick = () => win.close(); // the app hides to the tray, as before

  const maxBtn = bar.querySelector('.tb-max');
  const syncMax = async () => { const m = await win.isMaximized().catch(() => false); maxBtn.innerHTML = m ? I.restore : I.max; maxBtn.title = m ? 'Restore' : 'Maximise'; };
  win.onResized?.(() => syncMax()); syncMax();

  const timeEl = bar.querySelector('.tb-time'), syncEl = bar.querySelector('.tb-sync'), dot = bar.querySelector('.tb-dot');
  const paint = () => {
    const d = new Date();
    timeEl.textContent = `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}`;
    const st = Sync.status || {};
    const on = Sync.enabled?.();
    const state = !on ? 'off' : (st.state === 'error' || st.error) ? 'error' : st.state === 'syncing' ? 'syncing' : 'ok';
    dot.dataset.state = state;
    syncEl.textContent = state === 'off' ? '· local only' : state === 'error' ? '· sync problem' : state === 'syncing' ? '· syncing…' : '· synced';
  };
  paint();
  Sync.onStatus?.(paint);
  // repaint on the minute, and not at all while the window is hidden
  const tick = () => { if (!document.hidden) paint(); setTimeout(tick, 60000 - (Date.now() % 60000) + 50); };
  setTimeout(tick, 60000 - (Date.now() % 60000) + 50);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) paint(); });
}
