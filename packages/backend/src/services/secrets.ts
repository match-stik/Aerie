// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// BYOK secrets — single read path with DB-first, env-var fallback.
// The SQLite `config` table is the canonical store; each secret lives
// under a "secret:<name>" key so it doesn't collide with the existing
// agent/discord/etc. config entries. Env vars stay supported so users
// upgrading from a .env-based deployment keep working until they edit
// a value in the UI.

import { getConfig, setConfig, deleteConfig, getAllConfig } from './db.js';

const PREFIX = 'secret:';

export type SecretCategory = 'voice' | 'platform' | 'integration' | 'provider';

export interface SecretDef {
  name: string;
  label: string;
  category: SecretCategory;
  envVar?: string;
  placeholder?: string;
  hint?: string;
  /** True for secrets that hold long opaque strings (JSON, multi-line). */
  multiline?: boolean;
  /** Don't surface in the BYOK editor — env-var fallback still applies. */
  hideInUi?: boolean;
}

// Built-in secret definitions. Per-companion voice IDs are dynamic and
// not enumerated here — they're handled by getSecret's pattern fallback.
// `hideInUi` keeps an entry readable by getSecret (env-var fallback still
// works) but excludes it from listSecrets so the BYOK editor doesn't
// surface duplicate inputs that already appear elsewhere.
export const SECRETS: SecretDef[] = [
  // Cortex — both values stay in the shared secret store, and both are edited
  // on Memory → Cortex, where the connection they configure is visible. A
  // worker address without its token is half a setting, so they sit together.
  {
    name: 'cortex_mcp_url',
    label: 'Cortex worker URL',
    category: 'integration',
    envVar: 'CORTEX_WORKER_URL',
    placeholder: 'https://….workers.dev',
    hint: 'Optional. Deploy workers/cortex, then paste its address here',
    hideInUi: true,
  },
  {
    name: 'cortex_auth_token',
    label: 'Cortex worker token',
    category: 'integration',
    envVar: 'CORTEX_AUTH_TOKEN',
    hint: 'The CORTEX_AUTH_TOKEN you set on the worker — it will not serve without it',
    hideInUi: true,
  },

  // Voice
  {
    name: 'elevenlabs_api_key',
    label: 'ElevenLabs API key',
    category: 'voice',
    envVar: 'ELEVENLABS_API_KEY',
    placeholder: 'sk_…',
    hint: 'elevenlabs.io/app/settings/api-keys',
  },
  {
    name: 'elevenlabs_voice_id',
    label: 'Default ElevenLabs voice ID',
    category: 'voice',
    envVar: 'ELEVENLABS_VOICE_ID',
    hint: 'Used when no per-companion voice is set',
    hideInUi: true,
  },
  {
    name: 'groq_api_key',
    label: 'Groq API key (voice transcription)',
    category: 'voice',
    envVar: 'GROQ_API_KEY',
    placeholder: 'gsk_…',
    hint: 'console.groq.com — used by the mic button to transcribe voice notes via Whisper',
  },
  {
    name: 'hume_api_key',
    label: 'Hume API key (voice prosody)',
    category: 'voice',
    envVar: 'HUME_API_KEY',
    hint: 'hume.ai — optional, adds a tone reading the companion can see alongside the transcript',
  },

  // Platforms
  {
    name: 'discord_bot_token',
    label: 'Discord bot token',
    category: 'platform',
    envVar: 'DISCORD_BOT_TOKEN',
    hint: 'discord.com/developers/applications',
    // Edited on Integrations → Discord, beside the gateway it switches on.
    hideInUi: true,
  },
  {
    name: 'fcm_service_account',
    label: 'Firebase service account',
    category: 'platform',
    envVar: 'FCM_SERVICE_ACCOUNT',
    placeholder: '{ "type": "service_account", … }',
    hint: 'Firebase → Project settings → Service accounts → Generate new private key. Paste the whole JSON. Only needed for push to the Android app.',
  },
  {
    name: 'telegram_bot_token',
    label: 'Telegram bot token',
    category: 'platform',
    envVar: 'TELEGRAM_BOT_TOKEN',
    hint: 'Talk to @BotFather',
  },

  // Integrations
  {
    name: 'giphy_api_key',
    label: 'Giphy API key',
    category: 'integration',
    envVar: 'GIPHY_API_KEY',
    hint: 'developers.giphy.com',
  },
  // The Screening Room fetches the subtitle file so nobody has to go hunting
  // for one. A streaming service holds the very text being read
  // and will not hand it over, so the cues come from here instead; the free
  // tier is plenty for an episode at a time. Without this the room still works
  // — the SRT just has to be found by hand.
  {
    name: 'opensubtitles_api_key',
    label: 'OpenSubtitles API key',
    category: 'integration',
    envVar: 'OPENSUBTITLES_API_KEY',
    hint: 'opensubtitles.com → account → API consumers. Free tier is enough',
  },
  // This box reaches GitHub over SSH, which can clone and push but cannot ask
  // a question — Dependabot alerts, and everything else about a repository's
  // state, live behind the REST API and need a token. Read-only is the whole
  // point: nothing here should ever be able to write to a repository.
  {
    name: 'github_token',
    label: 'GitHub token',
    category: 'integration',
    envVar: 'GITHUB_TOKEN',
    placeholder: 'github_pat_…',
    hint: 'Fine-grained, read-only. Contents + Metadata + Dependabot alerts',
  },

  // Model router providers — managed in the Providers tab, hidden from Secrets
  {
    name: 'ollama_api_key',
    label: 'Ollama Cloud API key',
    category: 'provider',
    envVar: 'OLLAMA_API_KEY',
    placeholder: '…',
    hint: 'ollama.com/settings/keys — used for direct Ollama Cloud inference',
    hideInUi: true,
  },
  {
    name: 'huggingface_api_key',
    label: 'HuggingFace API key',
    category: 'provider',
    envVar: 'HUGGINGFACE_API_KEY',
    placeholder: 'hf_…',
    hint: 'huggingface.co/settings/tokens — for model router',
    hideInUi: true,
  },
  {
    name: 'openrouter_api_key',
    label: 'OpenRouter API key',
    category: 'provider',
    envVar: 'OPENROUTER_API_KEY',
    placeholder: 'sk-or-…',
    hint: 'openrouter.ai — for model router',
    hideInUi: true,
  },
  {
    name: 'xai_api_key',
    label: 'xAI API key',
    category: 'provider',
    envVar: 'XAI_API_KEY',
    hint: 'x.ai — for Grok models via router',
    hideInUi: true,
  },
  {
    name: 'openai_api_key',
    label: 'OpenAI API key',
    category: 'provider',
    envVar: 'OPENAI_API_KEY',
    placeholder: 'sk-…',
    hint: 'platform.openai.com — for GPT models via router',
    hideInUi: true,
  },

];

