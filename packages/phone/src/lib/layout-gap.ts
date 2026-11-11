// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The instrument for the color block under the app after the keyboard closes.
// Pinning the root to the screen's edges did not end it on a real phone, so the question left is WHICH thing stays short: the page
// inside a full-height window, or the app's Android window itself. A settled
// reading after every resize answers it, and the phone posts one when either
// shape shows, as a line in the error log tagged [client-error] layout-gap.

export interface LayoutSample {
  /** window.innerHeight: the page's own window. */
  inner: number;
  /** visualViewport.height, or inner when there is none. */
  visual: number;
  /** The root element's bottom edge, in the same pixels. */
  rootBottom: number;
  /** True while something that raises the keyboard has focus. */
  typing: boolean;
}

/**
 * Why this settled reading looks wrong, or null. 'root-short': the window is
 * full but the app stops above its bottom. 'window-short': nothing is being
 * typed into, yet the window is well under the tallest it has been, which is
 * the app's window still sized for a keyboard that is gone.
 */
export function layoutGap(s: LayoutSample, tallestInner: number): 'root-short' | 'window-short' | null {
  if (s.inner - s.rootBottom > 8) return 'root-short';
  if (!s.typing && tallestInner > 0 && s.inner < tallestInner * 0.85) return 'window-short';
  return null;
}

/** One frame of the recording taken while the keyboard comes or goes. */
export interface LayoutFrame {
  /** Milliseconds since the first resize of this change. */
  t: number;
  inner: number;
  visual: number;
  rootBottom: number;
  /** document.documentElement.clientHeight. */
  docH: number;
  /** The message box's own top and height: the flash can be the message
   *  box's own background color, so the box itself is watched too, in case it
   *  is the thing that briefly becomes a block. */
  boxTop?: number;
  boxH?: number;
}

export interface KeyboardTrace {
  /** The window grew by more than a keyboard's worth: the keyboard closed. */
  closed: boolean;
  /** The most the app fell short of its own window in any frame. */
  worstRootShort: number;
  /** The most the page's window fell short of the visible area in any frame. */
  worstWindowShort: number;
  /** The keyboard came up. */
  opened: boolean;
  /** The most the message box grew past its height before the keyboard moved. */
  boxGrew: number;
  /** Frames where anything changed, so a short flash shows up as its own rows. */
  frames: LayoutFrame[];
}

/**
 * A settled reading cannot see a flash, which is what actually shows:
 * the block shows for a moment while the keyboard drops and is gone by the time
 * the screen is still. So the phone records every frame for a couple of seconds
 * after a resize, and this sums the recording up. If the page measures whole in
 * every frame of a close, the block is being painted outside the page, by the
 * app's Android window.
 */
export function summarizeKeyboardChange(frames: LayoutFrame[]): KeyboardTrace {
  const kept: LayoutFrame[] = [];
  for (const frame of frames) {
    const last = kept[kept.length - 1];
    if (!last || last.inner !== frame.inner || last.visual !== frame.visual || last.rootBottom !== frame.rootBottom || last.docH !== frame.docH
      || last.boxTop !== frame.boxTop || last.boxH !== frame.boxH) kept.push(frame);
  }
  const first = frames[0];
  const tallest = Math.max(0, ...frames.map((f) => f.inner));
  const shortest = Math.min(...frames.map((f) => f.inner));
  const boxStart = first?.boxH;
  return {
    closed: !!first && tallest - first.inner > 100,
    opened: !!first && first.inner - shortest > 100,
    boxGrew: boxStart === undefined ? 0 : Math.max(0, ...frames.map((f) => (f.boxH ?? boxStart) - boxStart)),
    worstRootShort: Math.max(0, ...frames.map((f) => f.inner - f.rootBottom)),
    worstWindowShort: Math.max(0, ...frames.map((f) => f.visual - f.inner)),
    frames: kept.slice(0, 60),
  };
}

/**
 * The stopwatch on a keyboard move. A color can hide a flash and cannot explain a hold, so each
 * recording also says how long the page took to draw after the move and how
 * busy it was around it: its longest wait between frames, and every long
 * task from two seconds before the move to the end of the recording, as
 * [ms from the move, ms long]. The window opens early on purpose: the page
 * only hears about a resize when it next draws, so a task already running
 * when the keyboard went down is what holds the old picture up, and it ends
 * before the page ever knows. No frames at all is no reading, never zero.
 */
export interface LongTaskEntry {
  start: number;
  duration: number;
}

export interface FrameTiming {
  firstFrameMs: number | null;
  longestFrameMs: number | null;
  tasks: Array<[number, number]>;
  busyMs: number;
  longestTaskMs: number;
}

export function frameTiming(
  start: number,
  frameStamps: number[],
  tasks: LongTaskEntry[],
  window: { before: number; after: number } = { before: 2000, after: 2500 },
): FrameTiming {
  let longest: number | null = null;
  let last = start;
  for (const stamp of frameStamps) {
    longest = Math.max(longest ?? 0, stamp - last);
    last = stamp;
  }
  const from = start - window.before;
  const to = start + window.after;
  const around = tasks
    .filter((k) => k.start + k.duration > from && k.start < to)
    .sort((a, b) => a.start - b.start);
  const inside = (k: LongTaskEntry) => Math.min(k.start + k.duration, to) - Math.max(k.start, from);
  return {
    firstFrameMs: frameStamps.length ? Math.round(frameStamps[0] - start) : null,
    longestFrameMs: longest === null ? null : Math.round(longest),
    tasks: around.slice(0, 10).map((k) => [Math.round(k.start - start), Math.round(k.duration)]),
    busyMs: Math.round(around.reduce((n, k) => n + inside(k), 0)),
    longestTaskMs: Math.round(Math.max(0, ...around.map(inside))),
  };
}
