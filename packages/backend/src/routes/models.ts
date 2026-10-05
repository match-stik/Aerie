// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { Router } from 'express';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getAerieConfig } from '../config.js';
import { authMiddleware } from '../middleware/auth.js';
import { isCodexLoggedIn } from '../services/auth/codex-oauth.js';
import { discoverCodexModels } from '../services/codex-model-discovery.js';
import { heartbeatLaneModelState } from '../services/heartbeat/supervisor.js';
import {
  asModelInfo,
  CLAUDE_MODELS,
  CODEX_CLI_MODELS,
  CODEX_MODELS,
  extraModelsFor,
  type ModelInfo,
} from '../services/model-catalog.js';

const router = Router();

export type { ModelInfo };

interface CodexModelCapability {
  default_reasoning_level?: string;
  supported_reasoning_levels?: Array<{ effort: string }>;
  service_tiers?: Array<{ id: string; name?: string }>;
  additional_speed_tiers?: string[];
}

/** Codex owns this cache and refreshes it from the account. Fail quiet if absent. */
function codexCapabilities(): Map<string, CodexModelCapability> {
  try {
    const parsed = JSON.parse(readFileSync(join(homedir(), '.codex', 'models_cache.json'), 'utf8'));
    return new Map((parsed.models || []).map((m: any) => [m.slug, m]));
  } catch {
    return new Map();
  }
}

function withCodexCapabilities(model: ModelInfo, caps: Map<string, CodexModelCapability>): ModelInfo {
  const cap = caps.get(model.id);
  if (!cap) return model;
  const speedTiers = new Set<string>(cap.additional_speed_tiers || []);
  if (cap.service_tiers?.some(t => t.id === 'priority')) speedTiers.add('fast');
  return {
    ...model,
    default_reasoning_level: cap.default_reasoning_level,
    reasoning_levels: cap.supported_reasoning_levels?.map(level => level.effort),
    speed_tiers: [...speedTiers],
  };
}

/**
 * GET /api/models — discovers available models from all configured providers.
 * Queries Ollama and OpenRouter live; returns static Claude list for SDK routing.
 */
