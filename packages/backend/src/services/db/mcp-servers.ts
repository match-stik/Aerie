// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// MCP server management
// Migrated from ../db.ts

import { getDb } from './state.js';

export interface McpServerRow {
  id: number;
  name: string;
  url: string;
  api_key: string | null;
  enabled: number;
  tools_cache: string | null;
  last_discovered: string | null;
  created_at: string;
}

export function listMcpServers(): McpServerRow[] {
  return getDb().prepare('SELECT * FROM mcp_servers ORDER BY created_at').all() as McpServerRow[];
}

export function getMcpServer(id: number): McpServerRow | null {
  return (getDb().prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as McpServerRow | undefined) ?? null;
}

export function addMcpServer(name: string, url: string, apiKey?: string): McpServerRow {
  const stmt = getDb().prepare('INSERT INTO mcp_servers (name, url, api_key) VALUES (?, ?, ?)');
  const result = stmt.run(name, url, apiKey ?? null);
  return getMcpServer(result.lastInsertRowid as number)!;
}

export function deleteMcpServer(id: number): boolean {
  const result = getDb().prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
  return result.changes > 0;
}

export function toggleMcpServer(id: number, enabled: boolean): boolean {
  const result = getDb().prepare('UPDATE mcp_servers SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  return result.changes > 0;
}

export function updateMcpServerToolsCache(id: number, toolsJson: string, discoveredAt: string): void {
  getDb().prepare('UPDATE mcp_servers SET tools_cache = ?, last_discovered = ? WHERE id = ?').run(toolsJson, discoveredAt, id);
}
