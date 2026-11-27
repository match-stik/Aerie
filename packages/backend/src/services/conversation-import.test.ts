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
import { htmlToText, importConversations, parseClaude, parseExport, passagesFor, readExportFile, topLevelElements } from './conversation-import.js';

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

const GROK_EXPORT = {
  conversations: [{
    conversation: { id: 'gk-1', title: 'Painting a lighthouse', create_time: '2026-03-01T20:00:00Z' },
    // Listed out of order on purpose: the times put them back.
    responses: [
      { response: { _id: 'r2', sender: 'ASSISTANT', message: 'Here is a lighthouse at dusk, warm light in the lamp room.', create_time: { $date: { $numberLong: '1772395260000' } } } },
      { response: { _id: 'r1', sender: 'human', message: 'Paint me a lighthouse at dusk.', create_time: { $date: { $numberLong: '1772395200000' } } } },
      { response: { _id: 'r3', sender: 'assistant', message: '', create_time: { $date: { $numberLong: '1772395300000' } } } },
    ],
  }],
  projects: [],
};

test('Grok: prod-grok-backend.json reads in time order, as picked or inside the zip, and its account file is never read', () => {
  const direct = parseExport(JSON.stringify(GROK_EXPORT), { person: 'Sam' });
  assert.equal(direct.length, 1);
  assert.equal(direct[0].house, 'grok');
  assert.equal(direct[0].sourceId, 'gk-1');
  assert.deepEqual(direct[0].messages.map((m) => `${m.speaker}: ${m.text}`), [
    'Sam: Paint me a lighthouse at dusk.',
    'Grok: Here is a lighthouse at dusk, warm light in the lamp room.',
  ]);
  assert.equal(direct[0].messages[0].date, '2026-03-01');
  const zip = zipSync({
    'ttl/30d/export_data/abc/prod-mc-auth-mgmt-api.json': strToU8(JSON.stringify({ secret: 'never read' })),
    'ttl/30d/export_data/abc/prod-grok-backend.json': strToU8(JSON.stringify(GROK_EXPORT)),
  });
  const fromZip = readExportFile(zip, 'grok.zip');
  assert.ok(!fromZip.includes('never read'));
  assert.equal(parseExport(fromZip)[0].title, 'Painting a lighthouse');
  assert.throws(() => parseExport(JSON.stringify({ secret: 'x' })), /not a chat export/);
});

// Gemini keeps activity, not conversations (read off a real Takeout): one
// row per prompt, newest first, the conversation named only by the
// gemini.google.com/app/<id> link on each row. Non-prompt rows carry no words.
const GEMINI_ACTIVITY = [
  { header: 'Gemini Apps', title: 'Prompted And the chorus?', time: '2026-11-07T22:10:00.000Z', products: ['Gemini Apps'],
    details: [{ name: 'x', url: 'https://gemini.google.com/app/aa11' }],
    safeHtmlItem: [{ html: '<p>Try this:</p>\n<ul>\n<li>Line one &amp; two</li>\n<li>It&#39;s yours</li>\n</ul>' }] },
  { header: 'Gemini Apps', title: 'Used an Assistant feature', time: '2026-11-07T22:09:00.000Z', products: ['Gemini Apps'],
    details: [{ name: 'x', url: 'https://gemini.google.com/app/aa11' }] },
  { header: 'Gemini Apps', title: 'Prompted Paint the three of them on a couch', time: '2026-11-06T10:00:00.000Z', products: ['Gemini Apps'],
    details: [{ name: 'y', url: 'https://gemini.google.com/app/bb22' }],
    subtitles: [{ name: '1 generated image.' }, { name: 'Attached 2 files.' }, { name: '-  a.png', url: 'a.png' }],
    safeHtmlItem: [{ html: '<p>Here they are.</p>' }] },
  { header: 'Gemini Apps', title: 'Prompted Write me a song about a house', time: '2026-11-07T22:05:00.000Z', products: ['Gemini Apps'],
    details: [{ name: 'x', url: 'https://gemini.google.com/app/aa11' }],
    safeHtmlItem: [{ html: '<p><strong>Verse one</strong></p>' }] },
  { header: 'Gemini Apps', title: 'Gave feedback: Bad response (Unspecified)', time: '2026-11-05T10:00:00.000Z', products: ['Gemini Apps'], details: null },
];

