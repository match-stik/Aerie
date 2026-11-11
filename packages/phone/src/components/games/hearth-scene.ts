// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The clearing Core Defense is played in: Birch's fire in a ring of stones,
// grass and pebbles out to the dark, and the things that come out of it.
// Everything is drawn from code and coloured from them palette.

import { type Paint, clearOf, mixHex } from './arcade-kit';
import { CX, CY, FIELD_H, FIELD_W, FIRE_R, type Kind } from './hearth-logic';

export interface Creature {
  kind: Kind;
  x: number;
  y: number;
  r: number;
  /** Heading, for wings and eyes. */
  heading: number;
  phase: number;
}

interface Firefly { x: number; y: number; vx: number; vy: number; phase: number }
interface Rising { x: number; y: number; vy: number; life: number; max: number }

export interface HearthScene {
  step(frames: number): void;
  drawGround(ctx: CanvasRenderingContext2D, p: Paint, light: number, frames: number): void;
  drawFire(ctx: CanvasRenderingContext2D, p: Paint, frames: number, out: boolean): void;
  drawCreature(ctx: CanvasRenderingContext2D, c: Creature, p: Paint, frames: number): void;
  drawDark(ctx: CanvasRenderingContext2D, p: Paint, light: number): void;
}

/**
 * Fire stays fire in every palette: their colours tint it, real flame colours
 * carry it, so a slate or blue palette still gets a campfire, not a gas ring.
 */
export function fireTones(p: Paint) {
  return {
    outer: mixHex(p.primary, '#ff6a2b', 0.62),
    mid: mixHex(p.spark, '#ffb347', 0.62),
    core: mixHex('#fff2cf', p.glow, 0.1),
    light: mixHex(p.primary, '#ff9a3c', 0.65),
    ember: mixHex(p.spark, '#ffc46b', 0.6),
  };
}

/** The ground's colours. Night is the palette's dark; day is dusk. */
function groundColours(p: Paint) {
  return p.light
    ? { base: mixHex(p.page, p.secondary, 0.35), blade: mixHex(p.page, p.text, 0.45), stone: mixHex(p.page, p.text, 0.3) }
    : { base: mixHex(p.surface, p.velvet, 0.35), blade: mixHex(p.surface, p.glow, 0.22), stone: mixHex(p.surface, p.text, 0.28) };
}

