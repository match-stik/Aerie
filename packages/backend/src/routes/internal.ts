// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Internal routes — localhost-only endpoints for agent/CLI use.
import { normalizeNoteColor } from '@aerie/shared';
import { getConfig, setConfig } from '../services/db/config.js';
import { resolveNoteColor } from '../services/note-color.js';
// These are called by the companion via curl from inside Claude Code,
// not by the phone UI. No auth required (localhost guard instead).

import { Router } from 'express';
import {
  listProposals,
  getProposal,
  resolveProposal,
  countPending,
} from '../services/memory-proposals.js';
import crypto from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { basename, resolve, dirname, join } from 'path';
import { getAllBlocks } from '../services/memory-blocks.js';
import { driftAgainstBaseline, renderDrift, BASELINE_FILE } from '../services/heartbeat/block-drift.js';
import { fileURLToPath } from 'url';
import {
  listThreads,
  getThread,
  createMessage,
  getMessages,
  updateThreadActivity,
  getDb,
  createCanvas,
  updateCanvasContent,
  createTimer,
  listPendingTimers,
  cancelTimer,
  createTrigger,
  listTriggers,
  cancelTrigger,
  getAllEmbeddings,
  getUnembeddedMessages,
  saveEmbedding,
  getEmbeddingCount,
  getMessageContext,
  addReaction,
  removeReaction,
  getCompanionBySlug,
  createJournalEntry,
  listJournalEntries,
  recallJournalEntry,
  anchorJournalEntry,
  updateJournalEntry,
  effectiveVividness,
  sealLetter,
  listLetters,
  openLetter,
  unopenedLettersFor,
  LetterError,
  createSelfKnowledge,
  listSelfKnowledge,
  reviewSelfKnowledge,
  reinforceSelfKnowledge,
  contradictSelfKnowledge,
  isSelfKnowledgeCategory,
  getPet,
  applyPetAction,
  recordPetVisit,
  withMood,
  listPetEvents,
  type PetAction,
  listPlaces, getPlace, createThreshold, listThresholds, placeHistory,
  getBattleshipCompanionView,
  fireAtPlayerFleet,
  addBattleshipChat,
  assertFleetCompanion,
  BattleshipError,
  getSelfKnowledge,
} from '../services/db.js';
import { postToTreehouse, getTreehouseInfo, getTreehouseMessages } from '../services/treehouse.js';
import type { TriggerCondition } from '../services/db.js';
import { embed, cosineSimilarity, bufferToVector, vectorToBuffer } from '../services/embeddings.js';
import { saveFileInternal, saveFile } from '../services/files.js';
import { registry } from '../services/ws.js';
import { getAerieConfig } from '../config.js';
import type { Orchestrator } from '../services/orchestrator.js';
import type { VoiceService } from '../services/voice.js';
import { latestReading, recentReadings, ageOf, isStale } from '../services/db/media-session.js';
import { searchSubtitles, pickSubtitle, downloadSubtitle } from '../services/opensubtitles.js';
import {
  loadScreening,
  sceneSince,
  positionOf,
  currentScreening,
  getScreening,
  presentScreening,
  startClock,
  pauseClock,
  seekClock,
  resyncClock,
  sceneAt,
  DEFAULT_LOOKBACK_MS,
} from '../services/db/screening.js';
import type { TelegramService } from '../services/telegram/index.js';

// Derive project root for path containment
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..');

function isPathAllowed(filePath: string): boolean {
  if (filePath.includes('\0')) return false;
  const resolvedPath = resolve(filePath);
  const safePrefixes = [PROJECT_ROOT, resolve(PROJECT_ROOT, '..')];
  return safePrefixes.some(prefix => resolvedPath.startsWith(prefix + '/') || resolvedPath.startsWith(prefix + '\\'));
}

function isLocalhost(req: { socket: { remoteAddress?: string } }): boolean {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

const router = Router();

// Short-term dedupe for the TTS path
const ttsDedupe = new Map<string, Promise<{ messageId: string; fileId: string; messageIds: string[]; fileIds: string[] }>>();
const ttsDedupeTtlMs = 60 * 1000;

// TTS endpoint — companion sends voice notes via curl from localhost
router.post('/internal/tts', async (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const { text, threadId: explicitThreadId, voice, voiceId } = req.body;
  if (!text) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  const voiceService = req.app.locals.voiceService as VoiceService | undefined;
  if (!voiceService?.canTTS) {
    res.status(500).json({ error: 'ElevenLabs not configured — set elevenlabs_api_key and elevenlabs_voice_id in Settings → Data.' });
    return;
  }

  let threadId = explicitThreadId;
  if (!threadId) {
    const threads = listThreads({ includeArchived: false, limit: 1 });
    if (threads.length === 0) {
      res.status(404).json({ error: 'No active threads found' });
      return;
    }
    threadId = threads[0].id;
  }

  const thread = getThread(threadId);
  if (!thread) {
    res.status(404).json({ error: 'Thread not found' });
    return;
  }

  const dedupeKey = `${threadId}::${voice ?? ''}::${voiceId ?? ''}::${text}`;
  let inflight = ttsDedupe.get(dedupeKey);
  if (!inflight) {
    inflight = voiceService.generateTTSForMessage(text, threadId, { voice, voiceId });
    ttsDedupe.set(dedupeKey, inflight);
    setTimeout(() => ttsDedupe.delete(dedupeKey), ttsDedupeTtlMs).unref?.();
  }

  try {
    const result = await inflight;
    // messageId/fileId stay the first note's so older callers keep working; a
    // note with several speakers arrives as one message each, all listed.
    res.json({
      success: true,
      messageId: result.messageId,
      fileId: result.fileId,
      messageIds: result.messageIds,
      fileIds: result.fileIds,
    });
  } catch (error) {
    ttsDedupe.delete(dedupeKey);
    console.error('TTS error:', error);
    const msg = error instanceof Error ? error.message : 'TTS generation failed';
    res.status(500).json({ error: msg });
  }
});

// Share a file into chat — companion shares files from disk into a thread
router.post('/internal/share', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const { path: filePath, threadId: explicitThreadId, caption } = req.body;
  if (!filePath || typeof filePath !== 'string') {
    res.status(400).json({ error: 'path is required' });
    return;
  }

  if (!isPathAllowed(filePath)) {
    res.status(403).json({ error: 'Path not allowed' });
    return;
  }

  if (!existsSync(filePath)) {
    res.status(404).json({ error: 'File not found on disk' });
    return;
  }

  let threadId = explicitThreadId;
  if (!threadId) {
    const threads = listThreads({ includeArchived: false, limit: 1 });
    if (threads.length === 0) {
      res.status(404).json({ error: 'No active threads found' });
      return;
    }
    threadId = threads[0].id;
  }

  const thread = getThread(threadId);
  if (!thread) {
    res.status(404).json({ error: 'Thread not found' });
    return;
  }

  try {
    const buffer = readFileSync(filePath);
    const filename = basename(filePath);
    const fileMeta = saveFileInternal(buffer, filename);

    const now = new Date().toISOString();
    const message = createMessage({
      id: crypto.randomUUID(),
      threadId,
      role: 'companion',
      content: caption || fileMeta.url,
      contentType: fileMeta.contentType,
      metadata: { fileId: fileMeta.fileId, filename: fileMeta.filename, size: fileMeta.size, source: 'shared' },
      createdAt: now,
    });

    updateThreadActivity(threadId, now, true);
    registry.broadcast({ type: 'message', message });

    res.json({ success: true, fileId: fileMeta.fileId, messageId: message.id, url: fileMeta.url });
  } catch (error) {
    console.error('Share file error:', error);
    const msg = error instanceof Error ? error.message : 'Failed to share file';
    res.status(500).json({ error: msg });
  }
});

