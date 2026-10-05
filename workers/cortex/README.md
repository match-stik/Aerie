# Cortex Brain

The long-term memory service Aerie's Memory app talks to. The browser never
calls it: the phone calls the Aerie backend, and the backend calls this worker.

**It is optional.** With no worker configured, the Memory app's Blocks and
Self-Knowledge tabs work normally — those live in Aerie's own database. Only the
Cortex tab needs this.

`worker.js` is the whole thing. It is plain JavaScript with no imports, no
dependencies and no build step, so it pastes straight into the Cloudflare editor.

## Deploy by hand (Cloudflare dashboard)

1. **Make the database.** Storage & Databases → D1 → **Create**. Call it
   whatever you like; the name only matters when you attach it.
2. **Make the worker.** Workers & Pages → **Create** → Worker. Open its editor
   and replace the starter code with all of `worker.js`. Deploy.
3. **Attach the database.** Worker → Settings → Bindings → **Add** → D1
   database. **The variable name must be exactly `DB`** — the code reads
   `env.DB`, so any other name and every request fails on a missing database.
4. **Set the token.** Worker → Settings → Variables and Secrets → Add →
   **Secret** → name it exactly `CORTEX_AUTH_TOKEN`, value anything long and
   random. Deploy again so the secret takes.
5. **Check it.** Open the worker's URL in a browser. You should get a small JSON
   status page. That endpoint is deliberately open so this check works.
6. **Point Aerie at it.** Open the **Memory** app, go to its **Cortex** tab, and fill in both fields:
   the **worker URL** and the **worker token** (the same value as step 4).

You do not create any tables. The worker creates them itself on the first
request that needs them.

**If you skip step 4**, the worker answers `503` and refuses to serve anything
but the status page — see below.

## Deploy with the wrangler CLI

Equivalent to the above. `wrangler.toml` in this folder already sets the binding
name, so the CLI route cannot get that one wrong.

1. **Install and log in.**
   ```
   npm install -g wrangler
   wrangler login
   ```
2. **Make the database.**
   ```
   wrangler d1 create cortex-db
   ```
   It prints a `database_id`. Copy it.
3. **Paste that id into `wrangler.toml`**, in the `[[d1_databases]]` block:
   ```
   database_id = "the-id-it-printed"
   ```
4. **Set the token.**
   ```
   wrangler secret put CORTEX_AUTH_TOKEN
   ```
   Paste something long and random when it prompts. The worker will not serve
   without this.
5. **Deploy.**
   ```
   wrangler deploy
   ```
   It prints the worker's URL.
6. **Check it.** Open that URL in a browser — you should get a small JSON status
   page. That endpoint is deliberately open so this check works.
7. **Point Aerie at it.** Open the **Memory** app, go to its **Cortex** tab, and fill in both fields:
   the **worker URL** (from step 5) and the **worker token** (from step 4).

No tables to create, here either — the worker makes its own on first use.

## It is locked by default, on purpose

Everything except the status page reads or writes memory. With no
`CORTEX_AUTH_TOKEN` set the worker refuses to serve, because the alternative is
a service where the URL is the only thing between a stranger and somebody's
memories. Aerie sends the token as `Authorization: Bearer <token>`.

If you genuinely want an open instance — a scratch copy of your own — add a
variable `CORTEX_ALLOW_UNAUTHENTICATED` set to `true`, and mean it.

## A second door, for browsers (optional, off by default)

The header above is how machines reach this brain. It is not how the claude.ai
app reaches anything: its custom-connector dialog offers a URL and an optional
OAuth client id and secret, and no way to send a header at all — so a worker
that only speaks bearer tokens has nothing that dialog can negotiate with.

Turning on `CORTEX_OAUTH_ENABLED` (a plain variable, set to exactly `true`)
adds an OAuth door beside the header one. It does not replace it: the header
check runs first and never touches the database, so nothing about how your
house reaches the brain changes.

What that gets you: discovery documents so a client can find the door, dynamic
client registration so it can register itself, PKCE, and one plain login page
with a single box. The box asks for the `CORTEX_AUTH_TOKEN` you already set.
One secret, two doors — nothing new to invent and nothing extra to store.

To use it from claude.ai: Settings, Connectors, Add custom connector, URL is
your worker with `/mcp` on the end, and leave the client id and secret blank —
it registers itself. It will hand you the login page; paste your token.

With the variable unset the worker is byte for byte what it was: no discovery,
no registration, no login page, nothing advertised. A new public auth surface
should never appear on somebody's worker because they took an update.

## Interface

`POST /mcp` speaks JSON-RPC (`tools/list`, `tools/call`); `GET /sse` is the same
tools over SSE. There are also plain REST routes for the edits the tool list
does not cover, e.g. `PATCH /api/memory/:id` and `DELETE /api/memory/:id`.