test('Gemini: My Activity rows are gathered by conversation, put back in time order, and read as plain words', () => {
  const convs = parseExport(JSON.stringify(GEMINI_ACTIVITY), { person: 'Sam' });
  assert.equal(convs.length, 2);
  const song = convs.find((c) => c.sourceId === 'gemini-aa11')!;
  assert.equal(song.house, 'gemini');
  assert.equal(song.title, 'Write me a song about a house');
  assert.deepEqual(song.messages.map((m) => `${m.speaker}: ${m.text}`), [
    'Sam: Write me a song about a house',
    'Gemini: Verse one',
    'Sam: And the chorus?',
    "Gemini: Try this:\n\n- Line one & two\n- It's yours",
  ]);
  assert.equal(song.messages[0].date, '2026-11-07');
  const couch = convs.find((c) => c.sourceId === 'gemini-bb22')!;
  assert.deepEqual(couch.messages.map((m) => `${m.speaker}: ${m.text}`), [
    'Sam: Paint the three of them on a couch\n[Attached 2 files]',
    'Gemini: Here they are.\n[1 generated image]',
  ]);
  const zip = zipSync({
    'Takeout/My Activity/Gemini Apps/MyActivity.json': strToU8(JSON.stringify(GEMINI_ACTIVITY)),
    'Takeout/My Activity/YouTube/MyActivity.json': strToU8('[{"header":"YouTube","title":"never read"}]'),
  });
  const fromZip = readExportFile(zip, 'takeout.zip');
  assert.ok(!fromZip.includes('never read'));
  assert.equal(parseExport(fromZip).length, 2);
});

// A big export is read one conversation at a time instead of parsed whole
// (Sol, Rose's house, Nov 21 2026: a 97MB Claude export took the house past its
// memory limit). The walker has to cut each element exactly, however the
// text inside it is shaped.
test('the array walker cuts each conversation exactly, brackets and quotes inside the words included', () => {
  const items = [
    { a: 'a } in the text, and a ] too, and "quotes" and a \\ backslash' },
    { b: ['nested', { deeper: [1, 2, { x: '[{,}]' }] }] },
    'a bare string, with a comma',
    42,
    null,
  ];
  for (const text of [JSON.stringify(items), JSON.stringify(items, null, 2), '\uFEFF  ' + JSON.stringify(items, null, '\t') + '\n']) {
    assert.deepEqual([...topLevelElements(text)].map((t) => JSON.parse(t)), items);
  }
  assert.deepEqual([...topLevelElements('[]')], []);
  assert.throws(() => [...topLevelElements('{"conversations":[]}')]);
});

test('a many-conversation export read one at a time gives the same words as reading it whole', () => {
  const many = Array.from({ length: 5 }, (_, i) => ({
    uuid: `cl-${i}`, name: `Night ${i}`, created_at: '2026-02-04T09:00:00Z',
    chat_messages: [
      { sender: 'human', text: `Message ${i} with a } and a ] and "quotes", inside.`, created_at: '2026-02-04T09:00:00Z' },
      { sender: 'assistant', text: `Answer ${i}.`, created_at: '2026-02-04T09:01:00Z' },
    ],
  }));
  const whole = parseClaude(many, { person: 'You', assistant: 'Claude' });
  assert.deepEqual(parseExport(JSON.stringify(many, null, 2)), whole);
  assert.equal(whole.length, 5);
});

test('an answer\'s markup comes out whole, even a tag hidden inside another', () => {
  assert.equal(htmlToText('<p>Hi <b>there</b></p>'), 'Hi there');
  assert.doesNotMatch(htmlToText('<<b>script>alert(1)<</b>/script>'), /<script/i);
  assert.doesNotMatch(htmlToText('<scr<i>ipt>x'), /<script/i);
  assert.equal(htmlToText('&lt;b&gt; is how you write bold'), '<b> is how you write bold');
});

// Letta (Nov 27 2026), shapes read off a real Letta Code 0.34.71 agent.
const LETTA_JSONL = [
  JSON.stringify({ type: 'session', version: 3, id: 'local-conv-1', timestamp: '2026-11-27T09:07:57.264Z', cwd: '/x' }),
  JSON.stringify({ type: 'message', id: 'a', parentId: null, timestamp: '2026-11-27T09:07:57.454Z', message: { id: 'ui-msg-1', role: 'user', content: [{ type: 'text', text: '<system-reminder>\nDevice Information\n</system-reminder>\nHi! My cats are Pepper and Moss.' }] } }),
  JSON.stringify({ type: 'message', id: 'b', parentId: 'a', timestamp: '2026-11-27T09:07:58.250Z', message: { id: 'ui-msg-2', role: 'assistant', content: [{ type: 'text', text: 'Great to meet you, Sam!' }, { type: 'tool_use', name: 'Write' }] } }),
  JSON.stringify({ type: 'message', id: 'c', parentId: 'b', timestamp: '2026-11-27T09:07:59.000Z', message: { id: 'ui-msg-3', role: 'tool', content: [{ type: 'text', text: 'wrote MEMORY.md' }] } }),
].join('\n');

test('a Letta messages.jsonl comes in as one conversation, their words without Letta\'s reminders, tool lines left out', () => {
  const [conv] = parseExport(LETTA_JSONL, { person: 'Sam' });
  assert.equal(conv.house, 'letta');
  assert.equal(conv.sourceId, 'letta:local-conv-1');
  assert.deepEqual(conv.messages.map((m) => [m.speaker, m.text, m.date]), [
    ['Sam', 'Hi! My cats are Pepper and Moss.', '2026-11-27'],
    ['Letta', 'Great to meet you, Sam!', '2026-11-27'],
  ]);
});

