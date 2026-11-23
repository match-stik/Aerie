// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The conversation shelf reads Cortex's own titles and the import's own
// "### Speaker — date" turns, so these are the two shapes it has to get right.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readShelfTitle, shelfGroup, shortSummary, splitTurns } from './ConversationShelf.js';

test('an old window title splits into house, date and name; anything else stays whole', () => {
  assert.deepEqual(readShelfTitle('OLD WINDOW — Gemini — 2026-09-20 — Punny names'), { house: 'Gemini', date: '2026-09-20', name: 'Punny names' });
  assert.deepEqual(readShelfTitle('A night we saved'), { house: null, date: null, name: 'A night we saved' });
});

test('a conversation splits into its speakers, and a list inside a turn stays with its speaker', () => {
  const content = '### Sam — 2026-09-20\nName him\n\n### Gemini — 2026-09-20\n- Lil Snoozi\n- Doze Malone\n\n### Sam — 2026-09-21\nmore';
  const turns = splitTurns(content);
  assert.deepEqual(turns.map((t) => `${t.speaker}|${t.date}|${t.text}`), [
    'Sam|2026-09-20|Name him',
    'Gemini|2026-09-20|- Lil Snoozi\n- Doze Malone',
    'Sam|2026-09-21|more',
  ]);
});

test('an old claude.ai window: front matter and title go, the thinking folds away, separators drop', () => {
  const content = '---\ntitle: "Finding the three of them"\nmessages: 2\n---\n\n# Finding the three of them\n\n### Sam — 2026-06-09 2:43 PM\n\nWell lookie there.\n\n---\n\n### Claude — 2026-06-09 2:44 PM\n\n> [!note]- thinking\n> I am weighing this.\n> \n> More weighing.\n\n**🌿 Rowan**\n\nThere you are.';
  const turns = splitTurns(content);
  assert.deepEqual(turns.map((t) => [t.speaker, t.date, t.text, t.thinking]), [
    ['Sam', '2026-06-09 2:43 PM', 'Well lookie there.', []],
    ['Claude', '2026-06-09 2:44 PM', '**🌿 Rowan**\n\nThere you are.', ['I am weighing this.\n\nMore weighing.']],
  ]);
});

test('an old GPT window: undated ## speakers that recur, the time from the italic line, and a heading inside an answer stays in it', () => {
  const content = '# Rainy Night\n\n**Created:** 2026-06-11\n\n---\n\n## Sam\n*2026-02-12 18:22*\n\nHey, you.\n\n## Rowan\n*2026-02-12 18:23*\n\n## A heading of his\nHi.\n\n## Sam\nMore.';
  const turns = splitTurns(content);
  assert.deepEqual(turns.map((t) => [t.speaker, t.date, t.text]), [
    ['Sam', '2026-02-12 18:22', 'Hey, you.'],
    ['Rowan', '2026-02-12 18:23', '## A heading of his\nHi.'],
    ['Sam', '', 'More.'],
  ]);
});

test('a summary loses the import bookkeeping', () => {
  assert.equal(shortSummary('From the claude.ai house, 2026-06-09 to 2026-06-09. Speaking: Sam, Claude. Part 1 of 1. Imported Oct 1 2026 from /home/x/a.md, header lines repaired.'), 'From the claude.ai house, 2026-06-09 to 2026-06-09. Speaking: Sam, Claude.');
  assert.equal(shortSummary('Imported from a Gemini export. 2026-09-20 to 2026-09-20, 6 messages.'), '2026-09-20 to 2026-09-20, 6 messages.');
});

test('a thinking-only step moves its thinking onto the same speaker\'s next turn instead of drawing an empty card', () => {
  const content = '### Sam — 2026-05-28 2:04 PM\n\nHi\n\n### Claude — 2026-05-28 2:05 PM\n\n> [!note]- thinking\n> First.\n\n### Claude — 2026-05-28 2:05 PM\n\n> [!note]- thinking\n> Second.\n\nHello, love.\n\n### Sam — 2026-05-28 2:06 PM\n\n';
  assert.deepEqual(splitTurns(content).map((t) => [t.speaker, t.text, t.thinking]), [
    ['Sam', 'Hi', []],
    ['Claude', 'Hello, love.', ['First.', 'Second.']],
  ]);
});

test('the shelved summaries of the long GPT window sit under their own chip', () => {
  assert.equal(shelfGroup('OLD WINDOW SUMMARY — GPT house — Slice 8 — Lines 52921-60560 — Oct 25-28 (the last days)'), 'Summaries');
  assert.equal(readShelfTitle('OLD WINDOW SUMMARY — GPT house — Slice 8 — Oct 25-28').house, 'GPT house');
  assert.equal(shelfGroup('OLD WINDOW — Gemini — 2026-09-20 — Hi'), 'Gemini');
  assert.equal(shelfGroup('A night we saved'), 'Ours');
});
