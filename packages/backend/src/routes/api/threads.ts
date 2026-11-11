// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { Router } from 'express';
import crypto from 'crypto';
import { writeThreadExport, type ExportedFile } from '../../services/thread-export.js';
import yazl from 'yazl';
import { join } from 'path';
import { listThreads, getThread, createThread, getMessages, archiveThread, unarchiveThread, deleteThread, getDb, pinThread, unpinThread, getMessageContext, messagePreviewText } from '../../services/db.js';
import { authMiddleware } from '../../middleware/auth.js';
import { deleteFile } from '../../services/files.js';
import { registry } from '../../services/ws.js';
import { getAerieConfig } from '../../config.js';

const router = Router();

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
        model: thread.model ?? null,
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

// The whole thread, from the house (services/thread-export.ts): every message,
// or only those between ?from= and ?to= (dates, YYYY-MM-DD, to inclusive).
// ?format=zip packs the conversation as text with every picture beside it in
// a pictures/ folder the text points at, streamed as it is built so a thread
// of gigabytes never sits in memory; pictures go in as stored, since they are
// already compressed, and the text is deflated. Sent as an attachment, the
// one signal the Android app's download listener answers.
router.get('/threads/:id/export', (req, res) => {
  try {
    const thread = getThread(req.params.id);
    if (!thread) { res.status(404).json({ error: 'Thread not found' }); return; }
    const isDay = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const from = isDay(req.query.from) ? `${req.query.from}T00:00:00.000Z` : undefined;
    const to = isDay(req.query.to)
      ? new Date(Date.parse(`${req.query.to}T00:00:00.000Z`) + 86_400_000).toISOString()
      : undefined;
    const zip = req.query.format === 'zip';
    const config = getAerieConfig();
    const day = new Date().toISOString().slice(0, 10);
    const slug = String(thread.name || 'thread').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'thread';
    const range = from || to ? `-${(req.query.from as string) || 'start'}-to-${(req.query.to as string) || day}` : '';
    const base = `aerie-${slug}${range}-${day}`;
    const origin = `${req.protocol}://${req.get('host')}`;
    const opts = {
      userName: config.identity.user_name || 'You',
      companionsName: config.identity.companion_name || 'Companions',
      origin, from, to,
    };
    const heading = `${thread.name || 'Thread'} - exported ${new Date().toLocaleString('en-US')}\n\n`;

    if (!zip) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.txt"`);
      res.write(heading);
      writeThreadExport(thread.id, opts, (chunk) => { res.write(chunk); });
      res.end();
      return;
    }

    const files: ExportedFile[] = [];
    const parts: string[] = [heading];
    writeThreadExport(thread.id, { ...opts, onFile: (f) => files.push(f) }, (chunk) => { parts.push(chunk); });
    const archive = new yazl.ZipFile();
    archive.addBuffer(Buffer.from(parts.join(''), 'utf8'), 'conversation.txt', { compress: true });
    for (const f of files) archive.addFile(f.path, f.name, { compress: false });
    archive.end();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.zip"`);
    archive.outputStream.pipe(res);
    archive.outputStream.on('error', (err: Error) => { console.error('Export zip failed:', err); res.end(); });
  } catch (error) {
    console.error('Error exporting thread:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to export thread' });
    else res.end();
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

// File download moved above authMiddleware for public access

// Rename a thread
router.patch('/threads/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    // A thread's own model (services/agent/thread-model.ts): a model id, or
    // null or '' to put it back on the house model. Absent leaves it alone.
    const hasModel = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'model');
    const rawModel = hasModel ? req.body.model : undefined;

    if (hasModel && rawModel !== null && typeof rawModel !== 'string') {
      res.status(400).json({ error: 'model must be a model id, or null for the house model' });
      return;
    }
    const model = typeof rawModel === 'string' ? rawModel.trim().slice(0, 200) : null;
    if (!hasModel && (!name || typeof name !== 'string')) {
      res.status(400).json({ error: 'Thread name required' });
      return;
    }
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      res.status(400).json({ error: 'Thread name required' });
      return;
    }

    const thread = getThread(id);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    const db = getDb();
    if (typeof name === 'string') db.prepare('UPDATE threads SET name = ? WHERE id = ?').run(name, id);
    if (hasModel) db.prepare('UPDATE threads SET model = ? WHERE id = ?').run(model || null, id);

    // Broadcast updated thread to all clients
    registry.broadcast({
      type: 'thread_updated',
      thread: {
        id: thread.id,
        name: typeof name === 'string' ? name : thread.name,
        type: thread.type,
        unread_count: thread.unread_count,
        last_activity_at: thread.last_activity_at,
        last_message_preview: null,
        pinned_at: thread.pinned_at ?? null,
        model: hasModel ? (model || null) : (thread.model ?? null),
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error renaming thread:', error);
    res.status(500).json({ error: 'Failed to rename thread' });
  }
});

export default router;
