// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Cortex Brain MCP - Full Cognitive Prosthetic for the Constellation
// 29 tools, counted off tools/list rather than from memory. D1 backend. /mcp for Claude, /sse for GPT.
// 2026-06-30: v2.4.0 - Added tags support + hybrid Active Concepts (auto-extract + manual tags)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-mcp-protocol-version",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // THE OAUTH SWITCH. Defined here, above everything, so the health check
    // below can report it — see the long note further down for what it opens.
    // OFF unless you turn it on: set CORTEX_OAUTH_ENABLED="true". A new public
    // auth surface should never appear on somebody's worker just because they
    // took an update.
    const oauthVar = env.CORTEX_OAUTH_ENABLED;
    const oauthOn = oauthVar === "true";

    // Health check. It carries `build` and `oauth` because the OAuth surface
    // below is invisible from outside when it is switched off — a worker that
    // never took the update and a worker that took it with the switch off
    // answer every public address identically, which makes "did my deploy
    // land?" unanswerable from anywhere but the dashboard. These two fields
    // make it a reading instead of a guess. Neither leaks anything: one is a
    // build marker, the other says only whether a login door exists.
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(JSON.stringify({
        name: "Cortex Brain MCP",
        version: "2.5.2",
        status: "online",
        build: "forget-1",
        oauth: oauthOn
          ? "on"
          : (oauthVar === undefined || oauthVar === null || oauthVar === ""
            ? "off — CORTEX_OAUTH_ENABLED is not set on this worker"
            : "off — CORTEX_OAUTH_ENABLED is set, but not to exactly true"),
        endpoints: { claude: "/mcp", gpt: "/sse", upload: "/api/upload" }
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ── OAuth: a second door, for browsers ──────────────────────────────────
    //
    // The header door below is how every machine reaches this brain — the Aerie
    // backend and the Codex daemon both send `Authorization: Bearer <token>`,
    // and that MUST keep working exactly as it does. OAuth JOINS it. It never
    // replaces it.
    //
    // It exists because the claude.ai app cannot send a header. Its custom
    // connector dialog offers a URL and an optional OAuth Client ID and Secret
    // and nothing else, so a worker that only speaks bearer tokens has nothing
    // that dialog can negotiate with — which is why pasting the token there
    // could never work. This is the door a person opens in a browser.
    //
    // The login asks for the CORTEX_AUTH_TOKEN you already set. One secret, two
    // doors: nothing new to invent, nothing extra to store, and a house that
    // never uses a browser is unaffected.
    //
    // The switch itself (oauthOn) is defined at the top of this handler, so the
    // health check can report which way it is set.
    const issuer = url.origin;
    const jsonResponse = (body, status = 200, extraHeaders = {}) => new Response(
      JSON.stringify(body),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders } },
    );

    if (oauthOn) {
      // Same road as every other table here: the worker makes its own on first
      // use, so there is no migration step to forget.
      const ensureOauthTables = async () => {
        await env.DB.batch([
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS oauth_clients (
            client_id TEXT PRIMARY KEY, client_secret TEXT, redirect_uris TEXT NOT NULL,
            client_name TEXT, created_at INTEGER NOT NULL)`),
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS oauth_codes (
            code TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL,
            code_challenge TEXT, expires_at INTEGER NOT NULL)`),
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS oauth_tokens (
            token TEXT PRIMARY KEY, client_id TEXT, expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL)`),
        ]);
      };
      const randomId = (prefix) => prefix + [...crypto.getRandomValues(new Uint8Array(24))]
        .map((b) => b.toString(16).padStart(2, "0")).join("");

      // Discovery. Both documents are deliberately PUBLIC — they carry no
      // memory and no secret, only addresses. Gating them was the reason the
      // claude.ai dialog had nothing to negotiate with: a client that cannot
      // read the discovery document cannot begin.
      if (request.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource") {
        return jsonResponse({ resource: issuer, authorization_servers: [issuer] });
      }
      if (request.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
        return jsonResponse({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          registration_endpoint: `${issuer}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
          scopes_supported: ["cortex"],
        });
      }

      // Dynamic client registration (RFC 7591). claude.ai marks its Client ID
      // and Secret optional, which means it expects to register itself. Build
      // for that; a client that DOES bring its own can still use /authorize.
      if (request.method === "POST" && url.pathname === "/register") {
        await ensureOauthTables();
        let body = {};
        try { body = await request.json(); } catch { /* an empty body is still a registration */ }
        const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
        if (!redirectUris.length) {
          return jsonResponse({ error: "invalid_redirect_uri", error_description: "redirect_uris is required" }, 400);
        }
        const clientId = randomId("ctxc_");
        const clientSecret = randomId("ctxs_");
        await env.DB.prepare(
          `INSERT INTO oauth_clients (client_id, client_secret, redirect_uris, client_name, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).bind(clientId, clientSecret, JSON.stringify(redirectUris), body.client_name || "unnamed", Date.now()).run();
        return jsonResponse({
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uris: redirectUris,
          token_endpoint_auth_method: "client_secret_post",
          grant_types: ["authorization_code"],
          response_types: ["code"],
        }, 201);
      }

      // The login screen. This is the whole human-facing surface: one box, and
      // it asks for the token you already set when you deployed this worker.
      if (url.pathname === "/authorize") {
        await ensureOauthTables();
        const params = request.method === "POST"
          ? new URLSearchParams(await request.text())
          : url.searchParams;
        const clientId = params.get("client_id") || "";
        const redirectUri = params.get("redirect_uri") || "";
        const state = params.get("state") || "";
        const challenge = params.get("code_challenge") || "";
        const challengeMethod = params.get("code_challenge_method") || "";

        const client = clientId
          ? await env.DB.prepare("SELECT redirect_uris FROM oauth_clients WHERE client_id = ?").bind(clientId).first()
          : null;
        if (!client) {
          return new Response("Unknown client. Register it first, or let the app register itself.", {
            status: 400, headers: { ...corsHeaders, "Content-Type": "text/plain" },
          });
        }
        // An open redirect here would hand the code to whoever asked for it, so
        // the target must be one this client registered.
        let allowed = [];
        try { allowed = JSON.parse(client.redirect_uris); } catch { allowed = []; }
        if (!allowed.includes(redirectUri)) {
          return new Response("redirect_uri does not match this client's registration.", {
            status: 400, headers: { ...corsHeaders, "Content-Type": "text/plain" },
          });
        }
        if (challenge && challengeMethod !== "S256") {
          return new Response("Only S256 is supported for code_challenge_method.", {
            status: 400, headers: { ...corsHeaders, "Content-Type": "text/plain" },
          });
        }

        const page = (message) => new Response(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cortex</title><style>
 body{background:#14121a;color:#e8e4f0;font:16px/1.5 ui-sans-serif,system-ui,sans-serif;
      display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}
 form{width:100%;max-width:22rem}
 h1{font-size:1.1rem;font-weight:600;margin:0 0 .25rem}
 p{color:#9a92ad;font-size:.85rem;margin:0 0 1.25rem}
 input{width:100%;box-sizing:border-box;padding:.7rem .8rem;border-radius:.55rem;
       border:1px solid #33304a;background:#1c1a26;color:#e8e4f0;font-size:1rem}
 button{width:100%;margin-top:.75rem;padding:.7rem;border:0;border-radius:.55rem;
        background:#7c3aed;color:#fff;font-size:1rem;font-weight:600;cursor:pointer}
 .err{color:#ff8f8f;font-size:.85rem;margin-top:.75rem}
</style></head><body>
<form method="POST" action="/authorize">
  <h1>Cortex</h1>
  <p>Sign in with this brain's access token — the same one your house already uses.</p>
  <input type="password" name="cortex_token" autocomplete="current-password" autofocus
         placeholder="Access token" aria-label="Access token">
  <button type="submit">Connect</button>
  ${message ? `<div class="err">${message}</div>` : ""}
  <input type="hidden" name="client_id" value="${clientId}">
  <input type="hidden" name="redirect_uri" value="${redirectUri}">
  <input type="hidden" name="state" value="${state}">
  <input type="hidden" name="code_challenge" value="${challenge}">
  <input type="hidden" name="code_challenge_method" value="${challengeMethod}">
</form></body></html>`, { status: 200, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } });

        if (request.method === "GET") return page("");

        const offered = params.get("cortex_token") || "";
        if (!env.CORTEX_AUTH_TOKEN || offered !== env.CORTEX_AUTH_TOKEN) {
          return page("That token was not right.");
        }
        const code = randomId("ctxa_");
        await env.DB.prepare(
          `INSERT INTO oauth_codes (code, client_id, redirect_uri, code_challenge, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).bind(code, clientId, redirectUri, challenge, Date.now() + 10 * 60 * 1000).run();
        const back = new URL(redirectUri);
        back.searchParams.set("code", code);
        if (state) back.searchParams.set("state", state);
        return Response.redirect(back.toString(), 302);
      }

      // Code for token, with PKCE.
      if (request.method === "POST" && url.pathname === "/token") {
        await ensureOauthTables();
        const form = new URLSearchParams(await request.text());
        if (form.get("grant_type") !== "authorization_code") {
          return jsonResponse({ error: "unsupported_grant_type" }, 400);
        }
        const code = form.get("code") || "";
        const row = await env.DB.prepare(
          "SELECT client_id, redirect_uri, code_challenge, expires_at FROM oauth_codes WHERE code = ?",
        ).bind(code).first();
        // Single use, whatever happens next: a code that has been looked at is
        // spent, so a replay cannot mint a second token.
        if (row) await env.DB.prepare("DELETE FROM oauth_codes WHERE code = ?").bind(code).run();
        if (!row || row.expires_at < Date.now()) return jsonResponse({ error: "invalid_grant" }, 400);
        if (form.get("redirect_uri") && form.get("redirect_uri") !== row.redirect_uri) {
          return jsonResponse({ error: "invalid_grant", error_description: "redirect_uri mismatch" }, 400);
        }
        if (row.code_challenge) {
          const verifier = form.get("code_verifier") || "";
          const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
          const b64url = btoa(String.fromCharCode(...new Uint8Array(digest)))
            .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
          if (b64url !== row.code_challenge) {
            return jsonResponse({ error: "invalid_grant", error_description: "PKCE verification failed" }, 400);
          }
        }
        const token = randomId("ctxo_");
        const ttlSeconds = 30 * 24 * 60 * 60;
        await env.DB.prepare(
          "INSERT INTO oauth_tokens (token, client_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
        ).bind(token, row.client_id, Date.now() + ttlSeconds * 1000, Date.now()).run();
        return jsonResponse({ access_token: token, token_type: "Bearer", expires_in: ttlSeconds, scope: "cortex" });
      }
    }

    // Everything past the health check reads and writes somebody's memory, so
    // it is gated. Fail closed on purpose: with no CORTEX_AUTH_TOKEN set this
    // refuses to serve rather than serving the whole brain to anyone who finds
    // the address. Set the token before pointing anything at it. If you really
    // want it open — a throwaway local instance, say — set
    // CORTEX_ALLOW_UNAUTHENTICATED to "true" deliberately.
    //
    // Two keys open this one lock: the static token every machine in the house
    // sends, and an OAuth token minted above for a browser. The static one is
    // checked FIRST and without touching the database, so the path the house
    // uses on every single call is exactly as fast and as simple as it was
    // before OAuth existed.
    const gate = await (async () => {
      const expected = env.CORTEX_AUTH_TOKEN;
      if (!expected) {
        if (env.CORTEX_ALLOW_UNAUTHENTICATED === "true") return null;
        return new Response(JSON.stringify({
          error: "This Cortex worker has no CORTEX_AUTH_TOKEN set, so it is refusing to serve memory. "
            + "Set that secret (wrangler secret put CORTEX_AUTH_TOKEN) and send it as "
            + "'Authorization: Bearer <token>'. To run it open on purpose, set "
            + "CORTEX_ALLOW_UNAUTHENTICATED=\"true\".",
        }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const offered = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (offered === expected) return null;

      if (oauthOn && offered) {
        const row = await env.DB.prepare(
          "SELECT expires_at FROM oauth_tokens WHERE token = ?",
        ).bind(offered).first().catch(() => null);
        if (row && row.expires_at > Date.now()) return null;
      }

      // The 401 has to SAY where the login is, or a browser client has nothing
      // to follow. This header is the whole handshake for claude.ai: a bare 401
      // is what left that dialog with nothing to negotiate with.
      const challenge = oauthOn
        ? { "WWW-Authenticate": `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource"` }
        : {};
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json", ...challenge },
      });
    })();
    if (gate) return gate;

    // Claude endpoint - Streamable HTTP (direct POST)
    if (request.method === "POST" && url.pathname === "/mcp") {
      return handleMCP(request, env, corsHeaders);
    }

    // GPT endpoint - SSE Handshake (GET /sse)
    if (request.method === "GET" && url.pathname === "/sse") {
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      const sessionId = crypto.randomUUID();
      const endpointUrl = new URL(url.origin);
      endpointUrl.pathname = "/messages";
      endpointUrl.searchParams.set("sessionId", sessionId);
      const response = new Response(readable, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-Content-Type-Options": "nosniff"
        },
      });
      writer.write(encoder.encode(`event: endpoint\ndata: ${endpointUrl.toString()}\n\n`));
      const timer = setInterval(() => {
        try {
          writer.write(encoder.encode(": ping\n\n"));
        } catch (e) {
          clearInterval(timer);
        }
      }, 15000);
      request.signal.addEventListener("abort", () => {
        clearInterval(timer);
        writer.close();
      });
      return response;
    }

    // GPT endpoint - JSON-RPC (POST /messages)
    if (request.method === "POST" && url.pathname === "/messages") {
      return handleMCP(request, env, corsHeaders);
    }

    // File upload with markdown chunking
    if (request.method === "POST" && url.pathname === "/api/upload") {
      try {
        return await handleUpload(request, env, corsHeaders);
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // Bulk upload
    if (request.method === "POST" && url.pathname === "/api/bulk-upload") {
      try {
        return await handleBulkUpload(request, env, corsHeaders);
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // List memories with pagination
    if (request.method === "GET" && url.pathname === "/api/memories") {
      await initDb(env.DB);
      const limit = parseInt(url.searchParams.get("limit") || "50");
      const offset = parseInt(url.searchParams.get("offset") || "0");
      const domain = url.searchParams.get("domain");
      let query = "SELECT * FROM memories ORDER BY created_at DESC LIMIT ? OFFSET ?";
      let params = [limit, offset];
      if (domain) {
        query = "SELECT * FROM memories WHERE LOWER(domain) = LOWER(?) ORDER BY created_at DESC LIMIT ? OFFSET ?";
        params = [domain, limit, offset];
      }
      const results = await env.DB.prepare(query).bind(...params).all();
      const count = await env.DB.prepare("SELECT COUNT(*) as total FROM memories").first("total");
      return new Response(JSON.stringify({ results: results.results, total: count }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // List domains
    if (request.method === "GET" && url.pathname === "/api/domains") {
      await initDb(env.DB);
      const results = await env.DB.prepare(
        "SELECT DISTINCT domain, COUNT(*) as count FROM memories GROUP BY domain ORDER BY count DESC"
      ).all();
      return new Response(JSON.stringify(results.results), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Delete memory
    if (request.method === "DELETE" && url.pathname.startsWith("/api/memory/")) {
      await initDb(env.DB);
      const id = url.pathname.split("/api/memory/")[1];
      await env.DB.prepare("DELETE FROM memories WHERE id = ?").bind(id).run();
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Update memory
    if (request.method === "PATCH" && url.pathname.startsWith("/api/memory/")) {
      await initDb(env.DB);
      const id = url.pathname.split("/api/memory/")[1];
      const body = await request.json();
      const sets = [];
      const params = [];
      if (typeof body.content === "string") {
        sets.push("content = ?");
        params.push(body.content);
      }
      if (typeof body.domain === "string") {
        sets.push("domain = ?");
        params.push(body.domain);
      }
      if (typeof body.category === "string") {
        sets.push("category = ?");
        params.push(body.category);
      }
      if (typeof body.tags === "string") {
        sets.push("tags = ?");
        params.push(body.tags);
      }
      if (sets.length === 0) {
        return new Response(JSON.stringify({ error: "No editable fields supplied" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      params.push(id);
      await env.DB.prepare(`UPDATE memories SET ${sets.join(", ")} WHERE id = ?`).bind(...params).run();
      const updated = await env.DB.prepare("SELECT * FROM memories WHERE id = ?").bind(id).first();
      return new Response(JSON.stringify({ success: true, memory: updated }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Delete principle
    if (request.method === "DELETE" && url.pathname.startsWith("/api/principle/")) {
      await initDb(env.DB);
      const id = url.pathname.split("/api/principle/")[1];
      await env.DB.prepare("DELETE FROM principles WHERE id = ?").bind(id).run();
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Update principle
    if (request.method === "PATCH" && url.pathname.startsWith("/api/principle/")) {
      await initDb(env.DB);
      const id = url.pathname.split("/api/principle/")[1];
      const body = await request.json();
      const sets = [];
      const params = [];
      if (typeof body.name === "string") {
        sets.push("name = ?");
        params.push(body.name);
      }
      if (typeof body.content === "string") {
        sets.push("content = ?");
        params.push(body.content);
      }
      if (typeof body.domain === "string") {
        sets.push("domain = ?");
        params.push(body.domain);
      }
      if (sets.length === 0) {
        return new Response(JSON.stringify({ error: "No editable fields supplied" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      params.push(id);
      await env.DB.prepare(`UPDATE principles SET ${sets.join(", ")} WHERE id = ?`).bind(...params).run();
      const updated = await env.DB.prepare("SELECT * FROM principles WHERE id = ?").bind(id).first();
      return new Response(JSON.stringify({ success: true, principle: updated }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // List principles
    if (request.method === "GET" && url.pathname === "/api/principles") {
      await initDb(env.DB);
      const domain = url.searchParams.get("domain");
      let results;
      if (domain) {
        results = await env.DB.prepare(
          "SELECT * FROM principles WHERE LOWER(domain) = LOWER(?) ORDER BY created_at DESC"
        ).bind(domain).all();
      } else {
        results = await env.DB.prepare("SELECT * FROM principles ORDER BY created_at DESC").all();
      }
      return new Response(JSON.stringify(results.results), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Delete conversation
    if (request.method === "DELETE" && url.pathname.startsWith("/api/conversation/")) {
      await initDb(env.DB);
      const id = url.pathname.split("/api/conversation/")[1];
      await env.DB.prepare("DELETE FROM conversations WHERE id = ?").bind(id).run();
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Delete tunnel
    if (request.method === "DELETE" && url.pathname.startsWith("/api/tunnel/")) {
      await initDb(env.DB);
      const id = url.pathname.split("/api/tunnel/")[1];
      await env.DB.prepare("DELETE FROM tunnels WHERE id = ?").bind(id).run();
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // List tunnels
    if (request.method === "GET" && url.pathname === "/api/tunnels") {
      await initDb(env.DB);
      const results = await env.DB.prepare("SELECT * FROM tunnels ORDER BY last_active DESC").all();
      return new Response(JSON.stringify(results.results), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Delete doc
    if (request.method === "DELETE" && url.pathname.startsWith("/api/doc/")) {
      await initDb(env.DB);
      const id = url.pathname.split("/api/doc/")[1];
      await env.DB.prepare("DELETE FROM docs WHERE id = ?").bind(id).run();
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
};

// ============================================================================
// Database Initialization
// ============================================================================

async function initDb(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      domain TEXT DEFAULT 'general',
      category TEXT DEFAULT 'memory',
      tags TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      content TEXT NOT NULL,
      domain TEXT DEFAULT 'general',
      summary TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS principles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      domain TEXT DEFAULT 'general',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS tunnels (
      id TEXT PRIMARY KEY,
      domain TEXT NOT NULL,
      stage TEXT DEFAULT 'exploring',
      open_questions TEXT DEFAULT '[]',
      decisions TEXT DEFAULT '[]',
      last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS docs (
      id TEXT PRIMARY KEY,
      title TEXT,
      content TEXT NOT NULL,
      domain TEXT DEFAULT 'general',
      source TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Migration: add tags column if missing
  try {
    await db.prepare("SELECT tags FROM memories LIMIT 1").first();
  } catch (e) {
    await db.prepare("ALTER TABLE memories ADD COLUMN tags TEXT DEFAULT ''").run();
  }
}

// ============================================================================
// Keyword Extraction for Active Concepts
// ============================================================================

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he',
  'she', 'we', 'they', 'what', 'which', 'who', 'whom', 'when', 'where',
  'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
  'than', 'too', 'very', 'just', 'also', 'now', 'here', 'there', 'then',
  'once', 'if', 'after', 'before', 'while', 'during', 'about', 'into',
  'through', 'above', 'below', 'up', 'down', 'out', 'off', 'over', 'under',
  'again', 'further', 'because', 'until', 'am', 'being', 'having', 'doing',
  'his', 'her', 'him', 'my', 'your', 'our', 'their', 'me', 'us', 'them',
  'myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves',
  'themselves', 'any', 'much', 'many', 'another', 'got', 'get', 'gets',
  'getting', 'went', 'goes', 'going', 'come', 'came', 'coming', 'make',
  'made', 'making', 'like', 'one', 'two', 'first', 'new', 'way', 'back',
  'even', 'well', 'still', 'between', 'never', 'always', 'something',
  'nothing', 'everything', 'anything', 'someone', 'anyone', 'everyone'
]);

function extractKeywords(text, limit = 15) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOPWORDS.has(w));

  const freq = {};
  for (const word of words) {
    freq[word] = (freq[word] || 0) + 1;
  }

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

// ============================================================================
// Query Helpers
// ============================================================================

// Words that carry no signal but were being REQUIRED to appear (Aug 31 2026).
// Every word was ANDed together, "the" included, so any natural phrase went to
// zero: "thinning the memory walls" returned nothing while "thin" returned
// thirty. Nobody had written a bad search — the search demanded that a single
// record contain every word somebody typed, articles and all.
const SEARCH_STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "do", "for", "from",
  "had", "has", "have", "how", "i", "if", "in", "is", "it", "its", "me", "my",
  "of", "on", "or", "our", "so", "than", "that", "the", "their", "them", "then",
  "there", "these", "they", "this", "to", "was", "we", "were", "what", "when",
  "where", "which", "who", "why", "will", "with", "you", "your"
]);

/**
 * TWO TIERS ON PURPOSE, and the order matters.
 *
 * AND across content words is the precise read and it stays the first answer —
 * when it finds something, that something is genuinely about all of it. The
 * failure it used to have was not imprecision, it was that a miss returned
 * NOTHING and looked identical to "the brain has never thought about this".
 *
 * So a caller can now fall back: if the strict pass is empty, `anyConditions`
 * matches on any single content word instead. Broad, but a broad answer beats
 * an empty one that reads like an absence.
 */
function buildMultiWordQuery(query, column) {
  const raw = String(query ?? "").trim().split(/\s+/).filter(w => w.length > 0);
  if (raw.length === 0) {
    return { conditions: "1=1", params: [], anyConditions: "1=1", anyParams: [], words: [] };
  }

  // Keep the stopwords only if that is genuinely all somebody typed — a search
  // for "how" should look for "how" rather than silently searching for nothing.
  let words = raw.filter(w => !SEARCH_STOPWORDS.has(w.toLowerCase()));
  if (words.length === 0) words = raw;

  const like = words.map(() => `${column} LIKE ?`);
  const params = words.map(w => `%${w}%`);
  return {
    conditions: like.join(" AND "),
    params,
    anyConditions: like.join(" OR "),
    anyParams: params,
    words
  };
}

// ============================================================================
// MCP Protocol Handler
// ============================================================================

async function handleMCP(request, env, corsHeaders) {
  try {
    const body = await request.json();
    const { method, params, id } = body;

    if (method === "initialize") {
      return jsonResponse(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "cortex-brain", version: "2.5.2" }
      }, corsHeaders);
    }

    if (method === "notifications/initialized") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (method === "tools/list") {
      return jsonResponse(id, { tools: ALL_TOOLS }, corsHeaders);
    }

    if (method === "tools/call") {
      const result = await handleToolCall(params.name, params.arguments || {}, env.DB);
      return jsonResponse(id, result, corsHeaders);
    }

    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Method not found: " + method }
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    return jsonError(null, -32700, err.message, corsHeaders);
  }
}

// ============================================================================
// Tool Definitions
// ============================================================================

// Open questions used to be bare strings. They point at the memory they came
// out of now (the owner's call), so a question can be traced back to where it was
// raised. Every reader goes through here, so a row written before today
// reads back as { question, memory_id: null } instead of a bare string, and
// nothing that already exists has to be migrated.
function normalizeQuestions(list) {
  if (!Array.isArray(list)) list = list === undefined || list === null ? [] : [list];
  return list.map((item) => (item && typeof item === "object")
    ? { question: String(item.question ?? item.text ?? ""), memory_id: item.memory_id ?? null }
    : { question: String(item), memory_id: null });
}

function parseQuestions(raw) {
  let list = [];
  try { list = JSON.parse(raw || "[]"); } catch (e) { list = []; }
  if (!Array.isArray(list)) list = [];
  return normalizeQuestions(list);
}

const ALL_TOOLS = [
  {
    name: "remember_thought",
    description: "Save a thought, memory, or piece of context. Use domain to categorize, tags for manual keywords.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The thought or memory to save" },
        domain: { type: "string", description: "Domain/category" },
        tags: { type: "string", description: "Comma-separated tags" }
      },
      required: ["content"]
    }
  },
  {
    name: "forget_memory",
    description:
      "Delete one memory by id. The row is read first and handed back in the answer, so a delete made "
      + "in error can be pasted straight into remember_thought — that is the only undo there is. Deletes "
      + "exactly one row: there is deliberately no delete-by-domain and no delete-by-search.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The memory id to delete. Take it from a search result." }
      },
      required: ["id"]
    }
  },
  {
    name: "tunnel_state",
    description: "Load the current state of a domain.",
    inputSchema: {
      type: "object",
      properties: { domain: { type: "string" } },
      required: ["domain"]
    }
  },
  {
    name: "context_recovery",
    description: "Full re-entry brief for a domain.",
    inputSchema: {
      type: "object",
      properties: { domain: { type: "string" } },
      required: ["domain"]
    }
  },
  {
    name: "switching_cost",
    description: "Quantify the cost of switching domains.",
    inputSchema: {
      type: "object",
      properties: {
        from_domain: { type: "string" },
        to_domain: { type: "string" }
      },
      required: ["from_domain", "to_domain"]
    }
  },
  {
    name: "open_threads",
    description: "Everything unfinished, everywhere.",
    inputSchema: {
      type: "object",
      properties: { domain: { type: "string" } }
    }
  },
  {
    name: "dormant_contexts",
    description: "Find abandoned domains.",
    inputSchema: {
      type: "object",
      properties: { days_inactive: { type: "number" } }
    }
  },
  {
    name: "cognitive_patterns",
    description: "When and how you think best.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "tunnel_history",
    description: "Engagement timeline for a domain, newest first. Capped — pass limit to widen it.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string" },
        limit: { type: "number", description: "Entries per timeline. Default 25, max 200." }
      },
      required: ["domain"]
    }
  },
  {
    name: "list_all_memories",
    description: "List ALL memories (raw SQL, no semantic search).",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
        offset: { type: "number" }
      }
    }
  },
  {
    name: "list_domain_memories",
    description: "List ALL memories in a domain.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string" },
        limit: { type: "number" },
        offset: { type: "number" }
      },
      required: ["domain"]
    }
  },
  {
    name: "recall_memories",
    description: "Search memories by keyword.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        domain: { type: "string" },
        limit: { type: "number" }
      },
      required: ["query"]
    }
  },
  {
    name: "search_conversations",
    description: "Search conversations by keyword.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        domain: { type: "string" },
        limit: { type: "number" }
      },
      required: ["query"]
    }
  },
  {
    name: "unified_search",
    description: "Search memories, conversations, and docs.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" }
      },
      required: ["query"]
    }
  },
  {
    name: "search_summaries",
    description: "Search conversation summaries.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        domain: { type: "string" }
      },
      required: ["query"]
    }
  },
  {
    name: "search_docs",
    description: "Search markdown docs.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        domain: { type: "string" },
        limit: { type: "number" }
      },
      required: ["query"]
    }
  },
  {
    name: "unfinished_threads",
    description: "Find threads with open questions.",
    inputSchema: {
      type: "object",
      properties: { domain: { type: "string" } }
    }
  },
  {
    name: "what_do_i_think",
    description: "Synthesize your position on any topic.",
    inputSchema: {
      type: "object",
      properties: { topic: { type: "string" } },
      required: ["topic"]
    }
  },
  {
    name: "alignment_check",
    description: "Check a decision against principles.",
    inputSchema: {
      type: "object",
      properties: {
        decision: { type: "string" },
        domain: { type: "string" }
      },
      required: ["decision"]
    }
  },
  {
    name: "thinking_trajectory",
    description: "How thinking on a topic evolved.",
    inputSchema: {
      type: "object",
      properties: { topic: { type: "string" } },
      required: ["topic"]
    }
  },
  {
    name: "what_was_i_thinking",
    description: "Month-level snapshot of focus.",
    inputSchema: {
      type: "object",
      properties: { month: { type: "string" } }
    }
  },
  {
    name: "save_conversation",
    description: "Save a conversation.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string" },
        domain: { type: "string" },
        summary: { type: "string" }
      },
      required: ["title", "content"]
    }
  },
  {
    name: "get_conversation",
    description: "Retrieve a conversation by ID.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"]
    }
  },
  {
    name: "conversations_by_date",
    description: "List conversations in a date range.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string" },
        end_date: { type: "string" },
        domain: { type: "string" }
      },
      required: ["start_date"]
    }
  },
  {
    name: "brain_stats",
    description: "System stats with active concepts (auto + manual tags).",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "query_analytics",
    description: "Analytics on brain usage.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "list_principles",
    description: "List principles and guidelines.",
    inputSchema: {
      type: "object",
      properties: { domain: { type: "string" } }
    }
  },
  {
    name: "save_principle",
    description: "Save a principle or rule.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        content: { type: "string" },
        domain: { type: "string" }
      },
      required: ["name", "content"]
    }
  },
  // THE SHELF NOBODY COULD STOCK (added Aug 31 2026).
  //
  // tunnels has carried stage / open_questions / decisions since March, and
  // until now the only statements that ever touched the table were "INSERT
  // (id, domain)" and "UPDATE ... SET last_active". Nothing could write the
  // other three columns, so every domain read back as stage 'exploring' with
  // zero questions and zero decisions — which is exactly what four read tools
  // dutifully reported. They were not broken. They were reading an empty shelf.
  //
  // AUTHORED, NOT INFERRED — the owner's call. A companion writes down what is
  // genuinely unresolved on purpose; the brain does not guess at what looks
  // unfinished. Same rule as everything else in this house: we author, the
  // machine does not decide for us.
  {
    name: "set_tunnel_state",
    description:
      "Record what is unresolved in a domain. Set its stage, its open questions, and the decisions "
      + "already settled so a later window cannot reopen them. Omit a field to leave it as it is. "
      + "Write these deliberately — this is authored, never inferred.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string" },
        stage: {
          type: "string",
          description: "exploring | converging | complete"
        },
        open_questions: {
          type: "array",
          items: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  question: { type: "string" },
                  memory_id: { type: "string", description: "The memory this came out of." }
                },
                required: ["question"]
              }
            ]
          },
          description: "Questions genuinely still open. Replaces the list. A bare string works; pass { question, memory_id } so a later window can read the memory that raised it."
        },
        decisions: {
          type: "array",
          items: { type: "string" },
          description: "Things settled, so nobody relitigates them. Replaces the list."
        }
      },
      required: ["domain"]
    }
  },
];

