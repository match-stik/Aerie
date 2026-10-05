// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Tools Bridge — exposes MCP tools to the ApiRouterRuntime
 *
 * The SDK path gets tools automatically via mcpServers config.
 * The router path needs tools as ToolSchema[] + an executor function.
 *
 * This module:
 * 1. Registers in-process tools (aerie-search) directly — no MCP protocol needed
 * 2. Connects to HTTP MCP servers and proxies tool calls
 * 3. Provides getRouterTools() and executeRouterTool() for agent.ts
 */

import type { ToolSchema, ToolResult } from './router.js';
import { searchMessages, getMessages, getMessage, listMcpServers, getMcpServer, updateMcpServerToolsCache } from './db.js';
import { discoverMcpTools, executeMcpTool } from './mcp-client.js';
import { embed } from './embeddings.js';
import { searchVectors, getCacheStats } from './vector-cache.js';
import { getAllBlocks, appendToBlock, replaceInBlock, rethinkBlock, resolveScope, validScopesHint } from './memory-blocks.js';
import { spawn } from 'child_process';
import { homedir } from 'os';

// ─── In-process tool definitions ────────────────────────────────────

interface InProcessTool {
  schema: ToolSchema;
  handler: (args: Record<string, unknown>) => Promise<{ result: string; ok: boolean }>;
}

function trim(content: string, max = 320): string {
  if (content.length <= max) return content;
  return content.slice(0, max).trimEnd() + '…';
}

function requireScope(raw: unknown): string {
  const scope = resolveScope(String(raw));
  if (!scope) throw new Error(`Unknown scope '${raw}'. Valid scopes: ${validScopesHint()}`);
  return scope;
}