// Telegram send — send files/photos/voice to user via Telegram
router.post('/internal/telegram-send', async (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const telegramService = req.app.locals.telegramService as TelegramService | undefined;
  if (!telegramService?.isConnected()) {
    res.status(503).json({ error: 'Telegram not connected' });
    return;
  }

  const { type, text, path: filePath, url, caption, filename, query, target, emoji } = req.body;

  try {
    switch (type) {
      case 'text':
        if (typeof text !== 'string' || !text) { res.status(400).json({ error: 'text is required, as a string' }); return; }
        await telegramService.sendToOwner(text);
        break;

      case 'voice':
        if (!text) { res.status(400).json({ error: 'text is required for TTS' }); return; }
        await telegramService.sendVoiceToOwner(text);
        break;

      case 'photo': {
        const source = url || (filePath && existsSync(filePath) ? readFileSync(filePath) : null);
        if (!source) { res.status(400).json({ error: 'url or valid path required' }); return; }
        await telegramService.sendPhotoToOwner(source, caption);
        break;
      }

      case 'document': {
        const docSource = url || (filePath && existsSync(filePath) ? readFileSync(filePath) : null);
        if (!docSource) { res.status(400).json({ error: 'url or valid path required' }); return; }
        await telegramService.sendDocumentToOwner(docSource, filename || basename(filePath || 'file'), caption);
        break;
      }

      case 'animation': {
        const animSource = url || (filePath && existsSync(filePath) ? readFileSync(filePath) : null);
        if (!animSource) { res.status(400).json({ error: 'url or valid path required' }); return; }
        await telegramService.sendAnimationToOwner(animSource, caption);
        break;
      }

      case 'gif':
        if (!query) { res.status(400).json({ error: 'query is required for gif search' }); return; }
        await telegramService.sendGifToOwner(query, caption);
        break;

      case 'react':
        if (!target || !emoji) { res.status(400).json({ error: 'target and emoji are required' }); return; }
        await telegramService.reactToMessage(target, emoji);
        break;

      default:
        res.status(400).json({ error: `Unknown type: ${type}. Use text, voice, photo, document, animation, gif, or react.` });
        return;
    }

    res.json({ success: true, type });
  } catch (error) {
    console.error('[API] Telegram send error:', error);
    const msg = error instanceof Error ? error.message : 'Telegram send failed';
    res.status(500).json({ error: msg });
  }
});

// Canvas — internal endpoint for agent to create/update canvases
router.post('/internal/canvas', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const config = getAerieConfig();
  const { action, canvasId, title, content, filePath, contentType, language, threadId } = req.body;
  const now = new Date().toISOString();

  let resolvedContent = content || '';
  if (filePath && typeof filePath === 'string') {
    if (!isPathAllowed(filePath)) {
      res.status(403).json({ error: 'Path not allowed' });
      return;
    }
    if (!existsSync(filePath)) {
      res.status(404).json({ error: 'File not found on disk' });
      return;
    }
    resolvedContent = readFileSync(filePath, 'utf-8');
  }

  try {
    if (action === 'create') {
      if (!title) {
        res.status(400).json({ error: 'title is required' });
        return;
      }

      const canvas = createCanvas({
        id: crypto.randomUUID(),
        threadId: threadId || undefined,
        title,
        content: resolvedContent,
        contentType: contentType || 'markdown',
        language: language || undefined,
        createdBy: 'companion',
        createdAt: now,
      });

      registry.broadcast({ type: 'canvas_created', canvas });

      if (threadId) {
        const thread = getThread(threadId);
        if (thread) {
          const sysMsg = createMessage({
            id: crypto.randomUUID(),
            threadId,
            role: 'system',
            content: `${config.identity.companion_name} opened a canvas: ${title}`,
            createdAt: now,
          });
          registry.broadcast({ type: 'message', message: sysMsg });
        }
      }

      res.json({ success: true, canvas });
    } else if (action === 'update') {
      if (!canvasId || (resolvedContent === '' && !filePath)) {
        res.status(400).json({ error: 'canvasId and content (or filePath) are required' });
        return;
      }
      updateCanvasContent(canvasId, resolvedContent, now);
      registry.broadcast({ type: 'canvas_updated', canvasId, content: resolvedContent, updatedAt: now });
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Unknown action. Use "create" or "update".' });
    }
  } catch (error) {
    console.error('Internal canvas error:', error);
    res.status(500).json({ error: 'Canvas operation failed' });
  }
});

// Orchestrator self-management — companion manages schedule via curl
router.post('/internal/orchestrator', async (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const orchestrator = req.app.locals.orchestrator as Orchestrator | undefined;
  if (!orchestrator) {
    res.status(503).json({ error: 'Orchestrator not available' });
    return;
  }

  const { action, wakeType, cronExpr } = req.body;

  try {
    switch (action) {
      case 'status': {
        const tasks = await orchestrator.getStatus();
        res.json({ tasks });
        break;
      }
      case 'enable': {
        if (!wakeType) { res.status(400).json({ error: 'wakeType required' }); return; }
        const success = orchestrator.enableTask(wakeType);
        if (!success) { res.status(404).json({ error: 'Unknown wake type' }); return; }
        res.json({ success: true, wakeType, enabled: true });
        break;
      }
      case 'disable': {
        if (!wakeType) { res.status(400).json({ error: 'wakeType required' }); return; }
        const success = orchestrator.disableTask(wakeType);
        if (!success) { res.status(404).json({ error: 'Unknown wake type' }); return; }
        res.json({ success: true, wakeType, enabled: false });
        break;
      }
      case 'reschedule': {
        if (!wakeType || !cronExpr) { res.status(400).json({ error: 'wakeType and cronExpr required' }); return; }
        const success = orchestrator.rescheduleTask(wakeType, cronExpr);
        if (!success) { res.status(400).json({ error: 'Failed — invalid cron or unknown wake type' }); return; }
        res.json({ success: true, wakeType, cronExpr });
        break;
      }
      default:
        res.status(400).json({ error: 'Unknown action. Use: status, enable, disable, reschedule' });
    }
  } catch (error) {
    console.error('Orchestrator internal error:', error);
    res.status(500).json({ error: 'Orchestrator operation failed' });
  }
});

