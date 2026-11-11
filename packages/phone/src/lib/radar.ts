// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The Radar's arithmetic (components/RadarApp.tsx): who spoke last, how near
// that puts them, where each one sits round the dial, and when the sweep
// passes them. Kept apart from the drawing so it can be tested.
import type { Message } from '../types';
import type { Message as StoredMessage } from '../aerie/protocol';
import { splitMessageVoices, type VoiceCompanion } from './voices';

/** The newest time each companion spoke in these messages, by slug. */
export function lastHeardBySlug(messages: Message[], companions: VoiceCompanion[]): Record<string, number> {
  const heard: Record<string, number> = {};
  const wanted = new Set(companions.map((c) => c.slug));
  for (let i = messages.length - 1; i >= 0 && Object.keys(heard).length < wanted.size; i--) {
    const m = messages[i];
    if (m.direction !== 'outbound') continue;
    const at = Date.parse(m.timestamp);
    if (!Number.isFinite(at)) continue;
    const sections = splitMessageVoices(m, companions);
    const slugs = sections
      ? sections.map((s) => s.voice?.slug).filter((s): s is string => !!s)
      : m.companionSlug ? [m.companionSlug] : [];
    for (const slug of slugs) {
      if (wanted.has(slug) && heard[slug] === undefined) heard[slug] = at;
    }
  }
  return heard;
}

/** The store's rows in the shape the voice splitter reads (only what it needs to find a speaker). */
export function asSpoken(rows: StoredMessage[]): Message[] {
  return rows
    .filter((r) => !r.deleted_at && r.content_type === 'text')
    .map((r) => ({
      id: r.id,
      content: r.content,
      timestamp: r.created_at,
      direction: r.role === 'user' ? 'inbound' : 'outbound',
      companionSlug: typeof r.metadata?.companionSlug === 'string' ? (r.metadata.companionSlug as string) : undefined,
    }) as unknown as Message);
}

const RING_MIN = 0.24;
const RING_MAX = 0.84;
const DAY_MIN = 24 * 60;

/** How far out a companion sits, 0 (centre) to 1 (rim): near if they just spoke, out toward the rim the longer they have been quiet. */
export function ringFor(lastHeard: number | undefined, now: number): number {
  if (lastHeard === undefined) return RING_MAX;
  const ageMin = Math.max(0, (now - lastHeard) / 60_000);
  const t = Math.min(1, Math.log1p(ageMin) / Math.log1p(DAY_MIN));
  return RING_MIN + (RING_MAX - RING_MIN) * t;
}

/** Each companion's place round the dial, in degrees clockwise from the top, spread evenly and never lined up with a crosshair. */
export function seatAngle(index: number, count: number): number {
  const n = Math.max(1, count);
  return (((index * 360) / n) - 50 + 360) % 360;
}

/** True when the sweep moved across `angle` going from `prev` to `next` (degrees, clockwise, wrapping at 360). */
export function sweptPast(prev: number, next: number, angle: number): boolean {
  const norm = (a: number) => ((a % 360) + 360) % 360;
  const p = norm(prev), n = norm(next), a = norm(angle);
  if (p === n) return false;
  return p < n ? a > p && a <= n : a > p || a <= n;
}
