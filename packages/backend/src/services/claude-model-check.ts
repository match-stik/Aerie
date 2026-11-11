// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Which Claude models Anthropic lists that the picker does not have yet (theirs,
// Nov 10 2026: 'the auto model pull thing Maggie was talking about').
//
// The idea is Maggie's, from her Covenant V3: CLAUDE_MODELS is typed
// by hand, so read Anthropic's published models overview instead, which serves
// plain Markdown with `.md` on the end and needs no key, and offer whatever the
// picker lacks. Written fresh for this house, with their trust rules kept: only
// ids the comparison table states can be added, and a page that has changed
// shape is an error, never 'nothing new'.
//
// The one thing this house adds: a model being listed does not mean a lane can
// launch it. A Claude lane runs the Claude Code program on this box, and a lane
// pointed at a model that program has never heard of dies on launch and is
// relaunched every few seconds with nothing saying why. So each listed model is
// also looked for inside the installed program, and one it does not carry is
// shown as waiting on a Claude Code update rather than offered as a trap.
//
// Nothing here spends model quota or sends anything of theirs anywhere.

import { createReadStream, existsSync, realpathSync, statSync } from 'fs';
import { delimiter, dirname, join } from 'path';

export const MODELS_DOC_URL = 'https://platform.claude.com/docs/en/models/overview.md';
const FETCH_TIMEOUT_MS = 10_000;
const LISTING_TTL_MS = 30 * 60 * 1000;

export interface ListedClaudeModel {
  id: string;
  label: string;
  /** Tokens, when the page states a context window this can read. */
  contextLength: number | null;
}

function splitRow(line: string): string[] {
  const cells = line.split('|').map(c => c.trim());
  if (cells[0] === '') cells.shift();
  if (cells[cells.length - 1] === '') cells.pop();
  return cells;
}

/** `[Context window](https://…)` reads as `Context window`. */
function rowLabel(cell: string): string {
  return cell.replace(/^\[([^\]]+)\]\([^)]*\)$/, '$1').trim();
}

function findRow(lines: string[], label: string): string[] | null {
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const cells = splitRow(line);
    if (cells.length && rowLabel(cells[0]) === label) return cells;
  }
  return null;
}

/** The value in a cell that is exactly one backticked token, else null. */
function codeCell(cell: string | undefined): string | null {
  const m = cell?.match(/^`([^`]+)`$/);
  return m ? m[1] : null;
}

/** '1M tokens' -> 1000000, '200K tokens' -> 200000; anything else null. */
export function readContextWindow(cell: string | undefined): number | null {
  const m = (cell || '').match(/([\d.]+)\s*([KkMm])\b/);
  if (!m) return null;
  const n = Number(m[1]) * (m[2].toLowerCase() === 'm' ? 1_000_000 : 1_000);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * The models the page's comparison table states, or null when the table is not
 * there in the shape this reads. Null must be reported as a changed page.
 */
export function parseModelsDoc(markdown: string): ListedClaudeModel[] | null {
  const lines = markdown.split(/\r?\n/);
  const header = findRow(lines, 'Feature');
  const ids = findRow(lines, 'Claude API ID');
  if (!header || !ids) return null;
  const context = findRow(lines, 'Context window');
  const out: ListedClaudeModel[] = [];
  for (let col = 1; col < header.length; col++) {
    const id = codeCell(ids[col]);
    const label = header[col];
    if (!id || !label || !/^claude-[a-z0-9.-]+$/.test(id)) continue;
    out.push({ id, label, contextLength: readContextWindow(context?.[col]) });
  }
  return out.length ? out : null;
}

export class ListingError extends Error {}

let lastListing: { at: number; models: ListedClaudeModel[] } | null = null;

export async function readModelListing(
  fetchDoc: () => Promise<string> = defaultFetch,
  opts: { fresh?: boolean } = {},
): Promise<ListedClaudeModel[]> {
  if (!opts.fresh && lastListing && Date.now() - lastListing.at < LISTING_TTL_MS) return lastListing.models;
  let markdown: string;
  try {
    markdown = await fetchDoc();
  } catch (err) {
    throw new ListingError(`Could not read Anthropic's models page: ${err instanceof Error ? err.message : String(err)}.`);
  }
  const models = parseModelsDoc(markdown);
  if (!models) {
    throw new ListingError("Anthropic's models page has changed shape, so this can't tell what is new. The reader in services/claude-model-check.ts needs updating.");
  }
  lastListing = { at: Date.now(), models };
  return models;
}

