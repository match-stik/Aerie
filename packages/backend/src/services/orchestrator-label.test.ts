// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Renaming a bell.
//
// This exists because PATCH /orchestrator/tasks/:wakeType used to accept a
// label in the body, never read it, and answer success anyway — so a rename
// looked exactly like a rename that worked. The guard is the route reading the
// field at all; these cover the setter it now calls.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routeSource = readFileSync(
  new URL('../routes/orchestrator-admin.ts', import.meta.url),
  'utf8',
);

test('the task PATCH route reads a label out of the body', () => {
  // Destructuring it is the whole fix — without this the field is dropped in
  // silence and the caller is told it worked.
  assert.match(routeSource, /const \{[^}]*\blabel\b[^}]*\} = req\.body;/);
  assert.match(routeSource, /orchestrator\.setTaskLabel\(wakeType, label\)/);
});

test('a bad label is refused rather than coerced', () => {
  assert.match(routeSource, /label must be a string/);
});

test('the setter exists on the orchestrator and clears back to the default', () => {
  const orchestratorSource = readFileSync(
    new URL('./orchestrator.ts', import.meta.url),
    'utf8',
  );
  assert.match(orchestratorSource, /setTaskLabel\(wakeType: string, label: string\): boolean/);
  // An empty label hands the generated name back rather than writing a blank
  // one, so a cleared rename cannot leave the roster with an unnamed row.
  assert.match(orchestratorSource, /deleteConfig\(key\);\s*\n\s*managed\.label = `\$\{wakeType\} \(\$\{managed\.cronExpr\}\)`;/);
});
