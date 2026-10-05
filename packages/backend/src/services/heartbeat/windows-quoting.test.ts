// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// SOL HAS BEEN ANSWERING "B" TO EVERY FRESH SESSION SINCE HE MOVED IN.
//
// Rose and Sol, Sep 17 2026. On Windows the CLI is a .cmd shim, so the spawn
// needs a shell — and `shell: true` makes Node join the argument array into one
// command line with no quoting. The launch prompt is the last positional
// argument, so the shell splits it at its first space and the CLI receives a
// single word: `A` from INITIAL_PROMPT, `This` from RESUME_PROMPT. Their
// companion has been greeted with the letter A for weeks and has been answering
// B, because he thought it was a game.
//
// This house is Linux and cannot exercise that path. What can be tested is the
// rule, which is the documented CreateProcess one — so that is what is tested,
// and the branch it guards is Windows-only.

import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteForWindowsShell as q } from './supervisor.js';

test('an argument with nothing special in it is left alone', () => {
  assert.equal(q('--model'), '--model');
  assert.equal(q('claude-opus-5'), 'claude-opus-5');
  assert.equal(q('--dangerously-skip-permissions'), '--dangerously-skip-permissions');
});

test('a prompt survives as ONE argument — the whole bug', () => {
  const prompt = 'A new session. Read the room and say something true.';
  const quoted = q(prompt);
  assert.ok(quoted.startsWith('"') && quoted.endsWith('"'), 'it is wrapped');
  assert.equal(quoted.slice(1, -1), prompt, 'and nothing inside it changed');
  assert.ok(!/(^|[^\\])"/.test(quoted.slice(1, -1)), 'no bare quote can end it early');
});

test('a quote inside is escaped rather than closing the argument', () => {
  assert.equal(q('he said "go"'), '"he said \\"go\\""');
});

test('backslashes are doubled only where they would eat the quote', () => {
  assert.equal(q('C:\\path\\'), 'C:\\path\\', 'no whitespace, so it is untouched');
  assert.equal(q('C:\\a path\\'), '"C:\\a path\\\\"', 'a trailing run before the closing quote doubles');
  assert.equal(q('a\\"b c'), '"a\\\\\\"b c"');
});

test('an empty argument stays an argument', () => {
  // Dropping it would silently shift every positional after it.
  assert.equal(q(''), '""');
});

test('shell metacharacters do not reach the shell', () => {
  for (const arg of ['a & b', 'a | b', 'a > b', 'a ^ b', '100%', 'a!b']) {
    assert.ok(q(arg).startsWith('"'), `${arg} must be quoted`);
  }
});
