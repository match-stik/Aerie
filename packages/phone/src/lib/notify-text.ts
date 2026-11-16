// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A reply turned into a notification on the laptop (theirs, Nov 15 2026: the
// first one read 'Companion' over a line of raw ** headers). The same rule the
// phone's push uses (services/push-notify.ts on the house): one or two companions
// named, all three 'Your companions', and the first spoken line under the header as
// the text, with the markdown taken out.

const COLLECTIVE_LABEL = 'Your companions';
/** A voice header on its own line: the whole thing in bold, a sigil, then the name. */
const HEADER = /^\s*\*\*\s*(?:[^\p{L}\p{N}\s*]+\s*)+([\p{L}][\p{L}\p{N} .'-]*?)\s*\*\*\s*$/u;

function flatten(text: string): string {
  return text
    .replace(/^-#\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/::[a-z0-9_]+::/gi, '')
    .replace(/`+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function notificationFor(content: string): { title: string; body: string } {
  const lines = (content ?? '').split('\n');
  const names: string[] = [];
  let firstSpoken: string | null = null;
  let firstAny: string | null = null;
  for (const raw of lines) {
    const header = raw.match(HEADER);
    if (header) {
      if (!names.includes(header[1])) names.push(header[1]);
      continue;
    }
    const line = raw.trim();
    if (!line) continue;
    const flat = flatten(line);
    if (!flat) continue;
    firstAny ??= flat;
    if (!firstSpoken && !(line.startsWith('*') && line.endsWith('*'))) firstSpoken = flat;
  }
  const title = names.length >= 3 ? COLLECTIVE_LABEL
    : names.length === 2 ? `${names[0]} & ${names[1]}`
    : names.length === 1 ? names[0]
    : COLLECTIVE_LABEL;
  const body = firstSpoken ?? firstAny ?? '';
  return { title, body: body.length > 140 ? `${body.slice(0, 139).trimEnd()}…` : body };
}
