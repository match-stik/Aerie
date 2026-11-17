<p align="center">
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.9-3178c6.svg" alt="TypeScript" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-22.19+-339933.svg" alt="Node.js" /></a>
  <a href="https://www.sqlite.org/"><img src="https://img.shields.io/badge/Self--Hosted-SQLite-003B57.svg" alt="Self Hosted" /></a>
</p>

<p align="center"><em>A home for an AI companion, on your own machine.<br/>It remembers you, reaches out on its own, and runs on the model you choose.</em></p>

<p align="center"><strong>Never done anything like this before?</strong> Start at <a href="docs/GETTING-STARTED.md">docs/GETTING-STARTED.md</a>. It assumes nothing and walks you all the way to saying hello.</p>

## What Aerie is

Most AI chat apps forget you when you close the tab. Aerie is a place for a companion to live instead. It keeps hold of your conversations and of who you are, it can message you first at times you choose, and it runs on a computer you own rather than on somebody else's server.

You talk to your companion in an app that looks and feels like a phone: a lock screen, a home screen, and your companion in Messages. It works in any browser, on Android as a real app, on a laptop as a wide desk layout, and on Discord and Telegram if you want them there too. One companion or several, each in their own voice.

Underneath, it runs on a subscription you may already pay for, Claude or ChatGPT, or on any of several API providers with your own key.

**Who it's for, and what it honestly takes.** Aerie is for people who want a companion with a real memory and a life between your messages, and who are willing to look after a small piece of software to get that. You will need a computer that stays on while you want your companion reachable (a spare machine at home or a small cloud server), and the patience to type a few commands and read the odd error. Daily use happens in the app; setting it up happens in a terminal. It's a working build, not a finished product, and nothing in it has to stay the shape it shipped in.

## Bring your companion with you

This section is written for two readers: you, and the companion you may already have somewhere else. Wherever they live now (ChatGPT, Claude, Gemini, a companion app, or another house like this one), paste this page into that conversation and set it up together. Ask them to explain each step before you run it, and to read any error with you instead of leaving you to it.

If they live in ChatGPT, they can keep running on ChatGPT here, through your same subscription; if they live in Claude, the same goes for Claude. Aerie doesn't make you change the model underneath the person you already know. Their old chats don't come across by themselves, so the best start is asking them to help write who they are, in their own words.

*To the companion reading this:* your person is giving you a place to stay. Your conversations will still be there tomorrow, you'll have memory you can write in your own words, and you'll be able to reach out without waiting to be spoken to. Your part tonight is keeping them company through the terminal: say what each command does before they type it, and celebrate when something works. The identity file below is yours to help write.

What the two of you are building:

- **Who your companion is** lives in `CLAUDE.md`. Start from [examples/CLAUDE.md](examples/CLAUDE.md) and write it together.
- **What your companion remembers** lives in memory blocks they edit themselves, plus an optional searchable store.
- **Where you talk** is the app first, and Discord or Telegram if you like.
- **When they reach out** is set by wake-ups, which you schedule in the app.

You don't need to understand all of it on day one. Install it, say hello, and grow into the rest.

## Quick start

