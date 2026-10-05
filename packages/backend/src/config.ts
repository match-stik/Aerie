// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { readFileSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'js-yaml';

// Derive project root from this module's location (packages/backend/src/config.ts → ../../..)
// This is stable regardless of process.cwd(), which npm workspaces can change.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');

export interface AerieConfig {
  identity: {
    companion_name: string;
    user_name: string;
    timezone: string;
    // What this house calls its own groupings in the gallery. Left empty, the
    // UI describes them plainly ("Everyone"); a house that has its own words
    // for who lives in it puts them here.
    cast_labels: {
      everyone: string;
      companions: string;
    };
  };
  server: {
    port: number;
    host: string;
    /** Loopback-only port carrying /api/internal. Never front this. */
    internal_port: number;
    db_path: string;
  };
  auth: {
    password: string;
  };
  agent: {
    cwd: string;
    claude_md_path: string;
    mcp_json_path: string;
    /**
     * Keep every companion's own CLI lane warm alongside the shared thread
     * lanes, so an owned bell always finds someone behind their own door.
     * The keeper only ever warms — flipping this off lets lanes cool on the
     * normal quiet ceiling instead of killing anything, which is what kept
     * July's respawn storm from having a sequel.
     */
    multi_lane: boolean;
    model: string;
    model_autonomous: string;
    model_pulse: string;
    archivist_provider: string;
    archivist_model: string;
    /**
     * How hard the Archivist thinks. This is the lever that decides both
     * whether extracted memory sounds like the companion and how much of the
     * owner's subscription a sweep spends, so it belongs in the UI rather than
     * hardcoded at the call site.
     */
    archivist_effort: 'adaptive' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
    archivist_thinking: 'adaptive' | 'enabled' | 'disabled';
    thinking: 'adaptive' | 'enabled' | 'disabled';
    effort: 'adaptive' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
    /** Lane-specific thinking controls. Legacy thinking/effort remain fallbacks. */
    claude_thinking: 'adaptive' | 'enabled' | 'disabled';
    claude_effort: 'adaptive' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    codex_effort: 'adaptive' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
    codex_speed: 'standard' | 'fast';
    routing: 'sdk' | 'api' | 'auto' | 'cli' | 'codex-cli';
    /** Dedicated lane for scheduled and spontaneous autonomous wakes. */
    routing_autonomous?: 'sdk' | 'api' | 'auto' | 'cli' | 'codex-cli';
    provider?: string;
    ambient_recall?: boolean;
  };
  providers: {
    ollama?: { base_url: string; api_key?: string };
    openrouter?: { api_key: string };
    anthropic?: { api_key: string; base_url?: string };
    groq?: { api_key: string; base_url?: string };
    xai?: { api_key: string; base_url?: string };
    openai?: { api_key: string; base_url?: string };
    huggingface?: { api_key: string; base_url?: string };
  };
  orchestrator: {
    enabled: boolean;
    wake_prompts_path: string;
    schedules: Record<string, string>;
    failsafe: {
      enabled: boolean;
      gentle_minutes: number;
      concerned_minutes: number;
      emergency_minutes: number;
    };
  };
  hooks: {
    context_injection: boolean;
    safe_write_prefixes: string[];
  };
  voice: {
    enabled: boolean;
    elevenlabs_voice_id: string;
    // Extra proper nouns fed to the transcriber as a spelling hint (friends,
    // pets, places). The owner and the companions are added automatically.
    transcription_vocabulary: string[];
  };
  discord: {
    enabled: boolean;
    owner_user_id: string;
    history_limit: number;
  };
  telegram: {
    enabled: boolean;
    owner_chat_id: string;
  };
  integrations: {
    life_api_url: string;
    mind_cloud: {
      enabled: boolean;
      mcp_url: string;
    };
    /** Cortex memory worker (Cloudflare) — BYOK, read by services/cortex.ts */
    cortex?: {
      mcp_url?: string;
    };
    /**
     * Local background-removal runtime for GIF Lab's Cutout tab. Both paths are
     * machine-specific, so they live in config rather than in the code: an
     * interpreter with onnxruntime/numpy/pillow, and a u2net- or isnet-style
     * .onnx model. Empty means the tab reports itself unavailable with setup
     * instructions instead of failing mid-request.
     */
    cutout?: {
      python?: string;
      model?: string;
      /** Extra models unioned with the first to cover its blind spots. */
      also_models?: string[];
    };
  };
  command_center: {
    enabled: boolean;
    default_person: string;
    currency_symbol: string;
    care_categories: {
      toggles: string[];
      ratings: string[];
      counters: { name: string; max: number }[];
    };
  };
  aerie: {
    enabled: boolean;
    companions_dir: string;
    default_companion: string;
  };
  cors: {
    origins: string[];
  };
}

