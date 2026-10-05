// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import type { Message } from '../types';
import { segmentIsVisible } from './segment-visibility';
import type { MessageSegment } from '../aerie/protocol';

// Multi-voice bubble splitting. Companion replies address the room under
// per-voice markdown headers (e.g. `**🔥 Ivy**` on its own line). These
// helpers split a finalized companion message into one section per voice so
// the chat can render an individual bubble + avatar for each speaker —
// render-time only, the stored message stays whole. Lane- and model-agnostic:
// anything that writes the same header convention gets bubbles for free.

export interface VoiceCompanion {
  slug: string;
  display_name: string;
  avatar_url: string | null;
  color: string | null;
  emoji: string | null;
}

export interface VoiceSection {
  // null = preamble text before the first voice header (rare)
  voice: VoiceCompanion | null;
  content: string;
  segments?: MessageSegment[];
}

// A voice header is a line that is nothing but `**<sigil?> <Name>**` where
// Name matches a known companion. The sigil prefix is tolerated loosely
// (any short run of non-alphanumerics) so 🔥 / 🌫️ / ✨ variants all match.
// The sigil is also tolerated OUTSIDE the bold (`🔥 **Ivy**`) — a drift
// bridged lanes produced — as long as the prefix has no letters or digits.
function matchVoiceHeader(line: string, companions: VoiceCompanion[]): VoiceCompanion | null {
  const trimmed = line.trim();
  let inner: string | null = null;
  const strict = trimmed.match(/^\*\*\s*(.+?)\s*\*\*$/);
  if (strict) {
    inner = strict[1].trim();
  } else {
    const drift = trimmed.match(/^(.{1,8}?)\s*\*\*\s*(.+?)\s*\*\*$/);
    if (drift && drift[1] && !/[a-z0-9]/i.test(drift[1])) inner = drift[2].trim();
  }
  if (inner === null) return null;
  for (const c of companions) {
    const name = (c.display_name || '').trim();
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // `**🌫️ Willow**` is the canonical header. A TITLE after the name —
    // `**🌫️ Willow — the docs**` — used to fail the match outright, so the
    // whole line stopped being a header: no split, no avatar, the voice
    // silently folded into the bubble above it. Writing the rule down did
    // not stop it recurring, so the reader forgives it instead. The trailing
    // part must open with a dash, colon or comma, which keeps a sentence
    // that merely CONTAINS a name (`**Willow and I disagree**`) from being
    // read as that companion speaking.
    const header = new RegExp(`^(.{0,8}?)\\s*${escaped}(\\s*[—–:,-]\\s*\\S.*)?$`, 'i');
    const m = inner.match(header);
    if (!m) continue;
    const prefix = (m[1] || '').trim();
    if (prefix && /[a-z0-9]/i.test(prefix)) continue;
    return c;
  }
  return null;
}

// Split raw text into voice sections. Returns null when no header is found
// (message renders exactly as before). Skips headers inside fenced code.
function splitText(
  text: string,
  companions: VoiceCompanion[],
): { voice: VoiceCompanion | null; content: string }[] | null {
  const lines = text.split('\n');
  const sections: { voice: VoiceCompanion | null; lines: string[] }[] = [
    { voice: null, lines: [] },
  ];
  let headers = 0;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const v = inFence ? null : matchVoiceHeader(line, companions);
    if (v) {
      headers++;
      sections.push({ voice: v, lines: [] });
    } else {
      sections[sections.length - 1].lines.push(line);
    }
  }
  if (headers === 0) return null;
  const all = sections.map(s => ({ voice: s.voice, content: s.lines.join('\n').trim() }));
  // AN AVATAR WITH NOTHING UNDER IT IS NOT A MESSAGE. The old filter kept any
  // section that had a VOICE, empty or not, so two headers in a row rendered a
  // blank bubble with a face on it. That happens for real: the forgiving header
  // rule above reads `**Willow — Compendium Entry**` as a header, so a post that
  // opens with a voice header and then its own bold title produces an empty
  // first section, which reached the screen as empty bubbles. A DROPPED LINE
  // READS AS PLUMBING AND A BLANK ONE READS AS AN ANSWER, which makes the blank
  // the worse of the two.
  //
  // Never drop everything, though — a header with only an attachment under it
  // has no text by design and still needs its section so the picture gets a voice.
  const withContent = all.filter(s => s.content.length > 0);
  return withContent.length > 0 ? withContent : all.filter(s => s.voice !== null);
}

