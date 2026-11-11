// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Core Defense — keep the fire through the night.
//
// Birch's fire burns in a ring of stones in the middle of a clearing, and
// things come out of the dark at it: little shades, moths, shadow pools that
// spread as they come, and wisps dressed as embers that break into shades
// near the fire. Hold the pad, or the field itself, and drag to throw embers.
// Every hour of the night is a wave, Dusk to 4 AM and on toward dawn. Hits
// in quick succession chain for more, and every hit feeds the flare, which
// clears everything near the fire when it's full.
//
// The rules are in hearth-logic.ts and the clearing is drawn by
// hearth-scene.ts; this file runs the night and the controls around it.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { RotateCcw, Crosshair, Flame } from 'lucide-react';
import { cn, haptic } from '../../lib/utils';
import { useHeldKeys, useKeyPress } from './gameKeys';
import { type Paint, drawLabel, fitCanvas, mixHex, readNumber, readPaint, writeValue } from './arcade-kit';
import {
  CHAIN_WINDOW,
  CX,
  CY,
  EMBER_EVERY,
  EMBER_SPEED,
  FIELD_H,
  FIELD_W,
  FIRE_R,
  FLARE_RADIUS,
  type Kind,
  POINTS,
  STEP_MS,
  WISP_SPLIT_AT,
  chainMultiplier,
  chargeFlare,
  emberHits,
  hourName,
  lightRadius,
  offField,
  pickKind,
  reachesFire,
  spawnPoint,
  waveBonus,
  waveFor,
} from './hearth-logic';
import { type Creature, fireTones, hearthScene } from './hearth-scene';

type Phase = 'ready' | 'playing' | 'between' | 'over';

interface Foe extends Creature { dx: number; dy: number; base: number; age: number; split: boolean }
interface Ember { x: number; y: number; px: number; py: number; dx: number; dy: number }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number }
interface Floater { text: string; x: number; y: number; life: number; max: number; color: string; big?: boolean }
interface RunResult { score: number; hour: string; kills: number; bestChain: number; newBest: boolean }

const KEYS = { best: 'core_defense_best' };

