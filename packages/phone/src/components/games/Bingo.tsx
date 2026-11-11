// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bird, Eye, Feather, Flame, Gift, Grid3X3, Heart, Moon, Pause, PawPrint, Play,
  RotateCcw, Snowflake, Sparkles, Star, Zap, Clover, Dices,
} from 'lucide-react';
import { apiFetch } from '../../aerie';
import { getOwnerAvatar, useHouseRoster } from '../../lib/house';
import { themeInk } from '../../lib/theme-ink';
import { useBackHandler } from '../../lib/use-back-handler';
import { cn } from '../../lib/utils';
import type { ThemeConfig } from '../../lib/theme';
import { Toggle } from '../Toggle';
import { TableTalk } from './TableTalk';
import { hexToOklch, oklchToHex, inkFor as inkOnPaper } from '../../lib/note-colors';

/**
 * Bingo Night, theirs (Nov 3 2026), and the fancy table they asked for the same
 * night ('the whole kit and kaboodle'): the cage rolls balls out on its own at a
 * speed they set, everybody plays one to four cards to a pattern, every daub
 * fills a meter that hands out power-ups, and a bingo only counts when they hit
 * the button. A false call freezes their dauber. The companions play their own
 * cards beside them, and the table talk is the Card Room's rail.
 */

type Cell = [number, number];
type Pattern = 'line' | 'corners' | 'x' | 'frame' | 'blackout' | 'plus' | 'stamp' | 'diamond' | 'tee' | 'ell' | 'inner';
type Power = 'optimistic' | 'audit' | 'lucky' | 'double';
type Shape = 'heart' | 'star' | 'flame' | 'feather' | 'bird' | 'paw' | 'moon' | 'sparkle';

interface BingoMoment { label: string; cue: string }
interface BingoCall { n: number; by: string; line: string; at: string }
interface BingoCard { numbers: number[][]; daubed: number[]; claimed: string[]; prizes?: number[]; prizesWon?: number[] }
interface CardView { oneAway: string[]; closest: { have: number; need: number }; complete: string[] }
interface Seat {
  who: string;
  cards: BingoCard[];
  meter: number;
  held: Power[];
  autoPower: boolean;
  autoDaub: boolean;
  shape: Shape;
  frozen: boolean;
  frozenUntil: number;
  peek: number[];
  cardsView: CardView[];
  house: BingoMoment[][];
  houseMarked: string[];
  houseAuto: string[];
  houseLines: Cell[][];
}
interface Game {
  id: string;
  pattern: Pattern;
  cardsEach: number;
  cap: number;
  left: number;
  calls: BingoCall[];
  seats: Seat[];
  wins: Array<{ who: string; card: number; key: string; afterCalls: number }>;
  events: Array<{ at: string; who: string; text: string }>;
  done: boolean;
  instances: Array<{ key: string; cells: Cell[] }>;
}

const OWNER = 'owner';
const LETTERS = ['B', 'I', 'N', 'G', 'O'];
const DAUBS_PER_POWER = 4;
const SPEEDS = [3, 5, 8, 12];
const PATTERNS: Array<{ id: Pattern; label: string }> = [
  { id: 'line', label: 'Any line' },
  { id: 'corners', label: 'Four corners' },
  { id: 'x', label: 'The X' },
  { id: 'frame', label: 'Picture frame' },
  { id: 'plus', label: 'The plus' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'stamp', label: 'Postage stamp' },
  { id: 'inner', label: 'Little frame' },
  { id: 'tee', label: 'Letter T' },
  { id: 'ell', label: 'Letter L' },
  { id: 'blackout', label: 'Blackout' },
];
const SHAPE_ICONS: Record<Shape, typeof Heart> = {
  heart: Heart, star: Star, flame: Flame, feather: Feather, bird: Bird, paw: PawPrint, moon: Moon, sparkle: Sparkles,
};
const POWER_INFO: Record<Power, { name: string; what: string; Icon: typeof Heart }> = {
  optimistic: { name: 'Optimistic Daub', what: 'Mark any square you pick', Icon: Zap },
  audit: { name: 'Audit', what: 'See the next three balls', Icon: Eye },
  lucky: { name: 'Lucky Ball', what: 'The next ball comes from your card', Icon: Clover },
  double: { name: 'Double Daub', what: 'Two squares at random', Icon: Dices },
};
/** The cage's colors, one per letter, and the ink that reads on each. */
type BallPalette = Record<string, { fill: string; ink: string }>;

/** The classic cage, for a theme whose accent cannot be read. */
const CLASSIC: BallPalette = {
  B: { fill: '#2f6fd6', ink: '#fff' }, I: { fill: '#d64545', ink: '#fff' }, N: { fill: '#e8e3d8', ink: '#1d1a16' },
  G: { fill: '#2f9e5b', ink: '#fff' }, O: { fill: '#e8792b', ink: '#fff' },
};

