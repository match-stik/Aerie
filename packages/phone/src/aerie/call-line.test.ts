// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldUseCallLine, absoluteVoiceUrl } from './call-line';

// The call line is only for the case that cut the owner off: Aerie hidden, the call
// holding the mic, the car on Bluetooth. Anywhere else the music line stays.

test('hidden, over Bluetooth, with the plugin: the call line', () => {
  assert.equal(shouldUseCallLine({ pluginAvailable: true, pageHidden: true, bluetoothCall: true }), true);
});

test('on screen the music line stays, because the mic is handed back first', () => {
  assert.equal(shouldUseCallLine({ pluginAvailable: true, pageHidden: false, bluetoothCall: true }), false);
});

test('on the phone speaker the music line stays, because a call would use the earpiece', () => {
  assert.equal(shouldUseCallLine({ pluginAvailable: true, pageHidden: true, bluetoothCall: false }), false);
});

test('an APK without the plugin keeps the old road', () => {
  assert.equal(shouldUseCallLine({ pluginAvailable: false, pageHidden: true, bluetoothCall: true }), false);
});

test('a house path becomes an address the native player can open', () => {
  assert.equal(
    absoluteVoiceUrl('/api/voice/tts/abc.mp3?x=1', 'https://aerie.example/chat'),
    'https://aerie.example/api/voice/tts/abc.mp3?x=1',
  );
});
