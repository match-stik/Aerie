// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createServer } from 'http';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import { loadConfig, updateConfigValue } from './config.js';
import { initDb, deleteExpiredSessions, getAllConfig } from './services/db.js';
import { loadVectorCache } from './services/vector-cache.js';
import { startCortexMemoryIndex } from './services/cortex-memory-index.js';
import { refreshSelfKnowledgeIndex } from './services/self-knowledge-index.js';
import { startMemoryRounds } from './services/memory-rounds.js';
import { createWebSocketServer, setVoiceService, setGatewayServices, registry } from './services/ws.js';
import { Orchestrator } from './services/orchestrator.js';
import { AgentService } from './services/agent.js';
import { VoiceService } from './services/voice.js';
import { PushService, setPushService } from './services/push.js';
import { DiscordService } from './services/discord/index.js';
import { TelegramService } from './services/telegram/index.js';
import { rateLimiter, securityHeaders } from './middleware/security.js';
import { csrfProtection } from './middleware/csrf.js';
import apiRoutes, { initCcRoutes } from './routes/api.js';
import pressRoutes from './routes/press.js';
import mediaRoutes from './routes/media.js';
import cortexRoutes from './routes/cortex.js';
import usageRoutes from './routes/usage.js';
import stickerRoutes from './routes/stickers.js';
import emojiRoutes from './routes/emojis.js';
import modelsRoutes from './routes/models.js';
import { directLocalCheck } from './middleware/internal-guard.js';
import { authMiddleware } from './middleware/auth.js';
import { collapseDuplicateSlashes } from './middleware/normalize-path.js';
import { startInternalServer } from './internal-server.js';
import { startLaneKeeper } from './services/heartbeat/lane-keeper.js';
import discordAdminRoutes from './routes/discord-admin.js';
import orchestratorAdminRoutes from './routes/orchestrator-admin.js';
import xrayRoutes from './routes/xray.js';
import { getStickersDir } from './services/sticker-admin.js';

// Load config FIRST — before any other initialization
const config = loadConfig();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = config.server.port;
const HOST = config.server.host;
// The internal surface gets its own loopback port. Nothing fronts it, so being
// able to open the socket is what proves a caller is on the box.
const INTERNAL_PORT = config.server.internal_port;
const DB_PATH = config.server.db_path;

// Ensure data directory exists
const dataDir = dirname(DB_PATH);
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

// Ensure files directory exists
const filesDir = join(dataDir, 'files');
if (!existsSync(filesDir)) {
  mkdirSync(filesDir, { recursive: true });
}

// Initialize database
console.log('Initializing database...');
const db = initDb(DB_PATH);
deleteExpiredSessions();
console.log('Database initialized');

// Sync DB config to in-memory config (DB values override YAML defaults)
const dbConfig = getAllConfig();
for (const [key, value] of Object.entries(dbConfig)) {
  if (key.startsWith('agent.') && typeof value === 'string') {
    updateConfigValue(key, value);
    console.log(`[Config] Synced from DB: ${key}=${value}`);
  }
}

// Load vector cache for fast semantic search
loadVectorCache();
startCortexMemoryIndex();
void refreshSelfKnowledgeIndex();
startMemoryRounds();


// Create Express app
const app = express();

// Trust proxy headers (e.g. Cloudflare tunnel, nginx)
app.set('trust proxy', 1);

