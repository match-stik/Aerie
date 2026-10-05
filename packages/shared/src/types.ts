// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Database types — mirror the SQLite schema

export interface Thread {
  id: string;
  name: string;
  type: 'daily' | 'named' | 'treehouse';
  created_at: string;
  archived_at: string | null;
  current_session_id: string | null;
  session_type: 'v1' | 'v2';
  needs_reground: boolean;
  last_activity_at: string | null;
  unread_count: number;
  pinned_at: string | null;
}

export type Platform = 'web' | 'discord' | 'telegram' | 'api';

export interface Message {
  id: string;
  thread_id: string;
  sequence: number;
  role: 'companion' | 'user' | 'system';
  content: string;
  content_type: 'text' | 'image' | 'audio' | 'file' | 'sticker';
  platform: Platform;
  metadata: Record<string, unknown> | null;
  companion_id: string | null;
  reply_to_id: string | null;
  reply_to_preview: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  original_content: string | null;
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
}

export interface OutboundMessage {
  id: string;
  thread_id: string;
  message_id: string;
  status: 'pending' | 'delivered' | 'failed';
  push_sent: boolean;
  created_at: string;
}

export interface SessionRecord {
  id: string;
  thread_id: string;
  session_id: string;
  session_type: 'v1' | 'v2';
  started_at: string;
  ended_at: string | null;
  end_reason: 'compaction' | 'reaper' | 'daily_rotation' | 'error' | 'manual' | null;
  tokens_used: number | null;
  cost_usd: number | null;
  peak_memory_mb: number | null;
}

export interface AuditEntry {
  id: string;
  session_id: string;
  thread_id: string;
  tool_name: string;
  tool_input: string | null;
  tool_output: string | null;
  triggering_message_id: string | null;
  created_at: string;
}

export interface WebSession {
  id: string;
  token: string;
  created_at: string;
  expires_at: string;
}

export interface ConfigEntry {
  key: string;
  value: string;
}

export type PresenceStatus = 'active' | 'dormant' | 'waking' | 'offline';

export interface McpServerInfo {
  name: string;
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled';
  error?: string;
  toolCount: number;
  tools?: { name: string; description?: string }[];
  scope?: string;
}

export interface OrchestratorTaskStatus {
  wakeType: string;
  label: string;
  cronExpr: string;
  enabled: boolean;
  status: 'scheduled' | 'stopped' | 'running';
  nextRun: string | null;
  category: 'wake' | 'checkin' | 'handoff' | 'failsafe' | 'treehouse';
  /** Companion slug this bell belongs to, or null for a shared bell. */
  companion?: string | null;
  /** True for a bell the owner made themselves — those are the ones they can delete. */
  custom?: boolean;
}

export interface SystemStatus {
  uptime: number;
  memoryUsage: { rss: number; heapUsed: number; heapTotal: number };
  connections: number;
  userConnected: boolean;
  minutesSinceActivity: number;
  presence: PresenceStatus;
  agentProcessing: boolean;
  orchestratorTasks: OrchestratorTaskStatus[];
  mcpServers: McpServerInfo[];
  discord?: { connected: boolean; guilds: number; messagesProcessed: number; errors: number; deferredPending: number; username: string | null };
  telegram?: { connected: boolean; messagesProcessed: number; errors: number; restarts: number };
  queryQueue?: { processing: boolean; depth: number };
}

export interface Canvas {
  id: string;
  thread_id: string | null;
  title: string;
  content: string;
  content_type: 'markdown' | 'code' | 'text' | 'html';
  language: string | null;
  created_by: 'companion' | 'user';
  created_at: string;
  updated_at: string;
}

// The Press — editable zine/scrapbook documents. Scene JSON remains an
// explicit versioned envelope owned by the Phone editor; the backend stores it
// opaquely so editor migrations do not become database migrations.
// The page size is stored as width and height, not derived from this — the format
// is the preset the user picked, and 'custom' means they typed the numbers themselves. The
// backend has always accepted arbitrary dimensions; these are just the shortcuts.
export type PressFormat =
  | 'portrait'
  | 'square'
  | 'landscape'
  | 'story'
  | 'tall'
  | 'wide'
  | 'page'
  | 'custom';

export interface PressIssue {
  id: string;
  title: string;
  subtitle: string | null;
  format: PressFormat;
  page_width: number;
  page_height: number;
  cover_spread_id: string | null;
  created_at: string;
  updated_at: string;
  spread_count?: number;
  // List-only, like spread_count: the shelf query resolves the issue's cover spread
  // (or its first spread with a thumbnail) so a card can show the work rather than a
  // blank rectangle. Null until that spread has been saved at least once.
  cover_thumbnail_file_id?: string | null;
}

