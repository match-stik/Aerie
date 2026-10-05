// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ClientMessage } from '@aerie/shared';
import type { VoiceService } from '../../voice.js';
import type { RealtimeProsodySession } from '../../hume-realtime-prosody.js';
import type { ExtendedWebSocket } from '../connection-registry.js';
import {
  MAX_AUDIO_CHUNKS_PER_RECORDING,
  handleVoiceAudio,
  handleVoiceCancel,
  handleVoiceStart,
  handleVoiceStop,
  setVoiceService,
} from './voice-handlers.js';

class FakeRealtimeSession implements RealtimeProsodySession {
  readonly audio: Buffer[] = [];
  finishCalls = 0;
  abortCalls = 0;

  constructor(private readonly result: Record<string, number> | null = {
    Amusement: 0.88,
    Interest: 0.71,
  }) {}

  pushAudio(chunk: Buffer): void {
    this.audio.push(Buffer.from(chunk));
  }

  async finish(): Promise<Record<string, number> | null> {
    this.finishCalls += 1;
    return this.result;
  }

  abort(): void {
    this.abortCalls += 1;
  }
}

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
    voiceAnalyzeToneRequested: false,
    activeRecordingId: null,
    transcriptionAbort: null,
    deviceType: 'mobile',
    userAgent: '',
    tabVisible: true,
    messageCount: 0,
    messageWindowStart: Date.now(),
    prosodyAbort: null,
    realtimeProsody: null,
    sentMessages,
    send(data: string): void {
      sentMessages.push(JSON.parse(data));
    },
  } as unknown as ExtendedWebSocket & { sentMessages: Array<Record<string, unknown>> };
}

test('conversation tone opt-in streams beside transcription and attaches bounded EVI scores', async () => {
  const realtime = new FakeRealtimeSession();
  let createCalls = 0;
  const fakeVoiceService = {
    canTranscribe: true,
    canAnalyzeProsody: true,
    canAnalyzeRealtimeProsody: true,
    createRealtimeProsodySession(): RealtimeProsodySession {
      createCalls += 1;
      return realtime;
    },
    async transcribe(): Promise<string> {
      return 'I am testing my tone.';
    },
    async analyzeProsody(): Promise<Record<string, number>> {
      throw new Error('batch analysis must not run for conversation mode');
    },
  } as unknown as VoiceService;
  setVoiceService(fakeVoiceService);

  const ws = makeWs();
  handleVoiceStart(ws, {
    type: 'voice_start',
    mode: 'conversation',
    recordingId: 'tone-1',
    analyzeTone: true,
  } as Extract<ClientMessage, { type: 'voice_start' }> & { analyzeTone: boolean });
  // EVI opens alongside the opted-in recorder so every original WebM blob is
  // streamed live without byte gaps or a burst-replayed backlog.
  assert.equal(createCalls, 1);
  handleVoiceAudio(ws, {
    type: 'voice_audio',
    data: Buffer.from('header').toString('base64'),
    recordingId: 'tone-1',
  });
  handleVoiceAudio(ws, {
    type: 'voice_audio',
    data: Buffer.from('audio').toString('base64'),
    recordingId: 'tone-1',
  });
  await handleVoiceStop(ws, { type: 'voice_stop', recordingId: 'tone-1' });

  assert.equal(createCalls, 1);
  assert.deepEqual(realtime.audio, [Buffer.from('header'), Buffer.from('audio')]);
  assert.equal(realtime.finishCalls, 1);
  assert.deepEqual(ws.sentMessages.at(-1), {
    type: 'transcription_status',
    status: 'complete',
    text: 'I am testing my tone.',
    prosody: { Amusement: 0.88, Interest: 0.71 },
    prosodyStatus: 'complete',
    recordingId: 'tone-1',
  });
});

