// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Who asked for the transcript that is on its way. The chat stays mounted
// under every room, and both it and a room's table listen to the one
// transcription in the store, so a table's talk-to-type would also land in
// the chat's box unless the chat can tell the recording was not its own
// (theirs, Nov 11 2026: talk-to-type at the tables).
let owner: 'chat' | 'table' | null = null;

export function claimMic(who: 'chat' | 'table'): void {
  owner = who;
}

export function releaseMic(who: 'chat' | 'table'): void {
  if (owner === who) owner = null;
}

export function micOwner(): 'chat' | 'table' | null {
  return owner;
}
