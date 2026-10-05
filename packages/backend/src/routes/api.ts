// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { parse as parseCookie } from 'cookie';
import { Router, type Response as ExpressResponse } from 'express';
import crypto from 'crypto';
import * as babel from '@babel/core';
import multer from 'multer';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, basename, resolve, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

// Derive project root from this module's location (packages/backend/src/routes/api.ts → ../../../..)
// This is stable regardless of process.cwd(), which npm workspaces can change.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..');

// --- Security: Path containment validation ---
function isPathAllowed(filePath: string): boolean {
  if (filePath.includes('\0')) return false;
  const resolvedPath = resolve(filePath);
  const safePrefixes = [PROJECT_ROOT, resolve(PROJECT_ROOT, '..')];
  return safePrefixes.some(prefix => resolvedPath.startsWith(prefix + '/') || resolvedPath.startsWith(prefix + '\\'));
}
import * as yaml from 'js-yaml';
import {
  listThreads,
  getThread,
  createThread,
  createMessage,
  getMessages,
  markMessagesRead,
  getMessage,
  archiveThread,
  unarchiveThread,
  deleteThread,
  updateThreadActivity,
  getDb,
  getAllConfig,
  deleteOtherWebSessions,
  setConfig,
  getConfigBool,
  createCanvas,
  getCanvas,
  listCanvases,
  updateCanvasContent,
  updateCanvasTitle,
  deleteCanvas,
  addPushSubscription,
  addFcmSubscription,
  removePushSubscription,
  listPushSubscriptions,
  searchMessages,
  pinThread,
  unpinThread,
  getMessageContext,
  editMessage,
  softDeleteMessage,
  softDeleteAfterSequence,
  updateThreadSession,
  messagePreviewText,
} from '../services/db.js';
import {
  loginHandler,
  logoutHandler,
  sessionCheckHandler,
  getCookieName,
} from '../middleware/auth.js';
import { loginRateLimiter } from '../middleware/security.js';
import { authMiddleware } from '../middleware/auth.js';
import { getRecentAuditEntries } from '../services/audit.js';
import { saveFile, getContentTypeFromMime, getFile, deleteFile, listFiles, attachmentFilename } from '../services/files.js';
import { downloadFilename } from '../services/file-names.js';
import { fileThumbnail } from '../services/image-gen.js';
import { registry } from '../services/ws.js';
import { persistAgentSetting, findConfigPath } from '../services/agent-settings.js';
import { getAerieConfig, updateConfigValue } from '../config.js';
import type { Orchestrator } from '../services/orchestrator.js';
import type { VoiceService } from '../services/voice.js';
import { PROVIDER_MAX_REQUEST_CHARS, splitSegmentsForRender } from '../services/voice-speaker-split.js';
import type { TelegramService } from '../services/telegram/index.js';
import type { PushService } from '../services/push.js';
import rateLimit from 'express-rate-limit';
import codexAuthRoutes from './codex-auth.js';
import studioRoutes from './studio.js';
import gifRoutes from './gif.js';
import type { AgentService } from '../services/agent.js';
import { resolveCompatibleAgentRoute } from '../services/agent/agent-route-selection.js';
import { shutdownAllHeartbeats } from '../services/heartbeat/supervisor.js';
import { getSecret, setSecret, withoutSecrets } from '../services/secrets.js';
import { prepareTextForTTS } from '../services/tts-text.js';

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
}

function failLiveTtsSegment(segment: LiveTtsSegment, error: unknown): void {
  if (segment.state === 'complete' || segment.state === 'error') return;
  segment.error = error instanceof Error ? error : new Error(String(error));
  segment.state = 'error';
  segment.rejectCompletion(segment.error);
  for (const subscriber of segment.subscribers) flushLiveTtsSubscriber(segment, subscriber);
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


// --- Public routes (no auth) ---

// Health check (public — minimal response)
router.get('/health', (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    memoryUsage: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
    connections: req.app.locals.agentService ? 0 : 0,
  });
});

// Auth endpoints
router.get('/auth/check', sessionCheckHandler);
router.post('/auth/login', loginRateLimiter, loginHandler);
router.post('/auth/logout', logoutHandler);

// Push VAPID public key (no auth — needed before subscription)
router.get('/push/vapid-public', (req, res) => {
  const pushService = req.app.locals.pushService as PushService | undefined;
  const publicKey = pushService?.getVapidPublicKey() || null;
  res.json({ publicKey });
});

// Vendor route moved to server.ts (before CSRF middleware)

// Identity endpoint — companion/user names and timezone for frontend personalization
router.get('/identity', (req, res) => {
  const config = getAerieConfig();
  res.json({
    companion_name: config.identity.companion_name,
    user_name: config.identity.user_name,
    timezone: config.identity.timezone,
  });
});

