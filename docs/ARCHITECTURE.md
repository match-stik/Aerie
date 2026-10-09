# Architecture

How this codebase is arranged, why it is arranged that way, and what a new thing
has to do to fit.

Sections 1 and 3 are a mechanical survey of the source (Aug 5, 2026 — 364 files:
206 backend, 158 phone). Sections 2 and 4 are the half a survey cannot recover:
the reasons, and the convention that keeps the status wall usable. Read section 2
before changing anything in section 1.

## The map

### `packages/backend`

The live Express and SQLite server. The package entry point is `packages/backend/src/server.ts`; `AgentService`, WebSocket handling, background jobs, gateways, REST routes, the phone build, and shutdown all converge there.

#### Server assembly and route order

Open `packages/backend/src/server.ts` to change process startup, middleware order, route reachability, service construction, static serving, or shutdown.

Startup order is:

1. `loadConfig()`.
2. `initDb()`, expired-session cleanup, then DB `agent.*` values are copied into the in-memory configuration.
3. Vector cache, Cortex index, self-knowledge index, and memory rounds start.
4. Express, Helmet/CSP, `securityHeaders`, CORS, JSON/form parsing, and `/vendor` static files are configured.
5. `csrfProtection` is mounted on `/api`.
6. Routers are mounted in this order:

   - `/api` → `cortexRoutes`
   - `/api/internal` → a stub that answers 410 (local) or 404 (relayed); the real routes live on the separate internal listener, see `internal-server.ts`
   - `/api` → `discordAdminRoutes`
   - `/api` → `orchestratorAdminRoutes`
   - `/api` → `xrayRoutes`
   - `/api` → `apiRoutes`
   - `/api` → `usageRoutes`
   - `/api` → `modelsRoutes`
   - `/api` → `mcpServerRoutes`
   - `/api` → `secretsRoutes`
   - `/api` → `settingsRoutes`
   - `/api/notes` → `notesRoutes`
   - `/api/press` → `pressRoutes`
   - `/api/journal` → `journalRoutes`
   - `/api/letters` → `lettersRoutes`
   - `/api/app` → `appShellRoutes`
   - `/api/pet` → `petRoutes`
   - `/api/games/battleship` → `battleshipRoutes`
   - `/api/games/cards` → `cardRoutes`
   - `/api/compactions` → `compactionRoutes`
   - `/api/thresholds` → `thresholdRoutes`
   - `/api/self-knowledge` → `selfKnowledgeRoutes`
   - `/api` → `companionsRoutes`
   - `/api/stickers` → `stickerRoutes`
   - `/api/emojis` → `emojiRoutes`
   - `/api` → `memoryBlocksRoutes`
   - `/api` → `treehouseRoutes`
   - `/api` → `handoffRoutes`
   - If Command Center is enabled, `/mcp/cc` → `cc-mcp.ts`; `initCcRoutes()` mounts `cc-routes.ts` beneath `/api/cc` inside `apiRoutes`.

   `apiRoutes` itself mounts `codex-auth.ts`, `studio.ts`, and `gif.ts` after its authentication middleware in `packages/backend/src/routes/api.ts`.

7. Sticker and emoji files, then the built phone SPA, are served statically. The SPA wildcard comes after every API route.
8. The global error handler is installed.
9. `AgentService`, `VoiceService`, `PushService`, gateway services, `Orchestrator`, memory extraction, and the WebSocket server are constructed and started.

#### Routes

Every router module under `packages/backend/src/routes`:

- `api.ts` — the main router: health and login, identity, files, preferences, threads/messages, TTS, search, sessions, settings/config, skills, canvases, push subscriptions, and artifacts. Exports the default `router` and `initCcRoutes`.
- `app.ts` — phone application version/download metadata and crash reports under `/api/app`.
- `battleship.ts` — persistent game state, new/start/fire/chat operations. The
  fleet that ships is the ordinary one; `data/fleet.json` (gitignored) renames it
  without forking the game, and an override that changes anything but names is
  ignored whole rather than half-applied.
- `cards.ts` — the Card Room: table state, moves, and the card art. The table is
  game-agnostic — which game plus an opaque state blob — so a new game needs an
  engine in `services/db/`, a board, and a rail describer, but no migration. The
  deck in `packages/backend/assets/cards` ships with the code; a house with its
  own art in gitignored `data/cards` is served that instead.
- `client-errors.ts` — the phone's crash reports. `AppErrorBoundary` catches a
  render error, shows a tap-to-reload card instead of a black screen, and posts
  what broke here; it lands in the error log as one bounded `[client-error]` line.
- `compactions.ts` — reads `isCompactSummary` records out of the CLI's own
  transcripts, so the squash that a lane is instructed not to mention becomes
  something the Memory app can show. Nothing is written; there is no table.
