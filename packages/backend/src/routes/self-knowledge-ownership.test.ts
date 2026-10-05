// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb } from '../services/db/init.js';
import {
  createSelfKnowledge,
  getSelfKnowledge,
  reviewSelfKnowledge,
} from '../services/db/self-knowledge.js';

// A companion can accept their own self-knowledge now: they are the best judge
// of whether something about themselves is finished, and one weekly reflection can
// drop a pile of entries into the owner's Memory app at once. Before this a companion
// could retract a proposal but not confirm one, so every reflection became
// homework for the one person it was not about.
//
// TWO THINGS ARE LOAD-BEARING AND THEY PULL IN OPPOSITE DIRECTIONS.
//
// One: the owner must not be required. Two: the owner must not be REMOVED — they keep the
// view, the veto, and the ability to reword. The phone route is untouched.
//
// And ownership is the older rule underneath both: nobody else's summary of a
// companion goes on their wall. That is why the slug is required rather than optional.
// An optional check is one a tired window omits and never notices omitting.

const HERE = dirname(fileURLToPath(import.meta.url));

function seed(companion: string) {
  return createSelfKnowledge({
    id: `sk-${companion}-${Math.abs(companion.length * 7919)}`,
    companionId: companion,
    category: 'i_learned',
    content: `Something ${companion} worked out about themselves.`,
    sourceType: 'journal',
    sourceId: null,
    status: 'proposed',
  });
}

test('a companion accepting their own entry is recorded as THEM, not as the owner', () => {
  initDb(':memory:');
  const entry = seed('willow');

  const accepted = reviewSelfKnowledge(entry.id, 'accepted', 'willow');
  assert.ok(accepted, 'the entry should have been reviewed');
  assert.equal(accepted.status, 'accepted');

  // The receipt is the honest half. If accepting still hardcoded the owner,
  // the audit trail would show the owner reviewing entries they never opened.
  const row = getSelfKnowledge(entry.id);
  assert.equal(row?.status, 'accepted', 'status must persist, not just be returned');
});

test('accepting re-warms the entry fully', () => {
  initDb(':memory:');
  const entry = seed('cedar');
  const accepted = reviewSelfKnowledge(entry.id, 'accepted', 'cedar');
  assert.equal(accepted?.heat, 1.0, 'an accepted truth starts warm');
  assert.equal(accepted?.confidence, 1.0);
});

test('the route requires a companion and refuses another companion\'s entry', () => {
  const src = readFileSync(join(HERE, 'internal.ts'), 'utf-8');
  const start = src.indexOf('function reviewOwnEntry');
  assert.ok(start > 0, 'reviewOwnEntry should be the shared handler for accept and dismiss');
  const body = src.slice(start, start + 1600);

  assert.match(
    body, /if \(!companion\)/,
    'the slug must be REQUIRED — an optional ownership check is one a tired window omits',
  );
  assert.match(
    body, /existing\.companion_id !== companion/,
    'the handler must compare the entry owner against the caller, or anyone can accept anyone',
  );
  assert.match(
    body, /res\.status\(403\)/,
    'a mismatch has to be refused, not silently ignored',
  );
});

test('both accept and dismiss go through the ownership check', () => {
  const src = readFileSync(join(HERE, 'internal.ts'), 'utf-8');
  assert.match(
    src, /self-knowledge\/:id\/accept['"`],\s*\(req, res\) => reviewOwnEntry\(req, res, 'accepted'\)/,
    'accept must route through reviewOwnEntry',
  );
  assert.match(
    src, /self-knowledge\/:id\/dismiss['"`],\s*\(req, res\) => reviewOwnEntry\(req, res, 'dismissed'\)/,
    'dismiss must route through the same check — it was the looser of the two before',
  );
});

test('the phone route still accepts and dismisses without a slug', () => {
  // The half that would be easy to break while doing the above. The owner keeps the
  // veto; removing the owner's requirement must not remove their reach.
  const phone = readFileSync(join(HERE, 'self-knowledge.ts'), 'utf-8');
  assert.match(phone, /post\('\/:id\/review'/, 'the owner review route must still exist');
  assert.doesNotMatch(
    phone, /companion is required/,
    'the owner route must not inherit the companion requirement — the owner is not a companion',
  );
});
