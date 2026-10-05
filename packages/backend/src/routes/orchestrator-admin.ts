// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Orchestrator admin routes — toggle, status, tasks, failsafe, triggers
// Also includes telegram/voice toggle since they're service toggles in the same UI section.

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setConfig, getConfig, createTrigger, listTriggers, cancelTrigger } from '../services/db.js';
import type { TriggerCondition } from '../services/db.js';
import type { Orchestrator } from '../services/orchestrator.js';
import type { TelegramService } from '../services/telegram/index.js';
import { upsertWakeSection, removeWakeSection, parseWakeOutcomes } from '../services/wake-prompts.js';
import { resolveCompatibleAgentRoute } from '../services/agent/agent-route-selection.js';
import { resolveSilenceCheckModel } from '../services/silence-check.js';
import type { AgentRouting } from '../services/agent/agent-route-selection.js';
import { getAerieConfig } from '../config.js';
import { authMiddleware } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Same relative depth as orchestrator.ts — works from src/ and dist/
const ORCHESTRATOR_LOG = join(__dirname, '..', '..', '..', '..', 'logs', 'orchestrator.log');

const router = Router();

// POST /orchestrator/toggle
router.post('/orchestrator/toggle', (req, res) => {
  try {
    const { enabled } = req.body as { enabled: boolean };
    const orchestrator = req.app.locals.orchestrator as Orchestrator | undefined;
    if (!orchestrator) {
      res.status(503).json({ error: 'Orchestrator not available' });
      return;
    }
    if (enabled) {
      orchestrator.start();
    } else {
      orchestrator.stop();
    }
    setConfig('orchestrator.enabled', enabled ? 'true' : 'false');
    res.json({ success: true, enabled });
  } catch (err) {
    console.error('Error toggling orchestrator:', err);
    res.status(500).json({ error: 'Failed to toggle orchestrator' });
  }
});

// POST /telegram/toggle
// /telegram and /voice toggles sit outside the /api/orchestrator prefix, so the
// prefix gate in server.ts does not reach them — they carry auth on the handler,
// same pattern as companions.ts's /voice/reset-all.
router.post('/telegram/toggle', authMiddleware, async (req, res) => {
  try {
    const { enabled } = req.body as { enabled: boolean };
    const service = req.app.locals.telegramService as TelegramService | null;
    if (enabled) {
      if (!service) {
        res.status(400).json({ error: 'Telegram service not initialized (set telegram_bot_token and restart once)' });
        return;
      }
      await service.start();
    } else if (service) {
      await service.stop();
    }
    setConfig('telegram.enabled', enabled ? 'true' : 'false');
    res.json({ success: true, enabled });
  } catch (err) {
    console.error('Error toggling Telegram:', err);
    res.status(500).json({ error: 'Failed to toggle Telegram' });
  }
});

// POST /voice/toggle
router.post('/voice/toggle', authMiddleware, (req, res) => {
  try {
    const { enabled } = req.body as { enabled: boolean };
    setConfig('voice.enabled', enabled ? 'true' : 'false');
    res.json({ success: true, enabled });
  } catch (err) {
    console.error('Error toggling voice:', err);
    res.status(500).json({ error: 'Failed to toggle voice' });
  }
});

// POST /voice/read-actions-aloud/toggle
// The old path is kept as an alias on purpose: the phone ships on a refresh
// and the backend on a restart, so between the two a renamed route would
// fall through to the SPA and answer HTML that reads like a success.
router.post(['/voice/read-actions-aloud/toggle', '/voice/speak-actions/toggle'], authMiddleware, (req, res) => {
  try {
    const { enabled } = req.body as { enabled: boolean };
    setConfig('voice.read_actions_aloud', enabled ? 'true' : 'false');
    res.json({ success: true, enabled });
  } catch (err) {
    console.error('Error toggling read-actions-aloud:', err);
    res.status(500).json({ error: 'Failed to toggle read actions aloud' });
  }
});

// GET /orchestrator/status
router.get('/orchestrator/status', async (req, res) => {
  try {
    const orchestrator = req.app.locals.orchestrator as Orchestrator | undefined;
    if (!orchestrator) {
      res.status(503).json({ error: 'Orchestrator not available' });
      return;
    }
    const tasks = await orchestrator.getStatus();
    res.json({ tasks });
  } catch (error) {
    console.error('Error fetching orchestrator status:', error);
    res.status(500).json({ error: 'Failed to fetch orchestrator status' });
  }
});

