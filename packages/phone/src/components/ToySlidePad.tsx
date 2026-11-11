// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The slide pad on the Remote tab, after Lovense's own remote (theirs, Nov 10
// 2026, from their screenshots): one bubble per motor, each with its name,
// sitting on the floor of the pad. Drag a bubble up and that motor rises
// with it; let go and it drops back to nothing. Two switches down the side
// change what letting go means: Float leaves the bubble where it was, so one
// motor can be parked while they slide the other, and Loop repeats what them
// finger did with that bubble until they touch it again.
//
// Their stop, from anywhere, drops every bubble; so does leaving the page.
// Every level goes the same road as a slider (the page's setLevel), so the
// pattern shelf hears it and each toy's strength setting holds it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { loopSample, type Sample } from '../lib/orb-loop';

export interface SlideMotor {
  key: string;
  toyId: string;
  command: string;
  label: string;
  max: number;
  color: string;
  level: number;
}

interface Held {
  pointerId: number;
  key: string;
  samples: Sample[];
}

interface Looping {
  samples: Sample[];
  start: number;
  length: number;
  last: number;
}

const LOOP_MIN_MS = 400;
const LOOP_MAX_MS = 60_000;
const BUBBLE = 64;

export function ToySlidePad({ motors, holding, onLevel, textMuted, panelClass, note }: {
  motors: SlideMotor[];
  holding: boolean;
  onLevel: (toyId: string, command: string, level: number) => void;
  textMuted: string;
  /** The page's own card paint, so the pad sits on a card like everything else. */
  panelClass: string;
  /** A line about the pad, shown inside its card (the practice pad says what it is). */
  note?: string;
}) {
  const padRef = useRef<HTMLDivElement>(null);
  // One finger per bubble, and as many bubbles at once as they have fingers.
  const held = useRef(new Map<number, Held>());
  const loops = useRef(new Map<string, Looping>());
  const floats = useRef(new Set<string>());
  const [float, setFloat] = useState(false);
  const [loop, setLoop] = useState(false);
  const [, setTick] = useState(0);
  const motorsRef = useRef(motors);
  motorsRef.current = motors;
  const onLevelRef = useRef(onLevel);
  onLevelRef.current = onLevel;

  const motorFor = (key: string) => motorsRef.current.find((m) => m.key === key);
  const send = (key: string, level: number) => {
    const m = motorFor(key);
    if (m) onLevelRef.current(m.toyId, m.command, level);
  };

  const levelAt = (clientY: number, max: number): number => {
    const pad = padRef.current;
    if (!pad) return 0;
    const rect = pad.getBoundingClientRect();
    const usable = rect.height - BUBBLE;
    const fromBottom = rect.bottom - BUBBLE / 2 - clientY;
    const share = Math.max(0, Math.min(1, fromBottom / Math.max(1, usable)));
    return Math.round(share * max);
  };

  const dropAll = useCallback(() => {
    for (const key of loops.current.keys()) send(key, 0);
    for (const key of floats.current) send(key, 0);
    loops.current.clear();
    floats.current.clear();
    setTick((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Loops play from here, a frame at a time, while any are going.
  useEffect(() => {
    let frame = 0;
    const run = (now: number) => {
      for (const [key, l] of loops.current) {
        const at = loopSample(l.samples, l.start, l.length, now);
        if (at.level !== l.last) {
          l.last = at.level;
          if (!holding) send(key, at.level);
        }
      }
      frame = requestAnimationFrame(run);
    };
    frame = requestAnimationFrame(run);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holding]);

  // Their stop lets go of everything parked or looping; the toys are already still.
  useEffect(() => {
    if (!holding) return;
    loops.current.clear();
    floats.current.clear();
    setTick((n) => n + 1);
  }, [holding]);

  // Leaving the page drops every bubble.
  useEffect(() => () => {
    for (const key of loops.current.keys()) send(key, 0);
    for (const key of floats.current) send(key, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const heldKey = (key: string) => [...held.current.values()].some((h) => h.key === key);

  const down = (e: React.PointerEvent<HTMLButtonElement>, m: SlideMotor) => {
    if (holding || heldKey(m.key)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    loops.current.delete(m.key);
    floats.current.delete(m.key);
    const level = levelAt(e.clientY, m.max);
    held.current.set(e.pointerId, { pointerId: e.pointerId, key: m.key, samples: [{ at: performance.now(), x: 0, y: 0, level }] });
    send(m.key, level);
    setTick((n) => n + 1);
  };

  const move = (e: React.PointerEvent<HTMLButtonElement>) => {
    const h = held.current.get(e.pointerId);
    if (!h) return;
    const m = motorFor(h.key);
    if (!m) return;
    const level = levelAt(e.clientY, m.max);
    const at = performance.now();
    h.samples.push({ at, x: 0, y: 0, level });
    while (h.samples.length > 2 && at - h.samples[0].at > LOOP_MAX_MS) h.samples.shift();
    if (level !== h.samples[h.samples.length - 2]?.level) send(h.key, level);
  };

  const up = (e: React.PointerEvent<HTMLButtonElement>) => {
    const h = held.current.get(e.pointerId);
    if (!h) return;
    held.current.delete(e.pointerId);
    const now = performance.now();
    const last = h.samples[h.samples.length - 1];
    h.samples.push({ at: now, x: 0, y: 0, level: last.level });
    const length = now - h.samples[0].at;
    if (!holding && loop && length >= LOOP_MIN_MS) {
      loops.current.set(h.key, { samples: h.samples, start: now, length, last: last.level });
    } else if (!holding && (float || loop) && last.level > 0) {
      floats.current.add(h.key);
    } else {
      send(h.key, 0);
    }
    setTick((n) => n + 1);
  };

  const toggleFloat = () => {
    const next = !float;
    setFloat(next);
    if (!next) {
      for (const key of floats.current) send(key, 0);
      floats.current.clear();
      setTick((n) => n + 1);
    }
  };

  const toggleLoop = () => {
    const next = !loop;
    setLoop(next);
    if (next) return;
    for (const [key, l] of loops.current) {
      if (float && l.last > 0) floats.current.add(key);
      else send(key, 0);
    }
    loops.current.clear();
    setTick((n) => n + 1);
  };

  const parked = loops.current.size + floats.current.size;

  // The switches ride inside the card along its top edge, small, and the
  // bubbles' floor and ceiling sit below them, so turning one on or the
  // let-go chip appearing never changes the pad's size (theirs, Nov 10 2026:
  // tapping Loop resized the pad, and the switches floated off to one side).
  return (
    <div className={`touch-none select-none overflow-hidden rounded-[var(--shape-surface)] border ${panelClass}`}>
      {note && <p className={`px-3 pt-2.5 text-[11px] leading-snug ${textMuted}`}>{note}</p>}
      <div className="flex h-9 items-center justify-end gap-1.5 px-2.5">
        <button
          onClick={dropAll}
          className="mr-auto rounded-[var(--shape-chip)] bg-white/10 px-2 py-0.5 text-[10px] text-white/85"
          style={{ visibility: parked > 0 ? 'visible' : 'hidden' }}
          tabIndex={parked > 0 ? 0 : -1}
        >
          Let go of all
        </button>
        {[
          { on: loop, label: 'Loop', toggle: toggleLoop },
          { on: float, label: 'Float', toggle: toggleFloat },
        ].map((b) => (
          <button
            key={b.label}
            onClick={b.toggle}
            aria-pressed={b.on}
            className="flex items-center gap-1.5 rounded-[var(--shape-chip)] border px-2 py-0.5 text-[11px]"
            style={b.on
              ? { background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)', borderColor: 'transparent' }
              : { color: 'rgba(255,255,255,0.65)', borderColor: 'rgba(255,255,255,0.18)' }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: b.on ? 'currentColor' : 'rgba(255,255,255,0.4)' }} />
            {b.label}
          </button>
        ))}
      </div>
      <div ref={padRef} className="relative h-72">
        {[0.25, 0.5, 0.75].map((f) => (
          <span key={f} className="pointer-events-none absolute inset-x-0 h-px bg-white/5" style={{ bottom: `calc(${BUBBLE / 2}px + (100% - ${BUBBLE}px) * ${f})` }} />
        ))}
        {motors.length === 0 && (
          <p className={`absolute inset-x-0 top-1/2 -translate-y-1/2 px-6 text-center text-xs ${textMuted}`}>Connect a toy and its motors sit here, ready to slide.</p>
        )}
        {motors.map((m, i) => {
          const share = m.max > 0 ? m.level / m.max : 0;
          const left = `${((i + 1) / (motors.length + 1)) * 100}%`;
          const state = loops.current.has(m.key) ? 'loop' : floats.current.has(m.key) ? 'float' : null;
          return (
            <button
              key={m.key}
              onPointerDown={(e) => down(e, m)}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              className="absolute flex flex-col items-center justify-center rounded-full text-[10px] font-medium text-white"
              style={{
                width: BUBBLE,
                height: BUBBLE,
                left,
                bottom: `calc((100% - ${BUBBLE}px) * ${share})`,
                transform: 'translateX(-50%)',
                background: m.color,
                boxShadow: `0 0 ${8 + share * 22}px ${m.color}`,
                outline: state ? `2px solid ${m.color}` : undefined,
                outlineOffset: 4,
                opacity: holding ? 0.4 : 1,
                transition: heldKey(m.key) ? 'none' : 'bottom 160ms ease-out',
                touchAction: 'none',
              }}
              aria-label={`${m.label}, ${m.level} of ${m.max}`}
            >
              <span className="max-w-[56px] truncate leading-tight">{m.label}</span>
              <span className="tabular-nums opacity-80">{m.level}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
