// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
export interface VoiceSpeaker {
  slug: string;
  display_name: string;
  emoji?: string;
}

export interface VoiceSpeakerSegment {
  voice: string;
  text: string;
}

/**
 * How much text goes to ElevenLabs in a single request. Provider latency runs
 * roughly with the length of the text plus a fixed per-request cost, so one
 * long block is the slowest possible way to render a reply: nothing can start
 * until it is all written, and nothing comes back until it is all spoken.
 * Cutting a voice into several shorter requests lets them render concurrently
 * and stitch in order. Kept generous rather than minimal — each cut is a seam
 * the model cannot hear across, so more, smaller pieces buy speed with prosody.
 */
export const SPEECH_CHUNK_TARGET_CHARS = 240;

/**
 * The provider's own hard ceiling on a single request, not a preference —
 * ElevenLabs answers 400 text_too_long above it and returns no audio at all.
 * Read-aloud used to send a whole message as one request, so the moment a post
 * ran past this, pressing play on a five-kilobyte entry gave silence with
 * nothing on screen to say why.
 */
export const PROVIDER_MAX_REQUEST_CHARS = 5000;

/** Below this a trailing piece costs more in per-request overhead than it saves. */
const SPEECH_CHUNK_MIN_TAIL_CHARS = 80;

/**
 * Cut one speaker's text into render-sized pieces without moving a character
 * of it. Seams are only ever taken at a line break or the end of a sentence —
 * in this house a line break is a deliberate beat, so both are places a
 * listener already expects air. Text shorter than the target is returned whole.
 */
