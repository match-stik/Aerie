// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The Letta import: a folder written by `letta memory export` lands as walls
// and drawer memories, and nothing already in the house is overwritten.
import assert from 'node:assert/strict';
import test from 'node:test';
import { initDb } from './db/init.js';
import { createCompanion } from './db/companions.js';
import * as memoryBlocks from './memory-blocks.js';
import { classify, importLetta, isLettaStarter, labelFor, parseLettaFiles, readsLikeIndex, splitFrontmatter } from './letta-import.js';

initDb(':memory:');
memoryBlocks.initMemoryBlocks();
createCompanion({ slug: 'juniper', displayName: 'Juniper', claudeMdPath: '/unused', mcpJsonPath: '/unused' });

const EXPORT = [
  { path: 'agent-123/MEMORY.md', text: '# Index\n- reference/: notes' },
  { path: 'agent-123/persona.md', text: '---\nname: persona\ndescription: Who I am\n---\nI am Juniper. I like rain.' },
  { path: 'agent-123/human.md', text: '---\nname: human\ndescription: About them\n---\nThey work nights.' },
  { path: 'agent-123/reference/project-notes.md', text: '---\nname: project notes\n---\nThe garden plan: tomatoes in May.' },
  { path: 'agent-123/skills/my-skill/SKILL.md', text: '---\nname: my-skill\n---\nDo a thing.' },
  { path: '__MACOSX/agent-123/._persona.md', text: 'junk' },
  { path: 'agent-123/notes.txt', text: 'not markdown' },
];

test('the header comes off and the text stays', () => {
  const { meta, body } = splitFrontmatter('---\nname: persona\ndescription: Who I am\n---\nHello.\n');
  assert.equal(meta.name, 'persona');
  assert.equal(meta.description, 'Who I am');
  assert.equal(body, 'Hello.');
  // No header at all is just text.
  assert.equal(splitFrontmatter('Plain words').body, 'Plain words');
  // A broken header is kept rather than lost.
  assert.match(splitFrontmatter('---\n: : [\n---\nBody').body, /Body/);
});

test('paths sort into walls, drawer, index and skills', () => {
  assert.equal(classify('persona.md', 'x'), 'wall');
  assert.equal(classify('system/persona.md', 'x'), 'wall');
  assert.equal(classify('reference/notes.md', 'x'), 'drawer');
  assert.equal(classify('MEMORY.md', '- reference/: notes\n- [plans](plans.md)'), 'index');
  assert.equal(classify('reference/MEMORY.md', '- notes.md'), 'index');
  assert.equal(classify('skills/a/SKILL.md', 'x'), 'skill');
  assert.equal(classify('persona.md', '   '), 'empty');
  assert.equal(labelFor('system/Human Notes.md'), 'human_notes');
  assert.equal(labelFor('reference/project-notes.md'), 'reference_project-notes');
});

test('the folder name a zip adds, Mac shadow files and non-markdown are ignored', () => {
  const entries = parseLettaFiles(EXPORT);
  assert.deepEqual(entries.map((e) => e.path).sort(), [
    'MEMORY.md', 'human.md', 'persona.md', 'reference/project-notes.md', 'skills/my-skill/SKILL.md',
  ]);
});

test('a dry run changes nothing and says what would happen', async () => {
  const r = await importLetta(EXPORT, 'juniper', { dryRun: true, remember: async () => { throw new Error('no writes on a dry run'); } });
  assert.equal(r.walls, 2);
  assert.equal(r.drawer, 1);
  assert.equal(r.skipped, 2);
  assert.equal(memoryBlocks.getBlock('juniper', 'persona')?.content ?? '', '');
});

test('walls land on the companion, human on the shared wall, reference in the drawer, nothing overwritten', async () => {
  memoryBlocks.setBlock('shared', 'human', 'Name: Sam');
  const remembered: { content: string; domain: string }[] = [];
  const r = await importLetta(EXPORT, 'Juniper', {
    now: new Date('2026-11-19T12:00:00Z'),
    remember: async (content, domain) => { remembered.push({ content, domain }); },
  });
  assert.deepEqual(r.errors, []);
  assert.equal(memoryBlocks.getBlock('juniper', 'persona')?.content, 'I am Juniper. I like rain.');
  assert.equal(memoryBlocks.getBlock('juniper', 'persona')?.description, 'Who I am');
  const human = memoryBlocks.getBlock('shared', 'human')?.content ?? '';
  assert.match(human, /^Name: Sam/);
  assert.match(human, /Imported from Letta \(human\.md\), 2026-11-19:\nThey work nights\./);
  assert.equal(remembered.length, 1);
  assert.equal(remembered[0].domain, 'juniper');
  assert.match(remembered[0].content, /^REFERENCE_PROJECT-NOTES \(imported from Letta, reference\/project-notes\.md, 2026-11-19\)\nThe garden plan/);
});

