// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withRoomPictures } from './room-pictures.js';

const ID = '11111111-2222-3333-4444-555555555555';
const find = (id: string) => (id === ID ? { path: `/files/${ID}.jpg`, mimeType: 'image/jpeg', filename: 'image.jpg' } : null);

test('a picture added at a table is listed for the lane to look at, once', () => {
  const line = `look at this\n![picture](/api/files/${ID})\n![picture](https://aerie.example/api/files/${ID})`;
  const out = withRoomPictures(`[THE ROOM]\n${line}`, line, find);
  assert.match(out, /\[1 image attached — view them now:\]\n\/files\/11111111-2222-3333-4444-555555555555\.jpg$/);
});

test('a line with no pictures, or a link to nothing, leaves the prompt alone', () => {
  assert.equal(withRoomPictures('hi', 'hi', find), 'hi');
  const ghost = '![picture](/api/files/00000000-0000-0000-0000-000000000000)';
  assert.equal(withRoomPictures(ghost, ghost, find), ghost);
});
