// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { WebSocketServer } from 'ws';
import { IncomingMessage, Server as HTTPServer } from 'http';
import crypto from 'crypto';
import { join } from 'path';
import { PROJECT_ROOT } from '../config.js';
import type {
  ClientMessage,
  ServerMessage,
  Thread,
} from '@aerie/shared';
import {
  getDb,
  createMessage,
  listThreads,
  getThread,
  createThread,
  updateThreadActivity,
  getFallbackThread,
  dailyThreadsEnabled,
  listCanvases,
  getConfigBool,
} from './db.js';
import { AgentService } from './agent.js';
import { Orchestrator } from './orchestrator.js';
import { getFile } from './files.js';
import type { VoiceService } from './voice.js';
import type { DiscordService } from './discord/index.js';
import type { TelegramService } from './telegram/index.js';
import { getAerieConfig } from '../config.js';
import { buildCommandRegistry } from './commands.js';
import { stickerRefsToImageBlocks, emojiRefsToImageBlocks, capImageBlocks, urlToImageBlock, type ImageBlock } from './visual-blocks.js';
import { registry } from './ws/connection-registry.js';
import type { ExtendedWebSocket } from './ws/connection-registry.js';
import { registerWebSocketUpgradeHandler } from './ws/upgrade-lifecycle.js';
import { routeClientMessage, type ClientMessageRouteMap } from './ws/message-router.js';
import {
  threadsToSummaries,
  handleSync,
  handleRead,
  handleSwitchThread,
  handleCreateThread,
} from './ws/handlers/thread-handlers.js';
import {
  setVoiceService as _setVoiceService,
  getVoiceService,
  handleVoiceStart,
  handleVoiceAudio,
  handleVoiceStop,
  handleVoiceCancel,
  handleVoiceMode,
  generateAndStreamTTS,
} from './ws/handlers/voice-handlers.js';
import {
  handleCanvasCreate,
  handleCanvasUpdate,
  handleCanvasUpdateTitle,
  handleCanvasDelete,
  handleCanvasList,
} from './ws/handlers/canvas-handlers.js';
import {
  handleAddReaction,
  handleRemoveReaction,
  handlePinThread,
  handleUnpinThread,
} from './ws/handlers/reaction-handlers.js';
import { handleMcpReconnect, handleMcpToggle } from './ws/handlers/mcp-handlers.js';
import { handleCommandMessage } from './ws/handlers/command-handlers.js';

export { registry } from './ws/connection-registry.js';
export type { ExtendedWebSocket } from './ws/connection-registry.js';

// Matches the express body-parser + /api/files multer caps so a text frame
// can carry an embedded file dump (PDF/text attachments are inlined into
// the message content by ChatInput, the same way Constellation's worker
// passed them straight through to the model).
const MAX_TEXT_MESSAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_VOICE_MESSAGE_SIZE = 512 * 1024; // 512KB for voice audio chunks

function parseDeviceType(ua: string): 'mobile' | 'desktop' | 'unknown' {
  if (!ua) return 'unknown';
  if (/iPhone|iPad|iPod|Android|Mobile|webOS|BlackBerry|Opera Mini|IEMobile/i.test(ua)) {
    return 'mobile';
  }
  if (/Mozilla|Chrome|Safari|Firefox|Edge|Opera/i.test(ua)) {
    return 'desktop';
  }
  return 'unknown';
}

function sendError(ws: ExtendedWebSocket, code: string, message: string): void {
  const msg: ServerMessage = { type: 'error', code, message };
  ws.send(JSON.stringify(msg));
}

export function setVoiceService(vs: VoiceService): void {
  _setVoiceService(vs);
}

export interface GatewayServices {
  discord?: DiscordService | null;
  telegram?: TelegramService | null;
}

let gatewayServices: GatewayServices = {};

export function setGatewayServices(services: GatewayServices): void {
  gatewayServices = services;
}

