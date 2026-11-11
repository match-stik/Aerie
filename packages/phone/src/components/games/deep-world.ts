// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Deep Blue: the second world Signal Glide flies through, and theirs. A little
// jellyfish pulses up on a tap and sinks between, and the sea gets deeper as
// the levels climb: sunlit shallows, then twilight, then the midnight water
// where the only light is living light. Them babies follow them from the
// twilight down, and on a clean streak the house's companions come down as
// lights and swim beside them, each in his own color. In somebody else's house
// it is their people who come (theirs, Nov 2026, off the Deep Blue canvas: the
// depth zones, the babies and the boys in the deep).
//
// Like the rooftops, everything is drawn from code and coloured from them live
// palette; only their jelly keeps their own color whatever the theme.

import { FIELD_H, FIELD_W, GATE_W, GLIDER_X } from './pulse-glide-logic';
import { type Paint, clearOf, luminance, mixHex } from './arcade-kit';
import type { GateView, RunView, World } from './glide-worlds';

/** 0 the sunlit shallows, 1 twilight, 2 the midnight water. */
export type Zone = 0 | 1 | 2;

/** Levels 1–2 are the shallows, 3–5 twilight, 6 and on the midnight water. */
export function zoneFor(level: number): Zone {
  return level >= 6 ? 2 : level >= 3 ? 1 : 0;
}

/** Clean passes in a row that bring the lights down beside them. */
export const LIGHTS_AT_STREAK = 3;
/** How many companions come down at most. */
export const MAX_LIGHTS = 3;
/** Their jelly when the house has no color saved for them. */
export const DEFAULT_SELF = '#FFB46A';

/** A colour the canvas can mix, or null: #rrggbb as is, #rgb spelled out. */
export function normalHex(color: string | null | undefined): string | null {
  const c = (color ?? '').trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : null;
}

/** The companions' colours in house order, at most MAX_LIGHTS; null where one has none saved. */
export function castLights(colors: (string | null | undefined)[]): (string | null)[] {
  return colors.slice(0, MAX_LIGHTS).map(normalHex);
}

/** Who swims: their own colour and the companions' lights. Read on every frame, so a roster that loads late still arrives. */
export interface DeepCast {
  self: string | null;
  lights: (string | null)[];
}

/** a at n% over base, the way the canvas sketches were written. */
const pct = (a: string, n: number, base: string) => mixHex(base, a, n / 100);

interface Water { top: string; bottom: string }

/** The water's two ends at a depth between 0 (shallows) and 2 (midnight). */
export function waterAt(p: Paint, depth: number): Water {
  const zones: Water[] = p.light
    ? [
        { top: pct(p.secondary, 18, '#ffffff'), bottom: pct(p.secondary, 50, p.surface) },
        { top: pct(p.secondary, 45, p.surface), bottom: pct(p.secondary, 50, p.text) },
        { top: pct(p.secondary, 25, p.text), bottom: pct(p.text, 70, '#000000') },
      ]
    : [
        { top: pct(p.secondary, 62, '#ffffff'), bottom: pct(p.secondary, 48, p.page) },
        { top: pct(p.secondary, 30, p.page), bottom: p.page },
        { top: pct(p.secondary, 8, '#000000'), bottom: pct(p.page, 40, '#000000') },
      ];
  const d = Math.min(2, Math.max(0, depth));
  const a = zones[Math.floor(d)];
  const b = zones[Math.min(2, Math.floor(d) + 1)];
  const t = d - Math.floor(d);
  return { top: mixHex(a.top, b.top, t), bottom: mixHex(a.bottom, b.bottom, t) };
}

interface Mote { x: number; y: number; r: number; drift: number }
interface FarJelly { x: number; y: number; s: number; phase: number }
interface Light { x: number; y: number; wake: [number, number][] }

const ZONE_RATE = 0.012;