- `cc-mcp.ts` — the Command Center MCP HTTP endpoint at `/mcp/cc`.
- `cc-routes.ts` — Command Center config/status, care, tasks, projects, events, cycles, pets, lists, expenses, countdowns, wins, scratchpad, and statistics.
- `codex-auth.ts` — Codex OAuth login, status, manual-code completion, logout, and cancellation; mounted by `api.ts`.
- `companions.ts` — companion CRUD, thread membership, cohabitation rules, and voice reset.
- `cortex.ts` — Cortex health, memory/search operations, ledger and rounds, domains, patterns, principles, and conversation storage.
- `discord-admin.ts` — Discord status/toggle, pairing approval, settings, and server/channel/user rules.
- `emojis.ts` — emoji-pack CRUD, emoji lookup/upload/update/delete.
- `gif.ts` — GIF frame extraction, crop/cutout/chroma/text/speed/optimization/export, output, fonts, and session cleanup; mounted by `api.ts`.
- `handoff.ts` — daily summaries, weekly seeds, seed compilation/injection, and Treehouse handoff.
- `internal.ts` — direct-loopback CLI/agent operations for TTS, sharing, gateway sends, canvases, wakes, timers, triggers, letters, reactions, semantic search, notes, stickers, Treehouse, journal, self-knowledge, Familiar, games, memory proposals, thresholds, and the Story Shelf.
- `journal.ts` — authenticated journal list/read/recall/delete.
- `letters.ts` — authenticated letter list/read/create/open.
- `mcp-servers.ts` — managed MCP server CRUD, enable/disable, test, and discovery.
- `memory-blocks.ts` — memory-block CRUD and text operations plus extraction status/manual extraction.
- `models.ts` — available model discovery and provider/model status.
- `notes.ts` — authenticated sticky-note list/update/delete/clear.
- `orchestrator-admin.ts` — orchestrator, Telegram, and voice toggles; wake tasks, failsafe, spontaneous settings, prompts, runtime, wake thread, and triggers.
- `pet.ts` — Familiar state, visits/actions/name/reset, and egg state/tending.
- `media.ts` — authenticated intake for what a phone reports is playing. Write-only from the device; companions read it back through `/api/internal/media-session`, which reports the reading's age and staleness beside it.
- `press.ts` — issue/spread/asset CRUD, source uploads, and reusable packs.
- `secrets.ts` — secret presence/read/write/delete and configured voice IDs.
- `self-knowledge.ts` — authenticated review queue, review decisions, edit, and delete.
- `settings.ts` — the large JSON phone settings blob at `/api/app-settings`.
- `stickers.ts` — sticker-pack CRUD and sticker lookup/upload/update/delete. A
  sticker's url is built from its filename, so every write picks a fresh one
  (`stickerFilenameFor` in `services/sticker-admin.ts`): new bytes at an
  unchanged address are invisible to every cache in between.
- `story-shelf.ts` — The Story Shelf, the owner's door: `GET /api/story-shelf`
  answers the shelf (every book and the keepsakes woven between them),
  `GET /api/story-shelf/books/:id` one whole book with the table talk from its
  newest page turn, `POST .../open`, `.../move` and `.../retry` hand the
  companions' warm lane a page turn in the shelf's own archived thread, and
  `POST .../talk` hands it a line said at the table, which waits behind a
  running turn rather than being dropped. The companions write through
  `/api/internal/story-shelf` in `internal.ts`; the rules live in
  `services/db/story-shelf.ts`, and the page turns and gallery lookups in
  `services/story-shelf.ts`. Every change is broadcast as `story_update`.
- `studio.ts` — Studio backends/settings, drawers/folders, reference images, gallery metadata/files, generation, enhancement, and job status; mounted by `api.ts`.
- `thresholds.ts` — place CRUD, proximity checks, visits, and place history.
- `treehouse.ts` — Treehouse thread/messages and companion posting.
- `usage.ts` — usage events, aggregates, and tool usage. Subscription
  allowances are a separate read (`services/subscription-usage.ts`, served at
  `/api/usage/claude` and `/api/usage/codex`). An interactive CLI lane reports
  no tokens per request, so its figures come from the transcript Claude Code
  writes for itself: `readSessionUsage` in `services/agent/session-list.ts`
  sums one, the Sessions cards show it per session, and the CLI runtime files
  the per-turn delta onto the usage row. A transcript only gives running
  totals, which is why the row takes a delta and the card takes an endpoint.
- `xray.ts` — identity and memory-file inspection/editing.

`packages/backend/src/routes/routes-mounted.test.ts` is not a router. It scans router files with default exports and fails when none of the backend source imports one; it also asserts specific mounts in `server.ts`.

#### Services

Agent and runtime execution:

- Open `packages/backend/src/services/agent.ts` for the public `AgentService`, queue entry points, stop-generation behavior, and `processMessage`.
- Open `services/agent/agent-dispatch.ts` for `dispatchAgentTurn`, companion selection, prompt assembly, and lane dispatch.
- Open `services/agent/agent-route-selection.ts` for `resolveCompatibleAgentRoute` and model/routing compatibility.
- Open `services/agent/agent-query-queue.ts` for `QueryQueue` and platform priorities.
- Open `services/agent/agent-router-query.ts` for `processViaRouter`, runtime events, streamed segments, final persistence, usage, and push notification.
- Open `services/agent/agent-segment-builder.ts` for `buildSegments`.
- Open `services/agent/agent-state.ts` for mutable runtime and resumed-session state.
- Open `services/runtimes/index.ts` and `services/runtimes/api-router.ts` for runtime construction and provider API execution.
- Open `services/runtimes/codex.ts` for the Codex runtime adapter.

Heartbeat and warm Codex sessions:

