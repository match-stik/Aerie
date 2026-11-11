// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from './db/init.js';
import { getDb } from './db/state.js';
import { fileIdsInUse } from './file-references.js';
import { addPlaylist, addSound, listPlaylists, listSounds, nameFromFilename, playlistIds, removePlaylist, removeSound, renameSound, soundName, updatePlaylist } from './toy-sounds.js';

test('a sound gets a first name from its file, and a name is checked', () => {
  assert.equal(nameFromFilename('Slow_and_low_read-aloud.mp3'), 'Slow and low read-aloud');
  assert.equal(nameFromFilename('.m4a'), 'A sound');
  assert.equal(soundName('  late   night  '), 'late night');
  assert.equal(soundName(''), null);
  assert.equal(soundName('x'.repeat(81)), null);
});

test('the sound shelf keeps its audio safe from Clean orphans, and lets it go when a sound is cleared', () => {
  initDb(':memory:');
  const fileId = '11111111-2222-3333-4444-555555555555';
  const sound = addSound({ name: 'Read-aloud', fileId, size: 1234 });
  assert.equal(listSounds()[0]?.name, 'Read-aloud');
  assert.ok(fileIdsInUse(getDb()).has(fileId), 'a file on the shelf is in use');
  assert.ok(renameSound(sound.id, 'Chapter one'));
  assert.equal(listSounds()[0]?.name, 'Chapter one');
  assert.ok(removeSound(sound.id));
  assert.equal(listSounds().length, 0);
  assert.ok(!fileIdsInUse(getDb()).has(fileId));
  assert.equal(removeSound(sound.id), false);
});

test('a playlist keeps their order, and a sound cleared off the shelf drops out of it', () => {
  initDb(':memory:');
  const a = addSound({ name: 'A', fileId: 'aaaaaaaa-2222-3333-4444-555555555555', size: 1 });
  const b = addSound({ name: 'B', fileId: 'bbbbbbbb-2222-3333-4444-555555555555', size: 1 });
  const shelf = new Set([a.id, b.id]);
  assert.deepEqual(playlistIds([b.id, 'not-a-sound', a.id, b.id], shelf), [b.id, a.id, b.id]);
  assert.equal(playlistIds('nope', shelf), null);
  const list = addPlaylist('Late night', [b.id, a.id]);
  assert.deepEqual(listPlaylists()[0].soundIds, [b.id, a.id]);
  assert.ok(updatePlaylist(list.id, { name: 'Later night', soundIds: [a.id] }));
  assert.equal(listPlaylists()[0].name, 'Later night');
  assert.deepEqual(listPlaylists()[0].soundIds, [a.id]);
  assert.ok(removeSound(a.id));
  assert.deepEqual(listPlaylists()[0].soundIds, []);
  assert.ok(removePlaylist(list.id));
  assert.equal(listPlaylists().length, 0);
  assert.equal(updatePlaylist(list.id, { name: 'x' }), false);
});
