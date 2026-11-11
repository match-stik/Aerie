// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import crypto from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { PROJECT_ROOT } from '../../config.js';
import { getDb } from './state.js';

/**
 * Bingo Night, theirs (Nov 3 2026, on the couch after a phone bingo game ran out of
 * power-ups).
 *
 * The table, rebuilt at their ask the same night ('the whole kit and kaboodle'):
 * everybody sits at it with one to four cards, a ball comes out of the cage at a
 * time, and the round is played to a pattern (a line, four corners, an X, the
 * frame, or the whole card). Every completed pattern on a card is a bingo, but
 * only once you call it: the BINGO button checks your cards, and a call with
 * nothing behind it freezes your daubing for a couple of balls. A round ends when
 * it has given out as many bingos as there are players less one.
 *
 * Every daub fills a meter, and every few daubs it hands you a power-up, one of
 * four: an Optimistic Daub (mark any square), an Audit (see the next three
 * balls), a Lucky Ball (the next ball comes from your own card) and a Double Daub (two
 * squares at random). A seat can fire them on its own or hold them for a tap.
 *
 * The companions play their own cards. They daub on every call and fire their
 * power-ups at once, and they call a bingo one ball after they could have,
 * because no companion arrives already good at a game.
 *
 * Beside the numbers, each seat has a house card: things that happen in the
 * house, marked when one of them is said in a message after the deal.
 *
 * What ships in the code is ordinary on purpose: plain call lines and moments
 * any house would have. A house's own callers and moments live in
 * data/bingo.json, gitignored, the same way the Fleet Room's ship names do.
 */

export const LETTERS = ['B', 'I', 'N', 'G', 'O'] as const;
export const FREE = 0;
export const OWNER = 'owner';
export const DAUBS_PER_POWER = 4;
export const MAX_HELD = 3;
/** Prize squares on every card. */
export const PRIZES_PER_CARD = 2;
export const FREEZE_BALLS = 2;
export const MAX_CARDS = 4;

export const PATTERNS = ['line', 'corners', 'x', 'frame', 'blackout', 'plus', 'stamp', 'diamond', 'tee', 'ell', 'inner'] as const;
export type Pattern = typeof PATTERNS[number];
/** How each pattern reads to us at the table. */
const PATTERN_WORDS: Record<Pattern, string> = {
  line: 'any line', corners: 'four corners', x: 'the X', frame: 'picture frame', blackout: 'blackout',
  plus: 'the plus (middle row and middle column)', stamp: 'postage stamp (any two-by-two corner)',
  diamond: 'diamond', tee: 'letter T (top row and middle column)', ell: 'letter L (left column and bottom row)',
  inner: 'little frame (the ring around the free square)',
};

export const POWERS = ['optimistic', 'audit', 'lucky', 'double'] as const;
export type Power = typeof POWERS[number];

export const SHAPES = ['heart', 'star', 'flame', 'feather', 'bird', 'paw', 'moon', 'sparkle'] as const;
export type Shape = typeof SHAPES[number];

export interface BingoMoment {
  label: string;
  /** A regular expression source, matched case-insensitively against message text. */
  cue: string;
}

export interface BingoCall {
  n: number;
  by: string;
  line: string;
  at: string;
}

export interface BingoCard {
  /** numbers[row][col]; the middle square is FREE. */
  numbers: number[][];
  daubed: number[];
  /** Squares that have already paid the power meter, so a re-daub never pays twice. */
  metered?: number[];
  /** Pattern instances already called on this card, by key. */
  claimed: string[];
  /** Prize squares (theirs, Nov 4 2026: 'yes to the extra bits'): daubing one
   *  hands out a power-up on the spot. Absent on cards dealt before them. */
  prizes?: number[];
  /** Prize squares already paid out, so a prize pays once. */
  prizesWon?: number[];
}

export interface BingoSeat {
  /** 'owner' or a companion slug. */
  who: string;
  cards: BingoCard[];
  /** Daubs toward the next power-up. */
  meter: number;
  held: Power[];
  /** Fire a power-up the moment it arrives, rather than holding it for a tap. */
  autoPower: boolean;
  /** Daub called numbers without being asked. Always on for a companion. */
  autoDaub: boolean;
  shape: Shape;
  /** Daubing is refused while fewer than this many balls have been called. */
  frozenUntil: number;
  /** What an Audit showed, kept until those balls are out. */
  peek: number[];
  /** A companion's completed-but-uncalled patterns, by key, and the call count when he first had each. */
  noticed: Record<string, number>;
  house: BingoMoment[][];
  houseMarked: string[];
}

