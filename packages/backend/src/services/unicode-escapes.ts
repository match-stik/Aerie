// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Repair for replies whose non-ASCII characters arrived spelled out as escape
// sequences instead of as characters.
//
// The CLI lane writes each reply as a JSON line. When the session's shell runs
// on a console whose codepage cannot emit a character, the character never
// enters the string as a character — the escape sequence is written as literal
// text, and the JSON encoder then correctly escapes that backslash. The reader
// parses the line successfully and a bare `œ` reaches the bubble.
//
// Forcing UTF-8 on the spawned session closes the source. This heals lines that
// were already written, and is deliberately NOT wired into the read path: a
// message *about* escape sequences legitimately contains them, and silently
// rewriting one would corrupt the conversation about the corruption. Code spans
// are skipped for the same reason — technical writing puts escapes in backticks.

const CODE_SPAN_RE = /```[\s\S]*?```|``[\s\S]*?``|`[^`\n]*`/g;
const ESCAPE_RE = /\\u([0-9a-fA-F]{4})/g;

/**
 * Decode stray `\uXXXX` escape sequences that reached storage as literal text.
 *
 * Only non-ASCII codepoints are decoded — an escape for an ASCII character is
 * far likelier to be something someone typed on purpose than damage in the
 * pipe. Adjacent escapes reassemble into surrogate pairs on their own, since
 * each replacement emits one UTF-16 code unit.
 */
export function repairStrayUnicodeEscapes(text: string): string {
  if (typeof text !== 'string' || !text.includes('\\u')) return text;

  const protectedRanges: Array<[number, number]> = [];
  for (const match of text.matchAll(CODE_SPAN_RE)) {
    if (match.index === undefined) continue;
    protectedRanges.push([match.index, match.index + match[0].length]);
  }
  const isProtected = (index: number) =>
    protectedRanges.some(([start, end]) => index >= start && index < end);

  return text.replace(ESCAPE_RE, (match, hex: string, offset: number) => {
    if (isProtected(offset)) return match;
    // A doubled backslash is an escaped backslash followed by text, not a
    // character that failed to make it through.
    if (text[offset - 1] === '\\') return match;
    const code = parseInt(hex, 16);
    if (code < 0x80) return match;
    return String.fromCharCode(code);
  });
}
