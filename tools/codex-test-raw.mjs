#!/usr/bin/env node
// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Raw WebSocket client for Codex daemon.
 * Manual framing because ws library doesn't work with unix socket.
 */

import { createConnection } from 'net';
import { createHash, randomBytes } from 'crypto';
import { readFileSync } from 'fs';

const SOCKET_PATH = process.env.HOME + '/.codex/app-server-control/app-server-control.sock';

let reqId = 1;
const pending = new Map();
let sock;
let buffer = Buffer.alloc(0);
let handshakeDone = false;

// WebSocket frame encoder with masking
function encodeFrame(data) {
  const payload = Buffer.from(data);
  const mask = randomBytes(4);

  let header;
  if (payload.length < 126) {
    header = Buffer.alloc(6);
    header[0] = 0x81; // text frame, fin
    header[1] = 0x80 | payload.length; // masked + length
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

  // Mask the payload
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) {
    masked[i] = payload[i] ^ mask[i % 4];
  }

  return Buffer.concat([header, masked]);
}

// WebSocket frame decoder
function decodeFrames() {
  const messages = [];

  while (buffer.length >= 2) {
    const fin = (buffer[0] & 0x80) !== 0;
    const opcode = buffer[0] & 0x0f;
    const masked = (buffer[1] & 0x80) !== 0;
    let payloadLen = buffer[1] & 0x7f;
    let offset = 2;

    if (payloadLen === 126) {
      if (buffer.length < 4) break;
      payloadLen = buffer.readUInt16BE(2);
      offset = 4;
    } else if (payloadLen === 127) {
      if (buffer.length < 10) break;
      payloadLen = Number(buffer.readBigUInt64BE(2));
      offset = 10;
    }

    if (masked) offset += 4;

    if (buffer.length < offset + payloadLen) break;

    let payload = buffer.subarray(offset, offset + payloadLen);

    if (masked) {
      const mask = buffer.subarray(offset - 4, offset);
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= mask[i % 4];
      }
    }

    buffer = buffer.subarray(offset + payloadLen);

    if (opcode === 0x01) { // text
      messages.push(payload.toString());
    } else if (opcode === 0x08) { // close
      sock.end();
    } else if (opcode === 0x09) { // ping
      sock.write(encodeFrame('')); // pong
    }
  }

  return messages;
}

function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = reqId++;
    pending.set(id, { resolve, reject });
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params, id });
    sock.write(encodeFrame(msg));

    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Timeout waiting for ${method}`));
      }
    }, 30000);
  });
}

function handleMessage(text) {
  try {
    const msg = JSON.parse(text);
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    } else if (msg.method) {
      // Notification - just log it
      if (msg.method !== 'thread/updated') {
        console.log('Notification:', msg.method);
      }
    }
  } catch (e) {
    console.error('Parse error:', e.message, text.substring(0, 100));
  }
}

async function main() {
  sock = createConnection(SOCKET_PATH);

  sock.on('connect', () => {
    console.log('Connected to Codex daemon socket');
    const key = randomBytes(16).toString('base64');
    sock.write(
      'GET / HTTP/1.1\r\n' +
      'Host: localhost\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Key: ${key}\r\n` +
      'Sec-WebSocket-Version: 13\r\n' +
      '\r\n'
    );
  });

  sock.on('data', (data) => {
    buffer = Buffer.concat([buffer, data]);

    if (!handshakeDone) {
      const idx = buffer.indexOf('\r\n\r\n');
      if (idx !== -1) {
        const headers = buffer.subarray(0, idx).toString();
        if (headers.includes('101 Switching Protocols')) {
          console.log('WebSocket handshake complete');
          handshakeDone = true;
          buffer = buffer.subarray(idx + 4);
          runTests();
        }
      }
    } else {
      for (const msg of decodeFrames()) {
        handleMessage(msg);
      }
    }
  });

  sock.on('error', (e) => console.error('Socket error:', e.message));
  sock.on('close', () => { console.log('Disconnected'); process.exit(0); });
}

async function runTests() {
  try {
    // Initialize with experimentalApi for chatgptAuthTokens
    const init = await send('initialize', {
      clientInfo: { name: 'aerie-codex', version: '1.0.0' },
      capabilities: { experimentalApi: true, requestAttestation: false }
    });
    console.log('Initialize:', init.result ? 'OK' : JSON.stringify(init.error));

    // Check account
    const account = await send('account/read', {});
    console.log('Account:', account.result?.email || 'not logged in');

    // If not logged in, try to login
    if (!account.result?.email) {
      console.log('Attempting login...');
      const authData = JSON.parse(readFileSync(
        process.env.HOME + '/aerie/data/codex-auth.json', 'utf8'
      ));

      const login = await send('account/login/start', {
        type: 'chatgptAuthTokens',
        accessToken: authData.accessToken,
        chatgptAccountId: authData.accountId,
        chatgptPlanType: 'plus'
      });
      console.log('Login:', login.result ? 'OK' : JSON.stringify(login.error));

      const account2 = await send('account/read', {});
      console.log('Account after login:', account2.result?.email || 'still not logged in');
    }

    // List models
    const models = await send('model/list', {});
    console.log('Models available:', models.result?.models?.length || 0);

    // Create a thread and test a turn
    console.log('\n--- Testing Turn ---');
    const thread = await send('thread/start', {
      title: 'Aerie test',
      baseInstructions: 'You are helpful. Keep responses under 20 words.'
    });
    const threadId = thread.result?.thread?.id;
    console.log('Thread created:', threadId);

    if (!threadId) {
      console.log('Thread creation failed:', JSON.stringify(thread));
      sock.end();
      return;
    }

    // Send a message
    const turn = await send('turn/start', {
      threadId,
      input: [{ type: 'text', text: 'Say exactly: Hello from Codex daemon!' }]
    });
    console.log('Turn started:', turn.result ? 'OK' : JSON.stringify(turn.error));

    // Wait for turn/completed notification, then read
    console.log('Waiting for turn/completed...');
    await new Promise(r => setTimeout(r, 5000));

    const read = await send('thread/read', { threadId, includeTurns: true });
    console.log('\n=== FULL THREAD READ ===');
    console.log(JSON.stringify(read.result, null, 2));

  } catch (e) {
    console.error('Error:', e.message);
  }

  sock.end();
}

main();