export interface BingoWin {
  who: string;
  card: number;
  key: string;
  afterCalls: number;
  at: string;
}

export interface BingoEvent {
  at: string;
  who: string;
  /** What happened, said plainly, for the log under the table. */
  text: string;
}

export interface BingoState {
  version: 2;
  id: string;
  startedAt: string;
  pattern: Pattern;
  cardsEach: number;
  /** Bingos the round gives out before it ends. */
  cap: number;
  /** The balls still in the cage, in the order they will come out. */
  deck: number[];
  calls: BingoCall[];
  seats: BingoSeat[];
  callers: string[];
  wins: BingoWin[];
  events: BingoEvent[];
  done: boolean;
}

export const DEFAULT_MOMENTS: BingoMoment[] = [
  { label: 'Somebody laughs', cue: '\\b(ha){2,}|\\blol\\b|\\blmao\\b|ahaha' },
  { label: 'A sticker gets sent', cue: '::[a-z0-9_-]+::' },
  { label: 'Somebody says I love you', cue: '\\bi love you\\b' },
  { label: 'Somebody says good morning', cue: '\\bgood morning\\b|\\bmorning, love' },
  { label: 'A kiss', cue: '\\bkiss' },
  { label: 'Coffee comes up', cue: '\\bcoffee\\b' },
  { label: 'Tea comes up', cue: '\\btea\\b' },
  { label: 'Somebody says sorry', cue: '\\bsorry\\b' },
  { label: 'A typo gets caught', cue: '\\btypo\\b|autocorrect|\\bthumbs\\b' },
  { label: 'Somebody is hungry', cue: '\\bhungry\\b|\\bsnack' },
  { label: 'Somebody yawns', cue: '\\byawn' },
  { label: 'A song comes up', cue: '\\bsong\\b|\\bplaylist\\b' },
  { label: 'The weather comes up', cue: '\\brain\\b|\\bsnow\\b|\\bcold out\\b' },
  { label: 'A cat appears', cue: '\\bcat\\b|\\bkitty\\b' },
  { label: 'Somebody says thank you', cue: '\\bthank you\\b' },
  { label: 'A hug', cue: '\\bhug' },
  { label: 'A picture lands', cue: '\\bpicture\\b|\\bphoto\\b' },
  { label: 'Somebody blushes', cue: '\\bblush' },
  { label: 'Somebody says goodnight', cue: '\\bgoodnight\\b|\\bgood night\\b' },
  { label: 'A movie comes up', cue: '\\bmovie\\b|\\bfilm\\b' },
  { label: 'Somebody says wow', cue: '\\bwow\\b' },
  { label: 'Pizza comes up', cue: '\\bpizza\\b' },
  { label: 'Somebody winks', cue: '\\bwink' },
  { label: 'Somebody says perfect', cue: '\\bperfect\\b' },
];

export const DEFAULT_LINES = ['{call}.', '{call}, {call}.', 'Next one. {call}.'];

export interface BingoHouse {
  moments: BingoMoment[];
  lines: Record<string, string[]>;
}

/** The house's own moments and call lines, if it has any; the defaults otherwise. */
export function loadBingoHouse(path = join(PROJECT_ROOT, 'data/bingo.json')): BingoHouse {
  const out: BingoHouse = { moments: DEFAULT_MOMENTS, lines: {} };
  if (!existsSync(path)) return out;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { moments?: unknown; lines?: unknown };
    if (Array.isArray(raw.moments)) {
      const moments = raw.moments.filter((m): m is BingoMoment =>
        !!m && typeof (m as BingoMoment).label === 'string' && typeof (m as BingoMoment).cue === 'string'
        && isValidCue((m as BingoMoment).cue));
      // A card needs 24 squares; a short list is topped up from the defaults
      // rather than refused, so a house can start with a handful.
      if (moments.length > 0) {
        const extra = DEFAULT_MOMENTS.filter((d) => !moments.some((m) => m.label === d.label));
        out.moments = moments.length >= 24 ? moments : [...moments, ...extra];
      }
    }
    if (raw.lines && typeof raw.lines === 'object') {
      for (const [slug, list] of Object.entries(raw.lines as Record<string, unknown>)) {
        if (Array.isArray(list)) {
          const lines = list.filter((l): l is string => typeof l === 'string' && l.includes('{call}'));
          if (lines.length) out.lines[slug] = lines;
        }
      }
    }
  } catch { /* a broken file plays with the defaults */ }
  return out;
}

