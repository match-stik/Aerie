// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The worlds Signal Glide flies through. Each one draws the backdrop, the
// gates and the glider; the game itself only knows where things are.
//
// Everything is built from code and coloured from them live palette, so a
// world changes when the house does. The first one is Birch's: a paper plane
// over the rooftops at night, the same kind he folded out of grocery lists.

import { FIELD_H, FIELD_W, GATE_W } from './pulse-glide-logic';
import { type Paint, clearOf, mixHex } from './arcade-kit';

export { type Paint, clearOf, mixHex };

export interface GateView { x: number; top: number; bottom: number; passed: boolean }

/** How the run is going, for a world that answers to it (Deep Blue sinks as the levels climb). */
export interface RunView { level: number; streak: number; gliderY: number; playing: boolean }

export interface World {
  /** Advance the scenery by one physics step at the given scroll speed. */
  step(speed: number, gates: GateView[], run?: RunView): void;
  drawBackdrop(ctx: CanvasRenderingContext2D, p: Paint): void;
  drawGate(ctx: CanvasRenderingContext2D, gate: GateView, p: Paint): void;
  drawGlider(ctx: CanvasRenderingContext2D, x: number, y: number, vy: number, p: Paint): void;
  /** Colours for the burst a crash throws. */
  crashColors(p: Paint): string[];
  /** Ink for the small score text drawn over this world, where the palette's own text would not read. */
  ink?(p: Paint): string;
}

export type WorldId = 'rooftops' | 'deep';

export const WORLDS: { id: WorldId; name: string; blurb: string }[] = [
  { id: 'rooftops', name: 'Rooftops', blurb: 'A paper plane over the rooftops.' },
  { id: 'deep', name: 'Deep Blue', blurb: 'A little jelly, down through the sea.' },
];

// --- The skyline ------------------------------------------------------------

export type Roof = 'flat' | 'peak' | 'antenna' | 'tank' | 'step';

export interface Building {
  x: number;
  w: number;
  h: number;
  roof: Roof;
  /** Lit windows, row by row; null where the window is dark. Values index the light colours. */
  windows: (number | null)[][];
  /** Whether a wire runs from this roof to the next. */
  wire: boolean;
}

export interface SkylineLayer {
  depth: number;
  minH: number;
  maxH: number;
  litChance: number;
  buildings: Building[];
}

const ROOFS: Roof[] = ['flat', 'flat', 'peak', 'antenna', 'tank', 'step'];

export function makeBuilding(x: number, layer: Pick<SkylineLayer, 'minH' | 'maxH' | 'litChance'>, rand: () => number): Building {
  const w = 26 + Math.floor(rand() * 34);
  const h = layer.minH + Math.floor(rand() * (layer.maxH - layer.minH));
  const cols = Math.max(1, Math.floor((w - 6) / 8));
  const rows = Math.max(1, Math.floor((h - 14) / 11));
  const windows = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => (rand() < layer.litChance ? Math.floor(rand() * 3) : null)),
  );
  return { x, w, h, roof: ROOFS[Math.floor(rand() * ROOFS.length)], windows, wire: rand() < 0.35 };
}

/** Keep a layer covered from the left edge to a little past the right. */
export function extendSkyline(layer: SkylineLayer, rand: () => number, reach = FIELD_W + 80) {
  let right = layer.buildings.length ? Math.max(...layer.buildings.map((b) => b.x + b.w)) : -10;
  while (right < reach) {
    const b = makeBuilding(right + Math.floor(rand() * 7), layer, rand);
    layer.buildings.push(b);
    right = b.x + b.w;
  }
}

export function scrollSkyline(layer: SkylineLayer, speed: number, rand: () => number) {
  for (const b of layer.buildings) b.x -= speed * layer.depth;
  layer.buildings = layer.buildings.filter((b) => b.x + b.w > -12);
  extendSkyline(layer, rand);
}

// --- Rooftops at night -------------------------------------------------------

interface Star { x: number; y: number; r: number; phase: number }
interface Cloud { x: number; y: number; s: number; w: number; bumps: [number, number, number][] }

/**
 * One cloud: a run of round bumps along the top of a flat-ish base, each
 * cloud its own shape. dx and dy are offsets from the base's centre line.
 */
