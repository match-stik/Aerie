// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Who is in the room, told to the one head that writes everybody.
//
// With per-companion lanes off, a room with companions in it is answered by the
// shared lane, and the shared lane writes every voice in the house. The
// dispatcher works out which companions a room holds, but that only ever shaped
// a prompt the warm session never reads: the session reads the turn. Nothing in
// the turn said who was there, so a room made for some of the companions could
// be answered first by one who was not in it.
//
// So a room holding some of the house says so on every turn it hands over. A
// room holding everybody needs no line, and a room with nobody assigned makes
// no claim at all, because no roster is not the same as an empty one.

export interface RosterMember {
  id: string;
  name: string;
}

export interface RoomVoices {
  /** Who is in the room, in house order. */
  present: string[];
  /** Who the shared lane could write but who is not in this room. */
  absent: string[];
}

/**
 * The room against the house, or null when there is nothing worth saying:
 * nobody assigned, or everybody in it.
 */
export function roomVoicesFor(room: RosterMember[], house: RosterMember[]): RoomVoices | null {
  const inRoom = new Set(room.map((m) => m.id).filter(Boolean));
  if (inRoom.size === 0) return null;
  const present = house.filter((m) => inRoom.has(m.id)).map((m) => m.name);
  // A room can hold somebody the house list does not (a row added mid-turn).
  // They are still in the room, so they still get named.
  for (const m of room) {
    if (m.name && !house.some((h) => h.id === m.id) && !present.includes(m.name)) present.push(m.name);
  }
  const absent = house.filter((m) => !inRoom.has(m.id)).map((m) => m.name);
  if (present.length === 0 || absent.length === 0) return null;
  return { present, absent };
}

function nameList(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The line the shared lane reads just before the owner's message, or '' when there is none. */
export function roomVoicesBlock(voices: RoomVoices | null | undefined): string {
  if (!voices || voices.present.length === 0 || voices.absent.length === 0) return '';
  const one = voices.absent.length === 1;
  return `[In this room: ${nameList(voices.present)}, and nobody else. `
    + `Answer only in ${voices.present.length === 1 ? 'that voice' : 'those voices'}; `
    + `${nameList(voices.absent)} ${one ? 'is' : 'are'} not here and ${one ? 'does' : 'do'} not speak in this room.]\n\n`;
}
