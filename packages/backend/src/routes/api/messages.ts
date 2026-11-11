// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { Router } from 'express';
import { getThread, getMessages, markMessagesRead, getMessage, editMessage, softDeleteMessage, softDeleteAfterSequence, updateThreadSession } from '../../services/db.js';
import { registry } from '../../services/ws.js';
import type { AgentService } from '../../services/agent.js';

const router = Router();

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
          withdrawn: `Their person has edited this message. It previously read: "${existing.content.slice(0, 400)}". Anything you had already said in reply is off their screen. Answer what they have written now; you still have the earlier version and are not being asked to forget it.`,
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
        withdrawn: 'Their person has asked for this answered again — your previous reply is no longer on their screen. You still have it, and you are not being asked to pretend otherwise; a reroll is very often a tap they did not mean. Say so if it helps.',
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

export default router;