test('tone-disabled conversation does not create a sidecar and dictation keeps batch analysis', async () => {
  let createCalls = 0;
  let batchCalls = 0;
  const fakeVoiceService = {
    canTranscribe: true,
    canAnalyzeProsody: true,
    canAnalyzeRealtimeProsody: true,
    createRealtimeProsodySession(): RealtimeProsodySession {
      createCalls += 1;
      return new FakeRealtimeSession();
    },
    async transcribe(): Promise<string> {
      return 'dictated';
    },
    async analyzeProsody(): Promise<Record<string, number>> {
      batchCalls += 1;
      return { Calmness: 0.64 };
    },
  } as unknown as VoiceService;
  setVoiceService(fakeVoiceService);

  const conversationWs = makeWs();
  handleVoiceStart(conversationWs, {
    type: 'voice_start',
    mode: 'conversation',
    analyzeTone: false,
  } as Extract<ClientMessage, { type: 'voice_start' }> & { analyzeTone: boolean });
  assert.equal(createCalls, 0);
  handleVoiceCancel(conversationWs, { type: 'voice_cancel' });

  const dictationWs = makeWs();
  handleVoiceStart(dictationWs, {
    type: 'voice_start',
    mode: 'dictation',
    analyzeTone: true,
  } as Extract<ClientMessage, { type: 'voice_start' }> & { analyzeTone: boolean });
  handleVoiceAudio(dictationWs, { type: 'voice_audio', data: Buffer.from('audio').toString('base64') });
  await handleVoiceStop(dictationWs);

  assert.equal(createCalls, 0);
  assert.equal(batchCalls, 1);
  assert.deepEqual(dictationWs.sentMessages.at(-1)?.prosody, { Calmness: 0.64 });
});

test('empty chunks are rejected without being forwarded', () => {
  const realtime = new FakeRealtimeSession();
  const fakeVoiceService = {
    canAnalyzeRealtimeProsody: true,
    createRealtimeProsodySession: () => realtime,
  } as unknown as VoiceService;
  setVoiceService(fakeVoiceService);

  const ws = makeWs();
  handleVoiceStart(ws, {
    type: 'voice_start',
    mode: 'conversation',
    analyzeTone: true,
  } as Extract<ClientMessage, { type: 'voice_start' }> & { analyzeTone: boolean });
  handleVoiceAudio(ws, { type: 'voice_audio', data: '' });

  assert.deepEqual(realtime.audio, []);
  assert.deepEqual(ws.sentMessages.at(-1), {
    type: 'error',
    code: 'empty_audio_chunk',
    message: 'Audio chunk was empty',
  });
  handleVoiceCancel(ws, { type: 'voice_cancel' });
});

test('stale audio frames cannot cross recording ids', () => {
  const realtime = new FakeRealtimeSession();
  let createCalls = 0;
  const fakeVoiceService = {
    canAnalyzeRealtimeProsody: true,
    createRealtimeProsodySession: () => {
      createCalls += 1;
      return realtime;
    },
  } as unknown as VoiceService;
  setVoiceService(fakeVoiceService);

  const ws = makeWs();
  handleVoiceStart(ws, {
    type: 'voice_start',
    mode: 'conversation',
    analyzeTone: true,
    recordingId: 'new-turn',
  });
  handleVoiceAudio(ws, {
    type: 'voice_audio',
    recordingId: 'old-turn',
    data: Buffer.from('stale').toString('base64'),
  });

  assert.deepEqual(ws.audioChunks, []);
  assert.equal(createCalls, 1);
  handleVoiceCancel(ws, { type: 'voice_cancel', recordingId: 'new-turn' });
});

test('an opted-in turn reports a nonfatal unavailable tone reading', async () => {
  const realtime = new FakeRealtimeSession(null);
  const fakeVoiceService = {
    canTranscribe: true,
    canAnalyzeRealtimeProsody: true,
    createRealtimeProsodySession: () => realtime,
    async transcribe(): Promise<string> {
      return 'My words still work.';
    },
  } as unknown as VoiceService;
  setVoiceService(fakeVoiceService);

  const ws = makeWs();
  handleVoiceStart(ws, {
    type: 'voice_start',
    mode: 'conversation',
    analyzeTone: true,
    recordingId: 'tone-miss',
  });
  handleVoiceAudio(ws, {
    type: 'voice_audio',
    data: Buffer.from('audio').toString('base64'),
    recordingId: 'tone-miss',
  });
  await handleVoiceStop(ws, { type: 'voice_stop', recordingId: 'tone-miss' });

  assert.deepEqual(ws.sentMessages.at(-1), {
    type: 'transcription_status',
    status: 'complete',
    text: 'My words still work.',
    prosodyStatus: 'unavailable',
    recordingId: 'tone-miss',
  });
});

test('the per-recording frame cap closes an abusive capture', () => {
  const fakeVoiceService = { canAnalyzeRealtimeProsody: false } as unknown as VoiceService;
  setVoiceService(fakeVoiceService);

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
