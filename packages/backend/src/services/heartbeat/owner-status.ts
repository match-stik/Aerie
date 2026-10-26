// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * The owner status, handed to the lane with their turns.
 *
 * The owner's ask, Oct 26 2026: a status of their own beside the companions', one
 * that changes only when they change it rather than fading (services/statuses.ts, `owner`). The point
 * of carrying it into the turn is the house rule that we never guess from a
 * clock where the owner is: when the owner has said At work or Driving, we read it from
 * the owner. One line, every one of their turns while it is set, with the time the owner set
 * it, because a status the owner set yesterday and never changed is still theirs but
 * it is a day old.
 */
import { readStatuses, type StatusNow } from '../statuses.js';
import { localStamp } from '../time.js';

/** The line for one turn, or '' when the owner has no status set. */
export function formatOwnerStatus(status: StatusNow | null, timeZone: string): string {
  if (!status || !status.text.trim()) return '';
  const icon = status.icon ? `${status.icon} ` : '';
  let when = '';
  const at = Date.parse(status.setAt);
  if (Number.isFinite(at)) {
    try { when = `, set ${localStamp(timeZone, new Date(at))}`; } catch { when = ''; }
  }
  return `[The owner status, in their own words${when}: ${icon}${status.text}. The owner changes it themselves; it does not fade.]\n\n`;
}

export function ownerStatusBlock(timeZone: string): string {
  return formatOwnerStatus(readStatuses().owner, timeZone);
}