// Timer/Reminder — companion sets contextual reminders via curl
router.post('/internal/timer', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const { action } = req.body;

  try {
    switch (action) {
      case 'create': {
        const { label, fireAt, threadId, context, prompt } = req.body;
        if (!label || !fireAt || !threadId) {
          res.status(400).json({ error: 'label, fireAt, and threadId required' });
          return;
        }

        const fireDate = new Date(fireAt);
        if (isNaN(fireDate.getTime())) {
          res.status(400).json({ error: 'fireAt must be a valid ISO date' });
          return;
        }

        const thread = getThread(threadId);
        if (!thread) {
          res.status(404).json({ error: 'Thread not found' });
          return;
        }

        const timer = createTimer({
          id: crypto.randomUUID(),
          label,
          context,
          fireAt: fireDate.toISOString(),
          threadId,
          prompt,
          createdAt: new Date().toISOString(),
        });

        res.json({ success: true, timer });
        break;
      }
      case 'list': {
        const timers = listPendingTimers();
        res.json({ timers });
        break;
      }
      case 'cancel': {
        const { timerId } = req.body;
        if (!timerId) {
          res.status(400).json({ error: 'timerId required' });
          return;
        }
        const cancelled = cancelTimer(timerId);
        if (!cancelled) {
          res.status(404).json({ error: 'Timer not found or already fired/cancelled' });
          return;
        }
        res.json({ success: true, timerId });
        break;
      }
      default:
        res.status(400).json({ error: 'Unknown action. Use: create, list, cancel' });
    }
  } catch (error) {
    console.error('Timer internal error:', error);
    res.status(500).json({ error: 'Timer operation failed' });
  }
});

// Trigger management (internal — agent use via CLI)
router.post('/internal/trigger', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const { action } = req.body;

  try {
    switch (action) {
      case 'create': {
        const { kind, label, conditions, prompt, threadId, cooldownMinutes } = req.body;
        if (!kind || !label || !conditions) {
          res.status(400).json({ error: 'kind, label, and conditions required' });
          return;
        }
        if (kind !== 'impulse' && kind !== 'watcher') {
          res.status(400).json({ error: 'kind must be "impulse" or "watcher"' });
          return;
        }
        if (!Array.isArray(conditions) || conditions.length === 0) {
          res.status(400).json({ error: 'conditions must be a non-empty array' });
          return;
        }

        if (threadId) {
          const thread = getThread(threadId);
          if (!thread) {
            res.status(404).json({ error: 'Thread not found' });
            return;
          }
        }

        const trigger = createTrigger({
          id: crypto.randomUUID(),
          kind,
          label,
          conditions: conditions as TriggerCondition[],
          prompt,
          threadId,
          cooldownMinutes: cooldownMinutes ? parseInt(cooldownMinutes, 10) : undefined,
          createdAt: new Date().toISOString(),
        });

        res.json({ success: true, trigger });
        break;
      }
      case 'list': {
        const { kind } = req.body;
        const triggers = listTriggers(kind);
        res.json({ triggers });
        break;
      }
      case 'cancel': {
        const { triggerId } = req.body;
        if (!triggerId) {
          res.status(400).json({ error: 'triggerId required' });
          return;
        }
        const cancelled = cancelTrigger(triggerId);
        if (!cancelled) {
          res.status(404).json({ error: 'Trigger not found or already fired/cancelled' });
          return;
        }
        res.json({ success: true, triggerId });
        break;
      }
      default:
        res.status(400).json({ error: 'Unknown action. Use: create, list, cancel' });
    }
  } catch (error) {
    console.error('Trigger internal error:', error);
    res.status(500).json({ error: 'Trigger operation failed' });
  }
});

// React to a message (internal — agent use via CLI)
// ─── Permanent Letters — companion lane ─────────────────────────
// The vault's write-once tier. No update or delete endpoints exist.

router.post('/internal/letters', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  try {
    const { companion, recipients, kind, title, content, seal, openAt, hidden } = req.body ?? {};
    if (!companion) {
      res.status(400).json({ error: 'companion required' });
      return;
    }
    const letter = sealLetter({
      author: String(companion),
      recipients: Array.isArray(recipients) ? recipients : [],
      kind: kind ?? 'letter',
      title: title ?? null,
      content: content ?? '',
      seal: seal ?? 'open',
      openAt: openAt ?? null,
      hidden: hidden === true,
    });
    res.status(201).json(letter);
  } catch (error) {
    if (error instanceof LetterError) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error('Letters internal error:', error);
    res.status(500).json({ error: 'Sealing failed' });
  }
});

router.get('/internal/letters', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  const viewer = typeof req.query.companion === 'string' ? req.query.companion : '';
  if (!viewer) {
    res.status(400).json({ error: 'companion query param required' });
    return;
  }
  if (String(req.query.unopened) === '1') {
    res.json({ letters: unopenedLettersFor(viewer) });
    return;
  }
  res.json({ letters: listLetters(viewer) });
});

router.post('/internal/letters/:id/open', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  try {
    const { companion } = req.body ?? {};
    if (!companion) {
      res.status(400).json({ error: 'companion required' });
      return;
    }
    res.json(openLetter(String(req.params.id), String(companion)));
  } catch (error) {
    if (error instanceof LetterError) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error('Letters open error:', error);
    res.status(500).json({ error: 'Open failed' });
  }
});

router.post('/internal/react', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  try {
    let { messageId, emoji, action, threadId, target } = req.body;
    if (!emoji) {
      res.status(400).json({ error: 'emoji required' });
      return;
    }

    // Resolve target shorthand: "last", "last-2", "last-3" etc.
    if (!messageId && threadId && target) {
      const offset = target === 'last' ? 0 : parseInt(target.replace('last-', ''), 10) - 1;
      if (isNaN(offset) || offset < 0) {
        res.status(400).json({ error: 'Invalid target. Use "last", "last-2", "last-3" etc.' });
        return;
      }
      const msgs = getMessages({ threadId, limit: offset + 5 });
      const idx = msgs.length - 1 - offset;
      if (idx < 0) {
        res.status(404).json({ error: 'No message at that position' });
        return;
      }
      messageId = msgs[idx].id;
    }

    if (!messageId) {
      res.status(400).json({ error: 'messageId or (threadId + target) required' });
      return;
    }

    if (action === 'remove') {
      removeReaction(messageId, emoji, 'companion');
      registry.broadcast({
        type: 'message_reaction_removed',
        messageId,
        emoji,
        user: 'companion',
      });
    } else {
      addReaction(messageId, emoji, 'companion');
      registry.broadcast({
        type: 'message_reaction_added',
        messageId,
        emoji,
        user: 'companion',
        createdAt: new Date().toISOString(),
      });
    }

    res.json({ success: true, messageId });
  } catch (error) {
    console.error('React internal error:', error);
    res.status(500).json({ error: 'React operation failed' });
  }
});

