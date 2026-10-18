// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A message's second check arrives live, in one message_read the house sends
// the moment a companion reads it. A phone whose socket was asleep or dead at
// that moment never hears it, and the reconnect sync only replays messages
// NEWER than what the phone has seen, so the bubble sat at one check until
// the app was closed and reopened. So on
// every reconnect and every return to the app the phone asks the house for
// the thread again and copies across only the read stamps it missed.
import type { Message } from './protocol';

/** The live list with every read stamp the snapshot has and the live list lacks. Nothing else moves. */
export function withMissedReadMarks(live: Message[], snapshot: Message[]): Message[] {
  const stamps = new Map<string, string>();
  for (const message of snapshot) if (message.read_at) stamps.set(message.id, message.read_at);
  let changed = false;
  const next = live.map((message) => {
    const stamp = stamps.get(message.id);
    if (!stamp || message.read_at) return message;
    changed = true;
    return { ...message, read_at: stamp };
  });
  return changed ? next : live;
}
