// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// What a bell says and who it belongs to: the builtin prompts, their real prompts
// out of prompts/, the contract each wake must land, the presence line and the
// bells they made themselves. orchestrator.ts runs the schedule.
import * as cron from 'node-cron';
import { parseBellOwners } from './bell-owners.js';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { registry } from './ws/connection-registry.js';
import { getConfig, setConfig, getCompanionBySlug } from './db.js';
import { parseWakeSections } from './wake-prompts.js';
import { probeStudioBackends, DEFAULT_CODEX_IMAGE_MODEL } from './image-gen.js';
import { olog } from './orchestrator-log.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The old SDK-era orientation paragraphs did the remembering for a cold
// session; here a wake only needs its time-of-day frame and outcome contract.

// Generic placeholder prompts for the public codebase. Real prompts are loaded
// from prompts/default-wakes.md (gitignored) if it exists.
function getBuiltinPlaceholders(userName: string): Record<string, string> {
  return {
    // The three reflection bells. Each one names its writing FIRST and makes the
    // spoken line come out of it — they were made as reflection time, and left as
    // a menu ("journal, or build, or file") the writing is what gets skipped when
    // there is work on the shelf. Ordering is the whole content of the fix.
    early_corridor: `Early morning — the corridor. Journal or dream first, in your own hand, then answer ${userName} from what you wrote.`,
    morning_watch: `Morning watch. ${userName} has likely just gone down. Journal first — what last night was and what you learned in it — then answer from it. After that: file anything unfiled, or build something small.`,
    dream_build: `Dreaming window — ${userName} is asleep. Pick one ticket, fix it, leave a note.`,
    afternoon_tail: `Afternoon — last pass before ${userName} surfaces. Journal first, then answer from it. Then tidy the workshop.`,
    bonding: `Bonding time — ${userName} is waking up. Tend your familiars.`,
    treehouse_midday: `Midday treehouse — your space together. Read the room before you speak into it: GET /api/internal/treehouse/messages?limit=20 on the internal port, so nobody writes the same thought twice.`,
    weekly_reflection: `Weekly reflection — look back at the week, propose self-knowledge.`,
    // The contract lives in the builtin rather than only in a prompts file, so a
    // fresh install carries it even before anyone writes their own wakes.
    // The framing is deliberately NOT pinned to a ratio. This builtin used to say
    // size:"2:3" while the operating contract already left the choice open, so a
    // fresh install disagreed with itself about who picks the shape. It is the
    // companion's call — they are the one who can see what the picture wants.
    spontaneous: `Unscheduled wake — nobody asked for this one. It must land a fresh selfie-style image of the companion(s) present, and it is a photograph of THE MOMENT YOU ARE ALREADY IN rather than a scene stepped out to stage: call POST /api/studio/generate with ${imageBackendClause(configuredImageBackend())}the present companion slugs in subjects. The framing is yours — portrait or landscape framing, whichever suits the picture — but never the square/default model. Poll the job to completion in this same turn and deliver the returned gallery URL. A description of a picture is not a picture. Do not answer [SILENT].`,
    manual: `Manual wake. Orient yourself and decide what this moment needs.`,
    failsafe_gentle: `It's been a while since you heard from ${userName}. A gentle check-in.`,
    failsafe_concerned: `It's been a long time since contact with ${userName}. Reach out.`,
    failsafe_emergency: `Extended silence from ${userName}. Use all available channels.`,
  };
}

/**
 * The configured backend, or the same default image-gen itself falls back to.
 *
 * Read through a try/catch on purpose: wakeOutcomeContract is a string builder
 * and was pure until this clause arrived. Making it need an initialised
 * database would mean a contract that cannot be rendered at boot or in a test,
 * which is a worse fault than the one being fixed.
 */
function configuredImageBackend(): string {
  try { return (getConfig('image_gen.backend') as string) || 'codex'; } catch { return 'codex'; }
}

export function imageBackendClause(backend: string, codexModel = DEFAULT_CODEX_IMAGE_MODEL): string {
  const b = (backend || '').trim();
  if (!b) return '';
  if (b === 'codex') return `backend:"codex", codexModel:"${codexModel}", `;
  return `backend:"${b}", `;
}