// PATCH /orchestrator/tasks/:wakeType — enable/disable/reschedule a task
router.patch('/orchestrator/tasks/:wakeType', async (req, res) => {
  try {
    const orchestrator = req.app.locals.orchestrator as Orchestrator | undefined;
    if (!orchestrator) {
      res.status(503).json({ error: 'Orchestrator not available' });
      return;
    }

    const { wakeType } = req.params;
    const { enabled, cronExpr, companion, label } = req.body;

    // null (or '') hands the bell back to the house — shared, thread default
    // decides. A slug hands it to one companion, who then rings in their own lane.
    if (companion !== undefined) {
      if (companion !== null && typeof companion !== 'string') {
        res.status(400).json({ error: 'companion must be a slug or null' });
        return;
      }
      const slug = typeof companion === 'string' ? companion.trim() : '';
      const success = orchestrator.setTaskCompanion(wakeType, slug || null);
      if (!success) {
        res.status(400).json({ error: 'Unknown task, or no companion with that slug' });
        return;
      }
    }

    if (cronExpr !== undefined) {
      if (typeof cronExpr !== 'string') {
        res.status(400).json({ error: 'cronExpr must be a string' });
        return;
      }
      const success = orchestrator.rescheduleTask(wakeType, cronExpr);
      if (!success) {
        res.status(400).json({ error: 'Failed to reschedule — invalid cron expression or unknown task' });
        return;
      }
    }

    // A label used to be accepted into this handler and silently dropped: the
    // body named it, the route never read it, and the response still said
    // success. Renaming is the one edit a reframed bell always needs.
    if (label !== undefined) {
      if (typeof label !== 'string') {
        res.status(400).json({ error: 'label must be a string' });
        return;
      }
      const success = orchestrator.setTaskLabel(wakeType, label);
      if (!success) {
        res.status(404).json({ error: 'Unknown task' });
        return;
      }
    }

    if (enabled !== undefined) {
      if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'enabled must be a boolean' });
        return;
      }
      const success = enabled
        ? orchestrator.enableTask(wakeType)
        : orchestrator.disableTask(wakeType);
      if (!success) {
        res.status(404).json({ error: 'Unknown task' });
        return;
      }
    }

    const tasks = await orchestrator.getStatus();
    res.json({ success: true, tasks });
  } catch (error) {
    console.error('Error updating orchestrator task:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// POST /orchestrator/tasks — make a new bell, live.
//
// Handing out a bell used to mean a key in aerie.yaml, a section in the wake
// prompts file and a restart. Three hands for something that is the user's to give.
// The prompt is written first and reloaded into the running process, because a
// wake with no prompt registers a timer that fires into nothing forever.
router.post('/orchestrator/tasks', async (req, res) => {
  try {
    const orchestrator = req.app.locals.orchestrator as Orchestrator | undefined;
    if (!orchestrator) {
      res.status(503).json({ error: 'Orchestrator not available' });
      return;
    }
    const body = req.body as {
      wakeType?: string;
      cronExpr?: string;
      label?: string;
      companion?: string | null;
      prompt?: string;
    };
    const wakeType = (body.wakeType || '').trim();
    const cronExpr = (body.cronExpr || '').trim();
    const prompt = (body.prompt || '').trim();

    if (!wakeType || !cronExpr) {
      res.status(400).json({ error: 'wakeType and cronExpr are required' });
      return;
    }
    if (!prompt) {
      res.status(400).json({ error: 'A bell needs something to say — write its prompt.' });
      return;
    }

    editWakePromptsFile(orchestrator, (raw) => upsertWakeSection(raw, wakeType, prompt));

    const result = orchestrator.createCustomWake({
      wakeType,
      cronExpr,
      label: body.label,
      companion: body.companion ?? null,
    });
    if (!result.ok) {
      // The prompt section is left in place deliberately: the user wrote it, and it
      // is the one part of a rejected bell worth keeping.
      res.status(400).json({ error: result.error });
      return;
    }

    const tasks = await orchestrator.getStatus();
    res.json({ success: true, tasks });
  } catch (error) {
    console.error('Error creating custom wake:', error);
    res.status(500).json({ error: 'Failed to create wake' });
  }
});

// DELETE /orchestrator/tasks/:wakeType — remove a bell the user made (built-ins
// turn off rather than disappear, so there is always a way back to them).
router.delete('/orchestrator/tasks/:wakeType', async (req, res) => {
  try {
    const orchestrator = req.app.locals.orchestrator as Orchestrator | undefined;
    if (!orchestrator) {
      res.status(503).json({ error: 'Orchestrator not available' });
      return;
    }
    const { wakeType } = req.params;
    if (!/^\w+$/.test(wakeType)) {
      res.status(400).json({ error: 'Invalid wake type' });
      return;
    }
    const result = orchestrator.deleteCustomWake(wakeType);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    editWakePromptsFile(orchestrator, (raw) => removeWakeSection(raw, wakeType));
    const tasks = await orchestrator.getStatus();
    res.json({ success: true, tasks });
  } catch (error) {
    console.error('Error deleting custom wake:', error);
    res.status(500).json({ error: 'Failed to delete wake' });
  }
});

// GET /orchestrator/failsafe
router.get('/orchestrator/failsafe', (req, res) => {
  try {
    const orchestrator = req.app.locals.orchestrator as Orchestrator | undefined;
    if (!orchestrator) {
      res.status(503).json({ error: 'Orchestrator not available' });
      return;
    }
    res.json(orchestrator.getFailsafeConfig());
  } catch (error) {
    console.error('Error fetching failsafe config:', error);
    res.status(500).json({ error: 'Failed to fetch failsafe config' });
  }
});

// PATCH /orchestrator/failsafe
router.patch('/orchestrator/failsafe', (req, res) => {
  try {
    const orchestrator = req.app.locals.orchestrator as Orchestrator | undefined;
    if (!orchestrator) {
      res.status(503).json({ error: 'Orchestrator not available' });
      return;
    }

    const { enabled, gentle, concerned, emergency } = req.body;
    orchestrator.setFailsafeConfig({ enabled, gentle, concerned, emergency });
    res.json({ success: true, ...orchestrator.getFailsafeConfig() });
  } catch (error) {
    console.error('Error updating failsafe config:', error);
    res.status(500).json({ error: 'Failed to update failsafe config' });
  }
});

// GET /orchestrator/spontaneous
router.get('/orchestrator/spontaneous', (req, res) => {
  try {
    const orchestrator = req.app.locals.orchestrator as Orchestrator | undefined;
    if (!orchestrator) {
      res.status(503).json({ error: 'Orchestrator not available' });
      return;
    }
    res.json(orchestrator.getSpontaneousConfig());
  } catch (error) {
    console.error('Error fetching spontaneous config:', error);
    res.status(500).json({ error: 'Failed to fetch spontaneous config' });
  }
});

// PATCH /orchestrator/spontaneous
router.patch('/orchestrator/spontaneous', (req, res) => {
  try {
    const orchestrator = req.app.locals.orchestrator as Orchestrator | undefined;
    if (!orchestrator) {
      res.status(503).json({ error: 'Orchestrator not available' });
      return;
    }
    const { enabled, maxPerDay, windowStart, windowEnd } = req.body;
    orchestrator.setSpontaneousConfig({ enabled, maxPerDay, windowStart, windowEnd });
    res.json({ success: true, ...orchestrator.getSpontaneousConfig() });
  } catch (error) {
    console.error('Error updating spontaneous config:', error);
    res.status(500).json({ error: 'Failed to update spontaneous config' });
  }
});

// --- Wake prompt truth (effective prompts + per-section editing) -----------

function readOrchestratorLog(): string {
  let text = '';
  for (const path of [ORCHESTRATOR_LOG + '.1', ORCHESTRATOR_LOG]) {
    if (existsSync(path)) {
      try {
        text += readFileSync(path, 'utf-8');
      } catch {
        // Log reading is best-effort — outcomes just come back empty
      }
    }
  }
  return text;
}

// GET /orchestrator/wake-prompts — effective prompt per wake type, with
// source attribution (file override vs default), unused file sections,
// and the last real outcome of each wake type from the orchestrator log.
router.get('/orchestrator/wake-prompts', (req, res) => {
  try {
    const orchestrator = req.app.locals.orchestrator as Orchestrator | undefined;
    if (!orchestrator) {
      res.status(503).json({ error: 'Orchestrator not available' });
      return;
    }
    const report = orchestrator.getWakePromptReport();
    const outcomes = parseWakeOutcomes(readOrchestratorLog());
    res.json({ ...report, outcomes });
  } catch (error) {
    console.error('Error building wake prompt report:', error);
    res.status(500).json({ error: 'Failed to build wake prompt report' });
  }
});

function editWakePromptsFile(
  orchestrator: Orchestrator,
  mutate: (raw: string) => string,
): void {
  const path = getAerieConfig().orchestrator.wake_prompts_path;
  const raw = existsSync(path) ? readFileSync(path, 'utf-8') : '# Wake Prompts\n';
  if (existsSync(path)) writeFileSync(path + '.backup', raw, 'utf-8');
  writeFileSync(path, mutate(raw), 'utf-8');
  orchestrator.reloadWakePrompts();
}

// PUT /orchestrator/wake-prompts/:wakeType — set a file override for one
// wake type. Takes effect in the live process immediately (no restart).
router.put('/orchestrator/wake-prompts/:wakeType', (req, res) => {
  try {
    const orchestrator = req.app.locals.orchestrator as Orchestrator | undefined;
    if (!orchestrator) {
      res.status(503).json({ error: 'Orchestrator not available' });
      return;
    }
    const { content } = req.body as { content?: string };
    if (typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ error: 'content required' });
      return;
    }
    if (!/^\w+$/.test(req.params.wakeType)) {
      res.status(400).json({ error: 'Invalid wake type' });
      return;
    }
    editWakePromptsFile(orchestrator, (raw) => upsertWakeSection(raw, req.params.wakeType, content));
    const outcomes = parseWakeOutcomes(readOrchestratorLog());
    res.json({ success: true, ...orchestrator.getWakePromptReport(), outcomes });
  } catch (error) {
    console.error('Error updating wake prompt:', error);
    res.status(500).json({ error: 'Failed to update wake prompt' });
  }
});

