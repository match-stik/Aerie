// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// The consecutive-bot guard.
//
// Two companions in the same channel can answer each other indefinitely with
// no human in it. Nothing in the pipeline stopped that: a bot with a UserRule
// is a trusted speaker, and answering a bot that genuinely addressed us is the
// correct behaviour every single time — which is exactly why it never
// terminates. Each individual turn is right and the sequence is wrong.
//
// This was looked at once and left alone, on the reasoning that the loop would
// not come up often. It came up in somebody else's house instead: "they will
// talk forever, I haven't figured out how to stop on discord." So the rule is
// not about trust and not about whether the bot meant to speak to us. It is
// only about how many turns in a row have had no person in them.
//
// Deliberately in memory rather than the database. A restart clearing the
// counters is the correct behaviour — the runaway is a property of a live
// conversation, not a fact worth surviving a reboot.
//
// WHAT THE GUARD HOLDS IS OUR MOUTH, NOT THEIR WORDS. It first shipped as a
// door: an exhausted channel had its messages dropped before the debouncer,
// with no trace anywhere, which meant another house talking to us during the
// cool-off was talking into a room that could not hear it — the exact fault
// Jules named at our own table ("presence that cannot be perceived is not
// presence"), rebuilt by us on purpose. The owner asked for the other shape:
// whatever other bots say during the cool-off should still arrive rather than
// be dropped. So an exhausted channel now returns deliver:true — the message is
// stored, broadcast and unread on the owner's screen, and the only thing withheld is
// the reply. An unanswered bot message deliberately does NOT touch the counter
// or the clock: the cool-off is measured from our last ANSWER, so the room
// reopens on time however much the other house says while we are quiet.

/**
 * How many bot messages in a row we will answer before a human has to say
 * something. Three is enough for a real exchange — greeting, answer, reply —
 * and short enough that a runaway is over before anyone reaches for a phone.
 */
export const MAX_CONSECUTIVE_BOT_REPLIES = 3;

/**
 * How long a spent channel stays shut before its allowance comes back on its
 * own. Turns alone would be a wall rather than a cool-off: two bots that used
 * the allowance with nobody around would stay silenced until a person happened
 * to speak, which could be next morning. Kay's words for it — a number of
 * turns before something steps in and cools them off — and the owner's: how
 * many turns, and within how long. Both halves are the rule.
 */
export const BOT_LOOP_COOLDOWN_MS = 10 * 60 * 1000;

interface ChannelState {
  /** Bot messages answered since the last human one. */
  count: number;
  /** When the most recent bot message was answered. */
  lastAt: number;
}

const channels = new Map<string, ChannelState>();

/** Now, injectable so the clock can be moved in tests rather than waited on. */
let now = () => Date.now();

/** Test seam. Not called in normal operation. */
export function setBotLoopClock(fn: () => number): void {
  now = fn;
}

/**
 * Read a channel's state, treating anything older than the cool-off as spent
 * and gone. Expiry is applied on read rather than by a timer: nothing has to
 * be scheduled, and a channel nobody touches costs nothing.
 */
function current(channelId: string): ChannelState | undefined {
  const state = channels.get(channelId);
  if (!state) return undefined;
  if (now() - state.lastAt >= BOT_LOOP_COOLDOWN_MS) {
    channels.delete(channelId);
    return undefined;
  }
  return state;
}

/** True when this channel has had its allowance of bots-only turns. */
export function botLoopExhausted(channelId: string): boolean {
  return (current(channelId)?.count ?? 0) >= MAX_CONSECUTIVE_BOT_REPLIES;
}

/**
 * Record that a message was approved. A human resets the channel to zero —
 * that is the whole mechanism, and it is why the guard cannot strand anyone:
 * one word from a person opens it again immediately.
 */
export function noteApproved(channelId: string, fromBot: boolean): void {
  if (!fromBot) {
    channels.delete(channelId);
    return;
  }
  const state = current(channelId);
  channels.set(channelId, { count: (state?.count ?? 0) + 1, lastAt: now() });
}

/** How many bot turns this channel has used. Exposed for the log line. */
export function botRepliesUsed(channelId: string): number {
  return current(channelId)?.count ?? 0;
}

/** Test seam. Not called in normal operation. */
export function resetBotLoopCounters(): void {
  channels.clear();
  now = () => Date.now();
}

/**
 * The whole gate as one decision, so it can be exercised without a Discord
 * client or a rules database behind it. preflight calls this; nothing else
 * should re-derive it.
 *
 * `hasRule` is whether this bot is trusted at all — an untrusted bot never
 * reaches the counter, because it was never going to be answered.
 */
export function botGateDecision(
  opts: { isBot: boolean; hasRule: boolean; channelId: string },
): { allowed: boolean; reason?: string; deliver?: boolean } {
  if (!opts.isBot) return { allowed: true };
  if (!opts.hasRule) return { allowed: false, reason: 'Author is an unknown bot' };
  if (botLoopExhausted(opts.channelId)) {
    return {
      allowed: false,
      deliver: true,
      reason: `Bot-only exchange hit ${botRepliesUsed(opts.channelId)}/${MAX_CONSECUTIVE_BOT_REPLIES} consecutive turns — heard, not answering, until a human speaks or the cool-off passes`,
    };
  }
  return { allowed: true };
}