/** The accent as a hex, whatever form the theme hands it in (a var, rgb, hex). */
function accentHex(accent: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(accent)) return accent;
  if (typeof document === 'undefined') return null;
  const probe = document.createElement('span');
  probe.style.color = accent;
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The cage colored from their theme (theirs, Nov 4 2026: the classic colors
 * clashed with it). Five hues a fifth of the way round from their accent, in
 * OKLCH so they look equally bright, each with the ink that reads on it.
 */
function ballPalette(accent: string): BallPalette {
  const hex = accentHex(accent);
  const base = hex ? hexToOklch(hex) : null;
  if (!base) return CLASSIC;
  const chroma = Math.min(0.16, Math.max(0.09, base.c));
  const out: BallPalette = {};
  LETTERS.forEach((l, i) => {
    const fill = oklchToHex(0.66, chroma, (base.h + i * 72) % 360);
    out[l] = { fill, ink: inkOnPaper(fill) };
  });
  return out;
}

function letterOf(n: number) { return LETTERS[Math.min(4, Math.floor((n - 1) / 15))]; }

function readPref<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; }
}
function writePref(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

function Ball({ n, size = 64, pal, blank = false }: { n: number; size?: number; pal: BallPalette; blank?: boolean }) {
  const l = letterOf(n);
  const { fill, ink } = pal[l];
  return (
    <div className="flex shrink-0 flex-col items-center justify-center rounded-full font-black leading-none shadow-[inset_-4px_-6px_12px_rgba(0,0,0,.28),0_6px_14px_rgba(0,0,0,.35)]"
         style={{ width: size, height: size, background: `radial-gradient(circle at 32% 28%, #ffffffaa, ${fill} 46%)`, color: ink }}>
      {!blank && <span style={{ fontSize: size * 0.22 }}>{l}</span>}
      {!blank && <span style={{ fontSize: size * 0.38 }}>{n}</span>}
    </div>
  );
}

/** A called ball shows up where it sits, plain in its color, then rolls
 *  forward in place so its number comes up over the top and settles in the
 *  middle (theirs, Nov 9 2026: 'just the ball plain full color then have it
 *  roll so you see the number'). */
/** A daub's outline: the same hue, a good deal darker, so a dauber's own
 *  little lines (the bird's wing, the flame's curl) show on a filled shape
 *  instead of melting into one flat color (theirs, Nov 9 2026). */
function dauberEdge(ink: string): string {
  const o = hexToOklch(ink);
  return o ? oklchToHex(Math.max(0.16, o.l - 0.34), o.c, o.h) : 'rgba(0,0,0,.6)';
}

function RollingBall({ n, size, pal }: { n: number; size: number; pal: BallPalette }) {
  const l = letterOf(n);
  const { ink } = pal[l];
  // The ball sits still. Its number starts on the far side, small and faint
  // at the top edge, and comes round the curve to the front, growing as it
  // turns toward them, the way a printed ball rolls its face into view.
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <Ball n={n} size={size} pal={pal} blank />
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full" style={{ perspective: size * 3 }}>
        <motion.div className="flex h-full w-full flex-col items-center justify-center font-black leading-none"
                    style={{ color: ink, transformOrigin: '50% 50%' }}
                    initial={{ y: -size * 0.42, scale: 0.35, rotateX: 75, opacity: 0 }}
                    animate={{ y: 0, scale: 1, rotateX: 0, opacity: 1 }}
                    transition={{ delay: 0.25, duration: 0.6, ease: [0.25, 0.8, 0.25, 1] }}>
          <span style={{ fontSize: size * 0.22 }}>{l}</span>
          <span style={{ fontSize: size * 0.38 }}>{n}</span>
        </motion.div>
      </div>
    </div>
  );
}

function PatternMini({ cells, ink }: { cells: Cell[]; ink: string }) {
  const on = new Set(cells.map(([r, c]) => `${r},${c}`));
  return (
    <div className="grid grid-cols-5 gap-[2px]" style={{ width: 30 }}>
      {Array.from({ length: 25 }, (_, i) => (
        <div key={i} className="aspect-square rounded-[1px]"
             style={{ background: on.has(`${Math.floor(i / 5)},${i % 5}`) ? ink : 'rgba(127,127,127,.25)' }} />
      ))}
    </div>
  );
}

