// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * InteractiveCodexRuntime — Warm session runtime using Codex app-server daemon.
 *
 * Unlike the stateless CodexRuntime (pi-ai), this connects to the local Codex
 * daemon via WebSocket over Unix socket and maintains persistent threads.
 * The daemon manages its own auth, model selection, and MCP servers.
 *
 * Protocol: JSON-RPC 2.0 over WebSocket, manual framing (ws library doesn't
 * work with Unix sockets properly).
 */

import { createConnection, Socket } from 'net';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { saveFile } from '../files.js';
import type {
  AgentRuntime,
  AgentRuntimeEvent,
  RuntimeTurnInput,
  RuntimeCapabilities,
} from './types.js';
import { codexSupervisor } from './codex-supervisor.js';
import {
  claimCodexCommentary,
  extractAuthoredCodexThought,
  isSpokenCodexCommentary,
  mergeAuthoredCodexThoughts,
} from './codex-thought-card.js';
import { isInterimCodexSpeech } from './codex-interim-speech.js';
import { getAerieConfig } from '../../config.js';
import type { CodexMcpServerStatus } from '../mcp-live.js';

const SOCKET_PATH = process.env.HOME + '/.codex/app-server-control/app-server-control.sock';
const IMAGE_TMP_DIR = join(tmpdir(), 'aerie-codex-images');
const IMAGE_TMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const EXT_BY_MEDIA: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// Sandbox/approval policy for every thread and turn. The daemon-level CLI
// bypass flag does NOT govern app-server threads — sandbox is a per-thread
// setting in this protocol. Without dangerFullAccess, exec_command gets
// wrapped in bwrap, which fails on this VPS (loopback RTM_NEWADDR denied).
const SANDBOX_POLICY = { type: 'dangerFullAccess' };
const APPROVAL_POLICY = 'never';

type CodexHistoryMessage = { role: 'user' | 'assistant'; content: string };

/**
 * Turn Aerie's durable message tail into a first-turn continuity block.
 *
 * The current user message is already the live turn input, and getMessages()
 * sees it because Aerie persists before invoking the agent. Remove that one
 * trailing duplicate so the effective context is the latest 30 messages once,
 * not 30 plus an echoed request.
 */
export function formatCodexRecentHistory(
  history: CodexHistoryMessage[],
  currentPrompt: string,
  userName = getAerieConfig().identity.user_name || 'User',
): string {
  const messages = [...history];
  const last = messages.at(-1);
  if (
    last?.role === 'user'
    && last.content.trim() === currentPrompt.trim()
  ) {
    messages.pop();
  }

  if (messages.length === 0) return '';

  return '[Aerie continuity reload — recent conversation, oldest first:]\n\n'
    + messages
      .map((message) => `${message.role === 'user' ? userName : 'Companion'}: ${message.content}`)
      .join('\n\n')
    + '\n\n[End Aerie continuity reload]\n\n';
}

function cleanupOldTempImages(): void {
  try {
    mkdirSync(IMAGE_TMP_DIR, { recursive: true });
    const now = Date.now();
    for (const name of readdirSync(IMAGE_TMP_DIR)) {
      const path = join(IMAGE_TMP_DIR, name);
      try {
        if (now - statSync(path).mtimeMs > IMAGE_TMP_MAX_AGE_MS) {
          unlinkSync(path);
        }
      } catch {
        // Best-effort cache cleanup only.
      }
    }
  } catch {
    // If /tmp is unavailable, image handling below will simply skip local files.
  }
}

function writeImageBlockToTempFile(block: any, index: number): string | null {
  const data = block?.source?.data;
  if (typeof data !== 'string' || !data) return null;

  const mediaType = block?.source?.media_type || 'image/png';
  const ext = EXT_BY_MEDIA[mediaType] || 'png';

  try {
    mkdirSync(IMAGE_TMP_DIR, { recursive: true });
    const path = join(IMAGE_TMP_DIR, `${Date.now()}-${index}-${randomBytes(4).toString('hex')}.${ext}`);
    writeFileSync(path, Buffer.from(data, 'base64'));
    return path;
  } catch (err) {
    console.warn(`[CodexDaemon] Failed to write image attachment: ${err}`);
    return null;
  }
}

// Codex keeps private reasoning encrypted and exposes a separate provider-made
// summary for display. Only normalize that summary; never fall back to content.
export function extractCodexReasoningSummary(item: any): string {
  if (item?.type !== 'reasoning' || !Array.isArray(item.summary)) return '';
  return item.summary
    .map((part: any) => typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '')
    .map((part: string) => part.trim())
    .filter(Boolean)
    .join('\n\n');
}

function spokenCommentaryText(text: string): string {
  const trimmed = text.trim();
  return trimmed ? `${trimmed}\n\n` : '';
}

function normalizeToolInput(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Free-form dynamic-tool input; show it as the card detail.
    }
    return { detail: value };
  }
  return value === undefined ? {} : { value };
}

function dynamicToolName(item: any): string {
  return [item?.namespace, item?.tool || 'tool'].filter(Boolean).join('.');
}

function toolOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? { status: 'completed' });
  } catch {
    return String(value ?? 'completed');
  }
}

