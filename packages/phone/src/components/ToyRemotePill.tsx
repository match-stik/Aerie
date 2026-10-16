// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The stop that follows the owner around the app whenever they have handed
// the companions the remote. While a companion is playing the toys it glows
// in that companion's color, shows what each motor is doing, and its STOP is
// the owner's full stop: every toy, the native hold, and the remote back in
// the owner's hands. While nothing is playing it
// is a quiet reminder that the remote is out, with a way to take it back.
//
// The Toys page has its own card for all of this, so the pill stays off it.
//
// The owner can drag it to wherever it sits best, the way the voice call's
// dock moves (a fixed spot over the top of the chat sat awkwardly), and it
// stays where they left it. Only the pill's body starts a drag. STOP and Take
// it back are buttons and never do, so a press on the stop is always a stop.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Hand } from 'lucide-react';
import { ownerStop, takeBack, useToyRemote } from '../aerie/toy-remote';
import { ownerForCompanion } from '../lib/orb-field';
import { clampPillPoint, parsePillPoint, samePillBox, type PillBox, type PillPoint } from '../lib/pill-position';

const PILL_POSITION_KEY = 'aerie.toy-pill-position';

function savedPillPoint(): PillPoint | null {
  try {
    return parsePillPoint(localStorage.getItem(PILL_POSITION_KEY));
  } catch {
    return null;
  }
}

interface PillDrag {
  pointerId: number;
  startX: number;
  startY: number;
  origin: PillPoint;
  last: PillPoint;
  moved: boolean;
}

export function ToyRemotePill({ hidden = false }: { hidden?: boolean }) {
  const remote = useToyRemote();
  const [point, setPoint] = useState<PillPoint | null>(savedPillPoint);
  const [box, setBox] = useState<PillBox | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<PillDrag | null>(null);
  const visible = !hidden && !!remote.bridge && remote.gate === 'open';

  // The frame carries the safe areas as padding, which is the one place the
  // browser turns them into pixels.
  const measure = useCallback((): PillBox | null => {
    const frame = frameRef.current;
    const pill = pillRef.current;
    if (!frame || !pill) return null;
    const rect = pill.getBoundingClientRect();
    const insets = getComputedStyle(frame);
    return {
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      insetTop: parseFloat(insets.paddingTop) || 0,
      insetBottom: parseFloat(insets.paddingBottom) || 0,
    };
  }, []);

  // The pill changes width with what it is showing, so it is measured after
  // every render and pulled back onto the glass if it has grown past an edge.
  useLayoutEffect(() => {
    if (!visible) return;
    const next = measure();
    if (next && !samePillBox(next, box)) setBox(next);
  });

  useEffect(() => {
    const refit = () => setBox(measure());
    window.addEventListener('resize', refit);
    return () => window.removeEventListener('resize', refit);
  }, [measure]);

  const beginDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const origin = { x: rect.left + rect.width / 2, y: rect.top };
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin,
      last: origin,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const moveDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) <= 4 && Math.abs(dy) <= 4) return;
    drag.moved = true;
    drag.last = { x: drag.origin.x + dx, y: drag.origin.y + dy };
    setPoint(drag.last);
  }, []);

  // A cancelled gesture keeps wherever the finger had got to; its own
  // coordinates are not trusted.
  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    if (!drag.moved) return;
    const fitted = measure();
    const next = fitted ? clampPillPoint(drag.last, fitted) : drag.last;
    setPoint(next);
    try {
      localStorage.setItem(PILL_POSITION_KEY, JSON.stringify(next));
    } catch {
      // It stays where the owner put it for this session if storage is unavailable.
    }
  }, [measure]);

  if (!visible) return null;
  const playing = remote.playing;
  const who = playing ? ownerForCompanion(playing.companion) : null;
  const color = who?.color ?? '#ffa62b';
  const motors = playing?.motors ?? [];
  const said = playing
    ? `${who?.name} is playing: ${motors.map((m) => (m.command === 'PRESET' ? m.label : `${m.label} ${m.level}`)).join(', ')}`
    : 'Your companions have the remote';
  const shown = point && box ? clampPillPoint(point, box) : point;

  return (
    <div
      ref={frameRef}
      className="pointer-events-none fixed inset-0 z-[55]"
      style={{ paddingTop: 'var(--sat)', paddingBottom: 'var(--sab)' }}
    >
      <div
        ref={pillRef}
        className="pointer-events-auto absolute flex w-max touch-none select-none items-center gap-2.5 rounded-full border py-1.5 pl-3 pr-1.5 text-white"
        style={{
          left: shown ? shown.x : '50%',
          top: shown ? shown.y : 'calc(var(--sat) + 4.5rem)',
          transform: 'translateX(-50%)',
          maxWidth: 'calc(100vw - 1.5rem)',
          // The theme's two colors, deepened like the Toys page's cards so
          // white text reads on it, and painted solid rather than blurred.
          // The edge and the glow stay the color of whoever is driving.
          background: 'linear-gradient(120deg, color-mix(in srgb, var(--aerie-theme-a, var(--aerie-accent)) 44%, #0b0a0f) 0%, color-mix(in srgb, var(--aerie-theme-b, var(--aerie-accent)) 36%, #0b0a0f) 100%)',
          borderColor: `${color}66`,
          boxShadow: `0 0 18px ${color}40, 0 4px 14px rgba(0,0,0,0.35)`,
        }}
        role="status"
        aria-label={said}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
          {playing && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: color }} />}
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
        </span>

        {playing ? (
          <>
            <span className="text-xs font-medium" style={{ color }}>{who?.name}</span>
            <span className="flex flex-col gap-[3px]" aria-hidden>
              {motors.map((m) => (
                <span key={`${m.toyId}:${m.command}`} className="block h-[4px] w-11 overflow-hidden rounded-full bg-white/15">
                  <span
                    className="block h-full rounded-full transition-[width] duration-200 ease-out"
                    style={{
                      width: m.command === 'PRESET' ? '100%' : `${Math.round((m.level / 20) * 100)}%`,
                      background: color,
                      boxShadow: `0 0 6px ${color}`,
                    }}
                  />
                </span>
              ))}
            </span>
            <button
              onClick={() => ownerStop('stop')}
              className="ml-0.5 flex items-center gap-1 rounded-[var(--shape-control)] px-3 py-1 text-xs font-bold tracking-wide transition-transform active:scale-95"
              style={{ background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)' }}
              aria-label="Stop every toy and take the remote back"
            >
              <Hand size={13} /> STOP
            </button>
          </>
        ) : (
          <>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-xs text-white/85">Your companions have the remote</span>
              {/* The owner asked, Oct 23 2026: say on the card that taking it back stops them. */}
              <span className="truncate text-[10px] text-white/55">Taking it back stops every toy</span>
            </span>
            <button
              onClick={takeBack}
              aria-label="Take the remote back and stop every toy"
              className="shrink-0 rounded-[var(--shape-control)] bg-white/10 px-3 py-1 text-xs text-white/85 transition-colors active:bg-white/20"
            >
              Take it back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
