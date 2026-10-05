// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Lane keeper — the wire between `agent.multi_lane` and the supervisor.
 *
 * When the flag is on, every companion's own CLI lane is kept warm so an
 * owned bell rings at their own door instead of borrowing the shared thread
 * lane. The keeper only ever WARMS: it asks a cold lane to launch through the
 * same `ensure()` road a normal turn uses, behind the supervisor's epoch
 * fence. It never stops, kills, or recycles anything — flipping the flag off
 * simply stops the warming, and lanes cool off on the ordinary quiet ceiling.
 * That asymmetry is deliberate: July 2026's respawn storm was a kill path and
 * a spawn path fighting each other, and a keeper with no kill path cannot
 * have that fight.
 *
 * Wakes are untouched by design — the dispatch already prefers a warm owner
 * lane on an owned bell, so keeping owners warm is the whole intervention.
 */

import { getAerieConfig } from '../../config.js';
import { listCompanions } from '../db/companions.js';
import { buildLanePrompt } from '../agent/agent-dispatch.js';
import { isClaudeModelId, resolveCompatibleAgentRoute, type AgentRouting } from '../agent/agent-route-selection.js';
import { getHeartbeatSession, isHeartbeatLaneWarm } from './supervisor.js';
import { companionTurnEffort } from '../agent/companion-effort.js';

export interface LaneKeeperDeps {
  enabled: () => boolean;
  roster: () => Array<{ id: string; slug: string }>;
  isWarm: (key: string) => boolean;
  warm: (key: string, slug: string) => void;
}

function isWarmClaudeRoute(model: string, requestedRouting: AgentRouting): boolean {
  if (!isClaudeModelId(model)) return false;
  const route = resolveCompatibleAgentRoute(model, requestedRouting).routing;
  return route === 'cli' || route === 'sdk' || route === 'auto';
}

/**
 * Only Claude's per-companion heartbeat processes need proactive warming.
 * Codex has one daemon and persistent app-server threads, so trying to warm a
 * GPT model through the Claude supervisor produces three refusal loops rather
 * than three Codex lanes. If interactive chat is on Codex while owned wakes
 * remain on Claude, keep the wake model warm instead.
 */
export function heartbeatLaneKeeperModel(
  multiLane: unknown,
  interactiveModel: string,
  interactiveRouting: AgentRouting,
  autonomousModel: string,
  autonomousRouting: AgentRouting,
): string | null {
  const on = multiLane === true || String(multiLane) === 'true';
  if (!on) return null;
  if (isWarmClaudeRoute(interactiveModel, interactiveRouting)) return interactiveModel;
  if (isWarmClaudeRoute(autonomousModel, autonomousRouting)) return autonomousModel;
  return null;
}

/**
 * The same rule, asked on behalf of ONE companion.
 *
 * A companion's own `model` / `model_autonomous` override the house setting
 * and then the house rule runs unchanged over the result — so everything
 * heartbeatLaneKeeperModel already knows about Claude-versus-Codex routing
 * keeps applying without being restated here. A companion with nothing of their
 * own is exactly the house answer, which is why turning this on changed
 * nobody's lane until the owner sets one.
 *
 * A companion pointed at a non-Claude model returns null and their lane is
 * skipped rather than warmed on the house's Claude model. Warming the wrong
 * process for them would be worse than not warming: they would have a lane
 * standing open that their turns never use.
 */
export function companionLaneKeeperModel(
  multiLane: unknown,
  companion: { model?: string | null; model_autonomous?: string | null },
  houseInteractiveModel: string,
  interactiveRouting: AgentRouting,
  houseAutonomousModel: string,
  autonomousRouting: AgentRouting,
): string | null {
  return heartbeatLaneKeeperModel(
    multiLane,
    companion.model || houseInteractiveModel,
    interactiveRouting,
    companion.model_autonomous || houseAutonomousModel,
    autonomousRouting,
  );
}

/**
 * A companion deliberately pointed off Claude is not a fault. They have a route
 * that works — it just isn't this one. Marking that case as its own kind of
 * refusal lets the keeper walk past them quietly instead of shouting a stack
 * trace once a minute forever, which reads from the outside exactly like a
 * lane failing to start.
 */
export class LaneNotOnClaude extends Error {
  constructor(slug: string) {
    super(`${slug} is not on a Claude model — nothing for the heartbeat keeper to warm`);
    this.name = 'LaneNotOnClaude';
  }
}

