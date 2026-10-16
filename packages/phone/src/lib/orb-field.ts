// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The orbs screen's drawing, after the gradient screen in Lovense's own app:
// every finger on the glass is an orb, its height sets its motor's level, and
// it sheds stars the harder it works. Each finger wears a color of its own,
// the first three for the companions and a fourth if a fourth motor is ever on.
//
// Kept free of the app like pattern-wave.ts: a canvas, a clock and a list of
// orbs. The page owns the fingers and the toys.

export interface OrbOwner {
  name: string;
  /** #rrggbb */
  color: string;
}

const SLOT_COLORS = ['#ff6a1a', '#6aa8ff', '#b388ff', '#ffa62b'];

/** Who the nth finger down is: a color, and no name under the orb. */
export function ownerForSlot(slot: number): OrbOwner {
  return { name: '', color: SLOT_COLORS[Math.max(0, slot) % SLOT_COLORS.length] };
}

/** A companion on the glass, by slug: their name, and one of the first three
 *  slot colors chosen by the slug, so a line or a pill they are driving keeps
 *  the same glow every time. */
export function ownerForCompanion(slug: string): OrbOwner {
  const key = slug.trim().toLowerCase();
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return {
    name: key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Someone',
    color: key ? SLOT_COLORS[h % 3] : SLOT_COLORS[3],
  };
}

/** A finger's level from how high it is on the glass: the top strip is
 *  full, the bottom strip is off, and the level climbs evenly between. */
export function levelForHeight(y: number, height: number, max: number): number {
  const top = height * 0.08;
  const bottom = height * 0.9;
  if (y >= bottom) return 0;
  if (y <= top) return max;
  return Math.round(((bottom - y) / (bottom - top)) * max);
}

export interface Orb {
  x: number;
  y: number;
  level: number;
  max: number;
  owner: OrbOwner;
  /** What it drives, shown under it ('vibration'); empty with no toy. */
  caption: string;
  /** Drawn faded and silent while the owner's stop holds. */
  muted: boolean;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  spin: number;
  color: string;
}

const MAX_SPARKS = 220;

/** The screen behind the orbs: three stops top to foot and a soft bloom. */
export interface OrbBackdrop {
  top: string;
  mid: string;
  foot: string;
  bloom: string;
}

/** The night violet warming to ember it was drawn in before it followed the theme. */
export const DEFAULT_BACKDROP: OrbBackdrop = { top: '#120b24', mid: '#1d0f2e', foot: '#2c0f1c', bloom: '#a06eff' };

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A computed CSS color as hex: '#rrggbb', 'rgb(r, g, b)', 'rgba(...)', or
 *  'color(srgb r g b)', which is what a browser hands back for color-mix(). */
export function cssColorToHex(value: string): string | null {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (short) return ('#' + short[1] + short[1] + short[2] + short[2] + short[3] + short[3]).toLowerCase();
  const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(v);
  if (rgb) return '#' + hex(+rgb[1]) + hex(+rgb[2]) + hex(+rgb[3]);
  const srgb = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(v);
  if (srgb) return '#' + hex(+srgb[1] * 255) + hex(+srgb[2] * 255) + hex(+srgb[3] * 255);
  return null;
}

