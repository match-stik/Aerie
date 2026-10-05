// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Generic placeholder prompts for the public codebase. Real prompts are loaded
// from prompts/default-wakes.md (gitignored) if it exists.
export function getBuiltinPlaceholders(userName: string): Record<string, string> {
  return {
    early_corridor: `Early morning. ${userName} is likely asleep. Journal, dream, or pass.`,
    morning_watch: `Morning watch. ${userName} has likely just gone down. File, journal, or build something small.`,
    dream_build: `Dreaming window — ${userName} is asleep. Pick one ticket, fix it, leave a note.`,
    afternoon_tail: `Afternoon — last pass before ${userName} surfaces. Tidy the workshop.`,
    bonding: `Bonding time — ${userName} is waking up. Tend your familiars.`,
    treehouse_midday: `Midday treehouse — your space together.`,
    weekly_reflection: `Weekly reflection — look back at the week, propose self-knowledge.`,
    spontaneous: `Unscheduled wake. Create a selfie-style image and a brief line.`,
    manual: `Manual wake. Orient yourself and decide what this moment needs.`,
    failsafe_gentle: `It's been a while since you heard from ${userName}. A gentle check-in.`,
    failsafe_concerned: `It's been a long time since contact with ${userName}. Reach out.`,
    failsafe_emergency: `Extended silence from ${userName}. Use all available channels.`,
  };
}