export function createWebSocketServer(server: HTTPServer, agentService?: AgentService, orchestrator?: Orchestrator): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const agent = agentService ?? new AgentService();
  registerWebSocketUpgradeHandler(server, wss);

  // Connection handler
  wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
    const extWs = ws as unknown as ExtendedWebSocket;

    // Extract client IP for per-IP rate limiting
    const forwarded = request.headers['x-forwarded-for'];
    const clientIp = typeof forwarded === 'string'
      ? forwarded.split(',')[0].trim()
      : request.socket.remoteAddress || 'unknown';

    // Security: per-IP connection limit
    if (!registry.canAcceptConnection(clientIp)) {
      console.warn(`[WS] Connection limit exceeded for IP: ${clientIp}`);
      ws.close(1008, 'Connection limit exceeded');
      return;
    }

    extWs.isAlive = true;
    extWs.userId = 'user';
    extWs.voiceModeEnabled = false;
    extWs.audioChunks = [];
    extWs.audioBytes = 0;
    extWs.voiceAudioChunkCount = 0;
    extWs.isRecording = false;
    extWs.audioMimeType = 'audio/webm';
    extWs.voiceCaptureMode = 'dictation';
    extWs.voiceAnalyzeToneRequested = false;
    extWs.activeRecordingId = null;
    extWs.transcriptionAbort = null;
    extWs.userAgent = request.headers['user-agent'] || '';
    extWs.deviceType = parseDeviceType(extWs.userAgent);
    extWs.tabVisible = true;
    extWs.messageCount = 0;
    extWs.messageWindowStart = Date.now();
    extWs.prosodyAbort = null;
    extWs.realtimeProsody = null;
    (extWs as any)._clientIp = clientIp; // Store for cleanup

    registry.add(extWs.userId, extWs, clientIp);

    // Send connected message with thread list and status
    const threads = listThreads({ includeArchived: false });
    // The room the app opens into. This has to honour the same fallback the
    // rest of the house uses — an owner who has said they never want a daily
    // thread should not be dropped into one the moment they open the app.
    const opening = getFallbackThread();

    const connectedMsg: ServerMessage = {
      type: 'connected',
      sessionStatus: agent.getPresenceStatus(),
      threads: threadsToSummaries(threads),
      activeThreadId: opening?.id ?? null,
      commands: buildCommandRegistry(),
    };
    extWs.send(JSON.stringify(connectedMsg));

    // Send canvas list
    const canvases = listCanvases();
    if (canvases.length > 0) {
      const canvasListMsg: ServerMessage = { type: 'canvas_list', canvases };
      extWs.send(JSON.stringify(canvasListMsg));
    }

    // Heartbeat
    extWs.on('pong', () => {
      extWs.isAlive = true;
    });

    const clientMessageRoutingMap: ClientMessageRouteMap = {
      ping: () => {
        extWs.send(JSON.stringify({ type: 'pong' }));
      },
      message: async (clientMsg) => {
        registry.touchUserActivity();
        registry.touchUserWebActivity();
        await handleMessageSend(clientMsg, extWs, agent);
      },
      sync: (clientMsg) => {
        handleSync(clientMsg, extWs);
      },
      read: (clientMsg) => {
        registry.touchUserActivity();
        registry.touchUserWebActivity();
        handleRead(clientMsg);
      },
      switch_thread: (clientMsg) => {
        registry.touchUserActivity();
        registry.touchUserWebActivity();
        handleSwitchThread(clientMsg, extWs);
      },
      create_thread: (clientMsg) => {
        registry.touchUserActivity();
        registry.touchUserWebActivity();
        handleCreateThread(clientMsg);
      },
      request_status: () => {
        handleRequestStatus(extWs, agent, orchestrator);
      },
      voice_start: (clientMsg) => {
        registry.touchUserActivity();
        registry.touchUserWebActivity();
        handleVoiceStart(extWs, clientMsg);
      },
      voice_audio: (clientMsg) => {
        handleVoiceAudio(extWs, clientMsg);
      },
      voice_stop: (clientMsg) => {
        registry.touchUserActivity();
        registry.touchUserWebActivity();
        handleVoiceStop(extWs, clientMsg);
      },
      voice_cancel: (clientMsg) => {
        handleVoiceCancel(extWs, clientMsg);
      },
      voice_mode: (clientMsg) => {
        handleVoiceMode(extWs, clientMsg);
      },
      voice_interrupt: () => {
        // Client wants to stop TTS playback — no server action needed
      },
      canvas_create: (clientMsg) => {
        registry.touchUserActivity();
        registry.touchUserWebActivity();
        handleCanvasCreate(clientMsg, extWs);
      },
      canvas_update: (clientMsg) => {
        registry.touchUserActivity();
        registry.touchUserWebActivity();
        handleCanvasUpdate(clientMsg, extWs);
      },
      canvas_update_title: (clientMsg) => {
        registry.touchUserActivity();
        registry.touchUserWebActivity();
        handleCanvasUpdateTitle(clientMsg, extWs);
      },
      canvas_delete: (clientMsg) => {
        registry.touchUserActivity();
        registry.touchUserWebActivity();
        handleCanvasDelete(clientMsg, extWs);
      },
      canvas_list: () => {
        handleCanvasList(extWs);
      },
      add_reaction: (clientMsg) => {
        registry.touchUserActivity();
        registry.touchUserWebActivity();
        handleAddReaction(clientMsg, extWs);
      },
      remove_reaction: (clientMsg) => {
        registry.touchUserActivity();
        registry.touchUserWebActivity();
        handleRemoveReaction(clientMsg, extWs);
      },
      pin_thread: (clientMsg) => {
        registry.touchUserActivity();
        registry.touchUserWebActivity();
        handlePinThread(clientMsg);
      },
      unpin_thread: (clientMsg) => {
        registry.touchUserActivity();
        registry.touchUserWebActivity();
        handleUnpinThread(clientMsg);
      },
      visibility: (clientMsg) => {
        extWs.tabVisible = clientMsg.visible;
      },
      stop_generation: () => {
        agent.stopGeneration();
      },
      mcp_reconnect: async (clientMsg) => {
        await handleMcpReconnect(clientMsg, extWs, { agent });
      },
      mcp_toggle: async (clientMsg) => {
        await handleMcpToggle(clientMsg, extWs, { agent });
      },
      rewind_files: async (clientMsg) => {
        const result = await agent.rewindFiles(clientMsg.userMessageId, clientMsg.dryRun);
        const rewindMsg: import('@aerie/shared').ServerMessage = {
          type: 'rewind_result',
          canRewind: result.canRewind,
          filesChanged: result.filesChanged,
          insertions: result.insertions,
          deletions: result.deletions,
          error: result.error,
        };
        extWs.send(JSON.stringify(rewindMsg));
      },
      command: async (clientMsg) => {
        registry.touchUserActivity();
        registry.touchUserWebActivity();
        await handleCommandMessage(clientMsg, extWs, { agent, orchestrator });
      },
    };

    // Message handler
    extWs.on('message', async (data: Buffer) => {
      try {
        // Peek at message type for size limit selection
        const rawMessage = data.toString();
        let msgType: string | undefined;
        let messageRecordingId: unknown;
        try {
          const peek = JSON.parse(rawMessage);
          msgType = peek?.type;
          messageRecordingId = peek?.recordingId;
        } catch {
          sendError(extWs, 'invalid_message', 'Invalid JSON');
          return;
        }

        // 100ms real-time tone frames would exceed the ordinary 120/minute
        // message ceiling by design. Only exempt them during an active
        // recording; the voice handler enforces byte and per-recording chunk
        // caps, and stray voice_audio frames still use the general limiter.
        const recordingIdMatches = messageRecordingId === undefined || (
          typeof messageRecordingId === 'string'
          && (!extWs.activeRecordingId || messageRecordingId === extWs.activeRecordingId)
        );
        const isActiveVoiceAudio = (
          msgType === 'voice_audio'
          && extWs.isRecording
          && recordingIdMatches
        );
        if (msgType !== 'pong' && msgType !== 'visibility' && !isActiveVoiceAudio) {
          const now = Date.now();
          if (now - extWs.messageWindowStart > 60000) {
            extWs.messageCount = 0;
            extWs.messageWindowStart = now;
          }
          extWs.messageCount++;
          if (extWs.messageCount > 120) {
            sendError(extWs, 'rate_limited', 'Too many messages');
            return;
          }
        }

        const maxSize = msgType === 'voice_audio' ? MAX_VOICE_MESSAGE_SIZE : MAX_TEXT_MESSAGE_SIZE;
        if (data.length > maxSize) {
          sendError(extWs, 'message_too_large', `Message exceeds ${maxSize / 1024}KB limit`);
          return;
        }

        const clientMsg = JSON.parse(rawMessage) as ClientMessage;
        await routeClientMessage(clientMsg, clientMessageRoutingMap, (unhandledMessage) => {
          console.warn('Unhandled message type:', (unhandledMessage as any).type);
        });
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
        const errMsg = error instanceof Error ? error.message : 'Invalid message format';
        sendError(extWs, 'invalid_message', errMsg);
      }
    });

    extWs.on('close', () => {
      if (extWs.transcriptionAbort) {
        extWs.transcriptionAbort.abort();
        extWs.transcriptionAbort = null;
      }
      if (extWs.prosodyAbort) {
        extWs.prosodyAbort.abort();
        extWs.prosodyAbort = null;
      }
      extWs.realtimeProsody?.abort();
      extWs.realtimeProsody = null;
      const ip = (extWs as any)._clientIp;
      registry.remove(extWs.userId, extWs, ip);
    });

    extWs.on('error', (error) => {
      console.error('WebSocket error:', error);
      extWs.transcriptionAbort?.abort();
      extWs.prosodyAbort?.abort();
      extWs.realtimeProsody?.abort();
      extWs.realtimeProsody = null;
      // Security: clean up on error to prevent connection leak
      const ip = (extWs as any)._clientIp;
      registry.remove(extWs.userId, extWs, ip);
      extWs.terminate();
    });
  });

  // Heartbeat interval — terminate dead connections every 30s
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const extWs = ws as ExtendedWebSocket;
      if (!extWs.isAlive) {
        return extWs.terminate();
      }
      extWs.isAlive = false;
      extWs.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  return wss;
}

