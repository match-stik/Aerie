// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Sideways rows on the laptop (theirs, Nov 15 2026: 'I can't drag over on the
// longer tab cards'). A row of tabs that scrolls sideways was built for a
// thumb; a mouse has neither a swipe nor a scrollbar there (they are hidden
// house-wide). So on the laptop such a row follows the wheel, and a mouse can
// drag it, the click at the end of a drag landing nowhere.

/** The nearest ancestor that can scroll sideways and not up and down. */
export function sidewaysRow(start: EventTarget | null): HTMLElement | null {
  let el = start instanceof Element ? start as HTMLElement : null;
  while (el && el !== document.body) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const style = getComputedStyle(el);
      const x = style.overflowX;
      const verticalRoom = el.scrollHeight > el.clientHeight + 1 && (style.overflowY === 'auto' || style.overflowY === 'scroll');
      if ((x === 'auto' || x === 'scroll') && !verticalRoom) return el;
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