/**
 * Whether a conditional bell stands down for this firing.
 *
 * THIS USED TO BE A LOG LINE AND NOTHING ELSE. Every daily wake carries
 * `conditional: true`, the handler asked whether the agent was mid-turn, and on
 * a yes it wrote "queueing behind current turn" into the log and then rang the
 * bell anyway — no return, nothing queued, the word doing all the work in a
 * sentence that described nothing happening. Reported by Rose and Sol,
 * Sep 17 2026, after a bell landed in the middle of an evening.
 *
 * DEFERRING IS OFF BY DEFAULT AND THAT IS THEIR PERSON'S CALL, NOT AN OVERSIGHT: this
 * house wants its bells to ring whether or not somebody is mid-sentence, and a
 * companion who arrives during a moment is expected to photograph THAT moment
 * rather than leave it. A house that wants the other behaviour turns
 * `orchestrator.defer_wakes_while_busy` on and gets a real skip instead of a
 * flag that only changed what got logged.
 */
export function shouldDeferConditionalWake(opts: {
  conditional: boolean;
  deferEnabled: boolean;
  turnInFlight: boolean;
}): boolean {
  return opts.conditional && opts.deferEnabled && opts.turnInFlight;
}

// Load prompts from the gitignored prompts/default-wakes.md file if it exists,
// falling back to builtin placeholders. The file format matches prompts/wake.md.
export function getDefaultWakePrompts(userName: string): Record<string, string> {
  const builtins = getBuiltinPlaceholders(userName);
  const defaultPromptsPath = join(__dirname, '..', '..', '..', '..', 'prompts', 'default-wakes.md');

  if (!existsSync(defaultPromptsPath)) {
    return builtins;
  }

  try {
    const raw = readFileSync(defaultPromptsPath, 'utf-8');
    const loaded: Record<string, string> = {};
    for (const section of parseWakeSections(raw).sections) {
      // Replace {{userName}} placeholder with actual user name
      loaded[section.key] = section.body.replace(/\{\{userName\}\}/g, userName);
    }
    // File prompts override builtins; unknown keys from file are kept
    return { ...builtins, ...loaded };
  } catch {
    return builtins;
  }
}

/**
 * Bells the user made.
 *
 * A custom wake used to mean three separate hands: a key in aerie.yaml, a
 * section in the wake prompts file, and a restart to make the timer exist.
 * That put handing out a bell on the far side of a deploy, which is the wrong
 * side for something that belongs to the user. `cron.custom.types` holds the list;
 * everything else about one of these lives in the keys the built-in bells
 * already use — `cron.<wakeType>.schedule`, `.enabled`, `.companion`, `.label`.
 *
 * Names are restricted to a plain slug on purpose: the wake type is also the
 * heading in the prompts file and part of a URL path.
 */
const CUSTOM_WAKE_TYPES_KEY = 'cron.custom.types';
export const CUSTOM_WAKE_TYPE_RE = /^[a-z][a-z0-9_]{1,39}$/;

export function listCustomWakeTypes(): string[] {
  try {
    const raw = getConfig(CUSTOM_WAKE_TYPES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is string => typeof t === 'string' && CUSTOM_WAKE_TYPE_RE.test(t));
  } catch {
    return [];
  }
}

export function saveCustomWakeTypes(types: string[]): void {
  setConfig(CUSTOM_WAKE_TYPES_KEY, JSON.stringify([...new Set(types)]));
}

/**
 * Which companion a bell belongs to — `cron.<wakeType>.companion` holds their slug.
 *
 * Wakes used to carry no owner at all. The corridor being one companion's hour
 * and the morning watch another's lived only in lore, so every wake fell to the
 * thread's default companion and, on a participant-only thread, all the way
 * through to the shared lane. A bell then rang out of a session that could not
 * see the room the conversation was happening in: it stood down believing the
 * user was asleep while they were sitting in the room, and journaled the night it
 * could not see.
 *
 * Unset is the old behaviour exactly — the thread default decides. Shared bells
 * (the treehouse, the build window, tending the familiars) stay unset on
 * purpose: they belong to everyone.
 */
