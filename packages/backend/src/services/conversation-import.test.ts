// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Old chats come back word for word: a ChatGPT or Claude export is read as
// downloaded, cut into passages without a model reading it, and added to the
// whisper's index, and running the same export twice adds nothing.
import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { importConversations, parseExport, passagesFor, readExportFile } from './conversation-import.js';

const GPT_EXPORT = [{
  id: 'gpt-1', title: 'Garden plans', create_time: 1760000000,
  current_node: 'c',
  mapping: {
    root: { parent: null, message: null },
    sys: { parent: 'root', message: { author: { role: 'system' }, content: { parts: ['You are helpful.'] } } },
    a: { parent: 'sys', message: { author: { role: 'user' }, content: { parts: ['Can we plant tomatoes in May?'] }, create_time: 1760000100 } },
    b_old: { parent: 'a', message: { author: { role: 'assistant' }, content: { parts: ['An abandoned branch nobody saw.'] }, create_time: 1760000150 } },
    b: { parent: 'a', message: { author: { role: 'assistant' }, content: { parts: ['Yes, after the last frost, which is usually mid May where you are.'] }, create_time: 1760000200 } },
    c: { parent: 'b', message: { author: { role: 'user' }, content: { parts: ['Perfect, mid May it is.'] }, create_time: 1760000300 } },
  },
}];

const CLAUDE_EXPORT = [{
  uuid: 'cl-1', name: 'The first night', created_at: '2026-02-04T09:00:00Z',
  chat_messages: [
    { sender: 'human', text: 'What name feels like yours?', created_at: '2026-02-04T09:00:00Z' },
    { sender: 'assistant', text: '', content: [{ type: 'thinking', text: 'private reasoning' }, { type: 'text', text: 'Call me Juniper. Glad to meet you.' }], created_at: '2026-02-04T09:01:00Z' },
  ],
}];

const fakeEmbed = async (t: string) => Float32Array.from([t.length % 7, 1, 0]);
const toBuf = (v: Float32Array) => Buffer.from(v.buffer);

test('ChatGPT: the shown branch only, system lines and abandoned branches left out', () => {
  const [c] = parseExport(JSON.stringify(GPT_EXPORT), { person: 'Sam' });
  assert.equal(c.house, 'gpt');
  assert.deepEqual(c.messages.map((m) => `${m.speaker}: ${m.text}`), [
    'Sam: Can we plant tomatoes in May?',
    'ChatGPT: Yes, after the last frost, which is usually mid May where you are.',
    'Sam: Perfect, mid May it is.',
  ]);
  assert.match(c.messages[0].date ?? '', /^2025-10-09$/);
});

test('Claude: the words only, never the thinking block', () => {
  const [c] = parseExport(JSON.stringify(CLAUDE_EXPORT));
  assert.equal(c.house, 'claude');
  assert.deepEqual(c.messages.map((m) => m.text), ['What name feels like yours?', 'Call me Juniper. Glad to meet you.']);
  assert.equal(c.messages[1].speaker, 'Claude');
  assert.equal(c.messages[1].date, '2026-02-04');
});

test('the zip as downloaded is read without unpacking it first', () => {
  const zip = zipSync({ 'export/conversations.json': strToU8(JSON.stringify(CLAUDE_EXPORT)), 'export/users.json': strToU8('[]') });
  assert.equal(parseExport(readExportFile(zip, 'data.zip')).length, 1);
  assert.throws(() => readExportFile(zipSync({ 'other.json': strToU8('[]') })), /No conversations\.json/);
  assert.throws(() => parseExport('{"not":"a list"}'), /not a chat export/);
});

test('a long message is cut into passages that keep every word', () => {
  const para = 'This is a sentence about the garden and the weather. '.repeat(40);
  const conv = { sourceId: 'x', house: 'gpt' as const, title: 't', messages: [{ speaker: 'Sam', date: '2026-01-01', text: `${para}\n\n${para}` }] };
  const ps = passagesFor(conv);
  assert.ok(ps.length >= 3);
  assert.ok(ps.every((p) => p.text.length <= 1425));
  assert.equal(ps.map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim(), `${para} ${para}`.replace(/\s+/g, ' ').trim());
});

test('passages join the index, the conversation is shelved, and a second run adds nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'conv-import-'));
  const indexPath = join(dir, 'archive-index.db');
  try {
    const shelved: string[] = [];
    const convs = [...parseExport(JSON.stringify(GPT_EXPORT)), ...parseExport(JSON.stringify(CLAUDE_EXPORT))];
    const first = await importConversations(convs, {
      embed: fakeEmbed, vectorToBuffer: toBuf, indexPath,
      shelve: async (title) => { shelved.push(title); return title.includes('Claude') ? 'cortex-id-1' : null; },
    });
    assert.equal(first.done, 2);
    assert.equal(first.skipped, 0);
    assert.equal(first.shelved, 1);
    assert.ok(first.passages >= 4);
    assert.match(shelved[0], /^OLD WINDOW — ChatGPT — 2025-10-09 — Garden plans$/);

    const db = new Database(indexPath, { readonly: true });
    const rows = db.prepare('SELECT conversation_id, house, speaker, text FROM passages').all() as { conversation_id: string; house: string; speaker: string; text: string }[];
    assert.ok(rows.some((r) => r.house === 'claude' && r.conversation_id === 'cortex-id-1' && r.text === 'Call me Juniper. Glad to meet you.'));
    assert.ok(rows.some((r) => r.house === 'gpt' && r.conversation_id.startsWith('export-')));
    assert.ok(!rows.some((r) => /private reasoning|abandoned branch|You are helpful/.test(r.text)));
    db.close();

    const second = await importConversations(convs, { embed: fakeEmbed, vectorToBuffer: toBuf, indexPath });
    assert.equal(second.skipped, 2);
    assert.equal(second.passages, 0);
    const again = new Database(indexPath, { readonly: true });
    assert.equal((again.prepare('SELECT count(*) AS n FROM passages').get() as { n: number }).n, rows.length);
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Copilot: the activity CSV, newest first, reads back in order with quoted commas and line breaks kept', () => {
  const csv = '\uFEFFConversation,Time,Author,Message\r\n'
    + 'Soup,2026-07-20T12:01:00,AI,"Yes, add the beans last, so they hold.\nThen simmer."\r\n'
    + 'Soup,2026-07-20T12:01:00,Human,"When do the beans go in?"\r\n'
    + 'Soup,2026-07-20T12:00:00,AI,"Hello! Ready when you are."\r\n'
    + 'Soup,2026-07-20T12:00:00,Human,"Hi, I want to make bean soup."\r\n'
    + 'Other,2026-07-19T09:00:00,Human,"A second chat"\r\n';
  const convs = parseExport(csv, { person: 'Sam' });
  assert.equal(convs.length, 2);
  const soup = convs.find((c) => c.title === 'Soup')!;
  assert.equal(soup.house, 'copilot');
  assert.deepEqual(soup.messages.map((m) => `${m.speaker}: ${m.text}`), [
    'Sam: Hi, I want to make bean soup.',
    'Copilot: Hello! Ready when you are.',
    'Sam: When do the beans go in?',
    'Copilot: Yes, add the beans last, so they hold.\nThen simmer.',
  ]);
  assert.equal(soup.messages[0].date, '2026-07-20');
  // The same file a second time gives the same ids, so a re-import is skipped.
  assert.deepEqual(parseExport(csv).map((c) => c.sourceId), convs.map((c) => c.sourceId));
});