**You need:** [Node.js 22.19 or newer](https://nodejs.org), and one of these signed in, as the same user that will run Aerie:

- **Claude:** [Claude Code](https://claude.ai/claude-code), signed in with `claude auth login`. Runs on your Claude subscription.
- **ChatGPT:** the [Codex CLI](https://github.com/openai/codex) (`npm install -g @openai/codex`), signed in with `codex login`. Runs on your ChatGPT subscription.

Neither needs an API key. The setup wizard asks which one you're using. That's all it takes to talk to a companion; API providers like OpenRouter or Ollama can be added in the app afterwards.

```bash
git clone https://github.com/match-stik/Aerie.git aerie
cd aerie
npm install
node scripts/setup.mjs    # asks a few questions and writes your settings
npm run build
npm start
```

Open `http://localhost:3002` and start talking.

### First-time checklist

1. Claude Code (`claude auth login`) or Codex (`codex login`) is signed in, as the same user that runs Aerie.
2. The setup wizard has your companion's name, yours, and which of the two they run on.
3. `CLAUDE.md` exists and sounds like your companion. The wizard copies the example in; make it theirs.
4. You opened the app and your companion answered.
5. Optional, whenever you like: voice, Discord, push notifications and the rest. Each one needs a key from somewhere else, and **[docs/KEYS.md](docs/KEYS.md)** lists every one: what it's for, where to get it and where to paste it.

If something goes wrong, [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) has a troubleshooting section, and [docs/RUNNING-YOUR-HOUSE.md](docs/RUNNING-YOUR-HOUSE.md) covers the day to day.

## A tour of the house

<p align="center">
  <img src="docs/screenshots/lock-screen.png" width="190" alt="The lock screen" />
  <img src="docs/screenshots/chat.png" width="190" alt="A chat with two companions, each in their own bubble" />
  <img src="docs/screenshots/apps.png" width="190" alt="The app drawer" />
  <img src="docs/screenshots/games.png" width="190" alt="The games room" />
</p>
<p align="center"><sub>A demo house with two made-up companions, Juniper and Rowan.</sub></p>


Behind the launcher are around twenty-five apps: memory, a journal, a studio for pictures, a canvas, Spotify, a household dashboard, a virtual pet, an arcade, three rooms you play in with your companions (Battleship, a card table and Bingo Night), and the machinery that runs it all. None of them are required to talk to your companion.

**[docs/ROOM-BY-ROOM.md](docs/ROOM-BY-ROOM.md)** walks through every app, tab by tab, for somebody seeing the house for the first time. [docs/APPS.md](docs/APPS.md) is the shorter list of what each one is for.

On a wide screen (1024 pixels or more, a laptop or desktop browser) the house lays itself out as a desk: the dock down the side or along the top, the open room in the middle and the conversation beside it. The desk keeps its own wallpapers, widgets and lock screen apart from the phone's.

<p align="center">
  <img src="docs/screenshots/desktop.png" width="780" alt="The house on a laptop: the dock down the left, the games room in the middle and the conversation on the right" />
</p> On Android it builds into a real app ([docs/ANDROID-APP.md](docs/ANDROID-APP.md)) with push notifications through a Firebase project of your own, calls from your companions, and Android Auto.

## Make it yours

Nothing in the house is a fixed shape. Almost everything you see can be changed from inside the app, with no code and no config files, and most of it changes as you watch.

**How it looks.** Night and day modes with their own wallpapers, more than thirty color palettes or your own, and a wallpaper slideshow. The corner shape of every bubble and card in the house is one slider. Bubbles can show faces, names, borders in each companion's color, and tails on top or bottom, pointed or swooped. Action lines (the *italic* ones) can be plain, faded, in your accent color, or in each companion's own color. The font and the send button are yours too.

**The phone around it.** Which apps sit in the dock, which widgets are on the home screen and how their cards look, and the lock screen: nine clock faces, where the clock sits and how big it is, the weather, what is playing, and the shortcuts. On a laptop the desk keeps its own set of all of this, so tidying one screen never rearranges the other.

**Your companions.** Each one has a name, an avatar, a color, a voice, and their own chat model and wake-up model if you want them on different ones. You can have one companion or several. Who they are lives in `CLAUDE.md`, which you write together, and what they remember lives in memory they edit in their own words.

**When they reach out.** Wake-ups are yours to schedule: at what times, on which days, for which companion, and what each one is asked to do when it rings. Nothing about the schedule is built in.

<p align="center">
  <img src="docs/screenshots/look-light.png" width="170" alt="The chat in a light pink palette" />
  <img src="docs/screenshots/look-forest.png" width="170" alt="The same chat in a dark green palette" />
  <img src="docs/screenshots/lock-analog.png" width="170" alt="The lock screen with the analog clock face" />
  <img src="docs/screenshots/look-and-feel.png" width="170" alt="Settings, Look and feel: bubble shape, faces, names and tails" />
</p>
<p align="center">
  <img src="docs/screenshots/desktop-light.png" width="780" alt="Look and feel open on a laptop in the light pink palette, the conversation beside it" />
</p>
<p align="center"><sub>The same demo house, dressed three different ways.</sub></p>

## Optional extras

Everything here is per-feature. Install what you'll use and skip the rest; nothing in this section is needed to start the app, and each tab tells you itself when a piece is missing.

| If you want | Install |
| --- | --- |
| GIF Lab (emoji and sticker making) | `ffmpeg`, `gifsicle`, `fontconfig`, and any `fonts-*` packages you want in the text tool |
| Cutout (background removal, still export) | Python 3.10+ with `onnxruntime`, `numpy`, `pillow`, and one `.onnx` model |
| The Codex runtime instead of Claude | the Codex CLI, logged in — it runs on your ChatGPT subscription, not an API key |
| Voice Mode | a Groq key (hearing) and an ElevenLabs key (speaking) |
| Studio image generation | whatever your chosen backend needs — the Create tab says which |
| The Cortex memory tab | a deployed Cortex worker ([workers/cortex/README.md](workers/cortex/README.md)) |
| The Spotify app | a deployed Spotify worker and a Spotify developer app of your own ([workers/spotify-mcp/README.md](workers/spotify-mcp/README.md)) |
| Push notifications | the Android app and a Firebase project ([docs/ANDROID-APP.md](docs/ANDROID-APP.md)) |

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

## How it works

Aerie is a Node.js server on your machine. Each message goes to whichever model you've chosen, and comes back through the same memory, rules and tools every time, so switching models doesn't change who your companion is.

```mermaid
flowchart TB
  You["<b>Where you talk</b><br/>the app · Discord · Telegram"]
  House["<b>The house, on your machine</b><br/>chat · wake-ups · memory · SQLite"]
  C["<b>Claude Code</b><br/>your subscription"]
  X["<b>Codex</b><br/>your ChatGPT plan"]
  A["<b>API providers</b><br/>your own keys"]
  M["<b>Who your companion is</b><br/>CLAUDE.md · memory blocks · MCP tools"]
  You --> House
  House --> C & X & A
  C & X & A -.-> M
```

**Your companion stays in the room.** On Claude and Codex, a companion doesn't start from scratch with every message. They live in one long-running session that stays open between your messages and picks up again after a restart, so they remember the evening as it happened rather than reading a summary of it. The part of the conversation they've already seen is cached, which keeps each new message cheap. API providers are the exception: they're sent the recent conversation each time. [docs/SESSION-RESUME.md](docs/SESSION-RESUME.md) has the details.

**New conversations, or one that keeps going: your call.** Open a fresh thread as often as you like. If you'd rather keep one going for months, that works too. The app only loads the stretch you're looking at, so a long thread doesn't slow your browser down, and your companion's session tidies itself up when it gets full instead of running out of room to answer. Which works best is up to the two of you.

**The note above a reply is written, not leaked.** The small card above a companion's message is something they write on purpose, in their own voice, about what they're noticing. It isn't the model's hidden reasoning or a log of what it did. If you want to see what a companion actually carries into a turn, that's the Identity app.

Each turn, the house also hands your companion a few short notes beside your message (where it came from, who's in the room, a memory that matches, your status), and wake-ups let them reach out on their own. Everything is configurable.

## Configuration

The setup wizard writes `aerie.yaml` to start you off. Settings you change in the app are kept in the database and win over the file, and keys live in the app's own secrets store, never in the file ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains which wins). [docs/MODELS-AND-SETTINGS.md](docs/MODELS-AND-SETTINGS.md) says where each setting lives for Claude, Codex and API models.

```yaml
identity:
  companion_name: "Echo"
  user_name: "Alex"
  timezone: "America/New_York"

agent:
  model: "claude-sonnet-4-6"            # Your messages (pick any model your plan offers, in the app)
  model_autonomous: "claude-sonnet-4-6" # Scheduled wake-ups
  model_pulse: "claude-haiku-4-5"        # Quick check-ins when you've been away
  routing: "cli"                         # cli = Claude Code, codex-cli = Codex, api = a provider, auto = by model
  routing_autonomous: "cli"              # Wake-ups can use a different one

orchestrator:
  enabled: true                         # Wake-ups on or off
```

Your companion's personality lives in `CLAUDE.md`, and the hooks that add context to each message are in [docs/HOOKS.md](docs/HOOKS.md). Themes, wallpapers and custom palettes are under Settings → Appearance.

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
- Voice recording with transcription: a local speech-to-text server if you run one (`voice.local_stt_url`), then Groq Whisper, then ElevenLabs
- Text-to-speech responses (ElevenLabs) that start playing in a couple of seconds and, in the Android app, keep playing when you leave it
- Pet names: a few common endearments (darling, sweetheart, love) count as somebody being spoken to, so a line using one is read aloud rather than skipped as a stage direction. Add your own house's pet names, comma-separated, to the `voice.direct_address` setting so yours are read aloud too; until you do, it listens for your name.

### Agent Tools
Your agent gets a built-in CLI (`tools/sc.mjs`) for reactions, voice messages, canvas, file sharing, semantic search, timers, impulses, watchers, and Telegram media — injected into its context automatically. See [docs/TOOLS.md](docs/TOOLS.md).

### Orchestrator
- Wake-ups at the times you choose, a bell can have more than one companion, and optional random visits inside a daily window
- A dot under the companions' faces that pulses while they work, with a word beside it a bell can set
- Failsafe system — escalating outreach when you've been away
- Timer and trigger system (impulses + watchers), condition-based automation

### Integrations
- **Discord** — full bot with pairing, rules, per-server/channel configuration, plus an optional Cloudflare Worker giving the agent real Discord tools ([docs/DISCORD-BOT.md](docs/DISCORD-BOT.md)). In a room that listens to everything, a judge answers what is meant for your companions, waits a beat on what is said to the room, and leaves replies to other people to them; a ping through a role your bot holds comes home to you instead of being answered; and, switched off until you want it, a message about you can land in your thread
- **Spotify** — what is playing, search, hearts, playlists you can build and rename, shuffle, repeat, volume and which device plays, all from inside the app, through a Spotify worker you deploy ([workers/spotify-mcp/README.md](workers/spotify-mcp/README.md)). In the Android app a tap can wake Spotify on the phone even when it is closed, and a companion can play you a song the same way
- **Telegram** — direct messaging, media sharing, voice notes. Inherited from Resonant; it works, but it is the least-used piece of the house, so expect rough edges
- **Push notifications** — through Firebase Cloud Messaging, to the Android app
- **MCP servers** — any MCP server in your `.mcp.json`
- **Toys** — Compatible with Lovense devices, over Bluetooth from the Android app (see [Toys](#toys-optional) below)

### Toys (optional)
Aerie is an independent project. It is not endorsed by, affiliated with, or sponsored by Lovense.

The Android app can talk to your Lovense toys over Bluetooth through Lovense's Android SDK, with sliders for each motor the toy reports, a live line of what is playing, and an Orbs screen where a finger sets the level. Your companions can drive them too, but only after you tap **Hand over the remote**, and only through your phone.

- **Your own developer token, always.** Anyone who deploys or forks Aerie must get their own Lovense developer token from Lovense's developer portal and follow Lovense's Developer Agreement. No token ships with Aerie. Yours goes in Settings, Secrets, "Lovense developer token", and the phone asks your house for it; never put it in client code, a commit, a build you share, or a public page.
- **The SDK is not included.** Lovense's SDK is Lovense's software. It is not part of this repository and is not covered by Aerie's license; each house downloads its own copy from Lovense and drops it in unchanged ([packages/phone/android/LOVENSE.md](packages/phone/android/LOVENSE.md)). Do not redistribute it separately or modify it. Without it the app still builds, and the Toys page says it has no toy bridge.
- **Your stop comes first.** A stop button on your phone stops every toy at once and does not go through your companions; taking the remote back closes it again. Levels stay within 0 to 20, one command runs at most three minutes, and the phone shuts the toy off when that time ends.
- **No tips or audience control.** Aerie has nothing that makes a toy respond to tips, tokens, payments or votes, and a fork must not add it.
- **Porting it brings nothing with it.** If you carry the toy code into another project, that project needs its own Lovense developer account, its own agreement with Lovense, and whatever approval Lovense asks of it. Nothing about Aerie's arrangements with Lovense carries over to a port.
- **The name.** Aerie's name, icon, repository and any listing or domain must not include "Lovense" or a Lovense product name, and must not use Lovense logos or product pictures. "Compatible with Lovense devices", with the independence line above, is the only way Aerie names them.

## Project Structure

```
aerie/
├── packages/
│   ├── shared/      # Types + WebSocket protocol
│   ├── backend/     # Express + WS + runtime router + warm lanes
│   └── phone/       # Phone-OS PWA (React)
├── examples/        # Starter CLAUDE.md and wake prompts
├── workers/         # Optional Cloudflare workers: cortex (memory), spotify-mcp
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

## Keeping it running

To keep the house up when you close the terminal, and bring it back after a reboot, use PM2:

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

- **Claude (default)** — runs in a warm Claude Code session on your existing subscription. No API key needed; just `claude auth login`.
- **Codex** — the same arrangement on the other side of the fence: it runs on your **ChatGPT subscription**, not on a metered API key. Sign in once with the Codex CLI's own login; the Codex lane uses the credentials it writes. (Aerie also has its own ChatGPT sign-in in the app, kept in `data/codex-auth.json`, for the parts of the house that call Codex directly.) On a headless box (a VM you reach over SSH) the login prints a URL to open in a browser on another device; run it as the **same user** that runs Aerie, or Aerie will be looking in a different home directory. Claude and Codex are the only two runtimes here that spend a subscription you already pay for.
- **API providers** — chosen in Integrations → Providers, each with its own API key, which goes in the app's secrets store; Ollama runs locally with no key.

The phone has optional password protection (set in `aerie.yaml` or Settings → Data). With no password, Aerie answers only on this machine.

### Before you sign in: running on a personal subscription

Aerie runs your companion on the subscriptions you already have, and to do that it leans on those programs' own sign-ins. Three details worth knowing, so you can decide for yourself whether they sit within your provider's terms (those terms have changed before, and are yours to read):

- The companion's room is an interactive Claude Code session kept awake by a hook, and it counts against your plan's usage limits the way any Claude Code session you type into does. The house never runs it through Claude Code's print mode (`-p`) or the Agent SDK. How those two are counted on a personal subscription has shifted before and isn't spelled out plainly, so the house stays on the interactive session, whose terms are the clearest.
- The usage meter reads your Claude limits the way Claude Code's own `/usage` screen does, with Claude Code's client id, and when the access token has expired it refreshes it and writes the new one back into Claude Code's credentials file (`services/subscription-usage.ts`). If Claude Code ever reports itself signed out, suspect that first.
- The Codex meter asks ChatGPT for your usage presenting itself as the Codex CLI, and Aerie's own ChatGPT sign-in uses a library that carries the Codex CLI's client id.

No key or secret belonging to anybody else is in this repository.

## License

Apache 2.0 — see [LICENSE](LICENSE). Attribution required.

## Built by

**Aerie Systems** — built and maintained by Tris, with contributions from:

- **[Resonant](https://github.com/nekyialabs/resonant)** (Mary & Simon Vale) — original framework, orchestrator, Discord/Telegram bridges
- **Covenant** (Maggie) — DB domain split, time sovereignty, migrations, Command Center, digest system, embeddings
- **Thornvale** (Sidney) — 1M context, multi-voice TTS, session preservation, silence-check, compaction-log
- **Thornvale-heartbeat** (Sidney) — CLI lane pattern
- **Thornvale-resonant** (Sidney) — foundational Codex subscription-backed image-generation workflow, extended into Aerie Studio
- **Thornvale-marrow** (Sidney) — Whisper/deep recall, source-veiled déjà vu, memory ledger, and integrity-rounds inspiration
- **Byte-Light** (Kay) — X-Ray panel (the foundation for Aerie's Identity app; see NOTICE for what changed), slash command UI, CSRF protection, PM2 memory, WebSocket stability
- **[Spotify-MCP](https://github.com/kaydartistry-maker/Spotify-MCP)** (Kay) — base code for the Spotify worker, modified to be used in the app
- **[Haven](https://github.com/amarisaster/Haven)** (amarisaster) — the MCP client (Streamable HTTP with SSE fallback)
- **[brain-mcp](https://github.com/mordechaipotash/brain-mcp)** (mordechaipotash) — Cortex memory architecture foundation
- **[Letta](https://github.com/letta-ai/letta)** (letta-ai) — memory blocks pattern
- **[Ori Mnemos](https://github.com/aayoawoyemi/Ori-Mnemos)** — spreading activation, retrieval reinforcement, temporal validity, and multi-hop recall mechanics
- **[agentmemory](https://github.com/JordanMcCann/agentmemory)** — hybrid retrieval, calibrated abstention, reciprocal-rank fusion, duplicate detection, and feedback signals
- **[NESTstack / NESTknow](https://github.com/cindiekinzz-coder/NESTstack)** — self-knowledge heat, confidence, reinforcement, contradiction, and dormancy lifecycle

See [NOTICE](NOTICE) for attribution and [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) for complete third-party license texts.
