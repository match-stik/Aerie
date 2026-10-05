// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * What a sticky note's stored `color` is allowed to be.
 *
 * A note stores its ROLE now rather than a hex, and looks the paint up in
 * whichever palette is live, so notes re-tint when the owner changes theme. The role
 * names live here rather than in the phone because the AGENT-FACING door
 * (/api/internal/note) has to validate the same set — it used to accept hex
 * only, so a note left by a companion fell back to one hardcoded yellow and was
 * the only note in the app that did not follow the theme.
 */

export const NOTE_ROLES = ['dominant', 'support', 'quiet', 'accent', 'paper'] as const;
export type NoteRole = (typeof NOTE_ROLES)[number];

export const NOTE_ROLE_PREFIX = 'role:';

export function isNoteRole(value: string | null | undefined): boolean {
  if (typeof value !== 'string' || !value.startsWith(NOTE_ROLE_PREFIX)) return false;
  return (NOTE_ROLES as readonly string[]).includes(value.slice(NOTE_ROLE_PREFIX.length));
}

export function noteRoleToken(role: NoteRole): string {
  return `${NOTE_ROLE_PREFIX}${role}`;
}

export function roleFromToken(value: string | null | undefined): NoteRole | null {
  if (!isNoteRole(value)) return null;
  return (value as string).slice(NOTE_ROLE_PREFIX.length) as NoteRole;
}

/**
 * A color the owner pinned ON PURPOSE.
 *
 * A bare hex means "written before roles existed" and gets snapped to the
 * nearest swatch so it follows the theme. That is right for history and wrong
 * for intent: sometimes a note is orange because it is ABOUT the orange thing,
 * and it should stay orange in a room that no longer has orange in it. The
 * prefix is what tells those two apart — without it there is no way to
 * distinguish a note that inherited a colour from one that chose it.
 */
export const NOTE_PIN_PREFIX = 'pin:';

const HEX = /^#[0-9a-fA-F]{3,8}$/;

export function isPinnedNoteColor(value: string | null | undefined): boolean {
  if (typeof value !== 'string' || !value.startsWith(NOTE_PIN_PREFIX)) return false;
  return HEX.test(value.slice(NOTE_PIN_PREFIX.length).trim());
}

export function pinnedNoteColorToken(hex: string): string {
  return `${NOTE_PIN_PREFIX}${hex.trim()}`;
}

/** The literal colour a pin token holds, or null if it is not one. */
export function hexFromPinToken(value: string | null | undefined): string | null {
  if (!isPinnedNoteColor(value)) return null;
  return (value as string).slice(NOTE_PIN_PREFIX.length).trim();
}

/**
 * The one validator for a note colour. Returns what should be STORED, or null
 * when the caller gave us neither a role nor a hex and has to pick a default.
 */
export function normalizeNoteColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (isNoteRole(trimmed)) return trimmed;
  if (isPinnedNoteColor(trimmed)) return trimmed;
  if (HEX.test(trimmed)) return trimmed;
  return null;
}