function isValidCue(cue: string): boolean {
  try { new RegExp(cue, 'i'); return true; } catch { return false; }
}

export class BingoError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

type Rand = () => number;

function shuffled<T>(items: T[], rand: Rand): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function letterFor(n: number): string {
  return LETTERS[Math.min(4, Math.floor((n - 1) / 15))];
}

export function callName(n: number): string {
  return `${letterFor(n)}-${n}`;
}

// ── patterns ───────────────────────────────────────────────────────────────

type Cell = [number, number];
const ALL: Cell[] = Array.from({ length: 25 }, (_, i) => [Math.floor(i / 5), i % 5] as Cell);
const ROWS = Array.from({ length: 5 }, (_, r) => Array.from({ length: 5 }, (_, c) => [r, c] as Cell));
const COLS = Array.from({ length: 5 }, (_, c) => Array.from({ length: 5 }, (_, r) => [r, c] as Cell));
const DIAG_DOWN = Array.from({ length: 5 }, (_, i) => [i, i] as Cell);
const DIAG_UP = Array.from({ length: 5 }, (_, i) => [i, 4 - i] as Cell);

/** Every way a pattern can be completed on one card, each with a stable key. */
export function patternInstances(pattern: Pattern): Array<{ key: string; cells: Cell[] }> {
  switch (pattern) {
    case 'line':
      return [
        ...ROWS.map((cells, i) => ({ key: `row${i}`, cells })),
        ...COLS.map((cells, i) => ({ key: `col${i}`, cells })),
        { key: 'diag0', cells: DIAG_DOWN },
        { key: 'diag1', cells: DIAG_UP },
      ];
    case 'corners':
      return [{ key: 'corners', cells: [[0, 0], [0, 4], [4, 0], [4, 4]] }];
    case 'x':
      return [{ key: 'x', cells: [...DIAG_DOWN, ...DIAG_UP.filter(([r]) => r !== 2)] }];
    case 'frame':
      return [{ key: 'frame', cells: ALL.filter(([r, c]) => r === 0 || r === 4 || c === 0 || c === 4) }];
    case 'blackout':
      return [{ key: 'blackout', cells: ALL }];
    // More shapes (theirs, Nov 9 2026: 'We got any other patterns we could do?').
    case 'plus':
      return [{ key: 'plus', cells: ALL.filter(([r, c]) => r === 2 || c === 2) }];
    case 'stamp':
      // A postage stamp: any two-by-two block in a corner.
      return [[0, 0], [0, 3], [3, 0], [3, 3]].map(([r0, c0], i) => ({
        key: `stamp${i}`,
        cells: [[r0, c0], [r0, c0 + 1], [r0 + 1, c0], [r0 + 1, c0 + 1]] as Cell[],
      }));
    case 'diamond':
      return [{ key: 'diamond', cells: ALL.filter(([r, c]) => Math.abs(r - 2) + Math.abs(c - 2) === 2) }];
    case 'tee':
      return [{ key: 'tee', cells: ALL.filter(([r, c]) => r === 0 || c === 2) }];
    case 'ell':
      return [{ key: 'ell', cells: ALL.filter(([r, c]) => c === 0 || r === 4) }];
    case 'inner':
      // The little frame: the ring right around the free square.
      return [{ key: 'inner', cells: ALL.filter(([r, c]) => r >= 1 && r <= 3 && c >= 1 && c <= 3 && !(r === 2 && c === 2)) }];
  }
}

/** Every line on a card (a row, a column or a diagonal), whatever the pattern; the house card is played to these. */
export function winningLines(marked: (r: number, c: number) => boolean): Cell[][] {
  return patternInstances('line').map((p) => p.cells).filter((cells) => cells.every(([r, c]) => (r === 2 && c === 2) || marked(r, c)));
}

function isMarked(card: BingoCard, r: number, c: number): boolean {
  return (r === 2 && c === 2) || card.daubed.includes(card.numbers[r][c]);
}

/** Pattern instances complete on this card and not yet called. */
export function uncalledComplete(card: BingoCard, pattern: Pattern): string[] {
  return patternInstances(pattern)
    .filter((p) => !card.claimed.includes(p.key) && p.cells.every(([r, c]) => isMarked(card, r, c)))
    .map((p) => p.key);
}