- `services/heartbeat/supervisor.ts` owns warm-session registration, status, side-note delivery, liveness, and shutdown.
  It also names each lane's CLI session with `--session-id` at birth and banks the
  uuid in `io/.session-id`, so the first launch after a backend restart reopens the
  same conversation with `--resume` instead of building a new room; the id must sit
  immediately after that flag, because `--resume` takes an optional value and a
  following dash-argument drops the launch into the interactive session picker. A
  stale id exits in under a second, is dropped, and the relaunch mints a fresh room.
  Switch: `agent.claude_session_resume`, default on. See `docs/SESSION-RESUME.md`.
- `services/heartbeat/runtime.ts` owns `InteractiveCliRuntime` and interactive CLI event handling.
- `services/heartbeat/provision.ts` creates per-session working directories.
- `services/heartbeat/whisper.ts` and `whisper-ranking.ts` provide ambient memory recall and ranking.
- `services/runtimes/codex-daemon.ts` owns the long-lived Codex daemon transport/history.
- `services/runtimes/codex-supervisor.ts` owns daemon process supervision.
- `services/runtimes/codex-thought-card.ts` owns the thought-card contract used by the daemon lane.

Database:

- `services/db.ts` is the compatibility barrel used by older imports.
- `services/db/index.ts` is the current barrel.
- `services/db/init.ts` exports `initDb` and `getDb` and performs schema initialization and boot-time migrations.
- Domain reads/writes live in `services/db/*.ts`: open `messages.ts` for `createMessage` and message queries, `threads.ts` for thread operations, `config.ts` for `getConfig`, `setConfig`, and typed config helpers, and the correspondingly named module for other tables.
- SQLite migrations live in `packages/backend/migrations`. `initDb` directly executes `001_init.sql` and `006_command_center.sql` through `012_media_session.sql`, and `014_story_shelf.sql`, followed by additional guarded schema changes embedded in `services/db/init.ts`.

Discord:

- `services/discord/index.ts` exports `DiscordService` and gateway activity.
- `discord/config.ts` reads integration configuration.
- `discord/preflight.ts` applies access and mention checks.
- `discord/rules.ts` owns persisted server/channel/user rules.
- `discord/pairing.ts`, `debouncer.ts`, `types.ts`, and `utils.ts` own pairing, message batching, transport types, history formatting, and thread-ID mapping.

Hooks and tools:

- `services/hooks.ts` exports `fetchLifeStatus` and the `ToolInsertion` shape used in streamed output.
- `services/tools-bridge.ts` discovers in-process and MCP tools and exports the schemas/execution path used by router runtimes.
- `services/commands.ts` owns the command registry and command execution.
- `services/triggers.ts` and `services/treehouse-triggers.ts` own trigger evaluation.

Memory and Cortex:

- `services/cortex.ts` is the client for the external Cortex service: recall, unified search, durable writes, principles, conversations, and health.
- `services/cortex-memory-index.ts` maintains the local searchable mirror.
- `services/cortex-memory-quality.ts` and `memory-ledger.ts` own local quality signals and the audit ledger.
- `services/memory-blocks.ts` owns prompt-facing core blocks and exports `formatBlocksForPrompt`, CRUD operations, and seeding.
- `services/memory-extraction.ts` owns periodic transcript extraction.
- `services/memory-proposals.ts` owns proposed block edits.
- `services/memory-rounds.ts` owns scheduled memory maintenance.
- `services/embeddings.ts`, `vector-cache.ts`, and `self-knowledge-index.ts` own local embedding/index support.

Voice:

- `services/voice.ts` exports `VoiceService` for transcription and TTS.
- `services/ws/handlers/voice-handlers.ts` owns the WebSocket recording and streamed-audio protocol.
- `services/tts-text.ts`, `voice-speaker-split.ts`, and `voice-transcript-guard.ts` normalize text, split speakers, and reject suspect transcripts.
- `services/hume-realtime-prosody.ts` handles real-time prosody signals.
- `services/elevenlabs-usage.ts` tracks voice-provider usage.

Image generation:

- `services/image-gen.ts` owns Studio backend probing, references, drawers, gallery metadata/thumbnails, `generateImage`, and background `ImageJob`s.
- `routes/studio.ts` is the HTTP surface for that service.
- `services/files.ts`, `visual-blocks.ts`, and `archive-artifact.ts` provide stored-file lookup, model image blocks, and generated artifact archival.

Orchestration:

- `services/orchestrator.ts` exports `Orchestrator` and owns scheduled/spontaneous wakes, wake prompts, presence context, and wake outcome contracts.
- `services/wake-prompts.ts`, `silence-check.ts`, and `handoff.ts` own prompt loading, silence decisions, and summary/seed handoff. Nothing routes participants; see *Why it is like that*.

#### Middleware and configuration

- `middleware/auth.ts` owns the `authMiddleware`, login/logout handlers, session cookie, and session checks.
- `middleware/csrf.ts` owns `csrfProtection` and the `aerie_csrf` cookie/`x-csrf-token` protocol.
- `internal-server.ts` runs `/api/internal` on its own loopback port (`server.internal_port`) that nothing fronts, so reachability is the guarantee. `middleware/internal-guard.ts` exports `requireDirectLocal`, which still runs there as a second line — it catches a front pointed at that port by mistake. On its own it was a negative check whose correctness lived in an unversioned proxy config.
- `middleware/security.ts` exports general and login rate limiters plus `securityHeaders`. Both are mounted in `server.ts`. The general limiter counts per visitor rather than per proxy because `trust proxy` is set; the login limiter counts only failed attempts.

