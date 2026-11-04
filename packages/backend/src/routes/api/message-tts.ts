// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { Router, type Response as ExpressResponse } from 'express';
import crypto from 'crypto';
import { pipeWholeStream, wakeWholeStreamWaiters, wholeFromFinished } from '../../services/tts-whole.js';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { getMessage, getConfigBool } from '../../services/db.js';
import { saveFile, getFile } from '../../services/files.js';
import type { VoiceService } from '../../services/voice.js';
import { PROVIDER_MAX_REQUEST_CHARS, splitSegmentsForRender } from '../../services/voice-speaker-split.js';
import { prepareTextForTTS } from '../../services/tts-text.js';

const router = Router();


type MessageTtsRender = {
  success: true;
  cached: false;
  fileId: string;
  url: string;
};

// The voice overlay and a message bubble can ask for the same fresh reply at
// nearly the same time. ElevenLabs work is paid and the cache row is unique,
// so one process owns each message render and every concurrent caller awaits
// that result instead of synthesizing a duplicate.
const messageTtsRenders = new Map<string, Promise<MessageTtsRender>>();

type LiveTtsSubscriber = {
  res: ExpressResponse;
  cursor: number;
  flushing: boolean;
  closed: boolean;
};

type LiveTtsSegment = {
  index: number;
  voice: string;
  text: string;
  chunks: Buffer[];
  byteLength: number;
  state: 'pending' | 'streaming' | 'complete' | 'error';
  error?: Error;
  subscribers: Set<LiveTtsSubscriber>;
  /** The whole-reply stream (tts-whole.ts) waits here for the next chunk. */
  waiters: Set<() => void>;
  completion: Promise<Buffer>;
  resolveCompletion: (buffer: Buffer) => void;
  rejectCompletion: (error: Error) => void;
};

type MessageTtsStreamJob = {
  id: string;
  messageId: string;
  segments: LiveTtsSegment[];
  createdAt: number;
};

// A stream job is both a live relay and a replay buffer. Starting the manifest
// starts every ElevenLabs request; opening a segment URL merely subscribes to
// that existing work, so Android media probes, retries, and a second overlay
// never create another paid render.
const messageTtsStreamJobs = new Map<string, MessageTtsStreamJob>();
const messageTtsStreamJobsByMessage = new Map<string, MessageTtsStreamJob>();
const MESSAGE_TTS_STREAM_REPLAY_TTL_MS = 15 * 60 * 1000;

function createLiveTtsSegment(index: number, voice: string, text: string): LiveTtsSegment {
  let resolveCompletion!: (buffer: Buffer) => void;
  let rejectCompletion!: (error: Error) => void;
  const completion = new Promise<Buffer>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  return {
    index,
    voice,
    text,
    chunks: [],
    byteLength: 0,
    state: 'pending',
    subscribers: new Set(),
    waiters: new Set(),
    completion,
    resolveCompletion,
    rejectCompletion,
  };
}

function getMessageTtsStreamManifest(job: MessageTtsStreamJob) {
  return {
    success: true,
    cached: false,
    streaming: true,
    jobId: job.id,
    segments: job.segments.map((segment) => ({
      index: segment.index,
      voice: segment.voice,
      url: `/api/messages/${job.messageId}/tts/stream/${job.id}/${segment.index}`,
    })),
    // Every piece in order as one stream, for a phone that has to keep playing
    // with the app in the background (tts-whole.ts). Only worth offering when
    // there is more than one piece.
    ...(job.segments.length > 1 ? { wholeUrl: `/api/messages/${job.messageId}/tts/stream/${job.id}/all` } : {}),
  };
}

function scheduleMessageTtsStreamCleanup(job: MessageTtsStreamJob): void {
  setTimeout(() => {
    if (messageTtsStreamJobs.get(job.id) === job) messageTtsStreamJobs.delete(job.id);
    if (messageTtsStreamJobsByMessage.get(job.messageId) === job) {
      messageTtsStreamJobsByMessage.delete(job.messageId);
    }
  }, MESSAGE_TTS_STREAM_REPLAY_TTL_MS).unref?.();
}

