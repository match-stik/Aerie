// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The home screen's widgets, apart from how they are drawn. Kept free of
// imports so it can be tested without the app around it.

import { Cells, GRID_COLS, gridHeight, keepPlaces, placeOnGrid, type GridSpot } from './grid-place.js';

export type HomeWidget = 'companions' | 'note' | 'weather' | 'letter' | 'day' | 'clock' | 'music';

/** How many grid rows make one of the rows the widgets used to come in (theirs,
 *  Nov 8 2026: the slim Spotify bar took a whole row, so nothing could sit
 *  down against it). The grid counts in thirds now, so a slim thing can take
 *  two thirds and the rest still come in whole rows. */
export const ROW_PARTS = 3;

/** Them board's widgets in its order, each with its size on a four-wide grid,
 *  rows counted in thirds (ROW_PARTS). */
export const HOME_WIDGETS: readonly { id: HomeWidget; label: string; cols: number; rows: number; hint: string }[] = [
  { id: 'companions', label: 'Companions', cols: 4, rows: 6, hint: 'The latest reply, and a box to answer it' },
  { id: 'note', label: 'A note', cols: 2, rows: 6, hint: 'The last sticky note a companion left' },
  { id: 'weather', label: 'Weather', cols: 2, rows: 3, hint: 'The temperature and the sky' },
  { id: 'letter', label: 'A letter', cols: 2, rows: 3, hint: 'Only while a letter is waiting for you' },
  { id: 'day', label: 'The day', cols: 4, rows: 3, hint: 'The day and the date, big' },
  { id: 'clock', label: 'Clock', cols: 2, rows: 3, hint: 'The time, in the look you pick' },
  { id: 'music', label: 'Spotify', cols: 4, rows: 3, hint: 'What is playing, with its buttons' },
];

/** A widget whose look changes its size, by id. */
export type Sizes = Partial<Record<HomeWidget, { cols: number; rows: number }>>;

/** The sizes them picked looks give: the slim Spotify line is two thirds of a
 *  row, just tall enough for its pill; the Record stands stacked in half the
 *  width, two rows tall, so something fits beside it (theirs, Nov 8 2026, the
 *  way the lock screen's Record already sat). */
export function lookSizes(looks: { spotify?: string; weather?: string }): Sizes {
  const sizes: Sizes = {};
  if (looks.spotify === 'slim') sizes.music = { cols: 4, rows: 2 };
  if (looks.spotify === 'cover') sizes.music = { cols: 2, rows: 6 };
  // The weather's line and pill are two thirds of a row, like the slim Spotify.
  if (looks.weather === 'line' || looks.weather === 'pill') sizes.weather = { cols: 2, rows: 2 };
  return sizes;
}

/** The home Weather widget's looks (theirs, Nov 9 2026: 'like we have for the
 *  lock screen'). Card is the one it always was. */
export type HomeWeatherLook = 'card' | 'big' | 'line' | 'pill';
export const HOME_WEATHER_LOOKS: readonly HomeWeatherLook[] = ['card', 'big', 'line', 'pill'];
export function homeWeatherLookOf(value: unknown): HomeWeatherLook {
  return typeof value === 'string' && (HOME_WEATHER_LOOKS as readonly string[]).includes(value) ? value as HomeWeatherLook : 'card';
}

/** The size a widget shows in the pickers, in whole rows (2×1, 4×2). */
export function sizeLabel(w: { cols: number; rows: number }): string {
  return `${w.cols}×${+(w.rows / ROW_PARTS).toFixed(2)}`;
}

/** The widgets they have on, in the order they turned them on. Where each one
 *  sits is its own setting (homeSpotsOf, below); the order only decides how
 *  they pack before any has been moved. Unset is none, so the home screen
 *  stays as it was until one is added. */
export function homeWidgetsOf(value: unknown): HomeWidget[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<HomeWidget>();
  for (const v of value) {
    if (HOME_WIDGETS.some((w) => w.id === v) && !seen.has(v as HomeWidget)) seen.add(v as HomeWidget);
  }
  return [...seen];
}

/** On or off. Taking one away leaves the rest where they were put; a new one
 *  takes the first open place from the bottom, to be moved from there. */
export function toggleWidget(current: readonly HomeWidget[], id: HomeWidget): HomeWidget[] {
  return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
}

// Where each widget sits. Dropping used to change only the ORDER, and the
// grid packs from the left, so a note could never sit on the right on its
// own. Now each widget has a place on a four-wide grid, kept where it is
// dropped. Rows count up from the dock, so the widgets stay low and the grid
// grows upward into the wallpaper only as far as things are put.

export { GRID_COLS };