export function hearthScene(rand: () => number = Math.random): HearthScene {
  // The clearing's furniture is laid out once; only its colours change.
  const tufts = Array.from({ length: 90 }, () => ({
    x: rand() * FIELD_W,
    y: rand() * FIELD_H,
    blades: 3 + Math.floor(rand() * 3),
    h: 4 + rand() * 5,
    lean: (rand() - 0.5) * 0.6,
  })).filter((t) => Math.hypot(t.x - CX, t.y - CY) > 44);
  const pebbles = Array.from({ length: 30 }, () => ({
    x: rand() * FIELD_W,
    y: rand() * FIELD_H,
    r: 1 + rand() * 2.2,
  })).filter((p) => Math.hypot(p.x - CX, p.y - CY) > 40);
  const flowers = Array.from({ length: 14 }, () => ({ x: rand() * FIELD_W, y: rand() * FIELD_H, c: Math.floor(rand() * 2) }))
    .filter((f) => Math.hypot(f.x - CX, f.y - CY) > 60);
  const stones = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2 + rand() * 0.2;
    return { a, rx: 6 + rand() * 2.5, ry: 4.5 + rand() * 2, tilt: rand() * Math.PI };
  });
  // Fireflies keep to the far edges of the clearing; the wisps that copy
  // them are the ones that come closer.
  const fireflies: Firefly[] = Array.from({ length: 7 }, () => {
    const a = rand() * Math.PI * 2;
    return { x: CX + Math.cos(a) * 150, y: CY + Math.sin(a) * 190, vx: 0, vy: 0, phase: rand() * 6 };
  });
  let rising: Rising[] = [];

  let cache: { key: string; canvas: HTMLCanvasElement } | null = null;
  const groundCanvas = (p: Paint) => {
    const key = [p.page, p.surface, p.velvet, p.text, p.glow, p.secondary, p.spark, p.light].join('|');
    if (cache?.key === key) return cache.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(FIELD_W * dpr);
    canvas.height = Math.round(FIELD_H * dpr);
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const col = groundColours(p);
    g.fillStyle = col.base;
    g.fillRect(0, 0, FIELD_W, FIELD_H);
    // Worn earth around the fire.
    const worn = g.createRadialGradient(CX, CY, 20, CX, CY, 70);
    const earth = mixHex(col.base, p.light ? p.text : '#000000', 0.25);
    worn.addColorStop(0, earth);
    worn.addColorStop(1, clearOf(earth));
    g.fillStyle = worn;
    g.fillRect(0, 0, FIELD_W, FIELD_H);
    g.fillStyle = col.stone;
    for (const pb of pebbles) {
      g.globalAlpha = 0.7;
      g.beginPath();
      g.ellipse(pb.x, pb.y, pb.r, pb.r * 0.7, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    g.strokeStyle = col.blade;
    g.lineWidth = 1;
    g.lineCap = 'round';
    for (const t of tufts) {
      for (let i = 0; i < t.blades; i++) {
        const off = (i - (t.blades - 1) / 2) * 1.6;
        g.globalAlpha = 0.75;
        g.beginPath();
        g.moveTo(t.x + off, t.y);
        g.quadraticCurveTo(t.x + off + t.lean * 4, t.y - t.h * 0.6, t.x + off + t.lean * 6 + off * 0.6, t.y - t.h);
        g.stroke();
      }
    }
    for (const f of flowers) {
      g.globalAlpha = 0.85;
      g.fillStyle = f.c ? p.spark : p.glow;
      for (let k = 0; k < 4; k++) {
        g.beginPath();
        g.arc(f.x + Math.cos((k * Math.PI) / 2) * 1.4, f.y + Math.sin((k * Math.PI) / 2) * 1.4, 1, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;
    cache = { key, canvas };
    return canvas;
  };

  return {
    step(frames) {
      for (const f of fireflies) {
        f.vx = (f.vx + (rand() - 0.5) * 0.08) * 0.97;
        f.vy = (f.vy + (rand() - 0.5) * 0.08) * 0.97;
        f.x += f.vx;
        f.y += f.vy;
        // Stay out in the edges.
        const d = Math.hypot(f.x - CX, f.y - CY);
        if (d < 130) {
          f.x += ((f.x - CX) / d) * 0.6;
          f.y += ((f.y - CY) / d) * 0.6;
        }
        f.x = Math.min(FIELD_W - 6, Math.max(6, f.x));
        f.y = Math.min(FIELD_H - 6, Math.max(6, f.y));
      }
      if (frames % 4 === 0) {
        rising.push({ x: CX + (rand() - 0.5) * 10, y: CY - 6, vy: 0.5 + rand() * 0.6, life: 50, max: 50 });
      }
      for (const r of rising) {
        r.y -= r.vy;
        r.x += Math.sin((frames + r.max * 7) / 9) * 0.25;
        r.life--;
      }
      rising = rising.filter((r) => r.life > 0);
    },

    drawGround(ctx, p, light, frames) {
      ctx.drawImage(groundCanvas(p), 0, 0, FIELD_W, FIELD_H);
      // Firelight on the ground, breathing with the flames.
      const warm = fireTones(p).light;
      const r = light * (1 + Math.sin(frames / 7) * 0.03 + Math.sin(frames / 3.1) * 0.015);
      const pool = ctx.createRadialGradient(CX, CY, 8, CX, CY, r);
      pool.addColorStop(0, warm);
      pool.addColorStop(1, clearOf(warm));
      ctx.globalAlpha = p.light ? 0.28 : 0.42;
      ctx.fillStyle = pool;
      ctx.fillRect(0, 0, FIELD_W, FIELD_H);
      ctx.globalAlpha = 1;
      // Fireflies, far out.
      for (const f of fireflies) {
        const blink = 0.5 + 0.5 * Math.sin(frames / 18 + f.phase);
        ctx.globalAlpha = 0.25 + 0.6 * blink;
        ctx.fillStyle = p.glow;
        ctx.shadowColor = p.glow;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(f.x, f.y, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    },

    drawFire(ctx, p, frames, out) {
      const col = groundColours(p);
      // Stones, lit on the side that faces the fire and dark on the far side.
      const tones = fireTones(p);
      const stoneDark = mixHex(col.stone, p.light ? p.text : '#000000', p.light ? 0.35 : 0.45);
      for (const s of stones) {
        const x = CX + Math.cos(s.a) * (FIRE_R + 6);
        const y = CY + Math.sin(s.a) * (FIRE_R + 6) * 0.92;
        const lit = ctx.createLinearGradient(x - Math.cos(s.a) * s.rx, y - Math.sin(s.a) * s.ry, x + Math.cos(s.a) * s.rx, y + Math.sin(s.a) * s.ry);
        lit.addColorStop(0, out ? col.stone : mixHex(col.stone, tones.light, p.light ? 0.35 : 0.55));
        lit.addColorStop(1, stoneDark);
        ctx.fillStyle = lit;
        ctx.beginPath();
        ctx.ellipse(x, y, s.rx, s.ry, s.tilt, 0, Math.PI * 2);
        ctx.fill();
      }
      // Two logs, crossed.
      const wood = mixHex(mixHex(p.secondary, '#3a2416', 0.6), p.light ? p.text : '#000000', 0.15);
      for (const a of [0.5, -0.6]) {
        ctx.save();
        ctx.translate(CX, CY + 2);
        ctx.rotate(a);
        ctx.fillStyle = wood;
        ctx.beginPath();
        ctx.roundRect(-15, -3, 30, 6, 3);
        ctx.fill();
        ctx.fillStyle = out ? mixHex(wood, '#000000', 0.3) : tones.ember;
        ctx.globalAlpha = out ? 1 : 0.7;
        ctx.beginPath();
        ctx.arc(-14, 0, 2.2, 0, Math.PI * 2);
        ctx.arc(14, 0, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.restore();
      }
      if (out) return;
      // The flames: three tongues, outer to inner, each flickering on its own.
      const layers = [
        { c: tones.outer, w: 13, h: 30, a: 0.92 },
        { c: tones.mid, w: 9, h: 22, a: 0.95 },
        { c: tones.core, w: 5, h: 13, a: 1 },
      ];
      ctx.shadowColor = tones.outer;
      ctx.shadowBlur = 18;
      layers.forEach((l, i) => {
        const fl = 1 + Math.sin(frames / (4 + i) + i * 2) * 0.12 + Math.sin(frames / 2.3 + i) * 0.05;
        const sway = Math.sin(frames / (9 + i * 2) + i) * 2.2;
        const h = l.h * fl;
        ctx.globalAlpha = l.a;
        ctx.fillStyle = l.c;
        ctx.beginPath();
        ctx.moveTo(CX - l.w, CY + 4);
        ctx.quadraticCurveTo(CX - l.w * 1.05, CY - h * 0.45, CX + sway, CY - h);
        ctx.quadraticCurveTo(CX + l.w * 1.05, CY - h * 0.45, CX + l.w, CY + 4);
        ctx.quadraticCurveTo(CX, CY + 9, CX - l.w, CY + 4);
        ctx.fill();
        if (i === 0) ctx.shadowBlur = 0;
      });
      ctx.globalAlpha = 1;
      // Sparks lifting off it.
      ctx.fillStyle = tones.ember;
      for (const r of rising) {
        ctx.globalAlpha = (r.life / r.max) * 0.9;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },

    drawCreature(ctx, c, p, frames) {
      const night = !p.light;
      const shadow = night ? mixHex(p.page, '#000000', 0.5) : mixHex(p.text, '#000000', 0.2);
      const rim = mixHex(p.primary, p.spark, 0.3);
      const eyes = (ex: number, ey: number, spread: number, size: number) => {
        const fx = Math.cos(c.heading);
        const fy = Math.sin(c.heading);
        ctx.fillStyle = night ? p.glow : mixHex(p.spark, '#ffffff', 0.2);
        ctx.shadowColor = ctx.fillStyle as string;
        ctx.shadowBlur = 6;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(ex + fx * size * 1.2 - fy * spread * side, ey + fy * size * 1.2 + fx * spread * side, size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      };
      switch (c.kind) {
        case 'shade': {
          // A little dark shape with a ragged edge and two lit eyes.
          ctx.fillStyle = shadow;
          ctx.beginPath();
          for (let i = 0; i <= 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            const wob = c.r * (1 + Math.sin(frames / 6 + i * 2.1 + c.phase) * 0.12);
            const x = c.x + Math.cos(a) * wob;
            const y = c.y + Math.sin(a) * wob;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.fill();
          ctx.strokeStyle = rim;
          ctx.globalAlpha = 0.5;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.globalAlpha = 1;
          eyes(c.x, c.y, c.r * 0.35, Math.max(1.2, c.r * 0.16));
          break;
        }
        case 'moth': {
          const flap = 0.35 + Math.abs(Math.sin(frames / 3 + c.phase)) * 0.65;
          const wing = night ? mixHex(p.text, p.velvet, 0.35) : mixHex(p.page, p.text, 0.55);
          ctx.save();
          ctx.translate(c.x, c.y);
          ctx.rotate(c.heading + Math.PI / 2);
          ctx.fillStyle = wing;
          ctx.globalAlpha = 0.9;
          for (const side of [-1, 1]) {
            ctx.beginPath();
            ctx.ellipse(side * c.r * 0.6 * flap, -c.r * 0.15, c.r * 0.75 * flap, c.r * 0.55, side * 0.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(side * c.r * 0.45 * flap, c.r * 0.4, c.r * 0.45 * flap, c.r * 0.35, -side * 0.4, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
          ctx.fillStyle = shadow;
          ctx.beginPath();
          ctx.ellipse(0, 0, c.r * 0.22, c.r * 0.6, 0, 0, Math.PI * 2);
          ctx.fill();
          // Eye-spots on the wings, catching the firelight.
          ctx.fillStyle = rim;
          for (const side of [-1, 1]) {
            ctx.beginPath();
            ctx.arc(side * c.r * 0.7 * flap, -c.r * 0.15, c.r * 0.14, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
          break;
        }
        case 'creep': {
          // A shadow pool, spreading, darker at its heart.
          const pool = ctx.createRadialGradient(c.x, c.y, 1, c.x, c.y, c.r * 1.15);
          pool.addColorStop(0, shadow);
          pool.addColorStop(0.7, shadow);
          pool.addColorStop(1, clearOf(shadow));
          ctx.fillStyle = pool;
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          for (let i = 0; i <= 14; i++) {
            const a = (i / 14) * Math.PI * 2;
            const wob = c.r * 1.15 * (1 + Math.sin(frames / 10 + i * 1.7 + c.phase) * 0.1);
            const x = c.x + Math.cos(a) * wob;
            const y = c.y + Math.sin(a) * wob * 0.85;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.fill();
          ctx.globalAlpha = 1;
          eyes(c.x, c.y, c.r * 0.25, 1.1);
          break;
        }
        case 'wisp': {
          // Dressed as one of their own embers, a little too bright.
          const pulse = 1 + Math.sin(frames / 5 + c.phase) * 0.15;
          const halo = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r * 2 * pulse);
          const glow = mixHex(p.spark, '#ffd27a', 0.3);
          halo.addColorStop(0, glow);
          halo.addColorStop(1, clearOf(glow));
          ctx.fillStyle = halo;
          ctx.globalAlpha = 0.55;
          ctx.fillRect(c.x - c.r * 2.4, c.y - c.r * 2.4, c.r * 4.8, c.r * 4.8);
          ctx.globalAlpha = 1;
          ctx.fillStyle = mixHex(glow, '#ffffff', 0.4);
          ctx.beginPath();
          ctx.arc(c.x, c.y, c.r * 0.45 * pulse, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
      }
    },

    drawDark(ctx, p, light) {
      // The dark beyond the firelight, closing in with it.
      const dark = p.light ? mixHex(p.text, '#000000', 0.2) : mixHex(p.page, '#000000', 0.6);
      const v = ctx.createRadialGradient(CX, CY, light * 0.9, CX, CY, Math.max(light * 2.6, 260));
      v.addColorStop(0, clearOf(dark));
      v.addColorStop(1, dark);
      ctx.globalAlpha = p.light ? 0.45 : 0.82;
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, FIELD_W, FIELD_H);
      ctx.globalAlpha = 1;
    },
  };
}
