# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| v1.x    | Yes       |

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

Open a [GitHub Security Advisory](https://github.com/match-stik/Aerie/security/advisories/new) with:
- Description of the vulnerability
- Steps to reproduce
- Impact assessment (what an attacker could do)

We'll acknowledge within 48 hours and aim to patch critical issues within 7 days.

## Security model

Aerie is self-hosted software that runs on your machine:

- **No cloud backend** — your data stays local (SQLite + filesystem)
- **No telemetry** — Aerie collects nothing about you and sends nothing to us. What the app does contact is listed under "What leaves your machine" below.
- **Your subscription, your account** — the companion's turns run through your own Claude Code (and, if you use them, Codex or other providers) under your own login
- **A password is optional only on this machine** — with no password, Aerie answers only on `127.0.0.1` and only to requests that name that address. It will not start on any other address until you set one.

## What your companion can do

This is the most important thing to know before you install.

On your own turns the companion runs Claude Code with its permission prompts switched off. It can run any command and read, change or delete any file that the account running Aerie can, without asking you first. The API lane's `shell_exec` and `codex_exec` tools are the same: unsandboxed. There is no command filter and no folder fence (an older version had them; [docs/HOOKS.md](docs/HOOKS.md) explains). The boundary is the machine and the account, so:

- **Run Aerie under an ordinary account of its own, never as root.** On a server, make a user for it. Claude Code also refuses to skip its prompts as root.
- **Keep on that account only what you are happy for the companion to reach.** Your other projects, keys and documents belong under a different account.
- **Turns from other people are fenced.** A message from a Discord guest is answered with tools locked: no commands, no file changes, no outside tools, and none of your side notes. That fence (`hooks/gate.cjs` in the lane folder) is the only one in the house.

## What stays reachable once a password is set

A password gates the app, the chat and the settings. A few things are served without it, on purpose:

- **Uploaded files at `/api/files/<id>`**, so a link works in a notification, on Discord or in a car. The id is a random UUID, so a file can be read only by someone who has its link. Do not post a file's link anywhere you would not post the file.
- **`/api/identity`** — the companion's name, your name and your timezone, which the sign-in screen shows.
- **`/stickers/...` and `/emojis/...`** — the sticker and emoji images.

The internal port (`server.internal_port`, 3012 by default) takes no password at all. It listens only on `127.0.0.1`, refuses any request with a forwarding header, and refuses any request a browser marks as coming from a web page. Never put anything in front of it.

## What leaves your machine

None of this is telemetry, but it is traffic you should know about:

- **The embedding model** is downloaded once from `huggingface.co` on the first message ([docs/semantic-search.md](docs/semantic-search.md)).
- **The Weather card** asks for the device's location; if you allow it, the coordinates go to Open-Meteo and OpenStreetMap. Say no and nothing is sent.
- **Now-playing**: if you turn on the phone's media access, the app posts what is playing (app, title, artist) to your own house while it is open. It goes nowhere else.
- **Whatever you connect**: model providers, ElevenLabs, Discord, Telegram, Spotify, Lovense and any MCP server you add are contacted when you use them.

## Keys

- Keys you enter in Settings are kept in the database, not in your files. Most are write-only from the app: they can be set or cleared and never read back. A few are readable by design because the phone itself uses them: ElevenLabs, Giphy, the Cortex address and token, and the Lovense developer token. Any setting whose name ends in `api_key`, `token`, `secret` or `password` is never handed to the settings screen.
- The keys are stored in plain text in `data/aerie.db`. Keep `data/` readable only by Aerie's account (`chmod 700 data`), and keep backups of it as private as the keys in it.

### What to watch for

- **Exposed ports** — to reach Aerie from elsewhere, set a password and use a tunnel or Tailscale ([docs/REMOTE-ACCESS.md](docs/REMOTE-ACCESS.md)); never forward the port on your router
- **CLAUDE.md contents** — this file is sent to the AI on every turn. Don't put secrets in it
- **`.env` and `aerie.yaml`** — contain credentials. Both are gitignored by default
- **Discord/Telegram tokens** — treat these as secrets. Never commit them
- **The MCP servers the kit ships** (Cortex and Spotify under `workers/`, Discord in `shared/`) each refuse every call without the secret you set when you deploy them
