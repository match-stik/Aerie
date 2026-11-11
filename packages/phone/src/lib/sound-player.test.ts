// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// The sound shelf's playlists: one sound after another, in their order (theirs, Nov 10 2026).
import test from 'node:test';
import assert from 'node:assert/strict';

class FakeAudio {
  src = '';
  loop = false;
  currentTime = 0;
  duration = 10;
  preload = '';
  private handlers = new Map<string, Array<() => void>>();
  addEventListener(name: string, fn: () => void) { this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]); }
  fire(name: string) { for (const fn of this.handlers.get(name) ?? []) fn(); }
  play() { this.fire('play'); return Promise.resolve(); }
  pause() { this.fire('pause'); }
  load() {}
  removeAttribute() { this.src = ''; }
}
let made: FakeAudio | null = null;
(globalThis as unknown as { Audio: unknown }).Audio = class extends FakeAudio { constructor() { super(); made = this; } };

const player = await import('./sound-player.js');
const s = (n: number) => ({ id: `s${n}`, name: `Sound ${n}`, fileId: `f${n}` });

test('a playlist plays in order, loops as a whole, and a single sound leaves it', () => {
  player.playQueue('Late night', [s(1), s(2), s(3)]);
  assert.equal(player.soundState().id, 's1');
  assert.equal(made!.loop, false);
  made!.fire('ended');
  assert.equal(player.soundState().id, 's2');
  assert.equal(player.soundState().queueIndex, 1);
  player.nextSound();
  assert.equal(player.soundState().id, 's3');
  made!.fire('ended');
  assert.equal(player.soundState().playing, false, 'the end of the list stops without Loop');
  player.setSoundLoop(true);
  assert.equal(made!.loop, false, 'Loop on a playlist is the list, not one sound');
  made!.fire('ended');
  assert.equal(player.soundState().id, 's1', 'Loop starts the list over');
  made!.currentTime = 5;
  player.previousSound();
  assert.equal(made!.currentTime, 0, 'back restarts a sound that has been playing');
  player.forgetSound('s2');
  assert.deepEqual(player.soundState().queue!.map((x) => x.id), ['s1', 's3']);
  player.playSound(s(4));
  assert.equal(player.soundState().queue, null);
  assert.equal(made!.loop, true, 'a single sound loops itself');
  player.stopSound();
  player.setSoundLoop(false);
});
