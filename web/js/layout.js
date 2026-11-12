// Home layout editor.
// Every widget on Home can be dragged to a new position (all devices); in the Windows app it can
// also be resized from its bottom-right corner (width snaps to columns, height in small steps).
// The grid packs widgets "masonry" style, so there are no gaps under shorter cards.

const UNIT = 8;   // row step in px — heights snap to this
const GAP = 16;   // space between widgets
const MIN_COL = 330;

let ctl = null;   // the active home grid controller

export function mountHome(grid, { device, layout, defaults, save, editing, classic }) {
  ctl?.destroy();
  ctl = new HomeGrid(grid, { device, layout, defaults, save, classic });
  if (editing) ctl.edit(true);
  return ctl;
}
export const homeLayout = () => ctl;

// Put widget HTML in the saved order (unknown ids keep their default place at the end).
export function orderWidgets(items, layout) {
  const order = layout?.order || [];
  const pos = (id) => { const i = order.indexOf(id); return i < 0 ? 1000 + items.findIndex((x) => x[0] === id) : i; };
  return [...items].sort((a, b) => pos(a[0]) - pos(b[0]));
}

class HomeGrid {
  constructor(grid, { device, layout, defaults, save, classic }) {
    this.grid = grid; this.device = device; this.save = save; this.defaults = defaults;
    this.classic = !!classic; // untouched home: keep the original even-row layout until the first edit
    this.layout = { order: [...(layout?.order || [])], size: { ...(layout?.size || {}) } };
    this.canResize = device === 'desktop';
    this.editing = false;
    this.ro = new ResizeObserver(() => this.queue());
    this.onWin = () => this.queue(true);
    addEventListener('resize', this.onWin);
    if (!this.classic) this.toMasonry();
  }
  toMasonry() {
    this.classic = false;
    // free the stacked pair so each widget can move on its own
    this.grid.querySelectorAll(':scope > .card-stack').forEach((st) => st.replaceWith(...st.children));
    this.cards().forEach((c) => { c.classList.remove('span2'); this.ro.observe(c); });
    this.grid.classList.add('masonry');
    this.apply();
  }
  destroy() { this.ro.disconnect(); removeEventListener('resize', this.onWin); this.edit(false, true); }
  cards() { return [...this.grid.querySelectorAll(':scope > [data-widget]')]; }