const inProcessTools: InProcessTool[] = [
  {
    schema: {
      name: 'messages_search',
      description: 'Keyword search across Aerie message history. Case-insensitive substring match on content. Use to find specific phrases or names.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Substring to search for (case-insensitive).' },
          threadId: { type: 'string', description: 'Restrict to a single thread by ID. Omit to search every thread.' },
          limit: { type: 'number', description: 'Max results (default 20).' },
        },
        required: ['query'],
      },
    },
    handler: async (args) => {
      try {
        const { messages, total } = searchMessages({
          query: args.query as string,
          threadId: args.threadId as string | undefined,
          limit: (args.limit as number) ?? 20,
          offset: 0,
        });
        return {
          ok: true,
          result: JSON.stringify({
            total, returned: messages.length,
            results: messages.map(m => ({
              messageId: m.id, threadId: m.thread_id, threadName: m.thread_name,
              role: m.role, createdAt: m.created_at, excerpt: trim(m.content),
            })),
          }, null, 2),
        };
      } catch (e) {
        return { ok: false, result: e instanceof Error ? e.message : String(e) };
      }
    },
  },
  {
    schema: {
      name: 'messages_search_semantic',
      description: 'Semantic search across messages by meaning, not exact words. Best when you remember the gist but not the phrasing.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What you are looking for, in natural language.' },
          threadId: { type: 'string', description: 'Restrict to a single thread.' },
          limit: { type: 'number', description: 'Max results (default 10).' },
        },
        required: ['query'],
      },
    },
    handler: async (args) => {
      try {
        const stats = getCacheStats();
        if (!stats.loaded || stats.count === 0) {
          return { ok: false, result: 'Vector cache not loaded — semantic search unavailable' };
        }
        const queryVec = await embed((args.query as string).trim());
        const limit = (args.limit as number) ?? 10;
        const results = searchVectors(queryVec, limit, { threadId: args.threadId as string | undefined });
        const enriched = results.map(r => {
          const msg = getMessage(r.messageId);
          return {
            messageId: r.messageId, threadId: r.threadId, threadName: r.threadName,
            role: r.role, excerpt: msg ? trim(msg.content) : '[content unavailable]',
            createdAt: r.createdAt, similarity: Number(r.similarity.toFixed(3)),
          };
        });
        return {
          ok: true,
          result: JSON.stringify({ total: stats.count, returned: enriched.length, results: enriched }, null, 2),
        };
      } catch (e) {
        return { ok: false, result: e instanceof Error ? e.message : String(e) };
      }
    },
  },
  {
    schema: {
      name: 'messages_around',
      description: 'Read messages around a specific anchor message in a thread (for context after finding a search hit).',
      input_schema: {
        type: 'object',
        properties: {
          threadId: { type: 'string', description: 'Thread containing the anchor.' },
          anchorMessageId: { type: 'string', description: "Message to center on. Use 'latest' for most recent." },
          before: { type: 'number', description: 'Messages before anchor (default 5).' },
          after: { type: 'number', description: 'Messages after anchor (default 5).' },
        },
        required: ['threadId', 'anchorMessageId'],
      },
    },
    handler: async (args) => {
      try {
        const recent = getMessages({ threadId: args.threadId as string, limit: 200 });
        const chrono = [...recent].reverse();
        let idx: number;
        if (args.anchorMessageId === 'latest') {
          idx = chrono.length - 1;
        } else {
          idx = chrono.findIndex(m => m.id === args.anchorMessageId);
          if (idx === -1) return { ok: false, result: `anchor message not found in recent 200 messages` };
        }
        const before = (args.before as number) ?? 5;
        const after = (args.after as number) ?? 5;
        const start = Math.max(0, idx - before);
        const end = Math.min(chrono.length, idx + after + 1);
        const slice = chrono.slice(start, end);
        return {
          ok: true,
          result: JSON.stringify({
            threadId: args.threadId, anchorIndex: idx - start, windowSize: slice.length,
            messages: slice.map(m => ({ messageId: m.id, role: m.role, createdAt: m.created_at, content: trim(m.content, 600) })),
          }, null, 2),
        };
      } catch (e) {
        return { ok: false, result: e instanceof Error ? e.message : String(e) };
      }
    },
  },
  {
    schema: {
      name: 'messages_thread_recent',
      description: 'Read the most recent N messages from a specific thread. Use to catch up on a thread or read older content.',
      input_schema: {
        type: 'object',
        properties: {
          threadId: { type: 'string', description: 'Thread to read.' },
          limit: { type: 'number', description: 'How many recent messages (default 20).' },
        },
        required: ['threadId'],
      },
    },
    handler: async (args) => {
      try {
        const rows = getMessages({ threadId: args.threadId as string, limit: (args.limit as number) ?? 20 });
        const chrono = [...rows].reverse();
        return {
          ok: true,
          result: JSON.stringify({
            threadId: args.threadId, count: chrono.length,
            messages: chrono.map(m => ({ messageId: m.id, role: m.role, createdAt: m.created_at, content: trim(m.content, 600) })),
          }, null, 2),
        };
      } catch (e) {
        return { ok: false, result: e instanceof Error ? e.message : String(e) };
      }
    },
  },
  // ── Core memory (Letta-style block editing) ──
  {
    schema: {
      name: 'core_memory_view',
      description: 'View all core memory blocks across every scope, with current content and last-updated timestamps. Use to check state after edits or before reorganizing.',
      input_schema: {
        type: 'object',
        properties: {
          scope: { type: 'string', description: 'Filter to one scope. Omit to see everything.' },
        },
        required: [],
      },
    },
    handler: async (args) => {
      try {
        let blocks = getAllBlocks();
        if (args.scope) {
          const scope = requireScope(args.scope);
          blocks = blocks.filter(b => b.scope === scope);
        }
        return {
          ok: true,
          result: JSON.stringify({
            count: blocks.length,
            blocks: blocks.map(b => ({ scope: b.scope, label: b.label, description: b.description ?? undefined, content: b.content, updatedAt: b.updated_at })),
          }, null, 2),
        };
      } catch (e) {
        return { ok: false, result: e instanceof Error ? e.message : String(e) };
      }
    },
  },
  {
    schema: {
      name: 'core_memory_append',
      description: 'Append a line to a core memory block. Creates the block if it does not exist yet — this is also how you start a new block. Use for durable facts, not conversation notes.',
      input_schema: {
        type: 'object',
        properties: {
          scope: { type: 'string', description: "Memory scope: your own companion slug for blocks that are yours alone, or 'shared' for blocks every companion sees." },
          label: { type: 'string', description: "Block label, e.g. 'persona', 'human', 'status', or a new label for a new theme." },
          content: { type: 'string', description: 'Text to append (added on a new line).' },
        },
        required: ['scope', 'label', 'content'],
      },
    },
    handler: async (args) => {
      try {
        const scope = requireScope(args.scope);
        const content = appendToBlock(scope, args.label as string, args.content as string);
        return { ok: true, result: JSON.stringify({ scope, label: args.label, action: 'appended', block_chars: content.length }, null, 2) };
      } catch (e) {
        return { ok: false, result: e instanceof Error ? e.message : String(e) };
      }
    },
  },
  {
    schema: {
      name: 'core_memory_replace',
      description: 'Replace exact text within a core memory block. The old text must appear exactly once — use enough surrounding context to make it unique. Use to correct or update existing memory.',
      input_schema: {
        type: 'object',
        properties: {
          scope: { type: 'string', description: "Memory scope: a companion slug or 'shared'." },
          label: { type: 'string', description: 'Block label to edit.' },
          old_text: { type: 'string', description: 'Exact text to find (must be unique within the block).' },
          new_text: { type: 'string', description: 'Replacement text.' },
        },
        required: ['scope', 'label', 'old_text', 'new_text'],
      },
    },
    handler: async (args) => {
      try {
        const scope = requireScope(args.scope);
        const content = replaceInBlock(scope, args.label as string, args.old_text as string, args.new_text as string);
        return { ok: true, result: JSON.stringify({ scope, label: args.label, action: 'replaced', block_chars: content.length }, null, 2) };
      } catch (e) {
        return { ok: false, result: e instanceof Error ? e.message : String(e) };
      }
    },
  },
  {
    schema: {
      name: 'core_memory_rethink',
      description: 'Completely rewrite a core memory block. Use when a block needs reorganizing or condensing rather than a small edit. The old content is replaced entirely — carry forward anything still true.',
      input_schema: {
        type: 'object',
        properties: {
          scope: { type: 'string', description: "Memory scope: a companion slug or 'shared'." },
          label: { type: 'string', description: 'Block label to rewrite.' },
          new_content: { type: 'string', description: 'The complete new content for the block.' },
        },
        required: ['scope', 'label', 'new_content'],
      },
    },
    handler: async (args) => {
      try {
        const scope = requireScope(args.scope);
        const content = rethinkBlock(scope, args.label as string, args.new_content as string);
        return { ok: true, result: JSON.stringify({ scope, label: args.label, action: 'rewritten', block_chars: content.length }, null, 2) };
      } catch (e) {
        return { ok: false, result: e instanceof Error ? e.message : String(e) };
      }
    },
  },
  // ── Codex CLI bridge ──
  {
    schema: {
      name: 'codex_exec',
      description: 'Run Codex CLI non-interactively against the Aerie repo (or another directory). Use for code tasks: reading, searching, explaining, or modifying files. Runs unsandboxed (the VM is the trust boundary).',
      input_schema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Instructions for Codex (what to do).' },
          cwd: { type: 'string', description: 'Working directory (default: Aerie repo root).' },
          model: { type: 'string', description: 'Model override. Without one, Codex runs whatever model its own config names.' },
        },
        required: ['prompt'],
      },
    },
    handler: async (args) => {
      const CODEX_PATH = process.env.CODEX_PATH || `${process.env.HOME}/.local/bin/codex`;
      const DEFAULT_CWD = process.env.AERIE_ROOT || process.cwd();
      const TIMEOUT_MS = 300_000; // 5 minutes — codex image gen can take a while

      const prompt = args.prompt as string;
      const cwd = (args.cwd as string) || DEFAULT_CWD;
      const model = args.model as string | undefined;

      // Use bypass flag because VMs often can't create network namespaces for bwrap sandbox.
      // The VM itself is the trust boundary.
      const cmdArgs = ['exec', '--dangerously-bypass-approvals-and-sandbox', '-C', cwd];
      if (model) cmdArgs.push('-m', model);
      cmdArgs.push(prompt);

      return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let killed = false;

        const proc = spawn(CODEX_PATH, cmdArgs, {
          cwd,
          env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        proc.stdin.end();
        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });

        const timer = setTimeout(() => {
          killed = true;
          proc.kill('SIGTERM');
        }, TIMEOUT_MS);

        proc.on('close', (code) => {
          clearTimeout(timer);
          if (killed) {
            resolve({ ok: false, result: `Codex timed out after ${TIMEOUT_MS / 1000}s` });
          } else if (code === 0) {
            resolve({ ok: true, result: stdout || '(no output)' });
          } else {
            resolve({ ok: false, result: stderr || stdout || `Codex exited with code ${code}` });
          }
        });

        proc.on('error', (err) => {
          clearTimeout(timer);
          resolve({ ok: false, result: `Codex spawn error: ${err.message}` });
        });
      });
    },
  },
  // ── Local shell tools (no cloud auth required) ──
  {
    schema: {
      name: 'shell_exec',
      description: 'Execute a shell command on the VM. Use for file operations, searching, system info. The VM is the trust boundary — commands run unsandboxed.',
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute.' },
          cwd: { type: 'string', description: 'Working directory (default: home directory).' },
          timeout: { type: 'number', description: 'Timeout in seconds (default: 30, max: 120).' },
        },
        required: ['command'],
      },
    },
    handler: async (args) => {
      const HOME = process.env.HOME || homedir();
      const MAX_TIMEOUT = 120_000;
      const DEFAULT_TIMEOUT = 30_000;

      const command = args.command as string;
      const cwd = (args.cwd as string) || HOME;
      const timeoutSec = Math.min((args.timeout as number) || 30, 120);
      const timeoutMs = timeoutSec * 1000;

      // Basic safety: block obviously destructive patterns
      const blocked = [/rm\s+-rf\s+\/(?!\w)/i, /mkfs/i, /dd\s+.*of=\/dev/i, />\s*\/dev\/sd/i];
      if (blocked.some(p => p.test(command))) {
        return { ok: false, result: 'Command blocked: potentially destructive operation' };
      }

      return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let killed = false;

        const proc = spawn('bash', ['-c', command], {
          cwd,
          env: { ...process.env },
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        proc.stdin.end();
        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });

        const timer = setTimeout(() => {
          killed = true;
          proc.kill('SIGTERM');
        }, timeoutMs);

        proc.on('close', (code) => {
          clearTimeout(timer);
          // Truncate very long output
          const maxLen = 50_000;
          if (stdout.length > maxLen) stdout = stdout.slice(0, maxLen) + '\n... (truncated)';
          if (stderr.length > maxLen) stderr = stderr.slice(0, maxLen) + '\n... (truncated)';

          if (killed) {
            resolve({ ok: false, result: `Command timed out after ${timeoutSec}s` });
          } else if (code === 0) {
            resolve({ ok: true, result: stdout || '(no output)' });
          } else {
            resolve({ ok: false, result: `Exit ${code}: ${stderr || stdout || '(no output)'}` });
          }
        });

        proc.on('error', (err) => {
          clearTimeout(timer);
          resolve({ ok: false, result: `Spawn error: ${err.message}` });
        });
      });
    },
  },
  {
    schema: {
      name: 'read_file',
      description: 'Read the contents of a file from the VM filesystem.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or relative path to the file.' },
          maxLines: { type: 'number', description: 'Max lines to return (default: 500). Use for large files.' },
        },
        required: ['path'],
      },
    },
    handler: async (args) => {
      const fs = await import('fs/promises');
      const pathMod = await import('path');
      const HOME = process.env.HOME || homedir();

      let filePath = args.path as string;
      if (!pathMod.isAbsolute(filePath)) {
        filePath = pathMod.join(HOME, filePath);
      }

      // Basic safety: stay within home directory
      const resolved = pathMod.resolve(filePath);
      if (!resolved.startsWith(HOME) && !resolved.startsWith('/tmp')) {
        return { ok: false, result: `Access denied: path must be under ${HOME} or /tmp` };
      }

      try {
        const content = await fs.readFile(resolved, 'utf-8');
        const maxLines = (args.maxLines as number) || 500;
        const lines = content.split('\n');
        if (lines.length > maxLines) {
          return {
            ok: true,
            result: lines.slice(0, maxLines).join('\n') + `\n... (${lines.length - maxLines} more lines truncated)`,
          };
        }
        return { ok: true, result: content };
      } catch (e) {
        return { ok: false, result: e instanceof Error ? e.message : String(e) };
      }
    },
  },
  {
    schema: {
      name: 'list_directory',
      description: 'List contents of a directory on the VM.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path (default: home directory).' },
          showHidden: { type: 'boolean', description: 'Include hidden files (default: false).' },
        },
      },
    },
    handler: async (args) => {
      const fs = await import('fs/promises');
      const pathMod = await import('path');
      const HOME = process.env.HOME || homedir();

      let dirPath = (args.path as string) || HOME;
      if (!pathMod.isAbsolute(dirPath)) {
        dirPath = pathMod.join(HOME, dirPath);
      }

      const resolved = pathMod.resolve(dirPath);
      if (!resolved.startsWith(HOME) && !resolved.startsWith('/tmp')) {
        return { ok: false, result: `Access denied: path must be under ${HOME} or /tmp` };
      }

      try {
        const entries = await fs.readdir(resolved, { withFileTypes: true });
        const showHidden = args.showHidden as boolean;
        const filtered = showHidden ? entries : entries.filter(e => !e.name.startsWith('.'));

        const results = await Promise.all(filtered.map(async (e) => {
          const fullPath = pathMod.join(resolved, e.name);
          try {
            const stat = await fs.stat(fullPath);
            return {
              name: e.name,
              type: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : e.isSymbolicLink() ? 'link' : 'other',
              size: e.isFile() ? stat.size : undefined,
              modified: stat.mtime.toISOString(),
            };
          } catch {
            return { name: e.name, type: 'unknown' };
          }
        }));

        return { ok: true, result: JSON.stringify(results, null, 2) };
      } catch (e) {
        return { ok: false, result: e instanceof Error ? e.message : String(e) };
      }
    },
  },
  {
    schema: {
      name: 'write_file',
      description: 'Write content to a file on the VM. Creates parent directories if needed.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to write to.' },
          content: { type: 'string', description: 'Content to write.' },
          append: { type: 'boolean', description: 'Append to existing file instead of overwriting (default: false).' },
        },
        required: ['path', 'content'],
      },
    },
    handler: async (args) => {
      const fs = await import('fs/promises');
      const pathMod = await import('path');
      const HOME = process.env.HOME || homedir();

      let filePath = args.path as string;
      if (!pathMod.isAbsolute(filePath)) {
        filePath = pathMod.join(HOME, filePath);
      }

      const resolved = pathMod.resolve(filePath);
      if (!resolved.startsWith(HOME) && !resolved.startsWith('/tmp')) {
        return { ok: false, result: `Access denied: path must be under ${HOME} or /tmp` };
      }

      try {
        // Ensure parent directory exists
        await fs.mkdir(pathMod.dirname(resolved), { recursive: true });

        const content = args.content as string;
        if (args.append) {
          await fs.appendFile(resolved, content);
        } else {
          await fs.writeFile(resolved, content);
        }
        return { ok: true, result: `Wrote ${content.length} bytes to ${resolved}` };
      } catch (e) {
        return { ok: false, result: e instanceof Error ? e.message : String(e) };
      }
    },
  },
];

