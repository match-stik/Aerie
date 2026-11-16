// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import { DESK_MIN_WIDTH, PHONE_DESK, aspectWords, chatShown, deskDockOf, deskChatOf, deskLayoutOf, deskOf, roomAspectOf, stageAfterMessages } from './desk';

test('a narrow window is the phone, whatever they chose', () => {
  assert.deepEqual(deskOf({}, 412), PHONE_DESK);
  assert.deepEqual(deskOf({ deskLayout: 'study', deskDock: 'left', deskChat: 'right' }, DESK_MIN_WIDTH - 1), PHONE_DESK);
  // A width nobody measured yet is not a wide one.
  assert.deepEqual(deskOf({}, Number.NaN), PHONE_DESK);
});

test('a wide window with nothing chosen is the Study: rail on the left, the companions on the right', () => {
  assert.deepEqual(deskOf({}, DESK_MIN_WIDTH), { on: true, rail: true, dock: 'left', chat: 'right' });
  assert.deepEqual(deskOf({}, 1440), { on: true, rail: true, dock: 'left', chat: 'right' });
});

test('choosing the phone keeps the phone on a wide window', () => {
  assert.deepEqual(deskOf({ deskLayout: 'phone' }, 1440), PHONE_DESK);
});

test('each choice is read, and anything unknown falls back to the Study as drawn', () => {
  assert.deepEqual(deskOf({ deskDock: 'bottom', deskChat: 'left' }, 1440), { on: true, rail: false, dock: 'top', chat: 'left' });
  assert.deepEqual(deskOf({ deskChat: 'tucked' }, 1440), { on: true, rail: true, dock: 'left', chat: null });
  assert.deepEqual(deskOf({ deskLayout: 'desk', deskDock: 'top', deskChat: 'middle' }, 1440), { on: true, rail: false, dock: 'top', chat: 'right' });
  assert.deepEqual(deskOf({ deskDock: 'sideways' }, 1440), { on: true, rail: true, dock: 'left', chat: 'right' });
  assert.equal(deskLayoutOf(undefined), 'study');
  assert.equal(deskDockOf('sideways'), 'left');
  assert.equal(deskChatOf(7), 'right');
});

test('on the phone the conversation is on screen only on the Messages screen', () => {
  assert.equal(chatShown(PHONE_DESK, 'messages'), true);
  assert.equal(chatShown(PHONE_DESK, 'home'), false);
  assert.equal(chatShown(PHONE_DESK, 'notes'), false);
  assert.equal(chatShown(PHONE_DESK, 'locked'), false);
});

test('beside a room it is on screen in every room, and never behind the lock', () => {
  const desk = deskOf({}, 1440);
  assert.equal(chatShown(desk, 'home'), true);
  assert.equal(chatShown(desk, 'notes'), true);
  assert.equal(chatShown(desk, 'appdrawer'), true);
  assert.equal(chatShown(desk, 'locked'), false);
});

test('tucked away it is a room like any other again', () => {
  const desk = deskOf({ deskChat: 'tucked' }, 1440);
  assert.equal(chatShown(desk, 'home'), false);
  assert.equal(chatShown(desk, 'messages'), true);
  assert.equal(stageAfterMessages(desk, 'messages', 'notes'), null);
});

test('asking for Messages while it is beside them puts the stage back where they were', () => {
  const desk = deskOf({}, 1440);
  assert.equal(stageAfterMessages(desk, 'messages', 'notes'), 'notes');
  assert.equal(stageAfterMessages(desk, 'messages', null), 'home');
  // Coming off the lock screen there is no room to go back to.
  assert.equal(stageAfterMessages(desk, 'messages', 'locked'), 'home');
  // Any other screen is left alone, and so is the phone.
  assert.equal(stageAfterMessages(desk, 'notes', 'home'), null);
  assert.equal(stageAfterMessages(PHONE_DESK, 'messages', 'notes'), null);
});

test('a room shape is said in plain numbers', () => {
  assert.equal(roomAspectOf(0, 10), null);
  assert.equal(aspectWords(16 / 10), '1.60 : 1, about 8 by 5');
  assert.match(aspectWords(960 / 690), /^1\.39 : 1, about 7 by 5$/);
});