export type HomeCardStyle = 'full' | 'snug' | 'none';
/** Them widgets' cards: the three-way setting, or the old on and off switch
 *  read as full or none. */
export function homeCardStyleOf(theme: { homeCardStyle?: unknown; homeCardBacks?: unknown }): HomeCardStyle {
  if (theme.homeCardStyle === 'full' || theme.homeCardStyle === 'snug' || theme.homeCardStyle === 'none') return theme.homeCardStyle;
  return theme.homeCardBacks === false ? 'none' : 'full';
}

/** A widget's place: its left column (0 to 3) and its bottom row, where row 0
 *  is the row nearest the dock. */
export type Spot = GridSpot;

export type Layout = Partial<Record<HomeWidget, Spot>>;

export const sizeOf = (id: HomeWidget, sizes: Sizes = {}): { cols: number; rows: number } => sizes[id] ?? HOME_WIDGETS.find((w) => w.id === id)!;

/** The saved places. Anything malformed is no place, and that widget
 *  gets the first open one. */
export function homeSpotsOf(value: unknown, maxRow = 40 * ROW_PARTS): Layout {
  const out: Layout = {};
  if (!value || typeof value !== 'object') return out;
  for (const w of HOME_WIDGETS) {
    const s = (value as Record<string, unknown>)[w.id] as { col?: unknown; row?: unknown } | undefined;
    if (!s || typeof s !== 'object') continue;
    const { col, row } = s;
    if (!Number.isInteger(col) || !Number.isInteger(row)) continue;
    // Only the column has to be on the grid here: a widget's width depends on
    // the look they picked (the Record is half as wide as the bar), so whether
    // it fits from that column is checked against its real size when it is
    // laid out (theirs, Nov 8 2026: the Record would not stay on the right,
    // because this checked it against the bar's full width).
    if ((col as number) < 0 || (col as number) >= GRID_COLS || (row as number) < 0 || (row as number) > maxRow) continue;
    out[w.id] = { col: col as number, row: row as number };
  }
  return out;
}

/** Them places, in thirds. Places saved before the grid counted in thirds
 *  (homeWidgetSpots) are read in whole rows and moved onto the new count, so
 *  nothing on their screen moves. */
export function homePlacesOf(places: unknown, oldSpots: unknown): Layout {
  if (places && typeof places === 'object') return homeSpotsOf(places);
  const old = homeSpotsOf(oldSpots, 40);
  const out: Layout = {};
  for (const [id, s] of Object.entries(old) as [HomeWidget, Spot][]) out[id] = { col: s.col, row: s.row * ROW_PARTS };
  return out;
}

/** How the grid drew them before places existed: each widget at the first
 *  place it fits from the top left, in them order (CSS row dense), turned so
 *  rows count up from the dock. Their screen does not move until they drag. */
function packedFromTop(order: readonly HomeWidget[], sizes: Sizes): Layout {
  const cells = new Cells();
  const top: { id: HomeWidget; col: number; row: number; rows: number }[] = [];
  for (const id of order) {
    const { cols, rows } = sizeOf(id, sizes);
    let placed = false;
    for (let r = 0; !placed; r++) {
      for (let c = 0; c + cols <= GRID_COLS; c++) {
        if (cells.fits(c, r, cols, rows)) { cells.take(c, r, cols, rows); top.push({ id, col: c, row: r, rows }); placed = true; break; }
      }
    }
  }
  const height = top.reduce((h, t) => Math.max(h, t.row + t.rows), 0);
  const out: Layout = {};
  for (const t of top) out[t.id] = { col: t.col, row: height - t.row - t.rows };
  return out;
}

/** Every widget they have on, each with a place, none overlapping. Places they
 *  saved are kept; a widget with none (or one that no longer fits) takes the
 *  first open place from the bottom. With nothing saved at all, they sit the
 *  way the grid always packed them. */
export function layoutWidgets(widgets: readonly HomeWidget[], spots: Layout, sizes: Sizes = {}): Record<HomeWidget, Spot> {
  if (!widgets.some((id) => spots[id])) return packedFromTop(widgets, sizes) as Record<HomeWidget, Spot>;
  return keepPlaces(widgets, spots, (id) => sizeOf(id, sizes), 0);
}

/** The widgets that fit under the top of the screen, and the ones that
 *  don't (theirs, Nov 8 2026: they added one too many and them Spotify bar went
 *  up off the top of the screen). With no room measured yet, everything shows.
 *  A widget that has to give way is the newest one they turned on before they
 *  have moved anything, and otherwise the one the grid had to put above the
 *  top, so the places they chose are never the ones that disappear. */
