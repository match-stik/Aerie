// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import type { ClientMessage, ServerMessage } from '@aerie/shared';
import type { AgentService } from '../../agent.js';
import { registry } from '../connection-registry.js';
import type { ExtendedWebSocket } from '../connection-registry.js';

export interface McpHandlerDeps {
  agent: AgentService;
}

function sendError(ws: ExtendedWebSocket, code: string, message: string): void {
  const msg: ServerMessage = { type: 'error', code, message };
  ws.send(JSON.stringify(msg));
}

// --- MCP handlers ---

export async function handleMcpReconnect(
  msg: Extract<ClientMessage, { type: 'mcp_reconnect' }>,
  ws: ExtendedWebSocket,
  deps: McpHandlerDeps,
): Promise<void> {
  const result = await deps.agent.reconnectMcpServer(msg.serverName);
  if (result.success) {
    registry.broadcast({ type: 'mcp_status_updated', servers: deps.agent.getMcpStatus() });
  } else {
    sendError(ws, 'mcp_error', result.error || 'Reconnect failed');
  }
}

export async function handleMcpToggle(
  msg: Extract<ClientMessage, { type: 'mcp_toggle' }>,
  ws: ExtendedWebSocket,
  deps: McpHandlerDeps,
): Promise<void> {
  const result = await deps.agent.toggleMcpServer(msg.serverName, msg.enabled);
  if (result.success) {
    registry.broadcast({ type: 'mcp_status_updated', servers: deps.agent.getMcpStatus() });
  } else {
    sendError(ws, 'mcp_error', result.error || 'Toggle failed');
  }
}
