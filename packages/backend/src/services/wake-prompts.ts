// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Wake prompt file helpers — parsing, section editing, and outcome-log
// reading for the orchestrator's prompts/wake.md overrides.
//
// The effective prompt for a wake is: defaults from getDefaultWakePrompts()
// overridden key-by-key by `## <section>` blocks in the wake prompts file.
// These helpers keep that file editable per-section (so the phone's Wakes
// tab can edit or reset one wake without touching the rest) and report the
// last real outcome of each wake type from the orchestrator log.

export interface WakeFileSection {
  key: string;
  body: string;
}

export interface ParsedWakeFile {
  preamble: string;
  sections: WakeFileSection[];
}

const SECTION_RE = /^##\s+(\w+)/;

/** Parse a wake prompts file into its preamble and ordered `## key` sections. */
export function parseWakeSections(raw: string): ParsedWakeFile {
  const preambleLines: string[] = [];
  const sections: WakeFileSection[] = [];
  let current: { key: string; lines: string[] } | null = null;

  for (const line of raw.split('\n')) {
    const match = line.match(SECTION_RE);
    if (match) {
      if (current) sections.push({ key: current.key, body: current.lines.join('\n').trim() });
      current = { key: match[1].toLowerCase(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      preambleLines.push(line);
    }
  }
  if (current) sections.push({ key: current.key, body: current.lines.join('\n').trim() });

  return { preamble: preambleLines.join('\n').trimEnd(), sections };
}

/** Serialize a parsed wake file back to markdown. */
export function serializeWakeSections(parsed: ParsedWakeFile): string {
  const parts: string[] = [];
  if (parsed.preamble.trim()) parts.push(parsed.preamble.trimEnd());
  for (const section of parsed.sections) {
    parts.push(`## ${section.key}\n\n${section.body.trim()}`);
  }
  return parts.join('\n\n') + '\n';
}

/** Replace or append one section's body, preserving everything else. */
export function upsertWakeSection(raw: string, key: string, body: string): string {
  const parsed = parseWakeSections(raw);
  const normalized = key.toLowerCase();
  const existing = parsed.sections.find((s) => s.key === normalized);
  if (existing) {
    existing.body = body.trim();
  } else {
    parsed.sections.push({ key: normalized, body: body.trim() });
  }
  return serializeWakeSections(parsed);
}

/** Remove one section entirely — the orchestrator default applies again. */
export function removeWakeSection(raw: string, key: string): string {
  const parsed = parseWakeSections(raw);
  const normalized = key.toLowerCase();
  parsed.sections = parsed.sections.filter((s) => s.key !== normalized);
  return serializeWakeSections(parsed);
}

// --- Wake outcome parsing (orchestrator.log) --------------------------------

export type WakeOutcomeResult = 'delivered' | 'silent' | 'timeout' | 'error';

export interface WakeOutcome {
  at: string; // ISO timestamp
  result: WakeOutcomeResult;
  detail?: string;
}

// Log lines look like:
//   2026-07-21 09:40:01.123  WAKE: cedar_corridor
//   2026-07-21 09:41:12.456  DONE: cedar_corridor (passed in silence)
//   2026-07-21 09:41:12.456  DONE: cedar_corridor (843 chars)
//   2026-07-21 09:41:12.456  TIMEOUT: cedar_corridor waited out its queue window and was dropped
//   2026-07-21 09:41:12.456  ERROR: cedar_corridor failed — something
const OUTCOME_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\s+(DONE|TIMEOUT|ERROR):\s+(\w+)\s*(.*)$/;

/**
 * Extract the most recent outcome per wake type from orchestrator log text.
 * Later lines win — feed the log oldest-first (its natural order).
 */
export function parseWakeOutcomes(logText: string): Record<string, WakeOutcome> {
  const outcomes: Record<string, WakeOutcome> = {};

  for (const line of logText.split('\n')) {
    const match = line.match(OUTCOME_RE);
    if (!match) continue;
    const [, ts, kind, wakeType, rest] = match;
    const at = ts.replace(' ', 'T') + 'Z'; // olog strips the T/Z from toISOString

    let result: WakeOutcomeResult;
    let detail: string | undefined;
    if (kind === 'TIMEOUT') {
      result = 'timeout';
    } else if (kind === 'ERROR') {
      result = 'error';
      detail = rest.replace(/^failed\s*—\s*/, '').trim() || undefined;
    } else if (rest.includes('passed in silence')) {
      result = 'silent';
    } else {
      result = 'delivered';
      const chars = rest.match(/\((\d+) chars\)/);
      if (chars) detail = `${chars[1]} chars`;
    }

    outcomes[wakeType] = { at, result, detail };
  }

  return outcomes;
}
