// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { Router } from 'express';
import { parse as parseCookie } from 'cookie';
import { readFileSync, writeFileSync } from 'fs';
import * as yaml from 'js-yaml';
import { deleteOtherWebSessions, setConfig, getConfigBool } from '../../services/db.js';
import { getCookieName, checkPasswordChange } from '../../middleware/auth.js';
import { findConfigPath } from '../../services/agent-settings.js';
import { getAerieConfig, updateConfigValue } from '../../config.js';
import { resolveCompatibleAgentRoute } from '../../services/agent/agent-route-selection.js';
import { shutdownAllHeartbeats } from '../../services/heartbeat/supervisor.js';
import { getSecret, setSecret } from '../../services/secrets.js';

const router = Router();

// --- Preferences (aerie.yaml) ---

router.get('/preferences', (req, res) => {
  try {
    const configPath = findConfigPath();
    if (!configPath) {
      res.json({ error: 'No config file found' });
      return;
    }
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = yaml.load(raw) as Record<string, unknown> || {};
    // Only expose safe, editable fields — not server internals
    const config = getAerieConfig();
    const autonomousRoute = resolveCompatibleAgentRoute(
      config.agent.model_autonomous,
      config.agent.routing_autonomous || config.agent.routing || 'cli',
    ).routing;
    res.json({
      identity: {
        companion_name: config.identity.companion_name,
        user_name: config.identity.user_name,
        timezone: config.identity.timezone,
      },
      agent: {
        model: config.agent.model,
        model_autonomous: config.agent.model_autonomous,
        model_pulse: config.agent.model_pulse,
        thinking: config.agent.thinking,
        effort: config.agent.effort || 'adaptive',
        claude_thinking: config.agent.claude_thinking || config.agent.thinking || 'adaptive',
        claude_effort: config.agent.claude_effort || config.agent.effort || 'adaptive',
        codex_effort: config.agent.codex_effort || config.agent.effort || 'adaptive',
        codex_speed: config.agent.codex_speed || 'standard',
        archivist_provider: config.agent.archivist_provider || 'ollama',
        archivist_model: config.agent.archivist_model || 'deepseek-v4-pro',
        archivist_effort: config.agent.archivist_effort || 'adaptive',
        archivist_thinking: config.agent.archivist_thinking || 'disabled',
        routing: config.agent.routing || 'cli',
        routing_autonomous: autonomousRoute,
        // Multi-lane room. Tolerates a quoted "true" from a hand-edited YAML.
        multi_lane: config.agent.multi_lane === true || String(config.agent.multi_lane) === 'true',
      },
      orchestrator: {
        // DB value takes precedence — the toggle writes to DB, not YAML
        enabled: getConfigBool('orchestrator.enabled', config.orchestrator.enabled),
      },
      voice: {
        enabled: getConfigBool('voice.enabled', config.voice.enabled),
        // Read stage directions aloud instead of collapsing them to a cue.
        read_actions_aloud: getConfigBool('voice.read_actions_aloud', false),
      },
      discord: {
        enabled: getConfigBool('discord.enabled', config.discord.enabled),
      },
      telegram: {
        enabled: getConfigBool('telegram.enabled', config.telegram.enabled),
      },
      auth: {
        has_password: !!config.auth.password,
      },
      providers: {
        ollama: config.providers?.ollama ? {
          base_url: config.providers.ollama.base_url,
          api_key: (getSecret('ollama_api_key') || getSecret('ollama_api_key_pending') || config.providers.ollama.api_key) ? '••••••••' : undefined,
        } : undefined,
        openrouter: config.providers?.openrouter ? { api_key: '••••••••' } : undefined,
        groq: config.providers?.groq ? { api_key: '••••••••' } : undefined,
        xai: config.providers?.xai ? { api_key: '••••••••' } : undefined,
        openai: config.providers?.openai ? { api_key: '••••••••' } : undefined,
        huggingface: config.providers?.huggingface ? { api_key: '••••••••' } : undefined,
        anthropic: config.providers?.anthropic ? { api_key: '••••••••' } : undefined,
      },
    });
  } catch (err) {
    console.error('Failed to read preferences:', err);
    res.status(500).json({ error: 'Failed to read preferences' });
  }
});

