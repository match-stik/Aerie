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

test('a laptop left on the old Phone layout gets the Study', () => {
  assert.deepEqual(deskOf({ deskLayout: 'phone' }, 1440), { on: true, rail: true, dock: 'left', chat: 'right' });
  assert.equal(deskLayoutOf('phone'), 'study');
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

test("every setting is the laptop's own or the phone's own, the look included", async () => {
  const { deskScreenTheme, routeDeskUpdate, seedDeskScreen, foldDeskView, DESK_SEEDED } = await import('./desk');
  const phone = { homeWidgets: ['companions', 'note'], lockFace: 'serif', mode: 'dark', id: 'pal-ember', wallpaper: '/api/files/a', deskWallpaper: '/api/files/room', deskDock: 'top', deskScreen: { homeWidgets: ['weather'] } as Record<string, unknown> | undefined };
  // The first copy: the phone's settings, its old room picture as the wallpaper, its own earlier choices on top.
  const seeded = seedDeskScreen(phone as never) as unknown as typeof phone;
  assert.ok(seeded);
  assert.equal(seeded.deskScreen![DESK_SEEDED], true);
  assert.equal(seeded.deskScreen!.wallpaper, '/api/files/room');
  assert.deepEqual(seeded.deskScreen!.homeWidgets, ['weather']);
  assert.equal(seeded.deskScreen!.mode, 'dark');
  assert.equal('deskDock' in seeded.deskScreen!, false, 'what the laptop owns outright stays at the top');
  assert.equal(seedDeskScreen(seeded as never), null, 'copied once');
  // A change on the laptop, the mode and palette included, never touches the phone's.
  const upd = routeDeskUpdate(seeded, { mode: 'light', id: 'pal-sky', deskDock: 'left' } as never) as Record<string, unknown>;
  const after = { ...seeded, ...upd } as typeof phone;
  assert.equal(after.mode, 'dark');
  assert.equal(after.id, 'pal-ember');
  assert.equal(after.deskDock, 'left');
  assert.equal(deskScreenTheme(after).mode, 'light');
  assert.equal(deskScreenTheme(after).id, 'pal-sky');
  // Clearing a choice on the laptop is its own unset, not the phone's value.
  const view = deskScreenTheme(after);
  const cleared = foldDeskView(after, view, { ...view, lockFace: undefined } as never);
  assert.equal(deskScreenTheme(cleared).lockFace, undefined);
  assert.equal(cleared.lockFace, 'serif');
});

test("the laptop's text and send button are its own, starting at the laptop's text size", async () => {
  const { deskAppView, routeDeskAppUpdate, seedDeskApp, DESK_TEXT_SCALE } = await import('./desk');
  const app = { fontScale: 1.1, fontBody: 'geist', userAvatar: 'me.png' } as Record<string, unknown>;
  const seeded = seedDeskApp(app)!;
  assert.deepEqual(seeded.deskApp, { fontScale: DESK_TEXT_SCALE, fontBody: 'geist' });
  assert.equal(seedDeskApp(seeded), null);
  const upd = routeDeskAppUpdate(seeded, { fontScale: 0.95, userAvatar: 'new.png' });
  const after = { ...seeded, ...upd };
  assert.equal(after.fontScale, 1.1, "the phone's text size is untouched");
  assert.equal(after.userAvatar, 'new.png', 'the avatar is shared');
  assert.equal(deskAppView(after).fontScale, 0.95);
});