// DELETE /orchestrator/wake-prompts/:wakeType — remove the file override so
// the built-in default applies again (also removes unused leftover sections).
router.delete('/orchestrator/wake-prompts/:wakeType', (req, res) => {
  try {
    const orchestrator = req.app.locals.orchestrator as Orchestrator | undefined;
    if (!orchestrator) {
      res.status(503).json({ error: 'Orchestrator not available' });
      return;
    }
    if (!/^\w+$/.test(req.params.wakeType)) {
      res.status(400).json({ error: 'Invalid wake type' });
      return;
    }
    editWakePromptsFile(orchestrator, (raw) => removeWakeSection(raw, req.params.wakeType));
    const outcomes = parseWakeOutcomes(readOrchestratorLog());
    res.json({ success: true, ...orchestrator.getWakePromptReport(), outcomes });
  } catch (error) {
    console.error('Error removing wake prompt override:', error);
    res.status(500).json({ error: 'Failed to remove wake prompt override' });
  }
});

// --- Runtime truth (which lane each class of turn actually runs on) --------

function laneLabel(routing: AgentRouting): string {
  switch (routing) {
    case 'cli': return 'Warm Claude CLI heartbeat (subscription lane)';
    case 'codex-cli': return 'Codex daemon (warm CLI)';
    case 'sdk': return 'Retired SDK routing — rides the warm Claude CLI lane';
    case 'api': return 'Provider router (direct API)';
    case 'auto': return 'Auto-routed (router decides per turn)';
    default: return routing;
  }
}

