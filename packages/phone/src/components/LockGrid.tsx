// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The lock screen's pieces on a grid (theirs, Nov 8 2026: 'I think the grid').
// Every piece takes the cells it actually draws (measured, so a bigger clock
// or a weather card simply takes more), sits where they put it, and nothing
// slides out of anything's way. Holding a piece lifts it; a dashed box shows
// exactly where it will land, at its own size (theirs, Nov 8 2026: what they held
// wasn't falling into the outline, because the box drew the whole cell span
// while the piece sits centered in it); letting go puts it there
// (lib/grid-place.ts), and a piece let go of in the strip at the top is
// tucked away if it can be. Across, places count in quarter columns
// (lib/lock-grid.ts), so any piece can sit dead center.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { haptic } from '../lib/utils';
import { GRID_COLS, keepPlaces, placeOnGrid, type GridSize, type GridSpot } from '../lib/grid-place';
import { cellsFor, defaultLockSpot, drawnLeft, fromSteps, LOCK_GAP_PX, LOCK_GRID_PIECES, LOCK_ROW_STEP_PX, LOCK_STEPS, lockSpanPx, rowsIn, spotForBox, toSteps, type LockGridPiece } from '../lib/lock-grid';
import type { ClockAt } from '../lib/lock-clock';

export interface LockGridItem {
  id: LockGridPiece;
  node: React.ReactNode;
  /** Shown at all (a card with nothing to say is not). */
  present: boolean;
  /** As wide as the grid, the way the cards are. */
  full?: boolean;
  /** Let go of in the strip at the top, it is tucked away. */
  hideable?: boolean;
}

const HOLD_MS = 450;
const HOLD_SLOP = 14;
/** How far a near miss snaps flush, in quarter rows: three of the home screen's thirds. */
const SNAP_STEPS = 12;

interface Lift { id: LockGridPiece; left: number; top: number; to: GridSpot; over: boolean }

