// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import type { ClientMessage } from '@aerie/shared';
import { listThreads } from '../../db.js';
import { handleCommand } from '../../commands.js';
import type { AgentService } from '../../agent.js';
import type { Orchestrator } from '../../orchestrator.js';
import { registry } from '../connection-registry.js';
import type { ExtendedWebSocket } from '../connection-registry.js';
import { threadsToSummaries } from './thread-handlers.js';

export interface CommandHandlerDeps {
  agent: AgentService;
  orchestrator?: Orchestrator;
}

// --- Command handler ---

export async function handleCommandMessage(
  msg: Extract<ClientMessage, { type: 'command' }>,
  ws: ExtendedWebSocket,
  deps: CommandHandlerDeps,
): Promise<void> {
  const cmdResult = await handleCommand(
    msg.name,
    msg.args,
    msg.threadId,
    { agent: deps.agent, orchestrator: deps.orchestrator, registry },
  );
  ws.send(JSON.stringify(cmdResult));

  if (msg.name === 'new' || msg.name === 'rename') {
    const updatedThreads = listThreads({ includeArchived: false });
    registry.broadcast({ type: 'thread_list', threads: threadsToSummaries(updatedThreads) });
  }
}
