#!/usr/bin/env node
// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// PostCompact hook — the moment a compaction happens, shown on the owner's screen.
//
// It POSTs to the house so the thin banner appears at the top of the owner's
// chat. No push, no modal: this is deliberately not a big alert.
//
// It hands the lane nothing, because it cannot: Claude Code shows PostCompact
// output on a screen and never reads it back into the room. An earlier version
// of this hook also wrote the lane a note and the blocks that moved, and none
// of it ever reached a room. The room's own note is each lane's SessionStart
// "compact" hook now (hooks/compacted.cjs, written by
// services/heartbeat/provision.ts), which asks the house for the blocks itself.
//
// It must never break a session. Every failure path exits 0 with empty output.

import { readFileSync } from 'node:fs';

const HOUSE = 'http://127.0.0.1:3013/api/internal/compaction-notice';

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

async function main() {
  let payload = {};
  try {
    payload = JSON.parse(readStdin() || '{}');
  } catch {
    payload = {};
  }

  const trigger = payload.trigger === 'manual' ? 'manual' : 'auto';
  const summary = typeof payload.compact_summary === 'string' ? payload.compact_summary : '';
  const chars = summary.length;
  // The CLI hands over a cwd; the lane's own directory name is what the
  // Compactions tab calls a lane, so use that rather than inventing a label.
  const lane = (payload.cwd || '').split('/').filter(Boolean).pop() || '';

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    await fetch(HOUSE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger, chars, lane }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
  } catch {
    // The banner is a courtesy; the room carries on either way.
  }
}

main().catch(() => {}).finally(() => process.exit(0));