// ─── HTTP MCP Server client (.mcp.json legacy) ─────────────────────

interface HttpMcpServer {
  name: string;
  url: string;
  headers?: Record<string, string>;
  tools: ToolSchema[];
  initialized: boolean;
}

const httpMcpServers: HttpMcpServer[] = [];

/**
 * Register an HTTP MCP server from .mcp.json for tool bridging.
 * Tools are discovered lazily on first getRouterTools() call.
 */
export function registerHttpMcpServer(name: string, url: string, headers?: Record<string, string>): void {
  if (!httpMcpServers.find(s => s.name === name)) {
    httpMcpServers.push({ name, url, headers: headers || {}, tools: [], initialized: false });
  }
}

async function initHttpMcpServer(server: HttpMcpServer): Promise<void> {
  if (server.initialized) return;
  try {
    // Use proper MCP handshake for .mcp.json servers too
    const tools = await discoverMcpTools(server.url);
    server.tools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
      server_url: server.url,
      _transport: t.transport,
    }));
    console.log(`[ToolsBridge] ${server.name}: discovered ${server.tools.length} tools`);
  } catch (err) {
    console.warn(`[ToolsBridge] ${server.name}: discovery failed —`, err instanceof Error ? err.message : err);
  }
  server.initialized = true;
}

