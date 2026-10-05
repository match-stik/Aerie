#!/usr/bin/env node
// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Test the InteractiveCodexRuntime directly.
 */

import { InteractiveCodexRuntime } from '../packages/backend/dist/services/runtimes/codex-daemon.js';

async function main() {
  console.log('Creating InteractiveCodexRuntime...');

  const runtime = new InteractiveCodexRuntime({
    baseInstructions: 'You are a helpful assistant. Keep responses brief (under 20 words).',
  });

  console.log('Runtime capabilities:', runtime.capabilities);
  console.log('Running turn...\n');

  const input = {
    prompt: 'What is 2 + 2? Answer in one word.',
    model: 'gpt-5.2',
    systemPrompt: 'Keep responses extremely brief.',
    cwd: process.cwd(),
    thinking: 'disabled',
    maxTurns: 1,
    isAutonomous: false,
  };

  let responseText = '';

  for await (const event of runtime.runTurn(input)) {
    switch (event.type) {
      case 'text_delta':
        process.stdout.write(event.text);
        responseText += event.text;
        break;
      case 'session':
        console.log(`[Session: ${event.sessionId}]`);
        break;
      case 'error':
        console.error(`\n[Error: ${event.message}]`);
        break;
      case 'done':
        console.log(`\n[Done: ${event.finishReason}]`);
        break;
      default:
        // console.log(`[${event.type}]`);
    }
  }

  console.log('\n\nFull response:', responseText);
  console.log('Session ID:', runtime.getSessionId());
}

main().catch(console.error);
