#!/usr/bin/env node
// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Test client for Codex app-server daemon.
 * Connects via websocket over unix socket.
 */

import WebSocket from 'ws';
import { createConnection } from 'net';

const SOCKET_PATH = process.env.HOME + '/.codex/app-server-control/app-server-control.sock';

let reqId = 1;
const pending = new Map();

// Create websocket with custom socket
const ws = new WebSocket('ws://localhost/', {
  createConnection: () => createConnection(SOCKET_PATH)
});

ws.on('open', async () => {
  console.log('WebSocket connected to Codex daemon');

  try {
    // Send initialize
    const initResult = await send('initialize', {
      clientInfo: { name: 'aerie-test', version: '1.0.0' },
      capabilities: null
    });
    console.log('Initialize:', initResult?.result ? 'OK' : JSON.stringify(initResult));

    // Get account
    const accountResult = await send('account/read', {});
    console.log('Account:', accountResult?.result?.email ?? accountResult?.error ?? 'unknown');

    // List threads
    const threadsResult = await send('thread/list', { limit: 5, archived: false });
    console.log('Threads:', threadsResult?.result?.threads?.length ?? 0);
    if (threadsResult?.result?.threads?.length > 0) {
      console.log('  First thread:', threadsResult.result.threads[0].title || threadsResult.result.threads[0].id);
    }

    // List models
    const modelsResult = await send('model/list', {});
    console.log('Models:', modelsResult?.result?.models?.length ?? 0);

    // Test a turn with response extraction
    console.log('\n--- Testing Turn Response ---');
    const threadStart = await send('thread/start', {
      title: 'Test turn',
      baseInstructions: 'You are a helpful assistant. Keep responses brief.'
    });
    const threadId = threadStart?.result?.thread?.id;
    console.log('Thread:', threadId);

    if (threadId) {
      // Start a turn
      const turnStart = await send('turn/start', {
        threadId,
        input: [{ type: 'text', text: 'Say hello in exactly 5 words.' }]
      });
      console.log('Turn started, waiting for completion...');

      // Poll for completion
      let attempts = 0;
      while (attempts < 30) {
        await new Promise(r => setTimeout(r, 1000));
        const read = await send('thread/read', { threadId, includeTurns: true });
        const turns = read?.result?.thread?.turns || [];
        const lastTurn = turns[turns.length - 1];

        if (lastTurn?.state === 'completed' || lastTurn?.state === 'idle') {
          console.log('Turn completed!');
          console.log('Full turn structure:', JSON.stringify(lastTurn, null, 2));
          break;
        }
        attempts++;
        if (attempts % 5 === 0) console.log(`Still waiting... (${attempts}s)`);
      }
    }

  } catch (err) {
    console.error('Error:', err.message);
  }

  ws.close();
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());

    // Handle responses (have an id)
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    } else {
      // Notification
      console.log('Notification:', msg.method || 'unknown');
    }
  } catch (err) {
    console.error('Parse error:', err.message);
  }
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err.message);
});

ws.on('close', () => {
  console.log('Disconnected');
  process.exit(0);
});

function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = reqId++;
    pending.set(id, { resolve, reject });
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params, id });
    ws.send(msg);

    // Timeout after 10s
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Timeout waiting for ${method}`));
      }
    }, 10000);
  });
}