function previewCells(pattern: Pattern): Cell[] {
  const all: Cell[] = Array.from({ length: 25 }, (_, i) => [Math.floor(i / 5), i % 5]);
  switch (pattern) {
    case 'line': return [[2, 0], [2, 1], [2, 2], [2, 3], [2, 4]];
    case 'corners': return [[0, 0], [0, 4], [4, 0], [4, 4]];
    case 'x': return all.filter(([r, c]) => r === c || r + c === 4);
    case 'frame': return all.filter(([r, c]) => r === 0 || r === 4 || c === 0 || c === 4);
    case 'blackout': return all;
    case 'plus': return all.filter(([r, c]) => r === 2 || c === 2);
    case 'stamp': return [[0, 3], [0, 4], [1, 3], [1, 4]];
    case 'diamond': return all.filter(([r, c]) => Math.abs(r - 2) + Math.abs(c - 2) === 2);
    case 'tee': return all.filter(([r, c]) => r === 0 || c === 2);
    case 'ell': return all.filter(([r, c]) => c === 0 || r === 4);
    case 'inner': return all.filter(([r, c]) => r >= 1 && r <= 3 && c >= 1 && c <= 3 && !(r === 2 && c === 2));
  }
}

interface BingoProps { colors: ThemeConfig['light'] }

