// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Which row in the model picker wears the tick. The same model can be listed
// under two lanes (the SDK and the warm CLI lane, for Claude and for Codex),
// and matching on the model id alone ticked both (found Nov 26 2026). The row
// that is current is the one on the lane the house is actually routing to.

/** The provider a routing setting runs on, or '' when routing does not pin one. */
export function providerForRouting(routing: string | null | undefined): string {
  switch (routing) {
    case 'cli': return 'claude-cli';
    case 'sdk': return 'anthropic';
    case 'codex-cli': return 'codex-cli';
    default: return '';
  }
}

export function isCurrentModelRow(
  row: { id: string; provider: string },
  currentModel: string,
  routing: string | null | undefined,
): boolean {
  if (row.id !== currentModel) return false;
  const lane = providerForRouting(routing);
  // Routing that pins no lane (auto, a router) can only be matched by id.
  return lane ? row.provider === lane : true;
}
