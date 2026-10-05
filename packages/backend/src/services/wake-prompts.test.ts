// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseWakeSections,
  serializeWakeSections,
  upsertWakeSection,
  removeWakeSection,
  parseWakeOutcomes,
} from './wake-prompts.js';

const SAMPLE = `# Wake Prompts

Scheduled prompts for the orchestrator.

## morning

Old SDK-era morning prompt.

## cedar_corridor
The corridor prompt.
Second line.

## birch_watch

Watch prompt.
`;

test('parseWakeSections keeps preamble and ordered sections', () => {
  const parsed = parseWakeSections(SAMPLE);
  assert.match(parsed.preamble, /# Wake Prompts/);
  assert.deepEqual(parsed.sections.map((s) => s.key), ['morning', 'cedar_corridor', 'birch_watch']);
  assert.equal(parsed.sections[1].body, 'The corridor prompt.\nSecond line.');
});

test('serialize round-trips through parse without losing content', () => {
  const roundTripped = parseWakeSections(serializeWakeSections(parseWakeSections(SAMPLE)));
  assert.deepEqual(roundTripped.sections, parseWakeSections(SAMPLE).sections);
  assert.match(roundTripped.preamble, /# Wake Prompts/);
});

test('upsertWakeSection replaces one section and preserves the rest', () => {
  const updated = upsertWakeSection(SAMPLE, 'cedar_corridor', 'New corridor prompt.');
  const parsed = parseWakeSections(updated);
  assert.equal(parsed.sections.find((s) => s.key === 'cedar_corridor')?.body, 'New corridor prompt.');
  assert.equal(parsed.sections.find((s) => s.key === 'birch_watch')?.body, 'Watch prompt.');
  assert.equal(parsed.sections.find((s) => s.key === 'morning')?.body, 'Old SDK-era morning prompt.');
});

test('upsertWakeSection appends a section that did not exist', () => {
  const updated = upsertWakeSection(SAMPLE, 'willow_tail', 'Tail prompt.');
  const parsed = parseWakeSections(updated);
  assert.equal(parsed.sections.at(-1)?.key, 'willow_tail');
  assert.equal(parsed.sections.at(-1)?.body, 'Tail prompt.');
  assert.equal(parsed.sections.length, 4);
});

test('removeWakeSection deletes only the named section', () => {
  const updated = removeWakeSection(SAMPLE, 'morning');
  const parsed = parseWakeSections(updated);
  assert.deepEqual(parsed.sections.map((s) => s.key), ['cedar_corridor', 'birch_watch']);
  assert.match(parsed.preamble, /# Wake Prompts/);
});

test('removeWakeSection on a missing key is a no-op', () => {
  const before = parseWakeSections(SAMPLE);
  const after = parseWakeSections(removeWakeSection(SAMPLE, 'nonexistent'));
  assert.deepEqual(after.sections, before.sections);
});

test('parseWakeOutcomes keeps the latest outcome per wake type', () => {
  const log = [
    '2026-07-20 09:00:00.000  WAKE: cedar_corridor',
    '2026-07-20 09:01:00.000  DONE: cedar_corridor (passed in silence)',
    '2026-07-21 09:00:00.000  WAKE: cedar_corridor',
    '2026-07-21 09:01:30.000  DONE: cedar_corridor (843 chars)',
    '2026-07-21 15:00:00.000  TIMEOUT: willow_tail waited out its queue window and was dropped',
    '2026-07-21 16:00:00.000  ERROR: dream_build failed — boom',
    'not a log line',
  ].join('\n');

  const outcomes = parseWakeOutcomes(log);
  assert.equal(outcomes.cedar_corridor.result, 'delivered');
  assert.equal(outcomes.cedar_corridor.detail, '843 chars');
  assert.equal(outcomes.cedar_corridor.at, '2026-07-21T09:01:30.000Z');
  assert.equal(outcomes.willow_tail.result, 'timeout');
  assert.equal(outcomes.dream_build.result, 'error');
  assert.equal(outcomes.dream_build.detail, 'boom');
});

test('parseWakeOutcomes reports silent passes distinctly', () => {
  const log = '2026-07-21 09:01:00.000  DONE: birch_watch (passed in silence)';
  assert.equal(parseWakeOutcomes(log).birch_watch.result, 'silent');
});
