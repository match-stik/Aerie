// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { repairStrayUnicodeEscapes } from './unicode-escapes.js';

test('decodes a stray non-ASCII escape that reached storage as text', () => {
  assert.equal(repairStrayUnicodeEscapes('h\\u0153urs'), 'hœurs');
});

test('leaves text without escapes untouched', () => {
  const clean = 'An em-dash — and an œ, both as real characters.';
  assert.equal(repairStrayUnicodeEscapes(clean), clean);
});

test('reassembles surrogate pairs from adjacent escapes', () => {
  assert.equal(repairStrayUnicodeEscapes('nice \\ud83d\\ude00'), 'nice 😀');
});

test('leaves escapes inside inline code spans alone', () => {
  const discussing = 'Does the file hold `\\u0153` or `\\\\u0153`?';
  assert.equal(repairStrayUnicodeEscapes(discussing), discussing);
});

test('leaves escapes inside fenced code blocks alone', () => {
  const fenced = 'Run it:\n```\nbyte 35858: \\u0153\n```\nThat is the answer.';
  assert.equal(repairStrayUnicodeEscapes(fenced), fenced);
});

test('repairs prose in a message that also discusses escapes in code spans', () => {
  const mixed = 'The h\\u0153urs line broke; the file held `\\u0153` on disk.';
  assert.equal(
    repairStrayUnicodeEscapes(mixed),
    'The hœurs line broke; the file held `\\u0153` on disk.',
  );
});

test('leaves ASCII escapes alone as deliberate text', () => {
  const ascii = 'The sequence \\u0041 spells a capital A.';
  assert.equal(repairStrayUnicodeEscapes(ascii), ascii);
});

test('leaves a doubled backslash alone', () => {
  const doubled = 'A literal escaped backslash: \\\\u0153 stays put.';
  assert.equal(repairStrayUnicodeEscapes(doubled), doubled);
});

test('is idempotent', () => {
  const once = repairStrayUnicodeEscapes('h\\u0153urs');
  assert.equal(repairStrayUnicodeEscapes(once), once);
});