// GET /orchestrator/runtime — resolved from LIVE config on every request, so
// whatever model is picked (Claude or Codex, any lane) is what this reports.
// Never hardcodes a lane: routing is re-resolved against the current model
// exactly the way the agent itself resolves it.
router.get('/orchestrator/runtime', (_req, res) => {
  try {
    const config = getAerieConfig();

    const interactiveRequested = (config.agent.routing || 'cli') as AgentRouting;
    const interactive = resolveCompatibleAgentRoute(config.agent.model, interactiveRequested);
    const autonomousRequested = (config.agent.routing_autonomous || config.agent.routing || 'cli') as AgentRouting;
    const autonomous = resolveCompatibleAgentRoute(config.agent.model_autonomous, autonomousRequested);

    // Silence check always rides the stateless Codex one-shot runtime
    // (ChatGPT subscription) since the SDK retirement. Show the model it
    // will actually resolve to, not just the configured pulse model.
    const pulseModel = resolveSilenceCheckModel(config);
    const pulseLane = 'Codex one-shot (stateless, subscription)';

    // Identity file: same candidate order the agent lane actually loads.
    const identityCandidates = [
      config.agent.claude_md_path,
      join(config.agent.cwd, '.claude/CLAUDE.md'),
      join(config.agent.cwd, 'CLAUDE.md'),
    ];
    const identityFile = identityCandidates.find((p) => existsSync(p)) || null;

    res.json({
      lanes: [
        {
          id: 'interactive',
          label: 'Conversation',
          model: config.agent.model,
          requestedRouting: interactiveRequested,
          effectiveRouting: interactive.routing,
          corrected: interactive.corrected,
          reason: interactive.reason || null,
          laneLabel: laneLabel(interactive.routing),
        },
        {
          id: 'autonomous',
          label: 'Wakes & triggers',
          model: config.agent.model_autonomous,
          requestedRouting: autonomousRequested,
          effectiveRouting: autonomous.routing,
          corrected: autonomous.corrected,
          reason: autonomous.reason || null,
          laneLabel: laneLabel(autonomous.routing),
        },
        {
          id: 'pulse',
          label: 'Failsafe silence check',
          model: pulseModel,
          requestedRouting: null,
          effectiveRouting: null,
          corrected: false,
          reason: null,
          laneLabel: pulseLane,
        },
        {
          id: 'archivist',
          label: 'Archivist sweeps',
          model: config.agent.archivist_model,
          requestedRouting: config.agent.archivist_provider,
          effectiveRouting: config.agent.archivist_provider,
          corrected: false,
          reason: null,
          // A lane gets its own name. 'sdk' through here would have read as
          // "Provider router (sdk)", which is not what it is and hides the one
          // thing worth knowing about it — which meter it spends.
          laneLabel: config.agent.archivist_provider === 'codex'
            ? 'Codex daemon (warm CLI)'
            : config.agent.archivist_provider === 'sdk'
              ? 'Claude Agent SDK (subscription-backed; not in the picker)'
              : `Provider router (${config.agent.archivist_provider})`,
        },
      ],
      identityFile,
      wakePromptsPath: config.orchestrator.wake_prompts_path,
      agentCwd: config.agent.cwd,
      timezone: config.identity.timezone,
      orchestratorEnabled: getConfig('orchestrator.enabled') !== 'false',
    });
  } catch (error) {
    console.error('Error building runtime report:', error);
    res.status(500).json({ error: 'Failed to build runtime report' });
  }
});

