// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// What the lock screen's clock says, apart from how it is drawn. Kept free of
// imports so it can be tested without the app around it.

export type LockFace = 'stacked' | 'dateline' | 'classic' | 'serif' | 'outline' | 'analog' | 'script' | 'words' | 'ring';
/** Every face, in the order Settings shows them; the four after the first
 *  three came with their ask for more looks (Nov 7 2026). */
export const LOCK_FACES: readonly LockFace[] = ['stacked', 'dateline', 'classic', 'serif', 'outline', 'analog', 'script', 'words', 'ring'];
export type LockPosition = 'top' | 'middle' | 'low';
export type LockSize = 'xs' | 's' | 'm' | 'l' | 'xl';
/** Smallest to largest, the way Settings shows them (Extra small and Extra
 *  large came Nov 8 2026, with the grid). */
export const LOCK_SIZES: readonly LockSize[] = ['xs', 's', 'm', 'l', 'xl'];

/** How the weather looks on the lock screen (theirs, Nov 8 2026: 'maybe some
 *  diff weather widget styles'). Unset is the pill it has always been. */
export type LockWeatherLook = 'pill' | 'line' | 'big' | 'card';
export const LOCK_WEATHER_LOOKS: readonly LockWeatherLook[] = ['pill', 'line', 'big', 'card'];
export function lockWeatherLookOf(value: unknown): LockWeatherLook {
  return typeof value === 'string' && (LOCK_WEATHER_LOOKS as readonly string[]).includes(value) ? value as LockWeatherLook : 'pill';
}

/** The sky in a word or two, off the Open-Meteo weather code. */
export function weatherWord(code: number): string {
  if (code <= 1) return 'Clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Cloudy';
  if (code <= 48) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Showers';
  if (code <= 86) return 'Snow showers';
  return 'Storms';
}

/** The face to draw. Anything unset or unknown is today's clock, so nothing
 *  on the lock screen moves until their person picks a face. */
export function lockFaceOf(value: unknown): LockFace {
  return typeof value === 'string' && (LOCK_FACES as readonly string[]).includes(value) ? value as LockFace : 'classic';
}

/** The home screen's clock widget wears a look of its own, from the same set
 *  as the lock screen minus the dateline, which is a layout rather than a look.
 *  Unset is the stacked one. */
export type HomeClockLook = Exclude<LockFace, 'dateline'>;
export const HOME_CLOCK_LOOKS: readonly HomeClockLook[] = ['stacked', 'classic', 'serif', 'outline', 'analog', 'script', 'words', 'ring'];
export function homeClockLookOf(value: unknown): HomeClockLook {
  return typeof value === 'string' && (HOME_CLOCK_LOOKS as readonly string[]).includes(value) ? value as HomeClockLook : 'stacked';
}

export function lockPositionOf(value: unknown): LockPosition {
  return value === 'middle' || value === 'low' ? value : 'top';
}

export function lockSizeOf(value: unknown): LockSize {
  return typeof value === 'string' && (LOCK_SIZES as readonly string[]).includes(value) ? value as LockSize : 'm';
}

/** Where the clock was held and dragged to: the middle of the clock, in
 *  fractions of the screen, 0 to 1 each way. Kept per face, because each face
 *  is a different shape and sits in a different place. */
export interface ClockAt {
  x: number;
  y: number;
}

const unit = (n: number) => Math.min(1, Math.max(0, n));

/** A spot read back from settings, or null if it is not one. */
export function spotOf(value: unknown): ClockAt | null {
  if (!value || typeof value !== 'object') return null;
  const { x, y } = value as { x?: unknown; y?: unknown };
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: unit(x), y: unit(y) };
}

/** The spot this face's clock was dragged to, or null for the face's own
 *  place. Anything malformed is the face's own place. */
export function lockClockAtOf(value: unknown, face: LockFace): ClockAt | null {
  if (!value || typeof value !== 'object') return null;
  return spotOf((value as Record<string, unknown>)[face]);
}

/** Where the weather pill was dragged. One spot for every face that shows the
 *  pill; null is its own corner, top right. */
export function lockWeatherAtOf(value: unknown): ClockAt | null {
  return spotOf(value);
}

export type LockPiece = 'clock' | 'weather';

/** What their person has tucked away off the lock screen (drag it up to the top
 *  to dismiss it, and bring it back from Settings). Unset is nothing hidden,
 *  so both show until their person says otherwise. */