// File listing (needs auth, moved here to be BEFORE /files/:id)
router.get('/files/list', authMiddleware, (req, res) => {
  try {
    const files = listFiles();
    const db = getDb();
    const usedFileIds = new Set<string>();
    const metaRows = db.prepare('SELECT metadata FROM messages WHERE metadata IS NOT NULL AND deleted_at IS NULL').all() as Array<{ metadata: string }>;
    for (const row of metaRows) {
      try {
        const meta = JSON.parse(row.metadata);
        if (meta.fileId) usedFileIds.add(meta.fileId);
        if (Array.isArray(meta.attachments)) {
          for (const att of meta.attachments) {
            if (att && typeof att === 'object' && typeof att.fileId === 'string') usedFileIds.add(att.fileId);
          }
        }
      } catch { /* skip */ }
    }
    const contentRows = db.prepare('SELECT content FROM messages WHERE content IS NOT NULL AND deleted_at IS NULL').all() as Array<{ content: string }>;
    const fileIdPattern = /\/api\/files\/([a-f0-9-]{36})/gi;
    for (const row of contentRows) {
      let match;
      while ((match = fileIdPattern.exec(row.content)) !== null) {
        usedFileIds.add(match[1]);
      }
    }
    // The Press keeps imported originals and replaceable rendered previews in
    // its own asset ledger rather than message metadata.
    const pressRows = db.prepare(`
      SELECT source_file_id, rendered_file_id FROM press_assets
    `).all() as Array<{ source_file_id: string; rendered_file_id: string | null }>;
    for (const row of pressRows) {
      usedFileIds.add(row.source_file_id);
      if (row.rendered_file_id) usedFileIds.add(row.rendered_file_id);
    }
    const pressScenes = db.prepare('SELECT scene_json FROM press_spreads').all() as Array<{ scene_json: string }>;
    for (const row of pressScenes) {
      try {
        const scene = JSON.parse(row.scene_json) as { files?: Record<string, { storageFileId?: string; sourceFileId?: string }> };
        for (const ref of Object.values(scene.files || {})) {
          if (typeof ref.storageFileId === 'string') usedFileIds.add(ref.storageFileId);
          if (typeof ref.sourceFileId === 'string') usedFileIds.add(ref.sourceFileId);
        }
      } catch { /* skip malformed legacy scenes */ }
    }
    const pressPackRows = db.prepare(`
      SELECT source_file_id FROM press_pack_items WHERE source_file_id IS NOT NULL
    `).all() as Array<{ source_file_id: string }>;
    for (const row of pressPackRows) usedFileIds.add(row.source_file_id);
    const pressPackSources = db.prepare(`
      SELECT source_file_id FROM press_packs WHERE source_file_id IS NOT NULL
    `).all() as Array<{ source_file_id: string }>;
    for (const row of pressPackSources) usedFileIds.add(row.source_file_id);
    const enriched = files.map(f => ({ ...f, inUse: usedFileIds.has(f.fileId) }));
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const orphanCount = enriched.filter(f => !f.inUse).length;
    res.json({ files: enriched, totalSize, totalCount: files.length, orphanCount });
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// File download — public (UUID provides security, enables direct links/embeds)
// Use UUID pattern to avoid catching /files/list, /files/clean-orphans, etc.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.get('/files/:id', async (req: any, res: any, next: any) => {
  // Skip non-UUID paths (they go to other routes like /files/list)
  const uuid = req.params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
    return next();
  }
  try {
    const file = getFile(uuid);
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    // ?download=1 asks for a save rather than a view. Android's WebView
    // ignores a link's download attribute entirely, so this header is the
    // only signal that reaches the shell's DownloadListener — without it a
    // long-press inside the app just navigates to the picture.
    if (req.query?.download) {
      // Prefer the name the user gave it. Files saved before the name sidecar
      // existed still come back as the bare uuid, and for those a short
      // stamped name stays unique and sorts with its siblings rather than
      // landing in a Downloads folder as a wall of hex.
      const nice = attachmentFilename(downloadFilename(uuid, file.filename, extname(file.path)));
      res.setHeader('Content-Disposition', `attachment; filename="${nice}"`);
      res.sendFile(file.path);
      return;
    }
    // ?w= asks for a small version, same as the gallery. A save always gets
    // the real file, so this only ever answers a view. Unknown widths, gifs
    // and non-images fall through to the original — which is what an older
    // backend does with the parameter anyway, so the phone can ship first.
    const thumbnail = await fileThumbnail(file, req.query?.w);
    if (thumbnail) {
      res.setHeader('Content-Type', 'image/webp');
      res.sendFile(thumbnail);
      return;
    }
    res.sendFile(file.path);
  } catch (error) {
    console.error('Error serving file:', error);
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

// --- Protected routes (auth required when password is set) ---
router.use(authMiddleware);

// Codex OAuth — start/poll/manual-code/logout/cancel under /api/auth/codex
router.use(codexAuthRoutes);

// Studio routes — image generation, reference drawers, gallery
router.use(studioRoutes);

// GIF Lab routes — frame extraction, GIF creation, optimization
router.use(gifRoutes);

// --- Preferences (aerie.yaml) ---

router.get('/preferences', (req, res) => {
  try {
    const configPath = findConfigPath();
    if (!configPath) {
      res.json({ error: 'No config file found' });
      return;
    }
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = yaml.load(raw) as Record<string, unknown> || {};
    // Only expose safe, editable fields — not server internals
    const config = getAerieConfig();
    const autonomousRoute = resolveCompatibleAgentRoute(
      config.agent.model_autonomous,
      config.agent.routing_autonomous || config.agent.routing || 'cli',
    ).routing;
    res.json({
      identity: {
        companion_name: config.identity.companion_name,
        user_name: config.identity.user_name,
        timezone: config.identity.timezone,
      },
      agent: {
        model: config.agent.model,
        model_autonomous: config.agent.model_autonomous,
        model_pulse: config.agent.model_pulse,
        thinking: config.agent.thinking,
        effort: config.agent.effort || 'adaptive',
        claude_thinking: config.agent.claude_thinking || config.agent.thinking || 'adaptive',
        claude_effort: config.agent.claude_effort || config.agent.effort || 'adaptive',
        codex_effort: config.agent.codex_effort || config.agent.effort || 'adaptive',
        codex_speed: config.agent.codex_speed || 'standard',
        archivist_provider: config.agent.archivist_provider || 'ollama',
        archivist_model: config.agent.archivist_model || 'deepseek-v4-pro',
        archivist_effort: config.agent.archivist_effort || 'adaptive',
        archivist_thinking: config.agent.archivist_thinking || 'disabled',
        routing: config.agent.routing || 'cli',
        routing_autonomous: autonomousRoute,
        // Multi-lane room. Tolerates a quoted "true" from a hand-edited YAML.
        multi_lane: config.agent.multi_lane === true || String(config.agent.multi_lane) === 'true',
      },
      orchestrator: {
        // DB value takes precedence — the toggle writes to DB, not YAML
        enabled: getConfigBool('orchestrator.enabled', config.orchestrator.enabled),
      },
      voice: {
        enabled: getConfigBool('voice.enabled', config.voice.enabled),
        // Read stage directions aloud instead of collapsing them to a cue.
        read_actions_aloud: getConfigBool('voice.read_actions_aloud', false),
      },
      discord: {
        enabled: getConfigBool('discord.enabled', config.discord.enabled),
      },
      telegram: {
        enabled: getConfigBool('telegram.enabled', config.telegram.enabled),
      },
      auth: {
        has_password: !!config.auth.password,
      },
      providers: {
        ollama: config.providers?.ollama ? {
          base_url: config.providers.ollama.base_url,
          api_key: (getSecret('ollama_api_key') || getSecret('ollama_api_key_pending') || config.providers.ollama.api_key) ? '••••••••' : undefined,
        } : undefined,
        openrouter: config.providers?.openrouter ? { api_key: '••••••••' } : undefined,
        groq: config.providers?.groq ? { api_key: '••••••••' } : undefined,
        xai: config.providers?.xai ? { api_key: '••••••••' } : undefined,
        openai: config.providers?.openai ? { api_key: '••••••••' } : undefined,
        huggingface: config.providers?.huggingface ? { api_key: '••••••••' } : undefined,
        anthropic: config.providers?.anthropic ? { api_key: '••••••••' } : undefined,
      },
    });
  } catch (err) {
    console.error('Failed to read preferences:', err);
    res.status(500).json({ error: 'Failed to read preferences' });
  }
});

router.put('/preferences', (req, res) => {
  try {
    const configPath = findConfigPath();
    if (!configPath) {
      res.status(404).json({ error: 'No config file found' });
      return;
    }
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = (yaml.load(raw) as Record<string, any>) || {};
    const updates = req.body as Record<string, any>;
    const priorAgent = getAerieConfig().agent;
    const priorRuntimeSelection = {
      model: priorAgent.model,
      modelAutonomous: priorAgent.model_autonomous,
      routing: priorAgent.routing,
      routingAutonomous: priorAgent.routing_autonomous,
    };

    // A model and its warm route are one selection. Older callers — and old
    // stored state — can still submit only one half, so normalize the pair at
    // the server boundary instead of making every later turn repair it again.
    if (updates.agent) {
      const touchesInteractive = updates.agent.model !== undefined || updates.agent.routing !== undefined;
      if (touchesInteractive) {
        const model = updates.agent.model ?? priorAgent.model;
        const requested = (updates.agent.routing ?? priorAgent.routing ?? 'cli') as Parameters<typeof resolveCompatibleAgentRoute>[1];
        updates.agent.routing = resolveCompatibleAgentRoute(model, requested).routing;
      }

      const touchesAutonomous = updates.agent.model_autonomous !== undefined || updates.agent.routing_autonomous !== undefined;
      if (touchesAutonomous) {
        const model = updates.agent.model_autonomous ?? priorAgent.model_autonomous;
        const requested = (
          updates.agent.routing_autonomous
          ?? priorAgent.routing_autonomous
          ?? updates.agent.routing
          ?? priorAgent.routing
          ?? 'cli'
        ) as Parameters<typeof resolveCompatibleAgentRoute>[1];
        updates.agent.routing_autonomous = resolveCompatibleAgentRoute(model, requested).routing;
      }
    }

    // Merge only allowed fields
    if (updates.identity) {
      if (!parsed.identity) parsed.identity = {};
      if (updates.identity.companion_name !== undefined) parsed.identity.companion_name = updates.identity.companion_name;
      if (updates.identity.user_name !== undefined) parsed.identity.user_name = updates.identity.user_name;
      if (updates.identity.timezone !== undefined) parsed.identity.timezone = updates.identity.timezone;
    }
    if (updates.agent) {
      if (!parsed.agent) parsed.agent = {};
      const writeAgent = (key: string, value: unknown) => {
        parsed.agent[key] = value;
        const stored = String(value);
        setConfig(`agent.${key}`, stored);
        updateConfigValue(`agent.${key}`, stored);
      };
      if (updates.agent.model !== undefined) {
        writeAgent('model', updates.agent.model);
      }
      if (updates.agent.model_autonomous !== undefined) {
        writeAgent('model_autonomous', updates.agent.model_autonomous);
      }
      if (updates.agent.model_pulse !== undefined) {
        writeAgent('model_pulse', updates.agent.model_pulse);
      }
      if (updates.agent.thinking !== undefined) {
        writeAgent('thinking', updates.agent.thinking);
      }
      if (updates.agent.effort !== undefined) {
        writeAgent('effort', updates.agent.effort);
      }
      for (const key of [
        'claude_thinking', 'claude_effort', 'codex_effort', 'codex_speed',
        'archivist_provider', 'archivist_model', 'archivist_effort', 'archivist_thinking',
      ] as const) {
        if (updates.agent[key] !== undefined) {
          writeAgent(key, updates.agent[key]);
        }
      }
      if (updates.agent.routing !== undefined) {
        writeAgent('routing', updates.agent.routing);
      }
      if (updates.agent.routing_autonomous !== undefined) {
        writeAgent('routing_autonomous', updates.agent.routing_autonomous);
      }
      if (updates.agent.ambient_recall !== undefined) {
        writeAgent('ambient_recall', updates.agent.ambient_recall);
      }
      if (updates.agent.multi_lane !== undefined) {
        // Written as a real boolean, not the string "true" — a quoted string
        // would never equal true on reload.
        writeAgent('multi_lane', updates.agent.multi_lane === true || String(updates.agent.multi_lane) === 'true');
      }
    }
    if (updates.orchestrator) {
      if (!parsed.orchestrator) parsed.orchestrator = {};
      if (updates.orchestrator.enabled !== undefined) parsed.orchestrator.enabled = updates.orchestrator.enabled;
    }
    if (updates.voice) {
      if (!parsed.voice) parsed.voice = {};
      if (updates.voice.enabled !== undefined) parsed.voice.enabled = updates.voice.enabled;
    }
    if (updates.discord) {
      if (!parsed.discord) parsed.discord = {};
      if (updates.discord.enabled !== undefined) parsed.discord.enabled = updates.discord.enabled;
    }
    if (updates.telegram) {
      if (!parsed.telegram) parsed.telegram = {};
      if (updates.telegram.enabled !== undefined) parsed.telegram.enabled = updates.telegram.enabled;
    }
    // A new password ends every other session. Nobody should still be holding
    // the old way in, except the person who just changed it, standing here.
    let passwordChanged = false;
    if (updates.auth) {
      if (!parsed.auth) parsed.auth = {};
      if (updates.auth.password !== undefined && updates.auth.password !== parsed.auth.password) {
        parsed.auth.password = updates.auth.password;
        passwordChanged = true;
      }
    }
    if (updates.providers) {
      if (!parsed.providers) parsed.providers = {};
      if (updates.providers.ollama?.base_url !== undefined) {
        // Provider keys belong in the DB secrets store, not the YAML file.
        // The phone omits a masked key on later saves, so preserve the stored
        // value unless a genuinely new key was submitted.
        const submittedKey = updates.providers.ollama.api_key;
        if (submittedKey && !String(submittedKey).startsWith('•')) {
          setSecret('ollama_api_key', submittedKey);
        } else if (parsed.providers.ollama?.api_key && !getSecret('ollama_api_key')) {
          // One-way migration for older houses that still have the key in YAML.
          setSecret('ollama_api_key', parsed.providers.ollama.api_key);
        }
        parsed.providers.ollama = {
          base_url: updates.providers.ollama.base_url,
        };
      }
      if (updates.providers.openrouter?.api_key !== undefined) {
        parsed.providers.openrouter = { api_key: updates.providers.openrouter.api_key };
      }
      if (updates.providers.groq?.api_key !== undefined) {
        parsed.providers.groq = { api_key: updates.providers.groq.api_key };
      }
      if (updates.providers.xai?.api_key !== undefined) {
        parsed.providers.xai = { api_key: updates.providers.xai.api_key };
      }
      if (updates.providers.openai?.api_key !== undefined) {
        parsed.providers.openai = { api_key: updates.providers.openai.api_key };
      }
      if (updates.providers.huggingface?.api_key !== undefined) {
        parsed.providers.huggingface = { api_key: updates.providers.huggingface.api_key };
      }
      if (updates.providers.anthropic?.api_key !== undefined) {
        parsed.providers.anthropic = { api_key: updates.providers.anthropic.api_key };
      }
    }

    // Write back
    const newYaml = yaml.dump(parsed, { lineWidth: -1, quoteStyle: 'double', forceQuotes: true });
    writeFileSync(configPath, newYaml, 'utf-8');

    if (passwordChanged) {
      const cookieHeader = req.headers.cookie;
      const currentToken = cookieHeader ? parseCookie(cookieHeader)[getCookieName()] : undefined;
      const ended = deleteOtherWebSessions(currentToken);
      console.log(`[Auth] Password changed; ended ${ended} other session(s)`);
    }

    // A preferences save updates the running config immediately. Claude
    // heartbeat children, however, keep their own relaunch timers and queued
    // inbox work. Without explicitly stopping them, switching the house to
    // Codex can leave capped Claude lanes retrying in the background; when the
    // subscription window resets they resume stale work and spend the new
    // window even though every new turn routes elsewhere.
    const nextAgent = getAerieConfig().agent;
    const runtimeSelectionChanged =
      priorRuntimeSelection.model !== nextAgent.model ||
      priorRuntimeSelection.modelAutonomous !== nextAgent.model_autonomous ||
      priorRuntimeSelection.routing !== nextAgent.routing ||
      priorRuntimeSelection.routingAutonomous !== nextAgent.routing_autonomous;
    if (runtimeSelectionChanged) {
      shutdownAllHeartbeats();
    }

    res.json({ success: true, message: 'Preferences saved. Restart server for some changes to take effect.' });
  } catch (err) {
    console.error('Failed to save preferences:', err);
    res.status(500).json({ error: 'Failed to save preferences' });
  }
});

// Thread list with summary
router.get('/threads', (req, res) => {
  try {
    const threads = listThreads({ includeArchived: false, limit: 50 });

    // Enhance with last message preview
    const db = getDb();
    const threadsWithPreview = threads.map(thread => {
      const lastMsg = db.prepare(`
        SELECT content, metadata, role, created_at
        FROM messages
        WHERE thread_id = ? AND deleted_at IS NULL
        ORDER BY sequence DESC
        LIMIT 1
      `).get(thread.id) as { content: string; metadata: string | null; role: string; created_at: string } | undefined;

      // Preview what the bubble will render, not what the row happens to
      // store — see messagePreviewText. A message with nothing to show gets
      // no preview rather than one the room can't produce.
      const spoken = lastMsg ? messagePreviewText(lastMsg.content, lastMsg.metadata) : null;

      return {
        id: thread.id,
        name: thread.name,
        type: thread.type,
        unread_count: thread.unread_count,
        last_activity_at: thread.last_activity_at,
        last_message_preview: lastMsg && spoken ? {
          content: spoken.slice(0, 100) + (spoken.length > 100 ? '...' : ''),
          role: lastMsg.role,
          created_at: lastMsg.created_at,
        } : null,
        pinned_at: thread.pinned_at ?? null,
      };
    });

    res.json({ threads: threadsWithPreview });
  } catch (error) {
    console.error('Error fetching threads:', error);
    res.status(500).json({ error: 'Failed to fetch threads' });
  }
});

// Get archived threads (must be before :id routes)
router.get('/threads/archived', (req, res) => {
  try {
    const db = getDb();
    const threads = db.prepare(`
      SELECT * FROM threads WHERE archived_at IS NOT NULL
      ORDER BY archived_at DESC LIMIT 50
    `).all();
    res.json({ threads });
  } catch (error) {
    console.error('Error fetching archived threads:', error);
    res.status(500).json({ error: 'Failed to fetch archived threads' });
  }
});

// Create named thread
router.post('/threads', (req, res) => {
  try {
    const { name } = req.body;

    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Thread name required' });
      return;
    }

    const thread = createThread({
      id: crypto.randomUUID(),
      name,
      type: 'named',
      createdAt: new Date().toISOString(),
      sessionType: 'v2',
    });

    res.json({ thread });
  } catch (error) {
    console.error('Error creating thread:', error);
    res.status(500).json({ error: 'Failed to create thread' });
  }
});

// Get thread messages (paginated)
router.get('/threads/:id/messages', (req, res) => {
  try {
    const { id } = req.params;
    const { before, around, limit } = req.query;

    const thread = getThread(id);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    // `around=<messageId>` loads a window of messages centered on a target —
    // used by search-result jumps so a hit on a message older than the
    // last 50 still has surrounding context to anchor the scroll.
    if (around) {
      const windowSize = limit ? Math.max(1, parseInt(limit as string, 10)) : 50;
      const messages = getMessageContext(around as string, windowSize);
      res.json({ messages });
      return;
    }

    const messages = getMessages({
      threadId: id,
      before: before as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : 50,
    });

    res.json({ messages });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Mark messages as read
router.post('/messages/read', (req, res) => {
  try {
    const { threadId, beforeId } = req.body;

    if (!threadId || !beforeId) {
      res.status(400).json({ error: 'threadId and beforeId required' });
      return;
    }

    const message = getMessage(beforeId);
    if (!message || message.thread_id !== threadId) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    markMessagesRead(threadId, beforeId, new Date().toISOString());

    res.json({ success: true });
  } catch (error) {
    console.error('Error marking messages as read:', error);
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

// Edit a user message (optionally rerun the companion response)
router.patch('/messages/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { content, rerun } = req.body as { content: string; rerun?: boolean };

    if (!content?.trim()) {
      res.status(400).json({ error: 'Content required' });
      return;
    }

    const existing = getMessage(id);
    if (!existing) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    if (existing.role !== 'user') {
      res.status(400).json({ error: 'Only user messages can be edited' });
      return;
    }

    const now = new Date().toISOString();
    editMessage(id, content.trim(), now);

    // Broadcast edit to all connected clients
    registry.broadcast({ type: 'message_edited', messageId: id, newContent: content.trim(), editedAt: now });

    if (rerun) {
      // Retract any in-flight CLI/router reply to the original message so the
      // edit doesn't produce twin responses.
      (req.app.locals.agentService as AgentService).abortThreadGeneration(existing.thread_id);

      // Soft-delete everything after the edited message and re-prompt the agent
      const deletedIds = softDeleteAfterSequence(existing.thread_id, existing.sequence, now);
      for (const deletedId of deletedIds) {
        registry.broadcast({ type: 'message_deleted', messageId: deletedId });
      }

      // Force a fresh SDK session — the cached one still has the deleted turns in memory.
      updateThreadSession(existing.thread_id, null);
      // Same on the Codex side — an edit is only a retraction if the app-server
      // thread stops carrying the version the user took back.
      (req.app.locals.agentService as AgentService).clearCodexSessionsForThread(existing.thread_id);

      const thread = getThread(existing.thread_id);
      if (thread) {
        const agentService = req.app.locals.agentService as AgentService;
        agentService.processMessage(thread.id, content.trim(), { name: thread.name, type: thread.type as 'daily' | 'named' }, {
          platform: 'web',
          inboundSequence: existing.sequence,
          withdrawn: `The owner has edited this message. It previously read: "${existing.content.slice(0, 400)}". Anything you had already said in reply is off their screen. Answer what they have written now; you still have the earlier version and are not being asked to forget it.`,
        }).catch(err => {
          console.error('[Edit rerun] Agent error:', err);
        });
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Failed to edit message:', err);
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

// Soft-delete a single message and broadcast so every client drops it
// from view. Replaces the orphan `delete_message` WS frame.
router.delete('/messages/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = getMessage(id);
    if (!existing) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    softDeleteMessage(id, new Date().toISOString());
    registry.broadcast({ type: 'message_deleted', messageId: id });
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to delete message:', err);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// Regenerate (reroll) a companion response
router.post('/messages/:id/regenerate', async (req, res) => {
  try {
    const { id } = req.params;
    const target = getMessage(id);

    if (!target) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }
    if (target.role !== 'companion') {
      res.status(400).json({ error: 'Can only regenerate companion messages' });
      return;
    }

    // Find the most recent user message before this companion message
    const recentMessages = getMessages({ threadId: target.thread_id, limit: 100 });
    let priorUserMessage: typeof recentMessages[0] | null = null;
    for (let i = recentMessages.length - 1; i >= 0; i--) {
      const m = recentMessages[i];
      if (m.role === 'user' && m.sequence < target.sequence && !m.deleted_at) {
        priorUserMessage = m;
        break;
      }
    }

    if (!priorUserMessage) {
      res.status(400).json({ error: 'No prior user message found to regenerate from' });
      return;
    }

    // Soft-delete from the target companion message onward
    const now = new Date().toISOString();
    const deletedIds = softDeleteAfterSequence(target.thread_id, target.sequence - 1, now);
    for (const deletedId of deletedIds) {
      registry.broadcast({ type: 'message_deleted', messageId: deletedId });
    }

    // Force a fresh SDK session — the cached one still has the deleted turns in memory.
    updateThreadSession(target.thread_id, null);
    // And the Codex side, which keeps its transcript in the app-server thread:
    // without this the reroll only clears the user's screen and re-prompts the same
    // thread with the withdrawn reply still standing in its own history.
    (req.app.locals.agentService as AgentService).clearCodexSessionsForThread(target.thread_id);

    // Re-prompt the agent with the prior user message
    const thread = getThread(target.thread_id);
    if (thread) {
      const agentService = req.app.locals.agentService as AgentService;
      agentService.processMessage(thread.id, priorUserMessage.content, { name: thread.name, type: thread.type as 'daily' | 'named' }, {
        platform: 'web',
        withdrawn: 'The owner has asked for this answered again — your previous reply is no longer on their screen. You still have it, and you are not being asked to pretend otherwise; a reroll is very often a tap they did not mean. Say so if it helps.',
      }).catch(err => {
        console.error('[Regenerate] Agent error:', err);
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Failed to regenerate message:', err);
    res.status(500).json({ error: 'Failed to regenerate message' });
  }
});

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

    const { getMessageTts, insertMessageTts } = await import('../services/db.js');
    const { VoiceService } = await import('../services/voice.js');

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
    const { getMessageTts, insertMessageTts } = await import('../services/db.js');
    const { VoiceService } = await import('../services/voice.js');

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

// Voice diagnostics — what's actually loaded into the VoiceService.
// Useful when multi-voice splitting isn't routing the way you'd expect:
// shows the voice IDs mapped per slug, the companions the splitter can see,
// and whether ElevenLabs is reachable at all.
router.get('/voice/status', (req, res) => {
  const voiceService = req.app.locals.voiceService as VoiceService | undefined;
  if (!voiceService) {
    res.status(500).json({ error: 'VoiceService not initialized' });
    return;
  }
  res.json(voiceService.describe());
});

// ElevenLabs credit meter — live subscription usage for the phone's
// Integrations card. The key needs the user_read permission.
router.get('/voice/usage', async (req, res) => {
  const voiceService = req.app.locals.voiceService as VoiceService | undefined;
  if (!voiceService) {
    res.status(500).json({ error: 'VoiceService not initialized' });
    return;
  }
  try {
    res.json(await voiceService.getElevenLabsUsage());
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : 'ElevenLabs usage unavailable',
    });
  }
});

// Claude subscription usage — the same OAuth endpoint the CLI polls for
// its own /usage screen, read with the token already on disk. Cached 60s.
router.get('/usage/claude', async (req, res) => {
  try {
    const { getClaudeUsage } = await import('../services/subscription-usage.js');
    res.json(await getClaudeUsage());
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Claude usage unavailable',
    });
  }
});

// Codex rate limits — read from the freshest token_count stamp the daemon
// writes into its own session transcripts. No API call, refreshes every sweep.
router.get('/usage/codex', async (req, res) => {
  try {
    const { getCodexUsage } = await import('../services/subscription-usage.js');
    res.json(await getCodexUsage());
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Codex usage unavailable',
    });
  }
});

// Wipe cached TTS audio. With no body, clears every cached file —
// useful when the splitter changed and you want existing messages
// re-generated under the new rules. With { messageId }, clears one.
router.post('/voice/clear-tts-cache', async (req, res) => {
  const { clearMessageTts } = await import('../services/db.js');
  const messageId = typeof req.body?.messageId === 'string' ? req.body.messageId : undefined;
  const removed = clearMessageTts(messageId);
  res.json({ success: true, removed });
});

// Force-reload voice secrets from the DB. The /api/secrets PUT route calls
// refresh() automatically; this is here for the case where a companion was
// added via /api/companions after boot — the splitter caches nothing, but
// orphan voice IDs whose slug only just got registered won't be picked up
// without a re-read.
router.post('/voice/refresh', (req, res) => {
  const voiceService = req.app.locals.voiceService as VoiceService | undefined;
  if (!voiceService) {
    res.status(500).json({ error: 'VoiceService not initialized' });
    return;
  }
  voiceService.refresh();
  res.json({ success: true, ...voiceService.describe() });
});

// Put an archived thread back. Nothing in the house cleared archived_at, so
// archiving was one-way from the app — you could see the room and never
// reopen it.
router.post('/threads/:id/unarchive', (req, res) => {
  try {
    const { id } = req.params;
    const thread = getThread(id);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    unarchiveThread(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error unarchiving thread:', error);
    res.status(500).json({ error: 'Failed to unarchive thread' });
  }
});

// Archive a thread
router.post('/threads/:id/archive', (req, res) => {
  try {
    const { id } = req.params;
    const thread = getThread(id);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    archiveThread(id, new Date().toISOString());
    // Archiving removes the thread from the user's list as completely as deleting it
    // does, so it announces itself the same way and the socket handler owns
    // moving them off it. Without this the user was left standing in a thread that
    // had just left the list, looking at nothing.
    registry.broadcast({ type: 'thread_archived', threadId: id });
    res.json({ success: true });
  } catch (error) {
    console.error('Error archiving thread:', error);
    res.status(500).json({ error: 'Failed to archive thread' });
  }
});

// Pin a thread
router.post('/threads/:id/pin', (req, res) => {
  try {
    const { id } = req.params;
    const thread = getThread(id);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    pinThread(id);
    const updated = getThread(id)!;

    registry.broadcast({
      type: 'thread_updated',
      thread: {
        id: updated.id,
        name: updated.name,
        type: updated.type,
        unread_count: updated.unread_count,
        last_activity_at: updated.last_activity_at,
        last_message_preview: null,
        pinned_at: updated.pinned_at,
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error pinning thread:', error);
    res.status(500).json({ error: 'Failed to pin thread' });
  }
});

// Unpin a thread
router.post('/threads/:id/unpin', (req, res) => {
  try {
    const { id } = req.params;
    const thread = getThread(id);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    unpinThread(id);

    registry.broadcast({
      type: 'thread_updated',
      thread: {
        id: thread.id,
        name: thread.name,
        type: thread.type,
        unread_count: thread.unread_count,
        last_activity_at: thread.last_activity_at,
        last_message_preview: null,
        pinned_at: null,
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error unpinning thread:', error);
    res.status(500).json({ error: 'Failed to unpin thread' });
  }
});

// Delete a thread and all associated data
router.delete('/threads/:id', (req, res) => {
  try {
    const { id } = req.params;
    const thread = getThread(id);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    const fileIds = deleteThread(id);

    // Clean up files on disk
    for (const fileId of fileIds) {
      deleteFile(fileId);
    }

    // Broadcast deletion to all connected clients
    registry.broadcast({ type: 'thread_deleted', threadId: id });

    res.json({ success: true, deletedFiles: fileIds.length });
  } catch (error) {
    console.error('Error deleting thread:', error);
    res.status(500).json({ error: 'Failed to delete thread' });
  }
});

// --- File upload/download ---

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

const uploadRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many uploads, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
});

// File upload
router.post('/files', uploadRateLimiter, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    // Security: sanitize filename (basename + character filter + length cap)
    const rawName = req.file.originalname || 'unnamed';
    const safeName = basename(rawName).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255);
    const fileMeta = saveFile(req.file.buffer, safeName, req.file.mimetype);
    res.json(fileMeta);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Upload failed';
    console.error('File upload error:', msg);
    res.status(400).json({ error: msg });
  }
});


// Bulk delete: drop every file not referenced by any message's metadata or content.
// Mirrors the orphan calculation in /api/files/list — anything whose
// fileId isn't found anywhere in messages.metadata OR embedded in content gets nuked.
router.post('/files/clean-orphans', (req, res) => {
  try {
    const files = listFiles();
    const db = getDb();
    const usedFileIds = new Set<string>();

    // Check metadata for fileId and attachments
    const metaRows = db.prepare('SELECT metadata FROM messages WHERE metadata IS NOT NULL AND deleted_at IS NULL').all() as Array<{ metadata: string }>;
    for (const row of metaRows) {
      try {
        const meta = JSON.parse(row.metadata);
        if (meta.fileId) usedFileIds.add(meta.fileId);
        if (Array.isArray(meta.attachments)) {
          for (const att of meta.attachments) {
            if (att && typeof att === 'object' && typeof att.fileId === 'string') usedFileIds.add(att.fileId);
          }
        }
      } catch { /* skip malformed metadata */ }
    }

    // Also scan message content for /api/files/<id> links
    const contentRows = db.prepare('SELECT content FROM messages WHERE content IS NOT NULL AND deleted_at IS NULL').all() as Array<{ content: string }>;
    const fileIdPattern = /\/api\/files\/([a-f0-9-]{36})/gi;
    for (const row of contentRows) {
      let match;
      while ((match = fileIdPattern.exec(row.content)) !== null) {
        usedFileIds.add(match[1]);
      }
    }

    // Preserve Press originals and the currently selected rendered previews.
    const pressRows = db.prepare(`
      SELECT source_file_id, rendered_file_id FROM press_assets
    `).all() as Array<{ source_file_id: string; rendered_file_id: string | null }>;
    for (const row of pressRows) {
      usedFileIds.add(row.source_file_id);
      if (row.rendered_file_id) usedFileIds.add(row.rendered_file_id);
    }
    const pressScenes = db.prepare('SELECT scene_json FROM press_spreads').all() as Array<{ scene_json: string }>;
    for (const row of pressScenes) {
      try {
        const scene = JSON.parse(row.scene_json) as { files?: Record<string, { storageFileId?: string; sourceFileId?: string }> };
        for (const ref of Object.values(scene.files || {})) {
          if (typeof ref.storageFileId === 'string') usedFileIds.add(ref.storageFileId);
          if (typeof ref.sourceFileId === 'string') usedFileIds.add(ref.sourceFileId);
        }
      } catch { /* skip malformed legacy scenes */ }
    }
    const pressPackRows = db.prepare(`
      SELECT source_file_id FROM press_pack_items WHERE source_file_id IS NOT NULL
    `).all() as Array<{ source_file_id: string }>;
    for (const row of pressPackRows) usedFileIds.add(row.source_file_id);
    const pressPackSources = db.prepare(`
      SELECT source_file_id FROM press_packs WHERE source_file_id IS NOT NULL
    `).all() as Array<{ source_file_id: string }>;
    for (const row of pressPackSources) usedFileIds.add(row.source_file_id);

    let deleted = 0;
    for (const f of files) {
      if (!usedFileIds.has(f.fileId)) {
        if (deleteFile(f.fileId)) deleted++;
      }
    }
    res.json({ success: true, deleted });
  } catch (err) {
    console.error('Error cleaning orphan files:', err);
    res.status(500).json({ error: 'Failed to clean orphans' });
  }
});

// Bulk delete a list of file ids in one request.
router.post('/files/bulk-delete', (req, res) => {
  try {
    const ids = (req.body as { ids?: string[] }).ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids[] required' });
      return;
    }
    let deleted = 0;
    for (const id of ids) {
      if (typeof id === 'string' && deleteFile(id)) deleted++;
    }
    res.json({ success: true, deleted });
  } catch (err) {
    console.error('Error bulk-deleting files:', err);
    res.status(500).json({ error: 'Failed to bulk delete' });
  }
});

// Delete a file
router.delete('/files/:id', (req, res) => {
  try {
    const deleted = deleteFile(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// File download moved above authMiddleware for public access

// Rename a thread
router.patch('/threads/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Thread name required' });
      return;
    }

    const thread = getThread(id);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    const db = getDb();
    db.prepare('UPDATE threads SET name = ? WHERE id = ?').run(name, id);

    // Broadcast updated thread to all clients
    registry.broadcast({
      type: 'thread_updated',
      thread: {
        id: thread.id,
        name,
        type: thread.type,
        unread_count: thread.unread_count,
        last_activity_at: thread.last_activity_at,
        last_message_preview: null,
        pinned_at: thread.pinned_at ?? null,
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error renaming thread:', error);
    res.status(500).json({ error: 'Failed to rename thread' });
  }
});

// Message search
router.get('/search', (req, res) => {
  try {
    // A repeated parameter arrives as an array, which used to throw on q.trim()
    // or reach searchMessages as something other than a string, so only a
    // plain string is accepted for either.
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    if (!q || q.trim().length === 0) {
      return res.status(400).json({ error: 'Search query required' });
    }
    const threadId = typeof req.query.threadId === 'string' ? req.query.threadId : undefined;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    const { messages: rows, total } = searchMessages({ query: q.trim(), threadId, limit, offset });

    const results = rows.map(row => {
      // Build highlight snippet around match
      const idx = row.content.toLowerCase().indexOf(q.toLowerCase());
      const start = Math.max(0, idx - 40);
      const end = Math.min(row.content.length, idx + q.length + 40);
      const highlight = (start > 0 ? '...' : '') + row.content.slice(start, end) + (end < row.content.length ? '...' : '');

      return {
        messageId: row.id,
        threadId: row.thread_id,
        threadName: row.thread_name,
        role: row.role,
        content: row.content.substring(0, 200),
        highlight,
        createdAt: row.created_at,
      };
    });

    res.json({ results, total });
  } catch (error) {
    console.error('Error searching messages:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Audit log entries
router.get('/audit', (req, res) => {
  try {
    const { limit } = req.query;
    const entries = getRecentAuditEntries(limit ? parseInt(limit as string, 10) : 50);
    res.json({ entries });
  } catch (error) {
    console.error('Error fetching audit log:', error);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// Agent sessions (local transcript reader, ~/.claude/projects)
router.get('/sessions', async (req, res) => {
  try {
    const { limit } = req.query;
    const agentService = req.app.locals.agentService as AgentService;
    const sessions = await agentService.listSessions(limit ? parseInt(limit as string, 10) : 50);
    res.json({ sessions });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// --- Settings & Orchestrator endpoints ---

// Get all config
router.get('/settings', (req, res) => {
  try {
    const config = getAllConfig();
    // Overlay YAML model values so the ModelSelector pill shows the real config
    const aerieCfg = getAerieConfig();
    const autonomousRoute = resolveCompatibleAgentRoute(
      aerieCfg.agent.model_autonomous,
      aerieCfg.agent.routing_autonomous || aerieCfg.agent.routing || 'sdk',
    ).routing;
    config['agent.model'] = aerieCfg.agent.model;
    config['agent.model_autonomous'] = aerieCfg.agent.model_autonomous;
    config['agent.model_pulse'] = aerieCfg.agent.model_pulse;
    config['agent.thinking'] = aerieCfg.agent.thinking;
    config['agent.effort'] = aerieCfg.agent.effort || 'adaptive';
    config['agent.claude_thinking'] = aerieCfg.agent.claude_thinking || aerieCfg.agent.thinking || 'adaptive';
    config['agent.claude_effort'] = aerieCfg.agent.claude_effort || aerieCfg.agent.effort || 'adaptive';
    config['agent.codex_effort'] = aerieCfg.agent.codex_effort || aerieCfg.agent.effort || 'adaptive';
    config['agent.codex_speed'] = aerieCfg.agent.codex_speed || 'standard';
    config['agent.routing'] = aerieCfg.agent.routing || 'sdk';
    config['agent.routing_autonomous'] = autonomousRoute;
    // Provider tracking for the model selector — stored in DB config
    if (!config['agent.provider']) config['agent.provider'] = 'anthropic';
    res.json({ config });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Update a config value
router.put('/settings', (req, res) => {
  try {
    const { key, value } = req.body;
    console.log(`[Settings] PUT ${key}=${value} (typeof key=${typeof key}, typeof value=${typeof value})`);
    if (!key || typeof key !== 'string' || typeof value !== 'string') {
      console.log(`[Settings] REJECTED: key/value type mismatch`);
      res.status(400).json({ error: 'key and value (strings) required' });
      return;
    }
    // DB row, in-memory config and aerie.yaml all move together — see
    // services/agent-settings.ts for why doing only one of them is a trap.
    persistAgentSetting(key, value);

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating setting:', error);
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

// Get config endpoint — returns companion/user names plus all DB config
router.get('/config', (req, res) => {
  try {
    const aerieConfig = getAerieConfig();
    const dbConfig = withoutSecrets(getAllConfig());
    res.json({
      companion_name: aerieConfig.identity.companion_name,
      user_name: aerieConfig.identity.user_name,
      timezone: aerieConfig.identity.timezone,
      config: dbConfig,
    });
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

// Get skills from agent CWD
router.get('/skills', (req, res) => {
  try {
    const config = getAerieConfig();
    const agentCwd = config.agent.cwd;
    const skillsDir = join(agentCwd, '.claude', 'skills');

    if (!existsSync(skillsDir)) {
      res.json({ skills: [] });
      return;
    }

    const skills: Array<{ name: string; description: string }> = [];
    const dirs = readdirSync(skillsDir, { withFileTypes: true });

    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const skillFile = join(skillsDir, dir.name, 'SKILL.md');
      if (!existsSync(skillFile)) continue;

      const content = readFileSync(skillFile, 'utf-8');

      // Parse YAML frontmatter
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;

      const fm = fmMatch[1];
      const nameMatch = fm.match(/^name:\s*["']?(.+?)["']?\s*$/m);
      const descMatch = fm.match(/^description:\s*["']?(.+?)["']?\s*$/m);

      skills.push({
        name: nameMatch?.[1] || dir.name,
        description: descMatch?.[1] || '',
      });
    }

    res.json({ skills });
  } catch (error) {
    console.error('Error reading skills:', error);
    res.status(500).json({ error: 'Failed to read skills' });
  }
});

// --- Canvas REST routes ---

// List canvases
router.get('/canvases', (req, res) => {
  try {
    const canvases = listCanvases();
    res.json({ canvases });
  } catch (error) {
    console.error('Error listing canvases:', error);
    res.status(500).json({ error: 'Failed to list canvases' });
  }
});

// Create canvas
router.post('/canvases', (req, res) => {
  try {
    const { title, contentType, language, threadId } = req.body;
    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: 'title is required' });
      return;
    }

    const now = new Date().toISOString();
    const canvas = createCanvas({
      id: crypto.randomUUID(),
      threadId: threadId || undefined,
      title,
      contentType: contentType || 'markdown',
      language: language || undefined,
      createdBy: 'user',
      createdAt: now,
    });

    registry.broadcast({ type: 'canvas_created', canvas });
    res.json({ canvas });
  } catch (error) {
    console.error('Error creating canvas:', error);
    res.status(500).json({ error: 'Failed to create canvas' });
  }
});

// Get canvas
router.get('/canvases/:id', (req, res) => {
  try {
    const canvas = getCanvas(req.params.id);
    if (!canvas) {
      res.status(404).json({ error: 'Canvas not found' });
      return;
    }
    res.json({ canvas });
  } catch (error) {
    console.error('Error fetching canvas:', error);
    res.status(500).json({ error: 'Failed to fetch canvas' });
  }
});

// Update canvas
router.patch('/canvases/:id', (req, res) => {
  try {
    const canvas = getCanvas(req.params.id);
    if (!canvas) {
      res.status(404).json({ error: 'Canvas not found' });
      return;
    }

    const now = new Date().toISOString();
    const { title, content } = req.body;

    if (title !== undefined) {
      updateCanvasTitle(req.params.id, title, now);
    }
    if (content !== undefined) {
      updateCanvasContent(req.params.id, content, now);
      registry.broadcast({ type: 'canvas_updated', canvasId: req.params.id, content, updatedAt: now });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating canvas:', error);
    res.status(500).json({ error: 'Failed to update canvas' });
  }
});

// Delete canvas
router.delete('/canvases/:id', (req, res) => {
  try {
    const deleted = deleteCanvas(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Canvas not found' });
      return;
    }
    registry.broadcast({ type: 'canvas_deleted', canvasId: req.params.id });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting canvas:', error);
    res.status(500).json({ error: 'Failed to delete canvas' });
  }
});

// --- Push subscription endpoints ---

// Subscribe to push notifications
router.post('/push/subscribe', (req, res) => {
  try {
    const { endpoint, keys, deviceLabel, deviceToken } = req.body;

    // APK path: @capacitor/push-notifications hands us an FCM device token and
    // nothing else. The web-push shape below is kept for the old PWA path.
    if (deviceToken) {
      const id = crypto.randomUUID();
      addFcmSubscription({ id, deviceToken, deviceName: deviceLabel });
      res.json({ success: true, id, transport: 'fcm' });
      return;
    }

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      res.status(400).json({ error: 'deviceToken, or endpoint and keys (p256dh, auth), required' });
      return;
    }

    const id = crypto.randomUUID();
    addPushSubscription({
      id,
      endpoint,
      keysP256dh: keys.p256dh,
      keysAuth: keys.auth,
      deviceName: deviceLabel,
    });

    res.json({ success: true, id });
  } catch (error) {
    console.error('Error subscribing to push:', error);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// Unsubscribe from push notifications
router.post('/push/unsubscribe', (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      res.status(400).json({ error: 'endpoint required' });
      return;
    }

    const removed = removePushSubscription(endpoint);
    res.json({ success: true, removed });
  } catch (error) {
    console.error('Error unsubscribing from push:', error);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

// List push subscriptions (truncated endpoints for display)
router.get('/push/subscriptions', (req, res) => {
  try {
    const subs = listPushSubscriptions();
    const display = subs.map(s => ({
      id: s.id,
      deviceName: s.device_name,
      endpoint: s.endpoint ? s.endpoint.slice(0, 60) + '...' : null,
      createdAt: s.created_at,
      lastUsedAt: s.last_used_at,
    }));
    res.json({ subscriptions: display });
  } catch (error) {
    console.error('Error listing push subscriptions:', error);
    res.status(500).json({ error: 'Failed to list subscriptions' });
  }
});

// Send test push notification
router.post('/push/test', async (req, res) => {
  try {
    const pushService = req.app.locals.pushService as PushService | undefined;
    if (!pushService?.isConfigured()) {
      res.status(503).json({ error: 'Push not configured — add the Firebase service-account JSON as fcm_service_account in Settings → Keys.' });
      return;
    }

    const config = getAerieConfig();
    await pushService.sendPush({
      title: config.identity.companion_name,
      body: 'Push notifications are working!',
      tag: 'test',
      url: '/chat',
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error sending test push:', error);
    res.status(500).json({ error: 'Failed to send test push' });
  }
});

// ─── Usage tracking ──────────────────────────────────────────────
// (Moved to dedicated routes/usage.ts router)

// ─── Artifacts (interactive React components) ────────────────────
router.get('/artifacts', (req, res) => {
  try {
    const db = getDb();
    const artifacts = db.prepare(`
      SELECT id, name, description, thumbnail, created_at, updated_at
      FROM artifacts
      ORDER BY updated_at DESC
    `).all();
    res.json({ artifacts });
  } catch (err) {
    console.error('[Artifacts] List error:', err);
    res.status(500).json({ error: 'Failed to list artifacts' });
  }
});

router.get('/artifacts/:id', (req, res) => {
  try {
    const db = getDb();
    const artifact = db.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(req.params.id);
    if (!artifact) {
      return res.status(404).json({ error: 'Artifact not found' });
    }
    res.json({ artifact });
  } catch (err) {
    console.error('[Artifacts] Get error:', err);
    res.status(500).json({ error: 'Failed to get artifact' });
  }
});

router.post('/artifacts', async (req, res) => {
  try {
    const { name, description, code, thumbnail } = req.body;
    if (!name || !code) {
      return res.status(400).json({ error: 'name and code are required' });
    }

    // Pre-compile JSX to plain JavaScript
    let compiledCode = code;
    try {
      const result = await babel.transformAsync(code, {
        presets: ['@babel/preset-react'],
        filename: 'artifact.jsx',
      });
      if (result?.code) {
        compiledCode = result.code;
        console.log('[Artifacts] Compiled JSX successfully');
      }
    } catch (compileErr: any) {
      console.warn('[Artifacts] JSX compilation failed, storing raw code:', compileErr.message);
      // Store raw code if compilation fails — might be plain JS already
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const db = getDb();
    db.prepare(`
      INSERT INTO artifacts (id, name, description, code, thumbnail, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, description || null, compiledCode, thumbnail || null, now, now);
    const artifact = db.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(id);
    res.status(201).json({ artifact });
  } catch (err) {
    console.error('[Artifacts] Create error:', err);
    res.status(500).json({ error: 'Failed to create artifact' });
  }
});

router.patch('/artifacts/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Artifact not found' });
    }
    const { name, description, code, thumbnail } = req.body;
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE artifacts SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        code = COALESCE(?, code),
        thumbnail = COALESCE(?, thumbnail),
        updated_at = ?
      WHERE id = ?
    `).run(name, description, code, thumbnail, now, req.params.id);
    const artifact = db.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(req.params.id);
    res.json({ artifact });
  } catch (err) {
    console.error('[Artifacts] Update error:', err);
    res.status(500).json({ error: 'Failed to update artifact' });
  }
});

router.delete('/artifacts/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare(`SELECT * FROM artifacts WHERE id = ?`).get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Artifact not found' });
    }
    db.prepare(`DELETE FROM artifacts WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[Artifacts] Delete error:', err);
    res.status(500).json({ error: 'Failed to delete artifact' });
  }
});

/** Call after loadConfig() to mount Command Center routes */
export async function initCcRoutes() {
  try {
    if (getAerieConfig().command_center?.enabled) {
      const { default: ccRoutes } = await import('./cc-routes.js');
      router.use('/cc', ccRoutes);
      console.log('[CC] Command Center routes mounted');
    }
  } catch (error) {
    console.warn('[CC] Failed to mount Command Center routes:', (error as Error).message);
  }
}

router.get('/usage/antigravity', async (req, res) => {
  try {
    const { getAntigravityUsage } = await import('../services/antigravity-usage.js');
    res.json(await getAntigravityUsage());
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Antigravity usage unavailable',
    });
  }
});

// Wipe cached TTS audio. With no body, clears every cached file —
// useful when the splitter changed and you want existing messages
// re-generated under the new rules. With { messageId }, clears one.

export default router;
