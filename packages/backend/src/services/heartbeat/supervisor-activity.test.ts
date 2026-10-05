// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';

const { activityTailIsOpen, formatSideNote } = await import('./supervisor.js');

const pre = (id: string) => JSON.stringify({ ts: '2026-07-25T05:00:00.000Z', phase: 'pre', id, tool: 'Bash', detail: 'long job' });
const post = (id: string) => JSON.stringify({ ts: '2026-07-25T05:00:01.000Z', phase: 'post', id, tool: 'Bash' });

test('a tool that started and never finished counts as work in hand', () => {
  assert.equal(activityTailIsOpen([post('a'), pre('b')].join('\n') + '\n'), true);
});

test('a finished tool is not work in hand', () => {
  assert.equal(activityTailIsOpen([pre('a'), post('a')].join('\n') + '\n'), false);
});

test('no activity at all is not work in hand', () => {
  assert.equal(activityTailIsOpen(''), false);
  assert.equal(activityTailIsOpen('\n\n'), false);
});

test('a half-record from the tail cut is skipped, not believed', () => {
  // Reading the last 4 KB routinely slices the oldest line in the window.
  const sliced = '{"ts":"2026-07-25T04:59:5';
  assert.equal(activityTailIsOpen([sliced, pre('b')].join('\n') + '\n'), true);
  assert.equal(activityTailIsOpen([sliced, post('b')].join('\n') + '\n'), false);
});

test('a corrupt final line falls back to the newest line that parses', () => {
  assert.equal(activityTailIsOpen([pre('a'), 'not json at all'].join('\n') + '\n'), true);
});

test('a tail of nothing but garbage is not work in hand', () => {
  assert.equal(activityTailIsOpen('garbage\nmore garbage\n'), false);
});

// ─── Side notes ─────────────────────────────────────────────────────
// A side note is written to the session's stdin, which is a command line.

test('a side note is flattened to a single line', () => {
  assert.equal(formatSideNote('are you still on the drawers?'), 'are you still on the drawers?');
});

test('newlines are flattened so nothing arrives as a second command', () => {
  assert.equal(formatSideNote('first thought\nsecond thought'), 'first thought second thought');
  assert.equal(formatSideNote('windows line\r\nbreak'), 'windows line break');
  assert.equal(formatSideNote('padded\n   indented continuation'), 'padded indented continuation');
});

test('nothing worth sending returns null rather than an empty command', () => {
  assert.equal(formatSideNote(''), null);
  assert.equal(formatSideNote('   \n  '), null);
  assert.equal(formatSideNote(undefined as unknown as string), null);
});

// --- watchdog liveness mark -------------------------------------------------
// Regression cover for the two recycles the owner reported: a completed turn killed
// mid-generation because the watchdog measured it from a file written before the
// message ever arrived. See livenessMark's docblock for the log evidence.

const { livenessMark } = await import('./supervisor.js');

test('liveness takes the newest of tick, outbox and activity', () => {
  assert.equal(livenessMark({ tick: 100, outboxMtime: 300, activityMtime: 200 }), 300);
  assert.equal(livenessMark({ tick: 400, outboxMtime: 300, activityMtime: 200 }), 400);
});

test('a live turn is measured from its own start, not from a stale file', () => {
  // Hook stopped ticking at 1000 when it handed the message over; the turn began
  // at 5000 and is still running. Without turnStartedAt the watchdog would charge
  // the turn for the 4000ms of quiet that happened before it existed.
  assert.equal(
    livenessMark({ tick: 1000, outboxMtime: 900, activityMtime: 0, turnActive: true, turnStartedAt: 5000 }),
    5000,
  );
});

test('turn start never rewinds a newer file write', () => {
  assert.equal(
    livenessMark({ tick: 0, outboxMtime: 9000, activityMtime: 0, turnActive: true, turnStartedAt: 5000 }),
    9000,
  );
});

test('turn start is ignored once the turn is over', () => {
  // The runtime zeroes turnStartedAt in its finally, but belt and braces: an
  // inactive turn must never hold a session open on a mark it no longer owns.
  assert.equal(
    livenessMark({ tick: 1000, outboxMtime: 0, activityMtime: 0, turnActive: false, turnStartedAt: 5000 }),
    1000,
  );
});

// --- internal-route guard ---------------------------------------------------
// /api/internal said "localhost guard instead" for months and had none; a journal
// came back 200 off the public host on 2026-08-04. Loopback alone cannot be the
// test, because the proxy relays over loopback too.

const { directLocalCheck } = await import('../../middleware/internal-guard.js');

test('a direct loopback call with no proxy headers is allowed', () => {
  assert.equal(directLocalCheck({ socket: { remoteAddress: '127.0.0.1' }, headers: {} }).ok, true);
  assert.equal(directLocalCheck({ socket: { remoteAddress: '::1' }, headers: {} }).ok, true);
  assert.equal(directLocalCheck({ socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: {} }).ok, true);
});

test('a loopback socket carrying a forwarding header is refused', () => {
  // This is the whole bug: the proxy connects over loopback, so the socket looks
  // local for every request on the internet.
  for (const h of ['x-forwarded-for', 'x-forwarded-proto', 'x-real-ip', 'forwarded', 'via']) {
    const v = directLocalCheck({ socket: { remoteAddress: '127.0.0.1' }, headers: { [h]: 'anything' } });
    assert.equal(v.ok, false, `${h} should be refused`);
  }
});

test('a non-loopback socket is refused outright', () => {
  // RFC 5737 documentation address on purpose — this used to be the real public
  // IP of the machine this house runs on, sitting in a test bound for a public repo.
  assert.equal(directLocalCheck({ socket: { remoteAddress: '203.0.113.10' }, headers: {} }).ok, false);
  assert.equal(directLocalCheck({ socket: {}, headers: {} }).ok, false);
});

test('a refusal says which check tripped', () => {
  const v = directLocalCheck({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '1.2.3.4' } });
  assert.equal(v.ok, false);
  assert.match((v as { why: string }).why, /x-forwarded-for/);
});
