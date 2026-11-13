// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@aerie/shared';
import type { VoiceService } from '../../voice.js';
import { buildTranscriptionHint } from '../../voice.js';
import { detectWhisperHallucination, detectTranscriptionHintEcho, trimHallucinatedTail, hasNoWords } from '../../voice-transcript-guard.js';
import type { ExtendedWebSocket } from '../connection-registry.js';

let voiceServiceInstance: VoiceService | null = null;

export function setVoiceService(vs: VoiceService): void {
  voiceServiceInstance = vs;
}

export function getVoiceService(): VoiceService | null {
  return voiceServiceInstance;
}

const MAX_AUDIO_BUFFER_SIZE = 25 * 1024 * 1024; // 25MB security cap
// At the opted-in 100ms cadence this allows five minutes of one uninterrupted
// utterance while still bounding frames that bypass the general WS rate cap.
export const MAX_AUDIO_CHUNKS_PER_RECORDING = 3_000;

function safeAudioMimeType(value?: string): string {
  const candidate = value?.trim().toLowerCase();
  if (!candidate || candidate.length > 100) return 'audio/webm';
  return /^audio\/[a-z0-9.+-]+(?:;\s*codecs=[a-z0-9.,_+-]+)?$/.test(candidate)
    ? candidate
    : 'audio/webm';
}

function sendError(ws: ExtendedWebSocket, code: string, message: string): void {
  const msg: ServerMessage = { type: 'error', code, message };
  ws.send(JSON.stringify(msg));
}

function sendCaptureError(ws: ExtendedWebSocket, code: string, message: string): void {
  sendError(ws, code, message);
  const status: ServerMessage = {
    type: 'transcription_status',
    status: 'error',
    error: message,
    ...(ws.activeRecordingId && { recordingId: ws.activeRecordingId }),
  };
  ws.send(JSON.stringify(status));
}

function matchesActiveRecording(ws: ExtendedWebSocket, recordingId: unknown): boolean {
  return recordingId === undefined || (
    typeof recordingId === 'string'
    && (!ws.activeRecordingId || recordingId === ws.activeRecordingId)
  );
}

function discardActiveCapture(ws: ExtendedWebSocket): void {
  ws.isRecording = false;
  ws.audioChunks = [];
  ws.audioBytes = 0;
  ws.voiceAudioChunkCount = 0;
  ws.activeRecordingId = null;
}

// --- Voice handlers ---

export function handleVoiceStart(
  ws: ExtendedWebSocket,
  msg: Extract<ClientMessage, { type: 'voice_start' }>,
): void {
  // A fresh utterance supersedes any transcription still winding down from
  // the previous one. This matters in conversation mode, where a quick
  // retry must never let an older result arrive after the newer turn.
  ws.transcriptionAbort?.abort();
  ws.transcriptionAbort = null;
  ws.audioChunks = [];
  ws.audioBytes = 0;
  ws.voiceAudioChunkCount = 0;
  ws.isRecording = true;
  ws.audioMimeType = safeAudioMimeType(msg.mimeType);
  ws.voiceCaptureMode = msg.mode || 'dictation';
  ws.activeRecordingId = typeof msg.recordingId === 'string' ? msg.recordingId : null;
}

export function handleVoiceAudio(
  ws: ExtendedWebSocket,
  msg: Extract<ClientMessage, { type: 'voice_audio' }>,
): void {
  if (!ws.isRecording) return;
  if (!matchesActiveRecording(ws, (msg as { recordingId?: unknown }).recordingId)) return;
  ws.voiceAudioChunkCount += 1;
  if (ws.voiceAudioChunkCount > MAX_AUDIO_CHUNKS_PER_RECORDING) {
    sendCaptureError(ws, 'too_many_audio_chunks', `Audio recording exceeds ${MAX_AUDIO_CHUNKS_PER_RECORDING} chunk limit`);
    discardActiveCapture(ws);
    return;
  }

  const chunk = Buffer.from(msg.data, 'base64');
  if (chunk.length === 0) {
    sendError(ws, 'empty_audio_chunk', 'Audio chunk was empty');
    return;
  }

  if (ws.audioBytes + chunk.length > MAX_AUDIO_BUFFER_SIZE) {
    sendCaptureError(ws, 'audio_too_large', `Audio recording exceeds ${MAX_AUDIO_BUFFER_SIZE / (1024 * 1024)}MB limit`);
    discardActiveCapture(ws);
    return;
  }

  ws.audioChunks.push(chunk);
  ws.audioBytes += chunk.length;
}