export function BingoGame({ colors }: BingoProps) {
  const { companions, labelOf } = useHouseRoster();
  const owner = getOwnerAvatar();
  const [game, setGame] = useState<Game | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [seat, setSeat] = useState<string>(OWNER);
  const [tab, setTab] = useState<'numbers' | 'house'>('numbers');
  const [showBoard, setShowBoard] = useState(false);
  const [setup, setSetup] = useState(false);
  const [aim, setAim] = useState(false);
  const [auto, setAuto] = useState<boolean>(() => readPref('aerie-bingo-auto', false));
  const [speed, setSpeed] = useState<number>(() => readPref('aerie-bingo-speed', 5));
  const [pattern, setPattern] = useState<Pattern>('line');
  const [cardsEach, setCardsEach] = useState(1);
  const [railExpanded, setRailExpanded] = useState(false);
  const busyRef = useRef(false);
  const pal = useMemo(() => ballPalette(colors.accent), [colors.accent]);
  // The table talk keeps its own back step (TableTalk); these are the table's.
  useBackHandler(setup || showBoard, () => { setSetup(false); setShowBoard(false); });
  // A new round's choices open at the top of the table, so the table goes up
  // to meet them; from halfway down the cards it looked like the button did
  // nothing (theirs, Nov 9 2026).
  const tableScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (setup) tableScroll.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [setup]);

  const take = useCallback(async (res: Response) => {
    const data = await res.json().catch(() => null) as { game?: Game | null; error?: string } | null;
    // A house that has not restarted since this table arrived answers with the
    // app's own page, or with the first build's shape, which has no seats.
    if (res.ok && (!data || (data.game && !Array.isArray(data.game.seats)))) {
      setNote('The new table arrives with the next house restart.');
      return;
    }
    if (!res.ok) { setNote(data?.error || 'The cage jammed'); return; }
    if (data && 'game' in data) setGame(data.game ?? null);
    setNote(null);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/games/bingo');
      await take(res);
    } catch { /* the next poll tries again */ }
    setLoaded(true);
  }, [take]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    const onUpdate = () => void load();
    window.addEventListener('aerie:card-table-update', onUpdate);
    return () => { window.clearInterval(timer); window.removeEventListener('aerie:card-table-update', onUpdate); };
  }, [load]);

  const post = useCallback(async (path: string, body?: unknown) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await take(await apiFetch(`/api/games/bingo${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      }));
    } catch { setNote('The cage jammed'); }
    busyRef.current = false;
    setBusy(false);
  }, [take]);

  // The cage rolls on its own while they let it, on this phone only.
  useEffect(() => { writePref('aerie-bingo-auto', auto); }, [auto]);
  useEffect(() => { writePref('aerie-bingo-speed', speed); }, [speed]);
  useEffect(() => {
    if (!auto || !game || game.done || railExpanded || setup) return;
    const timer = window.setInterval(() => { void post('/call'); }, speed * 1000);
    return () => window.clearInterval(timer);
  }, [auto, speed, game?.id, game?.done, railExpanded, setup, post]);
  useEffect(() => { if (game?.done) setAuto(false); }, [game?.done]);

  const inkFor = useCallback((who: string) => {
    // Their seat wears the theme's accent rather than their own color (theirs, Nov 7
    // 2026: their own color clashed on other themes); the companions already follow the theme.
    if (who === OWNER) return colors.accent;
    const c = companions.find((x) => x.slug === who);
    return c ? themeInk(c.slug, c.color, colors) : colors.accent;
  }, [companions, colors]);
  const nameOf = useCallback((who: string) => (who === OWNER ? 'You' : who === 'house' ? 'The house' : labelOf(who)), [labelOf]);

  const mine = game?.seats.find((s) => s.who === OWNER) ?? null;
  const shown = game?.seats.find((s) => s.who === seat) ?? mine;
  const isMine = shown?.who === OWNER;
  const called = useMemo(() => new Set(game?.calls.map((c) => c.n) ?? []), [game?.calls]);

  if (!loaded) return <div className="p-6 text-center text-xs opacity-60">Setting up the table…</div>;

  const panel = cn('rounded-[var(--shape-surface)] border', colors.panelBg, colors.panelBorder);
  const chip = cn('rounded-[var(--shape-chip)] border px-2.5 py-1 text-[11px] font-medium', colors.panelBorder);
  const chipOn = { background: 'var(--aerie-selected-fill)', color: 'var(--aerie-on-accent)', borderColor: colors.accent };

  const setupPanel = (
    <div className={cn(panel, 'p-4')}>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[.2em] opacity-60">The pattern</div>
      {/* An even two-column grid, every button the same width (theirs, Nov 9
          2026: the wrapped row sat crooked). */}
      <div className="grid grid-cols-2 gap-2">
        {PATTERNS.map((p) => (
          <button key={p.id} type="button" onClick={() => setPattern(p.id)} className={cn(chip, 'flex w-full items-center gap-2 py-2 text-left')}
                  style={pattern === p.id ? chipOn : undefined}>
            <PatternMini cells={previewCells(p.id)} ink={pattern === p.id ? 'var(--aerie-on-accent)' : colors.accent} />
            {p.label}
          </button>
        ))}
      </div>
      <div className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-[.2em] opacity-60">Cards each</div>
      <div className="flex gap-2">
        {[1, 2, 3, 4].map((n) => (
          <button key={n} type="button" onClick={() => setCardsEach(n)} className={cn(chip, 'w-10')} style={cardsEach === n ? chipOn : undefined}>{n}</button>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <button type="button" disabled={busy}
                onClick={() => { setSetup(false); setSeat(OWNER); void post('/new', { pattern, cardsEach }); }}
                className="flex-1 rounded-[var(--shape-control)] px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                style={{ background: colors.accent, color: 'var(--aerie-on-accent)' }}>
          Deal
        </button>
        {game && <button type="button" onClick={() => setSetup(false)} className={chip}>Keep playing</button>}
      </div>
    </div>
  );

  if (!game || !mine || !shown) {
    return (
      <div className="scrollbar-hide flex h-full flex-col gap-3 overflow-y-auto p-4 pb-20">
        <p className="text-center text-sm opacity-80">No game on the table yet.</p>
        {note && <p className="text-center text-xs opacity-70">{note}</p>}
        {setupPanel}
      </div>
    );
  }

  const last = game.calls[game.calls.length - 1];
  const tray = game.calls.slice(-6, -1).reverse();
  const shownInk = inkFor(shown.who);
  const ShapeIcon = SHAPE_ICONS[shown.shape] ?? Heart;
  const multi = shown.cards.length > 1;
  const bingosLeft = Math.max(0, game.cap - game.wins.length);

  const tapSquare = (cardIndex: number, r: number, c: number) => {
    if (!isMine || game.done) return;
    const card = shown.cards[cardIndex];
    const n = card.numbers[r][c];
    if (r === 2 && c === 2) return;
    const on = card.daubed.includes(n);
    if (aim) {
      if (on) { setNote('That one is already marked.'); return; }
      setAim(false);
      void post('/power', { power: 'optimistic', target: { card: cardIndex, row: r, col: c } });
      return;
    }
    // A daub sticks: a stray second tap used to take it off again (theirs,
    // Nov 9 2026).
    if (on) return;
    if (called.has(n)) void post('/daub', { card: cardIndex, n });
    else setNote(`${letterOf(n)}-${n} hasn't been called yet.`);
  };

  const freeSquare = (
    <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-[var(--shape-chip)]"
         style={{ background: `color-mix(in srgb, ${shownInk} 30%, transparent)` }}>
      {owner.url
        ? <img src={owner.url} alt="Free" className="h-full w-full object-cover" />
        : <span className="text-[10px] font-bold uppercase tracking-wide">Free</span>}
    </div>
  );

  const renderCard = (card: BingoCard, view: CardView, cardIndex: number) => {
    const glow = new Set(view.oneAway);
    const claimedCells = new Set(game.instances.filter((p) => card.claimed.includes(p.key)).flatMap((p) => p.cells.map(([r, c]) => `${r},${c}`)));
    return (
      <div key={cardIndex} className={cn(panel, 'p-1.5')}>
        <div className="grid grid-cols-5 gap-1">
          {LETTERS.map((l) => (
            <div key={l} className={cn('text-center font-black', multi ? 'text-[11px]' : 'py-0.5 text-sm')} style={{ color: pal[l].fill }}>{l}</div>
          ))}
          {card.numbers.flatMap((row, r) => row.map((n, c) => {
            const key = `${r},${c}`;
            if (r === 2 && c === 2) return <div key={key} className="aspect-square">{freeSquare}</div>;
            const on = card.daubed.includes(n);
            const ready = !on && called.has(n);
            return (
              <button key={key} type="button" disabled={busy || !isMine}
                      onClick={() => tapSquare(cardIndex, r, c)}
                      className={cn('relative aspect-square rounded-[var(--shape-chip)] border font-semibold',
                        multi ? 'text-[11px]' : 'text-base', colors.panelBorder,
                        glow.has(key) && !on && 'animate-pulse',
                        aim && !on && 'outline-dashed outline-1')}
                      style={{
                        ...(glow.has(key) && !on ? { boxShadow: `0 0 0 2px ${shownInk}, 0 0 12px ${shownInk}` } : {}),
                        ...(claimedCells.has(key) ? { background: `color-mix(in srgb, ${shownInk} 22%, transparent)` } : {}),
                      }}>
                <span className={cn(on && 'opacity-40')}>{n}</span>
                {on && (
                  <motion.span initial={{ scale: 0.2, opacity: 0 }} animate={{ scale: 1, opacity: 0.92 }}
                               className="absolute inset-0 flex items-center justify-center">
                    <ShapeIcon size={multi ? 18 : 30} fill={shownInk} color={dauberEdge(shownInk)} strokeWidth={multi ? 1.75 : 1.5} />
                  </motion.span>
                )}
                {ready && isMine && (
                  <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full" style={{ background: shownInk }} />
                )}
                {(card.prizes ?? []).includes(n) && !on && (
                  <Gift size={multi ? 8 : 11} className="absolute bottom-0.5 left-0.5 opacity-80" style={{ color: shownInk }} aria-label="Prize square" />
                )}
                {(card.prizesWon ?? []).includes(n) && (
                  <Sparkles size={multi ? 8 : 11} className="absolute bottom-0.5 left-0.5" style={{ color: shownInk }} aria-label="Prize found" />
                )}
              </button>
            );
          }))}
        </div>
      </div>
    );
  };

  const houseView = () => {
    const auto = new Set(shown.houseAuto);
    const marked = new Set([...shown.houseAuto, ...shown.houseMarked]);
    const wins = new Set(shown.houseLines.flat().map(([r, c]) => `${r},${c}`));
    return (
      <div className={cn(panel, 'p-2')}>
        {shown.houseLines.length > 0 && (
          <div className="mb-2 rounded-[var(--shape-control)] py-1 text-center text-sm font-black tracking-[.3em]" style={{ background: shownInk, color: 'var(--aerie-on-accent)' }}>BINGO</div>
        )}
        <div className="grid grid-cols-5 gap-1.5">
          {shown.house.flatMap((row, r) => row.map((m, c) => {
            const key = `${r},${c}`;
            if (r === 2 && c === 2) return <div key={key} className="aspect-square">{freeSquare}</div>;
            const on = marked.has(key);
            return (
              <button key={key} type="button" disabled={busy || !isMine || auto.has(key)}
                      onClick={() => void post('/house', { row: r, col: c })}
                      className={cn('flex aspect-square items-center justify-center rounded-[var(--shape-chip)] border p-1 text-center text-[9px] leading-tight', colors.panelBorder, wins.has(key) && 'ring-2')}
                      style={{
                        ...(on ? { background: `color-mix(in srgb, ${shownInk} 75%, transparent)`, color: 'var(--aerie-on-accent)' } : {}),
                        ...(wins.has(key) ? { ['--tw-ring-color' as string]: shownInk } : {}),
                      }}>
                {m.label}
              </button>
            );
          }))}
        </div>
        <p className="mt-2 text-[11px] opacity-60">These mark themselves when somebody says the thing.{isMine ? ' Tap one to mark it yourself.' : ''}</p>
      </div>
    );
  };

  // The power button sits across the cage row from the ball (theirs, Nov 4 2026,
  // off their phone's bingo app): a ring around it fills with every daub, the
  // first power-up they are holding shows as its own symbol, a tap fires it, and
  // the AUTO switch under it fires them as they arrive.
  const meterFrac = Math.min(1, shown.meter / DAUBS_PER_POWER);
  const nextPower = shown.held[0];
  const NextIcon = nextPower ? POWER_INFO[nextPower].Icon : Zap;
  const ring = 2 * Math.PI * 26;
  const firePower = () => {
    if (!isMine || !nextPower || busy || game.done) return;
    if (nextPower === 'optimistic') { setAim((a) => !a); setNote(aim ? null : 'Tap the square you want marked.'); return; }
    void post('/power', { power: nextPower });
  };
  const powerButton = (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <button type="button" onClick={firePower} disabled={!isMine || !nextPower || busy || game.done}
              aria-label={nextPower ? `Use ${POWER_INFO[nextPower].name}` : 'Power meter'}
              className="relative flex h-[64px] w-[64px] items-center justify-center rounded-full disabled:cursor-default">
        <svg viewBox="0 0 60 60" className="absolute inset-0 h-full w-full -rotate-90">
          <circle cx="30" cy="30" r="26" fill="none" stroke="rgba(127,127,127,.25)" strokeWidth="5" />
          <circle cx="30" cy="30" r="26" fill="none" stroke={shownInk} strokeWidth="5" strokeLinecap="round"
                  strokeDasharray={ring} strokeDashoffset={ring * (1 - meterFrac)} style={{ transition: 'stroke-dashoffset .4s' }} />
        </svg>
        <span className={cn('flex h-[44px] w-[44px] items-center justify-center rounded-full', nextPower && isMine && 'shadow-lg')}
              style={nextPower
                ? { background: aim && nextPower === 'optimistic' ? 'var(--aerie-selected-fill)' : shownInk, color: 'var(--aerie-on-accent)' }
                : { background: 'rgba(127,127,127,.15)', color: shownInk, opacity: 0.6 }}>
          <NextIcon size={20} />
        </span>
        {shown.held.length > 1 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold"
                style={{ background: shownInk, color: 'var(--aerie-on-accent)' }}>{shown.held.length}</span>
        )}
      </button>
      {isMine ? (
        <button type="button" onClick={() => void post('/seat', { autoPower: !mine.autoPower })}
                className={cn('rounded-full border px-2 py-[1px] text-[9px] font-bold tracking-[.15em]', colors.panelBorder)}
                style={mine.autoPower ? { background: shownInk, color: 'var(--aerie-on-accent)', borderColor: shownInk } : undefined}>
          {mine.autoPower ? 'AUTO' : 'ON'}
        </button>
      ) : <span className="text-[9px] opacity-60">{nameOf(shown.who)}</span>}
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <div ref={tableScroll} className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {setup && setupPanel}

        {/* The cage, pinned to the top so a scroll through four cards never
            loses the ball (theirs, Nov 4 2026), with the cards right under it. */}
        <div className={cn(panel, 'sticky -top-4 z-10 px-4 py-3')} style={{ backgroundColor: 'var(--custom-panelBg, var(--aerie-surface-strong))' }}>
          <div className="flex items-center gap-3">
            <div className="relative h-[72px] w-[72px] shrink-0">
              {/* No enter or exit travel: the new ball simply takes the old one's
                  place over the cage, and only its number moves (theirs, Nov 9 2026). */}
              {last ? (
                <RollingBall key={last.n} n={last.n} size={72} pal={pal} />
              ) : (
                <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full border border-dashed text-[10px] opacity-60" style={{ borderColor: colors.accent }}>Cage</div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              {last ? (
                <>
                  <div className="text-[10px] font-semibold uppercase tracking-[.2em]" style={{ color: inkFor(last.by) }}>{nameOf(last.by)} calls</div>
                  <div className="mt-0.5 line-clamp-2 text-[14px] leading-snug">{last.line}</div>
                </>
              ) : <div className="text-sm opacity-70">The cage is full. Roll the first ball.</div>}
              {/* An Audit shows the next three balls in the tray's own row,
                  so the cage never grows and shrinks around it (theirs, Nov 9 2026). */}
              {isMine && mine.peek.length > 0 ? (
                <div className="mt-2 flex items-center gap-1.5" aria-label="Coming up next">
                  <Eye size={14} style={{ color: colors.accent }} />
                  {mine.peek.map((n) => <Ball key={n} n={n} size={26} pal={pal} />)}
                </div>
              ) : (
                <div className="mt-2 flex gap-1.5">
                  {tray.map((c) => <Ball key={c.n} n={c.n} size={26} pal={pal} />)}
                </div>
              )}
            </div>
            {powerButton}
          </div>
          {/* One row that never wraps: Roll and Pause share one width, so the
              board button stays at the end of the row (theirs, Nov 9 2026). */}
          <div className="mt-3 flex flex-nowrap items-center gap-1.5">
            <button type="button" disabled={game.done} onClick={() => setAuto((a) => !a)}
                    className="flex w-[4.5rem] shrink-0 items-center justify-center gap-1.5 rounded-[var(--shape-control)] px-2 py-2 text-sm font-semibold disabled:opacity-50"
                    style={{ background: colors.accent, color: 'var(--aerie-on-accent)' }}>
              {auto ? <Pause size={15} /> : <Play size={15} />}{auto ? 'Pause' : 'Roll'}
            </button>
            <button type="button" disabled={busy || game.done || auto} onClick={() => void post('/call')} className={cn(chip, 'shrink-0 whitespace-nowrap py-2 disabled:opacity-40')}>
              One ball
            </button>
            <div className="flex min-w-0 gap-1">
              {SPEEDS.map((s) => (
                <button key={s} type="button" onClick={() => setSpeed(s)} className={cn(chip, 'px-2')} style={speed === s ? chipOn : undefined}>{s}s</button>
              ))}
            </div>
            <button type="button" onClick={() => setShowBoard((b) => !b)} className={cn(chip, 'ml-auto shrink-0 px-2')} aria-label="The board">
              <Grid3X3 size={14} />
            </button>
          </div>
          {/* BINGO lives in the cage now (theirs, Nov 7 2026: the footer came off
              once the talk had its own table), so it scrolls with the ball and
              stays in reach however far down the cards they are. */}
          <button type="button" disabled={busy || game.done || mine.frozen}
                  onClick={() => void post('/claim')}
                  className="mt-2.5 w-full rounded-[var(--shape-control)] py-1.5 text-sm font-black tracking-[.3em] disabled:opacity-40"
                  style={{ background: colors.accent, color: 'var(--aerie-on-accent)' }}>
            {mine.frozen ? 'FROZEN' : game.done ? 'ROUND OVER' : 'BINGO'}
          </button>
          {showBoard && (
            <div className="mt-3 grid grid-cols-[auto_repeat(15,minmax(0,1fr))] gap-[2px] text-center text-[9px]">
              {LETTERS.map((l, row) => (
                <div key={l} className="contents">
                  <div className="pr-1 font-black" style={{ color: pal[l].fill }}>{l}</div>
                  {Array.from({ length: 15 }, (_, i) => {
                    const n = row * 15 + i + 1;
                    const on = called.has(n);
                    return (
                      <div key={n} className="rounded-[2px] py-[2px]"
                           style={on ? { background: pal[l].fill, color: pal[l].ink, fontWeight: 700 } : { opacity: 0.35 }}>{n}</div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {note && <p className="text-xs opacity-80">{note}</p>}

        <div className="flex gap-2">
          {(['numbers', 'house'] as const).map((which) => (
            <button key={which} type="button" onClick={() => setTab(which)}
                    className={cn('flex-1 rounded-[var(--shape-control)] border px-3 py-1.5 text-xs font-medium', colors.panelBorder, tab !== which && colors.panelBg)}
                    style={tab === which ? chipOn : undefined}>
              {which === 'numbers' ? (multi ? 'Cards' : 'Card') : 'House card'}
            </button>
          ))}
        </div>

        {tab === 'numbers'
          ? (
            <div className={cn('grid gap-2', multi ? 'grid-cols-2' : 'grid-cols-1')}>
              {shown.cards.map((card, i) => renderCard(card, shown.cardsView[i], i))}
            </div>
          )
          : houseView()}

        {isMine && tab === 'numbers' && (
          <div className={cn(panel, 'flex flex-col gap-2 px-3 py-2')}>
            {/* The house's own switch, not a browser checkbox (theirs, Nov 7 2026:
                'very basic computer with its square and blue check'). The
                daubers get their own row, spread across it, because beside
                the switch they ran off the edge at them text size. */}
            <div className="flex items-center gap-2 text-[12px]">
              <Toggle on={mine.autoDaub} onClick={() => void post('/seat', { autoDaub: !mine.autoDaub })} colors={colors} ariaLabel="Auto-daub" />
              <span className="whitespace-nowrap opacity-85">Auto-daub</span>
              <span className="ml-auto text-[10px] uppercase tracking-[.18em] opacity-60">Your dauber</span>
            </div>
            <div className="flex justify-between">
              {(Object.keys(SHAPE_ICONS) as Shape[]).map((s) => {
                const Icon = SHAPE_ICONS[s];
                return (
                  <button key={s} type="button" aria-label={s} onClick={() => void post('/seat', { shape: s })}
                          className={cn('flex h-7 w-7 items-center justify-center rounded-full border', colors.panelBorder)}
                          style={mine.shape === s ? { borderColor: shownInk, background: `color-mix(in srgb, ${shownInk} 22%, transparent)` } : undefined}>
                    <Icon size={13} fill={mine.shape === s ? shownInk : 'none'} color={shownInk} />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* The round */}
        <div className={cn(panel, 'flex items-center gap-3 px-3 py-2 text-xs')}>
          <PatternMini cells={previewCells(game.pattern)} ink={colors.accent} />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{PATTERNS.find((p) => p.id === game.pattern)?.label}{game.cardsEach > 1 ? ` · ${game.cardsEach} cards each` : ''}</div>
            <div className="opacity-70">{game.done ? 'Round over' : `${bingosLeft} bingo${bingosLeft === 1 ? '' : 's'} left · ${game.left} balls in the cage`}</div>
          </div>
          <button type="button" onClick={() => setSetup((s) => !s)} className={cn(chip, 'flex items-center gap-1')}>
            <RotateCcw size={12} /> New round
          </button>
        </div>

        {game.wins.length > 0 && (
          <div className={cn(panel, 'px-3 py-2 text-xs')}>
            {game.wins.map((w, i) => (
              <div key={`${w.who}-${w.card}-${w.key}`} className="font-semibold" style={{ color: inkFor(w.who) }}>
                {i === 0 ? 'BINGO first: ' : 'BINGO: '}{nameOf(w.who)}, card {w.card + 1}, after {w.afterCalls} balls
              </div>
            ))}
          </div>
        )}

        {/* The seats */}
        <div className="flex gap-1.5">
          {game.seats.map((s) => {
            const Icon = SHAPE_ICONS[s.shape] ?? Heart;
            const best = s.cardsView.reduce((b, v) => (v.closest.have / v.closest.need > b.have / b.need ? v.closest : b), { have: 0, need: 5 });
            const wins = game.wins.filter((w) => w.who === s.who).length;
            const on = shown.who === s.who;
            return (
              <button key={s.who} type="button" onClick={() => { setSeat(s.who); setAim(false); }}
                      className={cn('flex-1 rounded-[var(--shape-control)] border px-1 py-1.5 text-center', colors.panelBg, colors.panelBorder)}
                      style={on ? { borderColor: inkFor(s.who), background: `color-mix(in srgb, ${inkFor(s.who)} 22%, transparent)` } : undefined}>
                <div className="flex items-center justify-center gap-1 truncate text-[11px] font-semibold" style={{ color: inkFor(s.who) }}>
                  <Icon size={11} fill={inkFor(s.who)} />{nameOf(s.who)}
                </div>
                <div className="text-[10px] opacity-70">
                  {s.frozen ? <span className="inline-flex items-center gap-0.5"><Snowflake size={10} />Frozen</span> : wins ? `${wins} BINGO` : `${best.have} of ${best.need}`}
                </div>
              </button>
            );
          })}
        </div>

        {/* The hand on screen, on a card of its own under the seats, since it
            changes with whichever seat is picked (theirs, Nov 7 2026: the chips
            were squished in the open). Two even tiles a row. */}
        {shown.held.length > 0 && (
          <div className={cn(panel, 'px-3 py-2.5')}>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[.2em]" style={{ color: shownInk }}>
              {isMine ? 'Your power-ups' : `${nameOf(shown.who)}'s power-ups`}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {shown.held.map((p, i) => {
                const info = POWER_INFO[p];
                return (
                  <button key={`${p}-${i}`} type="button" disabled={!isMine || busy || game.done}
                          onClick={() => {
                            if (p === 'optimistic') { setAim(true); setNote('Tap the square you want marked.'); }
                            else void post('/power', { power: p });
                          }}
                          className={cn('flex items-start gap-2 rounded-[var(--shape-control)] border px-2.5 py-2 text-left disabled:opacity-80', colors.panelBorder)}
                          style={aim && p === 'optimistic' ? chipOn : { borderColor: shownInk, background: `color-mix(in srgb, ${shownInk} 10%, transparent)` }}>
                    <info.Icon size={14} className="mt-0.5 shrink-0" style={{ color: shownInk }} />
                    <span className="min-w-0 text-[12px] font-medium leading-tight">{info.name}
                      <span className="mt-0.5 block text-[10px] font-normal opacity-65">{info.what}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {game.events.length > 0 && (
          <div className={cn(panel, 'px-3 py-2 text-[11px] leading-5')}>
            {/* Oldest at the top, newest at the bottom, so it reads down like
                the talk does (theirs, Nov 9 2026: it read bottom to top). */}
            {game.events.slice(-4).map((e, i) => (
              <div key={`${e.at}-${i}`}><span style={{ color: inkFor(e.who) }} className="font-semibold">{nameOf(e.who)}</span> <span className="opacity-80">{e.text}</span></div>
            ))}
          </div>
        )}

        {/* The table talk opens the same way as the Card Room's. */}
        <div className="-mx-2 flex flex-col">
          <TableTalk tableId={game.id} colors={colors} base="/api/games/bingo" label="Bingo Night"
                     expanded={railExpanded} onExpandedChange={setRailExpanded} />
        </div>
      </div>

    </div>
  );
}