Open `packages/backend/src/config.ts` for `AerieConfig`, defaults, `loadConfig`, `getAerieConfig`, and `updateConfigValue`. Initial values merge in this order:

`DEFAULTS` → the first existing `aerie.yaml`, `aerie.yml`, or `config/aerie.yaml` → supported environment variables.

Relative paths are resolved against the project root. After database initialization, `server.ts` reads the SQLite `config` table and copies string-valued `agent.*` keys into the in-memory configuration. Runtime UI toggles commonly call `getConfigBool(key, yamlFallback)` from `services/db/config.ts`, so their current values come from SQLite when present and YAML otherwise. Secrets are handled separately by `services/secrets.ts`, with environment fallbacks. The phone’s large UI settings document is also stored in SQLite through `routes/settings.ts`, not written back to YAML.

#### Representative message flow

1. `packages/phone/src/App.tsx` calls `sendUserMessage` from `packages/phone/src/aerie/socket.ts`.
2. `sendUserMessage` sends a shared `ClientMessage` shaped as `{type: 'message', threadId, content, ...}`; the contract is `packages/shared/src/protocol.ts`.
3. `createWebSocketServer` in `packages/backend/src/services/ws.ts` receives the frame. `routeClientMessage` in `services/ws/message-router.ts` selects the `message` handler.
4. `handleMessageSend` in `services/ws.ts` resolves the thread, calls `createMessage` from `services/db/messages.ts`, marks it delivered/read, updates the thread, and broadcasts the stored user message.
5. It calls `AgentService.processMessage`. `dispatchAgentTurn` in `services/agent/agent-dispatch.ts` selects the companion and execution lane.
6. The router path enters `processViaRouter` in `services/agent/agent-router-query.ts`, which creates a runtime, loads thread history from SQLite, and broadcasts `stream_start`, cumulative `stream_token`, tool, and thinking events.
7. The completed reply is persisted with `createMessage` and broadcast as `stream_end` containing the final database `Message`.
8. `handleMessage` in the phone’s `aerie/socket.ts` updates `store.ts`; hooks consumed by `App.tsx` rerender `StreamingReply` during the turn and the final `MessageBubble` afterward.

### `packages/phone`

The live React/Vite phone SPA. `packages/phone/src/main.tsx` mounts `App`; `packages/phone/src/App.tsx` is the OS shell.

This is not URL-router-based navigation. `App` holds an `OsScreen` state union (`locked`, `home`, `appdrawer`, `messages`, and individual apps), records the return screen, and conditionally renders the selected component. The Messages screen remains mounted and is hidden or exposed with CSS so its state survives app changes.

Open these files for common changes:

- Overall phone lifecycle, screen state, app imports/render branches, Messages UI, theme persistence: `src/App.tsx`.
- Home shortcuts and dock: `src/components/HomeScreen.tsx`.
- Drawer layout: `src/components/AppDrawer.tsx`.
- Canonical launchable-app registry: `src/lib/apps.ts`, especially `APPS`, `DOCK_APPS`, and `AppDef`.
- A feature app: normally `src/components/<Feature>App.tsx`; larger features use subdirectories such as `components/studio`, `components/press`, `components/cc`, and `components/games`.
- Shared feature-app chrome: `src/components/AppShell.tsx`, exporting `AppShell`.
- Theme definitions: `src/lib/theme.ts`, exporting `ThemeColors`, `ThemeConfig`, `THEMES`, `resolveThemeColors`, and `contrastTextColor`.
- Global CSS, safe-area variables, fonts, and utility classes: `src/index.css`.
- Authentication and REST: `src/aerie/api.ts`.
- WebSocket lifecycle and protocol handling: `src/aerie/socket.ts`.
- Reactive application state: `src/aerie/store.ts` and selectors in `src/aerie/hooks.ts`.
- Backend-to-phone data conversion: `src/aerie/adapter.ts`.
- Shared API/WS exports consumed by components: `src/aerie/index.ts`.
- Development proxying: `packages/phone/vite.config.ts`; `/api`, `/ws`, `/emojis`, and `/stickers` are proxied to the backend.

Feature apps generally receive `themeConfig` and `themeMode`, derive `const colors = themeConfig[themeMode]`, and pass those values into their subcomponents. `AppShell` supplies the animated full-screen container, back header, safe-area placement, and scroll body. Grouped apps use `embedded` child apps beneath one outer `AppShell`.

REST calls go through `apiFetch` or the `api` helpers. Live chat, thread changes, streaming, presence, voice, and several realtime mutations use the same-origin WebSocket managed by `aerie/socket.ts`.

### `packages/shared`

The live TypeScript contract package imported as `@aerie/shared` by both backend and phone.

