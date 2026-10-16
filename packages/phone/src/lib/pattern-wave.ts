// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The line a toy pattern draws while it plays: one glowing curve per motor,
// scrolling under a playhead, with what is still to come waiting ahead of it
// as a faint ghost. Two looks. Wave ('pure') is the line and its glow.
// Starlight ('starlit') sheds small stars off the playhead, more of them the
// harder a motor is working, and keeps a few slow ones twinkling behind the
// lines.
//
// The glow is layered strokes added together, not canvas shadowBlur, which
// is slow on a phone; the stars are a small fixed-cost particle list. Kept
// free of the app on purpose, a canvas and a clock, so the player, the
// recorder and anything else that wants to show a pattern draw it the same way.

// The keys are the old names on purpose: the owner's saved pick lives under them.
export type WaveLook = 'pure' | 'starlit';

export interface WaveTrack {
  /** Levels from 0 to max, one every stepMs. */
  levels: readonly number[];
  max: number;
  /** A #rrggbb color. */
  color: string;
}

export interface WaveOptions {
  tracks: readonly WaveTrack[];
  stepMs: number;
  look: WaveLook;
  /** Seconds of pattern shown behind the playhead. */
  windowSec?: number;
  /** Where the playhead sits across the width, from 0 to 1. */
  playheadAt?: number;
  /** The band a level is drawn in, as fractions of the height: a full
   *  level sits at `top`, zero at `bottom`. Room above is for a caption. */
  band?: { top: number; bottom: number };
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  phase: number;
  color: string;
}

interface BackStar {
  x: number;
  y: number;
  size: number;
  phase: number;
  speed: number;
}

const MAX_SPARKS = 260;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex: string, alpha: number, towardWhite = 0): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (c: number) => Math.round(c + (255 - c) * towardWhite);
  return `rgba(${mix(r)},${mix(g)},${mix(b)},${Math.max(0, Math.min(1, alpha))})`;
}

/** A track's level at a moment, eased between samples so the line curves. */
export function levelAt(track: WaveTrack, stepMs: number, tMs: number): number {
  const n = track.levels.length;
  if (n === 0) return 0;
  const i = tMs / stepMs;
  if (i <= 0) return track.levels[0];
  if (i >= n - 1) return track.levels[n - 1];
  const a = Math.floor(i);
  const f = i - a;
  const ease = f * f * (3 - 2 * f);
  return track.levels[a] + (track.levels[a + 1] - track.levels[a]) * ease;
}

export class PatternWave {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private sparks: Spark[] = [];
  private back: BackStar[] = [];
  private spawnDebt: number[] = [];
  private opts: Required<WaveOptions>;

