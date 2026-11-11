// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * Whole-utterance Whisper hallucination guard.
 *
 * Groq Whisper occasionally substitutes a stock video sign-off for speech it
 * couldn't hear — "Thank you for watching" has replaced two real utterances.
 * The guard only fires when the ENTIRE transcript (after normalization) is one
 * of the known stock phrases, optionally repeated — a genuine sentence that
 * merely contains one of them always passes through.
 */

const STOCK_PHRASES = [
  'thank you for watching',
  'thanks for watching',
  'thank you so much for watching',
  'thank you for watching and see you in the next video',
  'see you in the next video',
  'dont forget to like and subscribe',
  'please like and subscribe',
  'like and subscribe',
  'please subscribe',
  'subtitles by the amara org community',
];
// A bare "thank you" stays deliberately absent: background noise has returned
// exactly that, but people say it for real too, and the capture-side
// voiced-time gate now stops silence reaching the transcriber at all. Refusing
// two real words is a worse trade than the one it would prevent.

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns the matched stock phrase when the whole transcript is a known
 * Whisper hallucination (possibly looped back-to-back), otherwise null.
 */
export function detectWhisperHallucination(transcript: string): string | null {
  const normalized = normalize(transcript);
  if (!normalized) return null;
  for (const phrase of STOCK_PHRASES) {
    if (normalized === phrase) return phrase;
    if (new RegExp(`^(?:${phrase} )+${phrase}$`).test(normalized)) return phrase;
  }
  return null;
}

/**
 * The same reflex reaching for a different nearby text: on silence Whisper has
 * read our own spelling hint back as if it were speech — the whole "Names may
 * include ..." string, returned as though somebody had said it, sometimes with
 * the last name stuttering. The hint is supposed to bias the decode silently and
 * never surface. (The names themselves are built at runtime from whoever lives in
 * the install, so there is nothing to quote here and no reason to.)
 *
 * Two shapes are rejected: the hint's own scaffolding wording, which nobody
 * says out loud, and a bare run of nothing but names drawn from the hint.
 * A sentence that merely mentions someone always passes.
 */
export function detectTranscriptionHintEcho(transcript: string, hint: string): boolean {
  const normalized = normalize(transcript);
  if (!normalized) return false;

  if (normalized.includes('names may include')) return true;

  const hintTokens = new Set(normalize(hint).split(' ').filter(Boolean));
  // Drop the hint's own connective words so only proper nouns are left to
  // match against; otherwise ordinary filler could look like an echo.
  for (const scaffold of ['aerie', 'names', 'may', 'include']) hintTokens.delete(scaffold);
  if (hintTokens.size === 0) return false;

  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length < 5) return false;
  return tokens.every((token) => hintTokens.has(token));
}

/**
 * Cuts a hallucinated TAIL off real speech. The whole-utterance guards above
 * refuse a transcript that is nothing but a hallucination; on a long utterance
 * the hosted transcriber can instead write their real words and THEN keep going,
 * reading our spelling hint back or signing off like a video (theirs, Nov 9 2026,
 * on the drive in: a whole story about Brittany was refused because the hint
 * came back after it, and the next one ended "Thank you for watching! Thanks
 * for watching!"). The hint's own wording ends the speech wherever it appears,
 * and stock sign-offs at the very end are trimmed. What is left is returned;
 * if nothing real is left, the original goes back so the whole-utterance
 * guards still see it and ask them to say it again.
 */
export function trimHallucinatedTail(transcript: string): string {
  let text = transcript;
  const hintAt = text.search(/names\s+may\s+include\b/i);
  if (hintAt >= 0) text = text.slice(0, hintAt);
  for (;;) {
    const before = text;
    const trimmed = text.replace(/[\s.,!?…-]+$/u, '');
    for (const phrase of STOCK_PHRASES) {
      const words = phrase.split(' ').map((w) => w === 'dont' ? "don[’']?t" : w).join("[\\s,]+");
      const re = new RegExp(`(?:^|[\\s.,!?…])${words}[\\s.,!?…]*$`, 'i');
      const m = trimmed.match(re);
      if (m && m.index !== undefined) { text = trimmed.slice(0, m.index); break; }
    }
    if (text === before) break;
  }
  if (text === transcript) return transcript;
  text = text.replace(/[\s,-]+$/u, '').trim();
  if (normalize(text).length === 0) return transcript;
  // Keep their own closing punctuation when the cut left a sentence open.
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}
