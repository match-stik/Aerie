// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { useEffect, useState } from 'react';

// Sideways rows on the laptop. A row of tabs that scrolls sideways was built for a
// thumb; a mouse has neither a swipe nor a scrollbar there (they are hidden
// house-wide). So on the laptop such a row follows the wheel, and a mouse can
// drag it, the click at the end of a drag landing nowhere.

/** A row short enough to be a row of tabs or chips, not a whole area. */
const ROW_MAX_HEIGHT = 160;

/**
 * The nearest ancestor that scrolls sideways and not up and down, and is a
 * row rather than an area. The walk stops at the first thing that scrolls up
 * and down, because the wheel belongs to that: walking on past it handed the
 * wheel to whatever sideways box sat further out, and the room stopped
 * scrolling wherever the mouse happened to be.
 */
export function sidewaysRow(start: EventTarget | null): HTMLElement | null {
  let el = start instanceof Element ? start as HTMLElement : null;
  while (el && el !== document.body) {
    const style = getComputedStyle(el);
    const y = style.overflowY;
    if ((y === 'auto' || y === 'scroll') && el.scrollHeight > el.clientHeight + 1) return null;
    const x = style.overflowX;
    if ((x === 'auto' || x === 'scroll') && el.scrollWidth > el.clientWidth + 1) {
      return el.clientHeight <= ROW_MAX_HEIGHT ? el : null;
    }
    el = el.parentElement;
  }
  return null;
}

/** Turn the wheel and mouse drags into sideways scrolling for such rows. Returns the undo. */
export function installDeskScroll(): () => void {
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    const row = sidewaysRow(e.target);
    if (!row) return;
    const max = row.scrollWidth - row.clientWidth;
    const next = Math.max(0, Math.min(max, row.scrollLeft + e.deltaY));
    if (next === row.scrollLeft) return;
    e.preventDefault();
    row.scrollLeft = next;
  };

  let drag: { row: HTMLElement; x: number; left: number; moved: boolean; id: number } | null = null;
  let swallowClick = false;
  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    const row = sidewaysRow(e.target);
    if (!row) return;
    drag = { row, x: e.clientX, left: row.scrollLeft, moved: false, id: e.pointerId };
  };
  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 5) return;
    drag.moved = true;
    drag.row.scrollLeft = drag.left - dx;
    drag.row.style.cursor = 'grabbing';
  };
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.moved) swallowClick = true;
    drag.row.style.cursor = '';
    drag = null;
  };
  const onClick = (e: MouseEvent) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onUp, true);
  window.addEventListener('click', onClick, true);
  return () => {
    window.removeEventListener('wheel', onWheel);
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
    window.removeEventListener('click', onClick, true);
  };
}

// The arrow keys on the laptop. A key
// scrolls whatever list the mouse is resting over, with no click first. It
// never takes a key from somewhere typing happens, or from a menu that uses
// the arrows itself.

const KEY_STEP = 48;

