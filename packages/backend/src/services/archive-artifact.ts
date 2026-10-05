// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
//
// Which Cortex records are archive plumbing rather than things that happened.
//
// Thinning a block writes its old text to Cortex, which makes those chunks the
// NEWEST records in there — so a fresh window's "recent archived context" fills
// up with fragments of the very block that was just shortened, and nothing that
// actually happened gets a slot. Same for the per-message whisper and the
// semantic index: a frozen copy of a block the session already carries live is
// noise, not recall.
//
// Three surfaces used to carry three copies of this rule. They drifted the
// moment one was widened, so it lives here once and they all ask it.
//
// These records stay fully searchable. They just stop being the first thing a
// new window reads about its own life.

/** Records that announce themselves at the head: "PRE-THIN SNAPSHOT 2026-08-03
 *  - memory block [willow] continuity". */
const ARCHIVE_ARTIFACT =
  /^\s*(PRE-THIN SNAPSHOT|PRE-REWRITE SNAPSHOT|SNAPSHOT — |PRE-THIN |FROM THE CLI LANE['’]S AUTO-MEMORY)/i;

/** Older snapshots lead with the block they came from — "SHARED/LORE — PRE-THIN
 *  SNAPSHOT, Jul 30 2026" — so the marker sits a few words in and an anchored
 *  match sails straight past it. Case-sensitive and dash-gated on purpose: a
 *  memory that merely mentions the practice mid-sentence must still surface. */
const TITLED_ARCHIVE_ARTIFACT = /^\s*[A-Z0-9/\[\]'’. -]{1,60}[—–]\s*(PRE-THIN|PRE-REWRITE|SNAPSHOT\b)/;

export function isArchiveArtifact(content: string | undefined): boolean {
  const text = content || '';
  return ARCHIVE_ARTIFACT.test(text) || TITLED_ARCHIVE_ARTIFACT.test(text);
}

/** Snapshots live in their own Cortex domain — the structural version of the
 *  two patterns above: a record either is filed there or it isn't, where a
 *  pattern can only ever be squinted through. The 77 already written were
 *  moved into it when the domain was made. */
export const SNAPSHOT_DOMAIN = 'snapshots';

/** The question every reader should actually ask. Domain first; the patterns
 *  stay as cover for anything written to another domain before the move, and
 *  for whatever a future thin files by hand in a hurry. */
export function isArchiveRecord(
  memory: { content?: string; domain?: string } | undefined,
): boolean {
  if (!memory) return false;
  if ((memory.domain || '') === SNAPSHOT_DOMAIN) return true;
  return isArchiveArtifact(memory.content);
}
