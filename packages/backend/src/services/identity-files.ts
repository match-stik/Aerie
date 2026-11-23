// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// What the Runtime app shows as the identity file. It used to look only at
// the single-companion CLAUDE.md (agent.claude_md_path), which a house with
// companions never has, so it read "not found" while every lane was loading
// companions/<slug>.md and the _shared.md beside it.
import { basename, dirname, join } from 'node:path';

/** One line naming the files the lanes really load, or null when there are none. */
export function identityFilesLine(
  personaPaths: string[],
  legacyCandidates: string[],
  exists: (path: string) => boolean,
): string | null {
  if (personaPaths.length === 0) return legacyCandidates.find((p) => exists(p)) || null;
  const byDir = new Map<string, string[]>();
  for (const p of personaPaths) {
    const dir = dirname(p);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(p);
  }
  const parts: string[] = [];
  for (const [dir, paths] of byDir) {
    const names: string[] = [];
    const shared = join(dir, '_shared.md');
    if (exists(shared)) names.push('_shared.md');
    for (const p of paths) names.push(exists(p) ? basename(p) : `${basename(p)} (missing)`);
    parts.push(`${dir}/ ${names.join(', ')}`);
  }
  return parts.join('; ');
}
