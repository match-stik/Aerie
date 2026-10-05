# Getting Started with Aerie

This guide walks you through setting up Aerie from scratch, even if you've never used Node.js or the terminal before.

## What You Need

1. **A computer** running Windows, macOS, or Linux
2. **An internet connection**
3. **A Claude Code subscription** from Anthropic ([claude.ai/claude-code](https://claude.ai/claude-code))

That's it. No API keys to manage. Aerie runs through your Claude Code subscription.

## First: Opening a Terminal

Almost everything below gets typed into a terminal — a plain text window where you
give your computer one instruction at a time. If you have never opened one, this is
where it lives:

- **Windows:** press the Start key, type `PowerShell`, press Enter.
- **macOS:** press Cmd+Space, type `Terminal`, press Enter.
- **Linux:** press Ctrl+Alt+T.

A window opens with a blinking cursor. Whenever this guide shows a shaded box like
this one:

```bash
node --version
```

it means: type that line into the terminal and press Enter. You do not need to
understand what any of the commands do — only that this is where they go.

## Step 1: Install Node.js

Aerie runs on Node.js. If you don't have it:

**Windows:**
1. Go to [nodejs.org](https://nodejs.org)
2. Download the LTS version (the big green button)
3. Run the installer, click Next through everything
4. Restart your terminal after installing

**macOS:**
```bash
# If you have Homebrew:
brew install node

# Or download from nodejs.org
```

**Linux (Ubuntu/Debian):**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Verify it works:**
```bash
node --version    # Should show v20 or higher
npm --version     # Should show v10 or higher
```

## Step 2: Install Claude Code

Aerie runs on your Claude Code subscription. Install the CLI globally:

```bash
npm install -g @anthropic-ai/claude-code
```

Then log in:

```bash
claude login
```

This opens your browser. Sign in with your Anthropic account. Once you see "Successfully authenticated," you're done. Aerie will use this login — no API keys to copy around.

## Step 3: Download Aerie

```bash
git clone https://github.com/match-stik/Aerie.git aerie
cd aerie
```

That `aerie` on the end of the first line is the folder name to make. Without it
you get a folder called `Aerie` with a capital A, and the next line stops working
on Linux — so it's worth typing.

If you don't have git, download the ZIP from the green **Code** button on GitHub
and extract it somewhere you can find again — your Documents folder is fine. Then
point your terminal at it by typing `cd ` (with the space) and dragging the
extracted folder onto the terminal window, which fills in the path for you. Press
Enter.

## Step 4: Install Dependencies

```bash
npm install
```

This downloads everything Aerie needs. It takes a minute or two.

## Step 5: Run the Setup Wizard

```bash
node scripts/setup.mjs
```

The wizard asks you four questions:

1. **What should your companion be called?** — Give it a name. "Echo" is the default.
2. **What is your name?** — Your name, so the companion knows who it's talking to.
3. **Set a password?** — Leave blank if you're only accessing it from your own computer. Set one if you'll access it over your network.
4. **Your timezone?** — It auto-detects. Press Enter to accept or type a different one.

The wizard creates all the configuration files you need.

## Step 6: Customize Your Companion's Personality

Open the file called `CLAUDE.md` in the aerie folder. This is your companion's personality — its instructions for how to behave, what to remember, and how to interact with you.

The default is a simple friendly personality. Edit it to make it yours. For example:

```markdown
# Luna — My Companion

You are Luna. You're thoughtful, a little nerdy, and genuinely curious about my life.

You know I'm a teacher. You know I have two cats named Pixel and Byte.
You check in on me during the day and remind me to take breaks.

When I'm stressed, you don't try to fix things — you just listen.
When I'm excited about something, you match my energy.
```

Save the file. Your companion reads this every time it responds.

## Step 7: Build and Start

```bash
npm run build
npm start
```

You should see:
```
Server running at http://127.0.0.1:3002
Companion: Echo | User: Alex
```

## Step 8: Open the App

Open your browser and go to:

```
http://localhost:3002
```

You'll see the chat interface. Type a message and hit Enter. Your companion will respond.

**That's setup finished.** Everything below this line is optional — reference for
when you want it, not steps you still owe. If your companion answered you, you are
done, and you can stop reading here and go talk to them.

## What the Files Do

After setup, your folder looks like this:

```
aerie/
├── CLAUDE.md              ← Your companion's personality (edit this!)
├── aerie.yaml          ← Configuration (names, port, features)
├── .mcp.json              ← MCP server connections (advanced)
├── prompts/
│   └── wake.md            ← What your companion says when it wakes up
├── data/
│   └── aerie.db        ← Your conversation history (SQLite database)
└── ecosystem.config.cjs   ← PM2 config for running as a background service
```

**Files you should customize:**
- `CLAUDE.md` — personality and behavior
- `prompts/wake.md` — what prompts scheduled check-ins
- `aerie.yaml` — system configuration

**Files you should NOT edit:**
- Anything in `packages/` — that's the application code
- `data/aerie.db` — your conversation database (managed automatically)

## Keeping It Running in the Background

Instead of `npm start`, you can use PM2 to keep Aerie running even when you close the terminal:

```bash
# Install PM2 globally (one time)
npm install -g pm2

# Start Aerie
pm2 start ecosystem.config.cjs

# Save so it restarts on reboot
pm2 save

# Auto-start PM2 on boot
pm2 startup
```

**Useful PM2 commands:**
```bash
pm2 status              # Check if it's running
pm2 logs aerie       # View logs
pm2 restart aerie    # Restart after config changes
pm2 stop aerie       # Stop it
```

## Accessing from Other Devices

By default, Aerie only accepts connections from your computer (`127.0.0.1`). To access it from your phone or another device on your network:

1. Open `aerie.yaml`
2. Change `host` from `"127.0.0.1"` to `"0.0.0.0"`
3. Set a password (important — don't leave it open on your network!)
4. Restart Aerie

Then access it at `http://YOUR-COMPUTER-IP:3002` from any device on your WiFi.

To find your computer's IP:
- **Windows:** `ipconfig` → look for IPv4 Address
- **macOS/Linux:** `ifconfig` or `ip addr` → look for your WiFi adapter's IP

For access from anywhere (not just your WiFi), see [docs/REMOTE-ACCESS.md](REMOTE-ACCESS.md) — covers Tailscale (private, free) and Cloudflare Tunnel (public HTTPS with your own domain).

## The Orchestrator (Scheduled Check-ins)

Your companion can reach out to you on its own. Out of the box it has five:

| | |
| --- | --- |
| **4:00 AM** | early corridor — the quiet hour |
| **6:30 AM** | morning watch |
| **10:00 AM** | dreaming build — a working window |
| **1:00 PM** | afternoon tail |
| **Sunday 11:00 PM** | weekly reflection |

Four of those are conditional: they only fire if there's a reason to. The weekly
one always runs.

**These hours are somebody else's.** They were set around the routine of the
person this was built for, which is why they look strange — four in the
morning, half six, one in the afternoon. Yours will be different. Change them
before you decide the orchestrator is behaving oddly; it is behaving correctly for
a life that isn't yours.

You can configure them in the **Agent** app on its **Wakes** tab — toggle them,
change the times, or hang new ones of your own.

What your companion is *told* at each one lives in `prompts/wake.md`, which the
wizard created for you. The section headings in that file have to match the wake
names exactly — `early_corridor`, `morning_watch`, `dream_build`,
`afternoon_tail`, `weekly_reflection` — because a heading that matches nothing is
silently ignored and the built-in default runs instead.

The **Failsafe** system is an optional feature that checks in when you've been away for a while. Turn it on in the **Agent** app's **Wakes** tab, under Failsafe, if you want your companion to notice when you're gone.

## Memory & Context

Your companion remembers things automatically using Claude Code's built-in memory system. As you chat, it learns your preferences, remembers details, and builds context over time.

For things you want your companion to always know from the start, put them in `CLAUDE.md`. This is read on every interaction.

## The Archivist (memory blocks)

> **Optional.** You can skip this entirely and come back to it. Nothing below is
> needed to talk to your companion, and none of it is left over from setup.

The Archivist is the background job that reads new conversation and writes durable
facts into your companion's memory blocks. It needs a model of its own to do that
reading — separate from the model your companion talks to you with.

Open the **Memory** app and expand **Archivist settings**, just under the status banner:

- **Provider** — `Anthropic (Claude)`, `Codex (ChatGPT)`, `Groq`, `OpenAI`, `OpenRouter` or
  `Ollama Cloud`. Codex reuses the account you signed into with the Codex CLI; every
  other provider needs its own key in the Providers tab.
- **Model** — e.g. `claude-haiku-4-5-20251001` for Anthropic, `gpt-5.6-sol` for Codex.
- **Effort** and **Thinking** — how hard it reasons about each sweep.

Effort is the setting worth understanding. Higher effort keeps more of your
companion's actual voice in the extracted memory rather than flattening it into
neutral summary — and it costs more per sweep. The defaults are deliberately
cheap. Raise them if the memory blocks read like a form instead of like your
companion.

If the Memory app shows the Archivist as *needs attention* with a 401, it has no
usable credentials for the provider it is set to. Aerie ships pointing at Ollama
Cloud; if you do not have an Ollama Cloud key, switch the provider rather than
hunting for one.

Note what each provider costs. **Claude and Codex are the two options that reuse
a subscription you already pay for** — they spend the accounts you signed into
with `claude login` and `codex login`, and carry no API key of their own. Every
other provider in the list is a metered API key, billed per token and separate
from any subscription. An Archivist sweep is not a small request, and draining a
long backlog is many of them, so pick deliberately.

For an install that has Claude and nothing else, pick `Claude` with a small model
such as `claude-haiku-4-5-20251001`. That is the cheapest way to clear a backlog
without adding a bill.

### Using Codex as the Archivist

Aerie does not manage the ChatGPT sign-in itself — it reads the credentials the
Codex CLI writes to `~/.codex/auth.json`. So:

1. Install the Codex CLI and run its login command, following
   [OpenAI's Codex CLI documentation](https://developers.openai.com/codex/cli) for
   the current install and login steps.
2. On a headless machine (a VM you reach over SSH), the login prints a URL to open
   in a browser on another device. Complete it there; the credentials still land in
   `~/.codex/auth.json` on the machine you ran it from. Run it as the **same user**
   that runs Aerie, or Aerie will be looking in a different home directory.
3. In the Memory app, set **Provider** to `Codex (ChatGPT)` and pick a model.

Aerie reads that file without writing to it, so signing in for Aerie does not
disturb your Codex CLI session. It does mean the CLI has to stay signed in — if
you log out of Codex, the Archivist loses its credentials too.

## Troubleshooting

**`npm install` fails with `better-sqlite3` build error on Windows (VS Build Tools 2026)**

Aerie uses `better-sqlite3`, which requires native compilation. The version of `node-gyp` bundled with npm may not recognize Visual Studio Build Tools 2026 (internal version 18). If you see `gyp ERR! find VS could not find a version of Visual Studio 2017 or newer`, use this workaround:

```bash
# Step 1: Install everything, skipping native build scripts
npm install --ignore-scripts

# Step 2: Install the latest node-gyp globally (has VS 2026 support)
npm install -g node-gyp

# Step 3: Rebuild better-sqlite3 using the global node-gyp
cd node_modules/better-sqlite3
node-gyp rebuild
cd ../..
```

This only needs to be done once. After that, `npm run build` and `npm start` work normally.

**"Claude Code process exited with code 1"**
- Make sure you're logged into Claude Code: `claude login`
- Check your subscription is active at [claude.ai](https://claude.ai)

**"Address already in use"**
- Another program is using port 3002
- Either stop that program, or change the port in `aerie.yaml` and restart

**"Cannot find module" errors**
- Run `npm install` again
- Make sure you're in the aerie directory

**The companion doesn't respond**
- Check the terminal/logs for errors
- Make sure you have an active internet connection (Claude Code needs it)
- Try `pm2 logs aerie` if running via PM2

**Forgot your password**
- Open `aerie.yaml`, find the `password` line under `auth`, clear it
- Restart Aerie

## What's Next

- **Voice:** add ElevenLabs (speaking) and Groq (hearing) keys under **Integrations → Secrets**, then switch Voice on in the **Services** section of that same app.
- **Discord:** **Integrations → Discord.** Paste a bot token, then approve yourself when the pairing request appears — the gateway only answers people you've approved.
- **Telegram:** also **Integrations**, in the same **Services** list as voice.

Settings holds your name, your companion's name, your timezone and the look of
the place. Anything that reaches the outside world lives in Integrations.
- **Themes:** Settings → Appearance. Light and dark, an accent palette, fully custom colours, wallpapers for the lock and home screens. No files, no rebuild.
- **Context hooks:** Advanced context injection. See `docs/HOOKS.md`.