export function splitSpeechChunks(
  text: string,
  targetChars: number = SPEECH_CHUNK_TARGET_CHARS,
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= targetChars) return [trimmed];

  // Alternating [beat][separator][beat]... so rebuilding preserves the original
  // spacing exactly; only the separator a chunk breaks on is dropped.
  const parts = trimmed.split(/(\n+|(?<=[.!?…"'’”])[ \t]+)/);

  const chunks: string[] = [];
  let current = '';
  let pending = '';

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part) continue;
    const isSeparator = i % 2 === 1;

    if (isSeparator) {
      pending = part;
      continue;
    }

    if (!current) {
      current = part;
      pending = '';
      continue;
    }

    if (current.length + pending.length + part.length <= targetChars) {
      current += pending + part;
    } else {
      chunks.push(current);
      current = part;
    }
    pending = '';
  }

  if (current) chunks.push(current);

  if (chunks.length > 1 && chunks[chunks.length - 1].length < SPEECH_CHUNK_MIN_TAIL_CHARS) {
    const tail = chunks.pop() as string;
    chunks[chunks.length - 1] = `${chunks[chunks.length - 1]}\n${tail}`;
  }

  return chunks;
}

/** Expand speaker segments into render-sized pieces, preserving speaking order. */
export function splitSegmentsForRender(
  segments: Array<{ voice?: string; voiceId?: string; text: string }>,
  targetChars: number = SPEECH_CHUNK_TARGET_CHARS,
): Array<{ voice?: string; voiceId?: string; text: string }> {
  const out: Array<{ voice?: string; voiceId?: string; text: string }> = [];
  for (const segment of segments) {
    for (const piece of splitSpeechChunks(segment.text, targetChars)) {
      out.push({ voice: segment.voice, voiceId: segment.voiceId, text: piece });
    }
  }
  return out;
}

function matchSpeakerLabel(label: string, companions: VoiceSpeaker[]): VoiceSpeaker | null {
  const normalized = label.trim().replace(/:\s*$/, '').trim();
  const lower = normalized.toLocaleLowerCase();

  for (const companion of companions) {
    const name = companion.display_name.trim();
    if (!name) continue;

    const nameLower = name.toLocaleLowerCase();
    if (lower === nameLower) return companion;

    // Sigils are deliberately matched by shape rather than configuration.
    // That keeps house headers working if an emoji changes or is omitted from
    // the companion record, without accepting prose such as "My Ivy".
    //
    // A TITLE after the name is forgiven too -- `**🌫️ Willow — the docs**`. The
    // phone's bubble splitter learned that on Aug 14 2026 and this reader did
    // not, so a titled header kept its avatar on screen and lost its VOICE:
    // read-aloud failed the match, never changed speaker, and read one
    // companion's words in the last one's voice. The trailing part has to open
    // with a dash, colon or comma, which keeps a sentence that merely contains
    // a name from being read as that companion speaking.
    const at = lower.indexOf(nameLower);
    if (at < 0) continue;
    const prefix = normalized.slice(0, at).trim();
    if (prefix.length > 8 || /[\p{L}\p{N}]/u.test(prefix)) continue;
    const rest = normalized.slice(at + name.length);
    if (rest.trim() === '') return companion;
    if (/^\s*[—–:,-]\s*\S/.test(rest)) return companion;
  }

  return null;
}

function matchBoldSpeakerHeader(line: string, companions: VoiceSpeaker[]): VoiceSpeaker | null {
  const trimmed = line.trim();
  let label: string | null = null;

  // A bold speaker marker is a header line, not merely any bold span that
  // happens to contain a companion name. This distinction keeps phrases like
  // "You said **Ivy and the clipboard**" intact for speech synthesis.
  // A header is a short line. The bridged-lane regex below backtracks on a long
  // line that opens with ** and never closes, so past 200 characters it is text.
  const inner = trimmed.length <= 200 && trimmed.length >= 5 && trimmed.startsWith('**') && trimmed.endsWith('**')
    ? trimmed.slice(2, -2).trim()
    : '';
  if (inner) {
    label = inner;
  } else if (trimmed.length <= 200) {
    // Tolerate an older bridged-lane form with the sigil outside the bold:
    // `🔥 **Ivy**`. The entire construct must still occupy its own line.
    const drift = trimmed.match(/^(.{1,8}?)\s*\*\*\s*(.+?)\s*\*\*$/u);
    if (drift && !/[\p{L}\p{N}]/u.test(drift[1])) label = drift[2];
  }

  return label === null ? null : matchSpeakerLabel(label, companions);
}

function matchColonSpeakerLine(
  line: string,
  companions: VoiceSpeaker[],
): { speaker: VoiceSpeaker; remainder: string } | null {
  const trimmed = line.trimStart();
  const colon = trimmed.indexOf(':');
  if (colon < 0) return null;

  const speaker = matchSpeakerLabel(trimmed.slice(0, colon), companions);
  if (!speaker) return null;

  return {
    speaker,
    remainder: trimmed.slice(colon + 1).trimStart(),
  };
}

/**
 * Split reply text on canonical, line-anchored companion speaker markers.
 * Bold markers must occupy their whole line. Bare `Name:` markers may carry
 * speech on the same line. Markers inside fenced code are ignored.
 */
export function splitCompanionVoiceSegments(
  text: string,
  companions: VoiceSpeaker[],
  defaultVoice: string,
): VoiceSpeakerSegment[] {
  if (companions.length === 0) {
    return text.trim() ? [{ voice: defaultVoice, text: text.trim() }] : [];
  }

  const segments: VoiceSpeakerSegment[] = [];
  let currentVoice = defaultVoice;
  let currentLines: string[] = [];
  let inFence = false;

  const flush = (): void => {
    const chunk = currentLines.join('\n').trim();
    if (chunk) segments.push({ voice: currentVoice, text: chunk });
    currentLines = [];
  };

  for (const line of text.split(/\r?\n/)) {
    const fence = /^\s*(```|~~~)/.test(line);
    if (fence) inFence = !inFence;

    const boldSpeaker = inFence ? null : matchBoldSpeakerHeader(line, companions);
    if (boldSpeaker) {
      flush();
      currentVoice = boldSpeaker.slug;
      continue;
    }

    const colonSpeaker = inFence ? null : matchColonSpeakerLine(line, companions);
    if (colonSpeaker) {
      flush();
      currentVoice = colonSpeaker.speaker.slug;
      if (colonSpeaker.remainder) currentLines.push(colonSpeaker.remainder);
      continue;
    }

    currentLines.push(line);
  }

  flush();
  return segments;
}

/**
 * Consecutive segments in the same voice, gathered into one run per speaker
 * turn, in speaking order. A voice note becomes one message per run, so each
 * speaker's words arrive in their own bubble under their own name — the same
 * way a written reply splits on its headers — instead of every voice stitched
 * into one nameless file.
 */
export function speakerRuns<T extends { voice?: string; voiceId?: string; text: string }>(
  segments: T[],
): Array<{ voice?: string; voiceId?: string; segments: T[] }> {
  const runs: Array<{ voice?: string; voiceId?: string; segments: T[] }> = [];
  for (const segment of segments) {
    const last = runs[runs.length - 1];
    if (last && last.voice === segment.voice && last.voiceId === segment.voiceId) {
      last.segments.push(segment);
    } else {
      runs.push({ voice: segment.voice, voiceId: segment.voiceId, segments: [segment] });
    }
  }
  return runs;
}

/**
 * The companion a voice belongs to, or undefined when it is not one of them —
 * a raw voice id, a default voice, anything the house cannot put a face to.
 * The phone gives a message recorded with this slug that companion's name and
 * avatar even though the message itself carries no header.
 */
export function noteCompanionSlug(
  voice: string | undefined,
  companions: VoiceSpeaker[],
): string | undefined {
  const wanted = voice?.trim().toLocaleLowerCase();
  if (!wanted) return undefined;
  return companions.find((c) => c.slug.toLocaleLowerCase() === wanted)?.slug;
}