export function LockGrid({
  items,
  saved,
  legacy = {},
  face,
  onPlace,
  onHide,
}: {
  items: LockGridItem[];
  /** The places they saved (theme.lockSpots). */
  saved: Partial<Record<LockGridPiece, GridSpot>>;
  /** Where the clock and the weather were dragged to before the grid, as the
   *  middle of the piece in fractions of the screen; turned into cells the
   *  first time, so nothing jumps. */
  legacy?: Partial<Record<'clock' | 'weather', ClockAt | null>>;
  face: string;
  onPlace?: (spots: Record<LockGridPiece, GridSpot>) => void;
  onHide?: (id: LockGridPiece) => void;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<LockGridPiece, HTMLDivElement>());
  const [frame, setFrame] = useState<{ w: number; h: number; left: number; top: number; fw: number; fh: number } | null>(null);
  const [boxes, setBoxes] = useState<Partial<Record<LockGridPiece, { w: number; h: number }>>>({});
  const [lift, setLift] = useState<Lift | null>(null);
  const liftRef = useRef<Lift | null>(null);
  const hold = useRef({ timer: 0, id: null as LockGridPiece | null, x: 0, y: 0, lastX: 0, lastY: 0, grabX: 0, grabY: 0, pointer: -1, dragging: false, armed: false, droppedAt: 0 });

  // The grid's own size and where it sits in the lock screen, kept current.
  useLayoutEffect(() => {
    const g = grid.current;
    if (!g) return;
    const read = () => {
      const r = g.getBoundingClientRect();
      const f = g.closest<HTMLElement>('[data-lock-frame]')?.getBoundingClientRect() ?? r;
      setFrame((prev) => {
        const next = { w: r.width, h: r.height, left: r.left - f.left, top: r.top - f.top, fw: f.width, fh: f.height };
        if (prev && Object.keys(next).every((k) => Math.abs((prev as Record<string, number>)[k] - (next as Record<string, number>)[k]) < 1)) return prev;
        return next;
      });
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(g);
    return () => ro.disconnect();
  }, []);

  // Each piece's own drawn size, kept current (a clock changes width with
  // the time; the Spotify card is nothing at all while nothing is playing).
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      setBoxes((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [id, el] of els.current) {
          // Fractional, not offsetWidth's whole pixels, or a centered piece sits a fraction off.
          const r = el.getBoundingClientRect();
          const b = { w: r.width, h: r.height };
          const p = prev[id];
          if (!p || Math.abs(p.w - b.w) >= 1 || Math.abs(p.h - b.h) >= 1) { next[id] = b; changed = true; }
        }
        return changed ? next : prev;
      });
    });
    for (const el of els.current.values()) ro.observe(el);
    return () => ro.disconnect();
  });

  const colW = frame ? (frame.w - LOCK_GAP_PX * (GRID_COLS - 1)) / GRID_COLS : 0;
  const maxRows = frame ? rowsIn(frame.h) : 1;
  const byId = new Map(items.map((i) => [i.id, i]));
  const sizeOf = (id: LockGridPiece): GridSize => {
    const b = boxes[id] ?? { w: 0, h: 0 };
    const cells = cellsFor(b.w, b.h, colW);
    return byId.get(id)?.full ? { cols: LOCK_STEPS, rows: cells.rows } : cells;
  };
  const shown = LOCK_GRID_PIECES.filter((id) => {
    const it = byId.get(id);
    const b = boxes[id];
    return it?.present && b && b.h > 0;
  });

  // Them old free spots, turned into cells for a piece that has no cell yet.
  const wanted: Partial<Record<LockGridPiece, GridSpot>> = {};
  for (const [id, s] of Object.entries(saved) as [LockGridPiece, GridSpot][]) wanted[id] = toSteps(s);
  if (frame) {
    for (const id of ['clock', 'weather'] as const) {
      const at = legacy[id];
      const b = boxes[id];
      if (wanted[id] || !at || !b) continue;
      const left = at.x * frame.fw - b.w / 2 - frame.left;
      const top = at.y * frame.fh - b.h / 2 - frame.top;
      const size = sizeOf(id);
      const s = spotForBox(left, top, size, b.w, b.h, colW, frame.h);
      wanted[id] = { col: Math.min(LOCK_STEPS - size.cols, Math.max(0, s.col)), row: Math.min(Math.max(0, maxRows - size.rows), Math.max(0, s.row)) };
    }
  }
  const layout = frame ? keepPlaces(shown, wanted, sizeOf, maxRows, (id) => defaultLockSpot(id, sizeOf(id), maxRows, face), LOCK_STEPS) : ({} as Record<LockGridPiece, GridSpot>);

  const show = (next: Lift | null) => { liftRef.current = next; setLift(next); };
  const stopTimer = () => { if (hold.current.timer) { window.clearTimeout(hold.current.timer); hold.current.timer = 0; } };
  useEffect(() => stopTimer, []);

  const follow = (id: LockGridPiece, clientX: number, clientY: number): Lift | null => {
    const g = grid.current?.getBoundingClientRect();
    if (!g || !frame) return null;
    const h = hold.current;
    const left = clientX - h.grabX - g.left;
    const top = clientY - h.grabY - g.top;
    const size = sizeOf(id);
    const b = boxes[id] ?? { w: 0, h: 0 };
    const s = spotForBox(left, top, size, b.w, b.h, colW, frame.h);
    const want = { col: Math.min(LOCK_STEPS - size.cols, Math.max(0, s.col)), row: Math.min(Math.max(0, maxRows - size.rows), Math.max(0, s.row)) };
    // Where it will really sit, after a near miss snaps flush against a
    // neighbor, so the outline never promises a spot the drop won't keep.
    const to = layout[id] ? placeOnGrid(layout, shown, id, want, maxRows, sizeOf, SNAP_STEPS, LOCK_STEPS)[id] : want;
    const inStrip = clientY <= g.top - 4;
    if (!inStrip) h.armed = true;
    const over = !!byId.get(id)?.hideable && !!onHide && h.armed && inStrip;
    return { id, left, top, to, over };
  };

  const handlers = (id: LockGridPiece) => onPlace ? {
    onPointerDown: (e: React.PointerEvent) => {
      const h = hold.current;
      stopTimer();
      h.id = id; h.x = h.lastX = e.clientX; h.y = h.lastY = e.clientY; h.pointer = e.pointerId; h.dragging = false;
      h.timer = window.setTimeout(() => {
        h.timer = 0;
        const el = els.current.get(id);
        if (!el) return;
        const r = el.getBoundingClientRect();
        h.grabX = h.lastX - r.left;
        h.grabY = h.lastY - r.top;
        h.dragging = true;
        h.armed = false;
        haptic(55);
        try { el.setPointerCapture(h.pointer); } catch { /* the finger already left */ }
        show(follow(id, h.lastX, h.lastY));
      }, HOLD_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const h = hold.current;
      h.lastX = e.clientX; h.lastY = e.clientY;
      if (!h.dragging) {
        if (Math.hypot(e.clientX - h.x, e.clientY - h.y) > HOLD_SLOP) stopTimer();
        return;
      }
      const next = follow(id, e.clientX, e.clientY);
      if (next && next.over !== liftRef.current?.over && next.over) haptic(20);
      show(next);
    },
    onPointerUp: () => {
      stopTimer();
      const h = hold.current;
      if (!h.dragging) return;
      h.dragging = false;
      h.droppedAt = Date.now();
      const done = liftRef.current;
      show(null);
      if (!done) return;
      if (done.over && onHide) { haptic(55); onHide(id); return; }
      const from = layout[id];
      if (from && (from.col !== done.to.col || from.row !== done.to.row)) {
        haptic(55);
        const next = placeOnGrid(layout, shown, id, done.to, maxRows, sizeOf, SNAP_STEPS, LOCK_STEPS);
        const out = {} as Record<LockGridPiece, GridSpot>;
        for (const [k, v] of Object.entries(next) as [LockGridPiece, GridSpot][]) out[k] = fromSteps(v);
        onPlace(out);
      }
    },
    onPointerCancel: () => {
      stopTimer();
      hold.current.dragging = false;
      show(null);
    },
    // Letting go of a carried card must not open its app as well.
    onClickCapture: (e: React.MouseEvent) => {
      if (Date.now() - hold.current.droppedAt < 400) { e.preventDefault(); e.stopPropagation(); }
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  } : {};

  // The box a piece draws in when it sits at a spot: its own size, centered
  // across its cells, standing on their bottom edge. The placed piece and the
  // outline both use it, so the one always lands in the other.
  const drawnAt = (id: LockGridPiece, s: GridSpot) => {
    const size = sizeOf(id);
    const b = boxes[id] ?? { w: 0, h: 0 };
    const w = byId.get(id)?.full ? lockSpanPx(size.cols, colW) : b.w;
    return { left: drawnLeft(s, size, w, colW), bottom: s.row * LOCK_ROW_STEP_PX, width: w, height: b.h };
  };

  return (
    <>
      <div
        ref={grid}
        data-lock-grid=""
        className="pointer-events-none absolute z-20"
        style={{ left: 12, right: 12, top: 'calc(var(--sat, 0px) + 48px)', bottom: 'calc(var(--sab, 0px) + 112px)' }}
      >
        {lift && frame && (
          <div
            aria-hidden="true"
            className="absolute"
            style={(() => { const d = drawnAt(lift.id, lift.to); return { left: d.left - 6, bottom: d.bottom - 6, width: d.width + 12, height: d.height + 12, border: '2px dashed rgba(255,255,255,0.75)', borderRadius: 18, background: 'rgba(255,255,255,0.10)', opacity: lift.over ? 0 : 1 }; })()}
          />
        )}
        {items.map((it) => {
          if (!it.present) return null;
          const s = layout[it.id];
          const b = boxes[it.id];
          const carried = lift?.id === it.id;
          let place: React.CSSProperties = { left: 0, bottom: 0, visibility: 'hidden' };
          if (frame && s && b) {
            const d = drawnAt(it.id, s);
            place = { left: d.left, bottom: d.bottom };
          }
          if (carried && lift) place = { left: lift.left, top: lift.top, zIndex: 30, opacity: lift.over ? 0.5 : 0.92 };
          return (
            <div
              key={it.id}
              ref={(el) => { if (el) els.current.set(it.id, el); else els.current.delete(it.id); }}
              data-lock-piece={it.id}
              className={`absolute ${onPlace ? 'pointer-events-auto select-none' : ''}`}
              style={{ ...place, width: it.full ? '100%' : 'max-content', touchAction: onPlace ? 'none' : undefined }}
              {...handlers(it.id)}
            >
              {it.node}
            </div>
          );
        })}
      </div>
      {lift && (
        <div className="pointer-events-none absolute inset-x-0 z-30 flex justify-center" style={{ top: 'calc(var(--sat, 0px) + 14px)' }}>
          {byId.get(lift.id)?.hideable && onHide ? (
            <span
              className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium text-white transition-colors"
              style={lift.over
                ? { background: 'rgba(190, 40, 40, 0.85)', borderColor: 'rgba(255,255,255,0.5)' }
                : { background: 'rgba(0,0,0,0.55)', borderColor: 'rgba(255,255,255,0.2)' }}
            >
              <X className="h-3.5 w-3.5" />
              {lift.over ? 'Let go to hide it' : 'Drag up here to hide'}
            </span>
          ) : (
            <span className="rounded-full border border-white/20 bg-black/55 px-3 py-1 text-xs font-medium text-white">Let go to drop it in the box</span>
          )}
        </div>
      )}
    </>
  );
}