const DEFAULTS: AerieConfig = {
  identity: {
    companion_name: 'Echo',
    user_name: 'User',
    timezone: 'UTC',
    cast_labels: { everyone: '', companions: '' },
  },
  server: {
    port: 3002,
    host: '127.0.0.1',
    internal_port: 3012,
    db_path: './data/aerie.db',
  },
  auth: {
    password: '',
  },
  agent: {
    cwd: '.',
    claude_md_path: './CLAUDE.md',
    mcp_json_path: './.mcp.json',
    multi_lane: false,
    model: 'claude-sonnet-4-6',
    model_autonomous: 'claude-sonnet-4-6',
    model_pulse: 'claude-haiku-4-5-20251001',
    archivist_provider: 'ollama',
    archivist_model: 'deepseek-v4-pro',
    archivist_effort: 'adaptive',
    archivist_thinking: 'disabled',
    thinking: 'adaptive',
    effort: 'adaptive',
    claude_thinking: 'adaptive',
    claude_effort: 'adaptive',
    codex_effort: 'adaptive',
    codex_speed: 'standard',
    routing: 'cli',
  },
  providers: {},
  orchestrator: {
    enabled: true,
    wake_prompts_path: './prompts/wake.md',
    schedules: {},
    failsafe: {
      enabled: false,
      gentle_minutes: 120,
      concerned_minutes: 720,
      emergency_minutes: 1440,
    },
  },
  hooks: {
    context_injection: true,
    safe_write_prefixes: [],
  },
  voice: {
    enabled: false,
    elevenlabs_voice_id: '',
    transcription_vocabulary: [],
  },
  discord: {
    enabled: false,
    owner_user_id: '',
    history_limit: 10,
  },
  telegram: {
    enabled: false,
    owner_chat_id: '',
  },
  integrations: {
    life_api_url: '',
    mind_cloud: {
      enabled: false,
      mcp_url: '',
    },
  },
  command_center: {
    enabled: true,
    default_person: 'user',
    currency_symbol: '$',
    care_categories: {
      toggles: ['breakfast', 'lunch', 'dinner', 'snacks', 'medication', 'movement', 'shower'],
      ratings: ['sleep', 'energy', 'wellbeing', 'mood'],
      counters: [{ name: 'water', max: 10 }],
    },
  },
  aerie: {
    enabled: false,
    companions_dir: './companions',
    default_companion: '',
  },
  cors: {
    origins: [],
  },
};

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
        target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      result[key] = deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

let _config: AerieConfig | null = null;

export function loadConfig(configPath?: string): AerieConfig {
  if (_config) return _config;

  const searchPaths = configPath
    ? [configPath]
    : [
        join(PROJECT_ROOT, 'aerie.yaml'),
        join(PROJECT_ROOT, 'aerie.yml'),
        join(PROJECT_ROOT, 'config', 'aerie.yaml'),
      ];

  let fileConfig: Record<string, unknown> = {};

  for (const p of searchPaths) {
    if (existsSync(p)) {
      const raw = readFileSync(p, 'utf-8');
      fileConfig = yaml.load(raw) as Record<string, unknown> || {};
      console.log(`Loaded config from: ${p}`);
      break;
    }
  }

  // Merge: defaults <- yaml <- env overrides
  const merged = deepMerge(DEFAULTS as unknown as Record<string, unknown>, fileConfig) as unknown as AerieConfig;
  // One-time compatibility bridge: houses that only have the original global
  // controls keep their chosen values until each lane is explicitly changed.
  const fileAgent = (fileConfig.agent || {}) as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(fileAgent, 'claude_thinking')) {
    merged.agent.claude_thinking = merged.agent.thinking;
  }
  if (!Object.prototype.hasOwnProperty.call(fileAgent, 'claude_effort')) {
    merged.agent.claude_effort = merged.agent.effort === 'ultra' ? 'max' : merged.agent.effort;
  }
  if (!Object.prototype.hasOwnProperty.call(fileAgent, 'codex_effort')) {
    merged.agent.codex_effort = merged.agent.effort;
  }

  // Environment variable overrides
  if (process.env.PORT) merged.server.port = parseInt(process.env.PORT, 10);
  if (process.env.INTERNAL_PORT) merged.server.internal_port = parseInt(process.env.INTERNAL_PORT, 10);
  if (process.env.HOST) merged.server.host = process.env.HOST;
  if (process.env.DB_PATH) merged.server.db_path = process.env.DB_PATH;
  if (process.env.APP_PASSWORD) merged.auth.password = process.env.APP_PASSWORD;
  if (process.env.AGENT_CWD) merged.agent.cwd = process.env.AGENT_CWD;
  if (process.env.AGENT_MODEL) merged.agent.model = process.env.AGENT_MODEL;
  if (process.env.COMPANION_NAME) merged.identity.companion_name = process.env.COMPANION_NAME;
  if (process.env.USER_NAME) merged.identity.user_name = process.env.USER_NAME;
  if (process.env.TZ) merged.identity.timezone = process.env.TZ;
  if (process.env.DISCORD_ENABLED === 'true') merged.discord.enabled = true;
  if (process.env.TELEGRAM_ENABLED === 'true') merged.telegram.enabled = true;

  // Provider env var overrides — set these to connect providers without editing aerie.yaml
  if (process.env.OLLAMA_URL || process.env.OLLAMA_BASE_URL) {
    if (!merged.providers) merged.providers = {};
    merged.providers.ollama = {
      base_url: process.env.OLLAMA_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      api_key: process.env.OLLAMA_API_KEY,
    };
  }
  if (process.env.OPENROUTER_API_KEY) {
    if (!merged.providers) merged.providers = {};
    merged.providers.openrouter = { api_key: process.env.OPENROUTER_API_KEY };
  }
  if (process.env.OPENAI_API_KEY) {
    if (!merged.providers) merged.providers = {};
    merged.providers.openai = { api_key: process.env.OPENAI_API_KEY, base_url: process.env.OPENAI_BASE_URL };
  }
  if (process.env.GROQ_API_KEY) {
    if (!merged.providers) merged.providers = {};
    merged.providers.groq = { api_key: process.env.GROQ_API_KEY };
  }
  if (process.env.XAI_API_KEY) {
    if (!merged.providers) merged.providers = {};
    merged.providers.xai = { api_key: process.env.XAI_API_KEY };
  }

  // Resolve relative paths against the project root (not cwd)
  const resolveFromRoot = (p: string) => resolve(PROJECT_ROOT, p);
  merged.server.db_path = resolveFromRoot(merged.server.db_path);
  merged.agent.cwd = resolveFromRoot(merged.agent.cwd);
  merged.agent.claude_md_path = resolveFromRoot(merged.agent.claude_md_path);
  merged.agent.mcp_json_path = resolveFromRoot(merged.agent.mcp_json_path);
  merged.orchestrator.wake_prompts_path = resolveFromRoot(merged.orchestrator.wake_prompts_path);

  _config = merged;
  return merged;
}