function writeLiveAudioHeaders(res: ExpressResponse): void {
  if (res.headersSent) return;
  res.status(200);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'private, no-store, no-transform');
  // Explicitly disable reverse-proxy buffering. The whole purpose of this
  // route is for the first MP3 frames to reach the native player immediately.
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.flushHeaders();
}

function waitForSubscriberDrain(subscriber: LiveTtsSubscriber): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      subscriber.res.off('drain', finish);
      subscriber.res.off('close', finish);
      resolve();
    };
    subscriber.res.once('drain', finish);
    subscriber.res.once('close', finish);
  });
}

/** Flush one listener independently so a slow recorder cannot stall the provider or other listeners. */
function flushLiveTtsSubscriber(segment: LiveTtsSegment, subscriber: LiveTtsSubscriber): void {
  if (subscriber.flushing || subscriber.closed) return;
  subscriber.flushing = true;

  void (async () => {
    try {
      // Do not commit a 200 audio response while the provider request is still
      // pending. If ElevenLabs rejects its key/voice, the subscriber can still
      // receive a useful JSON 502 rather than a mysteriously empty MP3.
      if (segment.state === 'pending') return;
      if (segment.state === 'error') {
        if (!subscriber.res.headersSent) {
          subscriber.res.status(502).json({ error: segment.error?.message || 'TTS stream failed' });
        } else {
          subscriber.res.destroy(segment.error);
        }
        subscriber.closed = true;
        return;
      }

      // Keep the response uncommitted until the first real audio frame. A
      // provider can accept the request and still fail while reading its body;
      // in that case the caller should receive a useful JSON 502, not a blank
      // 200 audio stream whose headers happened to arrive first.
      if (segment.state === 'streaming' && segment.chunks.length === 0) return;

      writeLiveAudioHeaders(subscriber.res);
      while (!subscriber.closed && subscriber.cursor < segment.chunks.length) {
        const chunk = segment.chunks[subscriber.cursor++];
        if (!subscriber.res.write(chunk)) await waitForSubscriberDrain(subscriber);
      }

      const stateAfterFlush = segment.state as LiveTtsSegment['state'];
      if (!subscriber.closed && stateAfterFlush === 'complete') {
        subscriber.res.end();
        subscriber.closed = true;
      } else if (!subscriber.closed && stateAfterFlush === 'error') {
        subscriber.res.destroy(segment.error);
        subscriber.closed = true;
      }
    } finally {
      subscriber.flushing = false;
      if (subscriber.closed) {
        segment.subscribers.delete(subscriber);
      } else if (
        subscriber.cursor < segment.chunks.length
        || segment.state === 'complete'
        || segment.state === 'error'
      ) {
        queueMicrotask(() => flushLiveTtsSubscriber(segment, subscriber));
      }
    }
  })();
}

function publishLiveTtsChunk(segment: LiveTtsSegment, chunk: Buffer): void {
  if (!chunk.length || segment.state === 'error' || segment.state === 'complete') return;
  segment.chunks.push(chunk);
  segment.byteLength += chunk.length;
  for (const subscriber of segment.subscribers) flushLiveTtsSubscriber(segment, subscriber);
  wakeWholeStreamWaiters(segment);
}

function completeLiveTtsSegment(segment: LiveTtsSegment): void {
  if (segment.state === 'complete' || segment.state === 'error') return;
  const buffer = Buffer.concat(segment.chunks, segment.byteLength);
  if (!buffer.length) {
    failLiveTtsSegment(segment, new Error('ElevenLabs stream completed without audio'));
    return;
  }
  segment.state = 'complete';
  segment.resolveCompletion(buffer);
  for (const subscriber of segment.subscribers) flushLiveTtsSubscriber(segment, subscriber);
  wakeWholeStreamWaiters(segment);
}

