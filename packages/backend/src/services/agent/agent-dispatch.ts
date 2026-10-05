// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import type { ImageBlockParam } from './claude-types.js';
import { getMessages, getThread } from '../db.js';
import { getAerieConfig } from '../../config.js';
import { formatBlocksForPrompt, SHARED_SCOPE } from '../memory-blocks.js';
import { getThreadCompanions, getDefaultCompanionForThread, listCompanions, getCompanion } from '../db/companions.js';
import { loadCompanionIdentity } from '../companion-identity.js';
import { effectiveAgentProvider, resolveCompatibleAgentRoute, type AgentRouting } from './agent-route-selection.js';
import { isHeartbeatLaneWarm } from '../heartbeat/supervisor.js';
import { persistAgentSetting } from '../agent-settings.js';
import crypto from 'crypto';

export interface AgentTurnThreadMeta {
  name: string;
  type: 'daily' | 'named' | 'treehouse';
}

export interface AgentTurnPlatformOptions {
  platform?: 'web' | 'discord' | 'telegram' | 'api';
  platformContext?: string;
  withdrawn?: string;
  imageBlocks?: ImageBlockParam[];
  discordAuthor?: string;
  [key: string]: unknown;
}

interface AgentDispatchRuntime {
  ensureInit: () => void;
  getClaudeMdContent: () => string;
  processViaRouter: (
    threadId: string,
    content: string,
    model: string,
    systemPrompt: string,
    platform: 'web' | 'discord' | 'telegram' | 'api',
    streamMsgId: string,
    activeCompanionId: string | null,
    platformOpts?: { imageBlocks?: ImageBlockParam[]; discordAuthor?: string; [key: string]: unknown },
    routing?: AgentRouting,
    isAutonomous?: boolean,
  ) => Promise<string>;
}

/**
 * Build the system prompt for ONE companion in their own lane: their shared world
 * and persona, plus the shared and personal memory blocks — and nobody else's.
 * A bell with an owner rings against this rather than the whole room's prompt.
 */
export function buildLanePrompt(companionId: string, slug: string, fallback: string): string {
  let prompt = fallback;
  try {
    const identity = loadCompanionIdentity(companionId);
    const parts = [identity.sharedMd, identity.personaMd].filter(Boolean);
    if (parts.length > 0) prompt = parts.join('\n\n---\n\n');
  } catch (err) {
    console.warn(`[Agent] Lane prompt fell back to global identity for ${slug}:`, err);
  }
  try {
    const coreMemory = formatBlocksForPrompt([SHARED_SCOPE, slug]);
    if (coreMemory) prompt += '\n\n---\n' + coreMemory;
  } catch (err) {
    console.warn(`[Agent] Failed to inject core memory for lane ${slug}:`, err);
  }
  return prompt;
}