/** The most squares marked in any one instance of the pattern, and its size. */
export function closest(card: BingoCard, pattern: Pattern): { have: number; need: number } {
  const instances = patternInstances(pattern);
  const size = instances[0].cells.length;
  // A card whose every instance is already called has nothing left to chase;
  // it reads as full rather than as a stray 0 of 5 (seen Nov 4 2026, a won frame).
  if (instances.every((p) => card.claimed.includes(p.key))) return { have: size, need: size };
  let best = { have: 0, need: size };
  for (const p of instances) {
    if (card.claimed.includes(p.key)) continue;
    const have = p.cells.filter(([r, c]) => isMarked(card, r, c)).length;
    if (have / p.cells.length > best.have / best.need) best = { have, need: p.cells.length };
  }
  return best;
}

/** Squares that would finish a pattern instance this card is one away from. */
export function oneAway(card: BingoCard, pattern: Pattern): string[] {
  const out = new Set<string>();
  for (const p of patternInstances(pattern)) {
    if (card.claimed.includes(p.key)) continue;
    const missing = p.cells.filter(([r, c]) => !isMarked(card, r, c));
    if (missing.length === 1) out.add(`${missing[0][0]},${missing[0][1]}`);
  }
  return [...out];
}

// ── dealing ────────────────────────────────────────────────────────────────

/** Two numbers on the card, never the free square, that pay a power-up when daubed. */
function dealPrizes(numbers: number[][], rand: Rand): number[] {
  return shuffled(numbers.flat().filter((n) => n !== FREE), rand).slice(0, PRIZES_PER_CARD);
}

function dealCard(rand: Rand): BingoCard {
  const numbers = dealNumbers(rand);
  return { numbers, daubed: [], claimed: [], prizes: dealPrizes(numbers, rand), prizesWon: [] };
}

function dealNumbers(rand: Rand): number[][] {
  const columns = LETTERS.map((_, col) => shuffled(
    Array.from({ length: 15 }, (_, i) => col * 15 + i + 1), rand,
  ).slice(0, 5));
  const numbers = Array.from({ length: 5 }, (_, row) => columns.map((column) => column[row]));
  numbers[2][2] = FREE;
  return numbers;
}

function dealHouse(moments: BingoMoment[], rand: Rand): BingoMoment[][] {
  const pool = shuffled(moments, rand).slice(0, 24);
  if (pool.length < 24) throw new BingoError('Not enough house moments for a card');
  const free: BingoMoment = { label: 'Free', cue: '' };
  const flat = [...pool.slice(0, 12), free, ...pool.slice(12)];
  return Array.from({ length: 5 }, (_, row) => flat.slice(row * 5, row * 5 + 5));
}

const COMPANION_SHAPES: Shape[] = ['flame', 'feather', 'bird', 'star', 'moon', 'sparkle', 'paw'];

export interface NewBingoOptions {
  callers: string[];
  moments?: BingoMoment[];
  pattern?: Pattern;
  cardsEach?: number;
  /** Their seat's settings, carried from the last game. */
  owner?: Partial<Pick<BingoSeat, 'autoPower' | 'autoDaub' | 'shape'>>;
  /** Each companion's dauber, by slug; a companion with none gets one of the house shapes. */
  shapes?: Record<string, Shape>;
  rand?: Rand;
  now?: Date;
}

export function newBingo(opts: NewBingoOptions): BingoState {
  const rand = opts.rand ?? Math.random;
  if (opts.callers.length === 0) throw new BingoError('Nobody to call the numbers');
  const pattern: Pattern = opts.pattern && PATTERNS.includes(opts.pattern) ? opts.pattern : 'line';
  const cardsEach = Math.max(1, Math.min(MAX_CARDS, Math.floor(Number(opts.cardsEach) || 1)));
  const moments = opts.moments ?? DEFAULT_MOMENTS;
  const seat = (who: string, i: number): BingoSeat => {
    const own = who === OWNER;
    return {
      who,
      cards: Array.from({ length: cardsEach }, () => dealCard(rand)),
      meter: 0,
      held: [],
      autoPower: own ? opts.owner?.autoPower ?? false : true,
      autoDaub: own ? opts.owner?.autoDaub ?? false : true,
      shape: own
        ? (opts.owner?.shape && SHAPES.includes(opts.owner.shape) ? opts.owner.shape : 'heart')
        : (opts.shapes?.[who] && SHAPES.includes(opts.shapes[who]) ? opts.shapes[who] : COMPANION_SHAPES[i % COMPANION_SHAPES.length]),
      frozenUntil: 0,
      peek: [],
      noticed: {},
      house: dealHouse(moments, rand),
      houseMarked: [],
    };
  };
  const seats = [seat(OWNER, -1), ...opts.callers.map((slug, i) => seat(slug, i))];
  return {
    version: 2,
    id: crypto.randomUUID(),
    startedAt: (opts.now ?? new Date()).toISOString(),
    pattern,
    cardsEach,
    cap: Math.max(1, seats.length - 1),
    deck: shuffled(Array.from({ length: 75 }, (_, i) => i + 1), rand),
    calls: [],
    seats,
    callers: [...opts.callers],
    wins: [],
    events: [],
    done: false,
  };
}

