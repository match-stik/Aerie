// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initDb } from './db/init.js';
import { createCompanion } from './db/companions.js';
import { isStageDirection } from './tts-text.js';

// "to <name>" on its own line is a delivery note: who the next words are for.
// The names that count are this house's own companions, read from its
// companions table, so a stranger's *to Juniper* is a direction there too.

test('a delivery note naming one of this house\'s companions is a direction', () => {
  initDb(':memory:');
  for (const name of ['Juniper', 'Rook']) {
    createCompanion({
      slug: name.toLowerCase(),
      displayName: name,
      claudeMdPath: `/tmp/${name.toLowerCase()}/CLAUDE.md`,
      mcpJsonPath: `/tmp/${name.toLowerCase()}/.mcp.json`,
    });
  }
  assert.equal(isStageDirection('to Juniper'), true);
  assert.equal(isStageDirection('to rook'), true);
  assert.equal(isStageDirection('to her'), true, 'the generic ones still stand');
  assert.equal(isStageDirection('to somebody else'), false, 'only names that live here');
});