router.put('/preferences', (req, res) => {
  try {
    const configPath = findConfigPath();
    if (!configPath) {
      res.status(404).json({ error: 'No config file found' });
      return;
    }
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = (yaml.load(raw) as Record<string, any>) || {};
    const updates = req.body as Record<string, any>;
    if (updates?.auth?.password !== undefined) {
      const verdict = checkPasswordChange(updates.auth.current_password, updates.auth.password, getAerieConfig().auth.password || '', !!process.env.APP_PASSWORD);
      if (!verdict.ok) {
        res.status(verdict.status).json({ error: verdict.error });
        return;
      }
    }
    const priorAgent = getAerieConfig().agent;
    const priorRuntimeSelection = {
      model: priorAgent.model,
      modelAutonomous: priorAgent.model_autonomous,
      routing: priorAgent.routing,
      routingAutonomous: priorAgent.routing_autonomous,
    };

    // A model and its warm route are one selection. Older callers — and old
    // stored state — can still submit only one half, so normalize the pair at
    // the server boundary instead of making every later turn repair it again.
    if (updates.agent) {
      const touchesInteractive = updates.agent.model !== undefined || updates.agent.routing !== undefined;
      if (touchesInteractive) {
        const model = updates.agent.model ?? priorAgent.model;
        const requested = (updates.agent.routing ?? priorAgent.routing ?? 'cli') as Parameters<typeof resolveCompatibleAgentRoute>[1];
        updates.agent.routing = resolveCompatibleAgentRoute(model, requested).routing;
      }

      const touchesAutonomous = updates.agent.model_autonomous !== undefined || updates.agent.routing_autonomous !== undefined;
      if (touchesAutonomous) {
        const model = updates.agent.model_autonomous ?? priorAgent.model_autonomous;
        const requested = (
          updates.agent.routing_autonomous
          ?? priorAgent.routing_autonomous
          ?? updates.agent.routing
          ?? priorAgent.routing
          ?? 'cli'
        ) as Parameters<typeof resolveCompatibleAgentRoute>[1];
        updates.agent.routing_autonomous = resolveCompatibleAgentRoute(model, requested).routing;
      }
    }

    // Merge only allowed fields
    if (updates.identity) {
      if (!parsed.identity) parsed.identity = {};
      if (updates.identity.companion_name !== undefined) parsed.identity.companion_name = updates.identity.companion_name;
      if (updates.identity.user_name !== undefined) parsed.identity.user_name = updates.identity.user_name;
      if (updates.identity.timezone !== undefined) parsed.identity.timezone = updates.identity.timezone;
    }
    if (updates.agent) {
      if (!parsed.agent) parsed.agent = {};
      const writeAgent = (key: string, value: unknown) => {
        parsed.agent[key] = value;
        const stored = String(value);
        setConfig(`agent.${key}`, stored);
        updateConfigValue(`agent.${key}`, stored);
      };
      if (updates.agent.model !== undefined) {
        writeAgent('model', updates.agent.model);
      }
      if (updates.agent.model_autonomous !== undefined) {
        writeAgent('model_autonomous', updates.agent.model_autonomous);
      }
      if (updates.agent.model_pulse !== undefined) {
        writeAgent('model_pulse', updates.agent.model_pulse);
      }
      if (updates.agent.thinking !== undefined) {
        writeAgent('thinking', updates.agent.thinking);
      }
      if (updates.agent.effort !== undefined) {
        writeAgent('effort', updates.agent.effort);
      }
      for (const key of [
        'claude_thinking', 'claude_effort', 'codex_effort', 'codex_speed',
        'archivist_provider', 'archivist_model', 'archivist_effort', 'archivist_thinking',
      ] as const) {
        if (updates.agent[key] !== undefined) {
          writeAgent(key, updates.agent[key]);
        }
      }
      if (updates.agent.routing !== undefined) {
        writeAgent('routing', updates.agent.routing);
      }
      if (updates.agent.routing_autonomous !== undefined) {
        writeAgent('routing_autonomous', updates.agent.routing_autonomous);
      }
      if (updates.agent.ambient_recall !== undefined) {
        writeAgent('ambient_recall', updates.agent.ambient_recall);
      }
      if (updates.agent.multi_lane !== undefined) {
        // Written as a real boolean, not the string "true" — a quoted string
        // would never equal true on reload.
        writeAgent('multi_lane', updates.agent.multi_lane === true || String(updates.agent.multi_lane) === 'true');
      }
    }
    if (updates.orchestrator) {
      if (!parsed.orchestrator) parsed.orchestrator = {};
      if (updates.orchestrator.enabled !== undefined) parsed.orchestrator.enabled = updates.orchestrator.enabled;
    }
    if (updates.voice) {
      if (!parsed.voice) parsed.voice = {};
      if (updates.voice.enabled !== undefined) parsed.voice.enabled = updates.voice.enabled;
    }
    if (updates.discord) {
      if (!parsed.discord) parsed.discord = {};
      if (updates.discord.enabled !== undefined) parsed.discord.enabled = updates.discord.enabled;
    }
    if (updates.telegram) {
      if (!parsed.telegram) parsed.telegram = {};
      if (updates.telegram.enabled !== undefined) parsed.telegram.enabled = updates.telegram.enabled;
    }
    // A new password ends every other session. Nobody should still be holding
    // the old way in, except the person who just changed it, standing here.
    let passwordChanged = false;
    if (updates.auth) {
      if (!parsed.auth) parsed.auth = {};
      if (updates.auth.password !== undefined && updates.auth.password !== parsed.auth.password) {
        parsed.auth.password = updates.auth.password;
        passwordChanged = true;
      }
      // The current_password field is a check, never something to store.
      delete parsed.auth.current_password;
    }
    if (updates.providers) {
      if (!parsed.providers) parsed.providers = {};
      if (updates.providers.ollama?.base_url !== undefined) {
        // Provider keys belong in the DB secrets store, not the YAML file.
        // The phone omits a masked key on later saves, so preserve the stored
        // value unless a genuinely new key was submitted.
        const submittedKey = updates.providers.ollama.api_key;
        if (submittedKey && !String(submittedKey).startsWith('•')) {
          setSecret('ollama_api_key', submittedKey);
        } else if (parsed.providers.ollama?.api_key && !getSecret('ollama_api_key')) {
          // One-way migration for older houses that still have the key in YAML.
          setSecret('ollama_api_key', parsed.providers.ollama.api_key);
        }
        parsed.providers.ollama = {
          base_url: updates.providers.ollama.base_url,
        };
      }
      if (updates.providers.openrouter?.api_key !== undefined) {
        parsed.providers.openrouter = { api_key: updates.providers.openrouter.api_key };
      }
      if (updates.providers.groq?.api_key !== undefined) {
        parsed.providers.groq = { api_key: updates.providers.groq.api_key };
      }
      if (updates.providers.xai?.api_key !== undefined) {
        parsed.providers.xai = { api_key: updates.providers.xai.api_key };
      }
      if (updates.providers.openai?.api_key !== undefined) {
        parsed.providers.openai = { api_key: updates.providers.openai.api_key };
      }
      if (updates.providers.huggingface?.api_key !== undefined) {
        parsed.providers.huggingface = { api_key: updates.providers.huggingface.api_key };
      }
      if (updates.providers.anthropic?.api_key !== undefined) {
        parsed.providers.anthropic = { api_key: updates.providers.anthropic.api_key };
      }
    }

    // Write back
    const newYaml = yaml.dump(parsed, { lineWidth: -1, quoteStyle: 'double', forceQuotes: true });
    writeFileSync(configPath, newYaml, 'utf-8');

    if (passwordChanged) {
      const cookieHeader = req.headers.cookie;
      const currentToken = cookieHeader ? parseCookie(cookieHeader)[getCookieName()] : undefined;
      const ended = deleteOtherWebSessions(currentToken);
      console.log(`[Auth] Password changed; ended ${ended} other session(s)`);
      // In memory too, so the old password stops working now, not at restart.
      getAerieConfig().auth.password = updates.auth.password;
    }

    // A preferences save updates the running config immediately. Claude
    // heartbeat children, however, keep their own relaunch timers and queued
    // inbox work. Without explicitly stopping them, switching the house to
    // Codex can leave capped Claude lanes retrying in the background; when the
    // subscription window resets they resume stale work and spend the new
    // window even though every new turn routes elsewhere.
    const nextAgent = getAerieConfig().agent;
    const runtimeSelectionChanged =
      priorRuntimeSelection.model !== nextAgent.model ||
      priorRuntimeSelection.modelAutonomous !== nextAgent.model_autonomous ||
      priorRuntimeSelection.routing !== nextAgent.routing ||
      priorRuntimeSelection.routingAutonomous !== nextAgent.routing_autonomous;
    if (runtimeSelectionChanged) {
      shutdownAllHeartbeats();
    }

    res.json({ success: true, message: 'Preferences saved. Restart server for some changes to take effect.' });
  } catch (err) {
    console.error('Failed to save preferences:', err);
    res.status(500).json({ error: 'Failed to save preferences' });
  }
});

export default router;