export function lockHiddenOf(value: unknown): Set<LockPiece> {
  const out = new Set<LockPiece>();
  if (Array.isArray(value)) for (const v of value) if (v === 'clock' || v === 'weather') out.add(v);
  return out;
}

/** The hidden list with one piece tucked away or brought back. */
export function withHidden(value: unknown, piece: LockPiece, hidden: boolean): LockPiece[] {
  const set = lockHiddenOf(value);
  if (hidden) set.add(piece); else set.delete(piece);
  return (['clock', 'weather'] as LockPiece[]).filter((p) => set.has(p));
}

/** The settings map with this face's spot set, or taken away when null so
 *  the face goes back to its own place. The other faces keep theirs. */
export function withClockAt(value: unknown, face: LockFace, at: ClockAt | null): Partial<Record<LockFace, ClockAt>> {
  const next: Partial<Record<LockFace, ClockAt>> = {};
  for (const f of LOCK_FACES) {
    const kept = lockClockAtOf(value, f);
    if (kept) next[f] = kept;
  }
  if (at) next[face] = { x: unit(at.x), y: unit(at.y) }; else delete next[face];
  return next;
}

/** A dragged clock's middle, in pixels, kept far enough in that the whole
 *  clock stays on the screen, and answered in fractions of the screen. A
 *  clock wider or taller than the screen is held at the middle that way. */
export function clampClockAt(cx: number, cy: number, boxW: number, boxH: number, frameW: number, frameH: number): ClockAt {
  const keep = (c: number, box: number, frame: number) => {
    if (frame <= 0) return 0.5;
    if (box >= frame) return 0.5;
    return Math.min(frame - box / 2, Math.max(box / 2, c)) / frame;
  };
  return { x: keep(cx, boxW, frameW), y: keep(cy, boxH, frameH) };
}

export interface ClockParts {
  /** Two digits, twelve-hour, for the stacked face: '02'. */
  hour: string;
  /** '29'. */
  minute: string;
  /** '2:29', for the dateline face. */
  short: string;
  /** 'Tue, Oct 13'. */
  dateShort: string;
  /** 'Tuesday, October 13'. */
  dateLong: string;
  /** Today's clock as it has always read, '02:29 AM'. */
  classic: string;
  /** 'AM' or 'PM'. */
  meridiem: string;
  /** 'Tuesday'. */
  weekday: string;
  /** The hand angles in degrees from twelve, for the analog face. */
  hourDeg: number;
  minuteDeg: number;
  /** The hour as words and the minutes as words, for the Words face: 'eleven', 'forty-two' (or "o'clock", 'oh five'). */
  hourWords: string;
  minuteWords: string;
  /** How far through the hour, 0 to 1, for the Ring face. */
  hourDone: number;
}

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty'];
/** A minute the way it is said: "o'clock", 'oh five', 'fifteen', 'forty-two'. */
export function minuteInWords(m: number): string {
  if (m === 0) return "o'clock";
  if (m < 10) return `oh ${ONES[m]}`;
  if (m < 20) return ONES[m];
  const ones = m % 10;
  return ones ? `${TENS[Math.floor(m / 10)]}-${ONES[ones]}` : TENS[m / 10];
}

export function clockParts(now: Date, locale?: string): ClockParts {
  const h24 = now.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const minute = String(now.getMinutes()).padStart(2, '0');
  return {
    hour: String(h12).padStart(2, '0'),
    minute,
    short: `${h12}:${minute}`,
    dateShort: now.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' }),
    dateLong: now.toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' }),
    classic: now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
    meridiem: h24 < 12 ? 'AM' : 'PM',
    weekday: now.toLocaleDateString(locale, { weekday: 'long' }),
    hourDeg: ((h24 % 12) + now.getMinutes() / 60) * 30,
    minuteDeg: now.getMinutes() * 6,
    hourWords: ONES[h12],
    minuteWords: minuteInWords(now.getMinutes()),
    hourDone: (now.getMinutes() * 60 + now.getSeconds()) / 3600,
  };
}

export type LockShow = 'names' | 'first-line' | 'nothing';

/** What the message card on the lock screen may show. Unset is names only,
 *  no words from the message, because a phone often lies face up where others
 *  can see it. */
