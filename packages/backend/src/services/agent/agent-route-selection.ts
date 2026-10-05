// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
export type AgentRouting = 'sdk' | 'api' | 'auto' | 'cli' | 'codex-cli';

/** Claude Code model ids accepted by the Anthropic SDK/CLI lanes. */
export function isClaudeModelId(model: string): boolean {
  const lower = model.trim().toLowerCase();
  return lower.startsWith('claude-') || lower.startsWith('anthropic/');
}

/** Codex model ids exposed by Aerie's ChatGPT/Codex lanes. */
export function isCodexModelId(model: string): boolean {
  const lower = model.trim().toLowerCase();
  return lower.startsWith('codex/') || lower === 'gpt-5' || lower.startsWith('gpt-5.');
}

export interface ResolvedAgentRoute {
  routing: AgentRouting;
  corrected: boolean;
  reason?: string;
}

/**
 * Provider label for one turn after its route has been resolved.
 *
 * `agent.provider` is a house-wide API-router preference, not a reliable label
 * for either warm lane: the interactive model can be Codex while autonomous
 * wakes remain Claude (or the reverse). Warm routes name their own provider;
 * explicit API routing keeps the configured provider because the same model id
 * may deliberately be served by OpenRouter, Anthropic, or another backend.
 */
export function effectiveAgentProvider(
  model: string,
  routing: AgentRouting,
  configuredProvider?: string,
): string | undefined {
  if (routing === 'codex-cli') return 'codex';
  if (routing === 'cli' || routing === 'sdk') return 'anthropic';
  if (routing === 'auto') {
    if (isClaudeModelId(model)) return 'anthropic';
    if (isCodexModelId(model)) return 'codex';
  }
  return configuredProvider;
}

/**
 * Keep a model away from an incompatible warm lane before either session is
 * opened. The selected model is authoritative: Claude models belong to the
 * Claude CLI/SDK family and Codex models belong to the Codex family.
 *
 * Explicit `api` remains untouched because it intentionally supports a wider
 * provider set. A known Codex model on `auto`, however, belongs on Aerie's
 * warm Codex CLI lane: the stateless provider runtime does not carry the
 * companion-session contracts used by interactive turns.
 */
export function resolveCompatibleAgentRoute(
  model: string,
  requested: AgentRouting,
): ResolvedAgentRoute {
  if (isClaudeModelId(model)) {
    if (requested === 'codex-cli') {
      return {
        routing: 'cli',
        corrected: true,
        reason: `Claude model ${model} cannot run in the Codex CLI lane`,
      };
    }
    return { routing: requested, corrected: false };
  }

  if (isCodexModelId(model)) {
    if (requested === 'cli' || requested === 'sdk' || requested === 'auto') {
      return {
        routing: 'codex-cli',
        corrected: true,
        reason: requested === 'auto'
          ? `Codex model ${model} uses the warm Codex CLI lane for companion turns`
          : `Codex model ${model} cannot run in the Claude ${requested === 'cli' ? 'CLI' : 'SDK'} lane`,
      };
    }
    return { routing: requested, corrected: false };
  }

  // Leave provider models and future aliases alone. We only correct model
  // families whose incompatibility is certain.
  return { routing: requested, corrected: false };
}