// Environment-conditional origins
const IS_DEV = process.env.NODE_ENV !== 'production';
const corsOrigins: string[] = [...config.cors.origins, `http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];
if (IS_DEV) corsOrigins.push('http://localhost:5173', 'http://localhost:5174');

// data:/blob: — the image-upload path fetch()es a data: URL to turn it
// into a blob before posting it; the emoji creator does the same with a
// cropped image. Without these, connect-src blocks that fetch.
const connectSrc: string[] = [
  "'self'",
  "https://api.giphy.com",
  // Phone calls ElevenLabs straight from the browser for per-message
  // "Read aloud" — without this CSP refuses the fetch.
  "https://api.elevenlabs.io",
  // Weather widget
  "https://api.open-meteo.com",
  // Artifacts viewer loads Babel from unpkg (needs source maps)
  "https://unpkg.com",
  // GIF Lab background removal — @imgly/background-removal fetches model files
  "https://staticimgly.com",
  "data:",
  "blob:",
];
// Add all MCP server URLs to CSP so Studio can call them directly
try {
  const { listMcpServers } = await import('./services/db.js');
  for (const server of listMcpServers()) {
    if (server.url && server.enabled) {
      try {
        const url = new URL(server.url);
        connectSrc.push(`${url.protocol}//${url.host}`);
      } catch { /* skip invalid URLs */ }
    }
  }
} catch { /* db not ready yet — will work after restart */ }
// Derive WebSocket connect sources from CORS origins
for (const origin of config.cors.origins) {
  const wsOrigin = origin.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
  connectSrc.push(wsOrigin);
}
if (IS_DEV) connectSrc.push(`ws://localhost:${PORT}`);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc,
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://unpkg.com", "blob:"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      mediaSrc: ["'self'", "blob:", "data:"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      frameSrc: ["'self'", "blob:"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      workerSrc: ["'self'", "blob:"],
      // Served over plain HTTP on a private network (Tailscale/LAN); the
      // helmet default would rewrite every asset request to https:// and
      // break loading. A TLS-terminating proxy makes this a no-op anyway.
      upgradeInsecureRequests: null,
    }
  },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  // Helmet 8 turns on COEP: require-corp by default, which makes the
  // browser refuse any cross-origin image (Giphy, contact avatars, etc.)
  // unless the remote CDN serves a CORP header — Giphy doesn't, so the
  // GIF picker and contact cards render as broken icons. Turn it off.
  crossOriginEmbedderPolicy: false,
}));

app.use(securityHeaders);
app.use(rateLimiter);

// CORS
app.use(cors({
  origin: corsOrigins,
  credentials: true,
}));