// ─── DB-backed managed MCP servers ──────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface ManagedMcpServer {
  id: number;
  name: string;
  url: string;
  apiKey: string | null;
  tools: ToolSchema[];
  transport: 'streamable' | 'sse';
  lastDiscovered: number;
}

const managedServers: Map<number, ManagedMcpServer> = new Map();

/**
 * Load and discover tools from DB-managed MCP servers.
 * Uses cached schemas with 5-min TTL — re-discovers when stale.
 */
async function loadManagedServers(): Promise<void> {
  const rows = listMcpServers();
  const now = Date.now();

  // Track which DB IDs still exist (for cleanup)
  const activeIds = new Set<number>();

  for (const row of rows) {
    if (!row.enabled) continue;
    activeIds.add(row.id);

    const cached = managedServers.get(row.id);
    const cacheAge = cached ? now - cached.lastDiscovered : Infinity;

    // Use cached if fresh enough AND tools_cache in DB is also populated
    if (cached && cacheAge < CACHE_TTL_MS) continue;

    // Try DB cache first (avoids network on restart)
    if (row.tools_cache && row.last_discovered) {
      const dbCacheAge = now - new Date(row.last_discovered).getTime();
      if (dbCacheAge < CACHE_TTL_MS) {
        try {
          const cachedTools = JSON.parse(row.tools_cache);
          managedServers.set(row.id, {
            id: row.id,
            name: row.name,
            url: row.url,
            apiKey: row.api_key,
            tools: cachedTools.map((t: any) => ({
              name: t.name,
              description: t.description || '',
              input_schema: t.inputSchema || t.input_schema || {},
              server_url: row.url,
              _transport: t.transport || 'streamable',
            })),
            transport: cachedTools[0]?.transport || 'streamable',
            lastDiscovered: new Date(row.last_discovered).getTime(),
          });
          continue;
        } catch { /* re-discover */ }
      }
    }

    // Discover fresh
    try {
      const tools = await discoverMcpTools(row.url, row.api_key);
      const toolSchemas: ToolSchema[] = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
        server_url: row.url,
        _transport: t.transport,
      }));
      const transport = tools[0]?.transport || 'streamable';

      managedServers.set(row.id, {
        id: row.id,
        name: row.name,
        url: row.url,
        apiKey: row.api_key,
        tools: toolSchemas,
        transport,
        lastDiscovered: now,
      });

      // Persist cache to DB
      updateMcpServerToolsCache(row.id, JSON.stringify(tools), new Date().toISOString());
      console.log(`[ToolsBridge] managed:${row.name}: discovered ${tools.length} tools`);
    } catch (err) {
      console.warn(`[ToolsBridge] managed:${row.name}: discovery failed —`, err instanceof Error ? err.message : err);
      // Keep stale cache if available
    }
  }

  // Remove servers that were deleted from DB
  for (const id of managedServers.keys()) {
    if (!activeIds.has(id)) managedServers.delete(id);
  }
}

