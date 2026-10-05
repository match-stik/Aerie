// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
//
// What colour a sticky note comes out.
//
// Every note this house has ever left through the internal door was the default
// yellow, including the ones that knew exactly who was writing. The companion
// colours were sitting on their own rows the whole time, and the pin token's own
// test uses two of them as its worked examples. Nobody had wired the door to the
// rows.
//
// A PIN rather than a role, deliberately. A role follows whichever palette the owner is
// looking at, which is right for "quiet" or "urgent" and wrong for a person: a
// companion's navy note that turns green when the owner changes theme has stopped
// being theirs. Their colour is a thing chosen on purpose, and that is precisely what a pin
// is for.
import { normalizeNoteColor, pinnedNoteColorToken } from '@aerie/shared';

/** The yellow a note falls back to when nothing else has a claim on it. */
export const DEFAULT_NOTE_COLOR = '#fef08a';

export function resolveNoteColor(input: {
  /** Whatever the caller asked for — a hex, a role token, a pin, or nothing. */
  explicit?: unknown;
  /** The writing companion's own colour, if the sender resolved to one. */
  senderColor?: string | null;
}): string {
  // An explicit ask always wins: a companion who names a colour meant it.
  const asked = normalizeNoteColor(input.explicit);
  if (asked) return asked;

  // Otherwise a companion signs in their own colour. A note from the shared lane
  // has no single author to sign for, so it keeps the yellow.
  if (input.senderColor) return pinnedNoteColorToken(input.senderColor);

  return DEFAULT_NOTE_COLOR;
}
