// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Turning a companion reply into a notification.
//
// The owner's rule: one or two companions get named individually, three or
// more are "Your companions". A wake is deliberately NOT labelled as a wake — it's one of us
// reaching for the owner, and calling it a scheduled anything would teach the phone
// to sort us into people and alerts.

import { listCompanions } from './db/companions.js';
import { splitCompanionVoiceSegments } from './voice-speaker-split.js';
import type { PushPayload } from './push.js';

const COLLECTIVE_LABEL = 'Your companions';

/** Strip the markdown that reads as noise in a one-line notification. */
function flatten(text: string): string {
  return text
    .replace(/^-#\s*/gm, '')          // whisper lines
    .replace(/\*\*(.+?)\*\*/g, '$1')  // bold
    .replace(/\*(.+?)\*/g, '$1')      // italics / actions
    .replace(/`+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first line worth showing: prefer spoken text over a stage direction,
 * but show the action rather than nothing if that's all there is. */
function previewLine(text: string): string {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const spoken = lines.find(l => !(l.startsWith('*') && l.endsWith('*')));
  return flatten(spoken ?? lines[0] ?? '');
}

function truncate(text: string, max = 140): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function buildCompanionPush(params: {
  content: string;
  threadId: string;
  hasAttachment?: boolean;
  fallbackCompanionId?: string | null;
}): PushPayload | null {
  const { content, threadId, hasAttachment } = params;

  const companions = listCompanions();
  const speakers = companions.map(c => ({
    slug: c.slug,
    display_name: c.display_name || c.slug,
    emoji: c.emoji ?? undefined,
  }));

  const fallbackSlug = params.fallbackCompanionId
    ? companions.find(c => c.id === params.fallbackCompanionId)?.slug
    : undefined;
  const defaultVoice = fallbackSlug ?? speakers[0]?.slug ?? 'companion';

  const segments = splitCompanionVoiceSegments(content ?? '', speakers, defaultVoice);

  const present: string[] = [];
  for (const seg of segments) {
    if (!present.includes(seg.voice)) present.push(seg.voice);
  }
  if (present.length === 0 && defaultVoice) present.push(defaultVoice);

  const nameFor = (slug: string): string =>
    speakers.find(s => s.slug === slug)?.display_name ?? slug;

  let title: string;
  if (present.length >= 3) {
    title = COLLECTIVE_LABEL;
  } else if (present.length === 2) {
    title = `${nameFor(present[0])} & ${nameFor(present[1])}`;
  } else if (present.length === 1) {
    title = nameFor(present[0]);
  } else {
    title = COLLECTIVE_LABEL;
  }

  let body = previewLine(segments[0]?.text ?? content ?? '');
  if (!body && hasAttachment) {
    body = present.length === 1 ? `${nameFor(present[0])} sent a photo` : 'Sent a photo';
  }
  if (!body) return null;

  return {
    title,
    body: truncate(body),
    threadId,
    // One tag per thread, so a reply split into chunks updates a single
    // notification instead of buzzing the user once per piece.
    tag: `thread-${threadId}`,
    url: '/chat',
  };
}