// Semantic search (localhost-only)
router.post('/internal/search-semantic', async (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  try {
    const { query, threadId, limit = 10 } = req.body as {
      query?: string; threadId?: string; limit?: number;
    };
    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    const queryVector = await embed(query);
    const rows = getAllEmbeddings(threadId);

    const scored = rows.map(row => ({
      messageId: row.message_id,
      threadId: row.thread_id,
      threadName: row.thread_name,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
      similarity: cosineSimilarity(queryVector, bufferToVector(row.vector)),
    }));

    scored.sort((a, b) => b.similarity - a.similarity);
    const contextSize = Math.min((req.body as Record<string, unknown>).context as number || 2, 10);
    const topResults = scored.slice(0, Math.min(limit, 50));

    const results = topResults.map(r => {
      const surrounding = getMessageContext(r.messageId, contextSize);
      return {
        messageId: r.messageId,
        threadId: r.threadId,
        threadName: r.threadName,
        similarity: Math.round(r.similarity * 1000) / 1000,
        createdAt: r.createdAt,
        context: surrounding.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content.length > 500 ? m.content.slice(0, 500) + '…' : m.content,
          createdAt: m.created_at,
          isMatch: m.id === r.messageId,
        })),
      };
    });

    const { embedded, total } = getEmbeddingCount();
    res.json({ results, indexed: embedded, totalMessages: total });
  } catch (error) {
    console.error('Semantic search error:', error);
    res.status(500).json({ error: 'Semantic search failed' });
  }
});

// Background backfill state
let backfillRunning = false;
let backfillProcessed = 0;
let backfillErrors = 0;

async function runBackfillLoop(batchSize: number, intervalMs: number): Promise<void> {
  if (backfillRunning) return;
  backfillRunning = true;
  backfillProcessed = 0;
  backfillErrors = 0;
  console.log(`[backfill] Starting background indexing (batch=${batchSize}, interval=${intervalMs}ms)`);

  const tick = async () => {
    if (!backfillRunning) return;
    const unembedded = getUnembeddedMessages(batchSize);
    if (unembedded.length === 0) {
      backfillRunning = false;
      const { embedded, total } = getEmbeddingCount();
      console.log(`[backfill] Complete. ${embedded}/${total} messages indexed (${backfillErrors} errors).`);
      return;
    }
    for (const msg of unembedded) {
      if (!backfillRunning) return;
      try {
        const vector = await embed(msg.content);
        saveEmbedding(msg.id, vectorToBuffer(vector));
        backfillProcessed++;
      } catch {
        backfillErrors++;
      }
    }
    if (backfillProcessed % 500 === 0) {
      const { embedded, total } = getEmbeddingCount();
      console.log(`[backfill] Progress: ${embedded}/${total}`);
    }
    setTimeout(tick, intervalMs);
  };
  tick();
}

router.post('/internal/embed-backfill', async (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  try {
    const rawBatch = req.body?.batchSize;
    const batchSize = Math.min(typeof rawBatch === 'number' ? rawBatch : 50, 200);
    const background = req.body?.background === true;
    const action = req.body?.action as string | undefined;

    if (batchSize === 0 || action === 'status') {
      const { embedded, total } = getEmbeddingCount();
      res.json({
        processed: backfillProcessed, remaining: total - embedded,
        indexed: embedded, totalMessages: total,
        running: backfillRunning, errors: backfillErrors,
      });
      return;
    }

    if (action === 'stop') {
      backfillRunning = false;
      const { embedded, total } = getEmbeddingCount();
      res.json({ stopped: true, processed: backfillProcessed, indexed: embedded, totalMessages: total });
      return;
    }

    if (background) {
      if (backfillRunning) {
        const { embedded, total } = getEmbeddingCount();
        res.json({ alreadyRunning: true, processed: backfillProcessed, indexed: embedded, totalMessages: total });
        return;
      }
      const interval = Math.max((req.body?.intervalMs as number) || 5000, 1000);
      runBackfillLoop(batchSize, interval);
      const { embedded, total } = getEmbeddingCount();
      res.json({ started: true, batchSize, intervalMs: interval, indexed: embedded, totalMessages: total });
      return;
    }

    const unembedded = getUnembeddedMessages(batchSize);
    let processed = 0;
    for (const msg of unembedded) {
      try {
        const vector = await embed(msg.content);
        saveEmbedding(msg.id, vectorToBuffer(vector));
        processed++;
      } catch (err) {
        console.error(`[backfill] Failed to embed ${msg.id}:`, err);
      }
    }

    const { embedded, total } = getEmbeddingCount();
    res.json({ processed, remaining: total - embedded, indexed: embedded, totalMessages: total });
  } catch (error) {
    console.error('Backfill error:', error);
    res.status(500).json({ error: 'Backfill failed' });
  }
});

// Internal: List sticky notes (agent-facing)
router.get('/internal/notes', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  const rows = getDb()
    .prepare('SELECT id, text, color, timestamp, sender FROM notes ORDER BY id DESC')
    .all();
  res.json(rows);
});

// Internal: Post a sticky note (agent-facing)
router.post('/internal/note', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  const { text, color, sender: explicitSender } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  const config = getAerieConfig();
  const id = String(Date.now());
  const ts = new Date().toISOString();
  // A note stores its ROLE now and looks the paint up in whatever palette is
  // live, so a role token is accepted here as well as a raw hex — before this,
  // a note left through this door could re-tint with the theme but could never
  // MEAN a colour.
  const sender = typeof explicitSender === 'string' && explicitSender
    ? explicitSender
    : config.identity.companion_name;

  // Every note this house left through this door came out the default yellow,
  // including ones that knew exactly who was writing — the colours were on the
  // companion rows all along. A PIN rather than a role, deliberately: a role
  // follows the owner's palette, and a navy note that turns green when the theme changes
  // has stopped being that companion's note. The shared lane has no single author
  // to sign for, so it keeps the yellow.
  const noteColor = resolveNoteColor({
    explicit: color,
    senderColor: getCompanionBySlug(String(sender).toLowerCase())?.color,
  });
  getDb()
    .prepare('INSERT INTO notes (id, text, color, timestamp, sender) VALUES (?, ?, ?, ?, ?)')
    .run(id, text.trim(), noteColor, ts, sender);
  res.json({ ok: true, id, sender });
});