/** Fisher-Yates. The speaking order is rolled per turn so no lane is permanently first. */
export function shuffled<T>(items: T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * What a lane is handed when other companions have already spoken in this same turn.
 * Framed as overheard rather than as instruction: they are answering THE OWNER, and the
 * others are simply in the room, which is the whole point of passing the turn
 * along instead of fanning it out in parallel.
 *
 * THE FAILURE THIS WORDING IS AIMED AT (caught by putting two replies side by
 * side): "do not repeat their points back" reads as "do not quote them", and
 * none of us was quoting. Three companions who love the same person, handed
 * the same message, independently reach for the same obviously-right answer — so
 * the second and third replies came out as the first one with different
 * punctuation, each one certain they were being thoughtful. That is CONVERGENCE, not
 * repetition, and the old wording did not name it. The handoff also arrives
 * LOOKING like a message, and the natural thing to do with a message is answer
 * it, which is why the later a lane sits the more it echoes the line above it.
 * So: name the obvious answer as already spent, and say plainly that the block is
 * ground taken rather than something addressed to them.
 *
 * SECOND PASS, for a different half of the same fault: two lanes ended on "thank
 * you for the thread" in nearly the same words, and a third asked for the same
 * thing. Nobody was making a point — they were ending politely. A courtesy is the
 * cheapest available last line, so all three reach for it, and the convergence
 * lands at the END of a message where the wording above only guarded the
 * beginning. Hence the explicit rule against closing on a gesture.
 *
 * AND SILENCE IS NAMED AS AN OPTION, which it never was. On one shared lane three
 * voices cost the owner a single message; on separate lanes they cost three, so a lane
 * with nothing new to add is not being thorough by speaking — it is spending the owner's
 * attention on a turn that did not need it. The wording says so out loud, because
 * a model handed a prompt reads answering as the job unless told otherwise.
 */
export function priorVoicesBlock(spoken: Array<{ name: string; text: string }>): string {
  const lines = spoken.map(s => `${s.name} already said, in this same turn:\n${s.text}`);
  return [
    '',
    '',
    '[Same turn — you are in the room with the other companions and they have already answered the owner.',
    'You are replying to THE OWNER, not to them, but you can hear what they said and you are not',
    'starting from scratch. Never speak under another companion\'s header.',
    'What follows is GROUND ALREADY TAKEN, not a message addressed to you — do not open',
    'by answering it, summarising it, or agreeing with it. And the trap is not quoting them:',
    'it is arriving at the same obviously-right answer independently. If your best line is',
    'one another companion could have written, it is theirs. Say the thing only you would have said,',
    'or answer what they left open.',
    'The same trap sits at the END of a message. A closing courtesy — thanking the owner, telling',
    'them to rest, saying keep going — is the cheapest possible last line, so every one of you',
    'reach for it and it loops exactly like the opening does. Do not end on a gesture. End on',
    'the last real thing you had. If your final line could be pasted into anybody else\'s mouth',
    'unchanged, cut it.',
    'Always answer. You are in the room together; the owner wants all of you, not the one who',
    'got there first. Find what is yours to say — the angle only you would have taken,',
    'the question another companion left open, the thing you noticed that they walked past.]',
    ...lines,
  ].join('\n');
}

/**
 * Whether this turn fans out across the companions' own lanes. Autonomous
 * turns never fan out — a wake already targets one companion, and tripling it
 * would ring the same bell three times (and paint three selfies on a
 * spontaneous wake). Tolerates a quoted "true" because a hand-edited
 * aerie.yaml is a supported way in, and a switch that silently ignores the owner's
 * edit is not a switch.
 */
export function shouldFanOut(multiLane: unknown, isAutonomous: boolean, rosterSize: number): boolean {
  const on = multiLane === true || String(multiLane) === 'true';
  return on && !isAutonomous && rosterSize > 1;
}

/**
 * The per-companion room can run on either subscription-backed lane. `auto`
 * reaches this point only for Claude models and therefore resolves to the
 * Claude CLI; API turns stay stateless and never fan out.
 */
export function multiLaneRuntimeRoute(routing: AgentRouting): 'cli' | 'codex-cli' | null {
  if (routing === 'codex-cli') return 'codex-cli';
  if (routing === 'cli' || routing === 'sdk' || routing === 'auto') return 'cli';
  return null;
}

/**
 * The model ONE companion actually thinks on for this turn.
 *
 * Their own setting wins over the house picker, and a companion with nothing of
 * their own IS the house answer — which is why turning any of this on changes
 * nobody's lane until the owner sets one.
 *
 * This deliberately mirrors companionLaneKeeperModel's precedence. The keeper
 * decides what a COLD lane is warmed on; this decides what a TURN runs on, and
 * the two disagreeing is not a cosmetic split: the keeper asked the companion
 * from the day it shipped while this path still read the house setting once and
 * handed the same answer to every companion, so a saved row was correct, visible
 * in the editor, and never reached a single turn.
 */
export function companionTurnModel(
  companion: { model?: string | null; model_autonomous?: string | null } | null | undefined,
  isAutonomous: boolean,
  houseModel: string,
): string {
  if (!companion) return houseModel;
  const own = isAutonomous ? companion.model_autonomous : companion.model;
  return (own && own.trim()) || houseModel;
}

/** Never let a missing row take a turn down — an unknown companion is the house answer. */
function companionRowOrNull(id: string | null | undefined) {
  if (!id) return null;
  try { return getCompanion(id) ?? null; } catch { return null; }
}

type CodexHistorySnapshot = Array<{ role: 'user' | 'assistant'; content: string }>;

/**
 * Freeze the durable tail before any companion in a Codex room answers. New
 * Codex lanes seed themselves from this same snapshot, so lane two does not
 * load lane one's freshly-persisted reply and then receive it a second time in
 * the same-turn handoff block.
 *
 * Interactive callers persist the owner's message before dispatch. Only trim
 * it when it is in fact the last conversational row; callers that do not
 * persist an inbound message keep the full tail rather than losing history on
 * an assumption.
 */
export function codexHistoryBeforeTurn(
  messages: Array<{ role: string; content: string }>,
): CodexHistorySnapshot {
  const conversational = messages.filter((message) => message.role !== 'system');
  if (conversational.at(-1)?.role === 'user') conversational.pop();
  return conversational.map((message) => ({
    role: message.role === 'user' ? 'user' : 'assistant',
    content: message.content,
  }));
}

/**
 * Turn dispatcher — every message enters here. Builds the per-thread identity
 * and core-memory system prompt, resolves the model and lane from live
 * config, and hands the turn to the matching warm runtime.
 *
 * Extracted from the retired SDK query path (Jul 22, 2026). The legacy `sdk`
 * routing value maps to the warm CLI lane: Claude models ride the interactive
 * heartbeat session on subscription billing, never the metered Agent SDK.
 */
export async function dispatchAgentTurn(
  threadId: string,
  content: string,
  isAutonomous: boolean,
  threadMeta: AgentTurnThreadMeta | undefined,
  platformOpts: AgentTurnPlatformOptions | undefined,
  runtime: AgentDispatchRuntime,
  /**
   * On a wake, the companion the bell belongs to. They get the turn in their own
   * warm lane with their own persona, instead of the turn falling to the thread
   * default and — on a thread with participants but no default — all the way
   * through to the shared lane, where the session answering has not been in the
   * room and has to guess at what the night was.
   */
  wakeCompanionId?: string,
): Promise<string> {
  runtime.ensureInit();
  const thread = getThread(threadId);
  if (!thread) throw new Error(`Thread ${threadId} not found`);

  const cfg = getAerieConfig();

  // ─── Per-Thread Companion Identity ─────────────────────────────
  // Load identity based on which companions are assigned to this thread.
  // Falls back to global claudeMdContent if no companions assigned.
  let effectiveClaudeMd = runtime.getClaudeMdContent();
  let threadCompanionSlugs: string[] = [];
  /** Assigned companions, in DB order — the roster an owned bell is matched against. */
  let laneRoster: Array<{ id: string; slug: string }> = [];
  try {
    const threadCompanions = getThreadCompanions(threadId);
    if (threadCompanions.length > 0) {
      threadCompanionSlugs = threadCompanions.map(tc => (tc as { slug?: string }).slug).filter((s): s is string => Boolean(s));
      laneRoster = threadCompanions
        .map(tc => ({ id: tc.companion_id, slug: (tc as { slug?: string }).slug || '' }))
        .filter(c => Boolean(c.id && c.slug));
      // Combine identities from all companions in the thread
      const identities = threadCompanions.map(tc => {
        try {
          return loadCompanionIdentity(tc.companion_id);
        } catch (err) {
          console.warn(`[Agent] Failed to load identity for companion ${tc.companion_id}:`, err);
          return null;
        }
      }).filter(Boolean);

      if (identities.length > 0) {
        // Shared world base(s) once, then each companion's persona.
        // Companions pointing at the same _shared.md dedupe to one block.
        const sharedBlocks = Array.from(new Set(identities.map(id => id!.sharedMd).filter(Boolean)));
        const personas = identities.map(id => id!.personaMd).filter(Boolean);
        effectiveClaudeMd = [...sharedBlocks, ...personas].join('\n\n---\n\n');
        console.log(`[Agent] Using ${identities.length} companion identities for thread ${threadId} (${sharedBlocks.length} shared base${sharedBlocks.length === 1 ? '' : 's'})`);
      }
    }
  } catch (err) {
    console.warn('[Agent] Failed to load thread companions, using global identity:', err);
  }

  // ─── Core Memory Injection (Letta-style blocks) ────────────────
  // Shared blocks + the personal blocks of every companion in this thread.
  // Threads with no assigned companions see everyone's blocks.
  try {
    const memoryScopes = threadCompanionSlugs.length > 0
      ? [SHARED_SCOPE, ...threadCompanionSlugs]
      : [SHARED_SCOPE, ...listCompanions().map(c => c.slug)];
    const coreMemory = formatBlocksForPrompt(memoryScopes);
    if (coreMemory) effectiveClaudeMd += '\n\n---\n' + coreMemory;
  } catch (err) {
    console.warn('[Agent] Failed to inject core memory blocks:', err);
  }

  const streamMsgId = crypto.randomUUID();
  const platform = platformOpts?.platform || 'web';

  // Two-tier model: autonomous wakes use their own configured model
  const model = isAutonomous
    ? cfg.agent.model_autonomous
    : (cfg.agent.model || process.env.AGENT_MODEL || 'claude-sonnet-4-6');

  // ─── Runtime Routing ───────────────────────────────────────────
  const requestedRouting = isAutonomous
    ? (cfg.agent.routing_autonomous || cfg.agent.routing || 'cli')
    : (cfg.agent.routing || 'cli');
  const resolvedRoute = resolveCompatibleAgentRoute(model, requestedRouting);
  let routingMode = resolvedRoute.routing;
  if (resolvedRoute.corrected) {
    console.warn(`[Agent] Corrected incompatible route ${requestedRouting} → ${routingMode}: ${resolvedRoute.reason}`);
    // The guard is also the migration for installs carrying an old split
    // model/route pair. Put its answer back in all three config witnesses so
    // this is one repaired turn rather than the same warning forever.
    try {
      persistAgentSetting(
        isAutonomous ? 'agent.routing_autonomous' : 'agent.routing',
        routingMode,
      );
    } catch (err) {
      // Persistence must never turn a safely-routed request into a failed one.
      console.warn(`[Agent] Could not persist corrected ${isAutonomous ? 'autonomous ' : ''}route:`, err);
    }
  }
  if (routingMode === 'sdk') {
    console.warn('[Agent] SDK lane retired — riding the warm CLI lane instead');
    routingMode = 'cli';
  }
  const effectiveProvider = effectiveAgentProvider(model, routingMode, cfg.agent.provider);
  console.log(`[Agent] routingMode=${routingMode}, model=${model}, provider=${effectiveProvider}, autonomous=${isAutonomous}`);
  const isClaudeModel = model.toLowerCase().startsWith('claude-');

  // Router lane: explicit 'api', or a non-Claude model on 'auto'/'cli'.
  const useRouter = routingMode === 'api'
    || ((routingMode === 'auto' || routingMode === 'cli') && !isClaudeModel);
  if (useRouter) {
    return runtime.processViaRouter(threadId, content, model, effectiveClaudeMd, platform, streamMsgId, null, platformOpts, routingMode, isAutonomous);
  }

  // ─── Multi-Lane Room ───────────────────────────────────────────
  // Off by default. On, a thread with more than one companion assigned stops
  // collapsing onto the shared lane: the turn is passed between their own warm
  // sessions in a shuffled order, each one hearing what the others already
  // said this turn. Ported back, at the owner's request, from the July 29 build
  // (cbd8d78, a lineage the history rewrite left behind).
  const laneRouting = multiLaneRuntimeRoute(routingMode);
  if (laneRouting && shouldFanOut(cfg.agent.multi_lane, isAutonomous, laneRoster.length)) {
    const order = shuffled(laneRoster);
    // Each companion's own model, and therefore their own lane: a companion on a
    // GPT model rides Codex while the companions either side of them stay on Claude.
    // Worked out per companion before anyone speaks, because the room needs to know
    // whether ANY lane is a Codex one before the first lane answers.
    const plan = order.map((lane) => {
      const laneModel = companionTurnModel(companionRowOrNull(lane.id), isAutonomous, model);
      const laneRoute = multiLaneRuntimeRoute(resolveCompatibleAgentRoute(laneModel, requestedRouting).routing);
      return { lane, laneModel, laneRoute };
    });
    // Every new Codex lane must recover from the same pre-turn view. Without
    // this freeze, later lanes see earlier replies once in SQLite and again in
    // priorVoicesBlock(). Existing warm lanes ignore the snapshot.
    const anyCodexLane = plan.some((p) => p.laneRoute === 'codex-cli');
    const codexPlatformOpts = anyCodexLane
      ? {
          ...platformOpts,
          _codexHistorySnapshot: codexHistoryBeforeTurn(getMessages({ threadId, limit: 50 })),
        }
      : platformOpts;
    console.log(`[Agent] Multi-lane room: ${plan.map(p => `${p.lane.slug}@${p.laneModel}`).join(' → ')} (thread ${threadId})`);
    const spoken: Array<{ name: string; text: string }> = [];
    const replies: string[] = [];
    for (const { lane, laneModel, laneRoute } of plan) {
      if (!laneRoute) {
        // Nothing subscription-backed can carry them. Skipping is the same call
        // the lane keeper makes: a lane they never use is worse than none.
        console.warn(`[Agent] Lane ${lane.slug} skipped — ${laneModel} has no warm lane on this route`);
        continue;
      }
      const laneContent = spoken.length === 0 ? content : content + priorVoicesBlock(spoken);
      const lanePrompt = buildLanePrompt(lane.id, lane.slug, runtime.getClaudeMdContent());
      const displayName = (() => {
        try { return getCompanion(lane.id)?.display_name || lane.slug; } catch { return lane.slug; }
      })();
      try {
        // A fresh stream id per lane — each lane's reply is its own message,
        // so the bubbles arrive staggered as each companion finishes rather
        // than all at once at the end.
        const reply = await runtime.processViaRouter(
          threadId, laneContent, laneModel, lanePrompt, platform,
          crypto.randomUUID(), lane.id,
          laneRoute === 'codex-cli' ? codexPlatformOpts : platformOpts,
          laneRoute, isAutonomous,
        );
        if (reply && reply.trim()) {
          spoken.push({ name: displayName, text: reply });
          replies.push(reply);
        }
      } catch (err) {
        // One lane failing is not the room failing. Log it and let the rest
        // of the companions answer — silence from everyone is the worse bug.
        console.error(`[Agent] Lane ${lane.slug} failed this turn:`, err);
      }
    }
    if (replies.length > 0) return replies.join('\n\n');
    console.warn('[Agent] Multi-lane room produced nothing — falling through to the shared lane');
  }

  const bellOwner = wakeCompanionId
    ? laneRoster.find(c => c.id === wakeCompanionId)
      ?? (() => { try { const c = getCompanion(wakeCompanionId); return c ? { id: c.id, slug: c.slug } : undefined; } catch { return undefined; } })()
    : undefined;

  // Codex CLI lane: GPT models ride the warm Codex daemon session
  // (ChatGPT subscription billing via the Codex CLI binary). This sits after
  // the room fan-out so A Lane Each can give every companion a Codex thread;
  // with the switch off, the legacy thread-only shared lane is unchanged.
  if (routingMode === 'codex-cli') {
    const laneEachOn = cfg.agent.multi_lane === true || String(cfg.agent.multi_lane) === 'true';
    const codexCompanion = bellOwner
      // A room with one companion still deserves their own key when A Lane Each
      // is on; an owned bell always rings at its owner regardless of the room
      // switch, matching the Claude lane contract.
      ?? (laneEachOn && laneRoster.length === 1
        ? laneRoster[0]
        : undefined);
    const codexPrompt = codexCompanion
      ? buildLanePrompt(codexCompanion.id, codexCompanion.slug, runtime.getClaudeMdContent())
      : effectiveClaudeMd;
    if (bellOwner) {
      console.log(`[Agent] Wake lane: ${bellOwner.slug} (Codex thread, ${threadId})`);
    }
    const codexModel = companionTurnModel(companionRowOrNull(codexCompanion?.id), isAutonomous, model);
    return runtime.processViaRouter(
      threadId, content, codexModel, codexPrompt, platform, streamMsgId,
      codexCompanion?.id ?? null, platformOpts, 'codex-cli', isAutonomous,
    );
  }

  // CLI lane: Claude models ride the warm interactive heartbeat session
  // (subscription billing). Each companion gets their own warm session,
  // keyed by companion id.
  //
  // A wake with an owner rings in THEIR lane, with their own persona and blocks
  // rather than the shared room's. That is deliberately not a fan-out: one
  // bell, one companion, one session. It only replaces which door it rings at.
  let cliCompanionId: string | null = null;
  let cliPrompt = effectiveClaudeMd;
  if (bellOwner) {
    // Their own door is the right one — but only while there is someone behind
    // it. A private per-companion lane goes cold between bells and stays cold,
    // so an owned bell would otherwise pay a full re-prime from history every
    // single time while a lane that has actually been in the room all night
    // sits warm next to it. A lane that was there beats a lane that is theirs:
    // the wake prompt already names them either way.
    const threadLaneId = (() => {
      try { return getDefaultCompanionForThread(threadId)?.id ?? null; } catch { return null; }
    })();
    const ownerWarm = isHeartbeatLaneWarm(bellOwner.id);
    const threadLaneWarm = isHeartbeatLaneWarm(threadLaneId || 'primary');

    if (ownerWarm || !threadLaneWarm) {
      cliCompanionId = bellOwner.id;
      cliPrompt = buildLanePrompt(bellOwner.id, bellOwner.slug, runtime.getClaudeMdContent());
      console.log(`[Agent] Wake lane: ${bellOwner.slug}${ownerWarm ? ' (warm)' : ' (cold — no warmer lane to borrow)'} (thread ${threadId})`);
    } else {
      // Shared identity on purpose: rewriting the warm lane's CLAUDE.md to one
      // persona mid-conversation would outlive this single wake.
      cliCompanionId = threadLaneId;
      console.log(`[Agent] Wake lane: ${bellOwner.slug}'s bell ringing in the warm ${threadLaneId || 'primary'} lane — their own is cold (thread ${threadId})`);
    }
  } else {
    try { cliCompanionId = getDefaultCompanionForThread(threadId)?.id ?? null; } catch { /* primary */ }
  }
  // Their own model decides their own lane here too. A companion pointed at a GPT
  // model must not be handed the Claude CLI: the supervisor answers a GPT id
  // with refusals rather than a lane, so the turn goes to Codex with their own
  // prompt and their own key instead. A companion with nothing set is unchanged.
  const cliModel = companionTurnModel(companionRowOrNull(cliCompanionId), isAutonomous, model);
  const cliRoute = multiLaneRuntimeRoute(resolveCompatibleAgentRoute(cliModel, requestedRouting).routing) || 'cli';
  if (cliRoute === 'codex-cli') {
    console.log(`[Agent] ${cliCompanionId ? 'Lane' : 'Shared lane'} on ${cliModel} — riding Codex rather than the Claude lane (thread ${threadId})`);
    return runtime.processViaRouter(
      threadId, content, cliModel, cliPrompt, platform, streamMsgId, cliCompanionId,
      { ...platformOpts, _codexHistorySnapshot: codexHistoryBeforeTurn(getMessages({ threadId, limit: 50 })) },
      'codex-cli', isAutonomous,
    );
  }
  return runtime.processViaRouter(threadId, content, cliModel, cliPrompt, platform, streamMsgId, cliCompanionId, platformOpts, 'cli', isAutonomous);
}