export async function handleVoiceStop(
  ws: ExtendedWebSocket,
  msg?: Extract<ClientMessage, { type: 'voice_stop' }>,
): Promise<void> {
  if (!matchesActiveRecording(ws, (msg as { recordingId?: unknown } | undefined)?.recordingId)) return;
  ws.isRecording = false;
  const recordingId = msg?.recordingId || ws.activeRecordingId || undefined;
  ws.voiceAudioChunkCount = 0;

  if (ws.audioChunks.length === 0) {
    const statusMsg: ServerMessage = {
      type: 'transcription_status',
      status: 'error',
      error: 'No audio data received',
      ...(recordingId && { recordingId }),
    };
    ws.send(JSON.stringify(statusMsg));
    ws.activeRecordingId = null;
    return;
  }

  const processingMsg: ServerMessage = {
    type: 'transcription_status',
    status: 'processing',
    ...(recordingId && { recordingId }),
  };
  ws.send(JSON.stringify(processingMsg));

  const audioBuffer = Buffer.concat(ws.audioChunks);
  ws.audioChunks = [];
  ws.audioBytes = 0;

  if (!voiceServiceInstance?.canTranscribe) {
    const errorMsg: ServerMessage = {
      type: 'transcription_status',
      status: 'error',
      error: 'Transcription not configured — add a Groq or ElevenLabs API key in Integrations',
      ...(recordingId && { recordingId }),
    };
    ws.send(JSON.stringify(errorMsg));
    ws.activeRecordingId = null;
    return;
  }

  try {
    const transcriptionAbort = new AbortController();
    ws.transcriptionAbort = transcriptionAbort;

    let transcript = await voiceServiceInstance.transcribe(
      audioBuffer,
      ws.audioMimeType,
      transcriptionAbort.signal,
    );

    if (ws.transcriptionAbort !== transcriptionAbort) return;
    ws.transcriptionAbort = null;

    // A lone dot or comma is Whisper's answer to silence, not speech.
    if (hasNoWords(transcript)) {
      if (transcript.trim()) console.warn(`[Voice] Transcript had no words ("${transcript.trim()}"), treated as no speech`);
      const emptyMsg: ServerMessage = {
        type: 'transcription_status',
        status: 'error',
        error: 'No speech detected',
        ...(recordingId && { recordingId }),
      };
      ws.send(JSON.stringify(emptyMsg));
      return;
    }

    // Real speech with a hallucinated tail keeps the speech (Nov 9 2026).
    const untrimmed = transcript;
    transcript = trimHallucinatedTail(transcript);
    if (transcript !== untrimmed) {
      console.warn(`[Voice] Trimmed a hallucinated tail: "${untrimmed.slice(transcript.replace(/\.$/, '').length).trim()}"`);
    }

    // Whisper's stock sign-off phrases replaced real speech twice on Jul 21,
    // 2026. When the whole utterance is one of them, ask for a repeat instead
    // of delivering a video outro as the user's words.
    const stockPhrase = detectWhisperHallucination(transcript);
    if (stockPhrase) {
      console.warn(`[Voice] Transcript rejected as Whisper stock phrase: "${transcript.trim()}"`);
      const suspectMsg: ServerMessage = {
        type: 'transcription_status',
        status: 'error',
        error: `Whisper answered with its stock phrase ("${stockPhrase}") instead of your words — a known hallucination, not you. Say that again for me?`,
        ...(recordingId && { recordingId }),
      };
      ws.send(JSON.stringify(suspectMsg));
      return;
    }

    // Same reflex, different nearby text: the spelling hint itself coming back
    // as speech. It biases the decode; it is never something the user said.
    if (detectTranscriptionHintEcho(transcript, buildTranscriptionHint())) {
      console.warn(`[Voice] Transcript rejected as spelling-hint echo: "${transcript.trim()}"`);
      const echoMsg: ServerMessage = {
        type: 'transcription_status',
        status: 'error',
        error: 'Whisper read our own name list back instead of your words — a known hallucination, not you. Say that again for me?',
        ...(recordingId && { recordingId }),
      };
      ws.send(JSON.stringify(echoMsg));
      return;
    }

    const completeMsg: ServerMessage = {
      type: 'transcription_status',
      status: 'complete',
      text: transcript,
      ...(recordingId && { recordingId }),
    };
    ws.send(JSON.stringify(completeMsg));
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') return;
    console.error('[Voice] Transcription error:', error);
    const errorMsg: ServerMessage = {
      type: 'transcription_status',
      status: 'error',
      error: error instanceof Error ? error.message : 'Transcription failed',
      ...(recordingId && { recordingId }),
    };
    ws.send(JSON.stringify(errorMsg));
  } finally {
    if (ws.activeRecordingId === recordingId || (!ws.activeRecordingId && !recordingId)) {
      ws.activeRecordingId = null;
    }
  }
}

export function handleVoiceCancel(
  ws: ExtendedWebSocket,
  msg: Extract<ClientMessage, { type: 'voice_cancel' }>,
): void {
  if (!matchesActiveRecording(ws, (msg as { recordingId?: unknown }).recordingId)) return;
  ws.isRecording = false;
  ws.audioChunks = [];
  ws.audioBytes = 0;
  ws.voiceAudioChunkCount = 0;
  ws.activeRecordingId = null;
  ws.transcriptionAbort?.abort();
  ws.transcriptionAbort = null;
}

export function handleVoiceMode(
  ws: ExtendedWebSocket,
  msg: Extract<ClientMessage, { type: 'voice_mode' }>,
): void {
  ws.voiceModeEnabled = msg.enabled;
  console.log(`[Voice] Voice mode ${msg.enabled ? 'enabled' : 'disabled'} for connection`);

  const ackMsg: ServerMessage = {
    type: 'voice_mode_ack',
    enabled: msg.enabled,
  };
  ws.send(JSON.stringify(ackMsg));
}

export async function generateAndStreamTTS(
  text: string,
  messageId: string,
  connections: ExtendedWebSocket[],
): Promise<void> {
  if (!voiceServiceInstance) return;

  const startMsg = JSON.stringify({ type: 'tts_start', messageId } satisfies ServerMessage);
  for (const ws of connections) {
    if (ws.readyState === WebSocket.OPEN) ws.send(startMsg);
  }

  try {
    const audioBuffer = await voiceServiceInstance.generateTTS(text);
    const base64 = audioBuffer.toString('base64');

    const audioMsg = JSON.stringify({
      type: 'tts_audio',
      messageId,
      data: base64,
      final: true,
    } satisfies ServerMessage);

    for (const ws of connections) {
      if (ws.readyState === WebSocket.OPEN) ws.send(audioMsg);
    }
  } catch (error) {
    console.error('[Voice] TTS generation error:', error);
  }

  const endMsg = JSON.stringify({ type: 'tts_end', messageId } satisfies ServerMessage);
  for (const ws of connections) {
    if (ws.readyState === WebSocket.OPEN) ws.send(endMsg);
  }
}