export function CoreDefenseGame({ colors: _colors, rawColors, onExit: _onExit }: { colors: any; rawColors: any; onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduceMotion = useReducedMotion();

  const [phase, setPhase] = useState<Phase>('ready');
  const [score, setScore] = useState(0);
  const [wave, setWave] = useState(1);
  const [chain, setChain] = useState(0);
  const [flare, setFlare] = useState(0);
  const [best, setBest] = useState(() => readNumber(KEYS.best));
  const [result, setResult] = useState<RunResult | null>(null);

  const game = useRef({
    phase: 'ready' as Phase,
    scene: hearthScene(),
    paint: null as Paint | null,
    frames: 0,
    wave: 1,
    toSpawn: 0,
    spawnTimer: 0,
    betweenTimer: 0,
    foes: [] as Foe[],
    embers: [] as Ember[],
    particles: [] as Particle[],
    floaters: [] as Floater[],
    aim: -Math.PI / 2,
    padFiring: false,
    keyFiring: false,
    lastEmber: 0,
    score: 0,
    kills: 0,
    chain: 0,
    bestChain: 0,
    lastKill: -999,
    flare: 0,
    flareRing: null as null | { r: number },
    light: 160,
    shake: 0,
    flash: 0,
    reduceMotion: false,
  });
  game.current.reduceMotion = !!reduceMotion;

  useEffect(() => {
    game.current.paint = readPaint(rawColors);
  }, [rawColors.accent, rawColors.pageBg, rawColors.panelBg]);

  const burst = (x: number, y: number, count: number, palette: string[], power: number) => {
    const g = game.current;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.3 + Math.random()) * power;
      const max = 22 + Math.random() * 24;
      g.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: max, max, color: palette[i % palette.length], size: 0.8 + Math.random() * 1.8 });
    }
  };

  const spawnFoe = (kind: Kind, at?: { x: number; y: number }, angle?: number) => {
    const g = game.current;
    const spec = waveFor(g.wave);
    const from = at ?? spawnPoint(Math.random() * Math.PI * 2);
    const base = angle ?? Math.atan2(CY - from.y, CX - from.x);
    let speed = spec.speed * (0.85 + Math.random() * 0.3);
    let r = 8 + Math.random() * 4;
    if (kind === 'creep') { r = 7; speed *= 0.5; }
    if (kind === 'moth') r = 9;
    if (kind === 'wisp') r = 6;
    g.foes.push({
      kind, x: from.x, y: from.y, r,
      dx: Math.cos(base) * speed, dy: Math.sin(base) * speed,
      base, heading: base, phase: Math.random() * 6, age: 0, split: false,
    });
  };

  const startWave = (n: number) => {
    const g = game.current;
    g.wave = n;
    g.toSpawn = waveFor(n).count;
    g.spawnTimer = 40;
    g.phase = 'playing';
    const p = g.paint!;
    g.floaters.push({ text: hourName(n), x: CX, y: CY - 70, life: 90, max: 90, color: mixHex(p.spark, '#ffffff', 0.3), big: true });
    setWave(n);
    setPhase('playing');
  };

  const start = useCallback(() => {
    const g = game.current;
    g.paint = readPaint(rawColors);
    Object.assign(g, {
      frames: 0, foes: [], embers: [], particles: [], floaters: [],
      aim: -Math.PI / 2, lastEmber: 0, score: 0, kills: 0, chain: 0, bestChain: 0,
      lastKill: -999, flare: 0, flareRing: null, light: 160, shake: 0, flash: 0,
    });
    setScore(0);
    setChain(0);
    setFlare(0);
    setResult(null);
    startWave(1);
  }, [rawColors]);

  const finish = useCallback(() => {
    const g = game.current;
    if (g.phase !== 'over') return;
    const old = readNumber(KEYS.best);
    const newBest = g.score > old;
    if (newBest) {
      writeValue(KEYS.best, g.score);
      setBest(g.score);
    }
    setResult({ score: g.score, hour: hourName(g.wave), kills: g.kills, bestChain: g.bestChain, newBest });
    setPhase('over');
  }, []);

  const crash = () => {
    const g = game.current;
    if (g.phase === 'over') return;
    g.phase = 'over';
    g.padFiring = false;
    if (!g.reduceMotion) {
      g.shake = 12;
      g.flash = 0.5;
    }
    const p = g.paint!;
    const t = fireTones(p);
    burst(CX, CY - 6, 50, [t.outer, t.mid, t.ember, p.text], 3);
    haptic(50);
    window.setTimeout(finish, 750);
  };

  const kill = (foe: Foe, byFlare = false) => {
    const g = game.current;
    const p = g.paint!;
    g.chain = g.frames - g.lastKill <= CHAIN_WINDOW ? g.chain + 1 : 1;
    g.lastKill = g.frames;
    g.bestChain = Math.max(g.bestChain, g.chain);
    const points = POINTS[foe.kind] * chainMultiplier(g.chain);
    g.score += points;
    g.kills++;
    if (!byFlare) g.flare = chargeFlare(g.flare);
    const colours = foe.kind === 'wisp' ? [fireTones(p).ember, p.spark] : [fireTones(p).outer, p.spark, p.glow];
    burst(foe.x, foe.y, foe.kind === 'creep' ? 16 : 10, colours, 1.8);
    g.floaters.push({ text: g.chain >= 5 ? `+${points} ×${chainMultiplier(g.chain)}` : `+${points}`, x: foe.x, y: foe.y - 10, life: 36, max: 36, color: mixHex(p.spark, '#ffffff', 0.4) });
    setScore(g.score);
    setChain(g.chain);
    setFlare(g.flare);
  };

  const splitWisp = (foe: Foe) => {
    const g = game.current;
    foe.split = true;
    const p = g.paint!;
    burst(foe.x, foe.y, 12, [p.spark, p.glow], 1.6);
    spawnFoe('shade', { x: foe.x, y: foe.y }, foe.base - 0.5);
    spawnFoe('shade', { x: foe.x, y: foe.y }, foe.base + 0.5);
  };

  const throwFlare = useCallback(() => {
    const g = game.current;
    if (g.flare < 1 || (g.phase !== 'playing' && g.phase !== 'between')) return;
    g.flare = 0;
    g.flareRing = { r: FIRE_R };
    if (!g.reduceMotion) g.shake = 6;
    haptic(30);
    setFlare(0);
  }, []);

  const step = () => {
    const g = game.current;
    g.frames++;
    g.scene.step(g.frames);

    for (const pt of g.particles) {
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.vx *= 0.95;
      pt.vy *= 0.95;
      pt.life--;
    }
    g.particles = g.particles.filter((pt) => pt.life > 0);
    for (const f of g.floaters) {
      f.life--;
      f.y -= f.big ? 0.12 : 0.45;
    }
    g.floaters = g.floaters.filter((f) => f.life > 0);
    g.shake *= 0.86;
    g.flash *= 0.88;

    if (g.phase === 'ready' || g.phase === 'over') return;

    // Embers.
    if ((g.padFiring || g.keyFiring) && g.frames - g.lastEmber >= EMBER_EVERY) {
      g.lastEmber = g.frames;
      const sx = CX + Math.cos(g.aim) * (FIRE_R + 4);
      const sy = CY + Math.sin(g.aim) * (FIRE_R + 4);
      g.embers.push({ x: sx, y: sy, px: sx, py: sy, dx: Math.cos(g.aim) * EMBER_SPEED, dy: Math.sin(g.aim) * EMBER_SPEED });
    }
    for (const e of g.embers) {
      e.px = e.x;
      e.py = e.y;
      e.x += e.dx;
      e.y += e.dy;
    }
    g.embers = g.embers.filter((e) => !offField(e.x, e.y, 10));

    // The flare's ring sweeps out from the fire.
    if (g.flareRing) {
      g.flareRing.r += 6;
      for (const foe of [...g.foes]) {
        if (Math.hypot(foe.x - CX, foe.y - CY) < g.flareRing.r + foe.r) {
          kill(foe, true);
          g.foes.splice(g.foes.indexOf(foe), 1);
        }
      }
      if (g.flareRing.r > FLARE_RADIUS) g.flareRing = null;
    }

    if (g.chain > 0 && g.frames - g.lastKill > CHAIN_WINDOW) {
      g.chain = 0;
      setChain(0);
    }

    if (g.phase === 'between') {
      if (--g.betweenTimer <= 0) startWave(g.wave + 1);
      return;
    }

    // Arrivals.
    const spec = waveFor(g.wave);
    if (g.toSpawn > 0 && --g.spawnTimer <= 0) {
      spawnFoe(pickKind(spec, Math.random()));
      g.toSpawn--;
      g.spawnTimer = spec.every;
    }

    let nearest = Infinity;
    for (const foe of [...g.foes]) {
      foe.age++;
      if (foe.kind === 'moth') {
        // Fluttering across its line of approach.
        const wiggle = Math.sin(foe.age / 8 + foe.phase) * 1.6;
        foe.x += foe.dx + Math.cos(foe.base + Math.PI / 2) * wiggle;
        foe.y += foe.dy + Math.sin(foe.base + Math.PI / 2) * wiggle;
      } else {
        if (foe.kind === 'creep') foe.r = Math.min(22, foe.r + 0.035);
        foe.x += foe.dx;
        foe.y += foe.dy;
      }
      foe.heading = Math.atan2(CY - foe.y, CX - foe.x);
      const dist = Math.hypot(foe.x - CX, foe.y - CY);

      if (foe.kind === 'wisp' && !foe.split && dist < WISP_SPLIT_AT) {
        splitWisp(foe);
        g.foes.splice(g.foes.indexOf(foe), 1);
        continue;
      }
      if (reachesFire(foe.x, foe.y, foe.r)) {
        crash();
        return;
      }
      const hit = g.embers.findIndex((e) => emberHits(e.x, e.y, foe.x, foe.y, foe.r));
      if (hit >= 0) {
        g.embers.splice(hit, 1);
        if (foe.kind === 'wisp' && !foe.split) {
          kill(foe);
          splitWisp(foe);
        } else {
          kill(foe);
        }
        g.foes.splice(g.foes.indexOf(foe), 1);
        continue;
      }
      nearest = Math.min(nearest, dist);
    }
    g.light += (lightRadius(nearest) - g.light) * 0.06;

    if (g.toSpawn === 0 && g.foes.length === 0) {
      const bonus = waveBonus(g.wave);
      g.score += bonus;
      setScore(g.score);
      const p = g.paint!;
      g.floaters.push({ text: `${hourName(g.wave)} held  +${bonus}`, x: CX, y: CY + 70, life: 100, max: 100, color: mixHex(p.glow, '#ffffff', 0.3) });
      const t = fireTones(p);
      burst(CX, CY - 10, 24, [t.outer, t.mid, t.ember], 2.4);
      haptic(15);
      g.phase = 'between';
      g.betweenTimer = 110;
      setPhase('between');
    }
  };

  const draw = (ctx: CanvasRenderingContext2D) => {
    const g = game.current;
    const p = g.paint ?? readPaint(rawColors);
    g.paint = p;
    ctx.save();
    if (g.shake > 0.3) ctx.translate((Math.random() - 0.5) * g.shake, (Math.random() - 0.5) * g.shake);

    g.scene.drawGround(ctx, p, g.light, g.frames);
    g.scene.drawDark(ctx, p, g.light);

    // Where the next ember will go.
    if (g.phase === 'playing' || g.phase === 'between') {
      ctx.strokeStyle = mixHex(p.spark, '#ffffff', 0.3);
      ctx.globalAlpha = g.padFiring || g.keyFiring ? 0.5 : 0.25;
      ctx.setLineDash([2, 6]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(CX + Math.cos(g.aim) * (FIRE_R + 12), CY + Math.sin(g.aim) * (FIRE_R + 12));
      ctx.lineTo(CX + Math.cos(g.aim) * (FIRE_R + 80), CY + Math.sin(g.aim) * (FIRE_R + 80));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Embers, with a short streak behind each.
    const tones = fireTones(p);
    const emberCore = tones.ember;
    ctx.lineCap = 'round';
    for (const e of g.embers) {
      ctx.strokeStyle = tones.outer;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(e.x - e.dx * 1.6, e.y - e.dy * 1.6);
      ctx.lineTo(e.x, e.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = emberCore;
      ctx.shadowColor = tones.outer;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    for (const foe of g.foes) g.scene.drawCreature(ctx, foe, p, g.frames);
    g.scene.drawFire(ctx, p, g.frames, g.phase === 'over');

    if (g.flareRing) {
      const t = g.flareRing.r / FLARE_RADIUS;
      ctx.strokeStyle = emberCore;
      ctx.shadowColor = tones.outer;
      ctx.shadowBlur = 16;
      ctx.globalAlpha = 1 - t * 0.8;
      ctx.lineWidth = 4 * (1 - t) + 1;
      ctx.beginPath();
      ctx.arc(CX, CY, g.flareRing.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    for (const pt of g.particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.max);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const f of g.floaters) {
      ctx.globalAlpha = Math.min(1, (f.life / f.max) * 1.6);
      drawLabel(ctx, f.text, f.x, f.y, p, { size: f.big ? 24 : 11, ink: f.color });
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    if (g.flash > 0.02) {
      ctx.globalAlpha = g.flash;
      ctx.fillStyle = mixHex(p.spark, '#ffffff', 0.5);
      ctx.fillRect(0, 0, FIELD_W, FIELD_H);
      ctx.globalAlpha = 1;
    }
  };

  // One loop for the life of the screen: physics on a fixed step, drawing on
  // every frame the browser gives us. It reads everything through refs.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas && fitCanvas(canvas, FIELD_W, FIELD_H);
    if (!ctx) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const frame = (now: number) => {
      acc += Math.min(250, now - last);
      last = now;
      while (acc >= STEP_MS) {
        step();
        acc -= STEP_MS;
      }
      draw(ctx);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Keyboard: arrows or A/D sweep the aim, space holds fire, F throws the
  // flare. Touch and keys keep separate firing switches, so one never turns
  // the other off.
  const live = phase === 'playing' || phase === 'between';
  useHeldKeys(live, ['ArrowLeft', 'ArrowRight', 'a', 'd', 'A', 'D', ' '], (held) => {
    const g = game.current;
    const turn = 0.055;
    if (held.has('ArrowLeft') || held.has('a') || held.has('A')) g.aim -= turn;
    if (held.has('ArrowRight') || held.has('d') || held.has('D')) g.aim += turn;
    g.keyFiring = held.has(' ');
  });
  useKeyPress(live, ['f', 'F'], throwFlare);
  useKeyPress(phase === 'ready' || phase === 'over', [' ', 'Enter'], start);

  const aimAt = (clientX: number, clientY: number, rect: DOMRect, fromCentreOf: 'pad' | 'field') => {
    const g = game.current;
    if (fromCentreOf === 'pad') {
      g.aim = Math.atan2(clientY - (rect.top + rect.height / 2), clientX - (rect.left + rect.width / 2));
    } else {
      const fx = ((clientX - rect.left) / rect.width) * FIELD_W;
      const fy = ((clientY - rect.top) / rect.height) * FIELD_H;
      g.aim = Math.atan2(fy - CY, fx - CX);
    }
  };

  const holdHandlers = (where: 'pad' | 'field') => ({
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      const g = game.current;
      if (g.phase === 'over') return;
      if (g.phase === 'ready') start();
      g.padFiring = true;
      aimAt(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect(), where);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (game.current.padFiring) aimAt(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect(), where);
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      game.current.padFiring = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
    },
    onPointerCancel: () => {
      game.current.padFiring = false;
    },
  });

  const accent = rawColors.accent;
  const flareReady = flare >= 1 && live;

  return (
    <div className="flex flex-col h-full items-center justify-center p-4 gap-3">
      <div className="w-full max-w-[340px] flex justify-between items-end rounded-[var(--shape-control)] border px-4 py-3 backdrop-blur-md" style={{ backgroundColor: rawColors.panelBg, borderColor: rawColors.panelBorder }}>
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-widest opacity-60">Score</div>
          <div className="text-xl font-light leading-none mt-1 tabular-nums">{score}</div>
        </div>
        <div className="flex-1 text-center">
          <div className="text-[10px] uppercase tracking-widest opacity-60">Best</div>
          <div className="text-xl font-light leading-none mt-1 tabular-nums">{best}</div>
        </div>
        <div className="flex-1 text-right">
          <div className="text-[10px] uppercase tracking-widest opacity-60">Hour</div>
          <div className="text-xl font-light leading-none mt-1 whitespace-nowrap">
            {phase === 'ready' ? '—' : hourName(wave)}
            {chain >= 5 && <span className="text-xs ml-1.5 tabular-nums" style={{ color: accent }}>×{chainMultiplier(chain)}</span>}
          </div>
        </div>
      </div>

      <div
        className="relative w-full max-w-[340px] aspect-[340/453] rounded-[var(--shape-control)] overflow-hidden border touch-none select-none"
        style={{ backgroundColor: rawColors.panelBg, borderColor: rawColors.panelBorder }}
        {...holdHandlers('field')}
      >
        <canvas ref={canvasRef} className="w-full h-full" />

        <AnimatePresence>
          {phase === 'ready' && (
            <motion.div key="ready" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-x-0 bottom-8 flex justify-center pointer-events-none">
              {/* On a soft card, like Signal Glide's, so it reads over the
                  grass by day too (theirs, Oct 26 2026: 'do the same for the
                  core defense'). */}
              <div
                className="text-center mx-6 px-5 py-3 rounded-[var(--shape-surface)] border backdrop-blur-md"
                style={{ backgroundColor: rawColors.panelBg, borderColor: rawColors.panelBorder }}
              >
                <div className="text-xl font-light mb-1">Core Defense</div>
                <div className="text-xs opacity-75">Keep the fire through the night. Hold the field or the pad and drag to throw embers.</div>
              </div>
            </motion.div>
          )}

          {phase === 'over' && result && (
            <motion.div
              key="over"
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 22 }}
              className="absolute inset-0 flex items-center justify-center p-6"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="w-full rounded-[var(--shape-surface)] border px-5 py-5 text-center backdrop-blur-xl" style={{ backgroundColor: rawColors.panelBg, borderColor: rawColors.panelBorder }}>
                {result.newBest && (
                  <div className="inline-block text-[10px] uppercase tracking-widest px-2 py-1 rounded-full mb-2" style={{ backgroundColor: accent, color: 'var(--aerie-on-accent)' }}>
                    New best
                  </div>
                )}
                <div className="text-4xl font-light tabular-nums">{result.score}</div>
                <div className="text-xs opacity-75 mt-2">
                  The fire went out at {result.hour} · {result.kills} turned back · best chain {result.bestChain}
                </div>
                <button
                  onClick={start}
                  className="mt-4 px-6 py-3 rounded-[var(--shape-control)] font-medium text-sm inline-flex items-center gap-2 hover:scale-105 transition-transform"
                  style={{ backgroundColor: accent, color: 'var(--aerie-on-accent)' }}
                >
                  <RotateCcw size={16} /> Light it again
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="w-full max-w-[340px] flex items-center justify-center gap-6">
        <div
          className="w-28 h-28 rounded-full border-2 flex items-center justify-center touch-none relative cursor-pointer"
          style={{ backgroundColor: rawColors.panelBg, borderColor: rawColors.panelBorder }}
          aria-label="Aim and throw embers"
          {...holdHandlers('pad')}
        >
          <div className="w-11 h-11 rounded-full flex items-center justify-center pointer-events-none" style={{ backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}>
            <Crosshair size={22} />
          </div>
        </div>
        <button
          onClick={throwFlare}
          disabled={!flareReady}
          aria-label={flareReady ? 'Throw the flare' : 'The flare is charging'}
          className={cn('relative w-16 h-16 rounded-full border-2 flex flex-col items-center justify-center text-[10px] uppercase tracking-widest transition-transform', flareReady && 'hover:scale-105 active:scale-95')}
          style={{
            borderColor: flareReady ? accent : rawColors.panelBorder,
            background: `conic-gradient(color-mix(in srgb, ${accent} ${flareReady ? 45 : 28}%, transparent) ${Math.round(flare * 360)}deg, ${rawColors.panelBg} 0deg)`,
            boxShadow: flareReady ? `0 0 18px color-mix(in srgb, ${accent} 60%, transparent)` : undefined,
            color: flareReady ? undefined : rawColors.textMuted,
          }}
        >
          <Flame size={18} />
          <span className="mt-0.5">Flare</span>
        </button>
      </div>
    </div>
  );
}