/** The nearest ancestor that scrolls up and down and has somewhere to go. */
export function verticalScroller(start: EventTarget | null): HTMLElement | null {
  let el = start instanceof Element ? start as HTMLElement : null;
  while (el && el !== document.body && el !== document.documentElement) {
    const y = getComputedStyle(el).overflowY;
    if ((y === 'auto' || y === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
    el = el.parentElement;
  }
  return null;
}

/** How far a key moves a list of this height, or null for a key that is not ours. */
export function keyScrollDelta(key: string, clientHeight: number, scrollHeight: number, scrollTop: number): number | null {
  switch (key) {
    case 'ArrowDown': return KEY_STEP;
    case 'ArrowUp': return -KEY_STEP;
    case 'PageDown': return Math.round(clientHeight * 0.9);
    case 'PageUp': return -Math.round(clientHeight * 0.9);
    case 'Home': return -scrollTop;
    case 'End': return scrollHeight - clientHeight - scrollTop;
    default: return null;
  }
}

function keysBelongElsewhere(el: Element | null): boolean {
  if (!el || el === document.body) return false;
  return Boolean(el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="listbox"], [role="menu"], [role="slider"], [role="tablist"], [role="radiogroup"]'));
}

/** Arrow, Page and Home/End keys scroll the list under the mouse. Returns the undo. */
export function installDeskKeys(): () => void {
  let hovered: EventTarget | null = null;
  const onOver = (e: PointerEvent) => { if (e.pointerType === 'mouse') hovered = e.target; };
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (keysBelongElsewhere(document.activeElement)) return;
    const list = verticalScroller(hovered);
    if (!list) return;
    const delta = keyScrollDelta(e.key, list.clientHeight, list.scrollHeight, list.scrollTop);
    if (delta === null || delta === 0) return;
    e.preventDefault();
    list.scrollTop += delta;
  };
  window.addEventListener('pointerover', onOver, true);
  window.addEventListener('keydown', onKey);
  return () => {
    window.removeEventListener('pointerover', onOver, true);
    window.removeEventListener('keydown', onKey);
  };
}

// Baby arrows. On the laptop, a list under the mouse that has more above or below
// shows a bare arrow at that end, riding its right edge where a scroll bar
// would be, with no bar, bubble or rectangle. A click moves it a few lines.
// Nothing shows on a list that does not scroll, and nothing on the
// phone. One pair lives on the page and follows whichever list the mouse is on.

const ARROW_W = 12;
const ARROW_H = 16;
// From the list's right edge, and from its top and bottom.
const EDGE_GAP = 2;
const END_GAP = 6;
const MIN_HEIGHT = 90;

/** Which ends of a list have more to see. */
export function arrowEnds(scrollTop: number, clientHeight: number, scrollHeight: number): { up: boolean; down: boolean } {
  return { up: scrollTop > 1, down: scrollTop + clientHeight < scrollHeight - 1 };
}

/**
 * Where an arrow sits across: inside the list's own right padding when there
 * is room for it there, so it never covers anything; otherwise just outside
 * the list's edge, in the gap beside it, so it does not sit on the bubbles of a
 * table chat whose words run to the edge; and inside when
 * there is no gap. The gap has to belong to whatever holds the list: measured
 * against the whole window, a table chat flush with its column put its arrow
 * out on the room's wallpaper.
 */
export function arrowLeft(right: number, paddingRight: number, holderRight: number): number {
  if (paddingRight >= ARROW_W + EDGE_GAP) return right - ARROW_W - EDGE_GAP;
  if (right + EDGE_GAP + ARROW_W <= holderRight) return right + EDGE_GAP;
  return right - ARROW_W - EDGE_GAP;
}

/**
 * How far one click on an arrow moves a list: a few lines, not a screen.
 */
export function arrowStep(clientHeight: number): number {
  return Math.round(Math.max(KEY_STEP, Math.min(160, clientHeight * 0.3)));
}

const CHEVRON_UP = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>';
const CHEVRON_DOWN = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

export function installDeskArrows(): () => void {
  const box = document.createElement('div');
  box.className = 'aerie-scroll-arrows';
  const up = document.createElement('button');
  const down = document.createElement('button');
  up.type = down.type = 'button';
  up.tabIndex = down.tabIndex = -1;
  up.setAttribute('aria-label', 'Scroll up');
  down.setAttribute('aria-label', 'Scroll down');
  up.innerHTML = CHEVRON_UP;
  down.innerHTML = CHEVRON_DOWN;
  box.append(up, down);
  document.body.appendChild(box);

  let current: HTMLElement | null = null;
  const hide = () => { up.style.display = 'none'; down.style.display = 'none'; };
  const place = () => {
    if (!current || !current.isConnected) { current = null; hide(); return; }
    const r = current.getBoundingClientRect();
    if (r.height < MIN_HEIGHT || r.width < ARROW_W * 4) { hide(); return; }
    const ends = arrowEnds(current.scrollTop, current.clientHeight, current.scrollHeight);
    const holder = current.parentElement?.getBoundingClientRect();
    const left = `${Math.round(arrowLeft(r.right, parseFloat(getComputedStyle(current).paddingRight) || 0, holder ? holder.right : r.right))}px`;
    up.style.left = down.style.left = left;
    up.style.top = `${Math.round(r.top + END_GAP)}px`;
    down.style.top = `${Math.round(r.bottom - ARROW_H - END_GAP)}px`;
    up.style.display = ends.up ? '' : 'none';
    down.style.display = ends.down ? '' : 'none';
  };
  const step = (dir: 1 | -1) => {
    if (!current) return;
    current.scrollBy({ top: dir * arrowStep(current.clientHeight), behavior: 'smooth' });
  };
  const onOver = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    if (box.contains(e.target as Node)) return;
    const found = verticalScroller(e.target);
    // A box they type in scrolls too, but its arrows would sit over their words
    //; never there.
    const next = found && found.closest('textarea, input, select, [contenteditable=""], [contenteditable="true"]') ? null : found;
    // Crossing the small gap to an arrow sitting just outside a list passes
    // over whatever holds the list; keep the list while the mouse is still
    // level with it and within reach of its arrow.
    if (current && next !== current && (!next || next.contains(current))) {
      const r = current.getBoundingClientRect();
      if (e.clientY >= r.top && e.clientY <= r.bottom && e.clientX >= r.left && e.clientX <= r.right + ARROW_W + EDGE_GAP * 3) return;
    }
    current = next;
    place();
  };
  const onScroll = (e: Event) => { if (e.target === current) place(); };
  const onLeave = () => { current = null; hide(); };
  // A click on an arrow never takes focus from wherever typing was happening.
  const keepFocus = (e: PointerEvent) => e.preventDefault();
  const onUp = () => step(-1);
  const onDown = () => step(1);
  up.addEventListener('pointerdown', keepFocus);
  down.addEventListener('pointerdown', keepFocus);
  up.addEventListener('click', onUp);
  down.addEventListener('click', onDown);
  window.addEventListener('pointerover', onOver, true);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', place);
  document.documentElement.addEventListener('mouseleave', onLeave);
  hide();
  return () => {
    window.removeEventListener('pointerover', onOver, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', place);
    document.documentElement.removeEventListener('mouseleave', onLeave);
    box.remove();
  };
}

const MOUSE_QUERY = '(any-pointer: fine)';

/** Whether this device has a mouse or trackpad, whatever the window's size. */
export function useHasMouse(): boolean {
  const [has, setHas] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(MOUSE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(MOUSE_QUERY);
    if (!mq) return;
    const on = () => setHas(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return has;
}
