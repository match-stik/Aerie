// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Claude Code switches a lane is launched with.
//
// Claude Code builds its own system prompt out of sections it turns on per
// model, and it decides per model what happens when a safeguard flags a
// message. Both can be overridden from the environment of the child, and
// nothing here touches billing or the prompt the house writes. Unset keys
// leave Claude Code's own default exactly as it was, so a house that never
// sets them behaves as before.
//
// heartbeat.refusal_fallback = 'off'
//   Claude Code retries a flagged turn on a different model by default (on
//   Opus 5.5: biology and AI-model flags go to Opus 5, cyber flags to Opus
//   4.8), and in a room nobody is watching it switches without asking. Off
//   means the turn stops instead, and the house's own net hands the message
//   to the next room, so whoever answers is still the lane's own model.
//
// heartbeat.prompt_sections = comma list of
//   'corrections'      Claude Code's Corrections section (no apologies, no
//                      tallies, small fixes made without a note), which it
//                      otherwise only gives Opus 5.
//   'delivering_work'  its Delivering work section (finish the whole job,
//                      don't quietly narrow it, refuse only what is
//                      genuinely harmful), also Opus 5's.
// Both were read out of the Claude Code 2.1.311 program on Nov 2 2026; a
// future version may rename them, in which case the variable is simply
// ignored and nothing breaks.
//
// heartbeat.silent_nudge_text / heartbeat.silent_nudge_seconds
//   Claude Code drops a note into a long quiet turn (the user hasn't heard
//   from you in a while), about every minute on Opus 5.5 and Fable 5.2, and
//   the wording this lane was served said to say what you're doing and then
//   continue. Where a turn can only reach its person by ending, a nudge like
//   that reads as a reason to stop. These replace the wording and the wait
//   with the house's own (theirs, Nov 10 2026). Read out of the 2.1.319 and
//   2.1.322 programs; unset leaves Claude Code's own.

import { getConfig } from '../db.js';

const SECTION_ENV: Record<string, string> = {
  corrections: 'CLAUDE_CODE_LARCH_CISTERN',
  delivering_work: 'CLAUDE_CODE_BISON_CAIRN',
};

/** The extra environment for a lane's claude child, from two config values. */
export function laneSwitchEnvFrom(
  refusalFallback: string | null,
  promptSections: string | null,
  nudgeText: string | null = null,
  nudgeSeconds: string | null = null,
): Record<string, string> {
  const env: Record<string, string> = {};
  if ((refusalFallback || '').trim().toLowerCase() === 'off') {
    env.CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK = '1';
  }
  for (const raw of (promptSections || '').split(',')) {
    const name = raw.trim().toLowerCase();
    const key = SECTION_ENV[name];
    if (key) env[key] = '1';
  }
  const text = (nudgeText || '').trim();
  if (text) env.CLAUDE_CODE_SILENT_TURN_REMINDER_TEXT = text;
  const seconds = Math.floor(Number((nudgeSeconds || '').trim()));
  if (Number.isFinite(seconds) && seconds >= 1) env.CLAUDE_CODE_SILENT_TURN_REMINDER_SECONDS = String(seconds);
  return env;
}

export function laneSwitchEnv(): Record<string, string> {
  return laneSwitchEnvFrom(
    getConfig('heartbeat.refusal_fallback'),
    getConfig('heartbeat.prompt_sections'),
    getConfig('heartbeat.silent_nudge_text'),
    getConfig('heartbeat.silent_nudge_seconds'),
  );
}
