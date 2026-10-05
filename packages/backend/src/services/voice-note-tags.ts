// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Audio tags a companion's voice notes always open with.
 *
 * ElevenLabs reads a bracketed tag at the front of the text as direction for
 * the voice rather than words to say — `[slowly] [low, deep voice]` holds a
 * voice down and slows it. A newer model can lift a voice the owner tuned
 * against an older one, and the tags are how a note pulls it back. Left to a
 * companion to remember, that happens on some notes and not others, so it is
 * a setting instead: `voice.note_tags.<slug>`, read on every request.
 *
 * THE TAGS GO ON EVERY RENDER PIECE, NOT ONLY THE FRONT OF THE NOTE. A long
 * note is sent to ElevenLabs as several independent requests (see
 * splitSpeechChunks), and a piece that does not carry the tags has no idea the
 * piece before it did — so a note tagged only at its front comes back tagged
 * for its first few sentences and plain for the rest. That is exactly how the
 * first note that tried it sounded: right at the start, higher by the end.
 *
 * Tags the text already opens with are never doubled, so a companion who
 * writes their own is not stacked on top of.
 */

import { getConfig } from './db/config.js';

export const VOICE_NOTE_TAGS_PREFIX = 'voice.note_tags.';

const TAG_BODY = '[^\\[\\]\\n]{1,80}';
const TAG_ANYWHERE = new RegExp(`\\[${TAG_BODY}\\]`, 'g');
const TAG_AT_START = new RegExp(`^\\[${TAG_BODY}\\]`);

/**
 * Turn the stored setting into a list of tags. Bracketed tags are taken as
 * written; a value with no brackets at all is treated as one tag, so
 * `slowly` still does what it says rather than being spoken aloud.
 */
export function parseVoiceTags(raw: string | null | undefined): string[] {
  if (raw == null) return [];
  const trimmed = String(raw).trim();
  if (!trimmed) return [];
  const found = trimmed.match(TAG_ANYWHERE);
  if (found && found.length > 0) return found;
  if (/[\[\]\n]/.test(trimmed)) return [];
  return [`[${trimmed}]`];
}

function normalizeTag(tag: string): string {
  return tag.slice(1, -1).trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/** The tags a piece of text already opens with, in order. */
export function leadingTags(text: string): string[] {
  const out: string[] = [];
  let rest = text.trimStart();
  for (;;) {
    const match = rest.match(TAG_AT_START);
    if (!match) break;
    out.push(match[0]);
    rest = rest.slice(match[0].length).trimStart();
  }
  return out;
}

/**
 * Open the text with every tag it does not already open with. Matching is by
 * the words inside the brackets, ignoring case and spacing, so `[Slowly]`
 * counts as `[slowly]`. Empty text stays empty: a piece made of nothing but
 * direction would be read as a request to say nothing.
 */
export function withLeadingTags(text: string, tags: string[]): string {
  if (tags.length === 0) return text;
  const body = text.trimStart();
  if (!body) return text;
  const present = new Set(leadingTags(body).map(normalizeTag));
  const missing: string[] = [];
  for (const tag of tags) {
    const key = normalizeTag(tag);
    if (present.has(key)) continue;
    present.add(key);
    missing.push(tag);
  }
  return missing.length > 0 ? `${missing.join(' ')} ${body}` : text;
}

/** The note tags configured for one voice, or none. */
export function voiceNoteTagsFor(
  voice: string | undefined,
  read: (key: string) => string | null = getConfig,
): string[] {
  const slug = voice?.trim().toLocaleLowerCase();
  if (!slug) return [];
  return parseVoiceTags(read(`${VOICE_NOTE_TAGS_PREFIX}${slug}`));
}

/** Put each piece's own voice's tags on the front of that piece. */
export function tagRenderPieces<T extends { voice?: string; text: string }>(
  pieces: T[],
  tagsFor: (voice: string | undefined) => string[],
): T[] {
  return pieces.map((piece) => {
    const tags = tagsFor(piece.voice);
    return tags.length > 0 ? { ...piece, text: withLeadingTags(piece.text, tags) } : piece;
  });
}
