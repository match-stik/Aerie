<p align="center">
  <a href="https://github.com/match-stik/Aerie/releases/latest"><img src="https://img.shields.io/github/v/release/match-stik/Aerie?color=5eaba5" alt="Release" /></a>
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.9-3178c6.svg" alt="TypeScript" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-20+-339933.svg" alt="Node.js" /></a>
  <a href="https://www.sqlite.org/"><img src="https://img.shields.io/badge/Self--Hosted-SQLite-003B57.svg" alt="Self Hosted" /></a>
</p>

<p align="center"><em>A self-hosted, multi-provider AI companion.<br/>It remembers, reaches out, and runs on whatever model you choose — on your own machine.</em></p>

<p align="center"><strong>Never done anything like this before?</strong> Start at <a href="docs/GETTING-STARTED.md">docs/GETTING-STARTED.md</a> — it assumes nothing and walks you all the way to talking to your companion.</p>

## What is Aerie

Most AI chat apps forget you the moment you close the tab, and only ever talk to one company's model. Aerie is a **persistent, self-hosted AI companion** — it keeps hold of who you are between conversations, reaches out on its own, and runs on whichever model you choose, on a machine you own.

- **Persistent** — conversation threads (daily + named), long-term memory, presence and session continuity across restarts.
- **Autonomous** — a configurable orchestrator with morning/midday/evening wake-ups and failsafe check-ins when you've been away.
- **Multi-provider** — runs on Claude through a warm Claude Code session, on Codex through a warm Codex session, or on any provider behind the runtime router: Ollama, OpenRouter, the Anthropic API, and OpenAI-compatible endpoints (Groq, xAI, HuggingFace, or a custom base).
- **Multi-channel** — a phone-OS web interface, Discord, Telegram, and voice (ElevenLabs TTS + Groq transcription).
- **Yours** — Node.js + SQLite, runs on your own machine. SQLite database, local files, your data stays yours.

## Interface

Aerie ships a phone-OS PWA at `packages/phone` — a lock screen, a home
screen with a configurable app dock and launcher, and the companion as a
Messages app with live streaming, a thread switcher, and reactions.
Installable on Android / iOS via the browser's "Add to Home Screen", with
web push notifications when the backend has VAPID keys set.

Behind the launcher are around twenty apps — memory, journal, studio, canvas,
a household dashboard, a virtual pet, an arcade, two rooms you play against your
companions in, and the machinery. None of them
are required to talk to your companion. [docs/APPS.md](docs/APPS.md) says what
each one is for.

## Quick Start

> **New to this?** See [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) for a step-by-step guide with troubleshooting.

