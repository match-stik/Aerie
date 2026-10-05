// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Films arrive the way pictures do. The adapter turns a video attachment into
// a [VIDEO]:<url> sentinel on the message, and the bubble pulls every one of
// them out and draws a player at the bottom, so a film no longer has to come
// through as a zip. Kept out of MessageBubble so the parsing can be tested
// without rendering anything.

export const VIDEO_SENTINEL = '[VIDEO]:';

/** Pull every [VIDEO]: sentinel out of a message, wherever it sits. */
export function extractVideoUrls(text: string): { text: string; urls: string[] } {
  const urls: string[] = [];
  const rest = text.replace(/\[VIDEO\]:(\S+)/g, (_match, url: string) => {
    urls.push(url);
    return '';
  });
  return { text: urls.length ? rest.replace(/[ \t]+$/gm, '').trim() : text, urls };
}

/** Only a house file or a plain web address becomes a player. A protocol-
 *  relative '//host' is a web address wearing a house path's coat, so it is
 *  refused rather than guessed at. */
export function safeVideoSrc(url: string): string | null {
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}
