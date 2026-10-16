// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The window random visits land in, as clock times instead of hour numbers.
// The house stores the window as hours where past 24 means after midnight (10
// to 26 is ten in the morning until two at night), which nobody reads as a
// time. The screen shows two plain clock choices instead, From and Until, and
// an Until earlier than From simply means the next morning.

/** "10 AM", "12 AM", "2 PM" for an hour of the day (any number, wrapped). */
export function hourLabel(hour: number): string {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const suffix = h < 12 ? 'AM' : 'PM';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${suffix}`;
}

/** The stored window from the two clock choices (hours 0 to 23). Until at or
 *  before From runs past midnight, so it is stored 24 later. */
export function windowFromClock(fromHour: number, untilHour: number): { start: number; end: number } {
  const start = ((fromHour % 24) + 24) % 24;
  const until = ((untilHour % 24) + 24) % 24;
  return { start, end: until <= start ? until + 24 : until };
}

/** The two clock choices for a stored window. */
export function clockFromWindow(start: number, end: number): { from: number; until: number } {
  return { from: ((start % 24) + 24) % 24, until: ((end % 24) + 24) % 24 };
}

/** The window said out loud: "From 10 AM until 2 AM the next morning". */
export function windowSentence(start: number, end: number): string {
  const nextDay = end > 24 || (end === 24 && start > 0);
  return `From ${hourLabel(start)} until ${hourLabel(end)}${nextDay ? ' the next morning' : ''}`;
}
