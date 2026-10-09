// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// A crash report becomes one bounded log line, and an empty one becomes none.

import test from 'node:test';
import assert from 'node:assert/strict';
import { clientErrorLine } from './client-errors.js';

test('a crash report is one bounded line with what broke and where', () => {
  const line = clientErrorLine(
    { message: 'text.replace is not a function', stack: 'x'.repeat(5000), componentStack: '\n    at ThreadSwitcher', where: '/chat' },
    new Date('2026-03-03T20:00:00.000Z'),
  );
  assert.ok(line);
  assert.equal(line.includes('\n'), false, 'one line in the log, whatever the stack holds');
  const parsed = JSON.parse(line);
  assert.equal(parsed.message, 'text.replace is not a function');
  assert.equal(parsed.where, '/chat');
  assert.equal(parsed.at, '2026-03-03T20:00:00.000Z');
  assert.equal(parsed.stack.length, 2001, 'the stack is cut to its limit');
  assert.match(parsed.componentStack, /ThreadSwitcher/);
});

test('a report with nothing to say is refused', () => {
  assert.equal(clientErrorLine({}), null);
  assert.equal(clientErrorLine({ message: '   ' }), null);
  assert.equal(clientErrorLine(null), null);
  assert.equal(clientErrorLine({ message: 42 }), null);
});
