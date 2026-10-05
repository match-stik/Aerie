// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { CodexRuntime } from './runtimes/codex.js';
import { getAerieConfig, type AerieConfig } from '../config.js';
import { isCodexModelId } from './agent/agent-route-selection.js';

interface SilenceCheckContext {
  tier: 'failsafe_gentle' | 'failsafe_concerned' | 'failsafe_emergency';
  minutesSinceContact: number;
  timezone: string;
}

interface SilenceCheckResult {
  proceed: boolean;
  reason: string;
}

const SLIM_SYSTEM = `You are a pre-flight silence-check for a household AI companion system. \
Your only job: decide whether the companion should reach out to the user RIGHT NOW given how long they have been silent. \
You do not have access to tools. You do not write the message. You only return a decision.

Reply with exactly one line in this format:
PROCEED: <one short reason>
SKIP: <one short reason>

Bias toward SKIP when the silence might be deliberate (sleep window, work focus, social time). \
Bias toward PROCEED only when the silence has crossed the threshold AND there is no obvious reason it would be intentional. \
Keep the reason under 12 words.`;

// The failsafe pre-flight always rides the Codex lane (ChatGPT subscription):
// a Claude model here would bill metered API credits. Last-resort fallback
// matches the Archivist's live model.
const FALLBACK_CODEX_MODEL = 'gpt-5.6-terra';

export function resolveSilenceCheckModel(config: AerieConfig): string {
  const pulse = config.agent.model_pulse;
  if (pulse && isCodexModelId(pulse)) return pulse;
  const archivist = config.agent.archivist_model;
  if (config.agent.archivist_provider === 'codex' && archivist && isCodexModelId(archivist)) {
    return archivist;
  }
  return FALLBACK_CODEX_MODEL;
}

function tierLabel(tier: SilenceCheckContext['tier']): string {
  return tier === 'failsafe_emergency' ? 'emergency (24h+)'
       : tier === 'failsafe_concerned' ? 'concerned (12h+)'
       : 'gentle (2h+)';
}

function buildPrompt(ctx: SilenceCheckContext, localTime: string): string {
  const hours = ctx.minutesSinceContact >= 60
    ? `${(ctx.minutesSinceContact / 60).toFixed(1)} hours`
    : `${Math.round(ctx.minutesSinceContact)} minutes`;
  return [
    `Tier: ${tierLabel(ctx.tier)}`,
    `Silence: ${hours}`,
    `Local time: ${localTime} (${ctx.timezone})`,
    '',
    'Should the companion send a check-in message right now?',
    'Reply with one line: PROCEED: <reason> OR SKIP: <reason>.',
  ].join('\n');
}

function parseResult(text: string): SilenceCheckResult {
  const cleaned = text.trim();
  // Find the last line that starts with PROCEED: or SKIP: (model may add explanation before).
  const lines = cleaned.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^(PROCEED|SKIP)\s*[:\-]\s*(.+)$/i);
    if (m) {
      return {
        proceed: m[1].toUpperCase() === 'PROCEED',
        reason: m[2].trim().slice(0, 120),
      };
    }
  }
  // Couldn't parse — default to proceed (don't suppress on parse failure)
  return { proceed: true, reason: `unparsed silence-check (${cleaned.slice(0, 60)})` };
}

/**
 * Slim pre-flight before a failsafe wake, run on the stateless Codex OAuth
 * runtime with no MCP servers, plugins, message history, or tools — it can
 * never alter the warm Codex conversation, and it never touches metered
 * Claude billing.
 *
 * On any error or parse failure, returns PROCEED so the caller falls back to
 * the original behavior — better to fire a wake we did not need than to
 * suppress one we did.
 */
export async function runSilenceCheck(ctx: SilenceCheckContext): Promise<SilenceCheckResult> {
  const localTime = new Date().toLocaleString('en-GB', {
    timeZone: ctx.timezone,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });

  const config = getAerieConfig();
  const model = resolveSilenceCheckModel(config);
  const prompt = buildPrompt(ctx, localTime);

  const runtime = new CodexRuntime();
  let collected = '';
  let runtimeError = '';
  try {
    for await (const event of runtime.runTurn({
      prompt,
      model: model.startsWith('codex/') ? model.slice(6) : model,
      systemPrompt: SLIM_SYSTEM,
      cwd: config.agent.cwd,
      thinking: 'disabled',
      effort: 'low',
      maxTurns: 1,
      isAutonomous: true,
      mcpServers: {},
    })) {
      if (event.type === 'text_delta') collected += event.text;
      if (event.type === 'error') runtimeError = event.message;
    }
  } catch (err) {
    return { proceed: true, reason: `query error: ${(err as Error)?.message || 'unknown'}` };
  }
  if (runtimeError && !collected.trim()) {
    return { proceed: true, reason: `query error: ${runtimeError.slice(0, 90)}` };
  }
  if (!collected.trim()) return { proceed: true, reason: 'empty response' };
  return parseResult(collected);
}