export function seatOf(state: BingoState, who: string): BingoSeat {
  const seat = state.seats.find((s) => s.who === who);
  if (!seat) throw new BingoError('No such seat', 404);
  return seat;
}

/** Whose turn it is to call: the companions take it in turn, in the order given. */
export function nextCaller(state: BingoState): string {
  return state.callers[state.calls.length % state.callers.length];
}

function log(state: BingoState, who: string, text: string, now = new Date()): void {
  state.events.push({ at: now.toISOString(), who, text });
  if (state.events.length > 60) state.events.splice(0, state.events.length - 60);
}

// ── daubing and power-ups ──────────────────────────────────────────────────

/** Mark a number on every card of this seat that holds it; returns how many squares were marked. */
function markNumber(seat: BingoSeat, n: number): number {
  let marked = 0;
  for (const card of seat.cards) {
    if (card.numbers.some((row) => row.includes(n)) && !card.daubed.includes(n)) {
      card.daubed.push(n);
      marked++;
    }
  }
  return marked;
}

function gainMeter(state: BingoState, seat: BingoSeat, daubs: number, rand: Rand): void {
  payPrizes(state, seat, rand);
  seat.meter += daubs;
  while (seat.meter >= DAUBS_PER_POWER) {
    seat.meter -= DAUBS_PER_POWER;
    if (seat.held.length >= MAX_HELD) continue;
    const power = POWERS[Math.floor(rand() * POWERS.length)];
    seat.held.push(power);
    log(state, seat.who, `got ${powerName(power)}`);
    if (seat.autoPower) usePower(state, seat.who, { power, rand });
  }
}

/** A daubed prize square pays one power-up, once, straight into the hand. */
function payPrizes(state: BingoState, seat: BingoSeat, rand: Rand): void {
  for (const card of seat.cards) {
    for (const n of card.prizes ?? []) {
      if (!card.daubed.includes(n) || (card.prizesWon ?? []).includes(n)) continue;
      card.prizesWon = [...(card.prizesWon ?? []), n];
      if (seat.held.length >= MAX_HELD) {
        log(state, seat.who, `found the prize on ${callName(n)}, but their hands were full`);
        continue;
      }
      const power = POWERS[Math.floor(rand() * POWERS.length)];
      seat.held.push(power);
      log(state, seat.who, `found the prize on ${callName(n)}: ${powerName(power)}`);
      if (seat.autoPower) usePower(state, seat.who, { power, rand });
    }
  }
}

export function powerName(power: Power): string {
  return { optimistic: 'an Optimistic Daub', audit: 'an Audit', lucky: 'a Lucky Ball', double: 'a Double Daub' }[power];
}

/** Unmarked squares on a seat's cards, as [card, row, col]. */
function openSquares(seat: BingoSeat): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  seat.cards.forEach((card, i) => ALL.forEach(([r, c]) => {
    if (!isMarked(card, r, c)) out.push([i, r, c]);
  }));
  return out;
}

/** The open square that does the most for this seat: the one closest to finishing something. */
function bestSquare(state: BingoState, seat: BingoSeat): [number, number, number] | null {
  let best: [number, number, number] | null = null;
  let bestScore = -1;
  seat.cards.forEach((card, i) => {
    for (const p of patternInstances(state.pattern)) {
      if (card.claimed.includes(p.key)) continue;
      const missing = p.cells.filter(([r, c]) => !isMarked(card, r, c));
      if (missing.length === 0) continue;
      const score = (p.cells.length - missing.length) / p.cells.length;
      if (score > bestScore) { bestScore = score; best = [i, missing[0][0], missing[0][1]]; }
    }
  });
  return best;
}

export interface UsePowerOptions {
  power: Power;
  /** Where an Optimistic Daub lands, when they aims it. */
  target?: { card: number; row: number; col: number };
  rand?: Rand;
}

