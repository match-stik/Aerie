// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A bubble with a swoop on its tail corner instead of a flat point, painted as
// ONE shape. An earlier version painted a matching curl beside the bubble, and
// it always showed a join where the two met.
//
// The bubble keeps its words and its box, and stops painting itself (the
// aerie-bubble-skinned class). Behind it this draws the bubble's color and its
// thin edge as one outline, rounded corners and curl together, cut by an SVG
// path sized to the bubble: one paint layer wearing the bubble's own paint
// class (its gradient and the wash on top), and one layer for the edge line,
// a band just inside the same outline in the bubble's edge color, exactly
// where the bubble's own border sat. One sweep of color, one line, no join.
//
// The curl curls out of the corner the point sat in and hugs that edge, so it
// never meets the face beside it: a round face only reaches toward the bubble
// halfway up. The same piece draws the chat and the Settings preview, so the
// preview shows what lands in the thread. Everything is read off the page, so
// it is read again when the bubble resizes and when the theme changes.
import React, { useId, useLayoutEffect, useState } from 'react';
import { cn } from '../lib/utils';
import { apiFetch } from '../aerie';

const CURL = 15;

// The instrument: a bubble's color can land late after its words. Every skin times its own mount to its first
// paint, counts the frames it spent with no bubble to read and the measures it
// took before it settled, and anything slower than a fifth of a second is
// posted to the error log as [client-error] swoop-paint, one at most every ten
// seconds, so the next slow one names its own cause.
let lastReport = 0;
function reportSlowPaint(detail: Record<string, unknown>) {
  if (Date.now() - lastReport < 10_000) return;
  lastReport = Date.now();
  void apiFetch('/api/client-errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ where: 'swoop-paint', message: JSON.stringify(detail) }),
  }).catch(() => {});
}
export const SKINNED = 'aerie-bubble-skinned';

// The paint is read off the page, so it is read again when the theme changes,
// or the bubbles keep the colors of the theme they were first drawn in. A theme change lands as new
// variables and a palette name on the root, so one watcher on the root tells
// every bubble, at most once a frame.
const repaints = new Set<() => void>();
// The edge color and corner radii are read by taking the bubble's skin off for
// a moment, which makes the page redo its styles; done for every bubble while
// a thread mounts, that was the whole page redoing its styles hundreds of
// times in one frame. Bubbles with the same classes and style read the same,
// so one read is kept per look and dropped whenever the theme moves.
const styleReads = new Map<string, Pick<Measured, 'radii' | 'edge' | 'edgeWidth'>>();
let rootWatcher: MutationObserver | null = null;
let queued = 0;
function onThemeRepaint(listener: () => void): () => void {
  repaints.add(listener);
  if (!rootWatcher && typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    rootWatcher = new MutationObserver(() => {
      if (queued) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        styleReads.clear();
        repaints.forEach((repaint) => repaint());
      });
    });
    rootWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-palette'] });
  }
  return () => {
    repaints.delete(listener);
    if (repaints.size === 0 && rootWatcher) {
      rootWatcher.disconnect();
      rootWatcher = null;
    }
  };
}

/**
 * The whole outline as one path, in the skin's own coordinates: the bubble's
 * rounded corners, and in place of the pointed corner a quarter-circle curl of
 * radius `curl` sweeping from the bubble's side out to a tip `curl` beyond it.
 * `dx` shifts the bubble right inside the skin (by the curl, when it curls left).
 */
export function skinPath(
  w: number, h: number,
  radii: { tl: number; tr: number; br: number; bl: number },
  right: boolean, top: boolean, curl: number,
): string {
  const dx = right ? 0 : curl;
  const X = (x: number) => +(x + dx).toFixed(2);
  const Y = (y: number) => +y.toFixed(2);
  const arc = (r: number, x: number, y: number) => (r > 0 ? `A${r} ${r} 0 0 1 ${X(x)} ${Y(y)}` : `L${X(x)} ${Y(y)}`);
  const C = curl;
  const { tl, tr, br, bl } = radii;
  if (right && !top) {
    return [`M${X(tl)} 0`, `H${X(w - tr)}`, arc(tr, w, tr), `V${Y(h - C)}`, `A${C} ${C} 0 0 0 ${X(w + C)} ${Y(h)}`,
      `H${X(bl)}`, arc(bl, 0, h - bl), `V${Y(tl)}`, arc(tl, tl, 0), 'Z'].join(' ');
  }
  if (right && top) {
    return [`M${X(tl)} 0`, `H${X(w + C)}`, `A${C} ${C} 0 0 0 ${X(w)} ${Y(C)}`, `V${Y(h - br)}`, arc(br, w - br, h),
      `H${X(bl)}`, arc(bl, 0, h - bl), `V${Y(tl)}`, arc(tl, tl, 0), 'Z'].join(' ');
  }
  if (!right && !top) {
    return [`M${X(tl)} 0`, `H${X(w - tr)}`, arc(tr, w, tr), `V${Y(h - br)}`, arc(br, w - br, h),
      `H${X(-C)}`, `A${C} ${C} 0 0 0 ${X(0)} ${Y(h - C)}`, `V${Y(tl)}`, arc(tl, tl, 0), 'Z'].join(' ');
  }
  return [`M${X(-C)} 0`, `H${X(w - tr)}`, arc(tr, w, tr), `V${Y(h - br)}`, arc(br, w - br, h),
    `H${X(bl)}`, arc(bl, 0, h - bl), `V${Y(C)}`, `A${C} ${C} 0 0 0 ${X(-C)} 0`, 'Z'].join(' ');
}

