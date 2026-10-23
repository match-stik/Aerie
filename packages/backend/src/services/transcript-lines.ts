// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { createReadStream } from 'fs';

/**
 * Hand every line of a file to `take`, one at a time, and never the whole
 * file at once. A live lane's transcript is the whole room's history: on
 * Oct 21 2026 one was 159 MB, and the two readers that run at the end of
 * every turn (the context meter and the turn's usage row) each read it whole
 * and split it, which took the backend's 2 GB heap from about half a gig to
 * nearly all of it after every turn, until once it went past and the house
 * fell over. Read this way, memory holds one chunk and the longest line.
 *
 * A missing or unreadable file rejects, as readFile did. The last line is
 * handed over even with no newline after it.
 */
export async function forEachLine(path: string, take: (line: string) => void): Promise<void> {
  let carry = '';
  for await (const chunk of createReadStream(path, { encoding: 'utf8' })) {
    const text = carry + (chunk as string);
    let start = 0;
    let newline = text.indexOf('\n', start);
    while (newline !== -1) {
      take(text.slice(start, newline));
      start = newline + 1;
      newline = text.indexOf('\n', start);
    }
    carry = text.slice(start);
  }
  if (carry) take(carry);
}
