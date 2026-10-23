// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { pipeWholeStream, wakeWholeStreamWaiters, wholeFromFinished, type WholeStreamPiece } from './tts-whole.js';

// MPEG-1 Layer III, 128 kbps, 44.1 kHz: 417-byte frames.
function frame(fill: number, tag = ''): Buffer {
  const buf = Buffer.alloc(417, fill);
  buf[0] = 0xff; buf[1] = 0xfb; buf[2] = 0x90; buf[3] = 0x64;
  if (tag) buf.write(tag, 36, 'latin1');
  return buf;
}

function piece(): WholeStreamPiece {
  return { chunks: [], byteLength: 0, state: 'pending', waiters: new Set() };
}

function push(p: WholeStreamPiece, chunk: Buffer): void {
  p.state = 'streaming';
  p.chunks.push(chunk);
  p.byteLength += chunk.length;
  wakeWholeStreamWaiters(p);
}

function finish(p: WholeStreamPiece): void {
  p.state = 'complete';
  wakeWholeStreamWaiters(p);
}

async function serve(pieces: WholeStreamPiece[]) {
  const server = createServer((req, res) => {
    void pipeWholeStream(
      pieces,
      res,
      () => { if (!res.headersSent) { res.writeHead(200, { 'content-type': 'audio/mpeg' }); } },
      (message) => { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: message })); },
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

test('pieces arrive as one stream, in order, while later pieces are still being made', async () => {
  const a = piece(); const b = piece(); const c = piece();
  const s = await serve([a, b, c]);
  try {
    const pending = fetch(s.url).then(async (res) => ({ status: res.status, body: Buffer.from(await res.arrayBuffer()) }));
    // The third piece finishes first, the way a short last voice can.
    push(c, frame(0xcc)); finish(c);
    push(a, frame(0, 'Info')); push(a, frame(0xaa));
    await new Promise((r) => setTimeout(r, 20));
    finish(a);
    push(b, frame(0xbb)); finish(b);
    const { status, body } = await pending;
    assert.equal(status, 200);
    assert.equal(body.length, 417 * 3);
    assert.equal(body[4], 0xaa);
    assert.equal(body[417 + 4], 0xbb);
    assert.equal(body[834 + 4], 0xcc);
  } finally {
    await s.close();
  }
});

test('a piece that fails before any audio answers 502, not a blank 200', async () => {
  const a = piece();
  const s = await serve([a]);
  try {
    const pending = fetch(s.url);
    await new Promise((r) => setTimeout(r, 10));
    a.state = 'error'; a.error = new Error('voice refused'); wakeWholeStreamWaiters(a);
    const res = await pending;
    assert.equal(res.status, 502);
    assert.match(await res.text(), /voice refused/);
  } finally {
    await s.close();
  }
});

test('a finished reply as one buffer leaves each piece\'s lead out', () => {
  const whole = wholeFromFinished([Buffer.concat([frame(0, 'Xing'), frame(1)]), Buffer.concat([frame(0, 'Info'), frame(2)])]);
  assert.equal(whole.length, 834);
  assert.equal(whole[4], 1);
  assert.equal(whole[417 + 4], 2);
});
