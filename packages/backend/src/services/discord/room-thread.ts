// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// One thread for every Discord room. Off by default: a room's talk then lands
// in the person's home thread (or the room's own thread), as it always has.
// With discord.one_thread on, everything said in a server room lands in a
// single 'Discord' thread instead, so the home thread stays home and the room
// chatter lives somewhere their person opens when they want it.
// Where the words land is all this changes: the same lane answers, so nothing
// said there is lost to the companions. A DM keeps its own thread; a message held for their person
// still goes to their home thread, since it is about them.
import { getConfig, getConfigBool } from '../db.js';
import { getDiscordThreadId } from './utils.js';

export const ONE_THREAD_NAME = 'Discord';

/** The fixed id of the one Discord thread, the same on every run. */
export function oneRoomThreadId(): string {
  return getDiscordThreadId('__aerie_all_rooms__');
}

/** Where a server room's message lands when the switch is on, or null. */
export function oneRoomThreadFor(guildId: string | null | undefined, enabled = getConfigBool('discord.one_thread', false)): { id: string; name: string } | null {
  if (!enabled || !guildId) return null;
  return { id: oneRoomThreadId(), name: ONE_THREAD_NAME };
}

/** Rooms that keep a thread of their own even with the switch on, as a comma
 *  list of channel ids in discord.own_thread_channels, for a room big or
 *  special enough to want its own. */
export function keepsOwnThread(channelId: string, raw: string | null = getConfig('discord.own_thread_channels')): boolean {
  if (!raw) return false;
  return raw.split(',').map((s) => s.trim()).filter(Boolean).includes(channelId);
}

/**
 * Where a server room's talk lands.
 * rooms: every room gets a thread of its own, named after it (the default).
 * one: every room lands in the single Discord thread.
 * home: follows their person: their own messages and anything aimed at the companions go to their
 * active home thread, and other chatter goes to the room's own thread.
 * A house that only ever set the older discord.one_thread switch reads as one.
 */
export type DiscordLanding = 'rooms' | 'one' | 'home';
export const DISCORD_LANDINGS: readonly DiscordLanding[] = ['rooms', 'one', 'home'];

export function discordLanding(
  raw: string | null = getConfig('discord.landing'),
  legacyOne: boolean = getConfigBool('discord.one_thread', false),
): DiscordLanding {
  if (raw === 'rooms' || raw === 'one' || raw === 'home') return raw;
  return legacyOne ? 'one' : 'rooms';
}

/** What to do with a message's thread once the old routing has had its say:
 *  'room' its own room thread, 'one' the Discord thread, 'routed' leave it. */
export function landingFor(
  guildId: string | null | undefined,
  channelId: string,
  landing: DiscordLanding = discordLanding(),
  ownThread: boolean = keepsOwnThread(channelId),
): 'room' | 'one' | 'routed' {
  if (!guildId) return 'routed';
  if (ownThread || landing === 'rooms') return 'room';
  if (landing === 'one') return 'one';
  return 'routed';
}