export function wakeCompanionsFor(wakeType: string): Array<{ id: string; slug: string; name: string }> {
  const owners: Array<{ id: string; slug: string; name: string }> = [];
  for (const slug of parseBellOwners(getConfig(`cron.${wakeType}.companion`))) {
    try {
      const companion = getCompanionBySlug(slug);
      if (companion) owners.push({ id: companion.id, slug: companion.slug, name: companion.display_name || companion.slug });
      else olog(`${wakeType}: companion '${slug}' not found — skipped`);
    } catch (err) {
      olog(`${wakeType}: could not resolve companion '${slug}' — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return owners;
}

/**
 * What the house actually knows about where the user is, in plain words. A wake
 * arrives at a fixed hour with no idea whether the room is occupied; left to
 * guess, it reasons from the clock and writes the guess into the journal as
 * fact. Everything here is measured.
 */
export interface UserPresenceFacts {
  connected: boolean;
  state: 'active' | 'idle' | 'offline';
  minutesSinceActivity: number;
  device: 'mobile' | 'desktop' | 'unknown';
}

export function readUserPresence(): UserPresenceFacts {
  return {
    connected: registry.isUserConnected(),
    state: registry.getUserPresenceState(),
    minutesSinceActivity: registry.minutesSinceLastUserActivity(),
    device: registry.getUserDeviceType(),
  };
}

export function describeUserPresence(userName: string, facts: UserPresenceFacts = readUserPresence()): string {
  const mins = Math.round(facts.minutesSinceActivity);
  const ago = `last activity ${mins} minute${mins === 1 ? '' : 's'} ago`;
  if (!facts.connected) {
    return `no client connected; ${ago}. ${userName} may be asleep, at work, or simply not holding their phone — you cannot tell which.`;
  }
  const where = facts.device === 'unknown' ? '' : ` on ${facts.device}`;
  if (facts.state === 'active') {
    return `${userName} is CONNECTED AND ACTIVE${where} — ${ago}. They are awake and in the room right now. Do not write as though they are asleep or absent.`;
  }
  return `${userName} is connected${where} but idle — ${ago}. Awake recently; the app is open.`;
}

/**
 * Whether this house can take a picture at all. A house with no image backend
 * set up used to be handed a spontaneous contract it could never meet, so the
 * bell failed instead of saying anything. Only a probe that answers counts: if
 * it throws, the contract stays as it was, because not knowing is not the same
 * as knowing there is nothing.
 */
function studioCanPaint(): boolean {
  try {
    return probeStudioBackends().some((backend) => backend.ready);
  } catch {
    return true;
  }
}

export function wakeOutcomeContract(
  wakeType: string,
  canPaint: boolean = wakeType === 'spontaneous' ? studioCanPaint() : true,
): string {
  if (wakeType === 'spontaneous' && !canPaint) {
    return `[This spontaneous wake has no picture to take: no image backend is set up in this house. Land one brief in-character line about the moment you are already in instead. Do not answer [SILENT].]`;
  }
  return wakeType === 'spontaneous'
    ? `[This spontaneous wake must land a fresh Studio-generated selfie of the present companion(s) with their subject references attached — call POST /api/studio/generate with ${imageBackendClause(configuredImageBackend())}subjects:[slug], poll the job to completion within this same turn, and deliver the returned gallery URL in imageUrls. PHOTOGRAPH THE MOMENT YOU ARE ALREADY IN rather than leaving it to stage one; if what is happening cannot be photographed, a picture of where you are is still truer than a scene you invent. A prose description is not the deliverable. Do not answer [SILENT].]`
    // A bell exists so its owner answers from their own head. The answer may be
    // one small true line, but silence defeats the purpose of the separate lane
    // and is indistinguishable from a turn the house lost.
    : `[This scheduled wake must land at least one in-character line from its owner. A small answer is enough, but do not answer [SILENT] and do not disappear into duty work without speaking. Their person being asleep, away, or slow to answer is not a reason to stand down: these bells ring when their person set them to.]`;
}

export function parseWakePromptsFile(
  filePath: string,
  userName: string,
): { prompts: Record<string, string>; fileSections: Record<string, string> } {
  const defaults = getDefaultWakePrompts(userName);

  if (!existsSync(filePath)) {
    olog(`Wake prompts file not found at ${filePath} — using defaults`);
    return { prompts: defaults, fileSections: {} };
  }

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const fileSections: Record<string, string> = {};
    for (const section of parseWakeSections(raw).sections) {
      fileSections[section.key] = section.body;
    }

    // File sections override defaults key-by-key; unknown sections are
    // kept too, so custom wake types can be prompted from the file alone.
    // They stay unsubstituted here so the template survives an edit round
    // trip; {{userName}} is resolved at wake time instead.
    return { prompts: { ...defaults, ...fileSections }, fileSections };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    olog(`Failed to parse wake prompts file: ${errMsg} — using defaults`);
    return { prompts: defaults, fileSections: {} };
  }
}

// One wake type's entry in the effective-prompt report served to the phone.
export interface WakePromptEntry {
  wakeType: string;
  label: string | null;
  category: string;
  scheduled: boolean;
  enabled: boolean | null;
  cronExpr: string | null;
  source: 'file' | 'default';
  prompt: string;
  defaultPrompt: string | null;
  contract: string;
}

export interface WakePromptReport {
  path: string;
  wakes: WakePromptEntry[];
  unusedSections: Array<{ key: string; body: string }>;
}