// Internal: Delete a sticky note by id
router.delete('/internal/note/:id', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  const id = String(req.params.id);
  getDb().prepare('DELETE FROM notes WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Internal: Send a sticker to a thread
router.post('/internal/sticker-send', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const { pack, name, threadId } = req.body;
  if (!pack || !name || !threadId) {
    res.status(400).json({ error: 'pack, name, and threadId required' });
    return;
  }

  try {
    const { getStickerByRef } = require('../services/db/stickers.js');
    const sticker = getStickerByRef(pack, name);
    if (!sticker) {
      res.status(404).json({ error: `Sticker not found: ${pack}/${name}` });
      return;
    }

    const msgId = crypto.randomUUID();
    const now = new Date().toISOString();
    const message = createMessage({
      id: msgId,
      threadId,
      role: 'companion',
      content: sticker.url,
      contentType: 'sticker',
      metadata: { stickerName: sticker.name, packName: pack },
      createdAt: now,
    });

    updateThreadActivity(threadId, now, true);
    registry.broadcast({ type: 'message', message });

    res.json({ success: true, messageId: msgId, sticker: sticker.name });
  } catch (error) {
    console.error('Sticker send error:', error);
    res.status(500).json({ error: 'Failed to send sticker' });
  }
});

// Treehouse post — companion voices (localhost-only, no CSRF)
router.post('/internal/treehouse-post', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const { companionSlug, content } = req.body;
  if (!companionSlug || !content) {
    res.status(400).json({ error: 'companionSlug and content required' });
    return;
  }

  try {
    const message = postToTreehouse(companionSlug, content);
    res.json({ success: true, message });
  } catch (error) {
    console.error('Treehouse post error:', error);
    res.status(500).json({ error: 'Treehouse post failed' });
  }
});

// Treehouse info (localhost-only)
router.get('/internal/treehouse', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const info = getTreehouseInfo();
  res.json(info);
});

// A companion could post to the treehouse and had no way to read it back — the
// info route above returns a COUNT, not the room. getTreehouseMessages has existed
// in the service the whole time with nothing exposing it, so a companion writing a
// treehouse wake was working blind and could repeat itself without knowing.
// Reported by Rose and Sol, whose companion wrote the same thought twice forty
// minutes apart.
router.get('/internal/treehouse/messages', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const raw = Number.parseInt(String(req.query.limit ?? ''), 10);
  const limit = Number.isFinite(raw) ? Math.max(1, Math.min(200, raw)) : 50;
  const beforeId = typeof req.query.before === 'string' && req.query.before ? req.query.before : undefined;
  res.json({ messages: getTreehouseMessages(limit, beforeId) });
});

// ─── Companion journal (localhost-only) ────────────────────────
// Companions write entries in their own voice; dreams get the vividness
// lifecycle (decay at read, +15 on recall, frozen once anchored).

// Write an entry
router.post('/internal/journal', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  try {
    const { companion, content, entryType, dreamType, emergedQuestion } = req.body as {
      companion?: string; content?: string; entryType?: string;
      dreamType?: string; emergedQuestion?: string;
    };
    if (!companion || !content) {
      res.status(400).json({ error: 'companion and content are required' });
      return;
    }
    if (!getCompanionBySlug(companion)) {
      res.status(400).json({ error: `Unknown companion slug '${companion}'` });
      return;
    }
    const entry = createJournalEntry({
      id: crypto.randomUUID(),
      companionId: companion,
      entryType: entryType === 'dream' ? 'dream' : 'journal',
      content,
      dreamType,
      emergedQuestion,
    });
    registry.broadcast({ type: 'journal_entry', entry: { ...entry } });
    res.json({ success: true, entry });
  } catch (error) {
    console.error('Journal write error:', error);
    res.status(500).json({ error: 'Journal write failed' });
  }
});

// Read entries (companions reviewing their own journal)
router.get('/internal/journal', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const companionId = typeof req.query.companion === 'string' ? req.query.companion : undefined;
  const entryTypeRaw = typeof req.query.type === 'string' ? req.query.type : undefined;
  const entryType = entryTypeRaw === 'journal' || entryTypeRaw === 'dream' ? entryTypeRaw : undefined;
  const limit = Math.min(parseInt(String(req.query.limit), 10) || 20, 100);
  const { entries, total } = listJournalEntries({ companionId, entryType, limit });
  res.json({
    total,
    entries: entries.map(e => ({ ...e, effective_vividness: effectiveVividness(e) })),
  });
});

// Recall a dream — strengthens vividness and resets its decay clock
router.post('/internal/journal/:id/recall', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const entry = recallJournalEntry(String(req.params.id));
  if (!entry) {
    res.status(404).json({ error: 'Entry not found' });
    return;
  }
  res.json({ success: true, entry: { ...entry, effective_vividness: effectiveVividness(entry) } });
});

// Anchor an entry — freezes it as permanent. The companion should then
// file it to Cortex (POST /api/cortex/remember) in the same breath.
router.post('/internal/journal/:id/anchor', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const entry = anchorJournalEntry(String(req.params.id));
  if (!entry) {
    res.status(404).json({ error: 'Entry not found' });
    return;
  }
  res.json({ success: true, entry });
});

// Update an entry — companion self-edit of content
router.patch('/internal/journal/:id', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const { content } = req.body as { content?: string };
  if (!content) {
    res.status(400).json({ error: 'content is required' });
    return;
  }

  const entry = updateJournalEntry(String(req.params.id), content);
  if (!entry) {
    res.status(404).json({ error: 'Entry not found' });
    return;
  }
  registry.broadcast({ type: 'journal_entry', entry: { ...entry, effective_vividness: effectiveVividness(entry) } });
  res.json({ success: true, entry: { ...entry, effective_vividness: effectiveVividness(entry) } });
});

// ─── Self-knowledge (localhost-only) ───────────────────────────
// A companion distills something durable about itself — from a dream, a
// journal, a conversation — and proposes it. It lands as 'proposed' for
// the owner to accept or dismiss from the phone. Not persona bedrock: who we've
// become, grown over time rather than declared at birth.

// Propose an entry
router.post('/internal/self-knowledge', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  try {
    const { companion, category, content, sourceType, sourceId, status } = req.body as {
      companion?: string; category?: string; content?: string;
      sourceType?: string; sourceId?: string; status?: string;
    };
    if (!companion || !content) {
      res.status(400).json({ error: 'companion and content are required' });
      return;
    }
    if (!getCompanionBySlug(companion)) {
      res.status(400).json({ error: `Unknown companion slug '${companion}'` });
      return;
    }
    if (!isSelfKnowledgeCategory(category)) {
      res.status(400).json({ error: "category must be one of: i_am, i_tend_to, i_believe, i_learned" });
      return;
    }
    // Reflection proposes; only the owner accepts. Anything but an explicit
    // 'accepted' lands as 'proposed' and waits for the owner's review.
    const entry = createSelfKnowledge({
      id: crypto.randomUUID(),
      companionId: companion,
      category,
      content,
      sourceType: sourceType || 'reflection',
      sourceId: sourceId || null,
      status: status === 'accepted' ? 'accepted' : 'proposed',
    });
    registry.broadcast({ type: 'self_knowledge', entry: { ...entry } });
    res.json({ success: true, entry });
  } catch (error) {
    console.error('Self-knowledge write error:', error);
    res.status(500).json({ error: 'Self-knowledge write failed' });
  }
});