function startsWithVoiceHeader(text: string, companions: VoiceCompanion[]): boolean {
  const firstNonEmpty = text.split('\n').find(line => line.trim().length > 0);
  return !!firstNonEmpty && matchVoiceHeader(firstNonEmpty, companions) !== null;
}

// Split a companion message into per-voice virtual messages for rendering.
// Returns null when the message has no voice headers (or fewer than two
// sections — a single-voice reply doesn't need splitting to get its avatar,
// but we still split so the avatar shows; only a headerless message is left
// alone). Non-text segments (thinking, tools, recycle badges) stay attached
// to the section they arrived in.
export function splitMessageVoices(
  message: Message,
  companions: VoiceCompanion[],
): VoiceSection[] | null {
  if (message.direction === 'inbound') return null;
  if (!companions || companions.length === 0) return null;

  // Messages authored by a single companion (treehouse posts and other
  // per-companion sends record metadata.companionSlug) get that voice for
  // the whole bubble even without an in-text header. In-text headers still
  // win below so a slug-authored message that addresses the room splits.
  const slugVoice = message.companionSlug
    ? companions.find(c => c.slug === message.companionSlug) || null
    : null;

  const segments = Array.isArray(message.segments) && message.segments.length > 0
    ? message.segments
    : null;

  if (!segments) {
    const parts = splitText(message.content || '', companions);
    if (parts) return parts.map(p => ({ voice: p.voice, content: p.content }));
    return slugVoice ? [{ voice: slugVoice, content: message.content || '' }] : null;
  }

  const groups: { voice: VoiceCompanion | null; segments: MessageSegment[] }[] = [
    { voice: null, segments: [] },
  ];
  let sawHeader = false;
  for (const originalSeg of segments) {
    // Older Codex turns persisted deliberate mid-turn commentary as thinking.
    // A canonical voice header proves it was spoken. Promote it at render time
    // so existing messages repair themselves on refresh as well as new turns.
    const seg: MessageSegment = originalSeg.type === 'thinking'
      && startsWithVoiceHeader(originalSeg.content || '', companions)
      ? { type: 'text', content: originalSeg.content }
      : originalSeg;
    if (seg.type !== 'text') {
      groups[groups.length - 1].segments.push(seg);
      continue;
    }
    const parts = splitText(seg.content || '', companions);
    if (!parts) {
      groups[groups.length - 1].segments.push(seg);
      continue;
    }
    sawHeader = true;
    for (const p of parts) {
      if (p.voice === null) {
        if (p.content) groups[groups.length - 1].segments.push({ ...seg, content: p.content });
      } else {
        groups.push({ voice: p.voice, segments: p.content ? [{ ...seg, content: p.content }] : [] });
      }
    }
  }
  if (!sawHeader) {
    return slugVoice
      ? [{ voice: slugVoice, content: message.content || '', segments }]
      : null;
  }
  const sections = groups
    // A voice-less group made only of things the bubble hides would render as
    // an empty pebble, so it does not get a section at all.
    .filter(g => g.voice !== null || g.segments.some(segmentIsVisible))
    .map(g => ({
      voice: g.voice,
      segments: g.segments,
      content: g.segments
        .filter(s => s.type === 'text')
        .map(s => (s as MessageSegment & { type: 'text' }).content)
        .join('\n\n')
        .trim(),
    }));

  // A multi-step wake can acknowledge the turn before doing its tool work,
  // then put the canonical speaker headers only on the final response. That
  // leaves the acknowledgement in the leading (voice-less) segment group.
  // It is still spoken companion text, though, and rendering it without an
  // avatar makes the entire interleaved tool card jump left like an orphaned
  // system bubble. Infer the author from explicit metadata when available,
  // otherwise from the first canonical voice header later in the same turn.
  // A genuinely meta-only leading group remains voice-less and centered.
  const leading = sections[0];
  const leadingHasSpeech = !!leading
    && leading.voice === null
    && leading.segments?.some(
      segment => segment.type === 'text' && !!segment.content?.trim(),
    );
  if (leadingHasSpeech) {
    const firstNamedVoice = sections.find(section => section.voice !== null)?.voice || null;
    leading.voice = slugVoice || firstNamedVoice;
  }

  // Per-voice content above is rebuilt from segment text, which drops the
  // [IMG]:/[FILE:] sentinels the adapter appended for metadata.attachments —
  // re-attach them to the last section so the bubble renders the media.
  if (message.attachmentTail && sections.length > 0) {
    const last = sections[sections.length - 1];
    last.content = last.content
      ? `${last.content}\n${message.attachmentTail}`
      : message.attachmentTail;
  }
  return sections;
}