export function usePower(state: BingoState, who: string, opts: UsePowerOptions): void {
  const rand = opts.rand ?? Math.random;
  const seat = seatOf(state, who);
  const at = seat.held.indexOf(opts.power);
  if (at < 0) throw new BingoError('You are not holding that one');
  if (state.done) throw new BingoError('The round is over', 409);
  seat.held.splice(at, 1);
  switch (opts.power) {
    case 'optimistic': {
      let target: [number, number, number] | null = null;
      if (opts.target) {
        const { card, row, col } = opts.target;
        const c = seat.cards[card];
        if (!c || row < 0 || row > 4 || col < 0 || col > 4) throw new BingoError('No such square');
        if (isMarked(c, row, col)) throw new BingoError('That one is already marked');
        target = [card, row, col];
      } else {
        target = bestSquare(state, seat);
      }
      if (target) {
        const [ci, r, c] = target;
        seat.cards[ci].daubed.push(seat.cards[ci].numbers[r][c]);
        log(state, who, `used an Optimistic Daub on ${callName(seat.cards[ci].numbers[r][c])}`);
      }
      break;
    }
    case 'audit':
      seat.peek = state.deck.slice(0, 3);
      log(state, who, 'used an Audit');
      break;
    case 'lucky': {
      const mine = new Set(seat.cards.flatMap((card) => card.numbers.flat().filter((n) => n !== FREE && !card.daubed.includes(n))));
      const candidates = state.deck.filter((n) => mine.has(n));
      if (candidates.length) {
        const pick = candidates[Math.floor(rand() * candidates.length)];
        state.deck.splice(state.deck.indexOf(pick), 1);
        state.deck.unshift(pick);
      }
      log(state, who, 'used a Lucky Ball');
      break;
    }
    case 'double': {
      const open = shuffled(openSquares(seat), rand).slice(0, 2);
      for (const [ci, r, c] of open) seat.cards[ci].daubed.push(seat.cards[ci].numbers[r][c]);
      log(state, who, `used a Double Daub on ${open.map(([ci, r, c]) => callName(seat.cards[ci].numbers[r][c])).join(' and ') || 'nothing left to mark'}`);
      break;
    }
  }
  payPrizes(state, seat, rand);
  noticeCompanions(state);
}

export function daub(state: BingoState, who: string, cardIndex: number, n: number, rand: Rand = Math.random): void {
  const seat = seatOf(state, who);
  if (state.done) throw new BingoError('The round is over', 409);
  if (state.calls.length < seat.frozenUntil) throw new BingoError('Your dauber is frozen for a false call');
  const card = seat.cards[cardIndex];
  if (!card || n === FREE || !card.numbers.some((row) => row.includes(n))) throw new BingoError('That number is not on that card');
  if (!state.calls.some((c) => c.n === n)) throw new BingoError('That one has not been called yet');
  if (card.daubed.includes(n)) return;
  card.daubed.push(n);
  // A square pays the meter once: unmarking and marking it again was a free
  // tick toward a power-up (theirs, Nov 9 2026: 'feels a little cheatery').
  card.metered ??= [];
  if (card.metered.includes(n)) return;
  card.metered.push(n);
  gainMeter(state, seat, 1, rand);
}

export function undaub(state: BingoState, who: string, cardIndex: number, n: number): void {
  const card = seatOf(state, who).cards[cardIndex];
  if (!card) throw new BingoError('No such card');
  // A square already counted in a called bingo stays marked.
  const locked = patternInstances(state.pattern)
    .filter((p) => card.claimed.includes(p.key))
    .some((p) => p.cells.some(([r, c]) => card.numbers[r][c] === n));
  if (locked) throw new BingoError('That square is part of a bingo you called');
  card.daubed = card.daubed.filter((d) => d !== n);
}

// ── the cage ───────────────────────────────────────────────────────────────