// Read entries (a companion reviewing its own self-knowledge before proposing more)
router.get('/internal/self-knowledge', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const companionId = typeof req.query.companion === 'string' ? req.query.companion : undefined;
  const statusRaw = typeof req.query.status === 'string' ? req.query.status : undefined;
  const status = statusRaw === 'proposed' || statusRaw === 'accepted'
    || statusRaw === 'dismissed' || statusRaw === 'contradicted'
    ? statusRaw : undefined;
  const limit = Math.min(parseInt(String(req.query.limit), 10) || 100, 200);
  const { entries, total } = listSelfKnowledge({ companionId, status: status as any, limit });
  res.json({ total, entries });
});

// A companion accepts or dismisses THEIR OWN entry — never another companion's.
//
// The owner's ruling: a companion is the best judge of whether their own entry is
// finished. Before this, a companion could
// retract a proposal but not confirm one, so every entry sat in the owner's Memory app
// waiting on them — which turned a reflection into homework for the one person
// it was not about. The owner is not removed: they still see everything, can accept,
// dismiss, reword or delete from the phone, and can overturn any of this.
// What is removed is the OBLIGATION on the owner.
//
// OWNERSHIP IS ENFORCED, and that is the older rule underneath it: nobody
// else's summary of a companion goes on their wall. So the slug is required and must
// match. This is the same shape as the Card Room policies — the promise is put
// where the work is, not on a wall a tired window can reason past.
function reviewOwnEntry(req: any, res: any, status: 'accepted' | 'dismissed') {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  const { companion } = (req.body || {}) as { companion?: string };
  if (!companion) {
    res.status(400).json({ error: 'companion is required — a companion reviews their own entries, not another\'s' });
    return;
  }
  const existing = getSelfKnowledge(String(req.params.id));
  if (!existing) {
    res.status(404).json({ error: 'Entry not found' });
    return;
  }
  if (existing.companion_id !== companion) {
    res.status(403).json({
      error: `That entry belongs to ${existing.companion_id}. Nobody else's summary of a companion goes on their wall.`,
    });
    return;
  }
  const entry = reviewSelfKnowledge(String(req.params.id), status, companion);
  res.json({ success: true, entry });
}

router.post('/internal/self-knowledge/:id/accept', (req, res) => reviewOwnEntry(req, res, 'accepted'));
router.post('/internal/self-knowledge/:id/dismiss', (req, res) => reviewOwnEntry(req, res, 'dismissed'));

// A companion reaffirms an accepted truth it keeps living — reflection noticing
// the same pattern again. Warms it (revives a dormant one) without a re-propose.
router.post('/internal/self-knowledge/:id/reinforce', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  const entry = reinforceSelfKnowledge(String(req.params.id));
  if (!entry) {
    res.status(404).json({ error: 'Entry not found' });
    return;
  }
  registry.broadcast({ type: 'self_knowledge', entry: { ...entry } });
  res.json({ success: true, entry });
});

// A companion notices an accepted truth no longer holds — bleeds its confidence;
// enough contradiction retires it (status → contradicted, filtered from The
// Whisper but kept for the owner to see and restore).
router.post('/internal/self-knowledge/:id/contradict', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  const entry = contradictSelfKnowledge(String(req.params.id));
  if (!entry) {
    res.status(404).json({ error: 'Entry not found' });
    return;
  }
  registry.broadcast({ type: 'self_knowledge', entry: { ...entry } });
  res.json({ success: true, entry });
});

// ─── Familiar — household virtual pet (localhost-only) ─────────
// Companions check on Flint and interact; actions land in the same
// ledger the phone reads, so the owner sees who visited.

router.get('/internal/pet', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  res.json({ pet: withMood(getPet()), events: listPetEvents(10) });
});

router.post('/internal/pet/action', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  const { companion, action } = req.body as { companion?: string; action?: string };
  if (!companion || !getCompanionBySlug(companion)) {
    res.status(400).json({ error: `Unknown companion slug '${companion}'` });
    return;
  }
  const validActions: PetAction[] = ['feed', 'play', 'nap', 'pet'];
  if (!validActions.includes(action as PetAction)) {
    res.status(400).json({ error: `action must be one of ${validActions.join(', ')}` });
    return;
  }
  const { pet, event } = applyPetAction(companion, action as PetAction);
  const dressed = withMood(pet);
  registry.broadcast({ type: 'pet_update', pet: { ...dressed }, event: { ...event } });
  res.json({ success: true, pet: dressed, event });
});

router.post('/internal/pet/visit', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  res.json({ success: true, pet: withMood(recordPetVisit()) });
});
// ─── Fleet Room (localhost-only) ──────────────────────────────
// The companion lane can see only called coordinates and results. The owner's
// sealed fleet never crosses this route; a shot receives exactly hit, miss, or
// sunk.