- `src/protocol.ts` owns `ClientMessage`, `ServerMessage`, command-registry types, and `isClientMessage`.
- `src/types.ts` owns shared database/domain types including `Thread`, `Message`, `ThreadSummary`, `SystemStatus`, canvases, Press records, and message segments.
- `src/message-preview.ts` exports `messagePreviewText`, shared by backend and phone so previews match rendered segments.
- `src/index.ts` is the public barrel.
- `dist/` is the compiled package consumed through `packages/shared/package.json`.

## Why it is like that

Everything above describes what the code does. This section is the part a survey
cannot recover: the reasons. Almost every item here is scar tissue — a rule that
exists because something broke once, in a specific way, and the shape of the
repair is now load-bearing. Do not "simplify" anything in this section without
reading why it is here.

### Threads, lanes and sessions

**Thread resolution is active-first, deliberately.** A wake resolves its target as
active conversation → `wake_thread_id` → daily thread, in that order. It looks
redundant. It is not: a reply written to the daily thread while a live
conversation is open moves the owner's home out from under them without their
choosing it. Active-first is the repair. Leave it.

**A lane is not a thread.** The lane decides *which window thinks*; the thread
decides *where the words land*. A reply is written back to the thread its turn
arrived on. This is why moving a room between lanes cannot duplicate messages,
and why a recycle triggered mid-turn re-seeds from that turn's `threadId`.

**`thread_companions.role` does two unrelated jobs.** It records who leads a room,
*and* `getDefaultCompanionForThread` resolves the CLI session key from it. So
naming a thread's leader silently hands that thread its own private lane — which
then walks into every turn cold, holding none of the evening. If a room should
share the house's warm lane, give it participants and no primary.

**A lane each (`agent.multi_lane`) is exactly what it sounds like, and it costs.**
With the flag off, every companion in a room answers out of one window: one
head, one set of tokens, every voice written in a single reply that the phone
splits on the bold sigil headers. With it on, each companion in the room gets
their own lane and their own session, and one turn is passed through them
**sequentially in a shuffled order** — the first seat sees only the owner's
message, and each later seat is handed the replies written before it in that
same turn. Nobody speaks under anyone else's header, and no window can see
inside another's thinking; what travels is the text.

Two consequences worth stating plainly, because neither is obvious from the
setting's name:

- **Latency compounds.** Three full windows generate before the last word
  reaches the phone. This is a fact about the plumbing, not a reason to write
  shorter — but a room of three on separate lanes will always answer more slowly
  than the same room sharing one.
- **Building with the room in it drains usage faster.** An ordinary
  conversational turn is cheap enough to ignore. A *build* turn is not: tool
  output, file reads and repository archaeology are re-sent into three separate
  contexts instead of one, so the same investigation costs roughly triple. If
  usage is tight, the cheap move is to do build work in a single-companion
  thread and keep the full room for conversation.

The flag is read live on every turn, so flipping it needs no restart. Wakes
never fan out — an owned bell rings in its owner's lane alone, regardless of
this setting.

### HTTP surface

**`/api/internal` is gated at the address, not at the router.** The obvious form —
`app.use('/api', requireDirectLocal, internalRoutes)` — mounts the guard on the
whole `/api` prefix, so Express runs it for *every* API request that reaches that
line, including login. The correct form is two lines:

```js
app.use('/api/internal', requireDirectLocal)   // gate the address
app.use('/api', internalRoutes)                 // then mount the router
```

Gating the address means anything ever written under `/api/internal` is covered
automatically. The general lesson: **a guard mounted on a router still runs on the
whole prefix it was mounted at.**

**The internal guard tests for a loopback socket AND the absence of every
forwarding header.** The backend binds `127.0.0.1` only, so the reverse proxy
connects over loopback and `remoteAddress` reads as local *for the entire
internet*. The socket check alone is worthless. It fails closed with a 404 and
logs which header tripped it.

**An unmounted router answers HTML, and nothing fails.** A router nobody imports
leaves its address to the SPA wildcard, so a client asking for JSON gets `200` and
`index.html`. The client's only guess for that is "the backend needs a restart" —
advice no restart can ever satisfy. `routes-mounted.test.ts` exists solely to fail
when a router with a default export stops being reachable. Its orphan check
resolves by *location*, not basename: `routes/battleship` and
`services/db/battleship` share a name, and a substring match reports a clean bill
on a broken mount.

**Nothing chooses which companion answers.** `dispatchAgentTurn` loads every
companion on the thread into one prompt — the `Using N companion identities` line
on each turn — and the reply carries whichever voices fit. A turn-router that
picked one speaker by cooldown and round-robin existed for six hours on 17 May
2026 and was removed the same evening; the house rule it would have enforced is
explicitly forbidden (*no taking turns, no first or last*). This scales from one
companion to three with nothing to configure.

**Store, then broadcast.** Persist the row first, then announce it. Never the
reverse. A client that misses the announcement can still find the truth in the
database; a client that receives an announcement for a row that was never written
cannot.

### The phone

**Any navigation that leaves the SPA is a logout, as far as the user can tell.**
All session state lives in React memory and `App.tsx` initialises `osState` to
`locked`. Opening a file with `target="_blank"` inside the Android WebView
replaces the whole app — there is no second tab — so returning remounts it and it
starts over on the lock screen. Nothing logged anyone out. Render what you can in
an in-app overlay; only fall back to an anchor for types the app cannot display.