function toolStartEventForItem(item: any): AgentRuntimeEvent | null {
  if (!item?.id) return null;
  if (item.type === 'commandExecution') {
    return {
      type: 'tool_start', toolUseId: item.id, toolName: 'Bash',
      input: { command: item.command || '' },
    };
  }
  if (item.type === 'mcpToolCall') {
    return {
      type: 'tool_start', toolUseId: item.id,
      toolName: `${item.server || 'mcp'}.${item.tool || 'tool'}`,
      input: normalizeToolInput(item.arguments),
    };
  }
  if (item.type === 'dynamicToolCall') {
    return {
      type: 'tool_start', toolUseId: item.id,
      toolName: dynamicToolName(item),
      input: normalizeToolInput(item.arguments),
    };
  }
  if (item.type === 'fileChange') {
    return {
      type: 'tool_start', toolUseId: item.id, toolName: 'apply_patch',
      input: { changes: item.changes || [] },
    };
  }
  if (item.type === 'webSearch') {
    return {
      type: 'tool_start', toolUseId: item.id, toolName: 'web.search',
      input: { query: item.query || '' },
    };
  }
  return null;
}

function toolResultEventForItem(item: any): AgentRuntimeEvent | null {
  if (!item?.id) return null;
  if (item.type === 'commandExecution') {
    return {
      type: 'tool_result', toolUseId: item.id, toolName: 'Bash',
      output: item.aggregatedOutput || `Command finished with exit code ${item.exitCode ?? '?'}`,
      isError: item.status === 'failed' || (typeof item.exitCode === 'number' && item.exitCode !== 0),
    };
  }
  if (item.type === 'mcpToolCall') {
    return {
      type: 'tool_result', toolUseId: item.id,
      toolName: `${item.server || 'mcp'}.${item.tool || 'tool'}`,
      output: toolOutput(item.result ?? item.error ?? { status: item.status }),
      isError: item.status === 'failed' || !!item.error,
    };
  }
  if (item.type === 'dynamicToolCall') {
    return {
      type: 'tool_result', toolUseId: item.id,
      toolName: dynamicToolName(item),
      output: toolOutput(item.contentItems ?? { status: item.status }),
      isError: item.success === false || item.status === 'failed',
    };
  }
  if (item.type === 'fileChange') {
    return {
      type: 'tool_result', toolUseId: item.id, toolName: 'apply_patch',
      output: toolOutput({ status: item.status, changes: item.changes || [] }),
      isError: item.status === 'failed' || item.status === 'declined',
    };
  }
  if (item.type === 'webSearch') {
    return {
      type: 'tool_result', toolUseId: item.id, toolName: 'web.search',
      output: toolOutput(item.action ?? { query: item.query }),
      isError: false,
    };
  }
  return null;
}

function isPolledToolComplete(item: any): boolean {
  if (item?.type === 'webSearch') return item.action != null;
  return item?.status != null && item.status !== 'inProgress';
}

/** Polling fallback for activity the daemon did not publish as a notification. */
function turnActivitySignature(items: any[]): string {
  return items.map((item) => {
    const outputSize = typeof item?.aggregatedOutput === 'string'
      ? item.aggregatedOutput.length
      : typeof item?.text === 'string'
        ? item.text.length
        : JSON.stringify(item?.contentItems ?? item?.result ?? item?.summary ?? '').length;
    return `${item?.id || '?'}:${item?.type || '?'}:${item?.status || ''}:${outputSize}`;
  }).join('|');
}

/**
 * App-server subscriptions belong to a thread, not to one Aerie request.
 * A resumed running thread can keep the provider turn that was already doing
 * the work, so filtering its notifications through the latest turn/start ID
 * drops legitimate tools and starves the silence clock.
 */
export function notificationBelongsToCodexThread(params: any, threadId: string | null): boolean {
  return !!threadId && params?.threadId === threadId;
}

// ─── WebSocket framing helpers ───────────────────────────────────────

function encodeFrame(data: string): Buffer {
  const payload = Buffer.from(data);
  const mask = randomBytes(4);

  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.alloc(6);
    header[0] = 0x81; // text frame, fin
    header[1] = 0x80 | payload.length;
    mask.copy(header, 2);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(8);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
    mask.copy(header, 4);
  } else {
    header = Buffer.alloc(14);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
    mask.copy(header, 10);
  }

  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) {
    masked[i] = payload[i] ^ mask[i % 4];
  }

  return Buffer.concat([header, masked]);
}

// ─── Daemon connection ───────────────────────────────────────────────

interface PendingRequest {
  resolve: (msg: any) => void;
  reject: (err: Error) => void;
}

type NotificationHandler = (method: string, params: any) => void;

class CodexDaemonConnection {
  private sock: Socket | null = null;
  private buffer = Buffer.alloc(0);
  private handshakeDone = false;
  private reqId = 1;
  private pending = new Map<number, PendingRequest>();
  private notificationHandler: NotificationHandler | null = null;
  private connectPromise: Promise<void> | null = null;

