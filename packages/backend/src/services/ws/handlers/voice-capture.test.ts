// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { VoiceService } from '../../voice.js';
import type { ExtendedWebSocket } from '../connection-registry.js';
import {
  MAX_AUDIO_CHUNKS_PER_RECORDING,
  handleVoiceAudio,
  handleVoiceCancel,
  handleVoiceStart,
  handleVoiceStop,
  setVoiceService,
} from './voice-handlers.js';

// The capture path for a voice turn: chunks in, one transcript out. The Hume
// tone sidecar that used to ride beside it was removed when Hume discontinued
// its Expression Measurement API (Nov 13 2026).

function makeWs(): ExtendedWebSocket & { sentMessages: Array<Record<string, unknown>> } {
  const sentMessages: Array<Record<string, unknown>> = [];
  return {
    isAlive: true,
    userId: 'user',
    voiceModeEnabled: true,
    audioChunks: [],
    audioBytes: 0,
    voiceAudioChunkCount: 0,
    isRecording: false,
    audioMimeType: 'audio/webm',
    voiceCaptureMode: 'dictation',
    activeRecordingId: null,
    transcriptionAbort: null,
    deviceType: 'mobile',
    userAgent: '',
    tabVisible: true,
    messageCount: 0,
    messageWindowStart: Date.now(),
    sentMessages,
    send(data: string): void {
      sentMessages.push(JSON.parse(data));
    },
  } as unknown as ExtendedWebSocket & { sentMessages: Array<Record<string, unknown>> };
}

test('a finished voice turn sends the transcript and nothing about tone', async () => {
  setVoiceService({
    canTranscribe: true,
    async transcribe(): Promise<string> {
      return 'My words still work.';
    },
  } as unknown as VoiceService);

  const ws = makeWs();
  handleVoiceStart(ws, { type: 'voice_start', mode: 'conversation', recordingId: 'turn-1' });
  handleVoiceAudio(ws, { type: 'voice_audio', data: Buffer.from('audio').toString('base64'), recordingId: 'turn-1' });
  await handleVoiceStop(ws, { type: 'voice_stop', recordingId: 'turn-1' });

  assert.deepEqual(ws.sentMessages.at(-1), {
    type: 'transcription_status',
    status: 'complete',
    text: 'My words still work.',
    recordingId: 'turn-1',
  });
});

test('empty chunks are rejected without being buffered', () => {
  setVoiceService({} as unknown as VoiceService);
  const ws = makeWs();
  handleVoiceStart(ws, { type: 'voice_start', mode: 'conversation' });
  handleVoiceAudio(ws, { type: 'voice_audio', data: '' });

  assert.deepEqual(ws.audioChunks, []);
  assert.deepEqual(ws.sentMessages.at(-1), {
    type: 'error',
    code: 'empty_audio_chunk',
    message: 'Audio chunk was empty',
  });
  handleVoiceCancel(ws, { type: 'voice_cancel' });
});

test('stale audio frames cannot cross recording ids', () => {
  setVoiceService({} as unknown as VoiceService);
  const ws = makeWs();
  handleVoiceStart(ws, { type: 'voice_start', mode: 'conversation', recordingId: 'new-turn' });
  handleVoiceAudio(ws, {
    type: 'voice_audio',
    recordingId: 'old-turn',
    data: Buffer.from('stale').toString('base64'),
  });

  assert.deepEqual(ws.audioChunks, []);
  handleVoiceCancel(ws, { type: 'voice_cancel', recordingId: 'new-turn' });
});

test('the per-recording frame cap closes an abusive capture', () => {
  setVoiceService({} as unknown as VoiceService);
  const ws = makeWs();
  handleVoiceStart(ws, { type: 'voice_start', mode: 'conversation' });
  ws.voiceAudioChunkCount = MAX_AUDIO_CHUNKS_PER_RECORDING;
  handleVoiceAudio(ws, { type: 'voice_audio', data: Buffer.from('x').toString('base64') });

  assert.equal(ws.isRecording, false);
  assert.equal(ws.audioBytes, 0);
  assert.deepEqual(ws.audioChunks, []);
  const limitMessage = `Audio recording exceeds ${MAX_AUDIO_CHUNKS_PER_RECORDING} chunk limit`;
  assert.deepEqual(ws.sentMessages.slice(-2), [
    { type: 'error', code: 'too_many_audio_chunks', message: limitMessage },
    { type: 'transcription_status', status: 'error', error: limitMessage },
  ]);
});
