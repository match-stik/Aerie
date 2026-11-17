#!/usr/bin/env node
// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.

// Aerie Setup Wizard — Interactive first-time configuration
// Usage: node scripts/setup.mjs

import { createInterface } from 'readline';
import { writeFileSync, readFileSync, existsSync, copyFileSync, mkdirSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

// The names offered under "Another one". For Claude, the ones Claude Code
// carries that Aerie's model list knows; for ChatGPT, the list Codex saved from
// the signed-in account, when there is one.
function otherModelNames(engine) {
  if (engine === 'codex') {
    try {
      const cache = JSON.parse(readFileSync(join(homedir(), '.codex', 'models_cache.json'), 'utf8'));
      const list = Array.isArray(cache) ? cache : cache.models;
      return (list || []).map((m) => m.slug || m.id).filter((id) => typeof id === 'string' && id.startsWith('gpt-'));
    } catch { return []; }
  }
  return [
    'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2',
    'claude-opus-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5',
  ];
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

// Piped input (a script, Docker, CI) that runs out before the last question
// used to end the wizard silently with status 0. Say so, and fail.
let finished = false;
rl.on('close', () => {
  if (finished) return;
  console.error('\n  Setup stopped: its input ended before every question was answered. Run it in a terminal (node scripts/setup.mjs).');
  process.exit(1);
});

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

  // 5. Which subscription the companion runs on. Both are the warm,
  // long-lived kind and neither needs an API key; an API provider is picked
  // in the app afterwards (Integrations → Providers), because it needs a key.
  console.log('\n  Where should your companion run?');
  console.log('    1. Claude, on your Claude subscription (through Claude Code)');
  console.log('    2. ChatGPT, on your ChatGPT subscription (through Codex)');
  console.log('  Either way there is no API key to pay for, and you can switch later in the app.');
  const engineAnswer = ((await ask('  Pick 1 or 2 [1] ')) || '1').trim();
  const engine = engineAnswer === '2' ? 'codex' : 'claude';
  const routing = engine === 'codex' ? 'codex-cli' : 'cli';

  // 6. Which model to start on. Any of these can be changed later in the app
  // (Agent → Models), so this is only where the house starts.
  const choices = engine === 'codex'
    ? [
        ['gpt-6.1-terra', 'GPT-6.1 Terra, a good everyday start'],
        ['gpt-6.1-sol', 'GPT-6.1 Sol, the workhorse'],
        ['gpt-6-astra', 'GPT-6 Astra, the most capable, and the heaviest on your limits'],
      ]
    : [
        ['claude-opus-5-5', 'Claude Opus 5.5, where Anthropic suggests most people start'],
        ['claude-sonnet-5-5', 'Claude Sonnet 5.5, lighter on your plan\'s limits'],
        ['claude-fable-5-2', 'Claude Fable 5.2, the most capable, with a usage limit of its own'],
      ];
  console.log('\n  Which model should your companion start on?');
  choices.forEach(([, label], i) => console.log(`    ${i + 1}. ${label}`));
  console.log(`    ${choices.length + 1}. Another one (type its name)`);
  console.log('  You can change it any time in the app: the model at the top of a chat is the whole house\'s,');
  console.log('  a thread can have its own (Model, in that thread\'s menu in the thread list), and so can each');
  console.log('  companion (their card in the Companions app).');
  const modelAnswer = ((await ask(`  Pick 1-${choices.length + 1} [1] `)) || '1').trim();
  let model = choices[0][0];
  const picked = parseInt(modelAnswer, 10);
  if (String(picked) === modelAnswer && picked >= 1 && picked <= choices.length) {
    model = choices[picked - 1][0];
  } else if (String(picked) === modelAnswer && picked === choices.length + 1) {
    const others = otherModelNames(engine);
    if (others.length) {
      console.log(engine === 'codex' ? '  The models your ChatGPT account offers:' : '  The Claude models Claude Code knows:');
      for (const name of others) console.log(`    ${name}`);
    } else {
      console.log('  Sign in to Codex first (codex login) and its model list will show here; the app shows it too.');
    }
    const typed = (await ask('  Model name: ')).trim();
    if (typed) model = typed;
  } else if (modelAnswer && !/^\d+$/.test(modelAnswer)) {
    model = modelAnswer;
  }
  // The quick check-ins when you've been away use a small model on Claude;
  // on ChatGPT they use the one you picked.
  const pulseModel = engine === 'codex' ? model : 'claude-haiku-5-5';
  if (engine === 'codex') {
    console.log('\n  Install the Codex CLI and sign in with your ChatGPT account, as this same user:');
    console.log('    npm install -g @openai/codex   then   codex login');
    console.log('  The model list in the app shows whichever models your account can run.');
  } else {
    console.log('\n  Make sure you\'re signed in to Claude Code: claude auth login');
  }

  // Write aerie.yaml. Every value goes in as a JSON string, which YAML reads
  // as a quoted string, so a quote or backslash in a name or the password can
  // neither break the file nor add keys of its own (Nov 6 2026 audit).
  const q = (v) => JSON.stringify(String(v));
  const yamlContent = `identity:
  companion_name: ${q(companionName)}
  user_name: ${q(userName)}
  timezone: ${q(timezone)}

server:
  port: 3002
  host: "127.0.0.1"
  db_path: "./data/aerie.db"

auth:
  password: ${q(password)}

agent:
  cwd: "."
  claude_md_path: "./CLAUDE.md"
  mcp_json_path: "./.mcp.json"
  model: ${q(model)}
  model_autonomous: ${q(model)}
  model_pulse: ${q(pulseModel)}
  routing: ${q(routing)}
  routing_autonomous: ${q(routing)}

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

  // Never over an existing house: its password and settings would be lost.
  if (existsSync('aerie.yaml')) {
    console.log('\n  aerie.yaml already exists, so it was left as it is. Move it aside to run setup fresh.');
  } else {
    // It holds the password, so only its owner can read it.
    writeFileSync('aerie.yaml', yamlContent, { mode: 0o600 });
    console.log('\n  Created: aerie.yaml');
  }

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
    cwd: ${JSON.stringify(resolve().replace(/\\/g, '/'))},
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

  if (existsSync('ecosystem.config.cjs')) {
    console.log('  ecosystem.config.cjs already exists, so it was left as it is.');
  } else {
    writeFileSync('ecosystem.config.cjs', pm2Config);
    console.log('  Created: ecosystem.config.cjs');
  }

  // Print startup instructions
  console.log(`
  Setup complete!

  Authentication:
    ${engine === 'codex'
      ? 'Your companion runs on your ChatGPT subscription through Codex. No API key needed.\n    Make sure you are signed in, as this same user: codex login'
      : 'Your companion runs on your Claude subscription through Claude Code. No API key needed.\n    Make sure you are signed in: claude auth login'}

  Next steps:
  1. Customize CLAUDE.md — this is your companion's personality
  2. Build:   npm run build
  3. Viewer:  npm run vendor  (the Artifacts viewer and Story Shelf widgets' React and Babel)
  4. Start:   npm start       (or: pm2 start ecosystem.config.cjs)
  5. Open:    http://localhost:3002

  For development:
    npm run dev              (backend with hot reload, in one terminal)
    npm run dev:phone        (phone UI with Vite dev server, in another)
    npm test                 (run the test suite)

  ${companionName} is ready to meet you.
`);

  finished = true;
  rl.close();
}

main().catch(err => {
  console.error('Setup failed:', err);
  rl.close();
  process.exit(1);
});