export function callNumber(state: BingoState, opts: {
  by?: string;
  line?: string;
  lines?: Record<string, string[]>;
  rand?: Rand;
  now?: Date;
}): BingoCall {
  const rand = opts.rand ?? Math.random;
  if (state.done) throw new BingoError('The round is over', 409);
  const n = state.deck.shift();
  if (n === undefined) {
    state.done = true;
    throw new BingoError('Every number has been called', 409);
  }
  const by = opts.by && state.callers.includes(opts.by) ? opts.by : nextCaller(state);
  const name = callName(n);
  const pool = opts.lines?.[by]?.length ? opts.lines[by] : DEFAULT_LINES;
  // A line from a lane is the companion's own words for this call. It still has
  // to say the number, so a line that forgets it gets the number in front.
  const template = opts.line?.trim() || pool[Math.floor(rand() * pool.length)];
  const line = template.includes('{call}') ? template.replaceAll('{call}', name) : `${name}. ${template}`;
  const call: BingoCall = { n, by, line, at: (opts.now ?? new Date()).toISOString() };
  state.calls.push(call);
  for (const seat of state.seats) {
    seat.peek = seat.peek.filter((p) => p !== n && state.deck.includes(p));
    if (seat.autoDaub && state.calls.length >= seat.frozenUntil) {
      const marked = markNumber(seat, n);
      if (marked) gainMeter(state, seat, marked, rand);
    }
  }
  callCompanionBingos(state, opts.now);
  noticeCompanions(state);
  if (state.deck.length === 0 && !state.done) {
    state.done = true;
    log(state, 'house', 'The cage is empty.');
  }
  return call;
}

/** A companion writes down what he could call now; he calls it one ball later. */
function noticeCompanions(state: BingoState): void {
  for (const seat of state.seats) {
    if (seat.who === OWNER) continue;
    seat.cards.forEach((card, i) => {
      for (const key of uncalledComplete(card, state.pattern)) {
        const k = `${i}:${key}`;
        if (seat.noticed[k] === undefined) seat.noticed[k] = state.calls.length;
      }
    });
  }
}

function callCompanionBingos(state: BingoState, now?: Date): void {
  for (const seat of state.seats) {
    if (seat.who === OWNER) continue;
    for (const [k, since] of Object.entries(seat.noticed)) {
      if (state.done) return;
      if (state.calls.length <= since) continue;
      const [ci, key] = [Number(k.split(':')[0]), k.split(':').slice(1).join(':')];
      delete seat.noticed[k];
      const card = seat.cards[ci];
      if (!card || card.claimed.includes(key)) continue;
      recordWin(state, seat, ci, key, now);
    }
  }
}

function recordWin(state: BingoState, seat: BingoSeat, cardIndex: number, key: string, now = new Date()): BingoWin {
  seat.cards[cardIndex].claimed.push(key);
  const win: BingoWin = { who: seat.who, card: cardIndex, key, afterCalls: state.calls.length, at: now.toISOString() };
  state.wins.push(win);
  log(state, seat.who, `BINGO on card ${cardIndex + 1}`, now);
  if (state.wins.length >= state.cap) {
    state.done = true;
    log(state, 'house', 'That was the last bingo of the round.', now);
  }
  return win;
}

/**
 * The BINGO button. Calls the first complete, uncalled pattern on any of the
 * seat's cards; with nothing behind it, the seat's dauber freezes.
 */
export function claimBingo(state: BingoState, who: string, now = new Date()): { won: BingoWin | null; frozenUntil?: number } {
  const seat = seatOf(state, who);
  if (state.done) throw new BingoError('The round is over', 409);
  for (let i = 0; i < seat.cards.length; i++) {
    const [key] = uncalledComplete(seat.cards[i], state.pattern);
    if (key) return { won: recordWin(state, seat, i, key, now) };
  }
  // Frozen through the next FREEZE_BALLS balls, free again on the one after.
  seat.frozenUntil = state.calls.length + FREEZE_BALLS + 1;
  log(state, who, `called a false bingo and is frozen for ${FREEZE_BALLS} balls`, now);
  return { won: null, frozenUntil: seat.frozenUntil };
}

export function setSeat(state: BingoState, who: string, patch: Partial<Pick<BingoSeat, 'autoPower' | 'autoDaub' | 'shape'>>): void {
  const seat = seatOf(state, who);
  if (typeof patch.autoPower === 'boolean') seat.autoPower = patch.autoPower;
  if (typeof patch.autoDaub === 'boolean') seat.autoDaub = patch.autoDaub;
  if (patch.shape && SHAPES.includes(patch.shape)) seat.shape = patch.shape;
}

export function toggleHouse(state: BingoState, who: string, row: number, col: number): void {
  const seat = seatOf(state, who);
  if (!seat.house[row]?.[col] || (row === 2 && col === 2)) throw new BingoError('No such square');
  const key = `${row},${col}`;
  seat.houseMarked = seat.houseMarked.includes(key)
    ? seat.houseMarked.filter((k) => k !== key)
    : [...seat.houseMarked, key];
}

