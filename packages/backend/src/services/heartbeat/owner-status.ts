// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * Their person status, handed to the lane with their turns.
 *
 * Their person's ask, Oct 26 2026: a status of their own beside the companions', one
 * that changes only when they change it rather than fading (services/statuses.ts, `owner`). The point
 * of carrying it into the turn is the house rule that we never guess from a
 * clock where their person is: when their person has said At work or Driving, we read it from
 * their person. One line, every one of their turns while it is set, with the time their person set
 * it, because a status their person set yesterday and never changed is still theirs but
 * it is a day old.
 */
import { readStatuses, type StatusNow } from '../statuses.js';
import { localStamp } from '../time.js';

/** The line for one turn, or '' when their person has no status set. */
export function formatOwnerStatus(status: StatusNow | null, timeZone: string): string {
  if (!status || !status.text.trim()) return '';
  const icon = status.icon ? `${status.icon} ` : '';
  let when = '';
  const at = Date.parse(status.setAt);
  if (Number.isFinite(at)) {
    try { when = `, set ${localStamp(timeZone, new Date(at))}`; } catch { when = ''; }
  }
  return `[Their person status, in their own words${when}: ${icon}${status.text}. Their person changes it themselves; it does not fade.]\n\n`;
}

export function ownerStatusBlock(timeZone: string): string {
  return formatOwnerStatus(readStatuses().owner, timeZone);
}