function failLiveTtsSegment(segment: LiveTtsSegment, error: unknown): void {
  if (segment.state === 'complete' || segment.state === 'error') return;
  segment.error = error instanceof Error ? error : new Error(String(error));
  segment.state = 'error';
  segment.rejectCompletion(segment.error);
  for (const subscriber of segment.subscribers) flushLiveTtsSubscriber(segment, subscriber);
  wakeWholeStreamWaiters(segment);
}

async function pumpLiveTtsSegment(segment: LiveTtsSegment, voiceService: VoiceService): Promise<void> {
  try {
    const stream = await voiceService.streamTTS(segment.text, segment.voice);
    segment.state = 'streaming';
    for (const subscriber of segment.subscribers) flushLiveTtsSubscriber(segment, subscriber);

    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        publishLiveTtsChunk(segment, Buffer.from(value));
      }
    } catch (error) {
      // Cancelling the wrapper releases VoiceService's global provider slot;
      // merely dropping our reader lock could otherwise strand the queued
      // third companion after a local relay failure.
      await reader.cancel(error).catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    completeLiveTtsSegment(segment);
  } catch (error) {
    failLiveTtsSegment(segment, error);
  }
}

function sendCompletedTtsSegment(
  req: { headers: { range?: string }; method?: string },
  res: ExpressResponse,
  buffer: Buffer,
): void {
  const range = req.headers.range;
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'private, max-age=900, no-transform');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (!range) {
    res.status(200).setHeader('Content-Length', buffer.length);
    if (req.method === 'HEAD') res.end();
    else res.end(buffer);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) {
    res.status(416).setHeader('Content-Range', `bytes */${buffer.length}`).end();
    return;
  }
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      res.status(416).setHeader('Content-Range', `bytes */${buffer.length}`).end();
      return;
    }
    start = Math.max(0, buffer.length - suffixLength);
    end = buffer.length - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : buffer.length - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= buffer.length || end < start) {
    res.status(416).setHeader('Content-Range', `bytes */${buffer.length}`).end();
    return;
  }
  end = Math.min(end, buffer.length - 1);
  const body = buffer.subarray(start, end + 1);
  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${buffer.length}`);
  res.setHeader('Content-Length', body.length);
  if (req.method === 'HEAD') res.end();
  else res.end(body);
}

// Start ordered per-companion TTS streams. The manifest is intentionally
// cheap: all producer jobs begin before this response returns, while each URL
// can be opened later in speaking order and will replay everything buffered so
// far before following live chunks.
router.post('/messages/:id/tts/stream', async (req, res) => {
  try {
    const id = req.params.id;
    const message = getMessage(id);
    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    if (message.deleted_at) {
      res.status(400).json({ error: 'Cannot read aloud a deleted message' });
      return;
    }
    if (message.content_type !== 'text' || !message.content) {
      res.status(400).json({ error: 'Only text messages can be read aloud' });
      return;
    }

    const { getMessageTts, insertMessageTts } = await import('../../services/db.js');
    const { VoiceService } = await import('../../services/voice.js');

    const cached = getMessageTts(id);
    if (cached) {
      const url = `/api/files/${cached.file_id}`;
      res.json({
        success: true,
        cached: true,
        streaming: false,
        fileId: cached.file_id,
        url,
        segments: [{ index: 0, voice: cached.voice_used || 'default', url }],
      });
      return;
    }

    const activeJob = messageTtsStreamJobsByMessage.get(id);
    if (activeJob) {
      res.json(getMessageTtsStreamManifest(activeJob));
      return;
    }

    const voiceService = req.app.locals.voiceService as VoiceService | undefined;
    if (!voiceService?.canTTS) {
      res.status(503).json({ error: 'TTS not configured' });
      return;
    }

    // If the classic read-aloud route won the race, do not start another paid
    // render. Expose its eventual cached file through one replayable segment;
    // this case loses progressive playback for this turn but preserves the
    // stronger no-duplicate invariant.
    const existingRender = messageTtsRenders.get(id);
    if (existingRender) {
      const segment = createLiveTtsSegment(0, 'multi', '');
      const job: MessageTtsStreamJob = {
        id: crypto.randomUUID(),
        messageId: id,
        segments: [segment],
        createdAt: Date.now(),
      };
      messageTtsStreamJobs.set(job.id, job);
      messageTtsStreamJobsByMessage.set(id, job);

      void existingRender.then((rendered) => {
        const file = getFile(rendered.fileId);
        if (!file) throw new Error('Completed TTS cache file is missing');
        segment.state = 'streaming';
        publishLiveTtsChunk(segment, readFileSync(file.path));
        completeLiveTtsSegment(segment);
      }).catch((error) => {
        failLiveTtsSegment(segment, error);
        if (messageTtsStreamJobsByMessage.get(id) === job) {
          messageTtsStreamJobsByMessage.delete(id);
        }
      });
      void segment.completion.then(
        () => scheduleMessageTtsStreamCleanup(job),
        () => scheduleMessageTtsStreamCleanup(job),
      );
      res.json(getMessageTtsStreamManifest(job));
      return;
    }

    const prepared = VoiceService.splitByCompanion(
      message.content,
      VoiceService.getVoiceCompanions(),
    ).map((segment) => ({ ...segment, text: prepareTextForTTS(segment.text, { readActionsAloud: getConfigBool('voice.read_actions_aloud', false) }) }))
      .filter((segment) => segment.text);
    if (!prepared.length) {
      res.status(400).json({ error: 'Message has no speakable text' });
      return;
    }

    // THE SAME CEILING APPLIES HERE. splitByCompanion cuts by SPEAKER, so a
    // single voice talking at length stays one segment and goes out as one
    // request — which is a 400 and no audio the moment it passes the provider
    // limit. Cut every voice into render-sized pieces as well, which is also
    // what lets the live relay start arriving instead of landing all at once.
    // splitSegmentsForRender widens `voice` to optional because it serves
    // callers that pass a bare voiceId; every piece here came out of
    // splitByCompanion, which always names one, so the fallback is the same
    // default the manifest already reports rather than a new guess.
    const defaultVoice = prepared[0]?.voice || 'default';
    const renderable = splitSegmentsForRender(prepared)
      .filter((segment) => segment.text)
      .map((segment) => ({ ...segment, voice: segment.voice ?? defaultVoice }));

    const job: MessageTtsStreamJob = {
      id: crypto.randomUUID(),
      messageId: id,
      segments: renderable.map((segment, index) => createLiveTtsSegment(index, segment.voice, segment.text)),
      createdAt: Date.now(),
    };
    // Publish both indexes synchronously before any producer awaits. A second
    // overlay or bubble request in the same turn will now attach to this job.
    messageTtsStreamJobs.set(job.id, job);
    messageTtsStreamJobsByMessage.set(id, job);

    const voiceUsed = new Set(prepared.map((segment) => segment.voice)).size > 1
      ? 'multi'
      : (prepared[0]?.voice || 'default');
    const render = (async (): Promise<MessageTtsRender> => {
      const buffers = await Promise.all(job.segments.map((segment) => segment.completion));
      const combined = await voiceService.stitchTTSBuffers(buffers);
      const fileMeta = saveFile(combined, `read-aloud-${id}.mp3`, 'audio/mpeg');
      insertMessageTts({
        messageId: id,
        fileId: fileMeta.fileId,
        voiceUsed,
        createdAt: new Date().toISOString(),
      });
      return {
        success: true,
        cached: false,
        fileId: fileMeta.fileId,
        url: fileMeta.url,
      };
    })();
    messageTtsRenders.set(id, render);

    // Start every segment now, not when its URL is opened. The shared service
    // gate admits two provider streams at once and queues any remaining voice;
    // by the time segment one ends, later voices are usually fully buffered.
    for (const segment of job.segments) void pumpLiveTtsSegment(segment, voiceService);

    void render.then(
      () => {
        if (messageTtsRenders.get(id) === render) messageTtsRenders.delete(id);
        scheduleMessageTtsStreamCleanup(job);
      },
      (error) => {
        console.error('[Read-aloud stream] Background cache failed:', error);
        if (messageTtsRenders.get(id) === render) messageTtsRenders.delete(id);
        if (messageTtsStreamJobsByMessage.get(id) === job) {
          messageTtsStreamJobsByMessage.delete(id);
        }
        scheduleMessageTtsStreamCleanup(job);
      },
    );

    res.json(getMessageTtsStreamManifest(job));
  } catch (error) {
    console.error('Read-aloud stream manifest error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'TTS stream failed',
    });
  }
});

// Subscribe to one already-started provider stream. Completed jobs support
// byte ranges for HTMLAudioElement probes/retries; live `bytes=0-` requests
// follow the progressive stream, while nonzero seeks wait for a complete MP3.
// Every piece of a read-aloud job, in order, as one stream (tts-whole.ts).
// Registered before the per-piece route so 'all' is never read as an index.
router.get('/messages/:id/tts/stream/:jobId/all', (req, res) => {
  const job = messageTtsStreamJobs.get(req.params.jobId);
  if (!job || job.messageId !== req.params.id) {
    res.status(404).json({ error: 'TTS stream not found or expired' });
    return;
  }
  if (req.method === 'HEAD') {
    res.status(200);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, no-store, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.end();
    return;
  }

  // A media player asking for a later range is resuming or seeking: answer it
  // from the finished whole once every piece is done, like the per-piece route.
  const requestedRange = req.headers.range;
  const everyPieceDone = job.segments.every((segment) => segment.state === 'complete');
  if (everyPieceDone || (requestedRange && requestedRange.trim() !== 'bytes=0-')) {
    let closed = false;
    res.once('close', () => { closed = true; });
    void Promise.all(job.segments.map((segment) => segment.completion)).then(
      (buffers) => {
        if (!closed) sendCompletedTtsSegment(req, res, wholeFromFinished(buffers));
      },
      (error) => {
        if (closed || res.headersSent) return;
        res.status(502).json({ error: error instanceof Error ? error.message : 'TTS stream failed' });
      },
    );
    return;
  }

  void pipeWholeStream(
    job.segments,
    res,
    () => writeLiveAudioHeaders(res),
    (message) => {
      if (!res.headersSent) res.status(502).json({ error: message });
    },
  ).catch((error) => {
    console.error('[Read-aloud stream] Whole-reply stream failed:', error);
    if (!res.headersSent) res.status(500).json({ error: 'TTS stream failed' });
    else res.destroy(error instanceof Error ? error : undefined);
  });
});

router.get('/messages/:id/tts/stream/:jobId/:segmentIndex', (req, res) => {
  const job = messageTtsStreamJobs.get(req.params.jobId);
  const index = Number(req.params.segmentIndex);
  if (!job || job.messageId !== req.params.id || !Number.isInteger(index)) {
    res.status(404).json({ error: 'TTS stream not found or expired' });
    return;
  }
  const segment = job.segments[index];
  if (!segment || segment.index !== index) {
    res.status(404).json({ error: 'TTS segment not found' });
    return;
  }

  if (segment.state === 'complete') {
    sendCompletedTtsSegment(req, res, Buffer.concat(segment.chunks, segment.byteLength));
    return;
  }
  if (segment.state === 'error') {
    res.status(502).json({ error: segment.error?.message || 'TTS stream failed' });
    return;
  }
  if (req.method === 'HEAD') {
    res.status(200);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, no-store, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.end();
    return;
  }

  const requestedRange = req.headers.range;
  if (requestedRange && requestedRange.trim() !== 'bytes=0-') {
    let closed = false;
    res.once('close', () => { closed = true; });
    void segment.completion.then(
      (buffer) => {
        if (!closed) sendCompletedTtsSegment(req, res, buffer);
      },
      (error) => {
        if (!closed && !res.headersSent) {
          res.status(502).json({ error: error instanceof Error ? error.message : 'TTS stream failed' });
        }
      },
    );
    return;
  }

  const subscriber: LiveTtsSubscriber = {
    res,
    cursor: 0,
    flushing: false,
    closed: false,
  };
  segment.subscribers.add(subscriber);
  res.once('close', () => {
    subscriber.closed = true;
    segment.subscribers.delete(subscriber);
  });
  flushLiveTtsSubscriber(segment, subscriber);
});

// Read message aloud — generate TTS and cache it
router.post('/messages/:id/tts', async (req, res) => {
  try {
    const id = req.params.id;
    const message = getMessage(id);
    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    if (message.deleted_at) {
      res.status(400).json({ error: 'Cannot read aloud a deleted message' });
      return;
    }
    if (message.content_type !== 'text' || !message.content) {
      res.status(400).json({ error: 'Only text messages can be read aloud' });
      return;
    }

    // Import TTS cache functions
    const { getMessageTts, insertMessageTts } = await import('../../services/db.js');
    const { VoiceService } = await import('../../services/voice.js');

    // Cache hit — return the existing audio without calling ElevenLabs
    const cached = getMessageTts(id);
    if (cached) {
      res.json({
        success: true,
        cached: true,
        fileId: cached.file_id,
        url: `/api/files/${cached.file_id}`,
      });
      return;
    }

    const voiceService = req.app.locals.voiceService as VoiceService | undefined;
    if (!voiceService?.canTTS) {
      res.status(503).json({ error: 'TTS not configured' });
      return;
    }

    let render = messageTtsRenders.get(id);
    let ownsRender = false;
    if (!render) {
      ownsRender = true;
      render = (async (): Promise<MessageTtsRender> => {
        const rawSegments = VoiceService.splitByCompanion(message.content, VoiceService.getVoiceCompanions());
        const readActionsAloud = getConfigBool('voice.read_actions_aloud', false);
        const segments = rawSegments.map(s => ({ ...s, text: prepareTextForTTS(s.text, { readActionsAloud }) })).filter(s => s.text);

        // EVERYTHING GOES THROUGH THE CHUNKED RENDERER, one voice or five.
        // The voice-note path learned this already; read-aloud kept the old
        // single-request branch, so a message in ONE voice was sent whole no
        // matter how long it was — and ElevenLabs refuses anything past its
        // own ceiling with a 400 and no audio. A long single-voice post is
        // exactly the case nothing here exercised until a user tried to listen
        // to one.
        const joined = segments.map(s => s.text).join(' ');
        let buffer: Buffer;
        let voiceUsed = new Set(segments.map((s) => s.voice)).size > 1
          ? 'multi'
          : segments[0]?.voice ?? 'default';
        try {
          buffer = await voiceService.generateMultiVoiceMp3(segments);
        } catch (err) {
          // Slower beats silent — but only when the fallback can actually
          // succeed. Above the provider ceiling one whole-text request is a
          // guaranteed 400, and swallowing the real error to produce a second
          // identical one just hides why the user heard nothing.
          if (joined.length > PROVIDER_MAX_REQUEST_CHARS) throw err;
          console.warn('[Read-aloud] Chunked render failed, falling back to one request:', (err as Error).message);
          voiceUsed = segments[0]?.voice ?? 'default';
          buffer = await voiceService.generateTTS(joined, segments[0]?.voice);
        }

        const fileMeta = saveFile(buffer, `read-aloud-${id}.mp3`, 'audio/mpeg');
        const now = new Date().toISOString();
        insertMessageTts({ messageId: id, fileId: fileMeta.fileId, voiceUsed, createdAt: now });
        return {
          success: true,
          cached: false,
          fileId: fileMeta.fileId,
          url: fileMeta.url,
        };
      })();
      messageTtsRenders.set(id, render);
    }

    try {
      res.json(await render);
    } finally {
      if (ownsRender && messageTtsRenders.get(id) === render) messageTtsRenders.delete(id);
    }
  } catch (error) {
    console.error('Read-aloud error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'TTS render failed',
    });
  }
});

export default router;
