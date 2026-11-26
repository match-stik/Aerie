// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Which thread the app opens on a fresh connect. The house names one; when it
// names none, the first thread in the list used to win, and on a brand-new
// house that was the companions' Treehouse, so the first hello landed in their
// room (found Nov 26 2026, walking a fresh install of the kit). The Treehouse
// is only ever opened on purpose.

export interface OpeningThreadSummary {
  id: string;
  type?: string | null;
}

export function openingThreadId(serverPick: string | null | undefined, threads: OpeningThreadSummary[]): string | null {
  if (serverPick) return serverPick;
  return threads.find((t) => t.type !== 'treehouse')?.id ?? null;
}
