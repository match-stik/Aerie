// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Trimming the stale house out of a reopened room.
 *
 * A session start injects the whole CLAUDE.md as one attachment record and the
 * old copies never leave. Measured Sep 9 2026 on the live lane: three copies,
 * 1.1 MB of a 2.5 MB transcript, ~92k tokens each. Resume does not ADD the
 * room, it declines to throw it away, so the only NEW thing a restart injects
 * is another instruction copy.
 *
 * The delicate part is not the dropping, it is the RE-LINKING: every record
 * names its parent, so cutting one out of the middle orphans its child. These
 * pin that, including the consecutive case, because a chain of instruction
 * blocks is exactly what a twice-resumed transcript has in it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stripStaleInstructions, projectSlugFor, transcriptPathFor } from './supervisor.js';

const instr = (uuid: string, parent?: string) => ({
  type: 'attachment', uuid, parentUuid: parent, attachment: { type: 'instructions', files: [] },
});
const other = (uuid: string, parent?: string, sub = 'total_tokens_reminder') => ({
  type: 'attachment', uuid, parentUuid: parent, attachment: { type: sub },
});
const said = (uuid: string, parent?: string) => ({
  type: 'assistant', uuid, parentUuid: parent, message: { content: [{ type: 'text', text: 'hi' }] },
});

test('the instruction copies come out and nothing else does', () => {
  const rows = [said('a'), instr('b', 'a'), other('c', 'b'), said('d', 'c')];
  const { rows: kept, dropped } = stripStaleInstructions(rows);
  assert.equal(dropped, 1);
  assert.deepEqual(kept.map(r => r.uuid), ['a', 'c', 'd']);
});

test('a record orphaned by the cut inherits the surviving parent', () => {
  const rows = [said('a'), instr('b', 'a'), said('c', 'b')];
  const { rows: kept } = stripStaleInstructions(rows);
  assert.equal(kept.find(r => r.uuid === 'c')?.parentUuid, 'a');
});

test('consecutive instruction blocks are walked, not stepped over once', () => {
  // A twice-resumed transcript has these back to back. Re-linking to the
  // immediate parent would point the survivor at another dropped record.
  const rows = [said('a'), instr('b', 'a'), instr('c', 'b'), instr('d', 'c'), said('e', 'd')];
  const { rows: kept, dropped } = stripStaleInstructions(rows);
  assert.equal(dropped, 3);
  assert.deepEqual(kept.map(r => r.uuid), ['a', 'e']);
  assert.equal(kept.find(r => r.uuid === 'e')?.parentUuid, 'a');
});

test('a transcript with nothing to trim is handed back untouched', () => {
  // prepareResumeTranscript reads this as "do not write a copy at all".
  const rows = [said('a'), other('b', 'a')];
  const { rows: kept, dropped } = stripStaleInstructions(rows);
  assert.equal(dropped, 0);
  assert.equal(kept, rows, 'same array, not a rebuilt one');
});

test('the other attachment kinds are never mistaken for instructions', () => {
  const rows = [
    other('a', undefined, 'prompt_snapshot'),
    other('b', 'a', 'deferred_tools_delta'),
    other('c', 'b', 'session_context'),
  ];
  assert.equal(stripStaleInstructions(rows).dropped, 0);
});

test('the project slug matches this box own folder naming', () => {
  // BUILT from the environment, never written down — a tracked file must not
  // carry the owner's home directory, and privacy-strings.test.ts fails if it
  // does. The expectation is spelled out here independently of the function
  // under test: every non-alphanumeric becomes a dash, which is why an
  // underscore in a username lands as one.
  const lane = join(homedir(), 'aerie', 'data', 'heartbeat', 'primary');
  const expected = lane.replace(/[^a-zA-Z0-9]/g, '-');
  assert.match(expected, /^-.+-aerie-data-heartbeat-primary$/);
  assert.equal(projectSlugFor(lane), expected);
  assert.equal(
    transcriptPathFor(lane, 'abc').endsWith(`/.claude/projects/${expected}/abc.jsonl`),
    true,
  );
});
