// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// The net under the app: what a fall reports, how often, and that the whole
// app actually stands on it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clientErrorReport, shouldReport } from './client-error.js';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('a fall reports what broke, where, and the component it broke in', () => {
  const error = new TypeError('text.replace is not a function');
  const report = clientErrorReport(error, '\n    at ThreadSwitcher', '/#chat');
  assert.equal(report.message, 'TypeError: text.replace is not a function');
  assert.match(report.stack, /TypeError/);
  assert.match(report.componentStack, /ThreadSwitcher/);
  assert.equal(report.where, '/#chat');
  assert.equal(clientErrorReport('a thrown string', null, '/').message, 'a thrown string');
  assert.equal(clientErrorReport(new Error('x'.repeat(900)), null, '/').message.length, 500);
});

test('one report per distinct fall, five at most per load', () => {
  const sent = new Set<string>();
  assert.equal(shouldReport('A', sent), true);
  assert.equal(shouldReport('A', sent), false, 'the same fall twice is one report');
  for (const m of ['B', 'C', 'D', 'E']) assert.equal(shouldReport(m, sent), true);
  assert.equal(shouldReport('F', sent), false, 'a sixth distinct fall is not sent');
});

test('the whole app stands on the net, and the net tells the house', () => {
  const main = read('../main.tsx');
  assert.match(main, /<AppErrorBoundary>\s*<AerieProvider>\s*<App \/>\s*<\/AerieProvider>\s*<\/AppErrorBoundary>/);
  const boundary = read('../components/AppErrorBoundary.tsx');
  assert.match(boundary, /static getDerivedStateFromError/);
  assert.match(boundary, /apiFetch\('\/api\/client-errors'/);
  assert.match(boundary, /window\.location\.reload\(\)/);
  assert.doesNotMatch(boundary, /backdrop-blur/);
});
