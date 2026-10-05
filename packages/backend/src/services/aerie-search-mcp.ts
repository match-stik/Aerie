// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// In-process MCP server exposing message-search tools to companion agents.
// Lets us search across any thread (or just one), do semantic search, and
// pull messages around a specific anchor — closing the gap where we couldn't
// reach for past conversation outside our current SDK session window.

import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { searchMessages, getMessages, getMessage } from './db.js';
import { embed } from './embeddings.js';
import { searchVectors, getCacheStats } from './vector-cache.js';

function ok(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}
function fail(message: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }], isError: true };
}

function trim(content: string, max = 320): string {
  if (content.length <= max) return content;
  return content.slice(0, max).trimEnd() + '…';
}

// ---------- Lexical search ----------

const messagesSearch = tool(
  'messages_search',
  "Keyword search across Aerie message history. Case-insensitive substring match on content. Use to find specific phrases or names.",
  {
    query: z.string().describe('Substring to search for (case-insensitive).'),
    threadId: z.string().optional().describe('Restrict to a single thread by ID. Omit to search every thread.'),
    limit: z.number().int().min(1).max(50).optional().describe('Max results (default 20).'),
  },
  async (args) => {
    try {
      const { messages, total } = searchMessages({
        query: args.query,
        threadId: args.threadId,
        limit: args.limit ?? 20,
        offset: 0,
      });
      return ok({
        total,
        returned: messages.length,
        results: messages.map(m => ({
          messageId: m.id,
          threadId: m.thread_id,
          threadName: m.thread_name,
          role: m.role,
          createdAt: m.created_at,
          excerpt: trim(m.content),
        })),
      });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  }
);

// ---------- Semantic search ----------

const messagesSearchSemantic = tool(
  'messages_search_semantic',
  "Semantic search across messages by meaning, not exact words. Best when you remember the gist but not the phrasing. Returns ranked matches with similarity scores.",
  {
    query: z.string().describe('What you are looking for, in natural language.'),
    threadId: z.string().optional().describe('Restrict to a single thread.'),
    limit: z.number().int().min(1).max(30).optional().describe('Max results (default 10).'),
  },
  async (args) => {
    try {
      const stats = getCacheStats();
      if (!stats.loaded || stats.count === 0) {
        return fail('Vector cache not loaded — semantic search unavailable');
      }

      const queryVec = await embed(args.query.trim());
      const limit = args.limit ?? 10;
      const results = searchVectors(queryVec, limit, { threadId: args.threadId });

      // Fetch message content for excerpts (vector cache doesn't store content)
      const enriched = results.map(r => {
        const msg = getMessage(r.messageId);
        return {
          messageId: r.messageId,
          threadId: r.threadId,
          threadName: r.threadName,
          role: r.role,
          excerpt: msg ? trim(msg.content) : '[content unavailable]',
          createdAt: r.createdAt,
          similarity: Number(r.similarity.toFixed(3)),
        };
      });

      return ok({
        total: stats.count,
        returned: enriched.length,
        results: enriched,
      });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  }
);

// ---------- Read messages around an anchor ----------

const messagesAround = tool(
  'messages_around',
  "Read messages around a specific anchor message in a thread (for context after finding a search hit). Returns the anchor + N messages before/after.",
  {
    threadId: z.string().describe('Thread containing the anchor.'),
    anchorMessageId: z.string().describe("Message to center on. Use 'latest' to anchor at the most recent message."),
    before: z.number().int().min(0).max(20).optional().describe('How many messages before the anchor (default 5).'),
    after: z.number().int().min(0).max(20).optional().describe('How many messages after the anchor (default 5).'),
  },
  async (args) => {
    try {
      // Pull a generous window of recent messages, then locate the anchor.
      // Most "around" needs are within the last ~100 messages of a thread.
      const recent = getMessages({ threadId: args.threadId, limit: 200 });
      // getMessages returns newest-first; reverse to chronological for slicing.
      const chrono = [...recent].reverse();
      let idx: number;
      if (args.anchorMessageId === 'latest') {
        idx = chrono.length - 1;
      } else {
        idx = chrono.findIndex(m => m.id === args.anchorMessageId);
        if (idx === -1) {
          return fail(`anchor message ${args.anchorMessageId} not found in this thread's recent 200 messages`);
        }
      }
      const before = args.before ?? 5;
      const after = args.after ?? 5;
      const start = Math.max(0, idx - before);
      const end = Math.min(chrono.length, idx + after + 1);
      const slice = chrono.slice(start, end);
      return ok({
        threadId: args.threadId,
        anchorIndex: idx - start,
        windowSize: slice.length,
        messages: slice.map(m => ({
          messageId: m.id,
          role: m.role,
          createdAt: m.created_at,
          content: trim(m.content, 600),
        })),
      });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  }
);

// ---------- Read recent messages from a thread ----------

const messagesThreadRecent = tool(
  'messages_thread_recent',
  "Read the most recent N messages from a specific thread. Use to catch up on a thread you didn't run, or to read content older than the current SDK session window.",
  {
    threadId: z.string().describe('Thread to read.'),
    limit: z.number().int().min(1).max(100).optional().describe('How many recent messages (default 20).'),
  },
  async (args) => {
    try {
      const rows = getMessages({ threadId: args.threadId, limit: args.limit ?? 20 });
      // Return chronological for easy reading.
      const chrono = [...rows].reverse();
      return ok({
        threadId: args.threadId,
        count: chrono.length,
        messages: chrono.map(m => ({
          messageId: m.id,
          role: m.role,
          createdAt: m.created_at,
          content: trim(m.content, 600),
        })),
      });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  }
);

let cached: McpSdkServerConfigWithInstance | null = null;

export function getAerieSearchMcpServer(): McpSdkServerConfigWithInstance {
  if (cached) return cached;
  cached = createSdkMcpServer({
    name: 'aerie-search',
    version: '1.0.0',
    tools: [
      messagesSearch,
      messagesSearchSemantic,
      messagesAround,
      messagesThreadRecent,
    ],
  });
  return cached;
}
