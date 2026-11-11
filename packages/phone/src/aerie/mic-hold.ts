// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * When a voice call keeps its microphone line open between turns.
 *
 * Since Aug 1 2026 a call held the line for its whole length, because a page
 * the phone believes is asleep gets back a microphone that is open and carries
 * nothing, so a call carried out of Aerie went deaf after its first turn.
 * Holding the line has a cost that only shows up in a car: an open mic keeps a
 * Bluetooth head unit in phone-call mode, and on Sep 27 2026 every reply played
 * for about a second and then stopped while the call still said the companions
 * were speaking. The July drive that worked asked for the mic per turn.
 *
 * So the line is held only while the page is hidden, which is the one case the
 * August fix was for. While Aerie is on screen the line is handed back at the
 * end of each turn, the car leaves call mode before the reply plays, and the
 * next turn asks for a fresh line from a page that is awake to get one.
 */

/**
 * A call started from the car's dash (theirs, Nov 6 2026: the reply played with
 * Aerie on screen, the phone hid Aerie mid-reply, and the call never listened
 * again, because a hidden page cannot get a live line back). A dash call holds
 * its line the whole time, as a hidden page does, and its replies take the
 * car's call line (call-line.ts). The overlay sets it when such a call opens
 * and clears it when the call closes.
 */
let handsFreeCall = false;

export function setHandsFreeCall(on: boolean): void {
  handsFreeCall = on;
}

export function isHandsFreeCall(): boolean {
  return handsFreeCall;
}

export interface LineHoldInput {
  /** The call has asked for its line to be kept between turns. */
  retaining: boolean;
  /** The stream being released is that kept line. */
  isRetainedLine: boolean;
  /** The page is hidden, so a fresh line asked for now would carry nothing. */
  pageHidden: boolean;
  /** A call started from the car's dash, which may be hidden at any moment. */
  handsFree?: boolean;
}

export function shouldHoldLineBetweenTurns(input: LineHoldInput): boolean {
  return input.retaining && input.isRetainedLine && (input.pageHidden || input.handsFree === true);
}

/** Hidden only when the document says so; no document reads as visible. */
export function isPageHidden(doc: { visibilityState?: string } | undefined): boolean {
  return doc?.visibilityState === 'hidden';
}