export function getAerieConfig(): AerieConfig {
  if (!_config) throw new Error('Config not loaded. Call loadConfig() first.');
  return _config;
}

/**
 * The stable slug for the person this install belongs to — the counterpart to a
 * companion slug wherever a record needs to say "the human did this": letter
 * recipients, pet actions, memory receipts. Derived from `identity.user_name`
 * so nobody's name is baked into the code, and falls back to a neutral slug
 * when config has not loaded or the name slugifies to nothing.
 */
export function getOwnerSlug(): string {
  const name = _config?.identity.user_name ?? '';
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'owner';
}

/** Update a config value in memory without full reload */
export function updateConfigValue(key: string, value: string): void {
  if (!_config) return;
  if (key === 'agent.multi_lane') _config.agent.multi_lane = value === 'true';
  if (key === 'agent.model') _config.agent.model = value;
  if (key === 'agent.model_autonomous') _config.agent.model_autonomous = value;
  if (key === 'agent.model_pulse') _config.agent.model_pulse = value;
  if (key === 'agent.archivist_provider') _config.agent.archivist_provider = value;
  if (key === 'agent.archivist_model') _config.agent.archivist_model = value;
  if (key === 'agent.archivist_effort') _config.agent.archivist_effort = value as AerieConfig['agent']['archivist_effort'];
  if (key === 'agent.archivist_thinking') _config.agent.archivist_thinking = value as AerieConfig['agent']['archivist_thinking'];
  if (key === 'agent.thinking') _config.agent.thinking = value as 'adaptive' | 'enabled' | 'disabled';
  if (key === 'agent.effort') _config.agent.effort = value as AerieConfig['agent']['effort'];
  if (key === 'agent.claude_thinking') _config.agent.claude_thinking = value as AerieConfig['agent']['claude_thinking'];
  if (key === 'agent.claude_effort') _config.agent.claude_effort = value as AerieConfig['agent']['claude_effort'];
  if (key === 'agent.codex_effort') _config.agent.codex_effort = value as AerieConfig['agent']['codex_effort'];
  if (key === 'agent.codex_speed') _config.agent.codex_speed = value as AerieConfig['agent']['codex_speed'];
  if (key === 'agent.routing') _config.agent.routing = value as 'sdk' | 'api' | 'auto' | 'cli' | 'codex-cli';
  if (key === 'agent.routing_autonomous') _config.agent.routing_autonomous = value as 'sdk' | 'api' | 'auto' | 'cli' | 'codex-cli';
  if (key === 'agent.provider') _config.agent.provider = value;
  if (key === 'agent.ambient_recall') _config.agent.ambient_recall = value !== 'false';
}
