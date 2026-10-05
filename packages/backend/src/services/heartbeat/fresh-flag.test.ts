// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';

const { HeartbeatSession } = await import('./supervisor.js');

// The lane dir is derived from the key inside the constructor, so the test
// makes a real (throwaway) one — the flag is a FILE, and a write into a
// missing directory is swallowed, which would make every assertion below pass
// for the wrong reason.
const KEY = 'test-fresh-flag';
const PROJECT_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const LANE_IO = join(PROJECT_ROOT, 'data', 'heartbeat', KEY, 'io');

function freshSession() {
  rmSync(join(PROJECT_ROOT, 'data', 'heartbeat', KEY), { recursive: true, force: true });
  mkdirSync(LANE_IO, { recursive: true });
  return new HeartbeatSession(KEY);
}

// armFreshFlag is private on purpose — every write of `.fresh` goes through
// one door so the suppression cannot be bypassed. The test drives that door
// directly because the two real callers are a process exit and a spawn.
const arm = (s: InstanceType<typeof HeartbeatSession>) => (s as any).armFreshFlag();

test.after(() => {
  rmSync(join(PROJECT_ROOT, 'data', 'heartbeat', KEY), { recursive: true, force: true });
});

test('a launch arms the flag and the next turn consumes it', () => {
  const s = freshSession();
  arm(s);
  assert.equal(existsSync(join(LANE_IO, '.fresh')), true);
  assert.equal(s.consumeFreshFlag(), true);
  assert.equal(s.consumeFreshFlag(), false, 'one arming is one prime');
});

test('a prime queued in the inbox silences the arming that follows it', () => {
  const s = freshSession();
  s.markPrimedIntoInbox();
  arm(s);
  assert.equal(existsSync(join(LANE_IO, '.fresh')), false);
  assert.equal(s.consumeFreshFlag(), false);
});

test('the silence lasts exactly one turn, not forever', () => {
  const s = freshSession();
  s.markPrimedIntoInbox();
  arm(s);
  assert.equal(s.consumeFreshFlag(), false);
  // A later genuine recycle must still prime — this is the failure the
  // suppression could cause, so it is the one worth pinning.
  arm(s);
  assert.equal(s.consumeFreshFlag(), true);
});

test('a turn clears a queued prime even when nothing armed in between', () => {
  const s = freshSession();
  s.markPrimedIntoInbox();
  assert.equal(s.consumeFreshFlag(), false);
  arm(s);
  assert.equal(s.consumeFreshFlag(), true);
});

test('a refused model draws one recycle chip, not two', () => {
  // The incident, in order: the owner's model change relaunches the lane; the turn
  // waits for that launch, consumes its flag and writes the history into the
  // inbox; that session is refused at the door and dies; its successor
  // launches and READS the primed message. Before this, the exit and the
  // second launch each re-armed the flag and the next turn drew a second chip
  // for a birth that had already been primed.
  const s = freshSession();
  arm(s);                                    // launch #1 (the doomed one)
  assert.equal(s.consumeFreshFlag(), true);  // the turn primes — chip 1
  s.markPrimedIntoInbox();                   // history is now in the inbox
  arm(s);                                    // session #1 exits
  arm(s);                                    // launch #2 reads the primed msg
  assert.equal(s.consumeFreshFlag(), false, 'the successor arrived already primed');
  // And the lane is not left deaf afterwards.
  arm(s);
  assert.equal(s.consumeFreshFlag(), true);
});