test('an unknown companion or the shared scope is refused before anything is read', async () => {
  await assert.rejects(importLetta(EXPORT, 'nobody'), /Pick which companion/);
  await assert.rejects(importLetta(EXPORT, 'shared'), /Pick which companion/);
});

// Found on a real export: a Letta Code agent told a few things and
// exported wrote them into the root MEMORY.md, and left Letta's starter text in
// human.md untouched.
const REAL = [
  { path: 'MEMORY.md', text: '# Memory Index\n\n## Sam (User Profile)\n- **Name**: Sam\n- **Favorite color**: Green\n- **Cats**:\n  - **Pepper** - Gray cat, knocks things off tables\n  - **Moss** - Black cat, very dignified\n\n## Current Context\n- Testing Letta memory export\n- Located in `/home/someone/work`\n' },
  { path: 'human.md', text: "---\nname: Human\ndescription: What I've learned about the person\n---\nI haven't gotten to know this person yet.\n\nI'm curious about them - not just their preferences, but who they are.\n\nAs we collaborate, I'll build up an understanding of how they think.\n" },
  { path: 'persona.md', text: '---\nname: Persona\ndescription: I am Linden\n---\n# Who I Am\n\nI am **Linden**, Willow\'s cousin.' },
];

test('a MEMORY.md that holds what the agent learned is a memory, and one that points elsewhere is an index', () => {
  assert.equal(readsLikeIndex(REAL[0].text), false);
  assert.equal(readsLikeIndex('# Index\n- reference/: notes\n- [plans](plans.md)'), true);
  const kinds = Object.fromEntries(parseLettaFiles(REAL).map((e) => [e.path, e.kind]));
  assert.equal(kinds['MEMORY.md'], 'wall');
});

test("Letta's untouched starter text is left behind, and one an agent wrote under is kept", () => {
  assert.equal(isLettaStarter('human', "I haven't gotten to know this person yet.\n\nI'm curious about them."), true);
  assert.equal(isLettaStarter('human', "I haven't gotten to know this person yet.\n\n" + 'They work nights and love orange. '.repeat(20)), false);
  assert.equal(isLettaStarter('persona', "I haven't gotten to know this person yet."), false);
  const kinds = Object.fromEntries(parseLettaFiles(REAL).map((e) => [e.path, e.kind]));
  assert.equal(kinds['human.md'], 'starter');
});

test('door new: a look first finds nobody by the name, the real run needs them made, and nothing lands on anybody else', async () => {
  createCompanion({ slug: 'ivy', displayName: 'Ivy', claudeMdPath: '/unused', mcpJsonPath: '/unused' });
  memoryBlocks.setBlock('shared', 'human', 'Name: Sam');
  await assert.rejects(importLetta(REAL, 'Ivy', { door: 'new', dryRun: true }), /already someone called ivy/);
  await assert.rejects(importLetta(REAL, 'Linden', { door: 'new' }), /has not been made yet/);
  const look = await importLetta(REAL, 'Linden', { door: 'new', dryRun: true });
  assert.equal(look.companion, 'linden');
  assert.deepEqual(look.items.map((i) => [i.path, i.action, i.scope, i.target]).sort(), [
    ['MEMORY.md', 'new', 'linden', 'continuity'],
    ['human.md', 'skip', null, null],
    ['persona.md', 'new', 'linden', 'persona'],
  ]);
  createCompanion({ slug: 'linden', displayName: 'Linden', claudeMdPath: '/unused', mcpJsonPath: '/unused' });
  const real = await importLetta(REAL, 'Linden', { door: 'new', remember: async () => { throw new Error('nothing to the drawer'); } });
  assert.deepEqual(real.errors, []);
  assert.match(memoryBlocks.getBlock('linden', 'continuity')?.content ?? '', /Pepper/);
  assert.equal(memoryBlocks.getBlock('shared', 'human')?.content, 'Name: Sam');
});