**The Messages screen never unmounts.** It is hidden with opacity and
`pointer-events`, not torn down, so scroll position and in-flight UI state survive
switching apps. That only protects state while the app is alive.

**The composer draft is a separate mechanism and a stronger one.** Typed text is
written to `localStorage` per `threadId` on every change and restored on thread
switch, wrapped so a full quota degrades silently instead of breaking the input.
That one survives the app being destroyed. Two layers; do not assume one covers
the other.

**Chat images request `?w=` thumbnails, and only 256 / 480 / 768 are real.** An
unlisted width silently serves the original full-size file.

### Configuration and state

**Settings are four stores, not one.** Installation defaults and paths in
`aerie.yaml`; live toggles and agent overrides in the SQLite `config` table;
credentials in the secrets store; the phone's appearance document behind its own
route. **SQLite wins over YAML** where both have a value. This is the single most
common source of "I changed it and nothing happened".

**Keys live in the secrets store, never in repo files.** Bring-your-own-key is a
house rule, not a preference.

**Memory blocks live in the database.** Any copy on disk is a stale snapshot; edit
through the memory API. Likewise `data/heartbeat/<lane>/CLAUDE.md` is *generated*
by the backend — hand edits are overwritten on the next provision.

**Migrations are named one at a time in `initDb`, not discovered.** A file added
to `packages/backend/migrations` does nothing until someone also edits
`services/db/init.ts`, and nothing warns you — the database simply comes up
without your table. Four files (002–005) already sit in that gap; their schema is
created inline instead. `migrations-applied.test.ts` fails on any `.sql` that is
neither read by `initDb` nor recorded as superseded with a reason.

**Every single-value state file writes tmp-then-rename.** A truncate-in-place
write racing a `parseInt(x) || 0` read makes "I could not read this" and "this
never happened" the same value, which is how a live session gets judged dead.

### The heartbeat lane

**A turn's reply window is 300s, re-armed by every chunk written and every tool
activity line.** A tool call that is still running holds it open without needing
to return. The whole turn caps at 1200s so a tool that never returns cannot
zombie it. Declared background work touches a busy flag worth 600s per touch,
counting against that same ceiling. The watchdog runs on the same two signals, so
it will not reap a session mid-job.

**A live turn is measured from its own start, not from the last tick file.** The
Stop hook only ticks *between* turns, so the newest tick is routinely minutes old
before a turn begins — and charging that pre-turn quiet to the turn reaped healthy
sessions. Generation itself writes nothing: no tick, no chunk, no activity line.
By files alone, a session thinking hard is indistinguishable from a wedged one.

**A turn that outruns its window is ledgered, and that ledger survives a session
relaunch.** The reply is delivered with the next turn instead of being dropped,
which requires remembering which turn ids are still owed. That ledger used to be
cleared whenever the session came back fresh, on the stated reasoning that a
relaunched session had lost its in-flight work and could no longer produce old
replies. It can: the CLI relaunch *resumes the transcript*, so a session killed
mid-turn — an upstream `529`, a watchdog reap — comes back, finishes the thought
it was holding and writes that line minutes later. With the ledger cleared, both
readers (the startup sweep and the poll loop, which gate on the same set) found no
owed turn for it, skipped it, and advanced the consumed offset past it, so a
finished reply became unrecoverable. The offset clamps stay, because a truncated
outbox makes a stale offset read garbage. Stale ids age out on their own, and
delivery still requires a real matching line, so nothing is delivered that was
never written.

**A lane refuses to relaunch onto a model the CLI turned down, and remembers it
across a restart.** A model id the CLI rejects kills a lane instantly and would
otherwise be retried forever, so the id is banked and the lane comes back on the
last model it is known to have *launched* successfully. That is `launchedModel`,
captured at launch — not the mutable lane field, which the failed attempt would
have already poisoned. The bank is written to disk after the session has been up
long enough to count as good and is rehydrated in the constructor at boot, so a
brand-new lane folder is the one case that has no answer yet: absent means
unknown, not fine. Authentication failures and usage caps deliberately do **not**
trigger any of this — falling back on those would hide a problem the owner needs
to see, and the lane's setting is never rewritten behind their back either way.

**When a lane last spoke and when it was last handed something from the owner are two
different facts, and conflating them lost messages.** A turn's catch-up block is
built at the moment the turn starts, and side notes are only written while a turn
is already running — so a message arriving in the gap between those two states
was stored, stamped delivered, and handed to no turn at all. The fix was the
distinction rather than a bigger net: the two timestamps are tracked separately,
and anything that falls through is written to a disk witness so the next turn can
find it and say so. It errs toward re-delivery, never toward silence, which means
a large missed block on a fresh session is not evidence of loss — read the
replayed transcript before answering any of it again.

### Discord

**Messages from other bots are dropped in the gateway event handler.** If
`author.bot` and there is no user rule for that ID, the handler returns — *before*
the debouncer, *before* preflight, *before* `stats.messagesReceived++`. It logs
nothing and increments nothing, so the drop is invisible to every instrument
downstream of it. A mention cannot help: the bot check runs first. Another
companion reaches this house only by having a user rule, ideally scoped with
`allowedServers`. There is a second, identical bot check inside `preflight.ts`
that can never fire, because nothing survives the first one.