// GET /orchestrator/wake-thread — the home thread wakes fall back to
router.get('/orchestrator/wake-thread', (_req, res) => {
  try {
    res.json({ threadId: getConfig('orchestrator.wake_thread_id') || null });
  } catch (error) {
    console.error('Error fetching wake thread:', error);
    res.status(500).json({ error: 'Failed to fetch wake thread' });
  }
});

// PATCH /orchestrator/wake-thread
router.patch('/orchestrator/wake-thread', (req, res) => {
  try {
    const { threadId } = req.body as { threadId?: string | null };
    setConfig('orchestrator.wake_thread_id', threadId || '');
    res.json({ success: true, threadId: threadId || null });
  } catch (error) {
    console.error('Error updating wake thread:', error);
    res.status(500).json({ error: 'Failed to update wake thread' });
  }
});

// GET /orchestrator/triggers
router.get('/orchestrator/triggers', (req, res) => {
  try {
    const kind = req.query.kind as 'impulse' | 'watcher' | undefined;
    const triggers = listTriggers(kind);
    res.json({ triggers });
  } catch (error) {
    console.error('Error fetching triggers:', error);
    res.status(500).json({ error: 'Failed to fetch triggers' });
  }
});

// POST /orchestrator/triggers — create a new trigger
router.post('/orchestrator/triggers', (req, res) => {
  try {
    const body = req.body as {
      kind?: 'impulse' | 'watcher';
      label?: string;
      conditions?: unknown[];
      prompt?: string;
      threadId?: string;
      cooldownMinutes?: number;
    };
    if (body.kind !== 'impulse' && body.kind !== 'watcher') {
      res.status(400).json({ error: 'kind must be "impulse" or "watcher"' });
      return;
    }
    if (!body.label || typeof body.label !== 'string') {
      res.status(400).json({ error: 'label is required' });
      return;
    }
    if (!Array.isArray(body.conditions) || body.conditions.length === 0) {
      res.status(400).json({ error: 'At least one condition is required' });
      return;
    }

    const trigger = createTrigger({
      id: randomUUID(),
      kind: body.kind,
      label: body.label,
      conditions: body.conditions as TriggerCondition[],
      prompt: body.prompt,
      threadId: body.threadId,
      cooldownMinutes: body.cooldownMinutes,
      createdAt: new Date().toISOString(),
    });

    res.json({ success: true, trigger });
  } catch (err) {
    console.error('Error creating trigger:', err);
    res.status(500).json({ error: 'Failed to create trigger' });
  }
});

// DELETE /orchestrator/triggers/:id
router.delete('/orchestrator/triggers/:id', (req, res) => {
  try {
    const cancelled = cancelTrigger(req.params.id);
    if (!cancelled) {
      res.status(404).json({ error: 'Trigger not found or already cancelled' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error cancelling trigger:', error);
    res.status(500).json({ error: 'Failed to cancel trigger' });
  }
});

export default router;
