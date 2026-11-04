// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import preferencesRoutes from './api/preferences.js';
import threadsRoutes from './api/threads.js';
import messagesRoutes from './api/messages.js';
import messageTtsRoutes from './api/message-tts.js';
import voiceRoutes from './api/voice.js';
import uploadsRoutes from './api/uploads.js';
import canvasesRoutes from './api/canvases.js';
import pushRoutes from './api/push.js';
import artifactsRoutes from './api/artifacts.js';
import { Router } from 'express';
import { settingsForClient } from '../services/settings-view.js';
import { fileIdsInUse } from '../services/file-references.js';
import * as babel from '@babel/core';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';

// Derive project root from this module's location (packages/backend/src/routes/api.ts → ../../../..)
// This is stable regardless of process.cwd(), which npm workspaces can change.

import * as yaml from 'js-yaml';
import { getDb, getAllConfig, searchMessages } from '../services/db.js';
import { loginHandler, logoutHandler, sessionCheckHandler } from '../middleware/auth.js';
import { loginRateLimiter } from '../middleware/security.js';
import { authMiddleware } from '../middleware/auth.js';
import { getRecentAuditEntries } from '../services/audit.js';
import { getFile, listFiles, attachmentFilename } from '../services/files.js';
import { downloadFilename } from '../services/file-names.js';
import { fileThumbnail } from '../services/image-gen.js';
import { persistAgentSetting } from '../services/agent-settings.js';
import { getAerieConfig } from '../config.js';
import type { PushService } from '../services/push.js';
import codexAuthRoutes from './codex-auth.js';
import studioRoutes from './studio.js';
import gifRoutes from './gif.js';
import type { AgentService } from '../services/agent.js';
import { resolveCompatibleAgentRoute } from '../services/agent/agent-route-selection.js';
import { withoutSecrets } from '../services/secrets.js';

const router = Router();
// --- Public routes (no auth) ---

// Health check (public — minimal response)
router.get('/health', (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    memoryUsage: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
    connections: req.app.locals.agentService ? 0 : 0,
  });
});

// Auth endpoints
router.get('/auth/check', sessionCheckHandler);
router.post('/auth/login', loginRateLimiter, loginHandler);
router.post('/auth/logout', logoutHandler);

// Push VAPID public key (no auth — needed before subscription)
router.get('/push/vapid-public', (req, res) => {
  const pushService = req.app.locals.pushService as PushService | undefined;
  const publicKey = pushService?.getVapidPublicKey() || null;
  res.json({ publicKey });
});

// Vendor route moved to server.ts (before CSRF middleware)

// Identity endpoint — companion/user names and timezone for frontend personalization
router.get('/identity', (req, res) => {
  const config = getAerieConfig();
  res.json({
    companion_name: config.identity.companion_name,
    user_name: config.identity.user_name,
    timezone: config.identity.timezone,
  });
});