// --- Handlers ---

async function handleMessageSend(
  msg: Extract<ClientMessage, { type: 'message' }>,
  ws: ExtendedWebSocket,
  agentService: AgentService
): Promise<void> {
  const now = new Date().toISOString();
  const config = getAerieConfig();

  // Resolve thread
  let thread: Thread | null = null;
  if (msg.threadId) {
    thread = getThread(msg.threadId);
  } else {
    // No thread named: the owner's home thread when dailies are off, so a
    // reply never opens a room they are not standing in.
    thread = getFallbackThread();
    if (!thread && dailyThreadsEnabled()) {
      const dayName = new Date().toLocaleDateString('en-GB', {
        weekday: 'long', month: 'short', day: 'numeric',
      });
      thread = createThread({
        id: crypto.randomUUID(),
        name: dayName,
        type: 'daily',
        createdAt: now,
        sessionType: 'v2',
      });
    }
  }

  if (!thread) {
    sendError(ws, 'thread_not_found', 'Thread not found');
    return;
  }

  // Store user's message
  const userMessage = createMessage({
    id: crypto.randomUUID(),
    threadId: thread.id,
    role: 'user',
    content: msg.content,
    contentType: msg.contentType || 'text',
    metadata: msg.metadata,
    replyToId: msg.replyToId,
    createdAt: now,
  });

  // Mark as delivered + read (companion's system received it and will process it)
  getDb().prepare('UPDATE messages SET delivered_at = ?, read_at = ? WHERE id = ?').run(now, now, userMessage.id);
  userMessage.delivered_at = now;
  userMessage.read_at = now;

  updateThreadActivity(thread.id, now, false);

  // Broadcast user's message to all devices (with delivery/read status)
  registry.broadcast({ type: 'message', message: userMessage });

  // Build agent prompt
  let agentPrompt = msg.content;

  // Image blocks to embed directly in the model's input
  let imageBlocksForAgent: ImageBlock[] = [];

  // Check for batched attachments (multiple files sent together)
  const batchAttachments = (msg.metadata as any)?.attachments as Array<{
    fileId: string; filename: string; mimeType: string; size: number;
    url: string; contentType: string;
  }> | undefined;

  if (batchAttachments && batchAttachments.length > 0) {
    // The user's text message at line 662 already carries
    // metadata.attachments, and the phone's adapter renders each one
    // inline as an [IMG]:url sentinel below the text. We previously also
    // saved each attachment as its own contentType:'image' message and
    // broadcast it — that produced a duplicate bubble for every image
    // sent alongside text. Drop the per-attachment fanout; the inline
    // render in the text bubble is the source of truth.

    // Build ONE combined agent prompt for all files
    const images = batchAttachments.filter(a => a.contentType === 'image');
    const others = batchAttachments.filter(a => a.contentType !== 'image');
    const promptParts: string[] = [];

    // Embed images as content blocks for direct viewing
    if (images.length > 0) {
      const { fileToImageBlock, capImageBlocks } = await import('./visual-blocks.js');
      const imageBlocks: ImageBlock[] = [];

      for (const img of images) {
        const info = getFile(img.fileId);
        if (info?.path) {
          const block = fileToImageBlock(info.path);
          if (block) imageBlocks.push(block);
        }
      }

      const { kept } = capImageBlocks(imageBlocks);
      if (kept.length > 0) {
        imageBlocksForAgent = kept;
        console.log(`[Image] Embedding ${kept.length} image(s) as content blocks`);
      }
    }

    if (images.length === 1) {
      promptParts.push(`${config.identity.user_name} sent an image (${images[0].filename}).`);
    } else if (images.length > 1) {
      const names = images.map((a, i) => `${i + 1}. ${a.filename}`);
      promptParts.push(`${config.identity.user_name} sent ${images.length} images:\n${names.join('\n')}`);
    }

    for (const a of others) {
      const info = getFile(a.fileId);
      const sizeStr = a.size ? ` (${Math.round(a.size / 1024)}KB)` : '';
      promptParts.push(`${config.identity.user_name} sent a ${a.contentType}: ${a.filename}${sizeStr}${info ? ` — ${info.path}` : ''}`);
    }

    if (msg.content?.trim()) {
      promptParts.push(`\nTheir message: ${msg.content.trim()}`);
    }

    agentPrompt = promptParts.join('\n');
  } else {
    // Single message (no batch) — handle non-text content types
    const ct = msg.contentType || 'text';
    if (ct !== 'text' && msg.metadata) {
      const meta = msg.metadata as Record<string, unknown>;
      const fileId = meta.fileId as string | undefined;
      const filename = meta.filename as string | undefined;
      const size = meta.size as number | undefined;

      let diskPath = '';
      if (fileId) {
        const fileInfo = getFile(fileId);
        if (fileInfo) diskPath = fileInfo.path;
      }

      if (ct === 'image') {
        agentPrompt = `${config.identity.user_name} sent an image${filename ? ` (${filename})` : ''}.`;
        // Embed image as content block for direct viewing
        if (diskPath) {
          const { fileToImageBlock } = await import('./visual-blocks.js');
          const imageBlock = fileToImageBlock(diskPath);
          if (imageBlock) {
            imageBlocksForAgent = [imageBlock];
            console.log(`[Image] Embedding image as content block: ${filename || 'unknown'}`);
          }
        }
      } else if (ct === 'audio') {
        agentPrompt = `${config.identity.user_name} sent an audio message${filename ? ` (${filename})` : ''}.${diskPath ? ` File path: ${diskPath}` : ''}`;
      } else if (ct === 'file') {
        agentPrompt = `${config.identity.user_name} sent a file: ${filename || 'unknown'}${size ? ` (${Math.round(size / 1024)}KB)` : ''}.${diskPath ? ` File path: ${diskPath}` : ''}`;
      } else if (ct === 'sticker') {
        const stickerName = meta.stickerName as string | undefined;
        // Parse sticker URL to get file path: /stickers/{packId}/{filename} -> data/stickers/{packId}/{filename}
        const stickerUrl = msg.content;
        const stickerMatch = stickerUrl.match(/^\/stickers\/([^/]+)\/(.+)$/);
        let stickerPath = '';
        if (stickerMatch) {
          const [, packId, filename] = stickerMatch;
          stickerPath = join(PROJECT_ROOT, 'data/stickers', packId, filename);
        }
        agentPrompt = `${config.identity.user_name} sent a sticker${stickerName ? ` (:${stickerName}:)` : ''}.`;
        // Load sticker as image block for direct viewing
        if (stickerPath) {
          const { fileToImageBlock } = await import('./visual-blocks.js');
          const stickerBlock = fileToImageBlock(stickerPath);
          if (stickerBlock) {
            imageBlocksForAgent = [stickerBlock];
            console.log(`[Sticker] Embedding sticker as image block: ${stickerName || 'unknown'}`);
          }
        }
      }
    }
  }

  // Convert GIF sentinels and bare image URLs in plain text into image
  // content blocks the model can actually see. [IMG] sentinels and metadata
  // attachment URLs are already handled by the attachment path above.
  if ((!msg.contentType || msg.contentType === 'text') && msg.content) {
    const gifSentinel = /\[GIF\]:(https:\/\/\S+)/g;
    const imgSentinel = /\[IMG\]:(\S+)/g;
    const bareImageUrl = /https?:\/\/[^\s<>"']+\.(?:png|jpe?g|gif|webp)(?:[?#][^\s<>"']*)?/gi;
    const metadataImageUrls = new Set(
      (batchAttachments ?? [])
        .filter((a) => a.contentType === 'image')
        .map((a) => a.url)
    );
    const skippedUrls = new Set<string>(metadataImageUrls);
    for (const m of msg.content.matchAll(imgSentinel)) skippedUrls.add(m[1]);

    const imageUrls: string[] = [];
    const seenUrls = new Set<string>();
    const addImageUrl = (url: string): void => {
      if (!url || skippedUrls.has(url) || seenUrls.has(url)) return;
      seenUrls.add(url);
      imageUrls.push(url);
    };

    for (const m of msg.content.matchAll(gifSentinel)) addImageUrl(m[1]);
    for (const m of msg.content.matchAll(bareImageUrl)) addImageUrl(m[0]);

    if (imageUrls.length > 0) {
      const blocks = await Promise.all(imageUrls.map((u) => urlToImageBlock(u)));
      let fetched = 0;
      for (const b of blocks) {
        if (b) {
          imageBlocksForAgent.push(b);
          fetched++;
        }
      }
      if (fetched > 0) {
        console.log(`[Images] Embedded ${fetched}/${imageUrls.length} text image URL(s) as content blocks`);
      }
      const stripped = agentPrompt.replace(gifSentinel, '').replace(/\s+/g, ' ').trim();
      agentPrompt = stripped || `${config.identity.user_name} sent ${imageUrls.length === 1 ? 'an image' : `${imageUrls.length} images`}.`;
    }
  }

  // Collect emoji and sticker image blocks from text messages (APPEND to existing, don't overwrite)
  if ((!msg.contentType || msg.contentType === 'text') && msg.content) {
    const emojiBlocks = emojiRefsToImageBlocks(msg.content);
    const stickerBlocks = stickerRefsToImageBlocks(msg.content);
    const allBlocks = [...imageBlocksForAgent, ...emojiBlocks, ...stickerBlocks];
    const { kept, dropped } = capImageBlocks(allBlocks);
    imageBlocksForAgent = kept;
    if (kept.length > 0) {
      console.log(`[Images] Embedding ${kept.length} image(s) as content blocks (emojis: ${emojiBlocks.length}, stickers: ${stickerBlocks.length})`);
    }
    if (dropped > 0) {
      console.log(`[Images] Capped ${dropped} image(s) due to size limits`);
    }
  }

  // Prepend bounded expression context if present. These are Hume's
  // confidence-weighted perceptions of vocal qualities, not ground truth
  // about the user's internal emotional state.
  if (msg.metadata && typeof msg.metadata === 'object') {
    const prosody = (msg.metadata as Record<string, unknown>).prosody as Record<string, number> | undefined;
    if (prosody && Object.keys(prosody).length > 0) {
      const toneEntries = Object.entries(prosody)
        .filter((entry): entry is [string, number] => (
          typeof entry[1] === 'number' && Number.isFinite(entry[1])
        ))
        .slice(0, 3)
        .map(([emotion, score]) => {
          const safeLabel = emotion.replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 40);
          const confidence = Math.round(Math.max(0, Math.min(1, score)) * 100);
          return safeLabel ? `${safeLabel}: ${confidence}%` : '';
        })
        .filter(Boolean)
        .join(', ');
      if (toneEntries) {
        agentPrompt = `[Voice expression signals from Hume — perceived vocal qualities, not certain inner state; use subtly and do not repeat the labels unless relevant: ${toneEntries}]\n${agentPrompt}`;
      }
    }
  }

  // Process through agent — agent service handles streaming, DB storage, and broadcasting
  try {
    const agentResponse = await agentService.processMessage(
      thread.id,
      agentPrompt,
      { name: thread.name, type: thread.type },
      {
        imageBlocks: imageBlocksForAgent.length > 0 ? imageBlocksForAgent : undefined,
        inboundSequence: userMessage.sequence,
      }
    );
    updateThreadActivity(thread.id, new Date().toISOString(), true);

    // Auto-TTS: stream voice to any user connection with voice mode
    // enabled. Gated on both the canTTS check (do we have an API key?)
    // and the voice.enabled YAML flag (did the user flip the toggle in
    // Integrations?). Either off silences playback.
    const voiceEnabled = getConfigBool('voice.enabled', getAerieConfig().voice.enabled);
    const hasVoice = voiceEnabled && getVoiceService()?.canTTS;
    const responseLen = agentResponse?.length ?? 0;
    console.log(`[Voice] Auto-TTS check: hasVoice=${hasVoice}, voiceEnabled=${voiceEnabled}, responseLen=${responseLen}`);

    if (hasVoice && agentResponse) {
      const voiceConnections = registry.getConnectionsForUser('user')
        .filter(c => (c as ExtendedWebSocket).voiceModeEnabled);

      console.log(`[Voice] Voice mode connections: ${voiceConnections.length}`);

      if (voiceConnections.length > 0) {
        // Extract text for TTS from the agent response
        const ttsText = typeof agentResponse === 'string' ? agentResponse : String(agentResponse);
        if (ttsText.trim()) {
          console.log(`[Voice] Generating TTS for ${ttsText.length} chars`);
          const messageId = crypto.randomUUID();
          generateAndStreamTTS(ttsText, messageId, voiceConnections as ExtendedWebSocket[]).catch(err => {
            console.error('[Voice] Auto-TTS error:', err);
          });
        }
      }
    }
  } catch (error) {
    console.error('Agent processing error:', error);
    sendError(ws, 'agent_error', `${config.identity.companion_name} encountered an error processing your message`);
  }
}