/** The effort a real turn would ask for. See the note at the ensure() call. */
export function laneKeeperEffort(cfg: { agent: { claude_effort?: string; effort?: string } }): string {
  return cfg.agent.claude_effort || cfg.agent.effort || 'adaptive';
}

function defaultDeps(): LaneKeeperDeps {
  return {
    // Tolerates a quoted "true" — a hand-edited aerie.yaml is a supported way
    // in, and the dispatch fan-out accepts the same spelling.
    enabled: () => {
      const cfg = getAerieConfig();
      return heartbeatLaneKeeperModel(
        cfg.agent.multi_lane,
        cfg.agent.model,
        (cfg.agent.routing || 'cli') as AgentRouting,
        cfg.agent.model_autonomous,
        (cfg.agent.routing_autonomous || cfg.agent.routing || 'cli') as AgentRouting,
      ) !== null;
    },
    roster: () => listCompanions().map((c) => ({ id: c.id, slug: c.slug })),
    isWarm: isHeartbeatLaneWarm,
    warm: (key, slug) => {
      const cfg = getAerieConfig();
      // The keeper has always held the companion's key in its hand here and
      // asked the house setting anyway. It asks them first now.
      const companion = listCompanions().find((c) => c.id === key) || { model: null, model_autonomous: null, effort: null };
      const model = companionLaneKeeperModel(
        cfg.agent.multi_lane,
        companion,
        cfg.agent.model,
        (cfg.agent.routing || 'cli') as AgentRouting,
        cfg.agent.model_autonomous,
        (cfg.agent.routing_autonomous || cfg.agent.routing || 'cli') as AgentRouting,
      );
      if (!model) throw new LaneNotOnClaude(slug);
      // An empty prompt would launch a lane with no one behind its eyes —
      // refusing here routes into the per-lane catch, which skips this lane
      // and leaves the other companions' warming untouched.
      const prompt = buildLanePrompt(key, slug, '');
      if (!prompt.trim()) throw new Error(`no identity available for lane ${slug}`);
      // The effort MUST be the same one a real turn would ask for. The keeper
      // and the turn path both reach the supervisor through ensure(), and
      // ensure() recycles the session when the effort changes — so two callers
      // disagreeing here take turns restarting the lane, and each restart
      // kills whatever turn is mid-sentence. That is a silent lane, not a
      // slow one. Read the owner's setting; never hardcode a second opinion.
      // Their own dial first, the house Claude dial behind it — resolved through
      // the same function the turn path uses, for the reason in the paragraph
      // above: two answers here means two callers restarting each other's lane.
      getHeartbeatSession(key).ensure(model, prompt, companionTurnEffort(companion, 'cli', cfg));
    },
  };
}

/**
 * One pass: warm every companion lane that is cold, when the flag says to.
 * Returns the keys it warmed this pass — an empty array is the normal quiet
 * answer (flag off, or everyone already warm).
 */
export function ensureCompanionLanes(deps: LaneKeeperDeps = defaultDeps()): string[] {
  if (!deps.enabled()) return [];
  const warmed: string[] = [];
  for (const c of deps.roster()) {
    if (deps.isWarm(c.id)) continue;
    try {
      deps.warm(c.id, c.slug);
      warmed.push(c.id);
      console.log(`[LaneKeeper] warmed ${c.slug}'s lane`);
    } catch (err) {
      // One lane refusing to light must not stop the others from being lit.
      if (err instanceof LaneNotOnClaude) continue;
      console.warn(`[LaneKeeper] could not warm ${c.slug}'s lane:`, err);
    }
  }
  return warmed;
}

let keeperTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic keeper. Reads the flag fresh every tick, so a settings
 * save flips behavior live with no restart — on to warming, off to leaving
 * the lanes alone. Safe to call once at server start; idempotent.
 */
export function startLaneKeeper(intervalMs = 60_000): void {
  if (keeperTimer) return;
  ensureCompanionLanes();
  keeperTimer = setInterval(() => ensureCompanionLanes(), intervalMs);
  keeperTimer.unref?.();
}

export function stopLaneKeeper(): void {
  if (keeperTimer) {
    clearInterval(keeperTimer);
    keeperTimer = null;
  }
}
