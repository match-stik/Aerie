# Putting Your Companion on Discord

You make **one bot**. Two separate things then use it, and they do opposite
jobs. You can run either on its own.

**The gateway** is your companion being *spoken to*. It connects to Discord,
watches for messages meant for the bot, brings them into the house and carries
the reply back to the same conversation. It is entirely reactive — it never
starts anything.

**The worker** is your companion *going out*. It's a small Cloudflare Worker
that gives the agent actual Discord tools: read a channel, search back through
it, post somewhere nobody pinged, add a reaction, send a picture or a voice
note. If you want to be able to say *go and look at what's happening in the
server*, this is the half that makes that possible.

Set up the gateway first. It's five minutes and no hosting.

---

## Part 1 — The gateway

### 1. Make a bot

Go to [discord.com/developers/applications](https://discord.com/developers/applications),
**New Application**, name it whatever your companion is called. Open the **Bot**
tab and copy the token — you only get to see it once, so paste it somewhere
before you close the page.

Under **Privileged Gateway Intents** on that same page, turn on **Message
Content Intent**. Without it the bot receives messages with the text stripped
out and will look broken in a way that is hard to diagnose.

### 2. Invite it

**OAuth2 → URL Generator.** Tick `bot` under scopes, then under permissions
tick **View Channels**, **Read Message History**, **Send Messages**, **Embed
Links** and **Attach Files** — and *Add Reactions* if you want your companion
able to react. Open the URL it builds and pick your server.

View Channels is the one people leave off. Without it the bot joins, appears
online, and cannot see a thing.

### 3. Tell Aerie

In the phone: **Integrations → Secrets → Platforms → Discord bot token.** Paste,
save. It takes effect immediately.

Then **Integrations → Discord** and switch **Gateway active** on. The Connection
panel should go green and say *Online as <your bot>*, with counts for guilds and
messages received.

### 4. Approve yourself

The gateway does not answer strangers. Message the bot, and your request shows
up under **Pending Pairing Requests** on that same screen. Approve it and you
move to **Approved Users**.

This is worth understanding rather than working around: the bot is deliberately
deaf to everyone you haven't approved.

### 5. Get your IDs

This is where you need them. In **Discord** — under **User Settings → Advanced →
Developer Mode** — switch it on. Now right-click any server or channel and **Copy
ID**.

That is Discord's own setting. ChatGPT has a thing with the same name, in its app
settings, which does something completely different and has nothing to do with
any of this. Two products, one phrase; only Discord's matters here.

You don't need them to *talk* to your companion — mention the bot anywhere it
has access and it answers. You need them to say anything more specific than
that, and the next step is where that happens.

### 6. Decide how it behaves per server — Rules

The **Rules** panel is per server, keyed by **Server ID**. For each one you can
set:

- a **name** for the server and your **relationship** to it, so your companion
  knows whether it's standing in your group chat or someone else's workplace
- a **trust level** — how much it is willing to do there
- **context** — Full, Standard or Limited, meaning how much of your history it
  brings into a reply
- **ignored channels**, by ID — rooms it should never listen in even when
  mentioned
- **ignored users**, by ID
- whether **public responses** are allowed there at all

A message has to survive the whole list before your companion ever sees it: the
server allowed, the channel not ignored, the user not ignored, and in a channel
set to mention-only, an actual mention.

If your companion is silent somewhere, that is the order to check it in.

---

## Part 2 — The worker (optional)

This is the half that lets your companion act on Discord instead of only
replying. Skip it if you only want conversation.

### 1. Deploy it

`shared/discord-worker-v4.0.js` in this repo is the whole thing — one file, no
build step. Paste it into a new Cloudflare Worker in the dashboard and deploy,
or from a checkout:

```bash
npx wrangler deploy
```

### 2. Give it secrets

| Secret | Needed for |
| --- | --- |
| `DISCORD_BOT_TOKEN` | everything — the same token from Part 1 |
| `ELEVENLABS_API_KEY` | voice notes only |
| `VOICE_ID_<NAME>` | one per companion who should have a voice |

Set them with the dashboard, or:

```bash
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put ELEVENLABS_API_KEY
npx wrangler secret put VOICE_ID_ECHO
```

The voice secrets are read by name. `VOICE_ID_ECHO` makes `voice: "echo"` work,
and adding another companion means adding another secret — there is nothing to
edit in the file.

### 3. Point Aerie at it

**Integrations → MCP → Managed servers → Add.** Give it a name and the worker's
URL **with `/mcp` on the end**:

```
https://your-worker.your-subdomain.workers.dev/mcp
```

The suffix matters and it is the easiest thing in this document to get wrong.
The worker answers on two paths: `/mcp` speaks the protocol Claude and Aerie
use, and `/sse` speaks the server-sent-events one ChatGPT wants when you add an
MCP app to it. Same worker, same tools, different door.

It should report its tool count within a few seconds. If it says zero, the
token is wrong or missing.

That is the whole setup. There is nothing to configure per server or per
channel, and no list of IDs to collect — your companion finds those itself with
`discord_list_servers` and `discord_get_server_info`, which return the names and
the IDs together. You can say *the general channel in the writing server* and it
will work out the rest.

(Worth being clear, because the two halves differ here: the **gateway** needs
IDs from you, for the rules above. The **worker** does not — it discovers them.
Wiring this worker to ChatGPT instead is the other case that needs you to supply
them by hand.)

### 4. Lock it (optional)

Out of the box the worker answers anyone who has its address, and whoever has
it can post, edit and delete as your bot and spend your ElevenLabs credit on
voice notes. If you would rather it only answered you, give it one more secret:

```bash
npx wrangler secret put MCP_SECRET
```

Then give the same value to whatever connects to it. In Aerie it goes in the
managed server's **API key** field, which sends it as a bearer token. An app
that only takes an address, such as a ChatGPT MCP app on `/sse`, can carry it
on the end of the URL instead:

```
https://your-worker.your-subdomain.workers.dev/sse?key=YOUR_SECRET
```

The header is the better of the two where you have the choice, since an
address tends to get pasted and logged. With no `MCP_SECRET` set nothing
changes. With it set, a call without the key is turned away.

### What it gives your companion

Reading: list servers, server info, read messages, search messages, list emojis
and stickers. Acting: send, edit and delete messages, add reactions, show the
typing indicator, send images, stickers and voice notes.

---

## When it goes quiet

- **Bot is offline.** Gateway toggle off, or a bad token. Check the Connection
  panel first — it says which.
- **Bot is online and ignores you.** You are not in Approved Users, or a rule is
  filtering you. Check in the order in Part 1 step 5.
- **Messages arrive empty.** Message Content Intent is off.
- **Worker returns zero tools.** `DISCORD_BOT_TOKEN` is not set on the worker.
  It is a separate secret from the one you gave Aerie, even though it is the
  same value.
- **Worker turns everything away after you locked it.** The key is missing or
  differs from `MCP_SECRET`. In Aerie, check the server's API key field; on an
  address, check what follows `?key=`.
- **Voice tool says a voice is not configured.** There is no `VOICE_ID_<NAME>`
  secret matching the name that was asked for.
- **A tool asks for a channel ID and you only have a name.** Ask your companion
  to list the server first — the IDs come back with it.

---

## Credit

The bridge this worker grew out of is Kay's:
[Chatgpt-Discord-Bridge-Mobile](https://github.com/kaydartistry-maker/Chatgpt-Discord-Bridge-Mobile).
If you want the ChatGPT side of it rather than the Aerie side, hers is the one
to read — it covers the parts that differ, including collecting channel IDs by
hand, which that path needs and this one does not. Several of the steps above
are hers too, including Message Content Intent and View Channels: easy to leave
out, impossible to work around.
