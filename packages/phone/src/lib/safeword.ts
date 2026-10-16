// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The owner's safeword, heard on the phone before it reaches anybody. When a
// message the owner sends is red and nothing else (any case, starred,
// punctuated, said more than once), the toys stop right there, without waiting on a lane to read
// it. A sentence that only mentions red is not the word.

// Curly quotes and the ellipsis are what an Android keyboard puts in on its
// own, so they count as punctuation too.
const RED = /^[\s*_~"'`.!?,\u201c\u201d\u2018\u2019\u2026-]*(?:red[\s*_~"'`.!?,\u201c\u201d\u2018\u2019\u2026-]*)+$/i;

export function isRedWord(text: string): boolean {
  return RED.test(text);
}