// Per-companion voice patterns. Stored as `elevenlabs_voice_id:<slug>` and
// `elevenlabs_voice_settings:<slug>`. Env fallback uses the original
// uppercase pattern so existing deployments keep working.
function envFallbackForDynamic(name: string): string | undefined {
  const voiceMatch = name.match(/^elevenlabs_voice_id:(.+)$/);
  if (voiceMatch) return process.env[`ELEVENLABS_VOICE_ID_${voiceMatch[1].toUpperCase()}`];
  const settingsMatch = name.match(/^elevenlabs_voice_settings:(.+)$/);
  if (settingsMatch) return process.env[`ELEVENLABS_VOICE_SETTINGS_${settingsMatch[1].toUpperCase()}`];
  return undefined;
}

// The config table holds the secrets store too, under PREFIX. Anything that
// hands the table to a client goes through this first: a signed-in page should
// never be one request away from every key the house holds.
export function withoutSecrets(config: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(config).filter(([key]) => !key.startsWith(PREFIX)));
}

export function getSecret(name: string): string | undefined {
  const stored = getConfig(PREFIX + name);
  if (stored) return stored;
  const def = SECRETS.find((s) => s.name === name);
  if (def?.envVar) {
    const fromEnv = process.env[def.envVar];
    if (fromEnv) return fromEnv;
  }
  return envFallbackForDynamic(name);
}

export function setSecret(name: string, value: string): void {
  setConfig(PREFIX + name, value);
}

export function deleteSecret(name: string): void {
  deleteConfig(PREFIX + name);
}

// Return every secret whose name starts with the given prefix. Lets
// VoiceService discover per-companion voice IDs that were set without a
// matching companions-table row.
export function listSecretsByPrefix(prefix: string): Record<string, string> {
  const all = getAllConfig();
  const out: Record<string, string> = {};
  const full = PREFIX + prefix;
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(full) && value) {
      out[key.slice(PREFIX.length)] = value;
    }
  }
  return out;
}

export interface SecretStatus {
  name: string;
  label: string;
  category: SecretCategory;
  hasValue: boolean;
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
}

export function listSecrets(_companionSlugs: string[] = []): SecretStatus[] {
  // Per-companion voice IDs are managed exclusively from the Companions
  // tab — listing them here as well duplicates the UI and labels them
  // with raw slugs the user can't read. `hideInUi` entries (e.g. the
  // default voice ID) are skipped because they're already represented
  // elsewhere or set via env var.
  return SECRETS.filter((def) => !def.hideInUi).map((def) => ({
    name: def.name,
    label: def.label,
    category: def.category,
    hasValue: !!getSecret(def.name),
    placeholder: def.placeholder,
    hint: def.hint,
    multiline: def.multiline,
  }));
}