// Body parsing. /api/app-settings parses its own body (25 MB — wallpaper
// slideshows); if the global parser ran first its 10 MB limit would win
// and big settings blobs die before the route's parser ever sees them.
const globalJson = express.json({ limit: '10mb' });
app.use((req, res, next) => (req.path === '/api/app-settings' ? next() : globalJson(req, res, next)));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Vendor assets for artifact viewer — completely public, no CSRF/auth (loaded by iframe)
// Mounted at /vendor (NOT /api/vendor) to avoid auth middleware interference
const vendorDir = join(dataDir, 'vendor');
const ALLOWED_VENDOR_FILES = ['react.production.min.js', 'react-dom.production.min.js'];
app.use('/vendor', express.static(vendorDir, {
  setHeaders: (res, path) => {
    if (ALLOWED_VENDOR_FILES.some(f => path.endsWith(f))) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

// Collapse duplicate slashes in the request PATH before routing, so a doubled
// slash cannot slip a request past a prefix-mounted gate. See normalize-path.ts.
app.use((req, _res, next) => {
  req.url = collapseDuplicateSlashes(req.url);
  next();
});

// CSRF protection (after body parsing, before routes)
app.use('/api', csrfProtection);

// Password gate for the four admin namespaces below.
//
// Cortex, Discord-admin, Orchestrator-admin and X-Ray each mount at the broad
// '/api' prefix and BEFORE apiRoutes — so apiRoutes' own auth (routes/api.ts,
// `router.use(authMiddleware)`) never runs on them. Until 2026-08-16 that left
// ~60 admin endpoints (reads, writes, deletes, toggles, prompt edits) answering
// anonymously on the public front. Confirmed live on the house: all four returned
// 200 to an unauthenticated request through the reverse proxy while /api/preferences,
// which lives past apiRoutes' gate, correctly returned 401.
//
// The gate is PREFIX-SCOPED, not a bare '/api' middleware: mounting authMiddleware
// at '/api' here would also 401 the intentionally-public login and file routes,
// which sit before apiRoutes' own gate. Scoping to the exact namespaces these
// routers wholly own touches nothing public. Verified: none of these prefixes has
// a route in api.ts's pre-auth section, and each router is self-contained under
// its prefix (the only strays are orchestrator-admin's /telegram + /voice toggles,
// gated on their own handlers). authMiddleware passes through when no password is
// set, so a keyless install is unchanged.
//
// UPDATE 2026-09-30, and it cost a login outage to learn: a doubled slash
// ('/api//cortex/...') missed these prefix gates but still reached the router at
// '/api'. The FIX is the slash-collapse middleware above, which runs before any
// /api mount so these prefix gates always see the normal path. Do NOT "harden"
// this by putting router.use(authMiddleware) inside cortex/discord-admin/
// orchestrator-admin/xray/media: they are mounted at the broad '/api' AHEAD of
// apiRoutes, so an unscoped gate there runs on every /api request and 401s the
// public login, health and file routes for everyone. That exact change shipped
// and was reverted the same morning. routes/api-gate-order.test.ts holds all
// three rules: prefix mounts present, collapse first, no unscoped gate upstream.
app.use('/api/cortex', authMiddleware);
app.use('/api/discord', authMiddleware);
app.use('/api/orchestrator', authMiddleware);
app.use('/api/xray', authMiddleware);

app.use('/api', cortexRoutes);

// Internal routes are NOT on this app any more — they listen on their own
// loopback port that nothing fronts, so being able to reach them is the proof
// rather than the absence of proxy headers. See internal-server.ts.
//
// This handler stands where they used to. Without it the address would fall to
// the SPA fallback and answer 200 with index.html, and a local caller on the
// old port would get a page instead of an error. A direct-local caller is told
// where the door moved to; everyone else gets the same 404 the guard gave them,
// so the port is not announced to the internet.
app.use('/api/internal', (req, res) => {
  const verdict = directLocalCheck(req as unknown as Parameters<typeof directLocalCheck>[0]);
  if (!verdict.ok) {
    console.warn(`[internal-guard] refused ${req.method} ${req.originalUrl} — ${verdict.why}`);
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.status(410).json({
    error: 'The internal routes moved to their own loopback port',
    port: INTERNAL_PORT,
    hint: `http://127.0.0.1:${INTERNAL_PORT}${req.originalUrl}`,
  });
});

// Discord admin routes
app.use('/api', discordAdminRoutes);

// Orchestrator admin routes (includes telegram/voice toggles)
app.use('/api', orchestratorAdminRoutes);

// X-Ray panel routes
app.use('/api', xrayRoutes);

// All API routes — auth middleware is applied selectively inside the router
app.use('/api', apiRoutes);
app.use('/api', usageRoutes);
app.use('/api', modelsRoutes);
import mcpServerRoutes from './routes/mcp-servers.js';
app.use('/api', mcpServerRoutes);
import secretsRoutes from './routes/secrets.js';
app.use('/api', secretsRoutes);
import settingsRoutes from './routes/settings.js';
app.use('/api', settingsRoutes);
import notesRoutes from './routes/notes.js';
app.use('/api/notes', notesRoutes);
app.use('/api/press', pressRoutes);
import journalRoutes from './routes/journal.js';
app.use('/api/journal', journalRoutes);
// An unmounted router does not fail loudly — the SPA fallback answers the API
// address with index.html, so the phone gets a 200 full of HTML and guesses
// "the backend needs a restart". Every one of these four was lost that way on
// Aug 2 2026 and no restart could ever have fixed it. If you touch this block,
// probe the addresses afterwards; a green build proves nothing here.
import lettersRoutes from './routes/letters.js';
app.use('/api/letters', lettersRoutes);
import appShellRoutes from './routes/app.js';
app.use('/api/app', appShellRoutes);
import petRoutes from './routes/pet.js';
import compactionRoutes from './routes/compactions.js';
app.use('/api/pet', petRoutes);
// Compactions: the squash-and-carry-on event, which is invisible to the owner
// everywhere else in this house.
app.use('/api/compactions', compactionRoutes);
// Crash reports from the phone's error boundary, one bounded line each.
import clientErrorRoutes from './routes/client-errors.js';
app.use('/api/client-errors', clientErrorRoutes);

import thresholdRoutes from './routes/thresholds.js';
app.use('/api/thresholds', thresholdRoutes);
// The Story Shelf: the owner reads, walks into books and makes the moves here;
// the companions write through /api/internal/story-shelf on the loopback port.
import storyShelfRoutes from './routes/story-shelf.js';
app.use('/api/story-shelf', storyShelfRoutes);
import selfKnowledgeRoutes from './routes/self-knowledge.js';
app.use('/api/self-knowledge', selfKnowledgeRoutes);
import companionsRoutes from './routes/companions.js';

// The owner's phone posting what it is playing. Prefix-scoped guard registered
// BEFORE the mount, same as the other gated groups — express runs
// middleware in registration order, so position is load-bearing.
app.use('/api/media', authMiddleware);
app.use('/api', mediaRoutes);

import battleshipRoutes from './routes/battleship.js';
app.use('/api/games/battleship', battleshipRoutes);
import cardRoutes from './routes/cards.js';
app.use('/api/games/cards', cardRoutes);
import memoryBlocksRoutes from './routes/memory-blocks.js';
import treehouseRoutes from './routes/treehouse.js';
import handoffRoutes from './routes/handoff.js';
import { initMemoryBlocks, seedDefaultBlocks, ensureCompanionBlocks } from './services/memory-blocks.js';
import { startMemoryExtraction, stopMemoryExtraction } from './services/memory-extraction.js';
import { listCompanions } from './services/db/companions.js';
import { initHandoff } from './services/handoff.js';
import { initMemoryProposals } from './services/memory-proposals.js';
import { shutdownAllHeartbeats } from './services/heartbeat/supervisor.js';

app.use('/api', companionsRoutes);
app.use('/api/stickers', stickerRoutes);
app.use('/api/emojis', emojiRoutes);
// Initialize new services
initMemoryBlocks();
initMemoryProposals();
initHandoff();
try {
  const memoryCompanions = listCompanions().map(c => ({ slug: c.slug, display_name: c.display_name }));
  seedDefaultBlocks(config.identity.user_name, memoryCompanions);
  ensureCompanionBlocks(memoryCompanions);
} catch (err) {
  console.warn('[MemoryBlocks] Companion seeding skipped:', err instanceof Error ? err.message : err);
}

// New services routes
app.use('/api', memoryBlocksRoutes);
app.use('/api', treehouseRoutes);
app.use('/api', handoffRoutes);

// Command Center endpoints
if (config.command_center.enabled) {
  import('./routes/cc-mcp.js').then(m => app.use('/mcp/cc', m.default));
  initCcRoutes();
}

// Serve sticker files statically
app.use('/stickers', express.static(getStickersDir()));

// Serve emoji files statically
app.use('/emojis', express.static(join(dataDir, 'emojis')));

// Serve the phone PWA's static build. An earlier Svelte client lived under
// packages/frontend behind a WEB_CLIENT switch; both were removed. The phone
// is the only client now.
const clientCandidates = [
  join(__dirname, '../../phone/dist'),           // From compiled dist/
  join(__dirname, '../../../packages/phone/dist'), // From src/ via tsx
];
const clientBuildPath = clientCandidates.find((p) => existsSync(p));
if (clientBuildPath) {
  console.log(`Serving phone client from: ${clientBuildPath}`);
  app.use(express.static(clientBuildPath));
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(join(clientBuildPath, 'index.html'));
  });
} else {
  console.log(`No phone build found — run 'npm run build' or use the Vite dev server`);
}

// Global error handler — must be after all routes
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Create HTTP server
const server = createServer(app);

// Initialize agent service (shared between WebSocket and orchestrator)
const agentService = new AgentService();

// Initialize voice service
const voiceService = new VoiceService();
setVoiceService(voiceService);

// Initialize push service — VAPID secrets come from the DB (with env-var
// fallback in getSecret), so constructor args are unused now.
const pushService = new PushService();
agentService.setPushService(pushService);
// The module singleton is the one the CLI lane reads (agent-router-query asks
// getPushService() after every companion message). Without this line it stays
// null and every push is skipped in silence — no throw, no log, no clue.
setPushService(pushService);

// Initialize Discord gateway (config-gated with env / DB-secret fallback)
import { getConfigBool } from './services/db.js';
import { getSecret } from './services/secrets.js';

// The service objects always exist on app.locals so /api/secrets PUT can
// call start()/stop() on them after the user sets a token in the UI; they
// just don't start polling until a token is available.
const discordEnabled = getConfigBool('discord.enabled', config.discord.enabled);
const discordService: DiscordService | null = discordEnabled
  ? new DiscordService(agentService, registry)
  : null;
if (discordService && getSecret('discord_bot_token')) {
  discordService.start();
}

const telegramEnabled = getConfigBool('telegram.enabled', config.telegram.enabled);
const telegramService: TelegramService | null = telegramEnabled
  ? new TelegramService(agentService, registry, voiceService)
  : null;
if (telegramService && getSecret('telegram_bot_token')) {
  telegramService.start();
}

// Initialize orchestrator — respects DB flag (the UI toggle writes here)
const orchestratorEnabled = getConfigBool('orchestrator.enabled', config.orchestrator.enabled);
const orchestrator = new Orchestrator(agentService, pushService);
if (orchestratorEnabled) {
  orchestrator.start();
}

// The Archivist — periodic per-companion memory extraction from threads
startMemoryExtraction(agentService);

// Lane keeper — when agent.multi_lane is on, keeps every companion's own
// CLI lane warm so owned bells ring at their own doors. Warms only; never
// kills. Reads the flag fresh each tick, so a settings save flips it live.
startLaneKeeper();

// Make orchestrator, agent, voice, push, and discord services available to route handlers
app.locals.orchestrator = orchestrator;
app.locals.agentService = agentService;
app.locals.voiceService = voiceService;
app.locals.pushService = pushService;
app.locals.discordService = discordService;
app.locals.telegramService = telegramService;

// Wire gateway services for status reporting
setGatewayServices({ discord: discordService, telegram: telegramService });

// Attach WebSocket server
console.log('Initializing WebSocket server...');
const wss = createWebSocketServer(server, agentService, orchestrator);
console.log('WebSocket server initialized');

// Start server — hand the internal app the same live services the public
// app carries, or its routes answer "not configured" for healthy services.
const internalServer = startInternalServer(INTERNAL_PORT, {
  orchestrator,
  agentService,
  voiceService,
  pushService,
  discordService,
  telegramService,
});

server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Auth enabled: ${config.auth.password ? 'yes' : 'no'}`);
  console.log(`Companion: ${config.identity.companion_name} | User: ${config.identity.user_name}`);
});

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  console.log(`${signal} received, shutting down gracefully...`);
  // Abort any active agent query first — prevents orphaned agent subprocesses
  agentService.stopGeneration();
  shutdownAllHeartbeats(); // kill warm interactive CLI sessions so they don't orphan
  orchestrator.stop();
  stopMemoryExtraction();
  if (discordService) await discordService.stop();
  if (telegramService) await telegramService.stop();
  internalServer.close();
  wss.clients.forEach(ws => ws.close());
  wss.close();
  server.close(() => {
    console.log('Server closed');
    db.close();
    process.exit(0);
  });
  // Safety net: force exit if graceful close takes too long
  setTimeout(() => {
    console.log('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 8000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