interface Measured {
  x: number;
  y: number;
  w: number;
  h: number;
  radii: { tl: number; tr: number; br: number; bl: number };
  edge: string | null;
  edgeWidth: number;
}

export function BubbleSkin({ bubbleRef, right, top, paintClass }: {
  bubbleRef: React.RefObject<HTMLElement | null>;
  /** The owner's bubbles curl to the right, a companion's to the left. */
  right: boolean;
  /** The tail at the top corner rather than the bottom one. */
  top: boolean;
  /** The bubble's own paint class: its gradient, and the wash its ::before lays on top. */
  paintClass: string;
}) {
  const [box, setBox] = useState<Measured | null>(null);
  const [tick, setTick] = useState(0);
  const clipId = `skin${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const timing = React.useRef({ mounted: typeof performance !== 'undefined' ? performance.now() : 0, noBubble: 0, measures: 0, reported: false });
  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!bubble) {
      timing.current.noBubble += 1;
      // Mounted in the same pass as its bubble, before the bubble's ref was
      // set: look again a frame later rather than drawing nothing for good.
      // An update made here is drawn before the screen is, and by then the
      // bubble's ref is set, so the first look-again is immediate. Only if the
      // bubble is still missing after that does it wait for a frame. Waiting a
      // frame every time made bubbles slow (measured on a phone: 874 ms from
      // mount to color while a whole thread mounted, because a frame does not come round until all of that work is done).
      setBox(null);
      if (timing.current.noBubble <= 1) {
        setTick((n) => n + 1);
        return undefined;
      }
      const retry = requestAnimationFrame(() => setTick((n) => n + 1));
      return () => cancelAnimationFrame(retry);
    }
    // The bubble's own style and class are watched too: switching the edges
    // from the companions' colors to the theme's, or a tail moving corners, changes
    // neither the bubble's size nor the theme, and the bubbles already on
    // screen kept their old edge. The measure's own
    // class and transition flips come back off the queue as it finishes, so
    // it never wakes itself.
    let ownStyle: MutationObserver | null = null;
    const measure = () => {
      // The edge's color is read with the bubble painting itself for a
      // moment, since a skinned bubble's own edge is see-through on purpose.
      // Its transitions are held off while it does, or the read catches the
      // first frame of a fade back to see-through and finds no edge at all.
      const key = `${bubble.className.replace(SKINNED, '')}|${bubble.style.cssText}`;
      const cached = styleReads.get(key);
      if (cached) {
        const cs = getComputedStyle(bubble);
        const layoutW = parseFloat(cs.width);
        const layoutH = parseFloat(cs.height);
        const next: Measured = {
          x: bubble.offsetLeft,
          y: bubble.offsetTop,
          w: Number.isFinite(layoutW) ? layoutW : bubble.offsetWidth,
          h: Number.isFinite(layoutH) ? layoutH : bubble.offsetHeight,
          ...cached,
        };
        timing.current.measures += 1;
        setBox((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
        return;
      }
      const skinned = bubble.classList.contains(SKINNED);
      const transition = bubble.style.transition;
      bubble.style.transition = 'none';
      if (skinned) bubble.classList.remove(SKINNED);
      const cs = getComputedStyle(bubble);
      const edgeWidth = parseFloat(cs.borderBottomWidth) || 0;
      const edge = edgeWidth > 0 ? cs.borderBottomColor : null;
      const radius = (v: string) => parseFloat(v) || 0;
      const radii = {
        tl: radius(cs.borderTopLeftRadius),
        tr: radius(cs.borderTopRightRadius),
        br: radius(cs.borderBottomRightRadius),
        bl: radius(cs.borderBottomLeftRadius),
      };
      if (skinned) bubble.classList.add(SKINNED);
      void getComputedStyle(bubble).borderBottomColor;
      bubble.style.transition = transition;
      // Layout size and place, never the size on screen. A message arriving
      // live grows in from 95%, and a skin read off the screen in the middle
      // of that grow kept 95% for good, since nothing resizes when a grow
      // ends: the curl came up short and ran into the face pinned at the
      // bubble's real bottom. The computed size and the offsets both ignore
      // transforms, so a grow, a slide or a scale never reaches the skin.
      const layoutW = parseFloat(cs.width);
      const layoutH = parseFloat(cs.height);
      const next: Measured = {
        x: bubble.offsetLeft,
        y: bubble.offsetTop,
        w: Number.isFinite(layoutW) ? layoutW : bubble.offsetWidth,
        h: Number.isFinite(layoutH) ? layoutH : bubble.offsetHeight,
        radii,
        edge,
        edgeWidth,
      };
      styleReads.set(key, { radii, edge, edgeWidth });
      timing.current.measures += 1;
      setBox((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      ownStyle?.takeRecords();
    };
    measure();
    const offTheme = onThemeRepaint(measure);
    if (typeof MutationObserver !== 'undefined') {
      ownStyle = new MutationObserver(() => measure());
      ownStyle.observe(bubble, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    // The border box, so a change of padding or edge width re-measures too.
    const watcher = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
    watcher?.observe(bubble, { box: 'border-box' });
    return () => {
      watcher?.disconnect();
      ownStyle?.disconnect();
      offTheme();
    };
  }, [bubbleRef, tick]);

  useLayoutEffect(() => {
    const t = timing.current;
    if (t.reported || !box || box.w <= 0 || box.h <= 0) return;
    t.reported = true;
    const ms = Math.round(performance.now() - t.mounted);
    if (ms > 200) {
      const bubble = bubbleRef.current;
      reportSlowPaint({ ms, mine: right, noBubble: t.noBubble, measures: t.measures, w: Math.round(box.w), h: Math.round(box.h), hidden: document.visibilityState, text: (bubble?.textContent || '').slice(0, 24) });
    }
  }, [box, bubbleRef, right]);

  if (!box || box.w <= 0 || box.h <= 0) return null;
  const C = CURL;
  const W = box.w + C;
  const d = skinPath(box.w, box.h, box.radii, right, top, C);
  // The shape is drawn straight from the path, never through a picture. An
  // earlier version masked both layers by an SVG handed over as a data URL,
  // and a mask picture is decoded off to the side: until it lands the layer is
  // masked out completely, and every resize (a message growing in, the bubble's
  // own half-second transition) made a new one to decode, so on a phone the
  // paint turned up a few seconds after the words.
  // A clip-path is applied in the same frame it is set.
  const clip = `path('${d}')`;
  // The soft drop shadow is cast by the whole outline, curl included. Cast by
  // the bubble's box, as it was, it fell across the curl, which sits outside
  // the box and under it, and left the curl a hair darker than the corner it
  // grows from: plain by day, lost at night. A
  // filter's blur is half a box shadow's, so 12 here is the old 24, measured
  // side by side. It sits on a holder, since a clip would cut it off.
  const place: React.CSSProperties = {
    position: 'absolute',
    left: box.x - (right ? 0 : C),
    top: box.y,
    width: W,
    height: box.h,
    pointerEvents: 'none',
    filter: 'drop-shadow(0 8px 12px rgba(0, 0, 0, 0.12))',
  };
  const layer: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    border: 'none',
    boxShadow: 'none',
  };
  return (
    <span aria-hidden className="aerie-bubble-skin-holder block" style={place}>
      <span className={cn('aerie-bubble-skin block', paintClass)} style={{ ...layer, clipPath: clip, WebkitClipPath: clip }} />
      {box.edge && (
        // The edge: a band as wide as the bubble's border just inside the
        // outline, the stroke centered on the path and clipped to its inside.
        <svg className="aerie-bubble-skin-edge block" width={W} height={box.h} viewBox={`0 0 ${W} ${box.h}`} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
          <defs><clipPath id={clipId}><path d={d} /></clipPath></defs>
          <path d={d} fill="none" stroke={box.edge} strokeWidth={box.edgeWidth * 2} clipPath={`url(#${clipId})`} />
        </svg>
      )}
    </span>
  );
}
