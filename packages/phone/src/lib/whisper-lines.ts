// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
/**
 * Split a message into plain runs and "-# whisper" lines, for the places that
 * draw text themselves instead of through the chat's markdown renderer. Chat
 * turns a line that starts with "-# " into small muted text (MessageBubble and
 * MessageSegments rewrite it to an h6); the Treehouse page printed the marker
 * as it was. One marker is consumed, the same as chat, so "-# -# x" keeps one.
 * A marker just inside an opening * or _ ("*-# whispering*") whispers too and
 * keeps its italics (the phone used to print the marker instead).
 */
export interface TextRun {
  whisper: boolean;
  text: string;
}

const WHISPER = /^([*_]{1,3})?-# +(.*)$/;

/** Every place that draws markdown rewrites whisper lines to an h6 through this. */
export function whispersToHeadings(text: string): string {
  return (text ?? '').replace(/(^|\n)([*_]{1,3})?-# +(.*)/g, (_m, brk: string, em: string | undefined, t: string) => `${brk}###### ${em ?? ''}${t}`);
}

export function splitWhispers(text: string): TextRun[] {
  const runs: TextRun[] = [];
  for (const line of (text ?? '').split('\n')) {
    const m = line.match(WHISPER);
    if (m) {
      runs.push({ whisper: true, text: (m[1] ?? '') + m[2] });
      continue;
    }
    const last = runs[runs.length - 1];
    if (last && !last.whisper) last.text += `\n${line}`;
    else runs.push({ whisper: false, text: line });
  }
  return runs;
}