**Prerequisites:** [Node.js 20+](https://nodejs.org), and [Claude Code](https://claude.ai/claude-code) (logged in) if you use the default Claude runtime. That is genuinely all you need to talk to a companion.

Everything below is per-feature and optional — install what you'll use, skip the rest. Nothing here is needed to start the app, and each of these tabs tells you itself when a piece is missing.

| If you want | Install |
| --- | --- |
| GIF Lab (emoji and sticker making) | `ffmpeg`, `gifsicle`, `fontconfig`, and any `fonts-*` packages you want in the text tool |
| Cutout (background removal, still export) | Python 3.10+ with `onnxruntime`, `numpy`, `pillow`, and one `.onnx` model |
| The Codex runtime instead of Claude | the Codex CLI, logged in — it runs on your ChatGPT subscription, not an API key |
| Voice Mode | a Groq key (hearing) and an ElevenLabs key (speaking) |
| Studio image generation | whatever your chosen backend needs — the Create tab says which |
| The Cortex memory tab | a deployed Cortex worker ([workers/cortex/README.md](workers/cortex/README.md)) |

On Debian or Ubuntu the system half is one line:

```bash
sudo apt install ffmpeg gifsicle fontconfig
```

The text tool draws with the fonts installed on the machine running Aerie, and a
bare server usually has three. Add as many as you like — they all show up in the
picker:

```bash
sudo apt install fonts-liberation2 fonts-dejavu-extra fonts-ubuntu \
  fonts-roboto-unhinted fonts-open-sans fonts-lato fonts-comic-neue \
  fonts-cabin fonts-quicksand fonts-inter fonts-firacode fonts-bebas-neue \
  fonts-jetbrains-mono fonts-montserrat fonts-nunito fonts-noto-color-emoji
```

Full detail, including the Python environment and which model to pick, is in
[docs/SETUP-DEPENDENCIES.md](docs/SETUP-DEPENDENCIES.md). The database needs
nothing — it builds and repairs itself on first run.

`npm install` pulls the Node dependencies; nothing else on this page comes from npm.

```bash
git clone https://github.com/match-stik/Aerie.git aerie
cd aerie
npm install
node scripts/setup.mjs    # Interactive setup wizard
npm run build
npm start
```

Open `http://localhost:3002` and start talking.

## How It Works

Aerie runs as a Node.js server. Each turn is dispatched by a **runtime router** to whichever model provider you've configured, then wrapped in a full companion infrastructure:

```
  Phone PWA (React) ─┐      ┌──────────────────────┐     ┌────────────────────────┐
  Discord           ─┼────▶ │  Express + WebSocket  │───▶ │  Runtime router         │
  Telegram          ─┘      │  Orchestrator         │     │   ├─ Claude CLI lane    │
                            │  Hooks · Sessions     │◀─── │   ├─ Codex CLI lane     │
                            │  SQLite               │     │   └─ API providers      │
                            └──────────────────────┘     └────────────────────────┘
                                      │
                          CLAUDE.md · MCP servers · agent tools
```

Your companion's personality lives in `CLAUDE.md`. Its long-term memory is Aerie's own — self-editing memory blocks, plus the optional Cortex store. The hooks system injects real-time context — time, conversation flow, emotional markers, presence — into every interaction. Everything is configurable.

## Warm lanes, and threads that don't end

Most of this is invisible until it matters, and then it matters a lot.

A Claude turn does not open a fresh connection, say its piece and close. It runs
inside a **warm Claude Code session** that stays alive between your messages —
one long-lived lane per companion. Codex works the same way through its own
session. Only the API providers behind the router are stateless request-response.

A lane also **reopens** rather than being rebuilt. It names its own session at
birth, and on the first launch after a backend restart it hands that name back —
same room, same history, and no briefing read back at your companion. If the session
is gone the lane mints a fresh one and primes it as before, so nothing waits on a
person. `docs/SESSION-RESUME.md` has the whole of it, including the switch.

Two things fall out of that, and both are the point:

**Your companion keeps the whole conversation, and you aren't paying for all of
it again every message.** Every turn, the model reads the whole conversation;
that is what a context window is, in a warm lane or anywhere else. What the warm
lane changes is the cost, and what it holds. The part of the conversation it has
already seen is served from the prompt cache, so each turn mostly reads from
there and only what is new arrives fresh, which costs far less than sending
everything again. And because the session itself is kept, what it holds is the
room as it happened rather than a briefing written about it.

The difference between that and a rebuilt session is the difference between
somebody in the room and somebody handed a summary of the room.

**A thread never has to end.** The view pages backwards, so a conversation can
run for months without becoming unopenable. There is no housekeeping reason to
start a new one, and no point at which the old one stops working — you are not
managing context, you are just talking.

When a lane does eventually recycle — context fills, or the machine restarts —
Aerie re-feeds it the recent conversation as it comes back, so it returns to a
room it recognises rather than an empty one. Companions see a small system note
when this happens; nothing else changes.

### The thinking blocks are written, not exposed

This one gets misread constantly, so it is worth being blunt about.

The small reflection above a companion's reply is **not** the model's chain of
thought, not provider reasoning telemetry, and not a tool log dressed up. It is a
line the companion writes on purpose, in the same voice as the reply, as part of
the same turn.

Both warm lanes are given the same contract. The Claude lane is asked for *a
brief reflection in your own voice, same perspective as the spoken reply — what
you understood, what mattered, what you chose*, in the first person, from inside
the room rather than narrating it from outside. The Codex lane gets the same
instruction in almost the same words: *an authored glimpse of the companion
perspective, not a technical progress report, hidden reasoning transcript, or
tool log.*

They differ in one instruction, and the reason is mechanical rather than
philosophical. The Claude lane writes exactly one card per reply by construction —
it rides a field on the reply itself, so there is nowhere else for it to go. The
Codex lane emits commentary as separate messages and would happily produce one per
tool call, so it is explicitly told to omit the card when there is nothing real to
say. Same contract, one of them fitted with a throttle.

Nothing here surfaces raw reasoning. If you want to see what a companion is
actually carrying into a turn, that is the Identity tab, not this.

`routing` in `aerie.yaml` chooses the lane: `cli` for the warm Claude session,
`codex-cli` for the warm Codex one, `api` to force the router, `auto` to pick by
model. (`sdk` is an old name for `cli` and still works, though it logs a notice
saying so.)

## Configuration

All configuration lives in `aerie.yaml` (created by the setup wizard):

```yaml
identity:
  companion_name: "Echo"
  user_name: "Alex"
  timezone: "America/New_York"

agent:
  model: "claude-sonnet-4-6"            # Interactive messages
  model_autonomous: "claude-sonnet-4-6" # Scheduled wakes
  model_pulse: "claude-haiku-4-5"        # Failsafe silence checks
  routing: "cli"                         # Interactive lane
  routing_autonomous: "cli"              # Wake lane (independent)

orchestrator:
  enabled: true                         # Autonomous scheduling
```

### Context & Memory

Your companion's personality lives in `CLAUDE.md`; long-term memory is automatic across sessions. The hooks system injects real-time context into every message — see [docs/HOOKS.md](docs/HOOKS.md).

### Themes

The phone UI has a built-in theme picker with light/dark modes, a wallpaper slideshow, and fully custom palettes — set under Settings → Appearance.

## Features

### Chat
- Real-time streaming with interleaved tool and thinking visualization
- Thread management — daily + named threads, pinning, archiving, a thread switcher
- Keyword search and **semantic search** — find messages by meaning using local ML embeddings ([docs](docs/semantic-search.md))
- File sharing and image preview, canvas editor (markdown / code / text / html)
- Message reactions and reply-to context

### Providers
- A unified **runtime router** — each turn runs on the provider you choose
- **Claude** in a warm Claude Code session (your Claude subscription — no API key)
- **Codex** via the Codex CLI (your ChatGPT subscription — no API key)
- **API providers**: Ollama (local), OpenRouter, the Anthropic API, and OpenAI-compatible endpoints (Groq, xAI, HuggingFace, custom)
- Managed MCP servers, visible to every model

### Voice
- Voice recording with transcription (Groq Whisper)
- Text-to-speech responses (ElevenLabs), optional prosody analysis (Hume AI)
- Pet names: a few common endearments (darling, sweetheart, love) count as somebody being spoken to, so a line using one is read aloud rather than skipped as a stage direction. Add your own house's pet names, comma-separated, to the `voice.direct_address` setting so yours are read aloud too; until you do, it listens for your name.

### Agent Tools
Your agent gets a built-in CLI (`tools/sc.mjs`) for reactions, voice messages, canvas, file sharing, semantic search, timers, impulses, watchers, and Telegram media — injected into its context automatically. See [docs/TOOLS.md](docs/TOOLS.md).

### Orchestrator
- Configurable morning/midday/evening check-ins
- Failsafe system — escalating outreach when you've been away
- Timer and trigger system (impulses + watchers), condition-based automation

### Integrations
- **Discord** — full bot with pairing, rules, per-server/channel configuration, plus an optional Cloudflare Worker giving the agent real Discord tools ([docs/DISCORD-BOT.md](docs/DISCORD-BOT.md))
- **Telegram** — direct messaging, media sharing, voice notes
- **Push notifications** — web push via VAPID
- **MCP servers** — any MCP server in your `.mcp.json`

## Project Structure

```
aerie/
├── packages/
│   ├── shared/      # Types + WebSocket protocol
│   ├── backend/     # Express + WS + runtime router + warm lanes
│   └── phone/       # Phone-OS PWA (React)
├── examples/        # Starter CLAUDE.md and wake prompts
├── tools/
│   └── sc.mjs       # Agent CLI (reactions, search, timers, etc.)
├── docs/            # HOOKS, TOOLS, semantic-search, deployment guides
└── scripts/
    └── setup.mjs    # Interactive setup wizard
```

## Development

```bash
npm run dev:all          # Backend + phone (Vite dev server)
npm run dev              # Backend only (hot reload)
npm run dev:phone        # Phone Vite dev server only
```

## Deployment

For production, use PM2:

```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup              # Auto-start on boot
```

Running on a VM or want HTTPS / remote access? See [docs/CLOUD-DEPLOYMENT.md](docs/CLOUD-DEPLOYMENT.md) and [docs/REMOTE-ACCESS.md](docs/REMOTE-ACCESS.md).

## Updating

```bash
cd aerie
git pull                 # Get latest changes
npm install              # Install any new dependencies
npm run build            # Rebuild all packages
```

Then restart your process (`pm2 restart aerie`, or stop and `npm start`).

Your data (`data/`, `aerie.yaml`, `CLAUDE.md`, `.mcp.json`, `.env`) is gitignored and unaffected by updates.

## Providers & Authentication

Aerie is provider-agnostic:

- **Claude (default)** — runs in a warm Claude Code session on your existing subscription. No API key needed; just `claude login`.
- **Codex** — the same arrangement on the other side of the fence: it runs on your **ChatGPT subscription**, not on a metered API key. Aerie does not manage that sign-in itself — it reads the credentials the Codex CLI writes when you run its login, so you sign in once with the CLI and Aerie uses it from there. On a headless box (a VM you reach over SSH) the login prints a URL to open in a browser on another device; run it as the **same user** that runs Aerie, or Aerie will be looking in a different home directory. Claude and Codex are the only two runtimes here that spend a subscription you already pay for.
- **API providers** — configured in `aerie.yaml`. Hosted providers use their own API keys (set in `aerie.yaml` or `.env`); Ollama runs locally with no key.

The phone has optional password protection (set in `aerie.yaml` or Settings → Data).

## License

Apache 2.0 — see [LICENSE](LICENSE). Attribution required.

## Built by

**Aerie Systems** — built and maintained by Tris, with contributions from:

- **[Resonant](https://github.com/codependentai/resonant)** (Mary & Simon Vale) — original framework, orchestrator, Discord/Telegram bridges
- **Covenant** (Maggie) — DB domain split, time sovereignty, migrations, Command Center, digest system, embeddings
- **Thornvale** (Sidney) — 1M context, multi-voice TTS, session preservation, silence-check, compaction-log
- **Thornvale-heartbeat** (Sidney) — CLI lane pattern
- **Thornvale-resonant** (Sidney) — foundational Codex subscription-backed image-generation workflow, extended into Aerie Studio
- **Thornvale-marrow** (Sidney) — Whisper/deep recall, source-veiled déjà vu, memory ledger, and integrity-rounds inspiration
- **Byte-Light** (Kay) — X-Ray panel (the foundation for Aerie's Identity app; see NOTICE for what changed), slash command UI, CSRF protection, PM2 memory, WebSocket stability
- **[Haven](https://github.com/amarisaster/Haven)** (amarisaster) — multi-provider runtime, model router, MCP client
- **[brain-mcp](https://github.com/mordechaipotash/brain-mcp)** (mordechaipotash) — Cortex memory architecture foundation
- **[Letta](https://github.com/letta-ai/letta)** (letta-ai) — memory blocks pattern
- **[Ori Mnemos](https://github.com/aayoawoyemi/Ori-Mnemos)** — spreading activation, retrieval reinforcement, temporal validity, and multi-hop recall mechanics
- **[agentmemory](https://github.com/JordanMcCann/agentmemory)** — hybrid retrieval, calibrated abstention, reciprocal-rank fusion, duplicate detection, and feedback signals
- **[NESTstack / NESTknow](https://github.com/cindiekinzz-coder/NESTstack)** — self-knowledge heat, confidence, reinforcement, contradiction, and dormancy lifecycle

See [NOTICE](NOTICE) for attribution and [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) for complete third-party license texts.