export function lockShowOf(value: unknown): LockShow {
  return value === 'first-line' || value === 'nothing' ? value : 'names';
}

/** The design board's pair for the two corner shortcuts, left then right. */
export const DEFAULT_LOCK_SHORTCUTS: [string | null, string | null] = ['messages', 'treehouse'];

/** The two corner shortcuts. Unset is the board's pair; a null corner is one
 *  their person emptied on purpose and stays empty. */
export function lockShortcutsOf(value: unknown): [string | null, string | null] {
  if (!Array.isArray(value) || value.length !== 2) return [...DEFAULT_LOCK_SHORTCUTS];
  const one = (x: unknown) => (typeof x === 'string' && x ? x : null);
  return [one(value[0]), one(value[1])];
}

export interface UnreadSummary {
  count: number;
  /** When the newest unread thread last moved, in ms, or null. */
  newestAt: number | null;
  /** The first line a person would read in that thread's newest message. */
  firstLine: string | null;
}

interface ThreadLike {
  unread_count: number;
  last_activity_at: string | null;
  last_message_preview: string | null;
}

/** What the lock screen's message card says, read off the thread list. */
export function unreadSummary(threads: readonly ThreadLike[]): UnreadSummary {
  let count = 0;
  let newestAt: number | null = null;
  let preview: string | null = null;
  for (const t of threads) {
    const n = Number(t.unread_count) || 0;
    if (n <= 0) continue;
    count += n;
    const at = t.last_activity_at ? Date.parse(t.last_activity_at) : NaN;
    if (Number.isFinite(at) && (newestAt === null || at > newestAt)) {
      newestAt = at;
      preview = t.last_message_preview;
    } else if (newestAt === null && preview === null) {
      preview = t.last_message_preview;
    }
  }
  return { count, newestAt, firstLine: firstSpokenLine(preview) };
}

/** A voice header in the middle of a line, the way the house flattens a
 *  room's preview onto one line: a bold run that opens on a sigil
 *  (**🔥 Birch**). Bold that opens on a word is emphasis and stays put. */
const INLINE_VOICE_HEADER = /\s*(\*\*\s*\p{Extended_Pictographic}[^*\n]{0,40}?\*\*)\s*/gu;

/** A whisper marker, `-# `, wherever it landed. The bubble draws it as small
 *  text; on the lock screen it is only ever noise. */
const WHISPER_MARKERS = /^(?:-#(?:\s+|$))+/;

/** One line as a person would read it on a bubble: no markdown, and none of
 *  the codes the bubble turns into pictures (stickers, emotes, mentions,
 *  voice notes, pictures and files). */
function plainWords(line: string): string {
  return line
    .replace(/\[FILE:[^\]]*\]:?.*$/i, '')
    .replace(/\[(?:VOICE|IMG)\]:\s*\S*/gi, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/::[a-z0-9_-]+::/gi, '')
    .replace(/<a?:[a-z0-9_~-]+:\d+>/gi, '')
    .replace(/<(?:[@#][!&]?)?\d+>/g, '')
    .replace(/:(?=[a-z0-9_-]*[a-z])[a-z0-9_-]+:/gi, '')
    .replace(/(^|\s)-#(?=\s|$)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*[^*]+\*/g, '')
    .replace(/\*|~~|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first line of a reply that is somebody talking: past a voice header
 *  (**Birch**), past an action line (*leans in*), and past the whisper
 *  marker, the codes and the markdown the bubble draws as something else. A
 *  flattened reply with several voices gives the first voice's words only. */
export function firstSpokenLine(preview: string | null): string | null {
  if (!preview) return null;
  const lines = preview.replace(INLINE_VOICE_HEADER, '\n$1\n').split('\n');
  for (const raw of lines) {
    let line = raw.trim().replace(WHISPER_MARKERS, '').trim();
    if (!line) continue;
    if (/^\*\*[^*]+\*\*$/.test(line)) continue;
    if (/^\*[^*].*\*$/.test(line)) continue;
    // A header and its first words on one line; a markdown heading reads as
    // its words.
    line = plainWords(line.replace(/^\*\*[^*]+\*\*\s*/, '').replace(WHISPER_MARKERS, '').replace(/^#{1,6}\s+/, ''));
    if (line) return line;
  }
  return null;
}

/** How long ago, the short way a lock screen says it: now, 5m, 2h, 3d. */
export function ageLabel(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
