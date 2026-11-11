// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The slim bar for whatever the sound shelf is playing, anywhere in the app
// (theirs, Nov 10 2026: 'the audio player should pop out a slim bar over things
// so you can stop it or play from wherever'). One row: play or pause, the
// name, loop, and stop, with a thin line under it they can drag to move
// through the sound. It floats over every app except the Toys page, where it
// sits in the page instead (inline), and they can drag it to wherever it sits
// best, the way the toy pill moves, and it stays there.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Pause, Play, Repeat, SkipForward, Waves, X } from 'lucide-react';
import { setSoundDrive, useSoundDrive } from '../aerie/sound-drive';
import { hasToyBridge } from '../aerie/lovense-toys';
import { nextSound, pauseSound, resumeSound, seekSound, setSoundLoop, soundClock, stopSound, useSoundPlayer } from '../lib/sound-player';
import { clampPillPoint, parsePillPoint, samePillBox, type PillBox, type PillPoint } from '../lib/pill-position';

const BAR_POSITION_KEY = 'aerie.sound-bar-position';

function savedPoint(): PillPoint | null {
  try {
    return parsePillPoint(localStorage.getItem(BAR_POSITION_KEY));
  } catch {
    return null;
  }
}

function Row({ inline }: { inline: boolean }) {
  const player = useSoundPlayer();
  const drive = useSoundDrive();
  const canDrive = hasToyBridge();
  const max = Math.max(1, player.duration);
  const fraction = player.duration ? Math.min(1, player.position / player.duration) : 0;
  return (
    <div className={inline ? 'flex flex-col gap-1' : 'flex flex-col gap-1'}>
      <div className="flex items-center gap-2">
        <button
          onClick={() => (player.playing ? pauseSound() : resumeSound())}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{ background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)' }}
          aria-label={player.playing ? 'Pause' : 'Play'}
        >
          {player.playing ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
        </button>
        <span className="min-w-0 flex-1 truncate text-xs text-white/90">{player.name}</span>
        {player.queue && player.queue.length > 1 && (
          <button onClick={nextSound} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/70" aria-label="Next sound">
            <SkipForward size={13} />
          </button>
        )}
        <span className="shrink-0 text-[10px] tabular-nums text-white/55">{soundClock(player.position)}</span>
        {canDrive && (
          <button
            onClick={() => setSoundDrive(!drive.on)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
            style={{ color: drive.on ? 'var(--aerie-accent)' : 'rgba(255,255,255,0.6)' }}
            aria-pressed={drive.on}
            aria-label="Let the sound drive the toys"
            title="The toys follow the sound"
          >
            <Waves size={14} />
          </button>
        )}
        <button
          onClick={() => setSoundLoop(!player.loop)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{ color: player.loop ? 'var(--aerie-accent)' : 'rgba(255,255,255,0.6)' }}
          aria-pressed={player.loop}
          aria-label="Loop this sound"
        >
          <Repeat size={13} />
        </button>
        <button onClick={stopSound} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/70" aria-label="Stop the sound">
          <X size={14} />
        </button>
      </div>
      {drive.on && drive.problem && <span className="text-[10px] text-white/60">{drive.problem}</span>}
      {/* A thin line, with the real slider laid over it so a finger can drag it. */}
      <div className="relative h-3">
        <span className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/15" />
        <span className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full" style={{ width: `${fraction * 100}%`, background: 'var(--aerie-accent)' }} />
        <input
          type="range"
          min={0}
          max={Math.floor(max)}
          value={Math.min(Math.floor(player.position), Math.floor(max))}
          onChange={(e) => seekSound(Number(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label="Where in the sound"
        />
      </div>
    </div>
  );
}

const barFill = 'linear-gradient(120deg, color-mix(in srgb, var(--aerie-theme-a, var(--aerie-accent)) 44%, #0b0a0f) 0%, color-mix(in srgb, var(--aerie-theme-b, var(--aerie-accent)) 36%, #0b0a0f) 100%)';

/** In a page, where it sits in the flow rather than floating. */
export function SoundBarInline() {
  const player = useSoundPlayer();
  if (!player.id) return null;
  return (
    <div className="rounded-[var(--shape-control)] border border-white/10 px-2.5 py-1.5" style={{ background: barFill }}>
      <Row inline />
    </div>
  );
}

export function SoundBar({ hidden = false }: { hidden?: boolean }) {
  const player = useSoundPlayer();
  const [point, setPoint] = useState<PillPoint | null>(savedPoint);
  const [box, setBox] = useState<PillBox | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; origin: PillPoint; last: PillPoint; moved: boolean } | null>(null);
  const visible = !hidden && !!player.id;

  const measure = useCallback((): PillBox | null => {
    const frame = frameRef.current;
    const bar = barRef.current;
    if (!frame || !bar) return null;
    const rect = bar.getBoundingClientRect();
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

  // Only the bar's body drags: its buttons and its line never start one.
  const beginDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, input')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const origin = { x: rect.left + rect.width / 2, y: rect.top };
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin, last: origin, moved: false };
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

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    if (!drag.moved) return;
    const fitted = measure();
    const next = fitted ? clampPillPoint(drag.last, fitted) : drag.last;
    setPoint(next);
    try {
      localStorage.setItem(BAR_POSITION_KEY, JSON.stringify(next));
    } catch {
      // It stays where they put it for this session.
    }
  }, [measure]);

  if (!visible) return null;
  const shown = point && box ? clampPillPoint(point, box) : point;
  return (
    <div ref={frameRef} className="pointer-events-none fixed inset-0 z-[54]" style={{ paddingTop: 'var(--sat)', paddingBottom: 'var(--sab)' }}>
      <div
        ref={barRef}
        className="pointer-events-auto absolute touch-none select-none rounded-[var(--shape-control)] border px-2.5 py-1.5"
        style={{
          left: shown ? shown.x : '50%',
          top: shown ? shown.y : 'calc(var(--sat) + 7.5rem)',
          transform: 'translateX(-50%)',
          width: 'min(22rem, calc(100vw - 1.5rem))',
          background: barFill,
          borderColor: 'rgba(255,255,255,0.12)',
          boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
        }}
        role="region"
        aria-label={`Playing ${player.name ?? 'a sound'}`}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <Row inline={false} />
      </div>
    </div>
  );
}