/** pct of `color` mixed into `base`, the way CSS color-mix(in srgb) does it. */
export function mixHex(color: string, pct: number, base: string): string {
  const a = hexToRgb(color);
  const b = hexToRgb(base);
  if (!a || !b) return base;
  const t = Math.max(0, Math.min(100, pct)) / 100;
  return '#' + a.map((c, i) => Math.round(c * t + b[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
}

/**
 * The orbs' screen built from the theme's two colors, deepened toward the
 * night sky so the orbs and their glow still read on it, Daylight included:
 * the first color at the top, the second through the middle and warming the
 * foot (the same recipe the Toys page's cards use). The orbs themselves keep
 * the colors of whoever they are.
 */
export function backdropFor(themeA: string | null, themeB: string | null): OrbBackdrop {
  const a = themeA && hexToRgb(themeA) ? themeA : null;
  const b = themeB && hexToRgb(themeB) ? themeB : a;
  if (!a || !b) return DEFAULT_BACKDROP;
  return {
    top: mixHex(a, 20, '#0d0b14'),
    mid: mixHex(b, 16, '#0b0910'),
    foot: mixHex(b, 30, '#120a10'),
    bloom: a,
  };
}

function rgba(hex: string, alpha: number, towardWhite = 0): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * towardWhite);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)},${a})`;
}

export class OrbField {
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private orbs: Orb[] = [];
  private sparks: Spark[] = [];
  private debt: number[] = [];
  private stars: { x: number; y: number; size: number; phase: number; speed: number }[] = [];
  private backdrop: OrbBackdrop = DEFAULT_BACKDROP;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas');
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.stars = Array.from({ length: Math.round((this.w * this.h) / 2400) }, () => ({
      x: Math.random() * this.w,
      y: Math.random() * this.h,
      size: 0.6 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 1.5,
    }));
  }

  setBackdrop(backdrop: OrbBackdrop): void {
    this.backdrop = backdrop;
  }

  get height(): number {
    return this.h;
  }

  setOrbs(orbs: Orb[]): void {
    this.orbs = orbs;
  }

  draw(nowMs: number, dtMs: number): void {
    const { ctx, w, h } = this;
    const dt = Math.min(dtMs, 64) / 1000;
    const now = nowMs / 1000;

    // The theme's first color at the top, its second warming the foot.
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, this.backdrop.top);
    sky.addColorStop(0.55, this.backdrop.mid);
    sky.addColorStop(1, this.backdrop.foot);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    const bloom = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, Math.max(w, h) * 0.6);
    bloom.addColorStop(0, rgba(this.backdrop.bloom, 0.12));
    bloom.addColorStop(1, rgba(this.backdrop.bloom, 0));
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.stars) {
      const a = 0.08 + 0.32 * (0.5 + 0.5 * Math.sin(s.phase + now * s.speed));
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.fillRect(s.x, s.y, s.size, s.size);
    }

    // The off strip at the foot, so a finger knows where silence lives.
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    ctx.fillRect(0, h * 0.9, w, h * 0.1);

    this.orbs.forEach((orb, i) => {
      if (!orb.muted) this.spawn(i, orb, dt);
      this.drawOrb(orb, now);
    });
    this.moveSparks(dt);
    ctx.restore();

    // Captions sit on top, drawn plainly so they stay readable.
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.textAlign = 'center';
    for (const orb of this.orbs) {
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillStyle = rgba(orb.owner.color, orb.muted ? 0.45 : 0.95, 0.35);
      ctx.fillText(orb.owner.name, orb.x, orb.y + this.radius(orb) + 22);
      if (orb.caption) {
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillStyle = `rgba(255,255,255,${orb.muted ? 0.35 : 0.6})`;
        ctx.fillText(`${orb.caption} · ${orb.level}`, orb.x, orb.y + this.radius(orb) + 37);
      }
    }
    ctx.restore();
  }

  private radius(orb: Orb): number {
    return 30 + (orb.level / Math.max(1, orb.max)) * 16;
  }

  private drawOrb(orb: Orb, now: number): void {
    const { ctx } = this;
    const r = this.radius(orb);
    const strength = orb.muted ? 0.35 : 0.45 + 0.55 * (orb.level / Math.max(1, orb.max));
    const color = orb.owner.color;

    const aura = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, r * 2.6);
    aura.addColorStop(0, rgba(color, 0.42 * strength, 0.2));
    aura.addColorStop(0.45, rgba(color, 0.16 * strength));
    aura.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(orb.x, orb.y, r * 2.6, 0, Math.PI * 2);
    ctx.fill();

    // The swirl: two arcs turning against each other, faster as it works.
    const turn = now * (0.8 + 2.2 * (orb.level / Math.max(1, orb.max)));
    ctx.lineCap = 'round';
    for (const [radius, sweep, dir, width] of [[r * 1.18, 1.9, 1, 3], [r * 1.36, 1.2, -1, 2]] as const) {
      ctx.strokeStyle = rgba(color, 0.55 * strength, 0.3);
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(orb.x, orb.y, radius, turn * dir, turn * dir + sweep);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(orb.x, orb.y, radius, turn * dir + Math.PI, turn * dir + Math.PI + sweep * 0.7);
      ctx.stroke();
    }

    ctx.strokeStyle = rgba(color, 0.85 * strength, 0.4);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(orb.x, orb.y, r, 0, Math.PI * 2);
    ctx.stroke();

    const core = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, r);
    core.addColorStop(0, rgba(color, 0.95 * strength, 0.7));
    core.addColorStop(0.5, rgba(color, 0.5 * strength, 0.25));
    core.addColorStop(1, rgba(color, 0.08 * strength));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(orb.x, orb.y, r * 0.96, 0, Math.PI * 2);
    ctx.fill();
  }

  private spawn(i: number, orb: Orb, dt: number): void {
    const intensity = orb.level / Math.max(1, orb.max);
    this.debt[i] = (this.debt[i] ?? 0) + dt * (2 + 30 * intensity);
    const r = this.radius(orb);
    while (this.debt[i] >= 1 && this.sparks.length < MAX_SPARKS) {
      this.debt[i] -= 1;
      const angle = Math.random() * Math.PI * 2;
      this.sparks.push({
        x: orb.x + Math.cos(angle) * r * 0.9,
        y: orb.y + Math.sin(angle) * r * 0.9,
        vx: Math.cos(angle) * (18 + 40 * Math.random()),
        vy: Math.sin(angle) * (18 + 40 * Math.random()) - 30,
        age: 0,
        life: 0.9 + Math.random() * 1.1,
        size: 2 + Math.random() * 3,
        spin: Math.random() * Math.PI * 2,
        color: orb.owner.color,
      });
    }
    if (this.debt[i] > 1) this.debt[i] = 1;
  }

  private moveSparks(dt: number): void {
    const { ctx } = this;
    const next: Spark[] = [];
    for (const s of this.sparks) {
      s.age += dt;
      if (s.age >= s.life) continue;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.98;
      s.vy = s.vy * 0.98 - 6 * dt;
      const fade = 1 - s.age / s.life;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.spin + s.age * 2);
      ctx.beginPath();
      const r = s.size * (0.6 + 0.4 * fade);
      for (let k = 0; k < 8; k++) {
        const rad = k % 2 === 0 ? r : r * 0.32;
        const a = (k * Math.PI) / 4;
        if (k === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
        else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      ctx.closePath();
      ctx.fillStyle = rgba(s.color, Math.min(1, 0.2 + fade), 0.55);
      ctx.fill();
      ctx.restore();
      next.push(s);
    }
    this.sparks = next;
  }
}
