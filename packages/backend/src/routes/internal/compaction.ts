// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { Router } from 'express';
import { PROJECT_ROOT } from './local.js';
import { existsSync, readFileSync } from 'fs';
import { isHeartbeatLane } from '../../services/compaction-log.js';
import { join } from 'path';
import { getAllBlocks } from '../../services/memory-blocks.js';
import { driftAgainstBaseline, renderDrift, BASELINE_FILE } from '../../services/heartbeat/block-drift.js';
import { registry } from '../../services/ws.js';

const router = Router();

// The compaction notice — the one moment they could never see.
//
// When a CLI lane fills its window the tool squashes the conversation into a
// summary and hands it back wearing their voice, ending with an instruction not
// to acknowledge it. The record has always been in the transcript (see
// services/compaction-log.ts, and the Compactions tab that reads it), but the
// EVENT was silent: from their side a compaction and a dead lane are identical.
//
// The CLI fires a PostCompact hook at the moment it happens. That hook posts
// here. All this does is put the thin line at the top of their chat — the banner
// component and the `compaction_notice` message have both existed since the
// tab was built and nothing has ever sent one. Deliberately quiet: no push,
// no modal, and the banner takes itself away after a few seconds. Their call,
// Sep 7 2026: "I wouldn't want like a big alert about it."
router.post('/internal/compaction-notice', (req, res) => {
  const { trigger, chars, lane } = req.body ?? {};
  // Only the house's own lanes speak here. The hook fires for every Claude
  // session on the box, and a banner naming the Archivist's tmp folder read to
  // them as one of our rooms compacting when it was not (Oct 9 2026).
  if (!isHeartbeatLane(lane, PROJECT_ROOT)) {
    res.json({ success: true, skipped: 'not a lane', refresh: '' });
    return;
  }
  const squashed = Number.isFinite(Number(chars)) ? Number(chars) : 0;
  const where = typeof lane === 'string' && lane ? lane : 'this lane';
  const message = squashed
    ? `Context compacted in ${where} — ${squashed.toLocaleString()} characters squashed.`
    : `Context compacted in ${where}.`;
  registry.broadcast({
    type: 'compaction_notice',
    // preTokens is what the phone's protocol asks for; we are counting
    // characters of summary rather than tokens, so it stays 0 rather than
    // reporting a number in the wrong unit.
    preTokens: 0,
    message,
    isComplete: true,
    trigger: trigger === 'manual' ? 'manual' : 'auto',
  });
  res.json({ success: true, message, refresh: staleBlockText(where) });
});

// The walls that moved while a lane's room was open, for its own note after a
// squash. The lane's SessionStart hook (matcher "compact", hooks/compacted.cjs)
// asks here: that hook is the one place Claude Code reads words back into a
// room after a compaction. PostCompact output is display-only, so everything
// the hook above used to hand back never arrived (no note in eight squashes'
// transcripts, Oct 17 2026). No banner from here: the PostCompact hook still
// raises that, and one squash is one banner.
router.get('/internal/compaction-refresh', (req, res) => {
  const lane = typeof req.query.lane === 'string' ? req.query.lane : '';
  if (!isHeartbeatLane(lane, PROJECT_ROOT)) {
    res.json({ success: true, skipped: 'not a lane', refresh: '' });
    return;
  }
  res.json({ success: true, refresh: staleBlockText(lane) });
});

/**
 * What the walls say now, for a lane whose injected copy is about to be
 * replayed at it.
 *
 * A compaction hands the room the SAME CLAUDE.md attachment it opened with
 * rather than re-reading it — measured Sep 20 2026, byte-identical ten and a
 * half hours apart — so a block edited mid-room never reaches that room. The
 * lane's own file on disk is the baseline, because it is literally the copy
 * that was injected.
 *
 * Fails soft in every direction. A compaction that cannot be repaired is the
 * behaviour we already had; a compaction that throws is worse than useless.
 */
function staleBlockText(lane: string): string {
  try {
    if (!lane || lane === 'this lane' || !/^[A-Za-z0-9._-]+$/.test(lane)) return '';
    // NOT the lane's CLAUDE.md — the backend regenerates that, so it follows
    // the live blocks and can never disagree with them. The baseline is the
    // hash file the supervisor writes at launch.
    const path = join(PROJECT_ROOT, 'data', 'heartbeat', lane, 'io', BASELINE_FILE);
    if (!existsSync(path)) return '';
    const baseline = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
    const { changed, removed } = driftAgainstBaseline(baseline, getAllBlocks());
    return renderDrift(changed, removed);
  } catch {
    return '';
  }
}

export default router;
