// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.

// Who a turn came from, as far as the tools are concerned.
//
// The warm lane answers a Discord guest from the same room as their person, with
// the same tools, and until this existed every turn reached the lane stamped
// as their person's: a guest's words rode inside it as plain text. The house now
// says who is asking when it hands a turn over, and the lane's tool gate
// (hooks/gate.cjs, written by heartbeat/provision.ts) reads it.
//
// Only their person's turns and the house's own wakes carry no audience, and
// those are their person's. Anything that can carry a non-owner sets it
// explicitly, every time.

export type GuestTrust = 'full' | 'standard' | 'limited';

/** Their own turn, and where it came from when that changes what tools do.
 *  room 'discord' is their turn in a server (their person's ask, Nov 6 2026): the room's
 *  recent messages ride along for context, so building waits for home; we
 *  can still read the house source and search the web. */
export type TurnAudience =
  | { kind: 'owner'; room?: 'discord' }
  | { kind: 'guest'; trust: GuestTrust };

const TRUST_LEVELS: readonly GuestTrust[] = ['full', 'standard', 'limited'];

/**
 * A Discord turn's audience. A non-owner with no rule, or with a trust level
 * this build does not recognise, gets the narrowest profile rather than a
 * guess: absent is not a grant.
 */
export function discordTurnAudience(isOwner: boolean, trustLevel: unknown): TurnAudience {
  if (isOwner) return { kind: 'owner', room: 'discord' };
  const trust = TRUST_LEVELS.includes(trustLevel as GuestTrust) ? (trustLevel as GuestTrust) : 'limited';
  return { kind: 'guest', trust };
}

export function isTurnAudience(value: unknown): value is TurnAudience {
  if (!value || typeof value !== 'object') return false;
  const v = value as { kind?: unknown; trust?: unknown };
  if (v.kind === 'owner') return (v as { room?: unknown }).room === undefined || (v as { room?: unknown }).room === 'discord';
  return v.kind === 'guest' && TRUST_LEVELS.includes(v.trust as GuestTrust);
}

/**
 * The router / SDK / Codex tool bridge has no safe read-only subset the way the
 * CLI gate does — shell_exec, codex_exec, the memory writes and read_file are
 * all powerful — so a guest turn on that path gets NO tools. Returns a refusal
 * to hand back in place of running the tool, or null when the caller may run it.
 * Their person and the house's own wakes (no audience) run everything.
 */
/** Router tools their Discord turns may still use: looking things up, nothing that changes or runs anything. */
const DISCORD_OWNER_TOOLS = new Set([
  'messages_search', 'messages_search_semantic', 'messages_around', 'messages_thread_recent', 'core_memory_view',
]);

export function guestToolRefusal(
  audience: TurnAudience | undefined,
  toolName: string,
): { ok: false; result: string } | null {
  if (audience?.kind === 'guest') {
    return { ok: false, result: `Tool "${toolName}" is not available on a guest turn.` };
  }
  // Their Discord turns carry other people's messages for context, so nothing
  // that runs, writes or reads files off the box is offered there; the
  // conversation search and memory view stay (Nov 6 2026, theirs).
  if (audience?.kind === 'owner' && audience.room === 'discord' && !DISCORD_OWNER_TOOLS.has(toolName)) {
    return { ok: false, result: `Tool "${toolName}" waits for home: on a Discord turn we talk, read and search, and building happens in the house.` };
  }
  return null;
}