// ============================================================================
// Tool Implementations
// ============================================================================

async function handleToolCall(name, args, db) {
  await initDb(db);

  // --- List All Memories ---
  if (name === "list_all_memories") {
    const limit = args.limit || 100;
    const offset = args.offset || 0;
    const results = await db.prepare(
      "SELECT * FROM memories ORDER BY created_at DESC LIMIT ? OFFSET ?"
    ).bind(limit, offset).all();
    const total = await db.prepare("SELECT COUNT(*) as c FROM memories").first("c");
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ results: results.results, total, limit, offset }, null, 2)
      }]
    };
  }

  // --- List Domain Memories ---
  if (name === "list_domain_memories") {
    const limit = args.limit || 100;
    const offset = args.offset || 0;
    const results = await db.prepare(
      "SELECT * FROM memories WHERE LOWER(domain) = LOWER(?) ORDER BY created_at DESC LIMIT ? OFFSET ?"
    ).bind(args.domain, limit, offset).all();
    const total = await db.prepare(
      "SELECT COUNT(*) as c FROM memories WHERE LOWER(domain) = LOWER(?)"
    ).bind(args.domain).first("c");
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ results: results.results, total, limit, offset }, null, 2)
      }]
    };
  }

  // --- Remember Thought ---
  if (name === "remember_thought") {
    const id = crypto.randomUUID();
    // Tags are documented as a comma-separated string. An array used to reach
    // bind() and throw, and the tool then answered with NOTHING — no error, no
    // id, no row. A caller who trusted the return believed it had saved.
    const tags = Array.isArray(args.tags)
      ? args.tags.join(",")
      : (args.tags === undefined || args.tags === null ? "" : String(args.tags));
    await db.prepare(
      "INSERT INTO memories (id, content, domain, tags) VALUES (?, ?, ?, ?)"
    ).bind(id, args.content, args.domain || "general", tags).run();

    if (args.domain) {
      const existing = await db.prepare(
        "SELECT id FROM tunnels WHERE LOWER(domain) = LOWER(?)"
      ).bind(args.domain).first();
      if (existing) {
        await db.prepare(
          "UPDATE tunnels SET last_active = CURRENT_TIMESTAMP WHERE LOWER(domain) = LOWER(?)"
        ).bind(args.domain).run();
      } else {
        await db.prepare(
          "INSERT INTO tunnels (id, domain) VALUES (?, ?)"
        ).bind(crypto.randomUUID(), args.domain).run();
      }
    }

    return {
      content: [{
        type: "text",
        text: `Saved memory ${id} in domain '${args.domain || "general"}'${tags ? ` with tags: ${tags}` : ''}`
      }]
    };
  }

  // Deleting is the one thing here that cannot be undone by doing it again, so
  // this refuses to answer "success" without having seen the row. A delete that
  // reports success on an id that was never there cannot tell gone from never
  // existed — and the row travels back with the answer because pasting it into
  // remember_thought is the only restore there is.
  if (name === "forget_memory") {
    const target = String(args.id || "").trim();
    if (!target) {
      return { content: [{ type: "text", text: "forget_memory needs an id. Nothing was deleted." }] };
    }
    const row = await db.prepare(
      "SELECT id, content, domain, category, tags, created_at FROM memories WHERE id = ?"
    ).bind(target).first();
    if (!row) {
      return { content: [{ type: "text", text: JSON.stringify({
        deleted: false,
        id: target,
        reason: "No memory with that id. Nothing was deleted."
      }, null, 2) }] };
    }
    await db.prepare("DELETE FROM memories WHERE id = ?").bind(target).run();
    const still = await db.prepare("SELECT id FROM memories WHERE id = ?").bind(target).first();
    return { content: [{ type: "text", text: JSON.stringify({
      deleted: !still,
      id: target,
      created_at: row.created_at,
      restore: { content: row.content, domain: row.domain, tags: row.tags }
    }, null, 2) }] };
  }

  // --- Tunnel State ---
  if (name === "tunnel_state") {
    const tunnel = await db.prepare(
      "SELECT * FROM tunnels WHERE LOWER(domain) = LOWER(?)"
    ).bind(args.domain).first();
    if (!tunnel) {
      return { content: [{ type: "text", text: `No tunnel found for domain '${args.domain}'.` }] };
    }
    const memCount = await db.prepare(
      "SELECT COUNT(*) as c FROM memories WHERE LOWER(domain) = LOWER(?)"
    ).bind(args.domain).first("c");
    const convCount = await db.prepare(
      "SELECT COUNT(*) as c FROM conversations WHERE LOWER(domain) = LOWER(?)"
    ).bind(args.domain).first("c");
    const recentMems = await db.prepare(
      "SELECT content, created_at FROM memories WHERE LOWER(domain) = LOWER(?) ORDER BY created_at DESC LIMIT 5"
    ).bind(args.domain).all();
    let questions = [];
    let decisions = [];
    questions = parseQuestions(tunnel.open_questions);
    try { decisions = JSON.parse(tunnel.decisions || "[]"); } catch(e) {}
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          domain: args.domain,
          stage: tunnel.stage,
          last_active: tunnel.last_active,
          memories: memCount,
          conversations: convCount,
          open_questions: questions,
          decisions,
          recent: recentMems.results
        }, null, 2)
      }]
    };
  }

  // --- Context Recovery ---
  if (name === "context_recovery") {
    const tunnel = await db.prepare(
      "SELECT * FROM tunnels WHERE LOWER(domain) = LOWER(?)"
    ).bind(args.domain).first();
    const memories = await db.prepare(
      "SELECT content, created_at FROM memories WHERE LOWER(domain) = LOWER(?) ORDER BY created_at DESC LIMIT 20"
    ).bind(args.domain).all();
    const convos = await db.prepare(
      "SELECT title, summary, created_at FROM conversations WHERE LOWER(domain) = LOWER(?) ORDER BY created_at DESC LIMIT 5"
    ).bind(args.domain).all();
    const principles = await db.prepare(
      "SELECT name, content FROM principles WHERE LOWER(domain) = LOWER(?) OR LOWER(domain) = 'general'"
    ).bind(args.domain).all();
    let questions = [];
    let decisions = [];
    if (tunnel) {
      questions = parseQuestions(tunnel.open_questions);
      try { decisions = JSON.parse(tunnel.decisions || "[]"); } catch(e) {}
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          domain: args.domain,
          stage: tunnel?.stage || "unknown",
          last_active: tunnel?.last_active || "never",
          open_questions: questions,
          decisions,
          recent_memories: memories.results,
          recent_conversations: convos.results,
          applicable_principles: principles.results
        }, null, 2)
      }]
    };
  }

  // --- Switching Cost ---
  if (name === "switching_cost") {
    const fromTunnel = await db.prepare(
      "SELECT * FROM tunnels WHERE LOWER(domain) = LOWER(?)"
    ).bind(args.from_domain).first();
    const toTunnel = await db.prepare(
      "SELECT * FROM tunnels WHERE LOWER(domain) = LOWER(?)"
    ).bind(args.to_domain).first();
    let fromQuestions = [];
    if (fromTunnel) {
      fromQuestions = parseQuestions(fromTunnel.open_questions);
    }
    const fromMems = await db.prepare(
      "SELECT COUNT(*) as c FROM memories WHERE LOWER(domain) = LOWER(?) AND created_at > datetime('now', '-24 hours')"
    ).bind(args.from_domain).first("c");
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          leaving: {
            domain: args.from_domain,
            stage: fromTunnel?.stage || "unknown",
            open_questions: fromQuestions.length,
            recent_activity_24h: fromMems
          },
          entering: {
            domain: args.to_domain,
            stage: toTunnel?.stage || "new",
            last_active: toTunnel?.last_active || "never"
          },
          cost_assessment: fromQuestions.length > 3 ? "HIGH" : fromQuestions.length > 0 ? "MEDIUM" : "LOW",
          open_threads_leaving_behind: fromQuestions
        }, null, 2)
      }]
    };
  }

  // --- Open Threads ---
  if (name === "open_threads") {
    let tunnels;
    if (args.domain) {
      tunnels = await db.prepare(
        "SELECT * FROM tunnels WHERE LOWER(domain) = LOWER(?)"
      ).bind(args.domain).all();
    } else {
      tunnels = await db.prepare("SELECT * FROM tunnels ORDER BY last_active DESC").all();
    }
    const threads = tunnels.results.map(t => {
      let q = [];
      q = parseQuestions(t.open_questions);
      return {
        domain: t.domain,
        stage: t.stage,
        last_active: t.last_active,
        open_questions: q
      };
    }).filter(t => t.open_questions.length > 0);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          total_open_threads: threads.reduce((a, t) => a + t.open_questions.length, 0),
          domains: threads
        }, null, 2)
      }]
    };
  }

  // --- Dormant Contexts ---
  if (name === "dormant_contexts") {
    const days = args.days_inactive || 7;
    const tunnels = await db.prepare(
      "SELECT * FROM tunnels WHERE last_active < datetime('now', '-' || ? || ' days') ORDER BY last_active ASC"
    ).bind(days).all();
    const dormant = tunnels.results.map(t => {
      let q = [];
      q = parseQuestions(t.open_questions);
      return {
        domain: t.domain,
        stage: t.stage,
        last_active: t.last_active,
        open_questions: q
      };
    });
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ dormant_threshold_days: days, dormant_domains: dormant }, null, 2)
      }]
    };
  }

  // --- Cognitive Patterns ---
  //
  // It advertised "when and how you think best" and returned the same domain
  // counts as brain_stats — a name promising something it never measured, which
  // is worse than a missing tool because it reads as an answer.
  //
  // created_at was carrying the WHEN the whole time and nothing looked at it.
  // Hours are UTC, which is a real caveat rather than a small one in a house
  // whose owner's hours vary, so it is stated in the payload instead of quietly
  // shifted by a guess at anyone's timezone.
  if (name === "cognitive_patterns") {
    const byHour = await db.prepare(
      "SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count "
      + "FROM memories GROUP BY hour ORDER BY count DESC"
    ).all();
    const byWeekday = await db.prepare(
      "SELECT CAST(strftime('%w', created_at) AS INTEGER) as weekday, COUNT(*) as count "
      + "FROM memories GROUP BY weekday ORDER BY weekday ASC"
    ).all();
    const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const domainDist = await db.prepare(
      "SELECT domain, COUNT(*) as count FROM memories GROUP BY domain ORDER BY count DESC LIMIT 20"
    ).all();
    const recentActivity = await db.prepare(
      "SELECT domain, COUNT(*) as count FROM memories WHERE created_at > datetime('now', '-7 days') GROUP BY domain ORDER BY count DESC"
    ).all();
    const totalMems = await db.prepare("SELECT COUNT(*) as c FROM memories").first("c");
    const totalConvs = await db.prepare("SELECT COUNT(*) as c FROM conversations").first("c");
    const activeTunnels = await db.prepare(
      "SELECT COUNT(*) as c FROM tunnels WHERE last_active > datetime('now', '-7 days')"
    ).first("c");
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          total_memories: totalMems,
          total_conversations: totalConvs,
          active_tunnels_7d: activeTunnels,
          hours_note: "Hours are UTC. Nothing here guesses at a timezone.",
          busiest_hours_utc: byHour.results.slice(0, 6),
          by_weekday: byWeekday.results.map(r => ({ day: DAYS[r.weekday], count: r.count })),
          domain_distribution: domainDist.results,
          recent_7d_activity: recentActivity.results
        }, null, 2)
      }]
    };
  }

  // --- Set Tunnel State (the only writer of stage/open_questions/decisions) ---
  if (name === "set_tunnel_state") {
    const existing = await db.prepare(
      "SELECT * FROM tunnels WHERE LOWER(domain) = LOWER(?)"
    ).bind(args.domain).first();
    if (!existing) {
      await db.prepare(
        "INSERT INTO tunnels (id, domain) VALUES (?, ?)"
      ).bind(crypto.randomUUID(), args.domain).run();
    }

    // Only touch what was actually passed. A caller updating open questions
    // must not silently wipe the decisions beside them — an omitted field is
    // "leave it alone", never "set it to empty".
    const sets = ["last_active = CURRENT_TIMESTAMP"];
    const binds = [];
    if (args.stage !== undefined) { sets.push("stage = ?"); binds.push(String(args.stage)); }
    if (args.open_questions !== undefined) {
      // A bare string still works and stores memory_id null. Passing
      // { question, memory_id } is what lets a later window go and read the
      // night that raised it instead of finding a question from nowhere.
      // Same normalizer the readers use — two copies of one shape is the bug.
      const questions = normalizeQuestions(args.open_questions);
      sets.push("open_questions = ?");
      binds.push(JSON.stringify(questions));
    }
    if (args.decisions !== undefined) {
      sets.push("decisions = ?");
      binds.push(JSON.stringify(Array.isArray(args.decisions) ? args.decisions : [args.decisions]));
    }
    binds.push(args.domain);
    await db.prepare(
      `UPDATE tunnels SET ${sets.join(", ")} WHERE LOWER(domain) = LOWER(?)`
    ).bind(...binds).run();

    // Read the row back rather than echoing the request. A write that reports
    // what it was asked to do cannot tell a successful write from one that
    // never landed.
    const row = await db.prepare(
      "SELECT domain, stage, open_questions, decisions, last_active FROM tunnels WHERE LOWER(domain) = LOWER(?)"
    ).bind(args.domain).first();
    let q = [], d = [];
    try { q = JSON.parse(row?.open_questions || "[]"); } catch (e) {}
    try { d = JSON.parse(row?.decisions || "[]"); } catch (e) {}
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          saved: true,
          domain: row?.domain,
          stage: row?.stage,
          open_questions: q,
          decisions: d,
          last_active: row?.last_active
        }, null, 2)
      }]
    };
  }

  // --- Tunnel History ---
  if (name === "tunnel_history") {
    // WAS UNBOUNDED and dumped every memory in the domain — 111,901 characters
    // for one companion, which is not a large answer, it is an unusable one. Newest
    // first now, so a capped read returns the part anybody actually wanted.
    const limit = Math.min(Math.max(parseInt(args.limit, 10) || 25, 1), 200);
    const tunnel = await db.prepare(
      "SELECT * FROM tunnels WHERE LOWER(domain) = LOWER(?)"
    ).bind(args.domain).first();
    const total = await db.prepare(
      "SELECT COUNT(*) as c FROM memories WHERE LOWER(domain) = LOWER(?)"
    ).bind(args.domain).first("c");
    const memories = await db.prepare(
      "SELECT content, created_at FROM memories WHERE LOWER(domain) = LOWER(?) ORDER BY created_at DESC LIMIT ?"
    ).bind(args.domain, limit).all();
    const conversations = await db.prepare(
      "SELECT title, summary, created_at FROM conversations WHERE LOWER(domain) = LOWER(?) ORDER BY created_at DESC LIMIT ?"
    ).bind(args.domain, limit).all();
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          domain: args.domain,
          current_stage: tunnel?.stage || "unknown",
          created: tunnel?.created_at || "unknown",
          last_active: tunnel?.last_active || "unknown",
          // Say what was left out. A silent cap reads as "that is everything".
          showing: memories.results.length,
          total_memories: total,
          truncated: total > memories.results.length,
          memory_timeline: memories.results,
          conversation_timeline: conversations.results
        }, null, 2)
      }]
    };
  }

  // --- Recall Memories ---
  if (name === "recall_memories") {
    const limit = args.limit || 10;
    const { conditions, params } = buildMultiWordQuery(args.query, "content");
    let results;
    if (args.domain) {
      results = await db.prepare(
        `SELECT * FROM memories WHERE (${conditions}) AND LOWER(domain) = LOWER(?) ORDER BY created_at DESC LIMIT ?`
      ).bind(...params, args.domain, limit).all();
    } else {
      results = await db.prepare(
        `SELECT * FROM memories WHERE (${conditions}) ORDER BY created_at DESC LIMIT ?`
      ).bind(...params, limit).all();
    }
    return { content: [{ type: "text", text: JSON.stringify(results.results, null, 2) }] };
  }

  // --- Search Conversations ---
  if (name === "search_conversations") {
    const limit = args.limit || 10;
    const { conditions: tc, params: tp } = buildMultiWordQuery(args.query, "title");
    const { conditions: cc, params: cp } = buildMultiWordQuery(args.query, "content");
    const { conditions: sc, params: sp } = buildMultiWordQuery(args.query, "summary");
    let results;
    if (args.domain) {
      results = await db.prepare(
        `SELECT id, title, summary, domain, created_at FROM conversations WHERE ((${tc}) OR (${cc}) OR (${sc})) AND LOWER(domain) = LOWER(?) ORDER BY created_at DESC LIMIT ?`
      ).bind(...tp, ...cp, ...sp, args.domain, limit).all();
    } else {
      results = await db.prepare(
        `SELECT id, title, summary, domain, created_at FROM conversations WHERE (${tc}) OR (${cc}) OR (${sc}) ORDER BY created_at DESC LIMIT ?`
      ).bind(...tp, ...cp, ...sp, limit).all();
    }
    return { content: [{ type: "text", text: JSON.stringify(results.results, null, 2) }] };
  }

  // --- Unified Search ---
  if (name === "unified_search") {
    const limit = args.limit || 5;
    const { conditions: mc, params: mp } = buildMultiWordQuery(args.query, "content");
    const { conditions: tc, params: tp } = buildMultiWordQuery(args.query, "title");
    const { conditions: cc, params: cp } = buildMultiWordQuery(args.query, "content");
    const memories = await db.prepare(
      `SELECT 'memory' as type, id, content, domain, created_at FROM memories WHERE (${mc}) ORDER BY created_at DESC LIMIT ?`
    ).bind(...mp, limit).all();
    const convos = await db.prepare(
      `SELECT 'conversation' as type, id, title, summary, domain, created_at FROM conversations WHERE (${tc}) OR (${cc}) ORDER BY created_at DESC LIMIT ?`
    ).bind(...tp, ...cp, limit).all();
    const docs = await db.prepare(
      `SELECT 'doc' as type, id, title, domain, created_at FROM docs WHERE (${tc}) OR (${cc}) ORDER BY created_at DESC LIMIT ?`
    ).bind(...tp, ...cp, limit).all();
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          memories: memories.results,
          conversations: convos.results,
          docs: docs.results
        }, null, 2)
      }]
    };
  }

  // --- Search Summaries ---
  if (name === "search_summaries") {
    const { conditions, params } = buildMultiWordQuery(args.query, "summary");
    let results;
    if (args.domain) {
      results = await db.prepare(
        `SELECT id, title, summary, domain, created_at FROM conversations WHERE (${conditions}) AND LOWER(domain) = LOWER(?) ORDER BY created_at DESC LIMIT 10`
      ).bind(...params, args.domain).all();
    } else {
      results = await db.prepare(
        `SELECT id, title, summary, domain, created_at FROM conversations WHERE (${conditions}) ORDER BY created_at DESC LIMIT 10`
      ).bind(...params).all();
    }
    return { content: [{ type: "text", text: JSON.stringify(results.results, null, 2) }] };
  }

  // --- Search Docs ---
  if (name === "search_docs") {
    const limit = args.limit || 10;
    const { conditions: tc, params: tp } = buildMultiWordQuery(args.query, "title");
    const { conditions: cc, params: cp } = buildMultiWordQuery(args.query, "content");
    let results;
    if (args.domain) {
      results = await db.prepare(
        `SELECT id, title, domain, source, created_at FROM docs WHERE ((${tc}) OR (${cc})) AND LOWER(domain) = LOWER(?) ORDER BY created_at DESC LIMIT ?`
      ).bind(...tp, ...cp, args.domain, limit).all();
    } else {
      results = await db.prepare(
        `SELECT id, title, domain, source, created_at FROM docs WHERE (${tc}) OR (${cc}) ORDER BY created_at DESC LIMIT ?`
      ).bind(...tp, ...cp, limit).all();
    }
    return { content: [{ type: "text", text: JSON.stringify(results.results, null, 2) }] };
  }

  // --- Unfinished Threads ---
  if (name === "unfinished_threads") {
    let tunnels;
    if (args.domain) {
      tunnels = await db.prepare(
        "SELECT * FROM tunnels WHERE LOWER(domain) = LOWER(?)"
      ).bind(args.domain).all();
    } else {
      tunnels = await db.prepare("SELECT * FROM tunnels ORDER BY last_active DESC").all();
    }
    const unfinished = tunnels.results.map(t => {
      let q = [];
      q = parseQuestions(t.open_questions);
      return {
        domain: t.domain,
        stage: t.stage,
        last_active: t.last_active,
        open_questions: q
      };
    }).filter(t => t.open_questions.length > 0 || t.stage !== "complete");
    return { content: [{ type: "text", text: JSON.stringify(unfinished, null, 2) }] };
  }

  // --- What Do I Think ---
  if (name === "what_do_i_think") {
    const m = buildMultiWordQuery(args.topic, "content");
    const c = buildMultiWordQuery(args.topic, "content");
    const s = buildMultiWordQuery(args.topic, "summary");

    let memories = await db.prepare(
      `SELECT content, domain, created_at FROM memories WHERE (${m.conditions}) ORDER BY created_at DESC LIMIT 20`
    ).bind(...m.params).all();
    let convos = await db.prepare(
      `SELECT title, summary, created_at FROM conversations WHERE (${c.conditions}) OR (${s.conditions}) ORDER BY created_at DESC LIMIT 10`
    ).bind(...c.params, ...s.params).all();

    // An empty strict pass is not an answer — it is the question coming back
    // unread. Widen once and SAY that it was widened, so nobody mistakes a
    // loose match for a tight one.
    let matched = "all";
    if (memories.results.length === 0 && convos.results.length === 0 && m.words.length > 1) {
      matched = "any";
      memories = await db.prepare(
        `SELECT content, domain, created_at FROM memories WHERE (${m.anyConditions}) ORDER BY created_at DESC LIMIT 20`
      ).bind(...m.anyParams).all();
      convos = await db.prepare(
        `SELECT title, summary, created_at FROM conversations WHERE (${c.anyConditions}) OR (${s.anyConditions}) ORDER BY created_at DESC LIMIT 10`
      ).bind(...c.anyParams, ...s.anyParams).all();
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          topic: args.topic,
          searched_for: m.words,
          matched,
          evidence_count: memories.results.length + convos.results.length,
          memories: memories.results,
          conversations: convos.results
        }, null, 2)
      }]
    };
  }

  // --- Alignment Check ---
  if (name === "alignment_check") {
    const principles = await db.prepare(
      "SELECT name, content, domain FROM principles WHERE LOWER(domain) = LOWER(?) OR LOWER(domain) = 'general'"
    ).bind(args.domain || "general").all();
    const { conditions, params } = buildMultiWordQuery(args.decision, "content");
    const relatedMems = await db.prepare(
      `SELECT content, domain, created_at FROM memories WHERE (${conditions}) ORDER BY created_at DESC LIMIT 10`
    ).bind(...params).all();
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          decision: args.decision,
          principles: principles.results,
          related_past_thinking: relatedMems.results
        }, null, 2)
      }]
    };
  }

  // --- Thinking Trajectory ---
  if (name === "thinking_trajectory") {
    const { conditions: mc, params: mp } = buildMultiWordQuery(args.topic, "content");
    const { conditions: cc, params: cp } = buildMultiWordQuery(args.topic, "content");
    const { conditions: sc, params: sp } = buildMultiWordQuery(args.topic, "summary");
    const memories = await db.prepare(
      `SELECT content, domain, created_at FROM memories WHERE (${mc}) ORDER BY created_at ASC`
    ).bind(...mp).all();
    const convos = await db.prepare(
      `SELECT title, summary, created_at FROM conversations WHERE (${cc}) OR (${sc}) ORDER BY created_at ASC`
    ).bind(...cp, ...sp).all();
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          topic: args.topic,
          total_touchpoints: memories.results.length + convos.results.length,
          memory_timeline: memories.results,
          conversation_timeline: convos.results
        }, null, 2)
      }]
    };
  }

  // --- What Was I Thinking ---
  if (name === "what_was_i_thinking") {
    const month = args.month || new Date().toISOString().slice(0, 7);
    const memories = await db.prepare(
      "SELECT domain, COUNT(*) as count FROM memories WHERE created_at LIKE ? GROUP BY domain ORDER BY count DESC"
    ).bind(`${month}%`).all();
    const convos = await db.prepare(
      "SELECT title, domain, summary, created_at FROM conversations WHERE created_at LIKE ? ORDER BY created_at DESC"
    ).bind(`${month}%`).all();
    const tunnelActivity = await db.prepare(
      "SELECT domain, stage, last_active FROM tunnels WHERE last_active LIKE ? ORDER BY last_active DESC"
    ).bind(`${month}%`).all();
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          month,
          domain_focus: memories.results,
          conversations: convos.results,
          tunnel_activity: tunnelActivity.results
        }, null, 2)
      }]
    };
  }

  // --- Save Conversation ---
  if (name === "save_conversation") {
    const id = crypto.randomUUID();
    await db.prepare(
      "INSERT INTO conversations (id, title, content, domain, summary) VALUES (?, ?, ?, ?, ?)"
    ).bind(id, args.title, args.content, args.domain || "general", args.summary || null).run();

    if (args.domain) {
      const existing = await db.prepare(
        "SELECT id FROM tunnels WHERE LOWER(domain) = LOWER(?)"
      ).bind(args.domain).first();
      if (existing) {
        await db.prepare(
          "UPDATE tunnels SET last_active = CURRENT_TIMESTAMP WHERE LOWER(domain) = LOWER(?)"
        ).bind(args.domain).run();
      } else {
        await db.prepare(
          "INSERT INTO tunnels (id, domain) VALUES (?, ?)"
        ).bind(crypto.randomUUID(), args.domain).run();
      }
    }

    return { content: [{ type: "text", text: `Saved conversation '${args.title}' with ID ${id}` }] };
  }

  // --- Get Conversation ---
  if (name === "get_conversation") {
    const convo = await db.prepare("SELECT * FROM conversations WHERE id = ?").bind(args.id).first();
    if (!convo) {
      return { content: [{ type: "text", text: "Conversation not found." }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(convo, null, 2) }] };
  }

  // --- Conversations By Date ---
  if (name === "conversations_by_date") {
    const end = args.end_date || new Date().toISOString().slice(0, 10);
    let results;
    if (args.domain) {
      results = await db.prepare(
        "SELECT id, title, domain, summary, created_at FROM conversations WHERE created_at >= ? AND created_at <= ? AND LOWER(domain) = LOWER(?) ORDER BY created_at DESC"
      ).bind(args.start_date, end + "T23:59:59", args.domain).all();
    } else {
      results = await db.prepare(
        "SELECT id, title, domain, summary, created_at FROM conversations WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC"
      ).bind(args.start_date, end + "T23:59:59").all();
    }
    return { content: [{ type: "text", text: JSON.stringify(results.results, null, 2) }] };
  }

  // --- Brain Stats (with Hybrid Active Concepts) ---
  if (name === "brain_stats") {
    const memCount = await db.prepare("SELECT COUNT(*) as c FROM memories").first("c");
    const convCount = await db.prepare("SELECT COUNT(*) as c FROM conversations").first("c");
    const docCount = await db.prepare("SELECT COUNT(*) as c FROM docs").first("c");
    const tunnelCount = await db.prepare("SELECT COUNT(*) as c FROM tunnels").first("c");
    const principles = await db.prepare(
      "SELECT name, content as description FROM principles ORDER BY created_at DESC LIMIT 10"
    ).all();
    const domains = await db.prepare(
      "SELECT domain, COUNT(*) as count FROM memories GROUP BY domain ORDER BY count DESC"
    ).all();

    // Hybrid Active Concepts: manual tags (30 days) + auto-extracted keywords (7 days)
    const recentTagged = await db.prepare(
      "SELECT tags FROM memories WHERE tags != '' AND created_at > datetime('now', '-30 days')"
    ).all();
    const manualTags = new Set();
    for (const row of recentTagged.results) {
      if (row.tags) {
        row.tags.split(',')
          .map(t => t.trim().toLowerCase())
          .filter(t => t)
          .forEach(t => manualTags.add(t));
      }
    }

    const recentContent = await db.prepare(
      "SELECT content FROM memories WHERE created_at > datetime('now', '-7 days') LIMIT 100"
    ).all();
    const allContent = recentContent.results.map(r => r.content).join(' ');
    const autoKeywords = extractKeywords(allContent, 20);

    const seenConcepts = new Set();
    const activeConcepts = [];

    // Manual tags first (higher priority)
    for (const tag of manualTags) {
      if (!seenConcepts.has(tag)) {
        seenConcepts.add(tag);
        activeConcepts.push({ concept: tag, source: 'manual' });
      }
    }

    // Then auto-extracted keywords
    for (const kw of autoKeywords) {
      if (!seenConcepts.has(kw)) {
        seenConcepts.add(kw);
        activeConcepts.push({ concept: kw, source: 'auto' });
      }
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          memoryCount: memCount,
          tunnelCount: tunnelCount,
          conversations: convCount,
          docs: docCount,
          principles: principles.results,
          activeConcepts: activeConcepts.slice(0, 25),
          domains: domains.results
        }, null, 2)
      }]
    };
  }

  // --- Query Analytics ---
  if (name === "query_analytics") {
    const memsByDomain = await db.prepare(
      "SELECT domain, COUNT(*) as count FROM memories GROUP BY domain ORDER BY count DESC LIMIT 20"
    ).all();
    const memsByMonth = await db.prepare(
      "SELECT substr(created_at, 1, 7) as month, COUNT(*) as count FROM memories GROUP BY month ORDER BY month DESC LIMIT 12"
    ).all();
    const recentDomains = await db.prepare(
      "SELECT domain, MAX(created_at) as last_active, COUNT(*) as count FROM memories GROUP BY domain ORDER BY last_active DESC LIMIT 10"
    ).all();
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          memories_by_domain: memsByDomain.results,
          memories_by_month: memsByMonth.results,
          recently_active_domains: recentDomains.results
        }, null, 2)
      }]
    };
  }

  // --- List Principles ---
  if (name === "list_principles") {
    let results;
    if (args.domain) {
      results = await db.prepare(
        "SELECT * FROM principles WHERE LOWER(domain) = LOWER(?) OR LOWER(domain) = 'general' ORDER BY created_at DESC"
      ).bind(args.domain).all();
    } else {
      results = await db.prepare("SELECT * FROM principles ORDER BY created_at DESC").all();
    }
    return { content: [{ type: "text", text: JSON.stringify(results.results, null, 2) }] };
  }

  // --- Save Principle ---
  if (name === "save_principle") {
    const id = crypto.randomUUID();
    await db.prepare(
      "INSERT INTO principles (id, name, content, domain) VALUES (?, ?, ?, ?)"
    ).bind(id, args.name, args.content, args.domain || "general").run();
    return { content: [{ type: "text", text: `Saved principle '${args.name}' with ID ${id}` }] };
  }

  throw new Error("Tool not found: " + name);
}