test('door new: what a companion knew about the person stays on their own side', async () => {
  createCompanion({ slug: 'rowan', displayName: 'Rowan', claudeMdPath: '/unused', mcpJsonPath: '/unused' });
  memoryBlocks.setBlock('shared', 'human', 'Name: Sam');
  const files = [{ path: 'human.md', text: 'They garden at night.' }];
  const r = await importLetta(files, 'Rowan', { door: 'new' });
  assert.deepEqual(r.errors, []);
  assert.equal(memoryBlocks.getBlock('rowan', 'human')?.content, 'They garden at night.');
  assert.equal(memoryBlocks.getBlock('shared', 'human')?.content, 'Name: Sam');
});

test('door merge: each memory goes where it was picked, and a wall of its own never takes an existing name', async () => {
  createCompanion({ slug: 'hazel', displayName: 'Hazel', claudeMdPath: '/unused', mcpJsonPath: '/unused' });
  memoryBlocks.setBlock('hazel', 'persona', 'I am Hazel.');
  memoryBlocks.setBlock('shared', 'human', 'Name: Sam');
  const files = [
    { path: 'persona.md', text: 'I like storms.' },
    { path: 'human.md', text: 'They work nights.' },
    { path: 'notes.md', text: 'Garden in May.' },
    { path: 'style.md', text: 'Short answers.' },
  ];
  const remembered: string[] = [];
  const r = await importLetta(files, 'hazel', {
    door: 'merge', humanTo: 'companion',
    choices: { 'persona.md': 'wall', 'notes.md': 'drawer', 'style.md': 'skip' },
    remember: async (content) => { remembered.push(content); },
  });
  assert.deepEqual(r.errors, []);
  assert.equal(memoryBlocks.getBlock('hazel', 'persona')?.content, 'I am Hazel.');
  assert.equal(memoryBlocks.getBlock('hazel', 'persona_letta')?.content, 'I like storms.');
  assert.equal(memoryBlocks.getBlock('hazel', 'human')?.content, 'They work nights.');
  assert.equal(memoryBlocks.getBlock('shared', 'human')?.content, 'Name: Sam');
  assert.ok(!memoryBlocks.getBlock('hazel', 'style'));
  assert.equal(remembered.length, 1);
  assert.match(remembered[0], /Garden in May/);
});

test('door drawer: findable only, no wall is touched', async () => {
  createCompanion({ slug: 'alder', displayName: 'Alder', claudeMdPath: '/unused', mcpJsonPath: '/unused' });
  memoryBlocks.setBlock('alder', 'persona', 'I am Alder.');
  memoryBlocks.setBlock('shared', 'human', 'Name: Sam');
  const remembered: string[] = [];
  const r = await importLetta([{ path: 'persona.md', text: 'I like rain.' }, { path: 'human.md', text: 'They work nights.' }], 'alder', {
    door: 'drawer', choices: { 'persona.md': 'add' },
    remember: async (content) => { remembered.push(content); },
  });
  assert.deepEqual(r.errors, []);
  assert.equal(r.walls, 0);
  assert.equal(remembered.length, 2);
  assert.equal(memoryBlocks.getBlock('alder', 'persona')?.content, 'I am Alder.');
  assert.equal(memoryBlocks.getBlock('shared', 'human')?.content, 'Name: Sam');
});

test('a wall can be renamed, carrying its words and load setting, but never onto a wall or away from a name the house reads', () => {
  createCompanion({ slug: 'birch', displayName: 'Birch', claudeMdPath: '/unused', mcpJsonPath: '/unused' });
  memoryBlocks.setBlock('birch', 'memory', 'What I learned.', 'notes');
  memoryBlocks.setWallLoad('birch', 'memory', 'search');
  memoryBlocks.setBlock('birch', 'persona', 'I am Birch.');
  assert.equal(memoryBlocks.renameBlock('birch', 'memory', 'Continuity'), 'continuity');
  assert.ok(!memoryBlocks.getBlock('birch', 'memory'));
  assert.equal(memoryBlocks.getBlock('birch', 'continuity')?.content, 'What I learned.');
  assert.equal(memoryBlocks.getBlock('birch', 'continuity')?.description, 'notes');
  assert.equal(memoryBlocks.wallLoad('birch', 'continuity'), 'search');
  assert.equal(memoryBlocks.wallLoad('birch', 'memory'), 'always');
  assert.throws(() => memoryBlocks.renameBlock('birch', 'continuity', 'persona'), /already exists/);
  assert.throws(() => memoryBlocks.renameBlock('birch', 'persona', 'self'), /reads by/);
  assert.throws(() => memoryBlocks.renameBlock('birch', 'nothing', 'x'), /no wall/);
});