  cols() {
    const max = this.device === 'phone' ? 1 : this.device === 'tablet' ? 2 : 4;
    return Math.max(1, Math.min(max, Math.floor((this.grid.clientWidth + GAP) / (MIN_COL + GAP))));
  }
  widthOf(id) {
    const s = this.canResize ? this.layout.size[id]?.w : null;
    return Math.min(s || this.defaults[id] || 1, this.n);
  }
  queue(full) {
    if (this.classic) return;
    if (full) this.full = true;
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; const f = this.full; this.full = false; f ? this.apply() : this.spans(); });
  }
  apply() {
    this.n = this.cols();
    this.grid.style.gridTemplateColumns = `repeat(${this.n}, minmax(0, 1fr))`;
    for (const c of this.cards()) {
      const id = c.dataset.widget;
      c.style.gridColumn = `span ${this.widthOf(id)}`;
      const h = this.canResize ? this.layout.size[id]?.h : null;
      c.style.height = h ? h + 'px' : '';
      c.classList.toggle('fixed-h', !!h);
    }
    this.spans();
  }
  spans() {
    for (const c of this.cards()) {
      const h = c.offsetHeight;
      const s = Math.max(1, Math.ceil((h + GAP) / UNIT));
      if (c.style.gridRowEnd !== `span ${s}`) c.style.gridRowEnd = `span ${s}`;
    }
  }
  persist() {
    this.layout.order = this.cards().map((c) => c.dataset.widget);
    this.save({ order: this.layout.order, size: this.canResize ? this.layout.size : {} });
  }
  reset() {
    flip(this.cards(), () => {
      this.layout = { order: [], size: {} };
      const byId = Object.fromEntries(this.cards().map((c) => [c.dataset.widget, c]));
      for (const id of Object.keys(this.defaults)) if (byId[id]) this.grid.appendChild(byId[id]);
      this.apply();
    });
    this.save({ order: [], size: {} });
    this.edit(false); // back to the original layout
  }

  // ---------- edit mode ----------
  edit(on, silent) {
    if (on === this.editing) return;
    this.editing = on;
    window.__layoutEditing = on;
    if (on && this.classic) this.toMasonry();
    this.grid.classList.toggle('editing', on);
    for (const c of this.cards()) {
      c.querySelectorAll(':scope > .w-tool').forEach((x) => x.remove());
      if (on) {
        c.insertAdjacentHTML('beforeend', `<span class="w-tool w-grip" title="Drag to move"><svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></span>`
          + (this.canResize ? '<span class="w-tool w-resize" title="Drag to resize · double-click to fit content"></span>' : ''));
      }
    }
    if (on) {
      this.bar = document.createElement('div');
      this.bar.className = 'layout-bar';
      this.bar.innerHTML = `<span>${this.canResize ? 'Drag widgets to move them · drag a corner to resize' : 'Drag the ⠿ handle to move a widget'}</span><button class="btn ghost sm" data-l="reset">Reset</button><button class="btn primary sm" data-l="done">Done</button>`;
      document.body.appendChild(this.bar);
      requestAnimationFrame(() => this.bar?.classList.add('in'));
      this.bar.onclick = (e) => { const a = e.target.closest('[data-l]')?.dataset.l; if (a === 'reset') this.reset(); if (a === 'done') this.edit(false); };
      this.down = (e) => this.pointerDown(e);
      this.grid.addEventListener('pointerdown', this.down);
      this.dbl = (e) => { const r = e.target.closest('.w-resize'); if (!r) return; const c = r.closest('[data-widget]'); delete (this.layout.size[c.dataset.widget] || {}).h; this.apply(); this.persist(); };
      this.grid.addEventListener('dblclick', this.dbl);
      this.blockClick = (e) => { if (this.editing) { e.preventDefault(); e.stopPropagation(); } };
      this.grid.addEventListener('click', this.blockClick, true);
    } else {
      this.grid.removeEventListener('pointerdown', this.down);
      this.grid.removeEventListener('dblclick', this.dbl);
      this.grid.removeEventListener('click', this.blockClick, true);
      const bar = this.bar; this.bar = null;
      if (bar) { bar.classList.remove('in'); setTimeout(() => bar.remove(), 260); }
      if (!silent) { this.spans(); window.dispatchEvent(new Event('layout-done')); }
    }
  }

  pointerDown(e) {
    if (e.button > 0) return;
    const card = e.target.closest('[data-widget]'); if (!card) return;
    const touch = e.pointerType !== 'mouse';
    if (e.target.closest('.w-resize')) return this.startResize(e, card);
    if (touch && !e.target.closest('.w-grip')) return; // on touch screens, the page still scrolls unless you use the handle
    this.startDrag(e, card);
  }

  // Layout position of a card, ignoring any running animation transform.
  rectOf(c) {
    const g = this.grid.getBoundingClientRect();
    return { left: g.left + c.offsetLeft, top: g.top + c.offsetTop, width: c.offsetWidth, height: c.offsetHeight };
  }

  startDrag(e, card) {
    e.preventDefault();
    const r0 = this.rectOf(card);
    const grab = { x: e.clientX - r0.left, y: e.clientY - r0.top };
    let px = e.clientX, py = e.clientY, moved = false, lastSwap = 0, scrollRaf = 0;
    card.setPointerCapture?.(e.pointerId);
    const place = () => {
      const r = this.rectOf(card);
      card.style.transform = `translate(${px - grab.x - r.left}px, ${py - grab.y - r.top}px) scale(1.02)`;
    };
    const hitTest = () => {
      if (performance.now() - lastSwap < 140) return;
      const cards = this.cards();
      for (const o of cards) {
        if (o === card) continue;
        const r = this.rectOf(o);
        if (px < r.left || px > r.left + r.width || py < r.top || py > r.top + r.height) continue;
        const from = cards.indexOf(card), to = cards.indexOf(o);
        flip(cards.filter((x) => x !== card), () => {
          if (from < to) o.after(card); else o.before(card);
          this.spans();
        });
        lastSwap = performance.now();
        place();
        break;
      }
    };
    const autoScroll = () => {
      const edge = 70, h = innerHeight;
      const v = py < edge ? -(edge - py) / 4 : py > h - edge ? (py - (h - edge)) / 4 : 0;
      if (v) { scrollBy(0, v); place(); hitTest(); }
      scrollRaf = requestAnimationFrame(autoScroll);
    };
    const move = (ev) => {
      px = ev.clientX; py = ev.clientY;
      if (!moved) {
        if (Math.hypot(px - e.clientX, py - e.clientY) < 4) return;
        moved = true; card.classList.add('dragging'); this.grid.classList.add('is-dragging');
        window.__layoutDragging = true;
        scrollRaf = requestAnimationFrame(autoScroll);
      }
      place(); hitTest();
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      cancelAnimationFrame(scrollRaf);
      window.__layoutDragging = false;
      if (!moved) return;
      card.classList.remove('dragging'); card.classList.add('dropping');
      card.style.transform = '';
      this.grid.classList.remove('is-dragging');
      setTimeout(() => card.classList.remove('dropping'), 320);
      this.persist();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }

  startResize(e, card) {
    e.preventDefault(); e.stopPropagation();
    const id = card.dataset.widget;
    const sx = e.clientX, sy = e.clientY, sw = card.offsetWidth, sh = card.offsetHeight;
    const colW = (this.grid.clientWidth - GAP * (this.n - 1)) / this.n;
    let curW = this.widthOf(id);
    card.classList.add('resizing'); window.__layoutDragging = true;
    const move = (ev) => {
      const w = Math.max(1, Math.min(this.n, Math.round((sw + ev.clientX - sx + GAP) / (colW + GAP))));
      const h = Math.max(110, Math.round((sh + ev.clientY - sy) / UNIT) * UNIT);
      const size = (this.layout.size[id] ||= {});
      size.h = h;
      card.style.height = h + 'px'; card.classList.add('fixed-h');
      if (w !== curW) {
        curW = w; size.w = w;
        flip(this.cards(), () => { card.style.gridColumn = `span ${w}`; this.spans(); });
      } else this.spans();
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      card.classList.remove('resizing'); window.__layoutDragging = false;
      this.persist();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }
}

// FLIP: animate elements smoothly from where they were to where a DOM/layout change puts them.
function flip(els, change) {
  const before = new Map(els.map((el) => [el, el.getBoundingClientRect()]));
  change();
  for (const el of els) {
    if (el.classList.contains('dragging')) continue;
    const a = before.get(el), b = el.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top;
    if (!dx && !dy) continue;
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transition = 'transform .32s cubic-bezier(.2,.8,.2,1)';
      el.style.transform = '';
      setTimeout(() => { el.style.transition = ''; }, 340);
    }));
  }
}
