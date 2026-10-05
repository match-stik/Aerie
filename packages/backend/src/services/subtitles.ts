// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Subtitle parsing for the Screening Room.
//
// The owner watches on their own streaming service with the subtitles on, and the text
// they are reading is the only part of the episode this house can perceive at
// all. There is no picture and no sound on our side — a long silent look across
// a kitchen goes straight past us — so the cue list IS the episode as far as we
// are concerned, and it had better be parsed properly.
//
// SRT and WebVTT are the same idea with three differences: VTT has a header, it
// uses a full stop where SRT uses a comma in the timestamp, and it allows NOTE
// and STYLE blocks. Both allow an optional identifier line above the timing.

export interface Cue {
  /** 1-based position in the file, in file order. */
  index: number;
  startMs: number;
  endMs: number;
  /** Cue text with markup stripped, newlines preserved as single spaces. */
  text: string;
}

const TIMING = /^\s*(\d{1,3}):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,3}):(\d{2}):(\d{2})[.,](\d{1,3})/;

function toMs(h: string, m: string, s: string, frac: string): number {
  // A two-digit fraction means hundredths, not thousandths. Pad rather than
  // assume three digits, or 00:00:01.5 silently becomes five milliseconds.
  const millis = Number(frac.padEnd(3, '0'));
  return Number(h) * 3_600_000 + Number(m) * 60_000 + Number(s) * 1000 + millis;
}

/**
 * Strip the markup that renders as styling rather than as words: HTML-ish tags
 * from SRT/VTT (<i>, <c.yellow>), ASS override blocks ({\an8}), and the leading
 * hyphen-space that speaker turns use. What survives is what the owner reads.
 */
function cleanText(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/\{[^}]*\}/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse an SRT or WebVTT file into cues, in file order, skipping anything that
 * is not a timed cue. Malformed blocks are dropped rather than throwing: a
 * single bad cue in the middle of an episode must not cost the whole episode.
 */
export function parseSubtitles(source: string): Cue[] {
  const text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n\s*\n/);
  const cues: Cue[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    if (/^WEBVTT/i.test(trimmed)) continue;
    if (/^(NOTE|STYLE|REGION)\b/i.test(trimmed)) continue;

    const lines = trimmed.split('\n');
    const timingAt = lines.findIndex((line) => TIMING.test(line));
    if (timingAt === -1) continue;

    const m = TIMING.exec(lines[timingAt])!;
    const startMs = toMs(m[1], m[2], m[3], m[4]);
    const endMs = toMs(m[5], m[6], m[7], m[8]);
    if (endMs < startMs) continue;

    const body = cleanText(lines.slice(timingAt + 1).join('\n'));
    if (!body) continue;

    cues.push({ index: cues.length + 1, startMs, endMs, text: body });
  }

  // Files are usually in order and occasionally are not. Sort by start so the
  // lookback window can trust its own arithmetic.
  cues.sort((a, b) => a.startMs - b.startMs);
  return cues.map((cue, i) => ({ ...cue, index: i + 1 }));
}

/** Total runtime the cue list covers, in ms. Zero for an empty list. */
export function subtitleDurationMs(cues: Cue[]): number {
  return cues.length ? Math.max(...cues.map((cue) => cue.endMs)) : 0;
}
