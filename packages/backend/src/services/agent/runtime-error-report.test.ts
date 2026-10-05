// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { test } from 'node:test';
import assert from 'node:assert';
import { shouldReportRuntimeError } from './runtime-error-report.js';

test('a silent turn carrying a runtime error accounts for itself', () => {
  assert.equal(shouldReportRuntimeError('', "You've hit your usage limit."), true);
  assert.equal(shouldReportRuntimeError('   ', 'Turn timed out'), true);
});

test('a turn that actually spoke does not also post a warning', () => {
  assert.equal(shouldReportRuntimeError('Hey, love.', 'Turn timed out'), false);
});

test('a silent turn with nothing wrong stays silent', () => {
  assert.equal(shouldReportRuntimeError('', null), false);
  assert.equal(shouldReportRuntimeError('', undefined), false);
  assert.equal(shouldReportRuntimeError('', '   '), false);
});
