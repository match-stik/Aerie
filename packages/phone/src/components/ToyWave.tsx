// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The live line at the top of the Toys page: every connected motor drawn as
// it moves, the way Lovense's own remote app draws its line, in the
// pattern-wave looks (Starlight first, Wave a tap away; renamed off Lovense's
// own names on Oct 21 2026, and the saved keys stayed). It draws only
// what this page sends; a toy's own built-in pattern plays inside the toy and
// has no line to draw, so the page names it with a chip instead.
//
// The panel keeps its own night sky in daylight too. The glow is drawn
// additively, and additive light on a white page would vanish into it.

import { useEffect, useRef } from 'react';
import { PatternWave, type WaveLook } from '../lib/pattern-wave';

export interface LiveTrack {
  /** `${toyId}:${command}` — stable while the motor exists. */
  key: string;
  label: string;
  /** #rrggbb */
  color: string;
  level: number;
  max: number;
}

/** One sample of every motor this often. */
const STEP_MS = 100;
/** Ten seconds of zeros so the line spans the panel from the first frame. */
const PREFILL = 100;
/** How far the drawn line moves toward a new level each sample. A slider
 *  jumps in whole steps; the line glides between them, the way a hand moves. */
const GLIDE = 0.35;
/** Five minutes kept, trimmed in halves so the front never grows without end. */
const KEEP = 3000;
const TRIM = 1500;

interface ToyWaveProps {
  tracks: LiveTrack[];
  look: WaveLook;
  height?: number;
}

export function ToyWave({ tracks, look, height = 170 }: ToyWaveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const lookRef = useRef(look);
  lookRef.current = look;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let wave: PatternWave;
    try {
      // The band starts below the caption row, so a full level never runs
      // under the legend or the look switch.
      wave = new PatternWave(canvas, {
        tracks: [],
        stepMs: STEP_MS,
        look: lookRef.current,
        windowSec: 10,
        playheadAt: 0.9,
        band: { top: 0.27, bottom: 0.88 },
      });
    } catch {
      return; // no 2D canvas; the page works without its line
    }

    // Every history array is the same length as `count`, so one clock reads
    // them all; a motor that appears late starts with zeros up to now.
    const history = new Map<string, number[]>();
    const shown = new Map<string, number>();
    let count = PREFILL;
    let lastSampleAt = performance.now();

    const historyFor = (key: string): number[] => {
      let row = history.get(key);
      if (!row) {
        row = new Array(count).fill(0);
        history.set(key, row);
      }
      return row;
    };

    const sample = () => {
      const live = tracksRef.current;
      const liveKeys = new Set(live.map((t) => t.key));
      for (const key of [...history.keys()]) {
        if (!liveKeys.has(key)) {
          history.delete(key);
          shown.delete(key);
        }
      }
      for (const t of live) {
        const target = Math.max(0, Math.min(t.max, t.level));
        const before = shown.get(t.key) ?? 0;
        // A stop drops the line at once rather than gliding, so the picture
        // never shows a toy still slowing down that has already stopped.
        const next = target === 0 || Math.abs(target - before) < 0.05 ? target : before + (target - before) * GLIDE;
        shown.set(t.key, next);
        historyFor(t.key).push(next);
      }
      count += 1;
      if (count > KEEP) {
        for (const row of history.values()) row.splice(0, TRIM);
        count -= TRIM;
      }
      lastSampleAt = performance.now();
    };
    const timer = window.setInterval(sample, STEP_MS);

    let frame = 0;
    let lastFrameAt = performance.now();
    const draw = (now: number) => {
      const live = tracksRef.current;
      wave.setOptions({
        look: lookRef.current,
        tracks: live.map((t) => ({ levels: historyFor(t.key), max: t.max, color: t.color })),
      });
      const tMs = (count - 1) * STEP_MS + Math.min(STEP_MS, now - lastSampleAt);
      wave.draw(tMs, now - lastFrameAt);
      lastFrameAt = now;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => wave.resize());
    observer?.observe(canvas);

    return () => {
      window.clearInterval(timer);
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="block w-full" style={{ height }} aria-hidden />;
}

/** A theme color read off the page as #rrggbb, for drawing on a canvas. */
export function cssColorHex(value: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) return fallback;
  probe.fillStyle = fallback;
  probe.fillStyle = value.trim() || fallback;
  const out = String(probe.fillStyle);
  if (out.startsWith('#') && out.length === 7) return out;
  const m = out.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return fallback;
  return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
}

/** `color` moved toward `toward` by `amount` (0 to 1), both #rrggbb. */
export function mixHex(color: string, toward: string, amount: number): string {
  const parse = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const a = parse(color);
  const b = parse(toward);
  return '#' + a.map((c, i) => Math.round(c + (b[i] - c) * amount).toString(16).padStart(2, '0')).join('');
}
