// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A guest's picture, newest first. Each Discord message keeps the link to its
// sender's picture as it was that day, and Discord retires the old link when
// somebody changes their picture, so their older messages fell back to an
// initial. Every message we read tells us the picture its sender had then; a
// bubble shows the newest one we have seen for that person.

const newest = new Map<string, { url: string; at: string }>();

/** Remember the picture a guest had when this message was sent. */
export function noteGuestAvatar(id: string | undefined, url: string | undefined, at: string): void {
  if (!id || !url) return;
  const seen = newest.get(id);
  if (!seen || at > seen.at) newest.set(id, { url, at });
}

/** The newest picture seen for this guest, or the message's own when none is known. */
export function guestAvatar(id: string | undefined, fallback: string | undefined): string | undefined {
  return (id && newest.get(id)?.url) || fallback;
}

/** For tests. */
export function forgetGuestAvatars(): void {
  newest.clear();
}