async function handleRequestStatus(
  ws: ExtendedWebSocket,
  agent: AgentService,
  orchestrator?: Orchestrator
): Promise<void> {
  const mem = process.memoryUsage();
  const orchestratorTasks = orchestrator ? await orchestrator.getStatus() : [];
  const status: import('@aerie/shared').SystemStatus = {
    uptime: process.uptime(),
    memoryUsage: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
    connections: registry.getCount(),
    userConnected: registry.isUserConnected(),
    minutesSinceActivity: registry.minutesSinceLastUserActivity(),
    presence: agent.getPresenceStatus(),
    agentProcessing: agent.isProcessing(),
    orchestratorTasks,
    mcpServers: agent.getMcpStatus(),
    queryQueue: { processing: agent.isProcessing(), depth: agent.getQueueDepth() },
  };

  // Append gateway stats if available
  if (gatewayServices.discord) {
    const ds = gatewayServices.discord.getStats();
    status.discord = {
      connected: ds.connected,
      guilds: ds.guilds,
      messagesProcessed: ds.messagesProcessed,
      errors: ds.errors,
      deferredPending: ds.deferredPending,
      username: ds.username,
    };
  }
  if (gatewayServices.telegram) {
    const ts = gatewayServices.telegram.getStats();
    status.telegram = {
      connected: ts.connected,
      messagesProcessed: ts.messagesProcessed,
      errors: ts.errors,
      restarts: ts.restarts,
    };
  }

  const msg: import('@aerie/shared').ServerMessage = { type: 'system_status', status };
  ws.send(JSON.stringify(msg));
}