export function fitWidgets(widgets: readonly HomeWidget[], spots: Layout, sizes: Sizes, rowLimit: number): { layout: Record<HomeWidget, Spot>; shown: HomeWidget[]; noRoom: HomeWidget[] } {
  let shown = [...widgets];
  const noRoom: HomeWidget[] = [];
  for (;;) {
    const layout = layoutWidgets(shown, spots, sizes);
    if (rowLimit <= 0) return { layout, shown, noRoom };
    const over = shown.filter((id) => layout[id].row + sizeOf(id, sizes).rows > rowLimit);
    if (!over.length) return { layout, shown, noRoom };
    const packed = !shown.some((id) => spots[id]);
    const drop = packed ? [shown[shown.length - 1]] : over;
    shown = shown.filter((id) => !drop.includes(id));
    noRoom.unshift(...drop);
    if (!shown.length) return { layout: {} as Record<HomeWidget, Spot>, shown, noRoom };
  }
}

/** How many rows tall the widgets stand. */
export function layoutHeight(layout: Layout, sizes: Sizes = {}): number {
  return gridHeight(layout, (id) => sizeOf(id, sizes));
}

/** The places after a widget is dropped at a spot: it stays exactly there
 *  (kept inside the grid's four columns and above the dock), everything it
 *  doesn't cover stays put, and anything it does cover moves to the open
 *  place nearest where it was. */
export function placeWidget(layout: Record<HomeWidget, Spot>, order: readonly HomeWidget[], id: HomeWidget, to: Spot, rowLimit: number, sizes: Sizes = {}): Record<HomeWidget, Spot> {
  return placeOnGrid(layout, order, id, to, rowLimit, (w) => sizeOf(w, sizes), ROW_PARTS);
}

interface NoteLike { id: string | number; text: string; color: string; timestamp: string; sender: string | null }

/** The newest sticky note a companion left: a note whose sender is a companion. */
export function latestCompanionNote<T extends NoteLike>(notes: readonly T[], companionSlugs: readonly string[]): T | null {
  const companions = new Set(companionSlugs.map((s) => s.toLowerCase()));
  let best: T | null = null;
  let bestAt = -Infinity;
  for (const n of notes) {
    if (!n.sender || !companions.has(n.sender.toLowerCase())) continue;
    const at = Date.parse(n.timestamp);
    const when = Number.isFinite(at) ? at : -Infinity;
    if (best === null || when > bestAt) { best = n; bestAt = when; }
  }
  return best;
}

/** Where the phone keeps the moment Notes was last opened (lib/home-widgets.ts). */
export const NOTES_SEEN_KEY = 'aerie.notes-seen-at';

/**
 * A note a companion left since Notes was last opened, for the card on the
 * lock screen (a note on the fridge, saying who left it). Before Notes has
 * ever been opened with this in place, nothing counts as new, so a note from
 * last week doesn't light up the first night.
 */
export function unseenCompanionNote<T extends NoteLike>(notes: readonly T[], companionSlugs: readonly string[], seenAt: number | null): T | null {
  if (seenAt === null || !Number.isFinite(seenAt)) return null;
  const note = latestCompanionNote(notes, companionSlugs);
  if (!note) return null;
  const at = Date.parse(note.timestamp);
  return Number.isFinite(at) && at > seenAt ? note : null;
}

interface LetterLike { author: string; hidden: boolean; state: string; written_at: string }

/** A letter that is ready and not yet opened. A hidden letter never counts,
 *  not even by its author's name. */
export function waitingLetter<T extends LetterLike>(letters: readonly T[], ownerSlug: string | null): T | null {
  const ready = letters.filter((l) => !l.hidden && l.state === 'openable' && l.author !== ownerSlug);
  ready.sort((a, b) => (Date.parse(b.written_at) || 0) - (Date.parse(a.written_at) || 0));
  return ready[0] ?? null;
}

export interface ReplyLine { text: string; action: boolean }

/** The first lines of a reply as a widget shows them: voice headers dropped,
 *  action lines kept but marked so they can be drawn quieter. */
export function replyLines(content: string, max = 2): ReplyLine[] {
  const out: ReplyLine[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^\*\*[^*]+\*\*$/.test(line)) continue;
    const action = /^\*[^*].*\*$/.test(line);
    const text = (line.startsWith('-# ') ? line.slice(3) : line).replace(/\*/g, '').trim();
    if (!text) continue;
    out.push({ text, action });
    if (out.length >= max) break;
  }
  return out;
}

/** A word for the sky off an Open-Meteo weather code. */
export function skyWord(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly cloudy';
  if (code <= 48) return 'Foggy';
  if (code <= 67 || (code >= 80 && code <= 82)) return 'Rain';
  if (code <= 77 || code === 85 || code === 86) return 'Snow';
  return 'Storms';
}