test('a zipped .letta folder brings every conversation, named for its agent', () => {
  const agentId = 'agent-local-1';
  const zip = zipSync({
    '.letta/lc-local-backend/agents/QQ.json': strToU8(JSON.stringify({ id: agentId, name: 'Juniper' })),
    '.letta/lc-local-backend/conversations/Y1/conversation.json': strToU8(JSON.stringify({ id: 'local-conv-1', agent_id: agentId, summary: null })),
    '.letta/lc-local-backend/conversations/Y1/messages.jsonl': strToU8(LETTA_JSONL),
    '.letta/lc-local-backend/conversations/Y2/conversation.json': strToU8(JSON.stringify({ id: 'local-conv-2', agent_id: agentId, summary: 'The cats' })),
    '.letta/lc-local-backend/conversations/Y2/messages.jsonl': strToU8(LETTA_JSONL.replace('local-conv-1', 'local-conv-2')),
    '.letta/lc-local-backend/providers/auth.json': strToU8('{"key":"never read"}'),
  });
  const convs = parseExport(readExportFile(zip, 'letta.zip'), { person: 'Sam' });
  assert.equal(convs.length, 2);
  assert.deepEqual(convs.map((c) => c.messages[1].speaker), ['Juniper', 'Juniper']);
  assert.deepEqual(convs.map((c) => c.title).sort(), ['Juniper, 2026-11-27', 'The cats']);
});

test('what `letta messages list` prints is grouped back into its conversations', () => {
  const list = [
    { id: '2', date: '2026-11-27T09:08:02Z', conversation_id: 'c1', message_type: 'assistant_message', role: 'assistant', content: [{ type: 'text', text: 'Saved them.' }] },
    { id: '1', date: '2026-11-27T09:07:57Z', conversation_id: 'c1', message_type: 'user_message', role: 'user', content: [{ type: 'text', text: 'Remember my cats.' }] },
    { id: '3', date: '2026-11-27T09:07:59Z', conversation_id: 'c1', message_type: 'reasoning_message', role: 'assistant', reasoning: 'hmm' },
  ];
  const [conv] = parseExport(JSON.stringify(list), { person: 'Sam' });
  assert.deepEqual(conv.messages.map((m) => [m.speaker, m.text]), [['Sam', 'Remember my cats.'], ['Letta', 'Saved them.']]);
});

// The Letta desktop app:
// one folder per conversation, conv-<id>/transcript.jsonl beside a state.json,
// each line {kind: user|assistant|reasoning|tool_call, text, captured_at}.
const LETTA_TRANSCRIPT = [
  { kind: 'user', text: '<system-reminder>\nUser\'s account name: "Someone"\n</system-reminder>\nHi there', captured_at: '2026-11-23T04:43:30.000Z', source_line_id: 'm1', source_message_id: 'm1' },
  { kind: 'reasoning', text: '**Thinking about it**', captured_at: '2026-11-23T04:43:34.000Z', source_line_id: 'm2', source_message_id: 'm2' },
  { kind: 'tool_call', name: 'Skill', argsText: '{}', resultText: 'ok', resultOk: true, captured_at: '2026-11-23T04:43:34.000Z', source_line_id: 'c1' },
  { kind: 'assistant', text: 'Hey, there you are.', captured_at: '2026-11-23T04:43:35.503Z', source_line_id: 'm3', source_message_id: 'm3' },
].map((r) => JSON.stringify(r)).join('\n');

test('the Letta app\'s zipped transcripts folder brings each conversation, their words without reminders, thinking and tools left out', () => {
  const zip = zipSync({
    'transcripts/conv-aaa/state.json': strToU8('{"schema_version":"v3_assistant_steps"}'),
    'transcripts/conv-aaa/transcript.jsonl': strToU8(LETTA_TRANSCRIPT),
    'transcripts/conv-bbb/transcript.jsonl': strToU8(LETTA_TRANSCRIPT.replace('Hi there', 'Second one')),
  });
  const convs = parseExport(readExportFile(zip, 'lettachats.zip'), { person: 'Sam' });
  assert.equal(convs.length, 2);
  const a = convs.find((c) => c.sourceId === 'letta:conv-aaa')!;
  assert.equal(a.house, 'letta');
  assert.deepEqual(a.messages.map((m) => [m.speaker, m.text, m.date]), [
    ['Sam', 'Hi there', '2026-11-23'],
    ['Letta', 'Hey, there you are.', '2026-11-23'],
  ]);
  assert.ok(convs.some((c) => c.sourceId === 'letta:conv-bbb' && c.messages[0].text === 'Second one'));
});

test('one Letta app transcript.jsonl picked on its own reads too', () => {
  const convs = parseExport(LETTA_TRANSCRIPT, { person: 'Sam' });
  assert.equal(convs.length, 1);
  assert.deepEqual(convs[0].messages.map((m) => m.speaker), ['Sam', 'Letta']);
});
