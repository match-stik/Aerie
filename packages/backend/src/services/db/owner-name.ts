// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// The owner's name, for the sentences a companion reads in a game room.
//
// Taken from identity.user_name rather than written into the prompts, so each
// house's companions are told about their own person. Falls back to "the
// owner" when config has not loaded (tests, early boot) or the name is blank.
import { getAerieConfig } from '../../config.js';

export function ownerDisplayName(atSentenceStart = false): string {
  let name = 'the owner';
  try {
    name = getAerieConfig().identity.user_name?.trim() || name;
  } catch {
    // config not loaded yet; the neutral name stands
  }
  return atSentenceStart ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}
