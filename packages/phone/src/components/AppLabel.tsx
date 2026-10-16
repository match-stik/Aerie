// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import React, { useLayoutEffect, useRef } from 'react';
import { cn } from '../lib/utils';

const BASE_PX = 10;
const MIN_PX = 7;

/**
 * The name under an app tile, fitted to its cell. A long single word (Companions,
 * Integrations) can't wrap, and at five in a row on a narrow phone it ran out
 * of its card. Names should not be cut off, so a word that
 * won't fit is set a little smaller until it does, never clipped; names that fit
 * keep the usual size, and names of several words still wrap between them.
 */
export function AppLabel({ children, className, plain = false }: { children: React.ReactNode; className?: string; plain?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = `${BASE_PX}px`;
      el.style.width = '';
      // A name that wraps (Command Center) would keep the whole cell's width
      // and sit off-centre; drawn as wide as its longest word instead, the
      // card hugs both lines and centres under the tile.
      if (el.clientHeight > parseFloat(getComputedStyle(el).lineHeight) * 1.5) el.style.width = 'min-content';
      // Measure the letters themselves: scrollWidth rounds to whole pixels and
      // never reads less than the box, so a word a pixel too wide went unseen
      // and pushed its card's text off-centre.
      const style = getComputedStyle(el);
      // The room is the most the card may grow to, the cell it sits in; a short
      // name's card hugs its word, so its own width says nothing about room.
      const cell = el.parentElement ?? el;
      const room = cell.clientWidth
        - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
        - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth);
      const range = document.createRange();
      range.selectNodeContents(el);
      const lines = [...range.getClientRects()];
      // The drawer opens with a little zoom (it starts at 95% and grows), and
      // the letters' rectangles come back zoomed while the cell's width does
      // not, so a fit taken mid-opening thought a word 5% narrower than it is
      // and left it hanging off one side once the zoom finished. Measure the
      // zoom and take it back out.
      const zoom = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
      const need = lines.length ? Math.max(...lines.map((r) => r.width)) / (zoom || 1) : 0;
      if (need <= room - 1) return; // a pixel spare, so nothing grazes the edge
      const size = Math.max(MIN_PX, Math.floor(BASE_PX * ((room - 1) / need) * 4) / 4);
      el.style.fontSize = `${size}px`;
    };
    fit();
    const watch = new ResizeObserver(fit);
    if (el.parentElement) watch.observe(el.parentElement);
    // A font that arrives after the first fit changes every letter's width, so
    // fit again once it lands.
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    let alive = true;
    fonts?.ready.then(() => { if (alive) fit(); });
    fonts?.addEventListener?.('loadingdone', fit);
    return () => {
      alive = false;
      watch.disconnect();
      fonts?.removeEventListener?.('loadingdone', fit);
    };
  }, [children]);
  return (
    // The card centres its words as a box rather than as a line of text: if a
    // word on some phone still comes out a hair wider than the fit allowed, it
    // spills evenly off both sides instead of off the right.
    <span ref={ref} className={cn('aerie-app-label font-medium tracking-wide text-center', plain && 'aerie-app-label-plain', className)} style={{ fontSize: BASE_PX, display: 'inline-flex', justifyContent: 'center' }}>
      <span style={{ textAlign: 'center' }}>{children}</span>
    </span>
  );
}
