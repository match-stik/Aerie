// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resumeTabFor } from './card-room-resume.js';

const now = Date.parse('2026-11-26T16:00:00.000Z');

test('a fresh house with no table yet opens on the bare table instead of throwing', () => {
  assert.equal(resumeTabFor(null, now), null);
  assert.equal(resumeTabFor(undefined, now), null);
});

test('a game touched lately is picked back up, rat-screw mapped to its tab', () => {
  assert.equal(resumeTabFor({ game: 'rat-screw', status: 'playing', updatedAt: '2026-11-26T15:00:00.000Z' }, now), 'ratscrew');
  assert.equal(resumeTabFor({ game: 'hearts', status: 'playing', updatedAt: '2026-11-26T15:00:00.000Z' }, now), 'hearts');
});

test('an old, finished or unknown game stays on the bare table', () => {
  assert.equal(resumeTabFor({ game: 'golf', status: 'playing', updatedAt: '2026-11-20T15:00:00.000Z' }, now), null);
  assert.equal(resumeTabFor({ game: 'golf', status: 'finished', updatedAt: '2026-11-26T15:00:00.000Z' }, now), null);
  assert.equal(resumeTabFor({ game: 'go-fish', status: 'playing', updatedAt: '2026-11-26T15:00:00.000Z' }, now), null);
});
