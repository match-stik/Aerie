# Models and where their settings live

Aerie runs a companion on whichever model you pick, and different models need different settings. This page says where each one lives, by the kind of lane the model runs in. Nothing here has to match anybody else's house; set what suits yours.

Every setting below named like `heartbeat.autocompact_tokens` is changed with `PUT /api/settings {"key": "...", "value": "..."}` (signed in), and most of them also have a place in the app's Settings. Values are always strings.

## Which lane is the model in?

There are three kinds of lane, and they hold a conversation in different ways.

**Claude Code lane** (a Claude model on your subscription, through the `claude` CLI). One long-lived room per lane. The room holds the whole conversation and squashes itself (compacts) when it gets full. When a room is rebuilt from scratch, it is handed the last 30 messages of the thread.

**Codex lane** (an OpenAI model through the `codex` CLI on your ChatGPT login). Also a long-lived room that compacts itself. A new Codex room is handed the last 50 messages.

**API router lane** (OpenRouter, DeepSeek, Gemini's API, an Ollama cloud model, or any API key in Integrations → Providers). No room at all: every turn sends the companion's instructions plus the last 50 messages, so nothing builds up and nothing compacts.

## Claude Code lanes

**Which model.** `agent.model` for messages and `agent.model_autonomous` for scheduled wakes. Keep them the same: a wake on a different model than the chat restarts the lane at every bell and back again.

**How big the room can get.** The 4-series Claude models (Opus, Sonnet and Haiku 4.x) have a 200k window. Add `[1m]` to the model id (for example `claude-opus-4-6[1m]`) for the 1M window where your plan offers it. The 5-series models and Fable open with the large window already.

**When the room squashes.** `heartbeat.autocompact_tokens`, any number from 100000 to 1000000. Unset, a 200k model squashes at 140000 and every other model uses the CLI's own default, which runs nearly to the top of the window.
Leave room under the window. Reopening a room adds the instructions back on top of the conversation, often about 30k, so a room that went to sleep near the top of its window can fail to reopen with "Prompt is too long". As a rough guide: 140000 for a 200k model, 400000 to 900000 for a 1M one.
The flag is read when a lane launches, so a change reaches a lane at its next restart.

**How hard it thinks.** `agent.effort` (low, medium, high, xhigh, max, or adaptive).

**What happens to a flagged reply.** `heartbeat.refusal_fallback` set to `off` stops Claude Code from quietly retrying a safety-flagged reply on a different, older model. On by default.

**Extra prompt sections.** `heartbeat.prompt_sections` turns on sections Claude Code otherwise gives only to some models (for example `corrections,delivering_work`). Section names can change between CLI versions.

## Codex lanes

**Which model.** Pick it from the models your OpenAI account actually offers; the picker reads that list (`~/.codex/models_cache.json`). A model in the list is one your account can run.

**How big the room can get, and when it squashes.** Codex sizes the room from the model's context window in that same list and compacts on its own. Aerie does not set this; if you want to change it, it is Codex's own configuration (`~/.codex/config.toml`), described in Codex's docs.

**Whose instructions win.** `codex.instructions_slot`: `base` (the default) puts your companion's identity in place of OpenAI's per-model instructions; `developer` keeps OpenAI's and lays yours on top. A resumed Codex room keeps the slot it started with, so test a change in a fresh room.

## API router lanes

**Which model.** Pick the provider and model in Integrations → Providers, with your own key. Keys go in the secrets store, never in a file.

**How big the room can get.** There is no room. Each turn is the instructions plus the last 50 messages, so the model's window only has to fit that. A small model (8k or 32k) may run out on long messages or very long instructions; if a router model starts cutting off or refusing for length, it is the window, and a model with a bigger one is the fix.

**Images.** Some providers can't see pictures (DeepSeek, for one), so a companion on one of those can't look at an image you send.

## Discord

`discord.history_limit` in `aerie.yaml` (default 10) is how many recent channel messages ride along with a Discord turn so a companion knows what the room is talking about. Raise it for busy servers, but every extra message is read on every Discord turn.

## On Windows

The house's own command-line helper is `tools/sc.mjs`. Always call it as `node <your house>/tools/sc.mjs ...` (the companions' injected tool list already does). A bare `sc` on Windows runs Windows' own service-control program instead, which is a different tool entirely.