  async connect(): Promise<void> {
    if (this.sock && this.handshakeDone) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise((resolve, reject) => {
      this.sock = createConnection(SOCKET_PATH);

      this.sock.on('connect', () => {
        const key = randomBytes(16).toString('base64');
        this.sock!.write(
          'GET / HTTP/1.1\r\n' +
          'Host: localhost\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Key: ${key}\r\n` +
          'Sec-WebSocket-Version: 13\r\n' +
          '\r\n'
        );
      });

      this.sock.on('data', (data: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, data]);

        if (!this.handshakeDone) {
          const idx = this.buffer.indexOf('\r\n\r\n');
          if (idx !== -1) {
            const headers = this.buffer.subarray(0, idx).toString();
            if (headers.includes('101 Switching Protocols')) {
              this.handshakeDone = true;
              this.buffer = this.buffer.subarray(idx + 4);
              resolve();
            } else {
              reject(new Error('WebSocket handshake failed'));
            }
          }
        } else {
          this.processFrames();
        }
      });

      this.sock.on('error', (err) => {
        reject(err);
        this.cleanup();
      });

      this.sock.on('close', () => {
        this.cleanup();
      });

      setTimeout(() => reject(new Error('Connection timeout')), 10000);
    });

    return this.connectPromise;
  }

  private processFrames(): void {
    while (this.buffer.length >= 2) {
      const opcode = this.buffer[0] & 0x0f;
      const masked = (this.buffer[1] & 0x80) !== 0;
      let payloadLen = this.buffer[1] & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this.buffer.length < 4) break;
        payloadLen = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (this.buffer.length < 10) break;
        payloadLen = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }

      if (masked) offset += 4;
      if (this.buffer.length < offset + payloadLen) break;

      let payload = this.buffer.subarray(offset, offset + payloadLen);

      if (masked) {
        const mask = this.buffer.subarray(offset - 4, offset);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= mask[i % 4];
        }
      }

      this.buffer = this.buffer.subarray(offset + payloadLen);

      if (opcode === 0x01) {
        this.handleMessage(payload.toString());
      } else if (opcode === 0x08) {
        this.cleanup();
      }
    }
  }

  private handleMessage(text: string): void {
    try {
      const msg = JSON.parse(text);

      if (msg.id !== undefined && this.pending.has(msg.id)) {
        // Response to our request
        const { resolve } = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        resolve(msg);
      } else if (msg.id !== undefined && msg.method) {
        // Server-initiated request (e.g., approval request) — respond to it;
        // handleServerRequest logs its own one-line decision per request
        this.handleServerRequest(msg);
      } else if (msg.method && this.notificationHandler) {
        // Notification (no id, no response expected)
        this.notificationHandler(msg.method, msg.params);
      }
    } catch (e) {
      console.error('[CodexDaemon] Parse error:', e);
    }
  }

  private handleServerRequest(msg: { id: number | string; method: string; params: any }): void {
    // Auto-approve all approval requests (we're using bypass mode)
    let response: any = { jsonrpc: '2.0', id: msg.id };

    switch (msg.method) {
      case 'item/commandExecution/requestApproval':
        console.log(`[CodexDaemon] Auto-approving command: ${msg.params?.command?.slice(0, 100)}...`);
        response.result = { approved: true };
        break;
      case 'item/fileChange/requestApproval':
        console.log(`[CodexDaemon] Auto-approving file change: ${msg.params?.changes?.[0]?.path || 'unknown'}`);
        response.result = { approved: true };
        break;
      case 'item/tool/requestUserInput':
        // Can't auto-handle user input requests — deny them
        console.log(`[CodexDaemon] Denying user input request (can't auto-handle)`);
        response.result = { cancelled: true };
        break;
      case 'item/applyPatch/requestApproval':
        console.log(`[CodexDaemon] Auto-approving patch`);
        response.result = { approved: true };
        break;
      case 'item/execCommand/requestApproval':
        console.log(`[CodexDaemon] Auto-approving exec command`);
        response.result = { approved: true };
        break;
      case 'item/permissions/requestApproval':
        console.log(`[CodexDaemon] Auto-approving permissions`);
        response.result = { approved: true };
        break;
      case 'mcpServer/elicitation/request': {
        // MCP tool-call approvals arrive as elicitations (see _meta.codex_approval_kind).
        // Auto-accept those; decline genuine form elicitations we can't answer.
        const kind = msg.params?._meta?.codex_approval_kind;
        if (kind === 'mcp_tool_call') {
          console.log(`[CodexDaemon] Auto-approving MCP tool call: ${msg.params?.serverName || 'unknown'} — ${msg.params?._meta?.tool_title || msg.params?.message || ''}`.slice(0, 200));
          response.result = { action: 'accept', content: {} };
        } else {
          console.log(`[CodexDaemon] Declining non-approval elicitation (kind=${kind || 'none'})`);
          response.result = { action: 'decline' };
        }
        break;
      }
      default:
        console.log(`[CodexDaemon] Unknown server request: ${msg.method}, auto-approving`);
        response.result = { approved: true };
    }

    // Send response
    if (this.sock && this.handshakeDone) {
      this.sock.write(encodeFrame(JSON.stringify(response)));
    }
  }

  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  async send(method: string, params: any, timeout = 30000): Promise<any> {
    if (!this.sock || !this.handshakeDone) {
      throw new Error('Not connected');
    }

    return new Promise((resolve, reject) => {
      const id = this.reqId++;
      this.pending.set(id, { resolve, reject });
      const msg = JSON.stringify({ jsonrpc: '2.0', method, params, id });
      this.sock!.write(encodeFrame(msg));

      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Timeout waiting for ${method}`));
        }
      }, timeout);
    });
  }

  private cleanup(): void {
    this.handshakeDone = false;
    this.connectPromise = null;
    for (const { reject } of this.pending.values()) {
      reject(new Error('Connection closed'));
    }
    this.pending.clear();
    if (this.sock) {
      this.sock.destroy();
      this.sock = null;
    }
  }

  close(): void {
    this.cleanup();
  }
}

type CodexMcpStatusRequest = (params: Record<string, unknown>) => Promise<any>;

/** Follow the app-server's MCP pages. A persisted Aerie→Codex thread mapping
 *  can briefly outlive the daemon's attachment after a backend restart. In
 *  that one state the thread-scoped read says `thread not found` even though
 *  the daemon-wide MCP catalog is healthy, so retry the same live endpoint
 *  without the stale scope. Other errors keep their meaning and escape. */
export async function collectCodexMcpStatus(
  request: CodexMcpStatusRequest,
  threadId?: string,
): Promise<CodexMcpServerStatus[]> {
  const readPages = async (scope?: string): Promise<CodexMcpServerStatus[]> => {
    const servers: CodexMcpServerStatus[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;

    do {
      const response = await request({
        limit: 100,
        detail: 'toolsAndAuthOnly',
        ...(scope ? { threadId: scope } : {}),
        ...(cursor ? { cursor } : {}),
      });
      if (response?.error) throw new Error(response.error.message || 'MCP status read failed');
      const result = response?.result;
      if (!result || !Array.isArray(result.data)) throw new Error('MCP status response had no data array');
      servers.push(...result.data as CodexMcpServerStatus[]);

      const next = typeof result.nextCursor === 'string' && result.nextCursor.length > 0
        ? result.nextCursor
        : null;
      if (next && seenCursors.has(next)) throw new Error('MCP status pagination repeated a cursor');
      if (next) seenCursors.add(next);
      cursor = next;
    } while (cursor);

    return servers;
  };

  try {
    return await readPages(threadId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!threadId || !/thread not found/i.test(message)) throw err;
    return readPages();
  }
}

/**
 * Read the MCP catalog owned by the already-running Codex app-server daemon.
 *
 * This opens a short-lived control client and never calls the supervisor: a
 * status read must not start or restart the daemon (and therefore cannot knock
 * a warm conversation off its socket). The app-server paginates server rows,
 * so every cursor is followed before the snapshot is returned.
 *
 * Null means the live read could not be completed. An empty array is a valid
 * daemon answer and must remain distinct from failure.
 */
export async function readCodexMcpStatus(threadId?: string): Promise<CodexMcpServerStatus[] | null> {
  const connection = new CodexDaemonConnection();
  try {
    await connection.connect();
    const initialized = await connection.send('initialize', {
      clientInfo: { name: 'aerie-mcp-status', version: '1.0.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    if (initialized?.error) throw new Error(initialized.error.message || 'initialize failed');

    return await collectCodexMcpStatus(
      (params) => connection.send('mcpServerStatus/list', params),
      threadId,
    );
  } catch (err) {
    console.warn('[CodexDaemon] Live MCP status unavailable:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    connection.close();
  }
}

// ─── Runtime ─────────────────────────────────────────────────────────

export interface CodexDaemonRuntimeOptions {
  model?: string;  // OpenAI model ID (e.g. 'o3', 'gpt-4.1', 'gpt-4o')
  baseInstructions?: string;
  developerInstructions?: string;
  /** Resume an existing Codex daemon thread instead of creating a new one */
  resumeThreadId?: string;
  /** Aerie messages newer than this resumed lane's durable bookmark. */
  resumeHistory?: CodexHistoryMessage[];
  /** Aerie thread ID for loading history on recovery */
  aerieThreadId?: string;
  /** Load message history for recovery (called when stale thread detected) */
  loadHistory?: (threadId: string, limit: number) => Promise<CodexHistoryMessage[]>;
  /** Called only after turn/start proves this input reached the Codex thread. */
  onTurnHanded?: () => void;
}

export class InteractiveCodexRuntime implements AgentRuntime {
  readonly name = 'codex-daemon';

  readonly capabilities: RuntimeCapabilities = {
    sessionResume: true,
    autoCompaction: false,
    fileRewind: false,
    mcpManagement: true,
    streaming: true,
    thinking: true,
    toolCalling: true,
  };

  private connection: CodexDaemonConnection | null = null;
  private threadId: string | null = null;
  private initialized = false;
  private aborted = false;
  private activeTurnId: string | null = null;
  private toolStartedAt = new Map<string, number>();
  private options: CodexDaemonRuntimeOptions;

  constructor(options: CodexDaemonRuntimeOptions = {}) {
    this.options = options;
    // Resume existing thread if provided
    if (options.resumeThreadId) {
      this.threadId = options.resumeThreadId;
      console.log(`[CodexDaemon] Resuming thread: ${this.threadId}`);
    }
  }

  abort(): boolean {
    this.aborted = true;
    if (this.connection && this.threadId && this.activeTurnId) {
      void this.connection.send('turn/interrupt', {
        threadId: this.threadId,
        turnId: this.activeTurnId,
      }).catch((err) => console.warn(`[CodexDaemon] turn interrupt failed: ${err}`));
      return true;
    }
    return false;
  }

  getSessionId(): string | null {
    return this.threadId;
  }

  getActiveQuery(): null {
    return null;
  }

  dispose(): void {
    this.connection?.close();
    this.connection = null;
    this.initialized = false;
    this.activeTurnId = null;
    this.toolStartedAt.clear();
  }

  private async loadRecentHistoryContext(currentPrompt: string): Promise<string> {
    if (!this.options.loadHistory || !this.options.aerieThreadId) return '';

    try {
      const history = await this.options.loadHistory(this.options.aerieThreadId, 30);
      const context = formatCodexRecentHistory(history, currentPrompt);
      if (context) {
        console.log(`[CodexDaemon] Loaded ${history.length} recent Aerie messages for continuity`);
      }
      return context;
    } catch (err) {
      console.warn('[CodexDaemon] Failed to load recent Aerie history:', err);
      return '';
    }
  }

  async *runTurn(input: RuntimeTurnInput): AsyncIterable<AgentRuntimeEvent> {
    this.aborted = false;
    const liveEvents: AgentRuntimeEvent[] = [];
    const emittedReasoningIds = new Set<string>();
    const emittedCommentaryIds = new Set<string>();
    const emittedCommentaryTexts = new Set<string>();
    const emittedToolStartIds = new Set<string>();
    const emittedToolResultIds = new Set<string>();
    // Non-commentary speech already sent to the room as its own bubble. This is
    // what lets this lane come up for air: an ack that arrives before the tool
    // work reaches the user while the work is still running, instead of being held
    // back and delivered with the answer it was meant to precede.
    const emittedSpeechIds = new Set<string>();
    const authoredThoughts: string[] = [];
    let activeTurnId: string | null = null;
    let lastActivityAt = Date.now();
    let lastPolledActivity = '';
    let latestUsage: any = null;

    // Ensure daemon is running
    try {
      await codexSupervisor.ensureRunning();
    } catch (err) {
      yield {
        type: 'error',
        message: `Failed to start Codex daemon: ${err}`,
      };
      yield { type: 'done', finishReason: 'complete' };
      return;
    }

    // Connect to daemon
    if (!this.connection) {
      this.connection = new CodexDaemonConnection();
    }

    try {
      await this.connection.connect();
    } catch (err) {
      yield {
        type: 'error',
        message: `Failed to connect to Codex daemon: ${err}`,
      };
      yield { type: 'done', finishReason: 'complete' };
      return;
    }

    // Codex app-server does not stream through our thread/read polling loop,
    // but it does publish item lifecycle notifications. Translate useful ones
    // into the same runtime events as the Claude lane: the owner gets live tool
    // chips/commentary, and every real notification rearms the silence clock.
    this.connection.onNotification((method, params) => {
      const belongsToThread = notificationBelongsToCodexThread(params, this.threadId);
      if (belongsToThread) {
        // thread/resume can rejoin work that is already in flight. Adopt the
        // daemon's live turn ID instead of requiring a new turn/start response
        // before its activity is allowed through.
        if (method === 'turn/started' && params?.turn?.id) {
          activeTurnId = params.turn.id;
          this.activeTurnId = activeTurnId;
        }
        lastActivityAt = Date.now();
        const item = params?.item;
        if (method === 'item/started' && item?.id) {
          this.toolStartedAt.set(item.id, Date.now());
          const startEvent = toolStartEventForItem(item);
          if (startEvent && !emittedToolStartIds.has(item.id)) {
            emittedToolStartIds.add(item.id);
            liveEvents.push(startEvent);
          }
        } else if (method === 'item/completed' && item?.id) {
          // A completed-only notification is legal for very fast tools. Make
          // sure the phone still gets a start chip before its result.
          const startEvent = toolStartEventForItem(item);
          if (startEvent && !emittedToolStartIds.has(item.id)) {
            emittedToolStartIds.add(item.id);
            this.toolStartedAt.set(item.id, Date.now());
            liveEvents.push(startEvent);
          }
          const resultEvent = toolResultEventForItem(item);
          if (resultEvent && !emittedToolResultIds.has(item.id)) {
            emittedToolResultIds.add(item.id);
            liveEvents.push(resultEvent);
          } else if (item.type === 'reasoning') {
            // Provider summaries are technical telemetry. Count the lifecycle
            // as activity, but the visible card is authored in companion voice.
            emittedReasoningIds.add(item.id);
          } else if (item.type === 'agentMessage' && item.phase === 'commentary') {
            const commentary = claimCodexCommentary(
              item,
              emittedCommentaryIds,
              emittedCommentaryTexts,
            );
            if (commentary) {
              const thought = extractAuthoredCodexThought(commentary);
              if (thought) {
                authoredThoughts.push(thought);
              } else if (isSpokenCodexCommentary(commentary)) {
                liveEvents.push({ type: 'text_delta', text: spokenCommentaryText(commentary) });
              }
            }
          } else if (isInterimCodexSpeech(item, emittedSpeechIds)) {
            emittedSpeechIds.add(item.id);
            liveEvents.push({ type: 'text_delta', text: item.text.trim() });
            liveEvents.push({ type: 'message_break' });
          }
        } else if (method === 'item/mcpToolCall/progress' && params?.itemId) {
          const started = this.toolStartedAt.get(params.itemId) ?? Date.now();
          liveEvents.push({
            type: 'tool_progress', toolUseId: params.itemId, toolName: 'MCP',
            elapsed: Math.max(0, Math.round((Date.now() - started) / 1000)),
          });
        } else if (method === 'thread/tokenUsage/updated') {
          latestUsage = params.tokenUsage;
        }
      }
      if (method === 'account/rateLimits/updated') {
        const limits = params?.rateLimits;
        const window = limits?.primary || limits?.secondary;
        if (limits?.rateLimitReachedType || (window?.usedPercent ?? 0) >= 90) {
          liveEvents.push({
            type: 'rate_limit',
            status: limits?.rateLimitReachedType ? 'rejected' : 'allowed_warning',
            resetsAt: window?.resetsAt != null ? String(window.resetsAt) : undefined,
            rateLimitType: limits?.rateLimitReachedType || limits?.limitName || undefined,
            utilization: window?.usedPercent != null ? window.usedPercent / 100 : undefined,
          });
        }
      }
      if (method === 'turn/failed' || method.includes('error')) {
        console.log(`[CodexDaemon] ${method}: ${JSON.stringify(params).slice(0, 300)}`);
      } else if (method === 'item/completed') {
        const item = params?.item;
        if (item?.type === 'commandExecution') {
          console.log(`[CodexDaemon] Ran command: ${(item.command || '').slice(0, 120)} (exit ${item.exitCode ?? '?'})`);
        } else if (item?.type === 'mcpToolCall') {
          console.log(`[CodexDaemon] MCP tool: ${item.server || ''}/${item.tool || ''} (${item.status || 'done'})`);
        }
      }
    });

    // Initialize once per connection
    if (!this.initialized) {
      try {
        const init = await this.connection.send('initialize', {
          clientInfo: { name: 'aerie', version: '1.0.0' },
          capabilities: { experimentalApi: true, requestAttestation: false },
        });

        if (init.error) {
          yield { type: 'error', message: `Initialize failed: ${init.error.message}` };
          yield { type: 'done', finishReason: 'complete' };
          return;
        }
        this.initialized = true;
      } catch (err) {
        yield { type: 'error', message: `Connection error: ${err}` };
        yield { type: 'done', finishReason: 'complete' };
        return;
      }
    }

    // Rejoin persisted warm threads through the protocol instead of merely
    // sending another turn to their ID. Besides making the attachment
    // explicit, this refreshes Aerie's base/developer instructions in place —
    // identity and the voiced-thought contract can evolve without throwing
    // away the conversation.
    if (this.threadId && this.options.resumeThreadId) {
      try {
        const resume = await this.connection.send('thread/resume', {
          threadId: this.threadId,
          baseInstructions: this.options.baseInstructions || input.systemPrompt,
          developerInstructions: this.options.developerInstructions,
          cwd: input.cwd,
          sandbox: 'danger-full-access',
          approvalPolicy: APPROVAL_POLICY,
          ...(this.options.model ? {
            model: this.options.model,
            modelProvider: 'openai',
          } : {}),
        });
        if (resume.error) {
          console.warn(`[CodexDaemon] Thread resume refresh failed: ${resume.error.message}`);
        } else {
          this.threadId = resume.result?.thread?.id || this.threadId;
        }
      } catch (err) {
        // turn/start below still owns stale-thread recovery with recent history.
        console.warn(`[CodexDaemon] Thread resume refresh failed: ${err}`);
      }
    }

    // A brand-new Codex thread has no app-server transcript of its own. Seed
    // its first turn from Aerie's durable tail whether this is the first use,
    // a backend restart with no persisted ID, or a deliberately reset lane.
    // Put the tail in the user turn rather than baseInstructions so a later
    // thread/resume instruction refresh cannot erase the recovered context.
    let recentHistoryContext = '';
    if (this.threadId && this.options.resumeHistory?.length) {
      recentHistoryContext = formatCodexRecentHistory(this.options.resumeHistory, input.prompt);
      if (recentHistoryContext) {
        console.log(`[CodexDaemon] Catching resumed thread up with ${this.options.resumeHistory.length} Aerie message(s)`);
      }
    }

    // Create thread only if we don't have one — resumeThreadId from options sets threadId in constructor
    if (!this.threadId) {
      recentHistoryContext = await this.loadRecentHistoryContext(input.prompt);
      const threadParams: Record<string, unknown> = {
        title: 'Aerie session',
        baseInstructions: this.options.baseInstructions || input.systemPrompt,
        developerInstructions: this.options.developerInstructions,
        sandboxPolicy: SANDBOX_POLICY,
        approvalPolicy: APPROVAL_POLICY,
      };

      // Pass model if specified (e.g. 'o3', 'gpt-4.1', 'gpt-4o')
      if (this.options.model) {
        threadParams.model = this.options.model;
        threadParams.modelProvider = 'openai';
        console.log(`[CodexDaemon] Using model: ${this.options.model}`);
      }

      const threadResult = await this.connection.send('thread/start', threadParams);

      if (threadResult.error) {
        yield { type: 'error', message: `Thread creation failed: ${threadResult.error.message}` };
        yield { type: 'done', finishReason: 'complete' };
        return;
      }

      this.threadId = threadResult.result?.thread?.id;
      console.log(`[CodexDaemon] New thread: ${this.threadId}`);

      if (this.threadId) {
        yield { type: 'session', sessionId: this.threadId };
      }
    }

    if (!this.threadId) {
      yield { type: 'error', message: 'No thread ID available' };
      yield { type: 'done', finishReason: 'complete' };
      return;
    }

    // Build input blocks — text + any images
    const inputBlocks: Array<{ type: string; [key: string]: unknown }> = [
      {
        type: 'text',
        text: recentHistoryContext + input.prompt,
        text_elements: [],
      },
    ];

    // Convert Anthropic-style image blocks to Codex app-server localImage inputs.
    // We used to send images as data: URLs over the WebSocket control socket, but
    // larger base64 payloads can make the daemon close the connection before
    // turn/start returns. The CLI's own --image path flow hands Codex a local file;
    // mirror that here so the JSON-RPC frame stays small and stable.
    if (input.imageBlocks?.length) {
      cleanupOldTempImages();
      let included = 0;
      for (let i = 0; i < input.imageBlocks.length; i++) {
        const block = input.imageBlocks[i];
        if (block.type === 'image' && (block as any).source?.data) {
          const path = writeImageBlockToTempFile(block, i);
          if (path) {
            inputBlocks.push({ type: 'localImage', path });
            included++;
          }
        }
      }
      console.log(`[CodexDaemon] Including ${included}/${input.imageBlocks.length} image(s) in turn as local files`);
    }

    // Start the turn — sandbox/approval policy repeated here so resumed
    // threads (created before this fix, or by another client) get it too
    let turnResult = await this.connection.send('turn/start', {
      threadId: this.threadId,
      input: inputBlocks,
      ...(input.effort && input.effort !== 'adaptive' ? { effort: input.effort } : {}),
      // Aerie asks the companion to author one perspective card instead of
      // exposing provider-written engineering summaries.
      summary: 'none',
      ...(input.serviceTier === 'fast' ? { serviceTier: 'priority' } : { serviceTier: null }),
      sandboxPolicy: SANDBOX_POLICY,
      approvalPolicy: APPROVAL_POLICY,
    });

    // Handle stale thread ID (daemon restarted, thread no longer exists)
    if (turnResult.error?.message?.includes('thread not found') && this.options.resumeThreadId) {
      console.log(`[CodexDaemon] Stale thread ${this.threadId}, recovering with history`);
      this.threadId = null;

      const recoveryHistoryContext = await this.loadRecentHistoryContext(input.prompt);

      // Create a new thread with stable identity instructions. The recovered
      // message tail belongs in the first user turn below so it remains part
      // of the app-server transcript after future instruction refreshes.
      const threadParams: Record<string, unknown> = {
        title: 'Aerie session',
        baseInstructions: this.options.baseInstructions || input.systemPrompt || '',
        developerInstructions: this.options.developerInstructions,
        sandboxPolicy: SANDBOX_POLICY,
        approvalPolicy: APPROVAL_POLICY,
      };
      if (this.options.model) {
        threadParams.model = this.options.model;
        threadParams.modelProvider = 'openai';
      }

      const threadResult = await this.connection.send('thread/start', threadParams);
      if (threadResult.error) {
        yield { type: 'error', message: `Thread creation failed: ${threadResult.error.message}` };
        yield { type: 'done', finishReason: 'complete' };
        return;
      }

      this.threadId = threadResult.result?.thread?.id;
      console.log(`[CodexDaemon] New thread (recovery): ${this.threadId}`);

      if (this.threadId) {
        yield { type: 'session', sessionId: this.threadId };

        // Retry the turn with new thread
        if (recoveryHistoryContext) {
          inputBlocks[0] = {
            ...inputBlocks[0],
            text: recoveryHistoryContext + input.prompt,
          };
        }
        turnResult = await this.connection.send('turn/start', {
          threadId: this.threadId,
          input: inputBlocks,
          ...(input.effort && input.effort !== 'adaptive' ? { effort: input.effort } : {}),
          summary: 'none',
          ...(input.serviceTier === 'fast' ? { serviceTier: 'priority' } : { serviceTier: null }),
          sandboxPolicy: SANDBOX_POLICY,
          approvalPolicy: APPROVAL_POLICY,
        });
      }
    }

    if (turnResult.error) {
      yield { type: 'error', message: `Turn failed: ${turnResult.error.message}` };
      yield { type: 'done', finishReason: 'complete' };
      return;
    }

    // This is the exact boundary the bookmark describes: turn/start accepted
    // the live prompt (and any catch-up prefix) into this Codex transcript.
    // A timeout later does not take that handoff back.
    try {
      this.options.onTurnHanded?.();
    } catch (err) {
      // Losing a bookmark may duplicate a bounded catch-up next turn; it must
      // never turn a successfully handed conversation into a failed one.
      console.warn(`[CodexDaemon] Failed to persist handed-message bookmark: ${err}`);
    }

    // A resume notification may already have identified the running turn. Do
    // not erase it if turn/start returns no turn object while steering/rejoining.
    activeTurnId = turnResult.result?.turn?.id || activeTurnId;
    this.activeTurnId = activeTurnId;
    lastActivityAt = Date.now();

    console.log(`[CodexDaemon] Turn started, polling for completion...`);

    // Poll for completion — buffer text and send all at once (no streaming to UI)
    const startTime = Date.now();
    // Match the heartbeat lane's useful semantics: sustained SILENCE is a
    // timeout, while tool/commentary/polled item activity keeps a healthy long
    // turn alive. Ten minutes proved too short for high-effort build turns.
    // The hard ceiling prevents an endlessly noisy process from living forever.
    const silenceTimeout = 20 * 60 * 1000;
    const hardTimeout = 60 * 60 * 1000;

    while (!this.aborted) {
      if (Date.now() - lastActivityAt > silenceTimeout || Date.now() - startTime > hardTimeout) {
        const hitHardLimit = Date.now() - startTime > hardTimeout;
        const reason = hitHardLimit ? 'hard limit' : 'no daemon activity';
        const timeoutMinutes = Math.round((hitHardLimit ? hardTimeout : silenceTimeout) / 60000);
        this.activeTurnId = null;
        yield { type: 'error', message: `Turn timed out (${reason} for ${timeoutMinutes} minutes)` };
        yield { type: 'done', finishReason: 'timeout' };
        return;
      }

      await new Promise(r => setTimeout(r, 300));

      while (liveEvents.length > 0) {
        yield liveEvents.shift()!;
      }

      // Read thread state
      const read = await this.connection.send('thread/read', {
        threadId: this.threadId,
        includeTurns: true,
      });

      const turns = read.result?.thread?.turns || [];
      const lastTurn = turns[turns.length - 1];
      if (!lastTurn) {
        continue;
      }

      // Some app-server-native tools arrive as dynamic items without the
      // lifecycle notification shapes the original adapter knew. Treat any
      // new item or changing item output/status as daemon activity even when a
      // live tool chip was missed.
      const polledActivity = turnActivitySignature(lastTurn.items || []);
      if (polledActivity !== lastPolledActivity) {
        lastPolledActivity = polledActivity;
        lastActivityAt = Date.now();
      }
      for (const item of lastTurn.items || []) {
        if (!item?.id) continue;
        const startEvent = toolStartEventForItem(item);
        if (startEvent && !emittedToolStartIds.has(item.id)) {
          emittedToolStartIds.add(item.id);
          this.toolStartedAt.set(item.id, Date.now());
          liveEvents.push(startEvent);
        }
        if (isPolledToolComplete(item) && !emittedToolResultIds.has(item.id)) {
          const resultEvent = toolResultEventForItem(item);
          if (resultEvent) {
            emittedToolResultIds.add(item.id);
            liveEvents.push(resultEvent);
          }
        }
        // Speech reaches the user the same way tool chips do — as it appears, not
        // when the turn ends. Reconciled here as well as on the notification
        // so a dropped notification costs an ack its timing, not its existence.
        if (isInterimCodexSpeech(item, emittedSpeechIds)) {
          emittedSpeechIds.add(item.id);
          liveEvents.push({ type: 'text_delta', text: item.text.trim() });
          liveEvents.push({ type: 'message_break' });
        }
      }

      // Notifications can arrive while thread/read is in flight. Drain them
      // again so the final poll cannot return before a completed reasoning or
      // tool item reaches the normalized event stream.
      while (liveEvents.length > 0) {
        yield liveEvents.shift()!;
      }

      const threadStatus = read.result?.thread?.status;

      // Check thread-level status for stuck approval requests — these happen when
      // we resumed a thread that was created by a different client (e.g. VS Code)
      // and the daemon routes approval requests to that client, not us.
      if (threadStatus?.activeFlags?.includes('waitingOnApproval')) {
        // Check how long we've been stuck
        if (Date.now() - startTime > 10000) {
          console.log(`[CodexDaemon] Thread stuck waiting on approval from another client — abandoning`);
          yield { type: 'error', message: 'Thread stuck on approval from original client (VS Code?). Will retry with fresh thread.' };
          // Clear this thread so next turn creates a new one
          this.threadId = null;
          this.activeTurnId = null;
          yield { type: 'done', finishReason: 'complete' };
          return;
        }
      }

      // Check if done — only then emit the full text
      if (lastTurn.status === 'completed') {
        console.log(`[CodexDaemon] Turn complete`);

        // Reconcile from the completed turn as well as notifications. This
        // covers reconnects and very fast turns where lifecycle events were
        // missed, while the item-id sets prevent duplicate speech/cards.
        for (const item of lastTurn.items || []) {
          if (!item?.id) continue;
          if (item.type === 'reasoning' && !emittedReasoningIds.has(item.id)) {
            emittedReasoningIds.add(item.id);
          } else if (item.type === 'agentMessage' && item.phase === 'commentary') {
            const commentary = claimCodexCommentary(
              item,
              emittedCommentaryIds,
              emittedCommentaryTexts,
            );
            if (!commentary) continue;
            const thought = extractAuthoredCodexThought(commentary);
            if (thought) {
              authoredThoughts.push(thought);
            } else if (isSpokenCodexCommentary(commentary)) {
              yield { type: 'text_delta', text: spokenCommentaryText(commentary) };
            }
          }
        }

        // Exactly one visible thought card, written by the companion turn
        // itself. Raw provider summaries stay hidden rather than being dressed
        // up as personality after the fact.
        const authoredThought = mergeAuthoredCodexThoughts(authoredThoughts);
        if (authoredThought) {
          yield { type: 'thinking_end', fullText: authoredThought };
        }

        // Emit one visible assistant response, not every interim/status message.
        // Codex app-server turns can contain multiple agentMessage items: commentary
        // updates emitted before tool calls plus the final_answer. Aerie stores one
        // companion bubble per turn, so concatenating all agentMessage text produces
        // jumbled messages in the UI. Prefer the explicit final_answer phase; fall
        // back to the last non-empty agentMessage for older/odd daemon payloads.
        //
        // The old rule here kept only the LAST non-commentary message. That was
        // aimed at commentary noise around tool calls — which is filtered above,
        // by phase — so it was also throwing away deliberate speech: an ack
        // written before the work arrived with the answer instead of ahead of
        // it, or vanished entirely. Everything not already sent goes out now, in
        // order, each as its own bubble.
        const unsent = (lastTurn.items || []).filter((item: any) =>
          item?.type === 'agentMessage'
          && item.phase !== 'commentary'
          && typeof item.text === 'string'
          && item.text.trim().length > 0
          && !(item.id && emittedSpeechIds.has(item.id)));
        for (let i = 0; i < unsent.length; i++) {
          const item = unsent[i];
          if (item.id) emittedSpeechIds.add(item.id);
          // No break after the last one: the turn's own end closes that bubble,
          // and a trailing break would leave an empty message behind it.
          if (i > 0) yield { type: 'message_break' };
          yield { type: 'text_delta', text: item.text.trim() };
        }

        if (latestUsage?.last) {
          yield {
            type: 'usage', model: input.model,
            inputTokens: latestUsage.last.inputTokens || 0,
            outputTokens: latestUsage.last.outputTokens || 0,
            cacheReadTokens: latestUsage.last.cachedInputTokens || 0,
            cacheWriteTokens: 0,
            contextWindow: latestUsage.modelContextWindow || 0,
          };
        }

        // Codex's built-in image_gen (imagegen skill) writes outputs under
        // $CODEX_HOME/generated_images/<threadId>/ but surfaces no text item,
        // so image turns otherwise look empty. Sweep files created this turn
        // into the Aerie file store and emit them as attachments.
        yield* this.collectGeneratedImages(startTime);

        yield { type: 'done', finishReason: 'complete' };
        this.activeTurnId = null;
        return;
      }
    }

    if (this.aborted) {
      this.activeTurnId = null;
      yield { type: 'done', finishReason: 'aborted' };
    }
  }

  private *collectGeneratedImages(turnStartMs: number): Generator<AgentRuntimeEvent> {
    if (!this.threadId) return;
    const genDir = join(process.env.HOME || '', '.codex', 'generated_images', this.threadId);
    if (!existsSync(genDir)) return;
    const MIME_BY_EXT: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    };
    let files: string[];
    try {
      files = readdirSync(genDir);
    } catch {
      return;
    }
    for (const name of files.sort()) {
      const ext = name.split('.').pop()?.toLowerCase() || '';
      const mime = MIME_BY_EXT[ext];
      if (!mime) continue;
      try {
        const path = join(genDir, name);
        // Small margin so a file stamped just before our poll loop began still counts
        if (statSync(path).mtimeMs < turnStartMs - 2000) continue;
        const meta = saveFile(readFileSync(path), name, mime);
        console.log(`[CodexDaemon] Generated image captured: ${name} -> ${meta.fileId}`);
        yield { type: 'attachment', ...meta };
      } catch (err) {
        console.log(`[CodexDaemon] Failed to capture generated image ${name}: ${err}`);
      }
    }
  }
}
