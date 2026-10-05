// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { createMessage, getThread, updateThreadActivity } from '../db.js';
import { registry } from '../ws.js';
import { getAerieConfig } from '../../config.js';
import type { AgentMutableState } from './agent-state.js';
import crypto from 'crypto';

interface PulseQueryRuntime {
  ensureInit: () => void;
  getAgentCwd: () => string;
  getClaudeMdContent: () => string;
  getSdkBinaryPath: () => string | undefined;
  agentState: AgentMutableState;
}

export async function processPulseQuery(
  threadId: string,
  prompt: string,
  runtime: PulseQueryRuntime,
): Promise<string> {
  runtime.ensureInit();
  const thread = getThread(threadId);
  if (!thread) throw new Error(`Thread ${threadId} not found`);

  const cfg = getAerieConfig();
  const model = cfg.agent.model_pulse || 'claude-haiku-4-5-20251001';

  const streamMsgId = crypto.randomUUID();
  let fullResponse = '';

  const options: Options = {
    model,
    systemPrompt: runtime.getClaudeMdContent()
      ? { type: 'preset', preset: 'claude_code', append: runtime.getClaudeMdContent() }
      : { type: 'preset', preset: 'claude_code' },
    cwd: runtime.getAgentCwd(),
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    maxTurns: 5,
    mcpServers: {},
    ...(runtime.getSdkBinaryPath() && { pathToClaudeCodeExecutable: runtime.getSdkBinaryPath() }),
  };

  registry.broadcast({
    type: 'stream_start',
    messageId: streamMsgId,
    threadId,
  });

  try {
    runtime.agentState.presenceStatus = 'active';

    const pulseAbort = new AbortController();
    options.abortController = pulseAbort;

    const result = query({ prompt, options });

    for await (const msg of result) {
      if (!msg || typeof msg !== 'object' || !('type' in msg)) continue;
      const msgType = (msg as any).type;

      if (msgType === 'assistant') {
        const assistantMsg = msg as any;
        if (assistantMsg.message?.content) {
          for (const block of assistantMsg.message.content) {
            if (block.type === 'text' && block.text) {
              if (fullResponse) fullResponse += '\n\n' + block.text;
              else fullResponse = block.text;

              registry.broadcast({
                type: 'stream_token',
                messageId: streamMsgId,
                token: fullResponse,
              });
            }
          }
        }
      }
    }

    if (fullResponse.trim()) {
      const now = new Date().toISOString();
      const msg = createMessage({
        id: streamMsgId,
        threadId,
        role: 'companion',
        content: fullResponse,
        metadata: { source: 'pulse', model },
        createdAt: now,
      });
      updateThreadActivity(threadId, now, true);

      registry.broadcast({
        type: 'stream_end',
        messageId: streamMsgId,
        final: msg,
      });
      registry.broadcast({ type: 'message', message: msg });
    } else {
      const emptyMsg = createMessage({
        id: streamMsgId,
        threadId,
        role: 'companion',
        content: '[No response]',
        metadata: { source: 'pulse', model },
        createdAt: new Date().toISOString(),
      });
      registry.broadcast({
        type: 'stream_end',
        messageId: streamMsgId,
        final: emptyMsg,
      });
    }

    return fullResponse;
  } catch (error) {
    console.error('[Pulse] Error:', error);
    throw error;
  } finally {
    runtime.agentState.presenceStatus = 'dormant';
  }
}