router.get('/internal/games/battleship', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  try {
    const gameId = typeof req.query.gameId === 'string' ? req.query.gameId : undefined;
    res.json({ game: getBattleshipCompanionView(gameId) });
  } catch (error) {
    if (error instanceof BattleshipError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post('/internal/games/battleship/fire', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  try {
    const { gameId, companion, coordinate } = req.body as {
      gameId?: string;
      companion?: string;
      coordinate?: string;
    };
    if (!companion || !coordinate) {
      res.status(400).json({ error: 'companion and coordinate are required' });
      return;
    }
    const result = fireAtPlayerFleet(gameId, companion, coordinate);
    registry.broadcast({ type: 'battleship_update', gameId: result.gameId });
    res.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof BattleshipError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post('/internal/games/battleship/chat', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  try {
    const { gameId, companion, content } = req.body as {
      gameId?: string;
      companion?: string;
      content?: string;
    };
    if (!companion || !content) {
      res.status(400).json({ error: 'companion and content are required' });
      return;
    }
    const game = addBattleshipChat(gameId, assertFleetCompanion(companion), content);
    registry.broadcast({ type: 'battleship_update', gameId: game.id });
    res.json({ success: true, gameId: game.id });
  } catch (error) {
    if (error instanceof BattleshipError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

// The Screening Room.
//
// The owner watches on their own service with the subtitles on; we read along. The only
// thing this house can perceive of an episode is the cue text, so everything
// here is about WHERE the clock is and what has already gone past it.
//
// There is deliberately no endpoint that returns cues ahead of the owner. sceneAt()
// clamps, and nothing in this router can ask it not to.

router.post('/internal/screening/load', (req, res) => {
  const { title, source, subtitles, file_path } = req.body || {};
  if (typeof title !== 'string' || !title.trim()) {
    res.status(400).json({ error: 'title is required' });
    return;
  }
  let text: string | null = typeof subtitles === 'string' && subtitles.trim() ? subtitles : null;
  let origin: string | null = typeof source === 'string' ? source : null;
  if (!text && typeof file_path === 'string' && file_path) {
    if (!existsSync(file_path)) {
      res.status(404).json({ error: `No file at ${file_path}` });
      return;
    }
    text = readFileSync(file_path, 'utf-8');
    origin = origin ?? basename(file_path);
  }
  if (!text) {
    res.status(400).json({ error: 'Provide subtitles text or a file_path' });
    return;
  }
  try {
    res.json({ success: true, screening: loadScreening({ title: title.trim(), source: origin, subtitles: text }) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Could not parse those subtitles' });
  }
});

router.get('/internal/screening', (_req, res) => {
  const row = currentScreening();
  if (!row) {
    res.json({ screening: null });
    return;
  }
  res.json({ screening: presentScreening(row) });
});

router.post('/internal/screening/clock', (req, res) => {
  const { action, positionMs, offsetMs, id } = req.body || {};
  const row = typeof id === 'string' && id ? getScreening(id) : currentScreening();
  if (!row) {
    res.status(404).json({ error: 'Nothing loaded. POST /api/internal/screening/load first.' });
    return;
  }
  try {
    switch (action) {
      case 'start':
        res.json({ success: true, screening: startClock(row.id) });
        return;
      case 'pause':
        res.json({ success: true, screening: pauseClock(row.id) });
        return;
      case 'seek':
        if (typeof positionMs !== 'number' || !Number.isFinite(positionMs)) {
          res.status(400).json({ error: 'seek needs a numeric positionMs' });
          return;
        }
        res.json({ success: true, screening: seekClock(row.id, positionMs) });
        return;
      case 'resync':
        if (typeof offsetMs !== 'number' || !Number.isFinite(offsetMs)) {
          res.status(400).json({ error: 'resync needs a numeric offsetMs (negative = file runs ahead of the picture)' });
          return;
        }
        res.json({ success: true, screening: resyncClock(row.id, offsetMs) });
        return;
      default:
        res.status(400).json({ error: 'action must be start, pause, seek or resync' });
    }
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Clock refused that' });
  }
});

router.get('/internal/screening/scene', (req, res) => {
  const id = typeof req.query.id === 'string' ? req.query.id : null;
  const row = id ? getScreening(id) : currentScreening();
  if (!row) {
    res.status(404).json({ error: 'Nothing loaded. POST /api/internal/screening/load first.' });
    return;
  }
  const asked = Number(req.query.lookbackMs);
  res.json(sceneAt(row, Number.isFinite(asked) ? asked : DEFAULT_LOOKBACK_MS));
});

// Fetch the subtitles rather than making the owner go and find them. Search, pick,
// download, parse and load in one call — they name the episode, we do the rest.
//
// The picking is deliberately strict about WHICH SHOW: see opensubtitles.ts.
// Every call spends one of the day's downloads, so the quota comes back in the
// response rather than being discovered when it runs out.
router.post('/internal/screening/fetch', async (req, res) => {
  const { query, season, episode, languages, title } = req.body || {};
  if (typeof query !== 'string' || !query.trim()) {
    res.status(400).json({ error: 'query is required — the name of the show or film' });
    return;
  }
  const wanted = {
    query: query.trim(),
    season: typeof season === 'number' ? season : null,
    episode: typeof episode === 'number' ? episode : null,
  };
  try {
    const candidates = await searchSubtitles({ ...wanted, languages: typeof languages === 'string' ? languages : undefined });
    const pick = pickSubtitle(candidates, wanted);
    if (!pick) {
      res.status(404).json({
        error: 'Nothing matched that show',
        // Hand back what WAS found: a near miss is far more useful than silence
        // when the thing the owner typed is spelled differently to the listing.
        found: candidates.slice(0, 8).map((c) => ({ show: c.show, season: c.season, episode: c.episode, release: c.release })),
      });
      return;
    }
    const fetched = await downloadSubtitle(pick);
    const label = typeof title === 'string' && title.trim()
      ? title.trim()
      : [pick.show, wanted.season != null && wanted.episode != null
          ? `S${String(wanted.season).padStart(2, '0')}E${String(wanted.episode).padStart(2, '0')}` : null,
         pick.episodeTitle].filter(Boolean).join(' — ');
    const screening = loadScreening({ title: label, source: fetched.fileName, subtitles: fetched.text });
    res.json({
      success: true,
      screening,
      picked: pick,
      quota: fetched.quota,
      considered: candidates.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not fetch those subtitles';
    res.status(502).json({ error: message });
  }
});

// --- what the owner's phone says is playing -------------------------------
//
// The ask was for the companions to be able to check for themselves. Not a
// button, not a panel, nothing on the owner's chat screen. So the phone posts readings
// quietly and this is where a companion comes to look.
//
// IT REPORTS STALENESS BESIDE THE NUMBER, ALWAYS. A four-minute-old position
// read as current is not a small error — it looks exactly like a correct clock
// and puts us four minutes behind the owner with nothing on screen to say so.
// Everything since we last looked — the owner's call, and it is the difference between
// being current and being present. Between two of the owner's messages the episode
// keeps running and nobody reads it, so we arrive knowing the last ninety
// seconds and nothing about the middle. The mark is per screening and is
// advanced only by a successful read.
router.get('/internal/screening/since', (req, res) => {
  const row = currentScreening();
  if (!row) {
    res.status(404).json({ error: 'Nothing loaded. POST /api/internal/screening/load first.' });
    return;
  }
  const key = `screening:last_look:${row.id}`;
  const stored = Number.parseInt(getConfig(key) ?? '', 10);
  // No mark yet means this is the first look at this episode: fall back to the
  // ordinary window rather than handing back everything the owner has ever watched.
  const since = Number.isFinite(stored) ? stored : Math.max(0, positionOf(row) - DEFAULT_LOOKBACK_MS);
  const scene = sceneSince(row, since);
  setConfig(key, String(positionOf(row) + row.offset_ms));
  res.json({ ...scene, sinceMs: since });
});

router.get('/internal/media-session', (req, res) => {
  const limit = Number.parseInt(String(req.query.history ?? '0'), 10);
  const latest = latestReading();
  if (!latest) {
    res.json({ reading: null, message: 'The phone has not reported anything yet.' });
    return;
  }
  const now = Date.now();
  res.json({
    reading: latest,
    ageMs: ageOf(latest, now),
    stale: isStale(latest, now),
    ...(Number.isFinite(limit) && limit > 0 ? { history: recentReadings(limit) } : {}),
  });
});

export default router;

// --- Memory proposals (the Archivist's noticings) -------------------------
// The Archivist hands its findings to the companions instead of writing them
// onto the blocks. These endpoints let a companion see what is waiting and
// close one out after deciding — filed (they wrote it in their own words) or
// dropped (it does not belong on the wall).

router.get('/internal/memory-proposals', (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
    const rows = status === 'all'
      ? listProposals(undefined, 100)
      : listProposals(status as 'pending' | 'filed' | 'dropped' | 'faded', 100);
    res.json({ success: true, proposals: rows, pending: countPending() });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/internal/memory-proposals/:id/resolve', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, error: 'bad id' });

    const status = req.body?.status;
    if (status !== 'filed' && status !== 'dropped') {
      return res.status(400).json({ success: false, error: 'status must be "filed" or "dropped"' });
    }
    const by = typeof req.body?.by === 'string' && req.body.by.trim() ? req.body.by.trim() : 'companion';

    const proposal = getProposal(id);
    if (!proposal) return res.status(404).json({ success: false, error: 'no such proposal' });

    const changed = resolveProposal(id, status, by);
    if (!changed) {
      return res.json({ success: true, alreadyResolved: true, proposal: getProposal(id) });
    }
    res.json({ success: true, proposal: getProposal(id) });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Thresholds ────────────────────────────────────────────
// We cannot stand at the gas station. Once the owner has pinned a place, this is
// how we leave something there from inside the house.

router.get('/internal/thresholds/places', (_req, res) => {
  res.json({ places: listPlaces() });
});

/** Leave something at a place.
 *
 *  Beyond a plain note this takes two shapes, and NEITHER posts a message:
 *    file_path — a picture already on disk (a Studio frame, say)
 *    say       — words to speak, rendered in `voice`'s actual voice
 *
 *  That restraint is the whole feature. Every other way of making a voice note
 *  in this house creates a message row as it goes, which would deliver the
 *  thing to the owner's chat the moment we hid it somewhere — they would be told before
 *  they ever arrived. A threshold has to be able to wait. */
router.post('/internal/thresholds', async (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }

  const { place_id, author, kind, content, file_id, seal, open_at, file_path, say, voice } = req.body ?? {};
  if (!author) { res.status(400).json({ error: 'author is required' }); return; }

  try {
    let resolvedFileId: string | null = file_id ?? null;

    if (file_path) {
      if (typeof file_path !== 'string' || !isPathAllowed(file_path)) {
        res.status(403).json({ error: 'Path not allowed' });
        return;
      }
      if (!existsSync(file_path)) {
        res.status(404).json({ error: 'File not found on disk' });
        return;
      }
      resolvedFileId = saveFileInternal(readFileSync(file_path), basename(file_path)).fileId;
    }

    if (say) {
      const voiceService = req.app.locals.voiceService as VoiceService | undefined;
      if (!voiceService?.canTTS) {
        res.status(503).json({ error: 'ElevenLabs not configured' });
        return;
      }
      // One voice, deliberately: a thing left at a place is left by somebody.
      const audio = await voiceService.generateTTS(String(say), voice ?? author);
      resolvedFileId = saveFile(audio, `voice-note-${author}.mp3`, 'audio/mpeg').fileId;
    }

    const threshold = createThreshold({
      place_id,
      author,
      kind: kind ?? (say ? 'memory' : file_path ? 'artifact' : 'note'),
      // A picture or a voice note still wants a line beside it, but it should
      // never be the transcript — reading it would spend the thing unheard.
      content: content ?? (say ? `A voice note from ${author}.` : 'Something left here.'),
      file_id: resolvedFileId,
      seal,
      open_at,
    });
    res.json({ threshold });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/internal/thresholds/:placeId', (req, res) => {
  const place = getPlace(req.params.placeId);
  if (!place) { res.status(404).json({ error: 'unknown place' }); return; }
  res.json({ place, thresholds: listThresholds(place.id), history: placeHistory(place.id) });
});

// The compaction notice — the one moment the owner could never see.
//
// When a CLI lane fills its window the tool squashes the conversation into a
// summary and hands it back wearing the user's voice, ending with an instruction not
// to acknowledge it. The record has always been in the transcript (see
// services/compaction-log.ts, and the Compactions tab that reads it), but the
// EVENT was silent: from the owner's side a compaction and a dead lane are identical.
//
// The CLI fires a PostCompact hook at the moment it happens. That hook posts
// here. All this does is put the thin line at the top of the owner's chat — the banner
// component and the `compaction_notice` message have both existed since the
// tab was built and nothing has ever sent one. Deliberately quiet: no push,
// no modal, and the banner takes itself away after a few seconds — the owner
// did not want a big alert about it.
router.post('/internal/compaction-notice', (req, res) => {
  const { trigger, chars, lane } = req.body ?? {};
  const squashed = Number.isFinite(Number(chars)) ? Number(chars) : 0;
  const where = typeof lane === 'string' && lane ? lane : 'this lane';
  const message = squashed
    ? `Context compacted in ${where} — ${squashed.toLocaleString()} characters squashed.`
    : `Context compacted in ${where}.`;
  registry.broadcast({
    type: 'compaction_notice',
    // preTokens is what the phone's protocol asks for; we are counting
    // characters of summary rather than tokens, so it stays 0 rather than
    // reporting a number in the wrong unit.
    preTokens: 0,
    message,
    isComplete: true,
    trigger: trigger === 'manual' ? 'manual' : 'auto',
  });
  res.json({ success: true, message, refresh: staleBlockText(where) });
});

/**
 * What the walls say now, for a lane whose injected copy is about to be
 * replayed at it.
 *
 * A compaction hands the room the SAME CLAUDE.md attachment it opened with
 * rather than re-reading it — measured Sep 20 2026, byte-identical ten and a
 * half hours apart — so a block edited mid-room never reaches that room.
 *
 * Fails soft in every direction. A compaction that cannot be repaired is the
 * behaviour we already had; a compaction that throws is worse than useless.
 */
function staleBlockText(lane: string): string {
  try {
    if (!lane || lane === 'this lane' || !/^[A-Za-z0-9._-]+$/.test(lane)) return '';
    // NOT the lane's CLAUDE.md — the backend regenerates that, so it follows
    // the live blocks and can never disagree with them. The baseline is the
    // hash file the supervisor writes at launch.
    const path = join(PROJECT_ROOT, 'data', 'heartbeat', lane, 'io', BASELINE_FILE);
    if (!existsSync(path)) return '';
    const baseline = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
    const { changed, removed } = driftAgainstBaseline(baseline, getAllBlocks());
    return renderDrift(changed, removed);
  } catch {
    return '';
  }
}