export function deepWorld(cast: () => DeepCast, rand: () => number = Math.random): World {
  let frames = 0;
  let depth = 0;
  let seabedOffset = 0;
  let babyAlpha = 0;
  let lightAlpha = 0;
  let manta = { x: -999, y: 120, alive: false };
  const motes: Mote[] = Array.from({ length: 46 }, () => ({
    x: rand() * FIELD_W,
    y: rand() * FIELD_H,
    r: 0.5 + rand() * 1.1,
    drift: 0.05 + rand() * 0.15,
  }));
  const far: FarJelly[] = Array.from({ length: 4 }, (_, i) => ({
    x: (i / 4) * FIELD_W + rand() * 60,
    y: 50 + rand() * (FIELD_H - 160),
    s: 0.5 + rand() * 0.5,
    phase: rand() * Math.PI * 2,
  }));
  const babies = [FIELD_H / 2, FIELD_H / 2, FIELD_H / 2];
  const lights: Light[] = Array.from({ length: MAX_LIGHTS }, () => ({ x: GLIDER_X + 40, y: FIELD_H / 2, wake: [] }));
  // Each gate keeps the zone it was born in, so nothing changes shape on screen as a level turns.
  const gateZone = new WeakMap<GateView, Zone>();
  let currentZone: Zone = 0;

  const water = (p: Paint) => waterAt(p, depth);
  /** Whether the middle of the water is pale enough to want dark ink. */
  const paleWater = (p: Paint) => {
    const w = water(p);
    return luminance(mixHex(w.top, w.bottom, 0.5)) > 0.55;
  };
  const selfColor = () => normalHex(cast().self) ?? DEFAULT_SELF;

  const drawJellyBell = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
    // A dome with a scalloped rim: the shape every jelly here is built on.
    ctx.beginPath();
    ctx.moveTo(x - w, y);
    ctx.bezierCurveTo(x - w, y - h * 1.35, x + w, y - h * 1.35, x + w, y);
    ctx.quadraticCurveTo(x + w / 2, y - h * 0.28, x, y);
    ctx.quadraticCurveTo(x - w / 2, y - h * 0.28, x - w, y);
    ctx.closePath();
  };

  const glowDot = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, blur: number) => {
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  };

  return {
    step(speed, gates, run?: RunView) {
      frames++;
      const target = zoneFor(run?.level ?? 1);
      currentZone = target;
      depth += Math.sign(target - depth) * Math.min(ZONE_RATE, Math.abs(target - depth));
      seabedOffset += speed * 0.42;
      for (const g of gates) if (!gateZone.has(g)) gateZone.set(g, target);

      for (const m of motes) {
        m.x -= speed * 0.25 + m.drift;
        m.y += Math.sin((frames + m.x) / 70) * 0.08 + 0.05;
        if (m.x < -4) { m.x = FIELD_W + 4; m.y = rand() * FIELD_H; }
        if (m.y > FIELD_H + 4) m.y = -4;
      }
      for (const j of far) {
        j.x -= speed * 0.08 + 0.04;
        j.y += Math.sin(frames / 60 + j.phase) * 0.12;
        if (j.x < -30) { j.x = FIELD_W + 30; j.y = 50 + rand() * (FIELD_H - 160); }
      }
      // Now and then a manta crosses far back, in the twilight water.
      if (!manta.alive && depth > 0.6 && depth < 1.7 && rand() < 0.002) manta = { x: FIELD_W + 60, y: 70 + rand() * 120, alive: true };
      if (manta.alive) {
        manta.x -= 0.55 + speed * 0.1;
        if (manta.x < -80) manta.alive = false;
      }

      const y = run?.gliderY ?? FIELD_H / 2;
      // The babies follow them down from the twilight, each a little behind the last.
      babyAlpha += ((depth >= 0.8 ? 1 : 0) - babyAlpha) * 0.03;
      [0.09, 0.065, 0.045].forEach((k, i) => { babies[i] += (y - babies[i]) * k; });

      // The lights come on a clean streak and drift away when it breaks.
      const want = run?.playing && (run?.streak ?? 0) >= LIGHTS_AT_STREAK ? 1 : 0;
      lightAlpha += want > lightAlpha ? Math.min(0.025, want - lightAlpha) : -Math.min(0.012, lightAlpha - want);
      const count = Math.max(1, cast().lights.length);
      lights.forEach((l, i) => {
        const spread = count === 1 ? 0 : (i / (count - 1) - 0.5) * 68;
        const tx = GLIDER_X + 38 + Math.sin(frames / 50 + i * 2.1) * 9;
        const ty = y + spread + Math.sin(frames / 38 + i * 1.7) * 6;
        l.x += (tx - l.x) * 0.06;
        l.y += (ty - l.y) * 0.05;
        if (frames % 3 === 0) {
          l.wake.unshift([l.x, l.y]);
          l.wake.length = Math.min(l.wake.length, 8);
        }
        for (const w of l.wake) w[0] -= speed * 0.6;
      });
    },

    drawBackdrop(ctx, p) {
      const w = water(p);
      const sea = ctx.createLinearGradient(0, 0, 0, FIELD_H);
      sea.addColorStop(0, w.top);
      sea.addColorStop(1, w.bottom);
      ctx.fillStyle = sea;
      ctx.fillRect(-20, -20, FIELD_W + 40, FIELD_H + 40);

      // Light from the surface, gone by the time the water is dark. Pale water
      // is already bright, so the rays thin out on it rather than washing the
      // shallows white (theirs, Nov 11 2026: 'a little too bright in the first
      // level').
      const paleness = Math.min(1, Math.max(0, (luminance(w.top) - 0.35) / 0.5));
      const rays = (p.light ? 0.22 : 0.16) * (1 - 0.7 * paleness) * Math.max(0, 1 - depth / 1.2);
      if (rays > 0.005) {
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = rays;
        const sway = Math.sin(frames / 120) * 8;
        for (const [a, b, c, d] of [[40, 78, 150, 92], [150, 170, 238, 206], [250, 296, 360, 312]] as const) {
          ctx.beginPath();
          ctx.moveTo(a + sway, 0);
          ctx.lineTo(b + sway, 0);
          ctx.lineTo(c, FIELD_H);
          ctx.lineTo(d, FIELD_H);
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      const pale = paleWater(p);
      // Far jellies: haze in the shallows, living light in the deep.
      const farColor = pale ? '#ffffff' : p.glow;
      ctx.globalAlpha = pale ? 0.3 : 0.14 + 0.16 * Math.min(1, depth / 2);
      for (const j of far) {
        ctx.fillStyle = farColor;
        drawJellyBell(ctx, j.x, j.y, 9 * j.s, 8 * j.s);
        ctx.fill();
        ctx.strokeStyle = farColor;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        for (let k = -1; k <= 1; k++) {
          ctx.moveTo(j.x + k * 4 * j.s, j.y + 1);
          ctx.quadraticCurveTo(j.x + k * 4 * j.s + Math.sin(frames / 30 + j.phase + k) * 3, j.y + 10 * j.s, j.x + k * 4 * j.s, j.y + 20 * j.s);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      if (manta.alive) {
        const flap = Math.sin(frames / 18) * 6;
        ctx.fillStyle = pale ? mixHex(w.bottom, p.text, 0.35) : mixHex(w.top, '#000000', 0.35);
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(manta.x - 26, manta.y);
        ctx.quadraticCurveTo(manta.x, manta.y - 22 - flap, manta.x + 30, manta.y + 2);
        ctx.quadraticCurveTo(manta.x, manta.y + 6, manta.x - 26, manta.y);
        ctx.fill();
        ctx.fillRect(manta.x + 26, manta.y, 22, 1.2);
        ctx.globalAlpha = 1;
      }

      // Marine snow, drifting down and back.
      ctx.fillStyle = pale ? '#ffffff' : mixHex(p.glow, p.text, 0.4);
      for (const m of motes) {
        ctx.globalAlpha = pale ? 0.55 : 0.35;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // The sea floor along the bottom.
      ctx.fillStyle = pale ? mixHex(p.primary, p.text, 0.55) : mixHex(w.bottom, '#000000', 0.55);
      ctx.beginPath();
      ctx.moveTo(0, FIELD_H + 4);
      for (let x = 0; x <= FIELD_W + 8; x += 8) {
        const o = x + seabedOffset;
        ctx.lineTo(x, FIELD_H - 22 + Math.sin(o / 37) * 6 + Math.sin(o / 17) * 3);
      }
      ctx.lineTo(FIELD_W + 8, FIELD_H + 4);
      ctx.closePath();
      ctx.fill();
    },

    drawGate(ctx, gate, p) {
      const zone = gateZone.get(gate) ?? currentZone;
      const pale = paleWater(p);
      const w = water(p);
      const cx = gate.x + GATE_W / 2;
      const lit = pale ? mixHex(p.primary, p.text, 0.25) : mixHex(p.glow, '#ffffff', 0.45);
      const growth = pale ? mixHex(p.primary, p.text, 0.45) : mixHex(p.primary, w.bottom, 0.4);
      const blur = gate.passed ? 2 : pale ? 4 : 10;

      if (zone === 0) {
        // Above: a jellyfish trailing its tentacles down to the gap.
        ctx.strokeStyle = lit;
        ctx.lineWidth = 1.3;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        for (const dx of [-4, 0, 4]) {
          ctx.moveTo(cx + dx, -4);
          for (let y = -4; y < gate.top - 14; y += 10) {
            ctx.quadraticCurveTo(cx + dx + Math.sin((y + frames) / 14 + dx) * 2.5, y + 5, cx + dx, y + 10);
          }
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = lit;
        ctx.shadowColor = lit;
        ctx.shadowBlur = blur;
        drawJellyBell(ctx, cx, gate.top - 4, GATE_W / 2 + 4, 9);
        ctx.fill();
        ctx.shadowBlur = 0;
        // Below: kelp, with a glowing bud at the tip.
        ctx.strokeStyle = growth;
        ctx.lineWidth = 3.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (const dx of [-3, 3]) {
          ctx.moveTo(cx + dx, FIELD_H + 4);
          for (let y = FIELD_H; y > gate.bottom + 10; y -= 16) {
            ctx.quadraticCurveTo(cx + dx + Math.sin((y + frames * 0.6) / 20 + dx) * 2.5, y - 8, cx + dx, Math.max(gate.bottom + 8, y - 16));
          }
        }
        ctx.stroke();
        ctx.fillStyle = growth;
        for (let y = FIELD_H - 30, i = 0; y > gate.bottom + 24; y -= 26, i++) {
          ctx.beginPath();
          ctx.ellipse(cx + (i % 2 ? 5 : -5), y, 5, 2.2, i % 2 ? 0.5 : -0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        glowDot(ctx, cx, gate.bottom + 5, 3.5, lit, blur);
      } else if (zone === 1) {
        // Above: an old anchor chain, the anchor's flukes at the gap.
        const chain = pale ? p.text : mixHex(p.text, w.bottom, 0.45);
        ctx.strokeStyle = chain;
        ctx.lineWidth = 1.8;
        for (let y = 2, i = 0; y < gate.top - 20; y += 9, i++) {
          ctx.beginPath();
          ctx.ellipse(cx, y, i % 2 ? 1.6 : 3.4, 5.5, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.lineWidth = 2.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx, gate.top - 20);
        ctx.lineTo(cx, gate.top - 2);
        ctx.moveTo(cx - GATE_W / 2 - 2, gate.top - 15);
        ctx.lineTo(cx + GATE_W / 2 + 2, gate.top - 15);
        ctx.moveTo(gate.x - 2, gate.top - 8);
        ctx.quadraticCurveTo(gate.x + 1, gate.top, cx, gate.top - 2);
        ctx.quadraticCurveTo(gate.x + GATE_W - 1, gate.top, gate.x + GATE_W + 2, gate.top - 8);
        ctx.stroke();
        glowDot(ctx, cx, gate.top - 1, 1.6, lit, blur);
        // Below: branching coral, glowing at the tips.
        ctx.strokeStyle = growth;
        ctx.lineWidth = 3;
        const base = gate.bottom + 14;
        ctx.beginPath();
        ctx.moveTo(cx, FIELD_H + 4);
        ctx.lineTo(cx, base);
        ctx.moveTo(cx, base + 30);
        ctx.lineTo(cx - 6, base + 10);
        ctx.lineTo(cx - 6, base - 4);
        ctx.moveTo(cx, base + 18);
        ctx.lineTo(cx + 6, base);
        ctx.lineTo(cx + 5, base - 8);
        ctx.stroke();
        for (const [x, y] of [[cx, base - 3], [cx - 6, base - 7], [cx + 5, base - 11]] as const) glowDot(ctx, x, y, 2.4, lit, blur);
      } else {
        // Above: a chain of glowing jellies, the last and brightest at the gap.
        ctx.strokeStyle = lit;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(cx, -4);
        for (let y = -4; y < gate.top - 6; y += 12) ctx.quadraticCurveTo(cx + Math.sin((y + frames) / 20) * 5, y + 6, cx, y + 12);
        ctx.stroke();
        ctx.globalAlpha = 1;
        for (let y = 6, i = 0; y < gate.top - 12; y += 14, i++) {
          ctx.globalAlpha = 0.65 + 0.35 * Math.sin(frames / 14 + i);
          glowDot(ctx, cx + (i % 2 ? 3 : -3) + Math.sin((y + frames) / 20) * 2, y, i % 2 ? 2.4 : 3, lit, blur);
        }
        ctx.globalAlpha = 1;
        glowDot(ctx, cx, gate.top - 4, 4.2, lit, blur + 4);
        // Below: a stalk rising from the floor, an angler's lure at its tip.
        // It is what you hit, so it carries some of the glow and a lit edge
        // even in water this dark.
        const stalk = pale ? mixHex(w.bottom, p.text, 0.5) : mixHex(w.top, p.glow, 0.28);
        ctx.fillStyle = stalk;
        ctx.beginPath();
        ctx.roundRect(gate.x + 1, gate.bottom + 12, GATE_W - 2, FIELD_H - gate.bottom, 6);
        ctx.fill();
        ctx.fillStyle = lit;
        ctx.globalAlpha = pale ? 0.35 : 0.6;
        ctx.fillRect(gate.x + 1, gate.bottom + 16, 1.2, FIELD_H - gate.bottom);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = stalk;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(cx - 2, gate.bottom + 13);
        ctx.quadraticCurveTo(cx - 6, gate.bottom + 4, cx + 1, gate.bottom + 4);
        ctx.stroke();
        glowDot(ctx, cx + 1, gate.bottom + 4, 3.6, lit, blur + 6);
      }
      ctx.lineCap = 'butt';
    },

    drawGlider(ctx, x, y, vy, p) {
      const self = selfColor();
      const pale = paleWater(p);

      // Them babies, from the twilight down.
      if (babyAlpha > 0.02) {
        const baby = mixHex(self, '#ffffff', 0.25);
        [[22, 0.55], [34, 0.45], [45, 0.38]].forEach(([dx, s], i) => {
          ctx.globalAlpha = babyAlpha * 0.9;
          ctx.fillStyle = baby;
          ctx.shadowColor = self;
          ctx.shadowBlur = pale ? 2 : 6;
          drawJellyBell(ctx, x - dx, babies[i] + 6, 8 * s, 8 * s);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = baby;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          for (const k of [-1, 0, 1]) {
            ctx.moveTo(x - dx + k * 3 * s, babies[i] + 6);
            ctx.quadraticCurveTo(x - dx + k * 3 * s + Math.sin(frames / 9 + i + k) * 1.5, babies[i] + 6 + 5 * s, x - dx + k * 3 * s, babies[i] + 6 + 10 * s);
          }
          ctx.stroke();
        });
        ctx.globalAlpha = 1;
      }

      // The lights in the deep, each with a faint wake.
      if (lightAlpha > 0.02) {
        const fallback = [p.glow, p.spark, p.secondary];
        const colors = cast().lights;
        colors.forEach((c, i) => {
          const color = c ?? fallback[i % fallback.length];
          const l = lights[i];
          ctx.globalAlpha = lightAlpha * 0.5;
          ctx.fillStyle = color;
          l.wake.forEach(([wx, wy], k) => {
            ctx.globalAlpha = lightAlpha * 0.35 * (1 - k / l.wake.length);
            ctx.beginPath();
            ctx.arc(wx, wy, 1.6 * (1 - k / 10), 0, Math.PI * 2);
            ctx.fill();
          });
          const halo = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, 20);
          halo.addColorStop(0, color);
          halo.addColorStop(1, clearOf(color));
          ctx.globalAlpha = lightAlpha * (pale ? 0.6 : 0.85);
          ctx.fillStyle = halo;
          ctx.fillRect(l.x - 20, l.y - 20, 40, 40);
          ctx.globalAlpha = lightAlpha;
          ctx.fillStyle = mixHex(color, '#ffffff', 0.7);
          ctx.beginPath();
          ctx.arc(l.x, l.y, 3.2, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
      }

      // Them: a jelly that squeezes as it pulses up and opens as it sinks.
      const squeeze = Math.min(1, Math.max(0, -vy / 4));
      const haloR = 22 + depth * 8;
      const halo = ctx.createRadialGradient(x, y, 0, x, y, haloR);
      halo.addColorStop(0, self);
      halo.addColorStop(1, clearOf(self));
      ctx.globalAlpha = pale ? 0.3 + depth * 0.1 : 0.4 + depth * 0.2;
      ctx.fillStyle = halo;
      ctx.fillRect(x - haloR, y - haloR, haloR * 2, haloR * 2);
      ctx.globalAlpha = 1;

      const bw = 12 * (1 - squeeze * 0.2);
      const bh = 10 * (1 + squeeze * 0.3);
      const rim = y + 3;
      const trailing = vy > 0 ? Math.min(6, vy * 1.5) : 0;
      ctx.strokeStyle = mixHex(self, '#ffffff', 0.3);
      ctx.lineWidth = 1.1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const k of [-0.8, -0.4, 0, 0.4, 0.8]) {
        const tx = x + k * bw;
        const len = 12 + trailing + (squeeze > 0.4 ? 4 : 0);
        ctx.moveTo(tx, rim);
        ctx.quadraticCurveTo(tx + Math.sin(frames / 8 + k * 4) * 3, rim + len / 2, tx - 1 + Math.sin(frames / 11 + k * 3) * 2, rim + len);
      }
      ctx.stroke();
      ctx.lineCap = 'butt';

      ctx.fillStyle = self;
      ctx.shadowColor = self;
      ctx.shadowBlur = pale ? 4 : 10;
      drawJellyBell(ctx, x, rim, bw, bh);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = mixHex(self, '#ffffff', 0.7);
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - bw * 0.55, rim - bh * 0.7);
      ctx.quadraticCurveTo(x - bw * 0.2, rim - bh * 1.05, x + bw * 0.15, rim - bh * 1.02);
      ctx.stroke();
      ctx.lineCap = 'butt';
    },

    crashColors(p) {
      // They curls up in a soft cloud of their own light.
      const self = selfColor();
      return [self, mixHex(self, '#ffffff', 0.5), p.glow, '#ffffff'];
    },

    ink(p) {
      return paleWater(p) ? (p.light ? p.text : mixHex(p.page, '#000000', 0.3)) : '#EEF6FF';
    },
  };
}