/** For tests. */
export function forgetModelListing(): void {
  lastListing = null;
}

async function defaultFetch(): Promise<string> {
  const res = await fetch(MODELS_DOC_URL, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: 'text/markdown, text/plain, */*' },
  });
  if (!res.ok) throw new Error(`the page answered HTTP ${res.status}`);
  return res.text();
}

// ---------------------------------------------------------------------------
// Does the installed Claude Code know a model?
// ---------------------------------------------------------------------------

/** The Claude Code program a lane runs: `claude` on PATH, followed to its real
 *  file, and the native binary beside it when the PATH entry is a wrapper. */
export function installedClaudeProgram(pathEnv = process.env.PATH || ''): string | null {
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'claude');
    if (!existsSync(candidate)) continue;
    let real: string;
    try {
      real = realpathSync(candidate);
    } catch {
      continue;
    }
    const native = join(dirname(real), 'claude.exe');
    if (existsSync(native)) return native;
    return real;
  }
  return null;
}

/** Bytes that may follow an id inside the program without it being a longer id. */
function endsId(byte: number | undefined): boolean {
  if (byte === undefined) return true;
  const ch = String.fromCharCode(byte);
  return !/[a-z0-9.-]/.test(ch);
}

/**
 * Which of `ids` appear in the file as whole ids (claude-fable-5 is not found
 * inside claude-fable-5-1). Streams the file, so a program of a few hundred
 * megabytes is read once without holding it whole.
 */
export async function idsInFile(path: string, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const needles = ids.map(id => ({ id, bytes: Buffer.from(id, 'latin1') }));
  const keep = Math.max(0, ...needles.map(n => n.bytes.length)) + 1;
  let carry: Buffer = Buffer.alloc(0);
  for await (const chunk of createReadStream(path, { highWaterMark: 4 * 1024 * 1024 })) {
    const buf = carry.length ? Buffer.concat([carry, chunk as Buffer]) : (chunk as Buffer);
    for (const n of needles) {
      if (found.has(n.id)) continue;
      let at = buf.indexOf(n.bytes);
      while (at !== -1) {
        const after = at + n.bytes.length;
        // An id cut at the end of the chunk is judged when the next chunk arrives.
        if (after >= buf.length) break;
        if (endsId(buf[after]) && (at === 0 || endsId(buf[at - 1]))) {
          found.add(n.id);
          break;
        }
        at = buf.indexOf(n.bytes, at + 1);
      }
    }
    if (found.size === needles.length) break;
    carry = buf.subarray(Math.max(0, buf.length - keep));
  }
  return found;
}

let cliCache: { key: string; ids: Map<string, boolean> } | null = null;

/** For each id, whether the installed Claude Code carries it; null when the
 *  program cannot be found (then nothing can be said either way). */
export async function cliKnowsModels(ids: string[]): Promise<Map<string, boolean> | null> {
  const program = installedClaudeProgram();
  if (!program) return null;
  let key: string;
  try {
    const st = statSync(program);
    key = `${program}:${st.size}:${st.mtimeMs}`;
  } catch {
    return null;
  }
  if (!cliCache || cliCache.key !== key) cliCache = { key, ids: new Map() };
  const unknown = ids.filter(id => !cliCache!.ids.has(id));
  if (unknown.length) {
    const found = await idsInFile(program, unknown);
    for (const id of unknown) cliCache.ids.set(id, found.has(id));
  }
  return new Map(ids.map(id => [id, cliCache!.ids.get(id) === true]));
}