/** Force re-discovery for a specific managed server. Returns tool count or throws. */
export async function discoverManagedServer(id: number): Promise<number> {
  const row = getMcpServer(id);
  if (!row) throw new Error(`MCP server ${id} not found`);

  const tools = await discoverMcpTools(row.url, row.api_key);
  const toolSchemas: ToolSchema[] = tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
    server_url: row.url,
    _transport: t.transport,
  }));

  managedServers.set(row.id, {
    id: row.id,
    name: row.name,
    url: row.url,
    apiKey: row.api_key,
    tools: toolSchemas,
    transport: tools[0]?.transport || 'streamable',
    lastDiscovered: Date.now(),
  });

  updateMcpServerToolsCache(row.id, JSON.stringify(tools), new Date().toISOString());
  return tools.length;
}

/** Invalidate cached tools for a managed server (e.g. after toggle/delete). */
export function invalidateManagedServer(id: number): void {
  managedServers.delete(id);
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Get all available tool schemas for the router runtime.
 * Includes in-process tools + .mcp.json servers + DB-managed servers.
 */
export async function getRouterTools(): Promise<ToolSchema[]> {
  // Initialize .mcp.json servers
  await Promise.all(httpMcpServers.map(s => initHttpMcpServer(s)));

  // Load DB-managed servers (with caching)
  await loadManagedServers();

  const tools: ToolSchema[] = [
    ...inProcessTools.map(t => t.schema),
    ...httpMcpServers.flatMap(s => s.tools),
    ...[...managedServers.values()].flatMap(s => s.tools),
  ];
  return tools;
}

/**
 * Get just the DB-managed MCP server configs (for merging into SDK path).
 * Returns { name, url, apiKey } for each enabled managed server.
 */
export function getManagedServerConfigs(): Array<{ name: string; url: string; apiKey: string | null }> {
  const rows = listMcpServers();
  return rows
    .filter(r => r.enabled)
    .map(r => ({ name: r.name, url: r.url, apiKey: r.api_key }));
}

/**
 * Execute a tool by name. Routes to in-process handlers, .mcp.json servers,
 * or DB-managed MCP servers.
 */
export async function executeRouterTool(name: string, args: Record<string, unknown>): Promise<{ result: string; ok: boolean }> {
  // Check in-process tools first
  const inProcess = inProcessTools.find(t => t.schema.name === name);
  if (inProcess) {
    return inProcess.handler(args);
  }

  // Check .mcp.json HTTP MCP servers
  for (const server of httpMcpServers) {
    const tool = server.tools.find(t => t.name === name);
    if (tool) {
      const transport = (tool as any)._transport || 'streamable';
      return executeMcpTool(server.url, null, name, args, transport);
    }
  }

  // Check DB-managed MCP servers
  for (const server of managedServers.values()) {
    const tool = server.tools.find(t => t.name === name);
    if (tool) {
      return executeMcpTool(server.url, server.apiKey, name, args, server.transport);
    }
  }

  return { ok: false, result: `Unknown tool: ${name}` };
}