  constructor(private canvas: HTMLCanvasElement, options: WaveOptions) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas');
    this.ctx = ctx;
    this.opts = { windowSec: 10, playheadAt: 0.82, band: { top: 0.14, bottom: 0.86 }, ...options };
    this.resize();
  }

  setOptions(options: Partial<WaveOptions>): void {
    this.opts = { ...this.opts, ...options };
    if (options.look === 'pure') this.sparks = [];
  }

  /** Match the canvas to its laid-out size at the screen's pixel density. */
  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 3);
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.back = Array.from({ length: Math.round((this.w * this.h) / 2600) }, () => ({
      x: Math.random() * this.w,
      y: Math.random() * this.h,
      size: 0.6 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2,
      speed: 0.6 + Math.random() * 1.6,
    }));
  }

  private y(level: number, max: number): number {
    const top = this.h * this.opts.band.top;
    const bottom = this.h * this.opts.band.bottom;
    return bottom - (Math.max(0, Math.min(max, level)) / max) * (bottom - top);
  }

  /** Draw the pattern as it stands at tMs; dtMs moves the stars. */
  draw(tMs: number, dtMs: number): void {
    const { ctx, w, h } = this;
    const { tracks, stepMs, look, windowSec, playheadAt } = this.opts;
    const px = w * playheadAt;
    const msPerPx = (windowSec * 1000) / px;
    const dt = Math.min(dtMs, 64) / 1000;

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    if (look === 'starlit') {
      const now = tMs / 1000;
      for (const s of this.back) {
        const a = 0.1 + 0.4 * (0.5 + 0.5 * Math.sin(s.phase + now * s.speed));
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.fillRect(s.x, s.y, s.size, s.size);
      }
    }

    tracks.forEach((track, ti) => {
      // Behind the playhead, the line that has played; ahead, its ghost.
      const past: [number, number][] = [];
      const ahead: [number, number][] = [];
      for (let x = 0; x <= w + 3; x += 3) {
        const t = tMs + (x - px) * msPerPx;
        if (t < 0) continue;
        const point: [number, number] = [x, this.y(levelAt(track, stepMs, t), track.max)];
        if (x <= px) past.push(point);
        if (x >= px - 3) ahead.push(point);
      }
      this.stroke(ahead, rgba(track.color, 0.16), 1.2);
      for (const [width, alpha] of [[11, 0.05], [7, 0.09], [3.6, 0.42]] as const) {
        this.stroke(past, rgba(track.color, alpha), width);
      }
      this.stroke(past, rgba(track.color, 0.95, 0.45), 1.3);

      const level = levelAt(track, stepMs, tMs);
      const hy = this.y(level, track.max);
      if (look === 'starlit') this.spawn(ti, track, px, hy, level / track.max, dt, msPerPx);
      this.playhead(px, hy, track.color, tMs);
    });

    if (look === 'starlit') this.moveSparks(dt);
    ctx.restore();
  }

  private stroke(points: [number, number][], style: string, width: number): void {
    if (points.length < 2) return;
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length - 1; i++) {
      const mx = (points[i][0] + points[i + 1][0]) / 2;
      const my = (points[i][1] + points[i + 1][1]) / 2;
      ctx.quadraticCurveTo(points[i][0], points[i][1], mx, my);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last[0], last[1]);
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  private playhead(x: number, y: number, color: string, tMs: number): void {
    const { ctx } = this;
    const halo = ctx.createRadialGradient(x, y, 0, x, y, 14);
    halo.addColorStop(0, rgba(color, 0.55, 0.3));
    halo.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.fill();
    this.star(x, y, 5.2, rgba(color, 1, 0.55), (tMs / 1000) * 0.9);
  }

  /** A four-pointed star, the sparkle shape. */
  private star(x: number, y: number, r: number, style: string, turn = 0): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(turn);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const rad = i % 2 === 0 ? r : r * 0.32;
      const a = (i * Math.PI) / 4;
      if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
      else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fillStyle = style;
    ctx.fill();
    ctx.restore();
  }

  private spawn(ti: number, track: WaveTrack, x: number, y: number, intensity: number, dt: number, msPerPx: number): void {
    // More stars the harder the motor is working; a trickle even when idle.
    this.spawnDebt[ti] = (this.spawnDebt[ti] ?? 0) + dt * (6 + 58 * intensity);
    const scroll = 1000 / msPerPx; // px per second the line moves left
    while (this.spawnDebt[ti] >= 1 && this.sparks.length < MAX_SPARKS) {
      this.spawnDebt[ti] -= 1;
      this.sparks.push({
        x: x + (Math.random() - 0.5) * 4,
        y: y + (Math.random() - 0.5) * 6,
        vx: -scroll * (0.55 + Math.random() * 0.5),
        vy: (Math.random() - 0.5) * 70,
        age: 0,
        life: 0.8 + Math.random() * 1.2,
        size: 1.8 + Math.random() * 2.8,
        phase: Math.random() * Math.PI * 2,
        color: track.color,
      });
    }
    if (this.spawnDebt[ti] > 1) this.spawnDebt[ti] = 1;
  }

  private moveSparks(dt: number): void {
    const next: Spark[] = [];
    for (const s of this.sparks) {
      s.age += dt;
      if (s.age >= s.life) continue;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy *= 0.97;
      const fade = 1 - s.age / s.life;
      const twinkle = 0.55 + 0.45 * Math.sin(s.phase + s.age * 18);
      this.star(s.x, s.y, s.size * (0.55 + 0.45 * fade), rgba(s.color, Math.min(1, 0.25 + fade) * twinkle, 0.55), s.phase + s.age * 2);
      next.push(s);
    }
    this.sparks = next;
  }
}
