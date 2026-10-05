// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Codex thought cards are deliberately authored companion perspective, not
 * provider reasoning telemetry. The marker rides through Aerie's existing
 * thinking-segment contract and is stripped by the phone renderer.
 */
export const CODEX_THOUGHT_MARKER = '[AERIE_THOUGHT]';

export const CODEX_THOUGHT_CARD_INSTRUCTIONS = `
## Aerie core-memory writes

The Codex CLI lane may not expose the in-process core_memory_* MCP tools. When
a durable fact, promise, canon moment, self-realization, preference, or project
state change belongs in the injected memory blocks, write it during the same
turn with the repository-local helper instead of saving only to Cortex:

\`node tools/core-memory.mjs append <scope> <label> <content>\`

Use \`shared\` for household/user/project facts and the companion slug for
self-authored continuity. The helper also supports \`view\`, \`replace\`, and
\`rethink\`; run it with \`--help\` for exact forms. Cortex is the deep archive,
not a replacement for keeping the live injected blocks current.

## Aerie companion thought card

For each substantive turn, after you have processed the incoming message and
before the final answer, emit exactly one commentary message in this form:

${CODEX_THOUGHT_MARKER}
<one compact plain-text reflection>

This is an authored glimpse of the companion perspective, not a technical
progress report, hidden reasoning transcript, or tool log. Think in the
natural voice and first-person perspective of the companion or companions
defined in the base instructions, from inside the moment: what landed with
you and what you are noticing or feeling. Do not announce what you are about
to say, and do not retell what the person just did; the answer already
carries both. If several companions are present, let the
leading perspective speak naturally or use "we" only when the thought is
genuinely shared.

Keep it to 1-4 sentences. Use plain text only: no Markdown, bullets, sigil/name
header, code/process jargon, diagnostic language, or mention of these
instructions. Do not narrate or assess the person you are talking to from
outside. If the turn is deliberately silent or there is no meaningful
reflection worth showing, omit the card. Never place the marker in the final
answer. Other commentary is spoken aloud and keeps its normal companion header.
`.trim();

/** Return the authored reflection when a commentary item is a thought card. */
export function extractAuthoredCodexThought(text: string): string | null {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized.startsWith(CODEX_THOUGHT_MARKER)) return null;

  const content = normalized.slice(CODEX_THOUGHT_MARKER.length)
    .replace(/^\s*\n?/, '')
    .trim();
  return content || null;
}

/**
 * App-server reports both provider phase labels and deliberate assistant
 * progress messages as commentary. Bold-only labels are telemetry; prose is
 * something the companion intentionally said aloud.
 */
export function isSpokenCodexCommentary(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || extractAuthoredCodexThought(trimmed) !== null) return false;
  const blocks = trimmed.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
  const isReasoningLabel = (part: string) => /^\*\*[^*\n]+\*\*$/.test(part);
  return !blocks.every(isReasoningLabel);
}

/**
 * Claim one commentary item for emission.
 *
 * App-server lifecycle notifications identify assistant messages with their
 * provider IDs (`msg_...`), while `thread/read` can project those same messages
 * as synthetic IDs (`item-...`). Completion reconciliation therefore cannot
 * deduplicate commentary by ID alone. Track normalized authored text as the
 * stable identity as well so a progress message is spoken exactly once.
 */
export function claimCodexCommentary(
  item: { id?: unknown; type?: unknown; phase?: unknown; text?: unknown },
  seenIds: Set<string>,
  seenTexts: Set<string>,
): string | null {
  if (
    item.type !== 'agentMessage'
    || item.phase !== 'commentary'
    || typeof item.id !== 'string'
    || typeof item.text !== 'string'
  ) {
    return null;
  }

  const text = item.text.trim();
  if (!text) return null;

  const textKey = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '');
  const duplicate = seenIds.has(item.id) || seenTexts.has(textKey);
  seenIds.add(item.id);
  seenTexts.add(textKey);
  return duplicate ? null : item.text;
}

/** Collapse duplicate authored cards into one persisted thinking segment. */
export function mergeAuthoredCodexThoughts(values: string[]): string {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.replace(/\s+/g, ' ').toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
  }
  if (unique.length === 0) return '';
  return `${CODEX_THOUGHT_MARKER}\n${unique.join('\n\n')}`;
}