export interface PressSpread {
  id: string;
  issue_id: string;
  title: string;
  sort_order: number;
  scene_json: string;
  thumbnail_file_id: string | null;
  created_at: string;
  updated_at: string;
}

export type PressAssetKind = 'photo' | 'border' | 'tape' | 'sticker' | 'audio' | 'other';

export interface PressAsset {
  id: string;
  issue_id: string;
  spread_id: string | null;
  name: string | null;
  kind: PressAssetKind;
  source_file_id: string;
  rendered_file_id: string | null;
  mime_type: string;
  recipe_json: string;
  created_at: string;
  updated_at: string;
}

export type PressPackSourceFormat = 'images' | 'zip' | 'excalidrawlib';
export type PressPackItemKind = 'image' | 'excalidraw';

export interface PressPack {
  id: string;
  name: string;
  description: string | null;
  source_format: PressPackSourceFormat;
  author: string | null;
  license: string | null;
  source_file_id: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  item_count?: number;
}

export interface PressPackItem {
  id: string;
  pack_id: string;
  name: string;
  kind: PressPackItemKind;
  mime_type: string | null;
  source_file_id: string | null;
  data_json: string | null;
  width: number | null;
  height: number | null;
  sort_order: number;
  created_at: string;
}

export type MessageSegment =
  | { type: 'text'; content: string }
  | { type: 'tool'; toolId: string; toolName: string; input?: string; output?: string; isError?: boolean }
  | { type: 'thinking'; content: string; summary: string }
  | { type: 'sticker'; url: string; name: string }
  | { type: 'emoji'; url: string; name: string };

export interface ThreadSummary {
  id: string;
  name: string;
  type: 'daily' | 'named' | 'treehouse';
  unread_count: number;
  last_activity_at: string | null;
  last_message_preview: string | null;
  pinned_at: string | null;
}

export interface SearchResult {
  message: Message;
  threadId: string;
  threadName: string;
  highlight: string;
}

export interface TriggerStatus {
  id: string;
  kind: 'impulse' | 'watcher';
  label: string;
  conditions: string;
  prompt: string | null;
  cooldown_minutes: number;
  status: 'pending' | 'waiting' | 'fired' | 'cancelled';
  last_fired_at: string | null;
  fire_count: number;
  created_at: string;
  fired_at: string | null;
}

export interface StickerPack {
  id: string;
  name: string;
  description: string | null;
  entity_id: string | null;
  user_only: boolean;
  created_at: string;
  updated_at: string;
}

export interface Sticker {
  id: string;
  pack_id: string;
  name: string;
  filename: string;
  aliases: string[];
  sort_order: number;
  url: string;
  created_at: string;
}

export interface EmojiPack {
  id: string;
  name: string;
  description?: string;
  user_only: boolean;
  created_at: string;
}

export interface Emoji {
  id: string;
  name: string;
  filename: string;
  aliases: string[];
  url: string;
  pack_id: string | null;
  created_at: string;
}

// Usage tracking — per-turn token accounting (ported from Thornvale)
export interface UsageEvent {
  id: string;
  created_at: string;
  thread_id: string | null;
  thread_name: string | null;
  message_id: string | null;
  platform: string | null;
  mode: 'interactive' | 'autonomous';
  wake_type: string | null;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  tool_calls: string | null;  // JSON: Array<{ name: string; count: number }>
  cost_usd: number | null;
  duration_ms: number | null;
  context_window: number | null;
  context_tokens: number | null;
}

export interface UsageBucket {
  bucket: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number;
  request_count: number;
}

export interface UsageToolRow {
  name: string;
  count: number;
  request_count: number;
}

// ─── Aerie: Multi-Companion ──────────────────────────────

export interface CompanionInfo {
  id: string;
  slug: string;
  display_name: string;
  archetype: string | null;
  avatar_url: string | null;
  color: string | null;
  is_primary: boolean;
}

export interface ThreadCompanionInfo {
  companion_id: string;
  role: 'primary' | 'participant' | 'observer';
  can_initiate: boolean;
  companion: CompanionInfo;
}

export interface CompanionFull extends CompanionInfo {
  claude_md_path: string;
  mcp_json_path: string;
  model: string | null;
  model_autonomous: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
