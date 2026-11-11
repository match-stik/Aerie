// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
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
  // The incident, in order: their person's model change relaunches the lane; the turn
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

// Found and reported by Sol (Oct 31 2026): the suppression used to last until
// the next TURN, so a room that read the prime and then died before any turn
// came left its successor unprimed, and the successor's first turn saw a new
// room with no .fresh and handed the whole window as missed. The suppression
// now lasts only while the prime is actually unread: bytes in the inbox past
// the hook's offset. Unknown still suppresses, which keeps the tests above.
function inbox(bytes: string, offset: number | string | null) {
  writeFileSync(join(LANE_IO, 'inbox.jsonl'), bytes);
  if (offset === null) rmSync(join(LANE_IO, '.inbox-offset'), { force: true });
  else writeFileSync(join(LANE_IO, '.inbox-offset'), String(offset));
}

test('a prime the hook has already read does not silence the next room', () => {
  const s = freshSession();
  s.markPrimedIntoInbox();
  const line = '{"primed":true}\n';
  inbox(line, Buffer.byteLength(line));      // the room read it, then died
  arm(s);                                    // the new room launches
  assert.equal(s.consumeFreshFlag(), true, 'the new room never saw the prime');
});

test('a prime still unread keeps the suppression', () => {
  const s = freshSession();
  s.markPrimedIntoInbox();
  inbox('{"primed":true}\n', 0);            // nobody has read it yet
  arm(s);
  assert.equal(s.consumeFreshFlag(), false);
});

test('an unreadable offset keeps the suppression', () => {
  const s = freshSession();
  s.markPrimedIntoInbox();
  inbox('{"primed":true}\n', 'garbage');
  arm(s);
  assert.equal(s.consumeFreshFlag(), false);
  const t = freshSession();
  t.markPrimedIntoInbox();
  inbox('{"primed":true}\n', null);
  arm(t);
  assert.equal(t.consumeFreshFlag(), false);
});
