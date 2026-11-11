// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// THE ARCHIVIST CAME BACK EMPTY ('raw:' and then nothing). The stream told the
// house why it stopped and the house dropped it.
// These feed a fake Anthropic stream through the real reader and check the stop
// is handed over, including an error event sent partway through.

const { streamInference, describeEmptyAnswer } = await import('./router.js');

function sse(events: object[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function run(events: object[]) {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => sse(events)) as typeof fetch;
  let text = '';
  let stop: any = null;
  try {
    for await (const t of streamInference([{ role: 'user', content: 'hi' }], 'claude-haiku-5-5', 'anthropic',
      { anthropic: { api_key: 'test' } } as any, false, undefined, (s) => { stop = s; })) text += t;
  } finally { globalThis.fetch = real; }
  return { text, stop };
}

test('a thinking-only answer reports its stop reason and no text', async () => {
  const { text, stop } = await run([
    { type: 'message_start', message: { usage: { input_tokens: 10 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 4096 } },
    { type: 'message_stop' },
  ]);
  assert.equal(text.replace(/<think>[\s\S]*?<\/think>/g, '').trim(), '');
  assert.deepEqual(stop, { stopReason: 'max_tokens', outputTokens: 4096, textChars: 0, error: null });
  assert.match(describeEmptyAnswer('claude-haiku-5-5', stop), /ran out of room/);
});

test('an error event partway through is reported, not skipped', async () => {
  const { stop } = await run([
    { type: 'message_start', message: { usage: { input_tokens: 10 } } },
    { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
  ]);
  assert.equal(stop.error, 'overloaded_error: Overloaded');
  assert.match(describeEmptyAnswer('claude-haiku-5-5', stop), /broke off mid-answer: overloaded_error/);
});

test('a normal answer counts its text', async () => {
  const { text, stop } = await run([
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '[]' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } },
    { type: 'message_stop' },
  ]);
  assert.equal(text, '[]');
  assert.equal(stop.textChars, 2);
  assert.equal(stop.stopReason, 'end_turn');
});