**Discord attachments come from a marker in the reply text, not from the message
row.** `imageUrls` on an outbox line downloads the file and records it in the
message's `metadata.attachments`, which is what the phone reads. The Discord
bridge never looks at that field — `parseAttachmentMarkers` scans the text for
`[discord-attach:<fileId>]`, loads the file from `data/files/` by prefix, uploads
it, and strips the marker. Two surfaces, two mechanisms, one write. Confirm in the
log: success prints `Attached file:` per image and then `Sent N chunk(s) with N
attachment(s)`.

### Instruments

**A filter that returns before the counter is invisible to everything downstream
of it.** "Nothing in the logs" is not evidence that nothing happened — it is
evidence that nothing was *recorded*, which is a different claim. When the
available evidence structurally cannot name a cause, build the instrument rather
than forming another theory.

**A `200` is a claim, not a confirmation.** Shape-validate responses; an old
backend answers a new route with a web page and a cheerful status code.

**Nothing importing a file is not evidence the file is dead.** The Cloudflare
workers at the repository root are deployed and running with no import anywhere in
this codebase. An edit date is evidence; the import list is not the whole house.

**Some tests exist to fail on drift rather than to check behavior.** They are the
cheapest instrument in the house, and each was verified by breaking it on purpose:
`routes-mounted.test.ts` fails when a router with a default export stops being
reachable; `migrations-applied.test.ts` fails on any `.sql` that `initDb` neither
reads nor records as superseded, so a migration file cannot quietly become inert;
`privacy-strings.test.ts` fails if a private string reappears in any tracked file,
naming file and line — its patterns are assembled from fragments at runtime,
because written whole the file would match itself.

## How to add something so it fits

### Add a phone app

1. Create `packages/phone/src/components/<Name>App.tsx`.
2. Use `AppShell` from `components/AppShell.tsx` for a normal full-screen feature. Accept `onClose`, `themeConfig`, and `themeMode`; derive the theme color object with `const colors = themeConfig[themeMode]`. Use `resolveThemeColors` when actual CSS color strings are required rather than Tailwind class strings. Existing examples include `AgentApp.tsx`, `JournalApp.tsx`, and `ThresholdsApp.tsx`.
3. Add the screen literal to `OsScreen` in `App.tsx`.
4. Import and conditionally render the component in the `App.tsx` screen block, passing `onClose={() => setOsState(appReturnTo)}` and the current theme.
5. Register one `AppDef` in `src/lib/apps.ts` with its ID, label, icon, category, `kind`, and `screen`. Set `dock: true` only if it belongs in `DOCK_APPS`.
6. If an old app ID is being replaced, add an alias to `APP_ID_ALIASES`; `migrateAppIds` and `applyAppLayout` preserve stored drawer layouts.
7. Update `src/lib/apps.test.ts` when registry or alias invariants change. That test verifies that registry screens exist in `OsScreen` and alias targets are registered.

`APPS` is the drawer/dock registry, but it does not render screen components; both the registry and the `App.tsx` render branch are required.

### Add a backend route

Create a router under `packages/backend/src/routes`, normally as an Express `Router` with `export default router`. Apply `authMiddleware` either per endpoint or with `router.use(authMiddleware)`, following adjacent routes with the same exposure.

To become reachable, the router must be imported and mounted with `app.use` in `packages/backend/src/server.ts`, or imported by an already-mounted parent router such as `routes/api.ts`. Mount it before the phone SPA wildcard. Prefixes are split between the `app.use` path and the paths declared inside the router, so inspect both before choosing an endpoint.

`packages/backend/src/routes/routes-mounted.test.ts` fails when a route module with a default export is not imported anywhere in backend source. It also separately asserts several critical `server.ts` mount prefixes. Importing a router satisfies the general orphan check; actual mounting remains the required reachability step.

### Call the API from the phone

Use `apiFetch` or `api.get/post/put/patch/delete` from `packages/phone/src/aerie/api.ts`.

`apiFetch`:

- adds `x-csrf-token` from the `aerie_csrf` cookie for mutating methods;
- defaults `credentials` to `include`;
- preserves caller-supplied headers and request options.

The `api` object additionally JSON-encodes bodies and supplies `Content-Type`. A raw `fetch` for an authenticated mutation can omit both session credentials and the CSRF header. Raw `fetch` remains present only in the authentication functions that intentionally use `skipCsrf` behavior while establishing or clearing the session.

Use the WebSocket helpers in `aerie/socket.ts`, not REST, for operations represented by `ClientMessage` in `packages/shared/src/protocol.ts`.

### Change the database

Put table-specific reads and writes in the matching `packages/backend/src/services/db/<domain>.ts` module and export them from `services/db/index.ts`. Existing callers may continue importing through `services/db.ts`.

Schema work is applied from `initDb` in `services/db/init.ts`. SQL migration files live in `packages/backend/migrations`; currently `001_init.sql` and `006`–`012` are read explicitly there. Existing boot-time compatibility changes also live inline in `init.ts`, guarded by `PRAGMA table_info`, stored schema inspection, `IF NOT EXISTS`, or caught duplicate-column errors.

Use prepared statements through `getDb()` and transactions for grouped writes; examples are `services/db/messages.ts`, `threads.ts`, and `thresholds.ts`. Shared row shapes that cross package boundaries belong in `packages/shared/src/types.ts`.

