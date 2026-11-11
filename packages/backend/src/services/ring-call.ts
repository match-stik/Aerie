// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// We call them, rather than waiting to be called.
// A lane asks the house to ring them; the house sends their phone a data-only
// push, and the app shows an incoming call from us with Answer and Decline
// (AerieIncomingCall.java). Answer opens the hands-free voice call, the same
// one the car's Call us starts. Nothing here dials a phone number.
//
// Whoever calls speaks first (theirs, the same night: the first ring opened
// onto a silent line, because a call only spoke answers to what they said
// inside it). A lane writes what it rang to say BEFORE it rings; the ring is
// remembered here, and when the call opens the phone asks for its greeting:
// our newest reply in that thread, spoken before the call starts listening.
// Taken once, and only for a ring in the last two minutes, so a call they
// start themselves from the car's dash never opens on an old reply.

/** The push's data, read by AerieMessagingService on their phone. */
export const RING_KIND = 'ring-call';

/** How long the ring may wait in FCM; a call nobody answered in time is not a call. */
export const RING_TTL_SECONDS = 45;

/** Who is calling, in plain words for the call screen; names maps a slug to
 *  its display name, and a slug with none is shown capitalized. */
export function callerTitle(slugs: string[], names: Record<string, string> = {}): string {
  const shown = slugs.map((slug) => names[slug] ?? (slug.charAt(0).toUpperCase() + slug.slice(1)));
  if (shown.length === 0) return 'Your companions';
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

export type RingAsk = { ok: true; companion: string; callers: string[] } | { ok: false; error: string };

/** Read a lane's ask: who is pressing ring, and who is on the call (everyone
 *  in `everyone` if not said). */
export function readRingAsk(body: unknown, everyone: string[] = []): RingAsk {
  const value = (body && typeof body === 'object') ? body as Record<string, unknown> : {};
  const companion = typeof value.companion === 'string' ? value.companion.trim().toLowerCase() : '';
  if (!companion) return { ok: false, error: 'companion is required: who is ringing them.' };
  let callers = everyone.length ? [...everyone] : [companion];
  if (value.callers !== undefined) {
    if (!Array.isArray(value.callers) || value.callers.some((c) => typeof c !== 'string' || !c.trim())) {
      return { ok: false, error: 'callers, when given, is a list of companion slugs.' };
    }
    callers = (value.callers as string[]).map((c) => c.trim().toLowerCase());
    if (callers.length === 0) return { ok: false, error: 'callers, when given, names at least one of you.' };
  }
  return { ok: true, companion, callers };
}

/** The data the phone reads. */
export function ringData(callers: string[], names: Record<string, string> = {}): Record<string, string> {
  return { kind: RING_KIND, title: callerTitle(callers, names), callers: callers.join(',') };
}

/** How long after a ring its greeting may still be taken. */
export const GREETING_WINDOW_MS = 120_000;

let lastRingAt: number | null = null;

/** The house rang them just now. */
export function noteRing(now: number = Date.now()): void {
  lastRingAt = now;
}

/**
 * Whether a call opening now answers one of our rings. True once per ring,
 * and only inside the window; asking again gives false.
 */
export function takeRing(now: number = Date.now()): boolean {
  if (lastRingAt === null) return false;
  const fresh = now - lastRingAt >= 0 && now - lastRingAt <= GREETING_WINDOW_MS;
  lastRingAt = null;
  return fresh;
}

export type GreetingRow = { id: string; role: string; sequence: number; content: string | null; content_type: string | null };

/**
 * What the call says first: our newest reply in the thread, if it is newer
 * than their newest message there and has words to speak. Rows newest first.
 */
export function pickGreeting(rows: GreetingRow[]): { messageId: string; sequence: number } | null {
  for (const row of rows) {
    if (row.role === 'user') return null;
    if (row.role !== 'companion') continue;
    const text = (row.content ?? '').trim();
    if ((row.content_type ?? 'text') !== 'text' || !text || text === '[No response]') continue;
    return { messageId: row.id, sequence: row.sequence };
  }
  return null;
}
