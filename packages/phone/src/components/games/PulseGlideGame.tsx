// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Signal Glide — tap to boost, thread the gates.
//
// The field paints itself from them live palette, so the game changes when the
// house does. Holding the middle of a gate is a clean pass, and clean passes
// in a row are where the points are. Every ten gates the course speeds up and
// the gaps close in. The daily run is one fixed course for the whole day, with
// its own best; the endless run is the old game grown up. Best scores unlock
// trails behind the glider.
//
// The rules live in pulse-glide-logic.ts; this file is the canvas and the
// buttons around it.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { RotateCcw, Lock } from 'lucide-react';
import { cn, haptic } from '../../lib/utils';
import { SegmentedControl } from '../../ui';
import { useKeyPress } from './gameKeys';
import {
  BOOST,
  FIELD_H,
  FIELD_W,
  GATE_W,
  GLIDER_R,
  GLIDER_X,
  GRAVITY,
  STEP_MS,
  TRAILS,
  type Trail,
  type TrailId,
  dayKey,
  difficultyFor,
  gapTopFor,
  hitsBounds,
  hitsGate,
  isCleanPass,
  levelFor,
  newlyUnlocked,
  scoreGate,
  seedForDay,
  seededRandom,
  unlockedTrails,
} from './pulse-glide-logic';
import { type World, type WorldId, WORLDS, rooftopsWorld } from './glide-worlds';
import { type DeepCast, deepWorld } from './deep-world';
import { getOwnerAvatar, useHouseRoster } from '../../lib/house';
import { type Paint, drawLabel, fitCanvas, mixHex, readNumber, readPaint, readText, writeValue } from './arcade-kit';

type Mode = 'endless' | 'daily';
type Phase = 'ready' | 'playing' | 'over';

interface Gate { x: number; top: number; bottom: number; passed: boolean }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number }
interface Floater { text: string; x: number; y: number; life: number; max: number; color: string; big?: boolean }

interface RunResult { score: number; level: number; clean: number; newBest: boolean; unlocked: Trail[] }

const KEYS = {
  endless: 'signal_glide_high_score',
  ever: 'signal_glide_best_ever',
  trail: 'signal_glide_trail',
  world: 'signal_glide_world',
  daily: (day: string) => `signal_glide_daily_${day}`,
};

function readTrail(): TrailId {
  const t = readText(KEYS.trail);
  return TRAILS.some((x) => x.id === t) ? (t as TrailId) : 'spark';
}

function readWorld(): WorldId {
  const w = readText(KEYS.world);
  return WORLDS.some((x) => x.id === w) ? (w as WorldId) : 'rooftops';
}

