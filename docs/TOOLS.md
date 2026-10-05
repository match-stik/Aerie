# Built-in Tools

Aerie ships a set of tools your agent can use via Bash during conversations. These extend beyond Claude Code's native tools (Read, Write, Edit, Bash, Grep, Glob) with conversation-aware capabilities.

Tools are accessed through `tools/sc.mjs` — a CLI that wraps Aerie's internal API. The agent's orientation context includes the full command reference on every message, so it knows what's available.

All commands auto-detect the current thread from `.aerie-thread` (written per-query). Port is read from `aerie.yaml`.

---

## Chat Tools

### Share Files
Share a file from disk into the current chat thread. Appears as a message with the file attached.

```bash
sc share /absolute/path/to/file
```

### Canvas
Create or update collaborative documents alongside chat.

```bash
sc canvas create "Title" /path/to/file.md markdown
sc canvas create-inline "Title" "short text content" text
sc canvas update CANVAS_ID /path/to/file
```

Content types: `markdown`, `code`, `text`, `html`

### Reactions
React to messages with emoji. Uses offset-based targeting — no message IDs needed.

```bash
sc react last "❤️"              # React to last message
sc react last-2 "🔥"            # React to 2nd-to-last
sc react last "❤️" remove       # Remove a reaction
```

### Voice
Send a text-to-speech message using ElevenLabs. Supports tone tags for expressive delivery.

```bash
sc voice "[whispers] hey [sighs] I missed you"
```

Tone tags: `[whispers]` `[softly]` `[excited]` `[laughs]` `[sighs]` `[playfully]` `[calm]` `[gasps]` `[dramatically]` `[deadpan]` `[cheerfully]` `[nervous]` `[mischievously]`

Requires `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` in `.env`.

---

## Semantic Search

Search conversation history by meaning using local ML embeddings. No external API calls — runs entirely on your machine.

```bash
sc search "what did we talk about last week"
sc search "that architecture discussion" --thread THREAD_ID
sc search "query" --limit 5
```

Returns matched messages with surrounding conversation context (2 messages before and after each match).

### Backfill

New messages are embedded automatically. To index existing history:

```bash
sc backfill start                  # Background indexing (50/batch, 5s interval)
sc backfill start 100 3000         # Custom batch size and interval (ms)
sc backfill status                 # Check progress
sc backfill stop                   # Halt background indexing
```

See [semantic-search.md](semantic-search.md) for setup and technical details.

---

## Scheduling

### Orchestrator
Control the autonomous wake schedule. The orchestrator triggers your agent at configured times with specific prompts.

```bash
sc schedule status                 # Show all schedules
sc schedule enable                 # Enable orchestrator
sc schedule disable                # Disable orchestrator
sc schedule reschedule morning_anchor "0 8 * * *"   # Reschedule a wake
```

Wake types depend on your `aerie.yaml` orchestrator config and `wake-prompts.md`.

### Timers
One-shot scheduled reminders. Fire once at a specific time.

```bash
sc timer create "label" "context" "2026-03-21T15:00:00Z"
sc timer create "label" "context" "fireAt" --prompt "wake text"
sc timer list
sc timer cancel TIMER_ID
```

`fireAt` is ISO 8601 UTC. Fires within ~60 seconds of the target time. The optional `--prompt` sets the text used to wake the agent when the timer fires.

### Impulses
One-shot, condition-based triggers. Fire once when all conditions are met, then auto-complete.

```bash
sc impulse create "label" --condition presence_state:active --prompt "tell them X"
sc impulse create "label" --condition time_window:18:00 --condition routine_missing:meal:14 --prompt "remind about food"
sc impulse create "label" --condition agent_free --prompt "journal entry"
sc impulse list
sc impulse cancel TRIGGER_ID
```

### Watchers
Recurring, cooldown-protected triggers. Fire repeatedly whenever conditions are met, with a minimum interval between firings.

```bash
sc watch create "label" --condition presence_transition:offline:active --prompt "Good morning" --cooldown 480
sc watch create "label" --condition presence_state:active --condition time_window:13:00 --prompt "check in" --cooldown 120
sc watch list
sc watch cancel TRIGGER_ID
```

`--cooldown` is in minutes (default 120). Prevents the watcher from firing again too soon.

### Condition Reference

All conditions are AND-joined — every condition must be true for the trigger to fire.

| Condition | Syntax | Description |
|-----------|--------|-------------|
| Presence state | `presence_state:active` | User is currently in the given state |
| Presence transition | `presence_transition:offline:active` | User just transitioned between states |
| Agent free | `agent_free` | No query currently running |
| Time window | `time_window:18:00` | Current time is after HH:MM |
| Time window (range) | `time_window:09:00:17:00` | Current time is between start and end |
| Routine missing | `routine_missing:meal:14` | Named routine hasn't been logged since hour N |

---

## Telegram Tools

Available when the user is on Telegram. These appear in the agent's context automatically.

```bash
sc tg photo /path/to/image.png "caption"
sc tg photo --url "https://..." "caption"
sc tg doc /path/to/file.pdf "caption"
sc tg gif "search query" "optional caption"     # Searches GIPHY
sc tg react last "❤️"
sc tg react last-2 "🔥"
sc tg voice "text with [tone tags]"
sc tg text "proactive message"
```

---

## Internal API

All tools wrap localhost-only REST endpoints. They require no authentication,
and what makes that safe is **which port they answer on**: `/api/internal` is
served by a second HTTP listener bound to `127.0.0.1` on `server.internal_port`
(default `3012`), and nothing is ever fronted at it. Being able to open that
socket is the proof that a caller is on the box.

Do not point a reverse proxy, tunnel or port-forward at `internal_port`. The
public port only holds a stub there: it answers `410` with the correct port to a
caller that is genuinely local, and `404` to anything relayed.

| Endpoint | Purpose |
|----------|---------|
| `POST /api/internal/share` | Share files into chat |
| `POST /api/internal/canvas` | Create/update canvases |
| `POST /api/internal/tts` | Text-to-speech |
| `POST /api/internal/react` | Message reactions |
| `POST /api/internal/orchestrator` | Schedule management |
| `POST /api/internal/timer` | Timer CRUD |
| `POST /api/internal/trigger` | Impulse/watcher CRUD |
| `POST /api/internal/telegram-send` | Send to Telegram |
| `POST /api/internal/search-semantic` | Semantic search |
| `POST /api/internal/embed-backfill` | Embedding backfill |

The `sc` CLI is the recommended interface. Direct API access is available for custom integrations.
