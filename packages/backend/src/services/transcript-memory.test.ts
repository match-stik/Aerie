// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The two readers that run at the end of every heartbeat turn, the context
// meter and the turn's usage row, must never hold a whole transcript at once.
// Oct 21 2026: a live room's transcript had reached 159 MB, both readers read
// it whole and split it after every turn, the backend's 2 GB heap went from
// about half a gig to nearly all of it each time, and once it went past.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createWriteStream, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const LINES = 40_000;

// About 2 KB a line with one emoji in each, so reading the file whole decodes
// to a two-byte string of about 160 MB, far past the child's 64 MB heap.
async function writeTranscript(path: string): Promise<void> {
  const pad = 'x'.repeat(2000);
  const out = createWriteStream(path);
  for (let i = 0; i < LINES; i++) {
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: new Date(Date.UTC(2026, 9, 21) + i).toISOString(),
      requestId: `req_${i}`,
      message: {
        id: `msg_${i}`,
        model: 'claude-opus-5-5',
        usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 },
        content: [{ type: 'text', text: `🔥 ${pad}` }],
      },
    }) + '\n';
    if (!out.write(line)) await new Promise<void>((resolve) => out.once('drain', () => resolve()));
  }
  await new Promise<void>((resolve, reject) => {
    out.once('error', reject);
    out.end(() => resolve());
  });
}

test('the turn-end readers count a transcript bigger than their own heap', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'transcript-memory-'));
  try {
    const transcript = join(dir, 'room.jsonl');
    await writeTranscript(transcript);
    const child = join(dir, 'child.mjs');
    writeFileSync(child, [
      `const { readSessionUsage } = await import(${JSON.stringify(pathToFileURL(join(HERE, 'agent', 'session-list.ts')).href)});`,
      `const { usageSinceFile } = await import(${JSON.stringify(pathToFileURL(join(HERE, 'heartbeat', 'turn-usage.ts')).href)});`,
      'const path = process.argv[2];',
      'const meter = await readSessionUsage(path, 1, 1);',
      'const turn = await usageSinceFile(path, 0);',
      'process.stdout.write(JSON.stringify({ meter, turn }));',
    ].join('\n'));
    const run = spawnSync(process.execPath, ['--max-old-space-size=64', '--import', 'tsx', child, transcript], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 1 << 20,
    });
    assert.equal(run.status, 0, `the child died (status ${run.status}, signal ${run.signal}): ${String(run.stderr).slice(-300)}`);
    const { meter, turn } = JSON.parse(run.stdout);
    assert.equal(meter.replies, LINES);
    assert.equal(meter.inputTokens, LINES);
    assert.equal(meter.outputTokens, 2 * LINES);
    assert.equal(meter.contextTokens, 1 + 3 + 4);
    assert.equal(turn.requests, LINES);
    assert.equal(turn.outputTokens, 2 * LINES);
    assert.equal(turn.cacheWriteTokens, 4 * LINES);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