export function PulseGlideGame({ colors, rawColors, onExit: _onExit }: { colors: any; rawColors: any; onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduceMotion = useReducedMotion();
  const today = dayKey(new Date());

  const [mode, setMode] = useState<Mode>('endless');
  const [phase, setPhase] = useState<Phase>('ready');
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [streak, setStreak] = useState(0);
  const [trail, setTrail] = useState<TrailId>(readTrail);
  const [worldId, setWorldId] = useState<WorldId>(readWorld);
  const [bestEndless, setBestEndless] = useState(() => readNumber(KEYS.endless));
  const [bestDaily, setBestDaily] = useState(() => readNumber(KEYS.daily(today)));
  const [bestEver, setBestEver] = useState(() => Math.max(readNumber(KEYS.ever), readNumber(KEYS.endless)));
  const [result, setResult] = useState<RunResult | null>(null);

  const best = mode === 'daily' ? bestDaily : bestEndless;

  // Who comes down in Deep Blue: this house's own companions and their own
  // colour, read through a ref so a roster that loads after the world is
  // made still arrives.
  const roster = useHouseRoster();
  const cast = useRef<DeepCast>({ self: null, lights: [] });
  cast.current = { self: getOwnerAvatar().color ?? null, lights: roster.companions.map((c) => c.color) };
  const makeWorld = (id: WorldId): World => (id === 'deep' ? deepWorld(() => cast.current) : rooftopsWorld());
  const unlocked = unlockedTrails(bestEver);

  // Everything the frame loop touches lives in one ref, so a re-render never
  // interrupts a run.
  const game = useRef({
    phase: 'ready' as Phase,
    mode: 'endless' as Mode,
    y: FIELD_H / 2,
    vy: 0,
    gates: [] as Gate[],
    frames: 0,
    sinceGate: 60,
    score: 0,
    gatesPassed: 0,
    level: 1,
    streak: 0,
    clean: 0,
    history: [] as number[],
    particles: [] as Particle[],
    floaters: [] as Floater[],
    world: makeWorld(worldId),
    shake: 0,
    flash: 0,
    random: Math.random as () => number,
    paint: null as Paint | null,
    trail: trail as TrailId,
    reduceMotion: false,
    endedAt: 0,
  });

  // A saved trail only shows once it's earned; otherwise the starter one flies.
  game.current.trail = unlocked.includes(trail) ? trail : 'spark';
  game.current.reduceMotion = !!reduceMotion;
  game.current.mode = mode;

  useEffect(() => {
    game.current.paint = readPaint(rawColors);
  }, [rawColors.accent, rawColors.pageBg, rawColors.panelBg]);

  const burst = (x: number, y: number, count: number, palette: string[], power: number) => {
    const g = game.current;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.4 + Math.random()) * power;
      const max = 26 + Math.random() * 26;
      g.particles.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: max, max,
        color: palette[i % palette.length],
        size: 1 + Math.random() * 2.2,
      });
    }
  };

  const start = useCallback(() => {
    const g = game.current;
    g.paint = readPaint(rawColors);
    g.phase = 'playing';
    g.y = FIELD_H / 2;
    g.vy = BOOST;
    g.gates = [];
    g.frames = 0;
    g.sinceGate = 60;
    g.score = 0;
    g.gatesPassed = 0;
    g.level = 1;
    g.streak = 0;
    g.clean = 0;
    g.history = [];
    g.particles = [];
    g.floaters = [];
    g.shake = 0;
    g.flash = 0;
    g.random = g.mode === 'daily' ? seededRandom(seedForDay(dayKey(new Date()))) : Math.random;
    setScore(0);
    setLevel(1);
    setStreak(0);
    setResult(null);
    setPhase('playing');
  }, [rawColors]);

  const boost = useCallback(() => {
    const g = game.current;
    if (g.phase === 'ready') start();
    else if (g.phase === 'playing') g.vy = BOOST;
  }, [start]);

  const finish = useCallback(() => {
    const g = game.current;
    // A mode switch during the crash burst already reset the field.
    if (g.phase !== 'over') return;
    const day = dayKey(new Date());
    const final = g.score;
    const modeBestKey = g.mode === 'daily' ? KEYS.daily(day) : KEYS.endless;
    const oldModeBest = readNumber(modeBestKey);
    const oldEver = Math.max(readNumber(KEYS.ever), readNumber(KEYS.endless));
    const newBest = final > oldModeBest;
    if (newBest) {
      writeValue(modeBestKey, final);
      if (g.mode === 'daily') setBestDaily(final);
      else setBestEndless(final);
    }
    if (final > oldEver) {
      writeValue(KEYS.ever, final);
      setBestEver(final);
    }
    setResult({
      score: final,
      level: g.level,
      clean: g.clean,
      newBest,
      unlocked: newlyUnlocked(oldEver, Math.max(oldEver, final)),
    });
    setPhase('over');
  }, []);

  const crash = () => {
    const g = game.current;
    if (g.phase !== 'playing') return;
    g.phase = 'over';
    g.endedAt = performance.now();
    if (!g.reduceMotion) {
      g.shake = 11;
      g.flash = 0.55;
    }
    const p = g.paint!;
    burst(GLIDER_X, g.y, 40, g.world.crashColors(p), 3.2);
    haptic(45);
    // Let the burst play out before the card covers it.
    window.setTimeout(finish, 650);
  };

  const step = () => {
    const g = game.current;
    g.frames++;

    g.world.step(g.phase === 'playing' ? difficultyFor(g.level).speed : 0.6, g.gates, {
      level: g.level,
      streak: g.streak,
      gliderY: g.y,
      playing: g.phase === 'playing',
    });

    for (const pt of g.particles) {
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.vx *= 0.96;
      pt.vy = pt.vy * 0.96 + 0.04;
      pt.life--;
    }
    g.particles = g.particles.filter((pt) => pt.life > 0);
    for (const f of g.floaters) {
      f.life--;
      f.y -= f.big ? 0.15 : 0.5;
    }
    g.floaters = g.floaters.filter((f) => f.life > 0);
    g.shake *= 0.86;
    g.flash *= 0.88;

    if (g.phase === 'ready') {
      g.y = FIELD_H / 2 + Math.sin(g.frames / 22) * 10;
      g.history.unshift(g.y);
      g.history.length = Math.min(g.history.length, 40);
      return;
    }
    if (g.phase !== 'playing') return;

    const diff = difficultyFor(g.level);
    g.vy += GRAVITY;
    g.y += g.vy;
    g.history.unshift(g.y);
    g.history.length = Math.min(g.history.length, 40);
    if (hitsBounds(g.y)) return crash();

    g.sinceGate++;
    if (g.sinceGate >= diff.spawnEvery) {
      g.sinceGate = 0;
      const top = gapTopFor(g.random(), diff.gap);
      g.gates.push({ x: FIELD_W, top, bottom: top + diff.gap, passed: false });
    }

    for (const gate of g.gates) {
      gate.x -= diff.speed;
      if (hitsGate(g.y, gate.x, gate.top, gate.bottom)) return crash();
      if (!gate.passed && gate.x + GATE_W < GLIDER_X - GLIDER_R) {
        gate.passed = true;
        const clean = isCleanPass(g.y, gate.top, gate.bottom);
        const scored = scoreGate(g.streak, clean);
        g.streak = scored.streak;
        g.score += scored.points;
        g.gatesPassed++;
        if (clean) g.clean++;
        const p = g.paint!;
        const at = gate.x + GATE_W / 2;
        burst(at, g.y, clean ? 16 : 6, clean ? [p.spark, p.glow, p.text] : [p.glow, p.primary], clean ? 2.2 : 1.4);
        g.floaters.push({
          text: clean ? (g.streak > 1 ? `clean ×${g.streak}  +${scored.points}` : `clean  +${scored.points}`) : '+1',
          x: at, y: g.y - 16, life: 42, max: 42, color: clean ? mixHex(p.spark, '#ffffff', 0.35) : g.world.ink?.(p) ?? p.text,
        });
        if (clean) haptic(8);
        const nextLevel = levelFor(g.gatesPassed);
        if (nextLevel > g.level) {
          g.level = nextLevel;
          g.floaters.push({ text: `Level ${nextLevel}`, x: FIELD_W / 2, y: FIELD_H * 0.32, life: 80, max: 80, color: p.glow, big: true });
          burst(FIELD_W / 2, FIELD_H * 0.32, 24, [p.glow, p.spark, p.secondary], 2.6);
          haptic(20);
          setLevel(nextLevel);
        }
        setScore(g.score);
        setStreak(g.streak);
      }
    }
    g.gates = g.gates.filter((gate) => gate.x + GATE_W > -4);
  };

  const draw = (ctx: CanvasRenderingContext2D) => {
    const g = game.current;
    const p = g.paint ?? readPaint(rawColors);
    g.paint = p;

    ctx.save();
    if (g.shake > 0.3) ctx.translate((Math.random() - 0.5) * g.shake, (Math.random() - 0.5) * g.shake);

    g.world.drawBackdrop(ctx, p);

    // Gates, with the clean band marked in the gap.
    for (const gate of g.gates) {
      g.world.drawGate(ctx, gate, p);
      if (!gate.passed) {
        const mid = (gate.top + gate.bottom) / 2;
        const band = (gate.bottom - gate.top) * 0.22;
        ctx.fillStyle = p.spark;
        ctx.globalAlpha = 0.55;
        for (const y of [mid - band, mid + band]) {
          ctx.beginPath();
          ctx.arc(gate.x + GATE_W / 2, y, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }

    drawTrail(ctx, g, p);

    if (g.phase !== 'over') g.world.drawGlider(ctx, GLIDER_X, g.y, g.vy, p);

    for (const pt of g.particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.max);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const f of g.floaters) {
      const t = f.life / f.max;
      ctx.globalAlpha = Math.min(1, t * 1.6);
      drawLabel(ctx, f.text, f.x, f.y, p, { size: f.big ? 28 : 11, ink: f.color });
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    if (g.flash > 0.02) {
      ctx.globalAlpha = g.flash;
      ctx.fillStyle = p.light ? p.primary : '#ffffff';
      ctx.fillRect(0, 0, FIELD_W, FIELD_H);
      ctx.globalAlpha = 1;
    }
  };

  // One loop for the life of the screen: physics on a fixed step, drawing on
  // every frame the browser gives us.
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
    // The loop reads everything through refs, so it must not restart mid-run.
  }, []);

  useKeyPress(true, [' ', 'ArrowUp'], () => {
    if (phase !== 'over') boost();
  });
  useKeyPress(phase === 'over', ['Enter'], start);

  const chooseWorld = (id: WorldId) => {
    if (phase === 'playing' || id === worldId) return;
    setWorldId(id);
    writeValue(KEYS.world, id);
    game.current.world = makeWorld(id);
  };

  const chooseTrail = (id: TrailId) => {
    if (!unlocked.includes(id)) return;
    setTrail(id);
    writeValue(KEYS.trail, id);
  };

  const accent = rawColors.accent;

  return (
    <div className="flex flex-col h-full items-center justify-center p-4 gap-3">
      <div className="w-full max-w-[340px] flex items-center justify-between gap-2">
        <SegmentedControl<Mode>
          options={[{ value: 'endless', label: 'Endless' }, { value: 'daily', label: 'Daily run' }]}
          value={mode}
          onChange={(m) => {
            if (phase === 'playing') return;
            setMode(m);
            game.current.phase = 'ready';
            setPhase('ready');
            setResult(null);
            setScore(0);
            setLevel(1);
            setStreak(0);
          }}
          colors={colors}
        />
        {mode === 'daily' && <div className="text-[10px] uppercase tracking-widest opacity-60">{today}</div>}
      </div>

      <div className="w-full max-w-[340px] flex justify-between items-end rounded-[var(--shape-control)] border px-4 py-3 backdrop-blur-md" style={{ backgroundColor: rawColors.panelBg, borderColor: rawColors.panelBorder }}>
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-widest opacity-60">Score</div>
          <div className="text-xl font-light leading-none mt-1 tabular-nums">{score}</div>
        </div>
        <div className="flex-1 text-center">
          <div className="text-[10px] uppercase tracking-widest opacity-60">{mode === 'daily' ? 'Best today' : 'Best'}</div>
          <div className="text-xl font-light leading-none mt-1 tabular-nums">{best}</div>
        </div>
        <div className="flex-1 text-right">
          <div className="text-[10px] uppercase tracking-widest opacity-60">Level</div>
          <div className="text-xl font-light leading-none mt-1 tabular-nums">
            {level}
            {streak > 1 && <span className="text-xs ml-1.5" style={{ color: accent }}>×{streak}</span>}
          </div>
        </div>
      </div>

      <div
        className="relative w-full max-w-[340px] aspect-[340/453] rounded-[var(--shape-control)] overflow-hidden border cursor-pointer select-none"
        style={{ backgroundColor: rawColors.panelBg, borderColor: rawColors.panelBorder }}
        onPointerDown={boost}
      >
        <canvas ref={canvasRef} className="w-full h-full touch-none" />

        <AnimatePresence>
          {phase === 'ready' && (
            <motion.div
              key="ready"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-x-0 bottom-10 flex justify-center pointer-events-none"
            >
              {/* On a soft card so it reads over the rooftops by day too (theirs,
                  Oct 26 2026, option B off the title text canvas). */}
              <div
                className="text-center mx-6 px-5 py-3 rounded-[var(--shape-surface)] border backdrop-blur-md"
                style={{ backgroundColor: rawColors.panelBg, borderColor: rawColors.panelBorder }}
              >
                <div className="text-xl font-light mb-1">Signal Glide</div>
                <div className="text-xs opacity-70">
                  {worldId === 'deep' ? 'Tap to pulse up.' : 'Tap to boost.'} Thread the middle of a gate for a clean pass.
                </div>
                {mode === 'daily' && <div className="text-[10px] uppercase tracking-widest opacity-60 mt-2">The same course all day</div>}
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
              <div
                className="w-full rounded-[var(--shape-surface)] border px-5 py-5 text-center backdrop-blur-xl"
                style={{ backgroundColor: rawColors.panelBg, borderColor: rawColors.panelBorder }}
              >
                {result.newBest && (
                  <div className="inline-block text-[10px] uppercase tracking-widest px-2 py-1 rounded-full mb-2" style={{ backgroundColor: accent, color: 'var(--aerie-on-accent)' }}>
                    {mode === 'daily' ? 'Best today' : 'New best'}
                  </div>
                )}
                <div className="text-4xl font-light tabular-nums">{result.score}</div>
                <div className="text-xs opacity-70 mt-2">
                  Level {result.level} · {result.clean} clean {result.clean === 1 ? 'pass' : 'passes'}
                </div>
                {result.unlocked.length > 0 && (
                  <div className="text-xs mt-3" style={{ color: accent }}>
                    New {result.unlocked.length === 1 ? 'trail' : 'trails'}: {result.unlocked.map((t) => t.name).join(', ')}
                  </div>
                )}
                <button
                  onClick={start}
                  className="mt-4 px-6 py-3 rounded-[var(--shape-control)] font-medium text-sm inline-flex items-center gap-2 hover:scale-105 transition-transform"
                  style={{ backgroundColor: accent, color: 'var(--aerie-on-accent)' }}
                >
                  <RotateCcw size={16} /> Fly again
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className={cn('w-full max-w-[340px] transition-opacity flex flex-col gap-3', phase === 'playing' && 'opacity-40 pointer-events-none')}>
        <div>
          <div className="text-[10px] uppercase tracking-widest opacity-60 mb-1.5">World</div>
          <div className="flex gap-1.5 flex-wrap">
            {WORLDS.map((w) => {
              const selected = worldId === w.id;
              return (
                <button
                  key={w.id}
                  onClick={() => chooseWorld(w.id)}
                  aria-pressed={selected}
                  title={w.blurb}
                  className={cn(
                    'shrink-0 rounded-[var(--shape-chip)] px-3 py-1.5 text-xs font-medium border',
                    colors.panelBorder,
                    !selected && cn(colors.panelBg, colors.textMain),
                  )}
                  style={selected ? { background: 'var(--aerie-selected-fill)', color: '#ffffff', borderColor: accent } : undefined}
                >
                  {w.name}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest opacity-60 mb-1.5">Trail</div>
          <div className="flex gap-1.5 flex-wrap">
            {TRAILS.map((t) => {
              const open = unlocked.includes(t.id);
              const selected = game.current.trail === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => chooseTrail(t.id)}
                  disabled={!open}
                  aria-pressed={selected}
                  title={open ? t.name : `Reach ${t.unlockAt} to unlock`}
                  className={cn(
                    'shrink-0 rounded-[var(--shape-chip)] px-3 py-1.5 text-xs font-medium border inline-flex items-center gap-1',
                    colors.panelBorder,
                    !selected && cn(colors.panelBg, colors.textMain),
                    !open && 'opacity-45',
                  )}
                  style={selected ? { background: 'var(--aerie-selected-fill)', color: '#ffffff', borderColor: accent } : undefined}
                >
                  {!open && <Lock size={10} />}
                  {open ? t.name : t.unlockAt}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function drawTrail(ctx: CanvasRenderingContext2D, g: { history: number[]; trail: TrailId; frames: number; level: number; phase: Phase }, p: Paint) {
  const h = g.history;
  if (h.length < 2 || g.phase === 'over') return;
  const spacing = g.phase === 'playing' ? difficultyFor(g.level).speed : 1.2;
  const xAt = (i: number) => GLIDER_X - 10 - i * spacing;

  switch (g.trail) {
    case 'spark':
      ctx.fillStyle = p.glow;
      for (let i = 0; i < Math.min(h.length, 18); i += 3) {
        ctx.globalAlpha = 0.5 * (1 - i / 18);
        ctx.beginPath();
        ctx.arc(xAt(i), h[i], 3 * (1 - i / 22), 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'comet':
      ctx.lineCap = 'round';
      for (let i = 1; i < Math.min(h.length, 30); i++) {
        const t = 1 - i / 30;
        ctx.globalAlpha = 0.7 * t;
        ctx.strokeStyle = p.glow;
        ctx.lineWidth = 6 * t;
        ctx.beginPath();
        ctx.moveTo(xAt(i - 1), h[i - 1]);
        ctx.lineTo(xAt(i), h[i]);
        ctx.stroke();
      }
      break;
    case 'ribbon':
      ctx.lineCap = 'round';
      for (const [color, phase] of [[p.primary, 0], [p.secondary, Math.PI]] as const) {
        ctx.strokeStyle = color;
        for (let i = 1; i < Math.min(h.length, 34); i++) {
          const t = 1 - i / 34;
          const wave = (k: number) => Math.sin(g.frames / 6 + k * 0.45 + phase) * 4 * (1 - k / 40);
          ctx.globalAlpha = 0.75 * t;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(xAt(i - 1), h[i - 1] + wave(i - 1));
          ctx.lineTo(xAt(i), h[i] + wave(i));
          ctx.stroke();
        }
      }
      break;
    case 'aurora': {
      const bands = [p.glow, p.spark, p.primary, p.secondary];
      ctx.lineCap = 'round';
      for (let i = 1; i < Math.min(h.length, 40); i++) {
        const t = 1 - i / 40;
        ctx.globalAlpha = 0.28 * t;
        ctx.strokeStyle = bands[Math.floor((i + g.frames / 4) / 6) % bands.length];
        ctx.lineWidth = 14 * t + 2;
        ctx.beginPath();
        ctx.moveTo(xAt(i - 1), h[i - 1]);
        ctx.lineTo(xAt(i), h[i]);
        ctx.stroke();
      }
      break;
    }
    case 'prism':
      ctx.lineCap = 'round';
      for (let i = 1; i < Math.min(h.length, 36); i++) {
        const t = 1 - i / 36;
        ctx.globalAlpha = 0.8 * t;
        ctx.strokeStyle = `hsl(${(g.frames * 3 + i * 10) % 360}, 90%, ${p.light ? 50 : 66}%)`;
        ctx.lineWidth = 5 * t + 1;
        ctx.beginPath();
        ctx.moveTo(xAt(i - 1), h[i - 1]);
        ctx.lineTo(xAt(i), h[i]);
        ctx.stroke();
      }
      break;
  }
  ctx.globalAlpha = 1;
}