router.get('/models', authMiddleware, async (_req, res) => {
  const config = getAerieConfig();
  const providers = config.providers || {};
  const models: ModelInfo[] = [];

  // --- Claude models on the CLI lane (warm interactive Claude Code session,
  // subscription-billed via the heartbeat runtime). The retired SDK lane
  // redirects to CLI anyway, so only list these once.
  models.push(...CLAUDE_MODELS.map(m => ({ ...m, provider: 'claude-cli' })));
  models.push(...extraModelsFor('claude').map(m =>
    asModelInfo(m, { provider: 'claude-cli', tier: 'included' })));

  // --- Ollama (local inference — free!) ---
  if (providers.ollama?.base_url) {
    try {
      const baseUrl = providers.ollama.base_url.replace(/\/+$/, '');
      const headers: Record<string, string> = {};
      if (providers.ollama.api_key) headers['Authorization'] = `Bearer ${providers.ollama.api_key}`;

      let ollamaModels: string[] = [];

      // Try OpenAI-compatible endpoint first (newer Ollama versions)
      try {
        const res = await fetch(`${baseUrl}/v1/models`, { headers, signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json() as any;
          ollamaModels = (data.data || []).map((m: any) => m.id);
        }
      } catch {
        // Fallback to native Ollama API
        try {
          const res = await fetch(`${baseUrl}/api/tags`, { headers, signal: AbortSignal.timeout(5000) });
          if (res.ok) {
            const data = await res.json() as any;
            ollamaModels = (data.models || []).map((m: any) => m.name);
          }
        } catch { /* Ollama unreachable */ }
      }

      for (const id of ollamaModels) {
        models.push({
          id,
          name: id,
          provider: 'ollama',
          tier: 'local',
          supports_tools: true,
        });
      }
    } catch { /* Ollama discovery failed silently */ }
  }

  // --- OpenRouter (big model hub — free + paid tiers) ---
  if (providers.openrouter?.api_key) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json() as any;
        for (const m of (data.data || [])) {
          const isFree = m.id?.endsWith(':free') ||
            (Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0);

          const supportsTools = Array.isArray(m.supported_parameters)
            ? m.supported_parameters.includes('tools')
            : undefined;

          models.push({
            id: m.id,
            name: m.name || m.id,
            provider: 'openrouter',
            tier: isFree ? 'free' : 'paid',
            description: m.description || undefined,
            context_length: m.context_length || undefined,
            supports_tools: supportsTools,
          });
        }
      }
    } catch { /* OpenRouter unreachable */ }
  }

  // --- Groq key is for Voice Mode STT only, not model routing ---

  // --- xAI (Grok) ---
  if (providers.xai?.api_key) {
    try {
      const baseUrl = (providers.xai.base_url || 'https://api.x.ai').replace(/\/+$/, '');
      const res = await fetch(`${baseUrl}/v1/models`, {
        headers: { 'Authorization': `Bearer ${providers.xai.api_key}` },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json() as any;
        for (const m of (data.data || [])) {
          models.push({
            id: m.id,
            name: m.id,
            provider: 'xai',
            tier: 'included',
          });
        }
      }
    } catch { /* xAI unreachable */ }
  }

  // --- OpenAI direct ---
  if (providers.openai?.api_key) {
    try {
      const baseUrl = (providers.openai.base_url || 'https://api.openai.com').replace(/\/+$/, '');
      const res = await fetch(`${baseUrl}/v1/models`, {
        headers: { 'Authorization': `Bearer ${providers.openai.api_key}` },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json() as any;
        // Only include chat models (skip embeddings, tts, etc)
        const chatModels = (data.data || []).filter((m: any) =>
          m.id.startsWith('gpt-') || m.id.startsWith('o1') || m.id.startsWith('o3') || m.id.startsWith('chatgpt')
        );
        for (const m of chatModels) {
          models.push({
            id: m.id,
            name: m.id,
            provider: 'openai',
            tier: 'included',
            supports_tools: true,
          });
        }
      }
    } catch { /* OpenAI unreachable */ }
  }

  // --- Codex (ChatGPT OAuth via pi-ai Responses API) ---
  // The lists themselves live in services/model-catalog.ts, alongside the two
  // config keys that extend them.
  const codexExtras = extraModelsFor('codex');
  if (isCodexLoggedIn()) {
    const caps = codexCapabilities();
    // Ask what the account has before falling back to what we wrote down. The
    // hand-typed list drifted far enough to offer the owner three models they could
    // not run; the Codex CLI keeps the real one on disk.
    const codexDiscovered = discoverCodexModels('codex');
    const codexList = codexDiscovered.length > 0 ? codexDiscovered : CODEX_MODELS;
    models.push(...codexList.map(model => withCodexCapabilities(model, caps)));
    models.push(...codexExtras.map(m =>
      withCodexCapabilities(asModelInfo(m, { provider: 'codex', tier: 'paid' }), caps)));
  }

  // --- Codex CLI (warm Codex daemon session — ChatGPT subscription lane) ---
  // Same models as the SDK Codex lane, but routed through the warm daemon.
  const codexCliCaps = codexCapabilities();
  const cliDiscovered = discoverCodexModels('codex-cli');
  const cliList = cliDiscovered.length > 0 ? cliDiscovered : CODEX_CLI_MODELS;
  models.push(...cliList.map(model => withCodexCapabilities(model, codexCliCaps)));
  models.push(...codexExtras.map(m =>
    withCodexCapabilities(
      asModelInfo(m, { provider: 'codex-cli', tier: 'included', nameSuffix: ' (Warm)' }),
      codexCliCaps,
    )));

  // --- HuggingFace Inference Router ---
  if (providers.huggingface?.api_key) {
    try {
      const baseUrl = (providers.huggingface.base_url || 'https://router.huggingface.co').replace(/\/+$/, '');
      const res = await fetch(`${baseUrl}/v1/models`, {
        headers: { 'Authorization': `Bearer ${providers.huggingface.api_key}` },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json() as any;
        for (const m of (data.data || [])) {
          models.push({
            id: m.id,
            name: m.id,
            provider: 'huggingface',
            tier: 'free',
            supports_tools: true,
          });
        }
      }
    } catch { /* HuggingFace unreachable */ }
  }

  res.json(models);
});

/**
 * GET /api/models/status — quick check of which providers are connected
 */
router.get('/models/status', authMiddleware, (_req, res) => {
  const config = getAerieConfig();
  const providers = config.providers || {};

  const status: Record<string, { configured: boolean; url?: string }> = {
    ollama: { configured: !!providers.ollama?.base_url, url: providers.ollama?.base_url },
    openrouter: { configured: !!providers.openrouter?.api_key },
    xai: { configured: !!providers.xai?.api_key },
    openai: { configured: !!providers.openai?.api_key },
    codex: { configured: isCodexLoggedIn() },
    huggingface: { configured: !!providers.huggingface?.api_key },
  };

  res.json(status);
});

export default router;
