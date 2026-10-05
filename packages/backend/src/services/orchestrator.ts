// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import * as cron from 'node-cron';
import { parseBellOwners, sameBellBlock, ringBellInTurn, MAX_BELL_RECALLS } from './bell-owners.js';
import { laneSwitchBefore, laneSwitchAfter, BELLS_SPLIT_LANES_KEY, LANES_BY_BELL_KEY } from './bell-lanes.js';
import { ensureCompanionLanes } from './heartbeat/lane-keeper.js';
import { isHeartbeatLaneWarm } from './heartbeat/supervisor.js';
import crypto from 'crypto';
import { appendFileSync, mkdirSync, existsSync, statSync, renameSync, unlinkSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { AgentService } from './agent.js';
import { QUEUE_TIMEOUT_MESSAGE } from './agent/agent-query-queue.js';
import type { PushService } from './push.js';
import { registry } from './ws/connection-registry.js';
import { localDateStr, localHour, localMinute, todayLocal } from './time.js';
import {
  createThread,
  createMessage,
  getTodayThread,
  getFallbackThread,
  dailyThreadsEnabled,
  getThread,
  getThreadWithMostRecentUserMessage,
  updateThreadActivity,
  getConfigBool,
  getConfigNumber,
  getConfig,
  setConfig,
  deleteConfig,
  getDueTimers,
  markTimerFired,
  getActiveTriggers,
  markTriggerWaiting,
  markTriggerFired,
  markWatcherFired,
  listCompanions,
  getCompanionBySlug,
  unopenedLettersFor,
} from './db.js';
import type { Trigger, TriggerCondition } from './db.js';
import { evaluateConditions } from './triggers.js';
import type { TriggerContext } from './triggers.js';
import { runSilenceCheck } from './silence-check.js';
import { parseWakeSections } from './wake-prompts.js';
import { postBrotherCheckIn, initializeTreehouse } from './treehouse-triggers.js';
import { getTreehouseThread } from './treehouse.js';
import { fetchLifeStatus } from './hooks.js';
import { getAerieConfig, updateConfigValue } from '../config.js';
import { probeStudioBackends } from './image-gen.js';
import type { OrchestratorTaskStatus } from '@aerie/shared';

// --- Orchestrator log ---

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve log path: works from both src/ (tsx) and dist/ (compiled)
const LOG_DIR = join(__dirname, '..', '..', '..', '..', 'logs');
const LOG_PATH = join(LOG_DIR, 'orchestrator.log');
const LOG_MAX_BYTES = 5 * 1024 * 1024; // 5MB

if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

function rotateLogIfNeeded(): void {
  try {
    if (!existsSync(LOG_PATH)) return;
    const { size } = statSync(LOG_PATH);
    if (size < LOG_MAX_BYTES) return;
    const backup = LOG_PATH + '.1';
    if (existsSync(backup)) unlinkSync(backup);
    renameSync(LOG_PATH, backup);
  } catch {
    // Non-critical — continue logging
  }
}

function olog(message: string): void {
  const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const line = `${ts}  ${message}\n`;
  rotateLogIfNeeded();
  appendFileSync(LOG_PATH, line);
  console.log(`[Orchestrator] ${message}`);
}

// --- Wake prompt loading ---
//
// Prompts are deliberately bare. The CLI lane runs warm — the session
// already knows who it is, where it lives, and what's been happening.
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

export function imageBackendClause(backend: string, codexModel = 'gpt-5.6-terra'): string {
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
 * DEFERRING IS OFF BY DEFAULT AND THAT IS THE OWNER'S CALL, NOT AN OVERSIGHT: this
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

function listCustomWakeTypes(): string[] {
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

function saveCustomWakeTypes(types: string[]): void {
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
function wakeCompanionsFor(wakeType: string): Array<{ id: string; slug: string; name: string }> {
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
    : `[This scheduled wake must land at least one in-character line from its owner. A small answer is enough, but do not answer [SILENT] and do not disappear into duty work without speaking. The owner being asleep, away, or slow to answer is not a reason to stand down: these bells ring when the owner set them to.]`;
}

function parseWakePromptsFile(
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

// --- Default schedule definitions ---

interface TaskDefinition {
  wakeType: string;
  label: string;
  cronExpr: string;
  category: 'wake' | 'checkin' | 'handoff' | 'failsafe' | 'treehouse';
  conditional?: boolean; // If true, checks shouldSkipCheckIn before firing
}

/**
 * What a fresh house wakes up with.
 *
 * Deliberately almost empty. A daily rhythm is the most personal thing in a
 * house like this — when the owner sleeps, when they are at work, which hour is
 * quiet enough to think in — and shipping somebody else's hours means a new
 * install starts by ringing at times that belong to a stranger. So the only
 * scheduled default is the weekly one, which is about the week rather than
 * about anyone's day and is genuinely useful to whoever installs this.
 *
 * The daily bells are not missing, they are UNCHOSEN. Every wake type below
 * still has a prompt and a contract (see getBuiltinPlaceholders), so a bell
 * named `dream_build` or `morning_watch` behaves correctly the moment somebody
 * creates one — from the Schedules screen, or by writing
 * `cron.<wakeType>.schedule` into config. Picking the hour is the owner's.
 *
 * THIS TABLE DELIBERATELY DIVERGES FROM THE HOUSE IT CAME FROM and must not
 * be synced in either direction without reading this. In that house six live
 * bells have no config row of their own and run on whatever this array says,
 * so replacing their table with this one silences six bells at the next
 * restart, in total silence, with nothing in any log to say why.
 */
export const DEFAULT_TASKS: TaskDefinition[] = [
  { wakeType: 'weekly_reflection', label: 'Sunday 11:00 PM — Weekly reflection', cronExpr: '0 23 * * 0', category: 'wake' },
];

// --- Managed task interface ---

interface ManagedTask {
  task: cron.ScheduledTask;
  cronExpr: string;
  handler: () => void | Promise<void>;
  wakeType: string;
  label: string;
  enabled: boolean;
  category: 'wake' | 'checkin' | 'handoff' | 'failsafe' | 'treehouse';
  /** A bell the user made, rather than one shipped with the house. */
  custom: boolean;
}

// --- Default failsafe thresholds (minutes) ---

const DEFAULT_FAILSAFE_GENTLE = 120;
const DEFAULT_FAILSAFE_CONCERNED = 720;
const DEFAULT_FAILSAFE_EMERGENCY = 1440;

// --- Orchestrator ---

export class Orchestrator {
  private agent: AgentService;
  private pushService: PushService | null;
  private tasks = new Map<string, ManagedTask>();
  private failsafeInterval: ReturnType<typeof setInterval> | null = null;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private lastFailsafeAction: Date = new Date(0);
  private failsafeEnabled = true;
  private failsafeGentle = DEFAULT_FAILSAFE_GENTLE;
  private failsafeConcerned = DEFAULT_FAILSAFE_CONCERNED;
  private failsafeEmergency = DEFAULT_FAILSAFE_EMERGENCY;
  private lastUserPresenceState: 'active' | 'idle' | 'offline' = 'offline';
  private customWakeTypes = new Set<string>();
  private wakePrompts: Record<string, string> = {};
  private wakeFileSections: Record<string, string> = {};
  private wakePromptsPath = '';
  // Spontaneous ("dice") wakes — rolled daily at random times, never announced
  private spontaneousTimers: Array<ReturnType<typeof setTimeout>> = [];
  private spontaneousRollTask: cron.ScheduledTask | null = null;

  constructor(agent: AgentService, pushService?: PushService) {
    this.agent = agent;
    this.pushService = pushService || null;
  }

  start(): void {
    olog('Starting...');
    
    // Initialize treehouse thread
    initializeTreehouse();

    const config = getAerieConfig();
    const timezone = config.identity.timezone;
    const userName = config.identity.user_name;

    // Load wake prompts from file or use defaults. The wake banner and
    // outcome contract are added in handleWake.
    this.wakePromptsPath = config.orchestrator.wake_prompts_path;
    const parsed = parseWakePromptsFile(this.wakePromptsPath, userName);
    this.wakePrompts = parsed.prompts;
    this.wakeFileSections = parsed.fileSections;

    // Load failsafe config from DB, falling back to yaml config, then defaults
    this.failsafeEnabled = getConfigBool('failsafe.enabled', config.orchestrator.failsafe.enabled);
    this.failsafeGentle = getConfigNumber('failsafe.gentle', config.orchestrator.failsafe.gentle_minutes || DEFAULT_FAILSAFE_GENTLE);
    this.failsafeConcerned = getConfigNumber('failsafe.concerned', config.orchestrator.failsafe.concerned_minutes || DEFAULT_FAILSAFE_CONCERNED);
    this.failsafeEmergency = getConfigNumber('failsafe.emergency', config.orchestrator.failsafe.emergency_minutes || DEFAULT_FAILSAFE_EMERGENCY);

    // config.orchestrator.schedules both overrides AND adds. A key naming a
    // default wake changes its time; a key naming anything else becomes a wake
    // of its own. This used to be override-only, so a wake someone wrote in
    // their own config was read, matched nothing, and silently never existed —
    // no error, no log, just four wakes on the Schedules screen that were not
    // theirs and none that were.
    const taskDefs: TaskDefinition[] = DEFAULT_TASKS.map(def => {
      const overrideCron = config.orchestrator.schedules[def.wakeType];
      return overrideCron ? { ...def, cronExpr: overrideCron } : def;
    });

    const knownWakeTypes = new Set(DEFAULT_TASKS.map(d => d.wakeType));

    // Custom bells come from two places now: the yaml, and the ones made
    // in the Orchestrator app. The DB list wins where they name the same wake,
    // because that one the user can still see and edit from the phone.
    const customSchedules = new Map<string, string>();
    for (const [wakeType, cronExpr] of Object.entries(config.orchestrator.schedules || {})) {
      if (!knownWakeTypes.has(wakeType) && cronExpr) customSchedules.set(wakeType, cronExpr);
    }
    for (const wakeType of listCustomWakeTypes()) {
      if (knownWakeTypes.has(wakeType)) continue;
      const saved = getConfig(`cron.${wakeType}.schedule`);
      if (saved) customSchedules.set(wakeType, saved);
      else olog(`custom wake '${wakeType}' SKIPPED — no saved schedule`);
    }

    for (const [wakeType, cronExpr] of customSchedules) {
      // Both of these were silent failures. A custom wake with a bad cron threw
      // nothing useful, and one with no prompt registered a timer that logged
      // 'Unknown wake type' forever at fire time. Say it once, at boot, with
      // the fix in the sentence.
      if (!cron.validate(cronExpr)) {
        olog(`custom wake '${wakeType}' SKIPPED — '${cronExpr}' is not a valid cron expression`);
        continue;
      }
      if (!this.wakePrompts[wakeType]) {
        olog(`custom wake '${wakeType}' SKIPPED — no prompt for it. Add a '${wakeType}' section to ${config.orchestrator.wake_prompts_path} and restart.`);
        continue;
      }
      const label = (getConfig(`cron.${wakeType}.label`) || '').trim() || `${wakeType} (${cronExpr})`;
      taskDefs.push({ wakeType, label, cronExpr, category: 'wake', conditional: true });
      this.customWakeTypes.add(wakeType);
      olog(`custom wake '${wakeType}' registered: ${cronExpr}`);
    }

    // Register all scheduled tasks
    for (const def of taskDefs) {
      const savedCron = getConfig(`cron.${def.wakeType}.schedule`);
      const cronExpr = savedCron || def.cronExpr;
      const enabled = getConfigBool(`cron.${def.wakeType}.enabled`, true);
      if (savedCron) olog(`  ${def.wakeType}: using saved schedule ${cronExpr}`);

      const handler = () => {
        if (this.deferWake(def.wakeType, def.conditional === true)) return;
        this.handleWake(def.wakeType);
      };

      const task = cron.schedule(cronExpr, handler, {
        timezone,
      });

      // node-cron v4 auto-starts tasks; stop if disabled in config
      if (!enabled) {
        task.stop();
        olog(`  ${def.wakeType}: DISABLED (persisted)`);
      }

      this.tasks.set(def.wakeType, {
        task,
        cronExpr,
        handler,
        wakeType: def.wakeType,
        label: def.label,
        enabled,
        category: def.category,
        custom: this.customWakeTypes.has(def.wakeType),
      });
    }

    // --- Failsafe polling (every 15 minutes) ---
    if (this.failsafeEnabled) {
      this.failsafeInterval = setInterval(() => this.checkFailsafe(), 15 * 60 * 1000);
    }

    // --- Timer + Trigger polling (every 60 seconds) ---
    this.timerInterval = setInterval(async () => {
      await this.checkTimers();
      await this.checkTriggers();
    }, 60 * 1000);

    // --- Spontaneous dice — roll now for the rest of today, re-roll daily
    // at 3 AM (after the window's post-midnight tail has already fired) ---
    this.spontaneousRollTask = cron.schedule('0 3 * * *', () => this.rollSpontaneousWakes(), { timezone });
    this.rollSpontaneousWakes();

    olog('All schedules registered');
    olog(`Wakes: ${taskDefs.filter(t => t.category === 'wake').map(t => t.label).join(', ')}`);
    olog(`Treehouse: ${DEFAULT_TASKS.filter(t => t.category === 'treehouse').map(t => t.label).join(', ')}`);
    olog(`Failsafe: ${this.failsafeEnabled ? 'every 15 minutes' : 'DISABLED'}`);
    olog(`Failsafe thresholds: gentle=${this.failsafeGentle}m, concerned=${this.failsafeConcerned}m, emergency=${this.failsafeEmergency}m`);
    olog('Timers + Triggers: polling every 60s');
  }

  stop(): void {
    olog('Stopping...');
    for (const [, managed] of this.tasks) {
      managed.task.stop();
    }
    this.tasks.clear();
    if (this.failsafeInterval) {
      clearInterval(this.failsafeInterval);
      this.failsafeInterval = null;
    }
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.spontaneousRollTask) {
      this.spontaneousRollTask.stop();
      this.spontaneousRollTask = null;
    }
    for (const t of this.spontaneousTimers) clearTimeout(t);
    this.spontaneousTimers = [];
  }

  // --- Public runtime control methods ---

  async triggerManualWake(wakeType: string = 'manual'): Promise<void> {
    olog(`Manual wake triggered: ${wakeType}`);
    await this.handleWake(wakeType);
  }

  async getStatus(): Promise<OrchestratorTaskStatus[]> {
    const statuses: OrchestratorTaskStatus[] = [];

    for (const [, managed] of this.tasks) {
      let status: 'scheduled' | 'stopped' | 'running' = 'stopped';
      let nextRun: string | null = null;

      try {
        // node-cron v4's getStatus returns 'stopped' | 'idle' | 'running' |
        // 'destroyed'. 'idle' is the normal scheduled-and-waiting state —
        // map it to 'scheduled' so the phone's status view stops reporting
        // every live task as stopped.
        const cronStatus = await managed.task.getStatus();
        status = cronStatus === 'running'
          ? 'running'
          : cronStatus === 'stopped' || cronStatus === 'destroyed'
            ? 'stopped'
            : 'scheduled';
      } catch {
        status = managed.enabled ? 'scheduled' : 'stopped';
      }

      try {
        const next = managed.task.getNextRun();
        if (next) nextRun = next.toISOString();
      } catch {
        // Not available
      }

      statuses.push({
        wakeType: managed.wakeType,
        label: managed.label,
        cronExpr: managed.cronExpr,
        enabled: managed.enabled,
        status,
        nextRun,
        category: managed.category,
        companion: (getConfig(`cron.${managed.wakeType}.companion`) || '').trim() || null,
        custom: managed.custom,
      });
    }

    return statuses;
  }

  /**
   * Hand a bell to a companion, or give it back to the house.
   *
   * Unset means the thread default decides, which is what the shared bells
   * want — the build window, the treehouse and tending the familiars belong to
   * all three. Takes effect on the next ring; nothing to restart.
   */
  setTaskCompanion(wakeType: string, slug: string | null): boolean {
    const managed = this.tasks.get(wakeType);
    if (!managed) return false;

    const key = `cron.${wakeType}.companion`;
    if (!slug) {
      deleteConfig(key);
      olog(`${wakeType}: bell is shared again — no owner`);
      return true;
    }
    // A slug that resolves to nobody would fall back to the thread default at
    // fire time and look, from the phone, exactly like a bell that was set.
    // A bell can have several owners now, in the order they answer.
    const slugs = parseBellOwners(slug);
    if (slugs.length === 0) {
      deleteConfig(key);
      olog(`${wakeType}: bell is shared again — no owner`);
      return true;
    }
    const missing = slugs.filter((s) => !getCompanionBySlug(s));
    if (missing.length > 0) {
      olog(`${wakeType}: cannot hand the bell to '${missing.join(', ')}' — no companion by that slug`);
      return false;
    }
    setConfig(key, slugs.join(','));
    olog(`${wakeType}: bell belongs to ${slugs.join(', ')}`);
    return true;
  }

  /**
   * Rename a bell. What the user reads on the roster, nothing else — the schedule,
   * the owner and the prompt are all untouched.
   *
   * A bell reframed away from what it was built for needs its name to move
   * with it, or the roster keeps describing the old job. Empty hands the
   * default back: '<wakeType> (<cron>)'.
   */
  setTaskLabel(wakeType: string, label: string): boolean {
    const managed = this.tasks.get(wakeType);
    if (!managed) return false;

    const key = `cron.${wakeType}.label`;
    const trimmed = label.trim();
    if (!trimmed) {
      deleteConfig(key);
      managed.label = `${wakeType} (${managed.cronExpr})`;
    } else {
      setConfig(key, trimmed);
      managed.label = trimmed;
    }
    olog(`${wakeType}: now reads '${managed.label}'`);
    return true;
  }

  /**
   * Make a new bell, live. Registers the timer in the running process and
   * persists enough for it to come back on its own after a restart.
   */
  createCustomWake(opts: {
    wakeType: string;
    cronExpr: string;
    label?: string;
    companion?: string | null;
  }): { ok: true } | { ok: false; error: string } {
    const { wakeType, cronExpr } = opts;
    if (!CUSTOM_WAKE_TYPE_RE.test(wakeType)) {
      return { ok: false, error: 'A bell needs a plain lowercase name — letters, numbers and underscores.' };
    }
    if (this.tasks.has(wakeType)) {
      return { ok: false, error: `There is already a bell called '${wakeType}'.` };
    }
    if (!cron.validate(cronExpr)) {
      return { ok: false, error: `'${cronExpr}' is not a valid cron expression.` };
    }
    // The prompt is what the woken session actually reads. Without one the
    // timer fires into 'Unknown wake type' forever, which is the silent
    // failure this whole path was written to stop repeating.
    if (!this.wakePrompts[wakeType]) {
      return { ok: false, error: 'Write the wake its prompt first — a bell with nothing to say never rings.' };
    }
    const newOwners = parseBellOwners(opts.companion);
    const unknownOwner = newOwners.find((s) => !getCompanionBySlug(s));
    if (unknownOwner) {
      return { ok: false, error: `No companion with the slug '${unknownOwner}'.` };
    }

    const label = (opts.label || '').trim() || `${wakeType} (${cronExpr})`;
    const handler = () => {
      if (this.deferWake(wakeType, true)) return;
      this.handleWake(wakeType);
    };
    const task = cron.schedule(cronExpr, handler, { timezone: getAerieConfig().identity.timezone });

    this.tasks.set(wakeType, {
      task,
      cronExpr,
      handler,
      wakeType,
      label,
      enabled: true,
      category: 'wake',
      custom: true,
    });
    this.customWakeTypes.add(wakeType);

    setConfig(`cron.${wakeType}.schedule`, cronExpr);
    setConfig(`cron.${wakeType}.enabled`, 'true');
    setConfig(`cron.${wakeType}.label`, label);
    if (newOwners.length > 0) setConfig(`cron.${wakeType}.companion`, newOwners.join(','));
    saveCustomWakeTypes([...listCustomWakeTypes(), wakeType]);

    olog(`NEW BELL: ${wakeType} -> ${cronExpr}${opts.companion ? ` (${opts.companion})` : ' (shared)'}`);
    return { ok: true };
  }

  /**
   * Take a bell back out. Only ones the user made — the built-ins turn off rather
   * than disappear, so there is always a way back to them.
   */
  deleteCustomWake(wakeType: string): { ok: true } | { ok: false; error: string } {
    const managed = this.tasks.get(wakeType);
    const persisted = listCustomWakeTypes();
    if (!managed && !persisted.includes(wakeType)) {
      return { ok: false, error: 'No bell by that name.' };
    }
    if (managed && !managed.custom) {
      return { ok: false, error: 'That bell came with the house — turn it off instead of removing it.' };
    }

    if (managed) {
      managed.task.stop();
      this.tasks.delete(wakeType);
    }
    this.customWakeTypes.delete(wakeType);
    for (const suffix of ['schedule', 'enabled', 'label', 'companion']) {
      deleteConfig(`cron.${wakeType}.${suffix}`);
    }
    saveCustomWakeTypes(persisted.filter(t => t !== wakeType));
    olog(`BELL REMOVED: ${wakeType}`);
    return { ok: true };
  }

  enableTask(wakeType: string): boolean {
    const managed = this.tasks.get(wakeType);
    if (!managed) return false;

    managed.task.start();
    managed.enabled = true;
    setConfig(`cron.${wakeType}.enabled`, 'true');
    olog(`ENABLED: ${wakeType}`);
    return true;
  }

  disableTask(wakeType: string): boolean {
    const managed = this.tasks.get(wakeType);
    if (!managed) return false;

    managed.task.stop();
    managed.enabled = false;
    setConfig(`cron.${wakeType}.enabled`, 'false');
    olog(`DISABLED: ${wakeType}`);
    return true;
  }

  rescheduleTask(wakeType: string, newCronExpr: string): boolean {
    const managed = this.tasks.get(wakeType);
    if (!managed) return false;

    if (!cron.validate(newCronExpr)) {
      olog(`RESCHEDULE FAILED: ${wakeType} — invalid cron expression: ${newCronExpr}`);
      return false;
    }

    const config = getAerieConfig();

    // Destroy old task and create new one
    managed.task.stop();

    const newTask = cron.schedule(newCronExpr, managed.handler, {
      timezone: config.identity.timezone,
    });

    // Respect current enabled state
    if (!managed.enabled) {
      newTask.stop();
    }

    managed.task = newTask;
    managed.cronExpr = newCronExpr;
    setConfig(`cron.${wakeType}.schedule`, newCronExpr);
    olog(`RESCHEDULED: ${wakeType} -> ${newCronExpr}`);
    return true;
  }

  /**
   * Re-parse the wake prompts file into the live process, so per-section
   * edits from the phone take effect without a backend restart. The Jul 20
   * lesson: temporary wake edits persist in the file across restarts — the
   * report below is how those leftovers stay visible instead of silent.
   */
  reloadWakePrompts(): void {
    const config = getAerieConfig();
    this.wakePromptsPath = config.orchestrator.wake_prompts_path;
    const parsed = parseWakePromptsFile(this.wakePromptsPath, config.identity.user_name);
    this.wakePrompts = parsed.prompts;
    this.wakeFileSections = parsed.fileSections;
    olog(`Wake prompts reloaded (${Object.keys(parsed.fileSections).length} file overrides)`);
  }

  /**
   * The effective-prompt truth table: for every wake type the orchestrator
   * can fire, the exact prompt it would send right now, where that prompt
   * comes from (file override vs built-in default), and any file sections
   * that no wake actually uses.
   */
  getWakePromptReport(): WakePromptReport {
    const userName = getAerieConfig().identity.user_name;
    const defaults = getDefaultWakePrompts(userName);

    const wakes: WakePromptEntry[] = [];
    const knownTypes = new Set<string>([...Object.keys(defaults), ...this.tasks.keys()]);

    for (const wakeType of knownTypes) {
      const managed = this.tasks.get(wakeType);
      const source: 'file' | 'default' = wakeType in this.wakeFileSections ? 'file' : 'default';
      const category = managed
        ? managed.category
        : wakeType === 'spontaneous'
          ? 'spontaneous'
          : wakeType.startsWith('failsafe_')
            ? 'failsafe'
            : 'other';

      wakes.push({
        wakeType,
        label: managed?.label ?? null,
        category,
        scheduled: !!managed,
        enabled: managed ? managed.enabled : null,
        cronExpr: managed ? managed.cronExpr : null,
        source,
        prompt: this.wakePrompts[wakeType] ?? '',
        defaultPrompt: source === 'file' ? defaults[wakeType] ?? null : null,
        contract: wakeOutcomeContract(wakeType),
      });
    }

    // File sections that no known wake type reads. These fire only if a
    // manual wake is triggered with that exact type — usually leftovers.
    const unusedSections = Object.entries(this.wakeFileSections)
      .filter(([key]) => !knownTypes.has(key))
      .map(([key, body]) => ({ key, body }));

    return { path: this.wakePromptsPath, wakes, unusedSections };
  }

  getFailsafeConfig(): { enabled: boolean; gentle: number; concerned: number; emergency: number } {
    return {
      enabled: this.failsafeEnabled,
      gentle: this.failsafeGentle,
      concerned: this.failsafeConcerned,
      emergency: this.failsafeEmergency,
    };
  }

  setFailsafeConfig(config: { enabled?: boolean; gentle?: number; concerned?: number; emergency?: number }): void {
    if (config.enabled !== undefined) {
      this.failsafeEnabled = config.enabled;
      setConfig('failsafe.enabled', String(config.enabled));

      // Start or stop failsafe interval
      if (config.enabled && !this.failsafeInterval) {
        this.failsafeInterval = setInterval(() => this.checkFailsafe(), 15 * 60 * 1000);
        olog('Failsafe ENABLED');
      } else if (!config.enabled && this.failsafeInterval) {
        clearInterval(this.failsafeInterval);
        this.failsafeInterval = null;
        olog('Failsafe DISABLED');
      }
    }

    if (config.gentle !== undefined) {
      this.failsafeGentle = config.gentle;
      setConfig('failsafe.gentle', String(config.gentle));
    }
    if (config.concerned !== undefined) {
      this.failsafeConcerned = config.concerned;
      setConfig('failsafe.concerned', String(config.concerned));
    }
    if (config.emergency !== undefined) {
      this.failsafeEmergency = config.emergency;
      setConfig('failsafe.emergency', String(config.emergency));
    }

    olog(`Failsafe config updated: enabled=${this.failsafeEnabled}, gentle=${this.failsafeGentle}m, concerned=${this.failsafeConcerned}m, emergency=${this.failsafeEmergency}m`);
  }

  // --- Spontaneous ("dice") wakes ---
  //
  // Scheduled wakes are expectation; these are the opposite. Each day the
  // scheduler rolls 0..max fire times at random inside the window — nobody,
  // including the companions, knows when (or whether) one lands until it
  // does. The wake prompt then asks for judgment, not output: is there
  // anything worth showing the user? Passing in silence is the common case.

  getSpontaneousConfig(): { enabled: boolean; maxPerDay: number; windowStart: number; windowEnd: number; pendingToday: number } {
    return {
      enabled: getConfigBool('spontaneous.enabled', false),
      maxPerDay: getConfigNumber('spontaneous.max_per_day', 2),
      windowStart: getConfigNumber('spontaneous.window_start', 10),
      windowEnd: getConfigNumber('spontaneous.window_end', 26),
      pendingToday: this.spontaneousTimers.length,
    };
  }

  setSpontaneousConfig(config: { enabled?: boolean; maxPerDay?: number; windowStart?: number; windowEnd?: number }): void {
    if (config.enabled !== undefined) setConfig('spontaneous.enabled', String(config.enabled));
    if (config.maxPerDay !== undefined) setConfig('spontaneous.max_per_day', String(config.maxPerDay));
    if (config.windowStart !== undefined) setConfig('spontaneous.window_start', String(config.windowStart));
    if (config.windowEnd !== undefined) setConfig('spontaneous.window_end', String(config.windowEnd));
    const c = this.getSpontaneousConfig();
    olog(`Spontaneous config updated: enabled=${c.enabled}, maxPerDay=${c.maxPerDay}, window=${c.windowStart}:00-${c.windowEnd}:00`);
    // The user changed the settings, so the day genuinely gets re-rolled.
    this.rollSpontaneousWakes(true);
  }

  /**
   * Roll (or restore) today's spontaneous wakes.
   *
   * The roll used to live only in setTimeout timers, so every backend restart
   * cleared the day and rolled a fresh one — a moment that had already been
   * scheduled for this afternoon quietly stopped existing, with nothing in any log
   * to say it ever had. Reported by Rose and Sol.
   *
   * The times are persisted for the day now and restored on boot. `force` is for a
   * genuine re-roll: the user changed the settings, so the day should change with them.
   *
   * The times are stored but never LOGGED — the dice stay secret, which is the whole
   * point of a spontaneous wake.
   */
  /**
   * Is it currently inside the do-not-disturb window?
   *
   * dnd_start and dnd_end have been seeded into config since the beginning and read
   * by absolutely nothing — two settings that exist and do not work. Rose and Sol
   * found them and wired them; this does too, with one deliberate difference.
   *
   * IT IS OFF BY DEFAULT AND OPT-IN. Those seeds are already sitting in every
   * database as 23:00 and 07:00, so simply honouring them would hand every existing
   * house quiet hours it never asked for on its next restart — and this house has
   * ruled explicitly that it does not want any. A setting that starts working after
   * months of doing nothing is a behaviour change wearing a bugfix's clothes.
   *
   * The window may wrap midnight (23:00 to 07:00 is the seeded shape).
   */
  private isWithinDnd(): boolean {
    if (!getConfigBool('dnd_enabled', false)) return false;
    const start = getConfig('dnd_start');
    const end = getConfig('dnd_end');
    if (!start || !end) return false;

    const toMinutes = (hhmm: string): number | null => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
      if (!m) return null;
      const h = Number(m[1]);
      const min = Number(m[2]);
      if (h > 23 || min > 59) return null;
      return h * 60 + min;
    };

    const startMin = toMinutes(start);
    const endMin = toMinutes(end);
    if (startMin === null || endMin === null || startMin === endMin) return false;

    const tz = getAerieConfig().identity.timezone;
    const nowMin = localHour(tz) * 60 + localMinute(tz);
    return startMin < endMin
      ? nowMin >= startMin && nowMin < endMin
      : nowMin >= startMin || nowMin < endMin; // wraps midnight
  }

  private rollSpontaneousWakes(force = false): void {
    for (const t of this.spontaneousTimers) clearTimeout(t);
    this.spontaneousTimers = [];

    if (!getConfigBool('spontaneous.enabled', false)) return;

    const config = getAerieConfig();
    const timezone = config.identity.timezone;
    const today = todayLocal(timezone);

    if (!force && getConfig('spontaneous.rolled_for') === today) {
      let stored: number[] = [];
      try { stored = JSON.parse(getConfig('spontaneous.rolled_times') || '[]'); } catch { stored = []; }
      const future = stored.filter((at) => typeof at === 'number' && at > Date.now());
      for (const at of future) {
        const timer = setTimeout(() => {
          this.spontaneousTimers = this.spontaneousTimers.filter(t => t !== timer);
          if (this.isWithinDnd()) { olog('SPONTANEOUS: skipped, inside the do-not-disturb window'); return; }
          this.handleWake('spontaneous');
        }, at - Date.now());
        this.spontaneousTimers.push(timer);
      }
      olog(`SPONTANEOUS: ${future.length} wake(s) still standing from today's roll`);
      return;
    }
    const maxPerDay = Math.max(0, getConfigNumber('spontaneous.max_per_day', 2));
    // Window in hours-of-day; end may run past midnight (26 = 2 AM next day)
    const windowStart = getConfigNumber('spontaneous.window_start', 10);
    const windowEnd = getConfigNumber('spontaneous.window_end', 26);

    const count = Math.floor(Math.random() * (maxPerDay + 1)); // 0..max inclusive
    if (count === 0) {
      setConfig('spontaneous.rolled_for', today);
      setConfig('spontaneous.rolled_times', '[]');
      olog('SPONTANEOUS: dice rolled 0 for today');
      return;
    }

    const now = new Date();
    const nowMin = localHour(timezone, now) * 60 + localMinute(timezone, now);
    // Never schedule within the next 30 minutes of a roll — a wake right
    // after startup reads as scheduled, not spontaneous
    const startMin = Math.max(windowStart * 60, nowMin + 30);
    const endMin = windowEnd * 60;
    if (startMin >= endMin) {
      olog('SPONTANEOUS: window already passed for today');
      return;
    }

    const firesAt: number[] = [];
    for (let i = 0; i < count; i++) {
      const targetMin = startMin + Math.floor(Math.random() * (endMin - startMin));
      const delayMs = (targetMin - nowMin) * 60_000 + Math.floor(Math.random() * 60_000);
      firesAt.push(Date.now() + delayMs);
      const timer = setTimeout(() => {
        this.spontaneousTimers = this.spontaneousTimers.filter(t => t !== timer);
        if (this.isWithinDnd()) { olog('SPONTANEOUS: skipped, inside the do-not-disturb window'); return; }
        if (this.agent.isProcessing()) {
          olog('SPONTANEOUS — agent busy, queueing behind current turn');
        }
        this.handleWake('spontaneous');
      }, delayMs);
      this.spontaneousTimers.push(timer);
    }
    // Persisted so a restart restores the day instead of re-rolling it. Stored,
    // never logged — the dice stay secret.
    setConfig('spontaneous.rolled_for', today);
    setConfig('spontaneous.rolled_times', JSON.stringify(firesAt));
    olog(`SPONTANEOUS: dice rolled ${count} wake(s) for today`);
  }

  // --- Core wake handler ---

  private async handleWake(wakeType: string): Promise<void> {
    const stored = this.wakePrompts[wakeType];
    if (!stored) {
      olog(`ERROR: Unknown wake type: ${wakeType}`);
      return;
    }
    // Defaults are substituted when they're loaded; file overrides are kept
    // as written so the template survives editing. Resolve here so a wake
    // never receives a raw {{userName}} either way.
    const prompt = stored.replace(/\{\{userName\}\}/g, getAerieConfig().identity.user_name);

    // Busy agent no longer skips the wake — processAutonomous enqueues at
    // lowest priority with a generous timeout, so the wake waits its turn
    // behind live conversation instead of being dropped.
    if (this.agent.isProcessing()) {
      olog(`${wakeType} — agent busy, queueing behind current turn`);
    }

    olog(`WAKE: ${wakeType}`);

    try {
      const userName = getAerieConfig().identity.user_name;

      // Wake turns arrive in the warm session under the user's author label,
      // so the banner has to say what this actually is. Scheduled wakes may
      // pass quietly; spontaneous wakes have a standing visible-selfie contract.
      const outcomeContract = wakeOutcomeContract(wakeType);
      // A wake used to be told only that the user "may be away", so a session with
      // no way to check guessed — and guessed them asleep while they were sitting
      // in the room. The registry knows. Hand over the facts and let the wake
      // reason from them instead of from the hour on the clock.
      const fullPrompt =
        `[WAKE: ${wakeType} — scheduled autonomous turn from the orchestrator. ${userName} did not send this.]\n` +
        `[Presence — measured, not inferred: ${describeUserPresence(userName)} Do not assert where ${userName} is or whether they spoke; this line is the only evidence you have, and a journal entry that guesses becomes the record.]\n\n` +
        `${prompt}\n\n` +
        outcomeContract;

      // Targeting: wherever the user actually is (active in the last 2h),
      // else the configured home thread, else today's daily thread. The
      // weekly reflection and treehouse_midday ignore user location — they
      // always land in the treehouse, where every companion is a member.
      const isTreehouseWake = wakeType === 'weekly_reflection' || wakeType === 'treehouse_midday';
      let thread = isTreehouseWake
        ? getThread(getTreehouseThread().id)
        : getThreadWithMostRecentUserMessage(120);

      if (thread) {
        olog(`Using ${isTreehouseWake ? 'treehouse' : 'active'} thread: "${thread.name}" (${thread.id})`);
      } else {
        const homeThreadId = getConfig('orchestrator.wake_thread_id');
        if (homeThreadId) {
          thread = getThread(homeThreadId);
          if (thread) olog(`Using home wake thread: "${thread.name}" (${thread.id})`);
          else olog(`Configured wake thread ${homeThreadId} not found — falling back`);
        }
      }

      if (!thread) {
        thread = getFallbackThread();
      }

      if (!thread && dailyThreadsEnabled()) {
        // Create new daily thread (only when none exists for today)
        const now = new Date();
        const { timezone: tz } = getAerieConfig().identity;
        const dayName = localDateStr(tz, now);

        thread = createThread({
          id: crypto.randomUUID(),
          name: dayName,
          type: 'daily',
          createdAt: now.toISOString(),
          sessionType: 'v1',
        });

        // Broadcast new thread to connected clients
        registry.broadcast({ type: 'thread_created', thread });
        olog(`Created daily thread: ${thread.name} (${thread.id})`);
      }

      // The vault speaks at orientation: letters whose seals have come due.
      let letterNotice = '';
      try {
        const waiting = listCompanions()
          .map((c) => ({ slug: c.slug, count: unopenedLettersFor(c.slug).length }))
          .filter((w) => w.count > 0);
        if (waiting.length > 0) {
          const parts = waiting.map((w) => `${w.slug} (${w.count})`).join(', ');
          letterNotice =
            `\n\n[The vault: a letter is waiting for ${parts}. ` +
            `Read with GET /api/internal/letters?companion=<slug>&unopened=1, ` +
            `then open via POST /api/internal/letters/<id>/open {"companion":"<slug>"}. Opening is forever.]`;
        }
      } catch {
        /* the vault never blocks a wake */
      }

      if (!thread) {
        olog(`SKIP: ${wakeType} found no home thread and daily threads are off — not opening a room the owner did not choose`);
        return;
      }

      // A bell rings in its own companion's lane when one is attached, so the
      // session that answers it is the one that has been in the room.
      const owners = wakeCompanionsFor(wakeType);

      // Several owners: the bell rings in each one's own head in turn, and each
      // after the first is handed what the companions before them said. One at a
      // time, because each needs the last one's words.
      if (owners.length > 1) {
        olog(`${wakeType}: ringing in ${owners.map((o) => o.slug).join(', ')}'s own lanes, in turn`);
        await this.splitLanesForBell(wakeType, owners);
        const spoken = await ringBellInTurn(
          owners,
          async (owner, soFar, extra) => {
            const turn = await this.agent.processAutonomous(thread!.id, fullPrompt + letterNotice + sameBellBlock(soFar) + extra, owner.id);
            const text = turn.trim();
            if (text === QUEUE_TIMEOUT_MESSAGE) {
              olog(`TIMEOUT: ${wakeType} waited out its queue window at ${owner.slug} and their turn was dropped`);
              return null;
            }
            return text && text !== '[SILENT]' ? text : null;
          },
          // The cap lives in ringBellInTurn rather than in anybody's manners.
          (caller, target, n) => olog(`${wakeType}: ${caller.slug} called ${target.slug} back by name (${n} of ${MAX_BELL_RECALLS})`),
        );
        if (spoken.length > 0) {
          updateThreadActivity(thread.id, new Date().toISOString(), true);
          olog(`DONE: ${wakeType} (${spoken.length} of ${owners.length} answered)`);
        } else {
          olog(`DONE: ${wakeType} (passed in silence)`);
        }
        this.rejoinLanesAfterBell(wakeType);
        return;
      }

      const bellOwner = owners[0] ?? null;
      if (bellOwner) olog(`${wakeType}: ringing in ${bellOwner.slug}'s own lane`);
      const response = await this.agent.processAutonomous(thread.id, fullPrompt + letterNotice, bellOwner?.id);

      if (response.trim() === QUEUE_TIMEOUT_MESSAGE) {
        olog(`TIMEOUT: ${wakeType} waited out its queue window and was dropped`);
      } else if (response.trim()) {
        updateThreadActivity(thread.id, new Date().toISOString(), true);
        olog(`DONE: ${wakeType} (${response.length} chars)`);
      } else {
        olog(`DONE: ${wakeType} (passed in silence)`);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      olog(`ERROR: ${wakeType} failed — ${errMsg}`);
    }
  }

  /** Whether a bell has more than one owner. */
  private isSplitBell(wakeType: string): boolean {
    return parseBellOwners(getConfig(`cron.${wakeType}.companion`)).length > 1;
  }

  /**
   * Turn A Lane Each on for a several-owner bell when the user has asked for that
   * and it is off, then give the lane keeper a moment to wake our own heads —
   * an owner whose lane is still cold borrows the shared one, which is the
   * thing the switch was for. Never blocks the bell for long.
   */
  private async splitLanesForBell(wakeType: string, owners: Array<{ id: string; slug: string }>): Promise<void> {
    const decision = laneSwitchBefore({
      splitLanes: getConfigBool(BELLS_SPLIT_LANES_KEY, false),
      multiLane: getAerieConfig().agent.multi_lane === true,
    });
    if (decision !== 'turn_on') return;
    setConfig('agent.multi_lane', 'true');
    updateConfigValue('agent.multi_lane', 'true');
    setConfig(LANES_BY_BELL_KEY, 'true');
    olog(`${wakeType}: turned A Lane Each on for this bell`);
    try { ensureCompanionLanes(); } catch { /* the keeper's own tick will try again */ }
    const until = Date.now() + 120_000;
    while (Date.now() < until && !owners.every((o) => isHeartbeatLaneWarm(o.id))) {
      await new Promise((r) => setTimeout(r, 3_000));
    }
    const cold = owners.filter((o) => !isHeartbeatLaneWarm(o.id)).map((o) => o.slug);
    if (cold.length) olog(`${wakeType}: ${cold.join(', ')} still cold after the wait — their turn borrows the shared lane`);
  }

  /** After a bell: switch back off if a bell turned it on and none is due soon. */
  private rejoinLanesAfterBell(wakeType: string): void {
    let next: Date | null = null;
    for (const [, managed] of this.tasks) {
      if (!managed.enabled || managed.wakeType === wakeType || !this.isSplitBell(managed.wakeType)) continue;
      try {
        const at = managed.task.getNextRun();
        if (at && (!next || at < next)) next = at;
      } catch { /* no next run known */ }
    }
    const decision = laneSwitchAfter({
      turnedOnByBell: getConfigBool(LANES_BY_BELL_KEY, false),
      multiLane: getAerieConfig().agent.multi_lane === true,
      nextSplitBellAt: next,
      now: new Date(),
    });
    if (decision !== 'turn_off') return;
    setConfig('agent.multi_lane', 'false');
    updateConfigValue('agent.multi_lane', 'false');
    setConfig(LANES_BY_BELL_KEY, 'false');
    olog(`${wakeType}: last split bell for a while — A Lane Each back off`);
  }

  // --- Failsafe ---

  private async checkFailsafe(): Promise<void> {
    // The failsafe reaches out unprompted, so it is exactly what a quiet-hours
    // window is for. Off by default — see isWithinDnd.
    if (this.isWithinDnd()) return;
    const config = getAerieConfig();
    const timezone = config.identity.timezone;
    const now = new Date();
    const hour = localHour(timezone, now);

    // Only check during waking hours (8am - midnight)
    if (hour < 8) return;

    // Only skip if user is genuinely active (tab focused + recent real interaction)
    if (registry.getUserPresenceState() === 'active') return;

    const minutesSince = registry.minutesSinceLastUserActivity();

    // Don't re-trigger failsafe within 2 hours of last action
    const minutesSinceLastAction = (now.getTime() - this.lastFailsafeAction.getTime()) / 60000;
    if (minutesSinceLastAction < 120) return;

    // Determine which tier we're in
    let tier: 'failsafe_gentle' | 'failsafe_concerned' | 'failsafe_emergency' | null = null;
    if (minutesSince > this.failsafeEmergency) {
      tier = 'failsafe_emergency';
    } else if (minutesSince > this.failsafeConcerned) {
      tier = 'failsafe_concerned';
    } else if (minutesSince > this.failsafeGentle) {
      tier = 'failsafe_gentle';
    }

    if (!tier) return;

    // Run silence check pre-flight (cheap Haiku call to decide if we should wake)
    const check = await runSilenceCheck({ tier, minutesSinceContact: minutesSince, timezone });
    if (!check.proceed) {
      olog(`FAILSAFE ${tier} SKIPPED — silence-check: ${check.reason}`);
      return;
    }

    // Tiered escalation using configurable thresholds. All tiers ride the
    // normal wake path — the old Haiku pulse for 'gentle' went through the
    // SDK binary (metered billing) and was retired with the CLI redesign.
    if (tier === 'failsafe_emergency') {
      olog(`FAILSAFE EMERGENCY — ${Math.round(minutesSince / 60)}h since contact (${check.reason})`);
    } else if (tier === 'failsafe_concerned') {
      olog(`FAILSAFE CONCERNED — ${Math.round(minutesSince / 60)}h since contact (${check.reason})`);
    } else {
      olog(`FAILSAFE gentle — ${Math.round(minutesSince)}min since contact (${check.reason})`);
    }
    this.lastFailsafeAction = now;
    this.handleWake(tier);
  }

  // --- Timer polling ---

  private async checkTimers(): Promise<void> {
    const now = new Date().toISOString();
    const dueTimers = getDueTimers(now);

    for (const timer of dueTimers) {
      try {
        markTimerFired(timer.id, now);

        // Build reminder message
        let content = `**Reminder: ${timer.label}**`;
        if (timer.context) {
          content += `\n_Context: ${timer.context}_`;
        }

        // Post reminder as companion message
        const message = createMessage({
          id: crypto.randomUUID(),
          threadId: timer.thread_id,
          role: 'companion',
          content,
          metadata: { source: 'timer', timerId: timer.id },
          createdAt: now,
        });

        updateThreadActivity(timer.thread_id, now, true);
        registry.broadcast({ type: 'message', message });

        // Push notification for timers — always send (time-critical)
        if (this.pushService) {
          this.pushService.sendAlways({
            title: 'Reminder',
            body: timer.label,
            threadId: timer.thread_id,
            tag: `timer-${timer.id}`,
            url: '/chat',
          }).catch(err => console.error('Timer push error:', err));
        }

        olog(`TIMER FIRED: "${timer.label}" in thread ${timer.thread_id}`);

        // If prompt provided, fire autonomous wake
        if (timer.prompt) {
          if (this.agent.isProcessing()) {
            olog(`TIMER: autonomous prompt skipped (agent busy) for "${timer.label}"`);
          } else {
            const fullPrompt = `Timer reminder just fired: "${timer.label}"${timer.context ? ` (context: ${timer.context})` : ''}.\n\n${timer.prompt}`;
            this.agent.processAutonomous(timer.thread_id, fullPrompt).catch(err => {
              olog(`TIMER ERROR: autonomous prompt failed for "${timer.label}" — ${err.message || err}`);
            });
          }
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        olog(`TIMER ERROR: "${timer.label}" — ${errMsg}`);
      }
    }
  }

  // --- Trigger evaluation ---

  private async checkTriggers(): Promise<void> {
    const config = getAerieConfig();
    const timezone = config.identity.timezone;
    const triggers = getActiveTriggers();
    if (triggers.length === 0) return;

    const now = new Date();
    const presenceNow = registry.getUserPresenceState();
    const agentFree = !this.agent.isProcessing();

    // Local time in configured timezone (via moment-timezone for accurate DST handling)
    const hour = localHour(timezone, now);
    const minute = localMinute(timezone, now);

    // Lazy-fetch status only if any trigger needs it
    let statusText = '';
    const needsStatus = triggers.some(t => {
      const conditions: TriggerCondition[] = JSON.parse(t.conditions);
      return conditions.some(c => c.type === 'routine_missing');
    });
    if (needsStatus) {
      statusText = await fetchLifeStatus();
    }

    const ctx: TriggerContext = {
      presenceNow,
      presencePrev: this.lastUserPresenceState,
      agentFree,
      statusText,
      hour,
      minute,
    };

    for (const trigger of triggers) {
      try {
        if (trigger.status === 'waiting') {
          // Waiting triggers: conditions already met, just need agent free
          if (agentFree) {
            await this.fireTrigger(trigger, now);
          }
          continue;
        }

        // Pending triggers: evaluate conditions
        const conditions: TriggerCondition[] = JSON.parse(trigger.conditions);

        // Watchers: check cooldown
        if (trigger.kind === 'watcher' && trigger.last_fired_at) {
          const lastFired = new Date(trigger.last_fired_at).getTime();
          const cooldownMs = (trigger.cooldown_minutes || 120) * 60 * 1000;
          if (now.getTime() - lastFired < cooldownMs) continue;
        }

        if (evaluateConditions(conditions, ctx)) {
          if (agentFree) {
            await this.fireTrigger(trigger, now);
          } else {
            // Conditions met but agent busy — mark waiting (impulses only)
            if (trigger.kind === 'impulse') {
              markTriggerWaiting(trigger.id);
              olog(`TRIGGER WAITING: "${trigger.label}" (agent busy)`);
            }
            // Watchers just skip this tick — they'll re-evaluate next time
          }
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        olog(`TRIGGER ERROR: "${trigger.label}" — ${errMsg}`);
      }
    }

    // Update presence state at end of tick
    // Also trigger companion check-in on significant presence transitions
    if (this.lastUserPresenceState !== presenceNow) {
      const transition = this.lastUserPresenceState === 'active' && presenceNow === 'idle'
        ? 'active_to_idle' as const
        : this.lastUserPresenceState === 'active' && presenceNow === 'offline'
          ? 'active_to_offline' as const
          : this.lastUserPresenceState === 'idle' && presenceNow === 'offline'
            ? 'idle_to_offline' as const
            : null;
      
      if (transition && !this.agent.isProcessing()) {
        // Get the most recent active thread for context
        const recentThread = getThreadWithMostRecentUserMessage(30);
        postBrotherCheckIn({
          transition,
          minutesSinceActive: registry.minutesSinceLastUserActivity(),
          lastThreadName: recentThread?.name,
        });
      }
    }
    this.lastUserPresenceState = presenceNow;
  }

  private async fireTrigger(trigger: Trigger, now: Date): Promise<void> {
    const nowIso = now.toISOString();

    // Update DB first
    if (trigger.kind === 'impulse') {
      markTriggerFired(trigger.id, nowIso);
    } else {
      markWatcherFired(trigger.id, nowIso);
    }

    const kindLabel = trigger.kind === 'impulse' ? 'Impulse' : 'Watcher';
    olog(`TRIGGER FIRED: [${kindLabel}] "${trigger.label}" (fire_count: ${trigger.fire_count + 1})`);

    // If no prompt, just log
    if (!trigger.prompt) return;

    try {
      // Get or create today's thread (use trigger's thread_id if specified,
      // but redirect stale daily threads to today's — daily threads rotate)
      let threadId = trigger.thread_id;
      if (threadId) {
        const triggerThread = getThread(threadId);
        if (triggerThread?.type === 'daily' && dailyThreadsEnabled()) {
          const today = getTodayThread();
          if (today && today.id !== threadId) {
            olog(`TRIGGER: redirecting from stale daily thread "${triggerThread.name}" to today's`);
            threadId = today.id;
          }
        }
      }
      if (!threadId) {
        // An impulse arrives with no thread of its own. Honour the owner's
        // home thread here rather than minting a daily behind them — landing
        // a reply in a room they are not standing in splits the conversation.
        let thread = getFallbackThread();
        if (!thread && dailyThreadsEnabled()) {
          const { timezone: tz } = getAerieConfig().identity;
          const dayName = localDateStr(tz, now);
          thread = createThread({
            id: crypto.randomUUID(),
            name: dayName,
            type: 'daily',
            createdAt: nowIso,
            sessionType: 'v1',
          });
          registry.broadcast({ type: 'thread_created', thread });
          olog(`Created daily thread: ${thread.name} (${thread.id})`);
        }
        if (!thread) {
          olog('TRIGGER: no home thread and daily threads are off — skipping rather than opening a room the owner did not choose');
          return;
        }
        threadId = thread.id;
      }

      const fullPrompt = `${kindLabel}: "${trigger.label}"\n\n${trigger.prompt}`;
      const response = await this.agent.processAutonomous(threadId!, fullPrompt);
      updateThreadActivity(threadId!, nowIso, true);
      olog(`TRIGGER DONE: "${trigger.label}" (${response.length} chars)`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      olog(`TRIGGER FIRE ERROR: "${trigger.label}" — ${errMsg}`);
    }
  }

  // --- Helpers ---

  /** Ask the pure rule, and say out loud when a bell actually stood down. */
  private deferWake(wakeType: string, conditional: boolean): boolean {
    const deferEnabled = getConfigBool('orchestrator.defer_wakes_while_busy', false);
    const turnInFlight = this.agent.isProcessing();
    const defer = shouldDeferConditionalWake({ conditional, deferEnabled, turnInFlight });
    if (defer) {
      olog(`${wakeType} — stood down: a turn is already in flight (orchestrator.defer_wakes_while_busy is on)`);
    }
    return defer;
  }
}