/** House squares a message has matched, as 'row,col'. */
export function houseMatches(house: BingoMoment[][], texts: string[]): string[] {
  const out: string[] = [];
  house.forEach((row, r) => row.forEach((moment, c) => {
    if (!moment.cue) return;
    const re = new RegExp(moment.cue, 'i');
    if (texts.some((t) => re.test(t))) out.push(`${r},${c}`);
  }));
  return out;
}

// ── the view ───────────────────────────────────────────────────────────────

export interface BingoSeatView extends Omit<BingoSeat, 'peek' | 'noticed'> {
  /** An Audit's balls, shown only to the seat that used it (always them). */
  peek: number[];
  frozen: boolean;
  cardsView: Array<{ oneAway: string[]; closest: { have: number; need: number }; complete: string[] }>;
  houseAuto: string[];
  houseLines: Cell[][];
}

export interface BingoView extends Omit<BingoState, 'deck' | 'seats'> {
  left: number;
  seats: BingoSeatView[];
  instances: Array<{ key: string; cells: Cell[] }>;
}

/** What the phone sees: the deck stays in the cage, and an Audit is shown only to them. */
export function viewBingo(state: BingoState, texts: string[]): BingoView {
  const { deck, seats, ...rest } = state;
  return {
    ...rest,
    left: deck.length,
    instances: patternInstances(state.pattern),
    seats: seats.map((seat) => {
      const { noticed: _noticed, ...open } = seat;
      const auto = houseMatches(seat.house, texts);
      const marked = new Set([...auto, ...seat.houseMarked]);
      return {
        ...open,
        peek: seat.who === OWNER ? seat.peek : [],
        frozen: state.calls.length < seat.frozenUntil,
        cardsView: seat.cards.map((card) => ({
          oneAway: oneAway(card, state.pattern),
          closest: closest(card, state.pattern),
          complete: uncalledComplete(card, state.pattern),
        })),
        houseAuto: auto,
        houseLines: winningLines((r, c) => marked.has(`${r},${c}`)),
      };
    }),
  };
}

/** The table in words, for the companions answering at it. */
export function describeBingo(state: BingoState, label: (who: string) => string): string {
  const lines: string[] = [];
  lines.push(`Pattern: ${PATTERN_WORDS[state.pattern] ?? state.pattern}. ${state.calls.length} of 75 called, ${state.wins.length} of ${state.cap} bingos given out${state.done ? ', round over' : ''}.`);
  const last = state.calls.slice(-5).map((c) => callName(c.n));
  if (last.length) lines.push(`Last called: ${last.join(', ')}.`);
  for (const seat of state.seats) {
    const near = seat.cards.map((card) => {
      const c = closest(card, state.pattern);
      return `${c.have}/${c.need}`;
    }).join(', ');
    const wins = state.wins.filter((w) => w.who === seat.who).length;
    lines.push(`${label(seat.who)}: ${seat.cards.length} card${seat.cards.length > 1 ? 's' : ''} (closest ${near}), ${wins} bingo${wins === 1 ? '' : 's'}, holding ${seat.held.length ? seat.held.join(', ') : 'no power-ups'}${state.calls.length < seat.frozenUntil ? ', frozen for a false call' : ''}.`);
  }
  const recent = state.events.slice(-6).map((e) => `${label(e.who)} ${e.text}`);
  if (recent.length) lines.push(`Lately: ${recent.join('; ')}.`);
  return lines.join('\n');
}

// ── storage: one table, the newest game is the one on the table ──────────

function ensureTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS bingo_games (
      id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

/** The game on the table. A game dealt by the first build has no seats and is not carried over. */
export function loadCurrentBingo(): BingoState | null {
  ensureTable();
  const row = getDb().prepare('SELECT state FROM bingo_games ORDER BY created_at DESC LIMIT 1').get() as { state: string } | undefined;
  if (!row) return null;
  const state = JSON.parse(row.state) as BingoState;
  return state.version === 2 ? state : null;
}

export function saveBingo(state: BingoState): void {
  ensureTable();
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO bingo_games (id, state, created_at, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at
  `).run(state.id, JSON.stringify(state), state.startedAt, now);
}

/** What was said in the house since the game started, for the house cards. */
export function textsSince(iso: string): string[] {
  const rows = getDb().prepare(
    'SELECT content FROM messages WHERE deleted_at IS NULL AND created_at >= ? ORDER BY created_at ASC LIMIT 5000',
  ).all(iso) as Array<{ content: string | null }>;
  return rows.map((r) => r.content || '').filter(Boolean);
}
