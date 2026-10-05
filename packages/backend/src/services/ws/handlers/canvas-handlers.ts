// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import crypto from 'crypto';
import type { ClientMessage, ServerMessage } from '@aerie/shared';
import {
  createCanvas,
  getCanvas,
  listCanvases,
  updateCanvasContent,
  updateCanvasTitle,
  deleteCanvas,
} from '../../db.js';
import { registry } from '../connection-registry.js';
import type { ExtendedWebSocket } from '../connection-registry.js';

function sendError(ws: ExtendedWebSocket, code: string, message: string): void {
  const msg: ServerMessage = { type: 'error', code, message };
  ws.send(JSON.stringify(msg));
}

// --- Canvas handlers ---

export function handleCanvasCreate(
  msg: Extract<ClientMessage, { type: 'canvas_create' }>,
  _ws: ExtendedWebSocket,
): void {
  const now = new Date().toISOString();
  const canvas = createCanvas({
    id: crypto.randomUUID(),
    threadId: msg.threadId || undefined,
    title: msg.title,
    contentType: msg.contentType || 'markdown',
    language: msg.language || undefined,
    createdBy: 'user',
    createdAt: now,
  });

  registry.broadcast({ type: 'canvas_created', canvas });
}

export function handleCanvasUpdate(
  msg: Extract<ClientMessage, { type: 'canvas_update' }>,
  ws: ExtendedWebSocket,
): void {
  const canvas = getCanvas(msg.canvasId);
  if (!canvas) {
    sendError(ws, 'canvas_not_found', 'Canvas not found');
    return;
  }

  const now = new Date().toISOString();
  updateCanvasContent(msg.canvasId, msg.content, now);

  registry.broadcastExcept(ws, {
    type: 'canvas_updated',
    canvasId: msg.canvasId,
    content: msg.content,
    updatedAt: now,
  });
}

export function handleCanvasUpdateTitle(
  msg: Extract<ClientMessage, { type: 'canvas_update_title' }>,
  ws: ExtendedWebSocket,
): void {
  const canvas = getCanvas(msg.canvasId);
  if (!canvas) {
    sendError(ws, 'canvas_not_found', 'Canvas not found');
    return;
  }

  const now = new Date().toISOString();
  updateCanvasTitle(msg.canvasId, msg.title, now);

  registry.broadcastExcept(ws, {
    type: 'canvas_updated',
    canvasId: msg.canvasId,
    content: canvas.content,
    updatedAt: now,
  });
}

export function handleCanvasDelete(
  msg: Extract<ClientMessage, { type: 'canvas_delete' }>,
  ws: ExtendedWebSocket,
): void {
  const deleted = deleteCanvas(msg.canvasId);
  if (!deleted) {
    sendError(ws, 'canvas_not_found', 'Canvas not found');
    return;
  }

  registry.broadcast({ type: 'canvas_deleted', canvasId: msg.canvasId });
}

export function handleCanvasList(ws: ExtendedWebSocket): void {
  const canvases = listCanvases();
  const msg: ServerMessage = { type: 'canvas_list', canvases };
  ws.send(JSON.stringify(msg));
}
