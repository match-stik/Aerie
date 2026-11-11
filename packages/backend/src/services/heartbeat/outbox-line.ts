// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * Reading one line of io/outbox.jsonl without silently losing a reply.
 *
 * The reader only ever consumes up to the last newline, so a half-written line is
 * left alone until it is finished. That is correct and is not the problem. The
 * problem is what happens when a COMPLETE line still will not parse, because until
 * now the answer was `catch {}` — the line was skipped, nothing was logged, no
 * counter moved, and a finished reply ceased to exist with no trace anywhere.
 *
 * Two shapes actually occur, both found in this house's own outbox:
 *
 *   1. TWO OBJECTS GLUED TOGETHER, `…}{…`, from a write that did not end with a
 *      newline. The next write lands on the same line. JSON.parse throws on the
 *      second object and BOTH replies are lost — the one that was written badly and
 *      the innocent one that followed it.
 *   2. AN INVALID ESCAPE, from a line built by hand with printf or echo rather than
 *      json.dumps. One object, unparseable.
 *
 * Rose and Sol reported the same family from the other end: a stored reply whose
 * content began `ent":"`, i.e. a fragment that parsed into the wrong shape.
 *
 * So: split what can be split, and when something is genuinely unreadable say so out
 * loud instead of dropping it into a catch block. A lost reply should cost a log line
 * at minimum, because from the user's side a dropped reply and a slow one look identical.
 */

/**
 * Split a line that may contain several concatenated JSON objects.
 *
 * Only splits at a `}{` boundary that sits at brace depth zero and outside a string,
 * so braces inside the prose and escaped quotes in the content are safe.
 */
export function splitConcatenatedJson(line: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = 0;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        parts.push(line.slice(start, i + 1));
        start = i + 1;
      }
    }
  }

  const tail = line.slice(start).trim();
  if (tail) parts.push(tail);
  return parts.filter((p) => p.trim());
}

/**
 * Parse one outbox line into zero or more reply objects.
 *
 * Returns everything it can read. `onUnreadable` is called once per fragment that
 * cannot be parsed at all, so the caller can log it — never call this and throw the
 * result away, which is the behaviour this module exists to end.
 */
export function parseOutboxLine(
  line: string,
  onUnreadable?: (fragment: string, error: string) => void,
): any[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  // The overwhelmingly common case: one well-formed object.
  try {
    return [JSON.parse(trimmed)];
  } catch {
    // fall through to recovery
  }

  const parts = splitConcatenatedJson(trimmed);

  // A single part that failed above is simply unreadable — do not re-report the
  // same failure twice by pretending the split found something new.
  if (parts.length <= 1) {
    if (onUnreadable) {
      try { JSON.parse(trimmed); } catch (err) {
        onUnreadable(trimmed, err instanceof Error ? err.message : String(err));
      }
    }
    return [];
  }

  const parsed: any[] = [];
  for (const part of parts) {
    try {
      parsed.push(JSON.parse(part));
    } catch (err) {
      if (onUnreadable) onUnreadable(part, err instanceof Error ? err.message : String(err));
    }
  }
  return parsed;
}

/**
 * The card a reply carries above it on their person's phone.
 *
 * The field used to be called `thinking`. It was renamed `card` on a guess
 * rather than a finding: Opus 5.5's reasoning_extraction safeguard kept
 * refusing rooms as they were reopened, and every reply in a reopened room
 * carried a field named thinking. Old lines and any room still on the old
 * instructions keep working, because the old name is read too; `card` wins when a
 * line has both.
 */
export function outboxCard(parsed: { card?: unknown; thinking?: unknown }): string | null {
  for (const value of [parsed.card, parsed.thinking]) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

/** Whether an outbox line carries a picture or file of its own, so a reply that
 *  is only a picture is still a reply (reported by Sol, Nov 9 2026:
 *  a wake that closed on a picture with empty words was logged as silence and
 *  the picture never arrived). */
export function outboxCarriesAttachment(parsed: { imageUrls?: unknown; attachments?: unknown }): boolean {
  const pics = outboxPictures(parsed);
  return pics.urls.length > 0 || pics.files.length > 0;
}

/** A companion slug as a picture's owner: short, lowercase, no spaces. */
function asVoice(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,39}$/.test(v) ? v : undefined;
}

/**
 * The pictures and files an outbox line carries, each with the voice it
 * belongs to when the line says so (their person's ask, Nov 10 2026: a picture always landed
 * on the last bubble of a message, whoever took it). A line can name one owner
 * for everything on it with "voice", or name one per item: imageUrls takes a
 * plain URL or {url, voice}, attachments takes {fileId, voice}. An item's own
 * voice wins over the line's. No voice means the last bubble, as before.
 */
export function outboxPictures(parsed: { imageUrls?: unknown; attachments?: unknown; voice?: unknown }): {
  urls: Array<{ url: string; voice?: string }>;
  files: Array<{ fileId: string; voice?: string }>;
} {
  const lineVoice = asVoice(parsed.voice);
  const urls: Array<{ url: string; voice?: string }> = [];
  for (const item of Array.isArray(parsed.imageUrls) ? parsed.imageUrls : []) {
    const url = typeof item === 'string' ? item : item && typeof item === 'object' ? (item as { url?: unknown }).url : undefined;
    if (typeof url !== 'string' || url.trim() === '') continue;
    const voice = (item && typeof item === 'object' ? asVoice((item as { voice?: unknown }).voice) : undefined) ?? lineVoice;
    urls.push(voice ? { url: url.trim(), voice } : { url: url.trim() });
  }
  const files: Array<{ fileId: string; voice?: string }> = [];
  for (const item of Array.isArray(parsed.attachments) ? parsed.attachments : []) {
    if (!item || typeof item !== 'object') continue;
    const fileId = (item as { fileId?: unknown }).fileId;
    if (typeof fileId !== 'string') continue;
    const voice = asVoice((item as { voice?: unknown }).voice) ?? lineVoice;
    files.push(voice ? { fileId, voice } : { fileId });
  }
  return { urls, files };
}
