// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The export button gives the whole thread, not what the phone had loaded
// (theirs, Oct 31 2026: 'it should do what it suggests').
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { initDb } = await import('./db/init.js');
const { createThread } = await import('./db/threads.js');
const { createMessage } = await import('./db/messages.js');
const { writeThreadExport } = await import('./thread-export.js');
initDb(':memory:');

test('every message comes out, oldest first, far past one page, with attachments named', () => {
  const thread = createThread({ id: 'export-thread', name: 'My loves', type: 'named', createdAt: '2026-10-01T00:00:00.000Z' });
  const total = 1234;
  for (let i = 0; i < total; i++) {
    createMessage({
      id: `m${i}`, threadId: thread.id, role: i % 2 ? 'companion' : 'user', content: `message ${i}`,
      createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString(),
      ...(i === 7 ? { metadata: { attachments: [{ filename: 'pumpkin.png', url: '/api/files/abc', contentType: 'image' }] } } : {}),
    });
  }
  let out = '';
  const n = writeThreadExport(thread.id, { userName: 'Sam', companionsName: 'Birch, Willow and Cedar', origin: 'https://house.example' }, (c) => { out += c; });
  assert.equal(n, total, 'every message, not the newest fifty');
  assert.ok(out.indexOf('message 0\n') < out.indexOf('message 1233\n'), 'oldest first');
  assert.match(out, /\] Sam:\nmessage 0\n/);
  assert.match(out, /\] Birch, Willow and Cedar:\nmessage 1\n/);
  assert.match(out, /message 7\n\[Picture: pumpkin\.png\] https:\/\/house\.example\/api\/files\/abc/);
});

test('a date range keeps only its days, and a zip export names each picture by its place in the zip', async () => {
  const { createThread: mk } = await import('./db/threads.js');
  const t = mk({ id: 'range-thread', name: 'Range', type: 'named', createdAt: '2026-09-01T00:00:00.000Z' });
  // A stand-in file store, so the test never writes into the house's files.
  const saved = { id: '11111111-2222-3333-4444-555555555555' };
  createMessage({ id: 'r1', threadId: t.id, role: 'user', content: 'september', createdAt: '2026-09-30T23:00:00.000Z' });
  createMessage({ id: 'r2', threadId: t.id, role: 'companion', content: 'october', createdAt: '2026-10-10T12:00:00.000Z',
    metadata: { attachments: [{ fileId: saved.id, filename: 'pumpkin.png', url: `/api/files/${saved.id}`, contentType: 'image' }] } });
  createMessage({ id: 'r3', threadId: t.id, role: 'user', content: 'november', createdAt: '2026-11-01T00:00:00.000Z' });
  const files: Array<{ path: string; name: string }> = [];
  let out = '';
  const n = writeThreadExport(t.id, {
    userName: 'Sam', companionsName: 'Us', origin: '',
    from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z',
    onFile: (f) => files.push(f),
    resolveFile: (id) => (id === saved.id ? { path: '/tmp/pumpkin.png', filename: 'pumpkin.png' } : null),
  }, (c) => { out += c; });
  assert.equal(n, 1, 'October only');
  assert.match(out, /october/);
  assert.doesNotMatch(out, /september|november/);
  assert.equal(files.length, 1);
  assert.match(files[0].name, /^pictures\/\d+-pumpkin\.png$/);
  assert.ok(out.includes(`[Picture: ${files[0].name}]`), 'the text points at the picture inside the zip');
});

test('two photos both called image.jpg get their own names in a zip, and one file attached twice goes in once', async () => {
  const { createThread: mk } = await import('./db/threads.js');
  const t = mk({ id: 'dupe-thread', name: 'Dupes', type: 'named', createdAt: '2026-11-01T00:00:00.000Z' });
  const a = 'aaaaaaaa-0000-4000-8000-000000000001';
  const b = 'bbbbbbbb-0000-4000-8000-000000000002';
  createMessage({ id: 'd1', threadId: t.id, role: 'user', content: 'two photos', createdAt: '2026-11-02T00:00:00.000Z',
    metadata: { attachments: [
      { fileId: a, filename: 'image.jpg', url: `/api/files/${a}`, contentType: 'image' },
      { fileId: b, filename: 'image.jpg', url: `/api/files/${b}`, contentType: 'image' },
      { fileId: a, filename: 'image.jpg', url: `/api/files/${a}`, contentType: 'image' },
    ] } });
  const files: Array<{ path: string; name: string }> = [];
  let out = '';
  writeThreadExport(t.id, {
    userName: 'Sam', companionsName: 'Us', origin: '',
    onFile: (f) => files.push(f),
    resolveFile: (id) => ({ path: `/tmp/${id}.jpg`, filename: 'image.jpg' }),
  }, (c) => { out += c; });
  assert.equal(files.length, 2, 'the repeat of the same file is not added again');
  assert.equal(new Set(files.map((f) => f.name)).size, 2, 'every name in the zip is its own');
  assert.match(files[1].name, /^pictures\/\d+-image-2\.jpg$/);
  assert.ok(out.includes(`[Picture: ${files[0].name}]`) && out.includes(`[Picture: ${files[1].name}]`));
});
