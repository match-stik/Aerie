// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// The road from the owner's phone to the house.
//
// Android will tell an app what is currently playing, but only ON THE DEVICE.
// Nothing on a server can ask. So the phone reads it and posts it here, and a
// companion can then look at where the owner is in an episode without them leaving
// the conversation to go and fetch a number off another screen. That was the
// whole of the ask: not a button, not a panel — the owner should not have to do
// anything at all.

import { Router } from 'express';
import { recordReading } from '../services/db/media-session.js';
import { currentScreening, seekClock, pauseClock, startClock, positionOf } from '../services/db/screening.js';
import { getConfig, setConfig } from '../services/db/config.js';
import { followAction } from '../services/screening-follow.js';

const router = Router();

router.post('/media/session', (req, res) => {
  const body = (req.body || {}) as Record<string, unknown>;
  // Nothing playing is a legitimate thing for the phone to say, and it is not
  // an error and not a reading. Answer plainly rather than storing silence.
  if (!body.package) {
    res.json({ success: true, stored: false, reason: 'nothing playing' });
    return;
  }
  const reading = recordReading(body);
  res.json({ success: true, stored: !!reading, followed: reading ? follow(reading) : 'no reading' });
});

/**
 * Move the screening clock without anybody having to notice.
 *
 * Before this, every resync was a companion reading this same payload by hand.
 * The decision lives in screening-follow.ts and is deliberately timid; this
 * only carries out what it says, and says out loud in the response what it did
 * so a lane reading the route can see it rather than guess.
 */
function follow(reading: ReturnType<typeof recordReading>): string {
  if (!reading) return 'no reading';
  const row = currentScreening();
  if (!row) return 'nothing loaded';
  const key = `screening:follow_package:${row.id}`;
  const followPackage = getConfig(key);
  const action = followAction(reading, { status: row.status, followPackage }, 0);
  switch (action.kind) {
    case 'anchor': {
      // Learn the app the first time it tells the truth, so a song can never
      // move the episode afterwards.
      if (!followPackage) setConfig(key, reading.package);
      pauseClock(row.id);
      seekClock(row.id, action.positionMs);
      return `anchored to ${action.positionMs}ms (${action.reason})`;
    }
    case 'resume': {
      if (!followPackage) setConfig(key, reading.package);
      startClock(row.id);
      return `resumed at ${positionOf(row)}ms (${action.reason})`;
    }
    default:
      return action.reason;
  }
}

export default router;