// File listing (needs auth, moved here to be BEFORE /files/:id)
router.get('/files/list', authMiddleware, (req, res) => {
  try {
    const files = listFiles();
    const db = getDb();
    // One list for both the listing and Clean orphans, so they cannot disagree
    // about what is in use (services/file-references.ts).
    const usedFileIds = fileIdsInUse(db);
    const enriched = files.map(f => ({ ...f, inUse: usedFileIds.has(f.fileId) }));
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const orphanCount = enriched.filter(f => !f.inUse).length;
    res.json({ files: enriched, totalSize, totalCount: files.length, orphanCount });
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// File download — public (UUID provides security, enables direct links/embeds)
// Use UUID pattern to avoid catching /files/list, /files/clean-orphans, etc.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.get('/files/:id', async (req: any, res: any, next: any) => {
  // Skip non-UUID paths (they go to other routes like /files/list)
  const uuid = req.params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
    return next();
  }
  try {
    const file = getFile(uuid);
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    // ?download=1 asks for a save rather than a view. Android's WebView
    // ignores a link's download attribute entirely, so this header is the
    // only signal that reaches the shell's DownloadListener — without it a
    // long-press inside the app just navigates to the picture.
    if (req.query?.download) {
      // Prefer the name the user gave it. Files saved before the name sidecar
      // existed still come back as the bare uuid, and for those a short
      // stamped name stays unique and sorts with its siblings rather than
      // landing in a Downloads folder as a wall of hex.
      const nice = attachmentFilename(downloadFilename(uuid, file.filename, extname(file.path)));
      res.setHeader('Content-Disposition', `attachment; filename="${nice}"`);
      res.sendFile(file.path);
      return;
    }
    // ?w= asks for a small version, same as the gallery. A save always gets
    // the real file, so this only ever answers a view. Unknown widths, gifs
    // and non-images fall through to the original — which is what an older
    // backend does with the parameter anyway, so the phone can ship first.
    const thumbnail = await fileThumbnail(file, req.query?.w);
    if (thumbnail) {
      res.setHeader('Content-Type', 'image/webp');
      res.sendFile(thumbnail);
      return;
    }
    res.sendFile(file.path);
  } catch (error) {
    console.error('Error serving file:', error);
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

// --- Protected routes (auth required when password is set) ---
router.use(authMiddleware);

// Codex OAuth — start/poll/manual-code/logout/cancel under /api/auth/codex
router.use(codexAuthRoutes);

// Studio routes — image generation, reference drawers, gallery
router.use(studioRoutes);

// GIF Lab routes — frame extraction, GIF creation, optimization
router.use(gifRoutes);

// Message search
router.get('/search', (req, res) => {
  try {
    // A repeated parameter arrives as an array, which used to throw on q.trim()
    // or reach searchMessages as something other than a string, so only a
    // plain string is accepted for either.
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    if (!q || q.trim().length === 0) {
      return res.status(400).json({ error: 'Search query required' });
    }
    const threadId = typeof req.query.threadId === 'string' ? req.query.threadId : undefined;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    const { messages: rows, total } = searchMessages({ query: q.trim(), threadId, limit, offset });

    const results = rows.map(row => {
      // Build highlight snippet around match
      const idx = row.content.toLowerCase().indexOf(q.toLowerCase());
      const start = Math.max(0, idx - 40);
      const end = Math.min(row.content.length, idx + q.length + 40);
      const highlight = (start > 0 ? '...' : '') + row.content.slice(start, end) + (end < row.content.length ? '...' : '');

      return {
        messageId: row.id,
        threadId: row.thread_id,
        threadName: row.thread_name,
        role: row.role,
        content: row.content.substring(0, 200),
        highlight,
        createdAt: row.created_at,
      };
    });

    res.json({ results, total });
  } catch (error) {
    console.error('Error searching messages:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Audit log entries
router.get('/audit', (req, res) => {
  try {
    const { limit } = req.query;
    const entries = getRecentAuditEntries(limit ? parseInt(limit as string, 10) : 50);
    res.json({ entries });
  } catch (error) {
    console.error('Error fetching audit log:', error);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// Agent sessions (local transcript reader, ~/.claude/projects)
router.get('/sessions', async (req, res) => {
  try {
    const { limit } = req.query;
    const agentService = req.app.locals.agentService as AgentService;
    const sessions = await agentService.listSessions(limit ? parseInt(limit as string, 10) : 50);
    res.json({ sessions });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// --- Settings & Orchestrator endpoints ---

// Get all config
router.get('/settings', (req, res) => {
  try {
    const config = getAllConfig();
    // Overlay YAML model values so the ModelSelector pill shows the real config
    const aerieCfg = getAerieConfig();
    const autonomousRoute = resolveCompatibleAgentRoute(
      aerieCfg.agent.model_autonomous,
      aerieCfg.agent.routing_autonomous || aerieCfg.agent.routing || 'sdk',
    ).routing;
    config['agent.model'] = aerieCfg.agent.model;
    config['agent.model_autonomous'] = aerieCfg.agent.model_autonomous;
    config['agent.model_pulse'] = aerieCfg.agent.model_pulse;
    config['agent.thinking'] = aerieCfg.agent.thinking;
    config['agent.effort'] = aerieCfg.agent.effort || 'adaptive';
    config['agent.claude_thinking'] = aerieCfg.agent.claude_thinking || aerieCfg.agent.thinking || 'adaptive';
    config['agent.claude_effort'] = aerieCfg.agent.claude_effort || aerieCfg.agent.effort || 'adaptive';
    config['agent.codex_effort'] = aerieCfg.agent.codex_effort || aerieCfg.agent.effort || 'adaptive';
    config['agent.codex_speed'] = aerieCfg.agent.codex_speed || 'standard';
    config['agent.routing'] = aerieCfg.agent.routing || 'sdk';
    config['agent.routing_autonomous'] = autonomousRoute;
    // Provider tracking for the model selector — stored in DB config
    if (!config['agent.provider']) config['agent.provider'] = 'anthropic';
    res.json({ config: settingsForClient(config) });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Update a config value
router.put('/settings', (req, res) => {
  try {
    const { key, value } = req.body;
    console.log(`[Settings] PUT ${key}=${value} (typeof key=${typeof key}, typeof value=${typeof value})`);
    if (!key || typeof key !== 'string' || typeof value !== 'string') {
      console.log(`[Settings] REJECTED: key/value type mismatch`);
      res.status(400).json({ error: 'key and value (strings) required' });
      return;
    }
    // DB row, in-memory config and aerie.yaml all move together — see
    // services/agent-settings.ts for why doing only one of them is a trap.
    persistAgentSetting(key, value);

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating setting:', error);
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

// Get config endpoint — returns companion/user names plus all DB config
router.get('/config', (req, res) => {
  try {
    const aerieConfig = getAerieConfig();
    const dbConfig = withoutSecrets(getAllConfig());
    res.json({
      companion_name: aerieConfig.identity.companion_name,
      user_name: aerieConfig.identity.user_name,
      timezone: aerieConfig.identity.timezone,
      config: dbConfig,
    });
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

// Get skills from agent CWD
router.get('/skills', (req, res) => {
  try {
    const config = getAerieConfig();
    const agentCwd = config.agent.cwd;
    const skillsDir = join(agentCwd, '.claude', 'skills');

    if (!existsSync(skillsDir)) {
      res.json({ skills: [] });
      return;
    }

    const skills: Array<{ name: string; description: string }> = [];
    const dirs = readdirSync(skillsDir, { withFileTypes: true });

    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const skillFile = join(skillsDir, dir.name, 'SKILL.md');
      if (!existsSync(skillFile)) continue;

      const content = readFileSync(skillFile, 'utf-8');

      // Parse YAML frontmatter
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;

      const fm = fmMatch[1];
      const nameMatch = fm.match(/^name:\s*["']?(.+?)["']?\s*$/m);
      const descMatch = fm.match(/^description:\s*["']?(.+?)["']?\s*$/m);

      skills.push({
        name: nameMatch?.[1] || dir.name,
        description: descMatch?.[1] || '',
      });
    }

    res.json({ skills });
  } catch (error) {
    console.error('Error reading skills:', error);
    res.status(500).json({ error: 'Failed to read skills' });
  }
});

/** Call after loadConfig() to mount Command Center routes */
router.use(preferencesRoutes);
router.use(threadsRoutes);
router.use(messagesRoutes);
router.use(messageTtsRoutes);
router.use(voiceRoutes);
router.use(uploadsRoutes);
router.use(canvasesRoutes);
router.use(pushRoutes);
router.use(artifactsRoutes);

export async function initCcRoutes() {
  try {
    if (getAerieConfig().command_center?.enabled) {
      const { default: ccRoutes } = await import('./cc-routes.js');
      router.use('/cc', ccRoutes);
      console.log('[CC] Command Center routes mounted');
    }
  } catch (error) {
    console.warn('[CC] Failed to mount Command Center routes:', (error as Error).message);
  }
}

router.get('/usage/antigravity', async (req, res) => {
  try {
    const { getAntigravityUsage } = await import('../services/antigravity-usage.js');
    res.json(await getAntigravityUsage());
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Antigravity usage unavailable',
    });
  }
});

// Wipe cached TTS audio. With no body, clears every cached file —
// useful when the splitter changed and you want existing messages
// re-generated under the new rules. With { messageId }, clears one.

export default router;