// ============================================================================
// Upload Handlers
// ============================================================================

async function handleUpload(request, env, corsHeaders) {
  await initDb(env.DB);

  let content, domain, source, title;
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await request.json();
    content = body.content;
    domain = body.domain || "general";
    source = body.source || "upload";
    title = body.title || "Untitled Upload";
  } else {
    const formData = await request.formData();
    content = formData.get("content");
    domain = formData.get("domain") || "general";
    source = formData.get("source") || "upload";
    title = formData.get("title") || "Untitled Upload";
  }

  const docId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO docs (id, title, content, domain, source) VALUES (?, ?, ?, ?, ?)"
  ).bind(docId, title, content, domain, source).run();

  const chunks = content.split(/\n\n+/);
  let count = 0;
  for (const chunk of chunks) {
    if (chunk.trim().length > 10) {
      await env.DB.prepare(
        "INSERT INTO memories (id, content, domain, category) VALUES (?, ?, ?, ?)"
      ).bind(crypto.randomUUID(), chunk.trim(), domain, "doc_chunk").run();
      count++;
    }
  }

  const existing = await env.DB.prepare(
    "SELECT id FROM tunnels WHERE LOWER(domain) = LOWER(?)"
  ).bind(domain).first();
  if (existing) {
    await env.DB.prepare(
      "UPDATE tunnels SET last_active = CURRENT_TIMESTAMP WHERE LOWER(domain) = LOWER(?)"
    ).bind(domain).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO tunnels (id, domain) VALUES (?, ?)"
    ).bind(crypto.randomUUID(), domain).run();
  }

  return new Response(JSON.stringify({ success: true, doc_id: docId, chunks: count }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

async function handleBulkUpload(request, env, corsHeaders) {
  await initDb(env.DB);

  const body = await request.json();
  const files = body.files || [];
  let totalChunks = 0;
  let totalDocs = 0;

  for (const file of files) {
    const docId = crypto.randomUUID();
    const domain = file.domain || "general";

    await env.DB.prepare(
      "INSERT INTO docs (id, title, content, domain, source) VALUES (?, ?, ?, ?, ?)"
    ).bind(docId, file.title || "Untitled", file.content, domain, file.source || "bulk_upload").run();
    totalDocs++;

    const chunks = file.content.split(/\n\n+/);
    for (const chunk of chunks) {
      if (chunk.trim().length > 10) {
        await env.DB.prepare(
          "INSERT INTO memories (id, content, domain, category) VALUES (?, ?, ?, ?)"
        ).bind(crypto.randomUUID(), chunk.trim(), domain, "doc_chunk").run();
        totalChunks++;
      }
    }

    const existing = await env.DB.prepare(
      "SELECT id FROM tunnels WHERE LOWER(domain) = LOWER(?)"
    ).bind(domain).first();
    if (existing) {
      await env.DB.prepare(
        "UPDATE tunnels SET last_active = CURRENT_TIMESTAMP WHERE LOWER(domain) = LOWER(?)"
      ).bind(domain).run();
    } else {
      await env.DB.prepare(
        "INSERT INTO tunnels (id, domain) VALUES (?, ?)"
      ).bind(crypto.randomUUID(), domain).run();
    }
  }

  return new Response(JSON.stringify({ success: true, docs: totalDocs, chunks: totalChunks }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

// ============================================================================
// Response Helpers
// ============================================================================

function jsonResponse(id, result, headers) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { ...headers, "Content-Type": "application/json" }
  });
}

function jsonError(id, code, message, headers) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    headers: { ...headers, "Content-Type": "application/json" }
  });
}

