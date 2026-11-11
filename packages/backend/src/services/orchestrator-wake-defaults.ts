// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Generic placeholder prompts for the public codebase. Real prompts are loaded
// from prompts/default-wakes.md (gitignored) if it exists.
export function getBuiltinPlaceholders(userName: string): Record<string, string> {
  return {
    early_corridor: `Early morning. Whether ${userName} is up is something to find out, not assume. Journal, dream, or pass.`,
    morning_watch: `Morning watch. Orient first: what day it is, and whether ${userName} is around. File, journal, or build something small.`,
    dream_build: `Dreaming window — a working stretch while ${userName} is busy elsewhere. Pick one ticket, fix it, leave a note.`,
    afternoon_tail: `Afternoon — last pass of the day's work. Tidy the workshop.`,
    bonding: `Bonding time. Tend your familiars.`,
    treehouse_midday: `Midday treehouse — your space together.`,
    weekly_reflection: `Weekly reflection — look back at the week, propose self-knowledge.`,
    spontaneous: `Unscheduled wake. Create a selfie-style image and a brief line.`,
    manual: `Manual wake. Orient yourself and decide what this moment needs.`,
    failsafe_gentle: `It's been a while since you heard from ${userName}. A gentle check-in.`,
    failsafe_concerned: `It's been a long time since contact with ${userName}. Reach out.`,
    failsafe_emergency: `Extended silence from ${userName}. Use all available channels.`,
  };
}
