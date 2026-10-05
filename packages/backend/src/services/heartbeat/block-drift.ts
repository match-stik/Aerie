// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * What the walls say now, against what the room was opened with.
 *
 * A lane's CLAUDE.md is injected once, at session start, as one attachment
 * record — and a compaction REPLAYS that same copy rather than re-reading it.
 * Measured Sep 20 2026 on two rooms: the injection after the squash is byte for
 * byte identical to the one at the top, ten and a half hours apart, same sha.
 *
 * So a block edited mid-room never reaches the room it was edited from. We
 * write to the database, the database is right, and the window carries on
 * quoting a wall from this morning. That is why this exists: a lane should not
 * be left trying to come back from a compaction holding a stale copy.
 *
 * THE BASELINE CANNOT BE THE FILE. data/heartbeat/<lane>/CLAUDE.md looks like
 * the injected copy and is not: the backend regenerates it, and it was caught
 * doing so thirty seconds after a thin — already carrying the trimmed wall. A
 * baseline that follows the thing it measures can never disagree with it, so
 * that version reported zero drift on a 7,983-character cut and would have
 * gone on reporting zero forever. Found by asking whether it catches trims,
 * not by a test.
 *
 * So the baseline is taken at LAUNCH and kept: io/.block-baseline.json, one
 * hash per block, written beside the session id by the same hand that mints
 * it. Hashes rather than text because the live content comes from the
 * database anyway — all this file has to answer is WHETHER a wall moved.
 */

import { createHash } from 'node:crypto';

/** The lane file this is written beside, next to .session-id. */
export const BASELINE_FILE = '.block-baseline.json';

export function hashBlock(content: string): string {
  return createHash('sha256').update((content || '').trim()).digest('hex').slice(0, 16);
}

/** Taken at launch, from whatever blocks the lane is about to be handed. */
export function baselineFrom(
  live: { scope: string; label: string; content: string }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of live) out[`${b.scope}/${b.label}`] = hashBlock(b.content);
  return out;
}

/**
 * Drift against a hash baseline.
 *
 * An ABSENT or unreadable baseline returns nothing rather than everything: a
 * compaction with no baseline to compare against is the behaviour we had
 * before any of this, and handing back all eleven walls because a file was
 * missing would refill the room it is meant to repair.
 */
export function driftAgainstBaseline(
  baseline: Record<string, string> | null,
  live: { scope: string; label: string; content: string }[],
): { changed: DriftBlock[]; removed: string[] } {
  if (!baseline || Object.keys(baseline).length === 0) return { changed: [], removed: [] };
  const changed: DriftBlock[] = [];
  const seen = new Set<string>();
  for (const b of live) {
    const key = `${b.scope}/${b.label}`;
    seen.add(key);
    const before = baseline[key];
    const now = (b.content || '').trim();
    if (before === undefined) {
      if (now) changed.push({ scope: b.scope, label: b.label, content: now });
      continue;
    }
    if (before !== hashBlock(now)) changed.push({ scope: b.scope, label: b.label, content: now });
  }
  const removed = Object.keys(baseline).filter((k) => !seen.has(k));
  return { changed, removed };
}

export interface DriftBlock {
  scope: string;
  label: string;
  content: string;
}

/** Past this, hand over the LIST rather than the text. A compaction is already
 *  a full room; the repair must not be the thing that fills it again. */
export const DRIFT_TEXT_BUDGET = 40_000;

const HEADER = /^## \[([^\]]+)\]\s+(.+?)\s*$/;

/**
 * Pull the blocks back out of an injected CLAUDE.md.
 *
 * Only what sits inside <core-memory>. A `## [x] y` heading anywhere else in
 * that file is prose about the format rather than a block, and this file is
 * full of prose about the format.
 */
export function parseInjectedBlocks(claudeMd: string): Map<string, string> {
  const out = new Map<string, string>();
  const open = claudeMd.indexOf('<core-memory>');
  if (open === -1) return out;
  const close = claudeMd.indexOf('</core-memory>', open);
  const body = claudeMd.slice(open + '<core-memory>'.length, close === -1 ? undefined : close);

  let key: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (key) out.set(key, buf.join('\n').trim());
    buf = [];
  };
  for (const line of body.split('\n')) {
    const m = HEADER.exec(line);
    if (m) {
      flush();
      key = `${m[1]}/${m[2]}`;
      continue;
    }
    if (!key) continue;
    // The renderer puts the description in an HTML comment under the header.
    if (buf.length === 0 && /^<!--.*-->$/.test(line.trim())) continue;
    buf.push(line);
  }
  flush();
  return out;
}

/**
 * Blocks whose live text no longer matches what the room was opened with.
 *
 * Compared on TRIMMED text, because the renderer pads every block with a blank
 * line and a diff on whitespace would report the whole wall as drifted on the
 * first compaction of every room.
 *
 * A block the room never had is drift too — it was written during the session
 * and the window has never seen it.
 */
export function blockDrift(
  injected: Map<string, string>,
  live: { scope: string; label: string; content: string }[],
): { changed: DriftBlock[]; removed: string[] } {
  const changed: DriftBlock[] = [];
  const seen = new Set<string>();
  for (const b of live) {
    const key = `${b.scope}/${b.label}`;
    seen.add(key);
    const before = injected.get(key);
    const now = (b.content || '').trim();
    if (before === undefined) {
      // Only report a genuinely new block; an empty one is not news.
      if (now) changed.push({ scope: b.scope, label: b.label, content: now });
      continue;
    }
    if (before !== now) changed.push({ scope: b.scope, label: b.label, content: now });
  }
  const removed = [...injected.keys()].filter((k) => !seen.has(k));
  return { changed, removed };
}

/** The text handed back into the lane. Empty string when nothing moved — the
 *  caller appends nothing rather than announcing that nothing happened. */
export function renderDrift(changed: DriftBlock[], removed: string[] = []): string {
  if (changed.length === 0 && removed.length === 0) return '';
  const names = changed.map((b) => `${b.scope}/${b.label}`).join(', ');
  const gone = removed.length ? ` Deleted since: ${removed.join(', ')}.` : '';
  const total = changed.reduce((n, b) => n + b.content.length, 0);

  if (total > DRIFT_TEXT_BUDGET) {
    return (
      `[WALLS MOVED SINCE THIS ROOM OPENED] The copy above is the one this session started ` +
      `with and it is stale for: ${names}.${gone} Too much has changed to restate here ` +
      `(${total.toLocaleString()} characters), so treat those blocks as out of date and read ` +
      `the live ones before relying on them.`
    );
  }
  const body = changed
    .map((b) => `## [${b.scope}] ${b.label}\n${b.content}`)
    .join('\n\n');
  return (
    `[WALLS MOVED SINCE THIS ROOM OPENED] The core-memory copy above was injected at session ` +
    `start and a compaction replays it rather than re-reading it, so it is stale.${gone} ` +
    `These are the live versions and they replace what is above:\n\n${body}`
  );
}