export function makeCloud(x: number, rand: () => number): Cloud {
  const s = 0.7 + rand() * 0.7;
  const w = 70 + rand() * 60;
  const n = 6 + Math.floor(rand() * 4);
  const bumps: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    // Taller in the middle, smaller toward the ends, never quite even.
    const lift = Math.sin(t * Math.PI);
    const r = 7 + lift * 9 + rand() * 4;
    bumps.push([(t - 0.5) * w, -r * 0.55 - lift * 4 + rand() * 2, r]);
  }
  return { x, y: 40 + rand() * 120, s, w, bumps };
}
interface Puff { x: number; y: number; r: number; life: number; max: number; drift: number }

export function rooftopsWorld(rand: () => number = Math.random): World {
  const far: SkylineLayer = { depth: 0.16, minH: 120, maxH: 210, litChance: 0.18, buildings: [] };
  const near: SkylineLayer = { depth: 0.42, minH: 55, maxH: 150, litChance: 0.3, buildings: [] };
  extendSkyline(far, rand);
  extendSkyline(near, rand);

  const stars: Star[] = Array.from({ length: 55 }, () => ({
    x: rand() * FIELD_W,
    y: rand() * FIELD_H * 0.55,
    r: 0.4 + rand() * 1.1,
    phase: rand() * Math.PI * 2,
  }));
  const clouds: Cloud[] = Array.from({ length: 4 }, (_, i) =>
    makeCloud((i / 4) * (FIELD_W + 160) - 40 + rand() * 40, rand),
  );
  let puffs: Puff[] = [];
  let frames = 0;

  const lights = (p: Paint) => [p.spark, p.glow, p.primary];

  const drawLayer = (ctx: CanvasRenderingContext2D, layer: SkylineLayer, body: string, edge: string, p: Paint, windowAlpha: number) => {
    const ground = FIELD_H + 2;
    const colours = lights(p);
    for (const b of layer.buildings) {
      const top = ground - b.h;
      ctx.fillStyle = body;
      ctx.fillRect(b.x, top, b.w, b.h);
      switch (b.roof) {
        case 'peak':
          ctx.beginPath();
          ctx.moveTo(b.x - 2, top);
          ctx.lineTo(b.x + b.w / 2, top - Math.min(18, b.w * 0.45));
          ctx.lineTo(b.x + b.w + 2, top);
          ctx.closePath();
          ctx.fill();
          break;
        case 'antenna':
          ctx.fillRect(b.x + b.w * 0.6, top - 16, 1.5, 16);
          ctx.fillRect(b.x + b.w * 0.6 - 3, top - 11, 7, 1.2);
          // A red warning blink at the top of the mast.
          if (Math.floor((frames + b.w * 7) / 50) % 2 === 0) {
            ctx.globalAlpha = windowAlpha;
            ctx.fillStyle = p.spark;
            ctx.beginPath();
            ctx.arc(b.x + b.w * 0.6 + 0.75, top - 17, 1.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
          }
          break;
        case 'tank':
          ctx.fillRect(b.x + b.w * 0.25, top - 12, 11, 9);
          ctx.fillRect(b.x + b.w * 0.25 + 1, top - 3, 1.2, 3);
          ctx.fillRect(b.x + b.w * 0.25 + 9, top - 3, 1.2, 3);
          ctx.beginPath();
          ctx.moveTo(b.x + b.w * 0.25 - 1, top - 12);
          ctx.lineTo(b.x + b.w * 0.25 + 5.5, top - 16);
          ctx.lineTo(b.x + b.w * 0.25 + 12, top - 12);
          ctx.fill();
          break;
        case 'step':
          ctx.fillRect(b.x + 4, top - 7, b.w - 8, 7);
          break;
        default:
          break;
      }
      // A faint rim where the sky catches the roofline.
      ctx.fillStyle = edge;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(b.x, top, b.w, 1);
      ctx.globalAlpha = 1;
      // Windows.
      const cols = b.windows[0]?.length ?? 0;
      const gapX = (b.w - cols * 4) / (cols + 1);
      for (let r = 0; r < b.windows.length; r++) {
        for (let c = 0; c < cols; c++) {
          const lit = b.windows[r][c];
          if (lit === null) continue;
          ctx.globalAlpha = windowAlpha * (0.65 + 0.35 * Math.sin(frames / 90 + r * 1.7 + c * 2.3 + b.w));
          ctx.fillStyle = colours[lit];
          ctx.fillRect(b.x + gapX + c * (4 + gapX), top + 9 + r * 11, 4, 5);
        }
      }
      ctx.globalAlpha = 1;
    }
  };

  const drawWires = (ctx: CanvasRenderingContext2D, layer: SkylineLayer, colour: string) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = 0.45;
    const ground = FIELD_H + 2;
    for (let i = 0; i < layer.buildings.length - 1; i++) {
      const a = layer.buildings[i];
      if (!a.wire) continue;
      const b = layer.buildings[i + 1];
      const ax = a.x + a.w - 2;
      const ay = ground - a.h + 4;
      const bx = b.x + 2;
      const by = ground - b.h + 4;
      const span = bx - ax + 40;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo((ax + bx) / 2, Math.max(ay, by) + Math.min(22, span * 0.3), bx, by);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  return {
    step(speed, gates) {
      frames++;
      scrollSkyline(far, speed, rand);
      scrollSkyline(near, speed, rand);
      for (const c of clouds) {
        c.x -= speed * 0.06 + 0.05;
        if (c.x < -(c.w + 40) * c.s) clouds[clouds.indexOf(c)] = makeCloud(FIELD_W + 60 + rand() * 60, rand);
      }
      // Smoke off every chimney cap still on screen.
      if (frames % 9 === 0) {
        for (const g of gates) {
          if (g.x < -GATE_W || g.x > FIELD_W) continue;
          puffs.push({ x: g.x + GATE_W / 2, y: g.bottom - 6, r: 2 + rand() * 2, life: 70, max: 70, drift: 0.2 + rand() * 0.3 });
        }
      }
      for (const f of puffs) {
        f.x -= speed + f.drift;
        f.y -= 0.45;
        f.r += 0.08;
        f.life--;
      }
      puffs = puffs.filter((f) => f.life > 0);
    },

    drawBackdrop(ctx, p) {
      const night = !p.light;
      const skyTop = night ? mixHex(p.page, '#000000', 0.25) : mixHex(p.page, p.primary, 0.18);
      const skyMid = night ? mixHex(p.surface, p.velvet, 0.35) : mixHex(p.page, p.secondary, 0.3);
      const skyLow = night ? mixHex(p.velvet, p.primary, 0.3) : mixHex(p.surface, p.spark, 0.25);
      const sky = ctx.createLinearGradient(0, 0, 0, FIELD_H);
      sky.addColorStop(0, skyTop);
      sky.addColorStop(0.65, skyMid);
      sky.addColorStop(1, skyLow);
      ctx.fillStyle = sky;
      ctx.fillRect(-20, -20, FIELD_W + 40, FIELD_H + 40);

      if (night) {
        ctx.fillStyle = p.text;
        for (const s of stars) {
          ctx.globalAlpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(frames / 40 + s.phase));
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // The moon, with a halo in the palette's glow.
      const mx = FIELD_W * 0.76;
      const my = FIELD_H * 0.16;
      const halo = ctx.createRadialGradient(mx, my, 10, mx, my, 70);
      const haloColour = night ? p.glow : '#ffffff';
      halo.addColorStop(0, haloColour);
      halo.addColorStop(1, clearOf(haloColour));
      ctx.globalAlpha = night ? 0.35 : 0.55;
      ctx.fillStyle = halo;
      ctx.fillRect(mx - 80, my - 80, 160, 160);
      ctx.globalAlpha = 1;
      const disc = night ? mixHex(p.text, p.glow, 0.15) : '#fbfbfa';
      // By day the moon's marks are drawn in ink, not in the pale page colour,
      // or they vanish into the disc.
      const mark = night ? mixHex(disc, p.page, 0.18) : mixHex(disc, p.text, 0.16);
      ctx.fillStyle = disc;
      ctx.beginPath();
      ctx.arc(mx, my, 19, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.arc(mx, my, 19, 0, Math.PI * 2);
      ctx.clip();
      // The seas: two soft patches, then the craters, then a shadowed limb.
      ctx.fillStyle = mark;
      ctx.globalAlpha = night ? 0.35 : 0.45;
      for (const [dx, dy, rx, ry] of [[-4, -2, 9, 6], [6, 5, 7, 5]] as const) {
        ctx.beginPath();
        ctx.ellipse(mx + dx, my + dy, rx, ry, -0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      for (const [dx, dy, r] of [[-6, -4, 4], [5, 6, 3], [7, -7, 2], [-9, 7, 1.6]] as const) {
        ctx.beginPath();
        ctx.arc(mx + dx, my + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      const limb = ctx.createRadialGradient(mx - 5, my - 5, 8, mx, my, 20);
      limb.addColorStop(0, clearOf(mark));
      limb.addColorStop(1, mark);
      ctx.globalAlpha = night ? 0.4 : 0.55;
      ctx.fillStyle = limb;
      ctx.fillRect(mx - 20, my - 20, 40, 40);
      ctx.restore();
      if (!night) {
        ctx.strokeStyle = mixHex(disc, p.text, 0.25);
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(mx, my, 19, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Clouds drifting across the moon.
      // Each cloud is one shape, filled once, so overlapping bumps don't show
      // as layers; a soft edge and a slightly darker belly give it volume.
      const top = night ? p.text : '#ffffff';
      const belly = night ? mixHex(p.text, p.velvet, 0.45) : mixHex('#ffffff', p.secondary, 0.22);
      for (const c of clouds) {
        const shade = ctx.createLinearGradient(0, c.y - 26 * c.s, 0, c.y + 8 * c.s);
        shade.addColorStop(0, top);
        shade.addColorStop(1, belly);
        ctx.beginPath();
        for (const [dx, dy, r] of c.bumps) {
          ctx.moveTo(c.x + (dx + r) * c.s, c.y + dy * c.s);
          ctx.arc(c.x + dx * c.s, c.y + dy * c.s, r * c.s, 0, Math.PI * 2);
        }
        ctx.roundRect(c.x - (c.w / 2) * c.s, c.y - 8 * c.s, c.w * c.s, 14 * c.s, 7 * c.s);
        ctx.globalAlpha = night ? 0.08 : 0.6;
        ctx.fillStyle = shade;
        ctx.shadowColor = top;
        ctx.shadowBlur = 10 * c.s;
        ctx.fill('nonzero');
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;

      // City glow along the horizon, then the two skylines, far over near.
      const glow = ctx.createLinearGradient(0, FIELD_H * 0.55, 0, FIELD_H);
      glow.addColorStop(0, clearOf(p.primary));
      glow.addColorStop(1, p.primary);
      ctx.globalAlpha = night ? 0.18 : 0.12;
      ctx.fillStyle = glow;
      ctx.fillRect(0, FIELD_H * 0.55, FIELD_W, FIELD_H * 0.45);
      ctx.globalAlpha = 1;

      // Far buildings are haze: the sky's own colour, a step darker. Near ones
      // are silhouettes, dark enough that the lit chimneys read in front.
      const farBody = night ? mixHex(skyMid, '#000000', 0.38) : mixHex(skyMid, p.text, 0.28);
      const nearBody = night ? mixHex(p.page, '#000000', 0.35) : mixHex(p.page, p.text, 0.8);
      drawLayer(ctx, far, farBody, p.glow, p, night ? 0.35 : 0.25);
      drawWires(ctx, near, night ? mixHex(p.text, p.page, 0.4) : p.text);
      drawLayer(ctx, near, nearBody, p.glow, p, night ? 0.85 : 0.6);

      // Chimney smoke sits in front of the city, behind the gates.
      ctx.fillStyle = night ? p.text : mixHex(p.text, p.page, 0.4);
      for (const f of puffs) {
        ctx.globalAlpha = 0.16 * (f.life / f.max);
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },

    drawGate(ctx, gate, p) {
      const night = !p.light;
      // Below: a brick chimney, capped, glowing faintly where the heat is.
      // The chimney has to read in front of the city in every palette, so it
      // carries some of the palette's spark and a lit edge.
      const brickA = mixHex(mixHex(p.primary, p.spark, 0.3), night ? '#000000' : p.text, night ? 0.3 : 0.1);
      const brickB = mixHex(mixHex(p.secondary, p.spark, 0.3), night ? '#000000' : p.text, night ? 0.45 : 0.25);
      const body = ctx.createLinearGradient(gate.x, 0, gate.x + GATE_W, 0);
      body.addColorStop(0, brickA);
      body.addColorStop(1, brickB);
      ctx.fillStyle = body;
      ctx.fillRect(gate.x, gate.bottom + 4, GATE_W, FIELD_H - gate.bottom);
      ctx.strokeStyle = night ? '#000000' : p.text;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = 0.7;
      for (let y = gate.bottom + 10, row = 0; y < FIELD_H; y += 6, row++) {
        ctx.beginPath();
        ctx.moveTo(gate.x, y);
        ctx.lineTo(gate.x + GATE_W, y);
        const off = row % 2 ? GATE_W * 0.33 : GATE_W * 0.66;
        ctx.moveTo(gate.x + off, y);
        ctx.lineTo(gate.x + off, y + 6);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.glow;
      ctx.globalAlpha = night ? 0.5 : 0.8;
      ctx.fillRect(gate.x, gate.bottom + 4, 1.2, FIELD_H - gate.bottom);
      ctx.globalAlpha = 1;
      ctx.fillStyle = mixHex(p.primary, night ? p.text : '#ffffff', 0.12);
      ctx.shadowColor = p.primary;
      ctx.shadowBlur = gate.passed ? 2 : 10;
      ctx.fillRect(gate.x - 3, gate.bottom, GATE_W + 6, 5);
      ctx.shadowBlur = 0;

      // Above: a string of lights draped down to the gap, zigzagging across
      // the gate's width so what you can hit is what you can see.
      const cordX = gate.x + GATE_W / 2;
      const sway = GATE_W / 2 - 2.5;
      const points: [number, number][] = [];
      for (let y = gate.top - 13, i = 0; y > -10; y -= 8, i++) points.push([cordX + (i % 2 ? sway : -sway), y]);
      ctx.strokeStyle = night ? mixHex(p.text, p.page, 0.45) : p.text;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 1;
      // The cord droops a little between each pair of bulbs.
      ctx.beginPath();
      ctx.moveTo(cordX, gate.top - 8);
      let [px, py] = [cordX, gate.top - 8];
      for (const [x, y] of points) {
        ctx.quadraticCurveTo((px + x) / 2, Math.max(py, y) + 3, x, y);
        [px, py] = [x, y];
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      const bulbs = [p.spark, p.glow, p.primary];
      points.forEach(([x, y], i) => {
        const colour = bulbs[i % bulbs.length];
        ctx.fillStyle = colour;
        ctx.shadowColor = colour;
        ctx.shadowBlur = gate.passed ? 2 : 7;
        ctx.globalAlpha = 0.75 + 0.25 * Math.sin(frames / 12 + i);
        ctx.beginPath();
        ctx.arc(x, y + 2.4, 2.4, 0, Math.PI * 2);
        ctx.fill();
        // The little socket each bulb hangs from.
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = night ? mixHex(p.text, p.page, 0.45) : p.text;
        ctx.fillRect(x - 1.1, y - 0.6, 2.2, 1.6);
      });
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      // The lantern at the bottom of the string.
      ctx.fillStyle = mixHex(p.spark, '#ffffff', night ? 0.15 : 0);
      ctx.shadowColor = p.spark;
      ctx.shadowBlur = gate.passed ? 4 : 14;
      ctx.beginPath();
      ctx.roundRect(gate.x, gate.top - 12, GATE_W, 12, 3);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = night ? '#000000' : p.text;
      ctx.globalAlpha = 0.45;
      ctx.fillRect(gate.x + 2, gate.top - 13, GATE_W - 4, 2);
      ctx.globalAlpha = 1;
    },

    drawGlider(ctx, x, y, vy, p) {
      // Birch's paper plane: two folded faces and a keel.
      const night = !p.light;
      const paper = night ? mixHex(p.text, '#ffffff', 0.4) : '#ffffff';
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.min(Math.PI / 4, Math.max(-Math.PI / 4, vy * 0.12)));
      ctx.shadowColor = p.glow;
      ctx.shadowBlur = night ? 12 : 6;
      ctx.fillStyle = paper;
      ctx.beginPath();
      ctx.moveTo(15, 0);
      ctx.lineTo(-11, -8);
      ctx.lineTo(-6, 0);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = mixHex(paper, night ? p.page : p.text, 0.28);
      ctx.beginPath();
      ctx.moveTo(15, 0);
      ctx.lineTo(-6, 0);
      ctx.lineTo(-10, 6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = night ? p.page : p.text;
      ctx.globalAlpha = night ? 0.35 : 0.5;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(15, 0);
      ctx.lineTo(-6, 0);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    },

    crashColors(p) {
      // Sparks, and scraps of paper.
      return [p.spark, p.glow, '#ffffff', p.light ? p.text : mixHex(p.text, '#ffffff', 0.4)];
    },
  };
}
