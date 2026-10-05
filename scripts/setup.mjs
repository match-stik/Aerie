#!/usr/bin/env node
// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.

// Aerie Setup Wizard — Interactive first-time configuration
// Usage: node scripts/setup.mjs

import { createInterface } from 'readline';
import { writeFileSync, existsSync, copyFileSync, mkdirSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

async function main() {
  console.log('\n  Aerie — Relational AI Companion Framework');
  console.log('  =============================================\n');

  // 1. Companion name
  const companionName = (await ask('  What should your companion be called? [Echo] ')) || 'Echo';

  // 2. User name
  const userName = (await ask('  What is your name? [User] ')) || 'User';

  // 3. Password
  const password = await ask('  Set a password? (blank for no auth, local use) ');

  // 4. Timezone
  let detectedTz = 'UTC';
  try { detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch {}
  const timezone = (await ask(`  Your timezone? [${detectedTz}] `)) || detectedTz;

  // 5. Check Claude Code is available
  console.log('\n  Aerie runs on your Claude Code subscription — no API key needed.');
  console.log('  Make sure you\'re logged into Claude Code: claude login');

  // Write aerie.yaml
  const yamlContent = `identity:
  companion_name: "${companionName}"
  user_name: "${userName}"
  timezone: "${timezone}"

server:
  port: 3002
  host: "127.0.0.1"
  db_path: "./data/aerie.db"

auth:
  password: "${password}"

agent:
  cwd: "."
  claude_md_path: "./CLAUDE.md"
  mcp_json_path: "./.mcp.json"
  model: "claude-sonnet-4-6"
  model_autonomous: "claude-sonnet-4-6"
  model_pulse: "claude-haiku-4-5"
  routing: "cli"
  routing_autonomous: "cli"

orchestrator:
  enabled: true
  wake_prompts_path: "./prompts/wake.md"
  schedules: {}
  failsafe:
    enabled: false

hooks:
  context_injection: true
  safe_write_prefixes: []

voice:
  enabled: false

discord:
  enabled: false

telegram:
  enabled: false

integrations:
  life_api_url: ""
  mind_cloud:
    enabled: false
    mcp_url: ""

cors:
  origins: []
`;

  writeFileSync('aerie.yaml', yamlContent);
  console.log('\n  Created: aerie.yaml');

  // Write .env if not exists
  if (!existsSync('.env')) {
    let envContent = '# Aerie Environment\n# No API key needed — uses your Claude Code login\n';
    writeFileSync('.env', envContent);
    console.log('  Created: .env');
  }

  // Copy example CLAUDE.md if not exists
  const examplesDir = join(resolve(), 'examples');
  if (!existsSync('CLAUDE.md') && existsSync(join(examplesDir, 'CLAUDE.md'))) {
    copyFileSync(join(examplesDir, 'CLAUDE.md'), 'CLAUDE.md');
    console.log('  Created: CLAUDE.md');
  }

  // Create prompts directory and copy wake prompts
  if (!existsSync('prompts')) mkdirSync('prompts');
  if (!existsSync('prompts/wake.md') && existsSync(join(examplesDir, 'wake-prompts.md'))) {
    copyFileSync(join(examplesDir, 'wake-prompts.md'), 'prompts/wake.md');
    console.log('  Created: prompts/wake.md');
  }

  // Create empty .mcp.json if not exists
  if (!existsSync('.mcp.json')) {
    writeFileSync('.mcp.json', JSON.stringify({ mcpServers: {} }, null, 2) + '\n');
    console.log('  Created: .mcp.json');
  }

  // Generate ecosystem.config.cjs
  const pm2Config = `module.exports = {
  apps: [{
    name: 'aerie',
    script: 'packages/backend/dist/server.js',
    cwd: '${resolve().replace(/\\/g, '/')}',
    node_args: '--experimental-vm-modules',
    env: {
      NODE_ENV: 'production',
      CLAUDECODE: '',
    },
    autorestart: true,
    watch: false,
    max_restarts: 10,
    restart_delay: 3000,
    log_file: './logs/aerie.log',
    out_file: './logs/aerie-out.log',
    error_file: './logs/aerie-error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    max_memory_restart: '1G',
  }]
};
`;

  writeFileSync('ecosystem.config.cjs', pm2Config);
  console.log('  Created: ecosystem.config.cjs');

  // Print startup instructions
  console.log(`
  Setup complete!

  Authentication:
    Aerie runs on your Claude Code subscription. No API key needed.
    Your companion runs queries through your Claude Code subscription.
    Make sure you're logged in: claude login

  Next steps:
  1. Customize CLAUDE.md — this is your companion's personality
  2. Build:   npm run build
  3. Start:   npm start       (or: pm2 start ecosystem.config.cjs)
  4. Open:    http://localhost:3002

  For development:
    npm run dev              (backend with hot reload)
    npm run dev:phone        (phone UI with Vite dev server)
    npm test                 (run the test suite)

  ${companionName} is ready to meet you.
`);

  rl.close();
}

main().catch(err => {
  console.error('Setup failed:', err);
  rl.close();
  process.exit(1);
});
