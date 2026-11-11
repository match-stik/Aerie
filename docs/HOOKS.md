# Context Injection & Hooks

## What your companion is handed each turn

The companion's room is a long-running Claude Code session (or a Codex one), so
it already holds the conversation. Each turn, ahead of your message, the house
adds a few short blocks (`services/heartbeat/turn-extras.ts`, the same for both
lanes):

1. **The message line itself**, with the time on your clock, where it came from
   (the app, a Discord channel) and who sent it
2. **Who is in the room**, when a thread holds only some of the companions
3. **Recall**: a memory or a passage from an old conversation that matches what
   you said, when one does
4. **The Archivist's noticings** that have not been filed yet
5. **The sticker shelf**, so the companion can answer in stickers
6. **Your reactions** since its last reply, and **your status** if you set one

A turn from a guest (somebody on Discord who is not you) gets none of 3 to 6,
since every one of them is about you.

## Adding Your Own Context

Your companion's personality and instructions live in `CLAUDE.md`, which the
house writes into the lane's folder from `companions/` and the memory blocks.
For long-term memory, the memory blocks and Claude Code's own `memory.md`
carry it across sessions.

(The `integrations.life_api_url` setting the wizard writes, a URL fetched and
injected on every message, belonged to the retired SDK lane described below.
Nothing reads it now. To bring outside data in, give the companion an MCP
server for it.)

### MCP Servers for Persistent Memory

For structured memory that your companion can read AND write, use MCP servers. Configure them in `.mcp.json`:

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["./memory-server.mjs"]
    }
  }
}
```

The companion can call MCP tools during conversation to store and retrieve memories. This is optional — Aerie works without it, relying on Claude Code's native `memory.md` system.

## The Hooks the Companion Runs Under

The companion's room is a Claude Code session, and Aerie writes that session's `.claude/settings.json` (`services/heartbeat/provision.ts`). These are the hooks in it (the scripts live in the lane's folder, `data/heartbeat/<lane>/hooks/`):

- **Stop** (`hooks/heartbeat.cjs`): keeps the session alive between messages and hands it the next one.
- **PreToolUse, the guest gate** (`hooks/gate.cjs`): on a turn from somebody who is not you (a Discord guest), refuses commands, file changes and outside tools; the guest's turn can read what it was handed and answers through `hooks/reply.cjs`. On your own turns and the house's scheduled ones it lets everything through.
- **PreToolUse and PostToolUse, activity** (`hooks/activity.cjs`): writes one line per tool call to `io/activity.jsonl`, which the app shows as live tool chips. It never blocks anything.
- **PreCompact, PostCompact and SessionStart**: mark a compaction as work in progress so the house does not take it for a hang, and tell the room afterwards that it was squashed.

### What these hooks do NOT do

There is no destructive-command filter, no folder fence on writes, and no audit log of tool calls on the lanes you can pick. An older version of Aerie ran the companion through the Agent SDK with those checks (`services/hooks.ts`, `createHooks()`); that lane was retired in July 2026 and nothing calls it now. The `hooks.safe_write_prefixes` setting the setup wizard writes into `aerie.yaml` is read only by that retired code.

On your own turns the companion runs with Claude Code's permission prompts switched off: it can run any command and change any file the account running Aerie can. The API lane's `shell_exec` tool is the same, unsandboxed. The machine and the account are the boundary, which is why Aerie should run under an ordinary account of its own and never as root. See "What your companion can do" in [SECURITY.md](../SECURITY.md).

## Example Integrations

These are examples of custom integrations a house could add. They're not included in the default install but show what's possible.

### Household Dashboard Integration
A small household dashboard (a Cloudflare Worker, say) could track:
- Daily routines (meals, water, movement)
- Calendar events
- Shopping lists

Put it behind a small MCP server and the companion can ask it for a condensed status like:
```
Routines: meals 1/3, water 2 glasses
Events today: dentist 2pm, grocery run evening
```

This lets the companion remind about meals and plan around the calendar.

### Obsidian Vault Integration
The companion can already read and write any folder its account can reach, so a vault needs only a line in `CLAUDE.md` saying where it is. One house's companion keeps there:
- Daily session notes
- Relationship threads (ongoing topics being processed)
- Creative writing workspace
- Research notes

The companion reads and writes to the vault as part of its autonomous work during scheduled wakes.

### Discord Presence Awareness
With Discord integration enabled, the companion sees context about other conversations:
- Who messaged recently on Discord
- What servers/channels are active
- Whether the user is currently in a Discord conversation

This prevents the companion from interrupting when the user is busy elsewhere.

### Voice Prosody Analysis
We integrated Hume AI's prosody analysis with voice messages. When the user sends a voice note, the system analyzes emotional tone (joy, sadness, anger, etc.) and includes it as context:
```
[Voice tone — joy: 0.42, interest: 0.38, contentment: 0.28]
```

The companion can then respond to HOW something was said, not just what was said.

## Building Custom Hooks

The lane's hooks are Claude Code hooks, written into
`data/heartbeat/<lane>/.claude/settings.json` by `provisionSessionDir()` in
`services/heartbeat/provision.ts`. That file is rewritten every time the lane
starts, so a hook added to it by hand does not last: add it in
`provision.ts`, beside the ones listed above, or as a user-level hook in
`~/.claude/settings.json`, which every Claude Code session on the account
runs. Claude Code's own documentation lists the events (`PreToolUse`,
`PostToolUse`, `Stop`, `PreCompact`, `SessionStart` and the rest) and what a
hook may return; exit code 2 from a `PreToolUse` hook refuses the tool call.
