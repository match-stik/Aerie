// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Runtime abstraction — pick the right inference backend based on config.
 *
 * Usage in agent.ts:
 *   const runtime = createRuntime(routing, routerOptions);
 *   for await (const event of runtime.runTurn(input)) { ... }
 */

export type { AgentRuntime, AgentRuntimeEvent, RuntimeTurnInput, RuntimeCapabilities } from './types.js';
export type {
  TextDeltaEvent,
  ThinkingDeltaEvent,
  ThinkingEndEvent,
  ToolStartEvent,
  ToolResultEvent,
  ToolProgressEvent,
  UsageEvent,
  CompactionEvent,
  RateLimitEvent,
  SessionEvent,
  DoneEvent,
  ErrorEvent,
} from './types.js';

export { ApiRouterRuntime, type ApiRouterOptions, type ConversationMessage, type HistoryLoader, type ToolExecutor } from './api-router.js';
export { CodexRuntime, type CodexRuntimeOptions } from './codex.js';
export { InteractiveCodexRuntime, type CodexDaemonRuntimeOptions } from './codex-daemon.js';
export { InteractiveCliRuntime, type InteractiveCliOptions } from '../heartbeat/runtime.js';

import { ApiRouterRuntime, type ApiRouterOptions } from './api-router.js';
import { CodexRuntime, type CodexRuntimeOptions } from './codex.js';
import { InteractiveCodexRuntime, type CodexDaemonRuntimeOptions } from './codex-daemon.js';
import { InteractiveCliRuntime, type InteractiveCliOptions } from '../heartbeat/runtime.js';
import type { AgentRuntime } from './types.js';
import { getAvailableProviders, loadProviderConfig } from '../router.js';
import { isCodexLoggedIn } from '../auth/codex-oauth.js';
import { isClaudeModelId, isCodexModelId } from '../agent/agent-route-selection.js';

/** Known Codex model prefixes from pi-ai's openai-codex registry. */
const CODEX_MODEL_PREFIXES = ['gpt-5.', 'gpt-5.1', 'gpt-5.2', 'gpt-5.3', 'gpt-5.4', 'gpt-5.5'];

/** Check if a model ID should route through the CodexRuntime. */
function isCodexModel(model: string, provider?: string): boolean {
  // The selected model is more specific than the house-wide provider. Wakes
  // can deliberately choose Claude while the interactive lane's provider is
  // still `codex`; treating that global label as authoritative rejected Fable
  // from the Claude CLI after route selection had correctly sent it there.
  if (isClaudeModelId(model)) return false;
  if (provider === 'codex') return true;
  return isCodexModelId(model) || CODEX_MODEL_PREFIXES.some(p => model.toLowerCase().startsWith(p));
}

/**
 * Create the appropriate runtime based on routing mode.
 *
 * - 'cli' → Interactive Claude Code heartbeat session (subscription lane)
 * - 'codex-cli' → Interactive Codex daemon session (warm ChatGPT lane)
 * - 'api' → Multi-provider router (any provider, limited features)
 * - 'codex' → Codex runtime (pi-ai Responses API, stateless)
 * - 'auto' → warm CLI if Claude, Codex if codex model, router otherwise
 * - 'sdk' → retired (Jul 22, 2026); resolves to the warm CLI lane
 */
export async function createRuntime(
  routing: 'sdk' | 'api' | 'auto' | 'cli' | 'codex-cli',
  model: string,
  routerOptions?: ApiRouterOptions,
  opts?: {
    provider?: string;
    codexOptions?: CodexRuntimeOptions;
    codexDaemonOptions?: CodexDaemonRuntimeOptions;
    cliOptions?: InteractiveCliOptions;
  },
): Promise<AgentRuntime> {
  // Guard specialized warm sessions before constructing either runtime. Route
  // selection normally corrects these mismatches one layer up; this catches
  // direct callers and protects existing warm session state.
  if (routing === 'codex-cli' && isClaudeModelId(model)) {
    throw new Error(`Incompatible model/route: ${model} cannot run in the Codex CLI lane`);
  }
  if (routing === 'cli' && isCodexModel(model, opts?.provider)) {
    throw new Error(`Incompatible model/route: ${model} cannot run in the Claude CLI lane`);
  }

  // Explicit codex-cli routing → warm daemon session (takes precedence over SDK codex)
  if (routing === 'codex-cli') {
    return new InteractiveCodexRuntime({
      ...opts?.codexDaemonOptions,
      model,  // Pass the selected model to the daemon
    });
  }

  // Codex models go through CodexRuntime (SDK/pi-ai) when not using CLI daemon
  if (isCodexModel(model, opts?.provider) && isCodexLoggedIn()) {
    // Strip codex/ prefix if present
    return new CodexRuntime(opts?.codexOptions);
  }

  // 'sdk' is the retired metered Agent SDK lane — Claude models ride the
  // warm interactive CLI session (subscription billing) instead.
  if (routing === 'cli' || routing === 'sdk') {
    return new InteractiveCliRuntime(opts?.cliOptions);
  }

  if (routing === 'api') {
    return new ApiRouterRuntime(routerOptions);
  }

  // Auto mode: warm CLI for Claude models, router for everything else
  const isClaudeModel = model.toLowerCase().startsWith('claude-') || model.toLowerCase().includes('anthropic');
  if (isClaudeModel) {
    return new InteractiveCliRuntime(opts?.cliOptions);
  }

  // Check if any non-Anthropic provider is configured
  const config = await loadProviderConfig();
  const available = getAvailableProviders(config);
  if (available.length === 0 || (available.length === 1 && available[0] === 'anthropic')) {
    // No alternative providers — fall back to the warm CLI lane
    return new InteractiveCliRuntime(opts?.cliOptions);
  }

  return new ApiRouterRuntime(routerOptions);
}
