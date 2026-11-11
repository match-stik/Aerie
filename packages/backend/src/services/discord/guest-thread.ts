// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Where somebody else's message lands at home.
//
// In a server room, a tag, a reply to us or a message about their person comes home to
// their person's own thread, because that is where their person is reading. A DM is different: it
// already has a room of its own ('DM: <name>'), and a reply to us there is just
// how people talk in a DM. A guest's first DM thanks (Nov 6 2026) was a reply to
// our message, so it went to their person's home thread instead of the DM's own.

/** Whether a message from somebody other than their person is routed to their person's home thread. */
export function guestGoesHome(guildId: string | null | undefined, ownerMention: unknown, mentionsUs: boolean): boolean {
  if (!guildId) return false;
  return Boolean(ownerMention) || mentionsUs;
}