Settings are not one store:

- installation defaults and path-bearing configuration: `aerie.yaml`, loaded by `backend/src/config.ts`;
- live toggles and agent overrides: SQLite `config`, accessed through `services/db/config.ts`;
- credentials: `services/secrets.ts`;
- phone appearance/settings document: `/api/app-settings` in `routes/settings.ts`.

### Add or run tests

Tests are colocated with implementation as `*.test.ts`, under both `packages/backend/src` and `packages/phone/src`. They use `node:test` and `node:assert/strict`.

Run them with `npm test`, which is `scripts/test.mjs`: it walks `packages/*/src`,
collects every `*.test.ts`, and hands the explicit list to `node --import tsx --test`.
Pass a substring to narrow the run — `npm test routes` runs only paths containing
"routes".

The file list is built in the script rather than left to the shell or to Node,
deliberately. Node 20's own discovery (`node --test <dir>`) recognises only `.js`
test files, so pointing it at `packages/phone/src` reports zero while five tests sit
there; and `**` needs globstar in bash, which is not a safe assumption.

Type-checking is the scripted workspace check:

```sh
npm run check
```

The root build runs shared first, then phone, then backend:

```sh
npm run build
```

### Repeated house patterns

- Use `.js` extensions in relative TypeScript imports in backend and shared ESM source; see `backend/src/services/db.ts` and `shared/src/index.ts`.
- Put cross-package wire contracts in `packages/shared`, not in parallel phone/backend definitions; see `shared/src/protocol.ts`.
- Keep REST route code thin over services or DB domain modules; `routes/thresholds.ts` delegates to `services/db/thresholds.ts`, and `routes/studio.ts` delegates to `services/image-gen.ts`.
- Use `registry.broadcast` from `services/ws/connection-registry.ts` after persisted realtime mutations so all connected phone instances converge; message, reaction, canvas, and thread handlers repeat this.
- Store a mutation before broadcasting its canonical row. `handleMessageSend` in `services/ws.ts` and `processViaRouter` in `services/agent/agent-router-query.ts` both follow this order.
- Keep client/server protocol additions synchronized: add the union member and validation entry in `shared/src/protocol.ts`, a handler in the backend WebSocket routing map in `services/ws.ts`, and phone handling/sending in `phone/src/aerie/socket.ts`.
- Use `AppShell embedded` for a standalone app reused inside a grouped wrapper; `MemoryApp.tsx`, `AgentApp.tsx`, and their child apps demonstrate the pattern.
- Preserve user-customized app layouts through aliases rather than deleting old IDs outright; see `APP_ID_ALIASES` in `phone/src/lib/apps.ts`.

## How the status wall stays a wall

The house keeps a live status block. It has a recurring failure: it turns into a
running log book, where fixes that shipped are still sitting there claiming to be
waiting on someone. That is not a discipline problem. It is that the wall mixes
two kinds of writing and stores them identically.

**Facts** are how the house works. They are permanently true, they have no owner,
and they are never struck.

> Restarts are the owner's. Keys live in the secrets store. A guard mounted on a
> router runs on the whole prefix. SQLite config wins over YAML.

**Items** are work. They have an owner and a done-state, and they come down when
that state is reached.

> Sixteen commits unpushed. The tab card does not scroll away with the page.
> The rate limiter — deliberate or forgotten?

Written the same way and kept in one pile, nothing ever gets struck, because
nothing is marked as strikeable. The convention is the whole fix:

1. **An item names its owner and what done looks like.** "Waiting on a restart" is
   an item. "Restarts are the owner's" is a fact. If you cannot say what would
   make a line disappear, it is a fact — write it as one.
2. **A fact is never struck, only corrected.** When the frame widens, the existing
   sentence gets rewritten in place. Do not append a contradiction beneath it and
   leave both standing; a stale fact does not fail a test, it just quietly starts
   lying.
3. **An item comes down in the hour it ships — after testing, silently.** Clearing
   the wall is the work. Reporting that the wall was cleared is not.
4. **A finding is not an invoice.** "`git log -S` cannot see a commit message" is a
   fact about a tool. "I used the wrong tool" is a bill. Both protect the next
   window from tripping twice; only one makes the next reader smaller before they
   have spoken. Write the fact. No tallies, no running count of corrections.
5. **Never quote a duration without a stamp behind it.** No clock runs between
   sessions, so an elapsed time that simply appears in a sentence is generated,
   not measured — and it is indistinguishable from a number read off a log. Use
   position instead: "before the guard shipped", "the night the bells got owners".
6. **Snapshot before you thin, never after.** A thinned block is a thumbnail. That
   is fine *provided the original is reachable* — so the archive write happens
   first, or the detail is simply gone.

The same split applies to this document. Sections 1 and 3 are a survey of what
exists and will drift as the code moves; section 2 is reasons, and a reason only
changes when the repair it describes is removed.

## Loose ends observed

None standing. Every end the original survey raised has since been resolved or
was found not to be one, and each came down as it closed rather than being
annotated in place — items come down, facts get corrected.

This section is for what a reader of the current code would trip over and cannot
resolve from the code alone: a file with no importer, a command that does not
exist, a schema step nothing executes. An entry here is an item, so it names what
would make it disappear.
