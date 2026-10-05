// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * Companion CRUD + thread assignment endpoints.
 * Part of Full Aerie Mode.
 */
import { Router } from 'express';
import {
  createCompanion,
  getCompanion,
  getCompanionBySlug,
  getPrimaryCompanion,
  listCompanions,
  updateCompanion,
  deleteCompanion,
  assignCompanionToThread,
  removeCompanionFromThread,
  getThreadCompanions,
} from '../services/db/companions.js';
import { authMiddleware } from '../middleware/auth.js';
import { getOwnerCard, updateOwnerCard } from '../services/owner-card.js';
import { getAerieConfig, getOwnerSlug } from '../config.js';

const router = Router();

// ─── Companion CRUD ───────────────────────────────────────────────

router.get('/companions', authMiddleware, (req, res) => {
  try {
    const companions = listCompanions();
    // The owner belongs to "who lives here" too — the phone renders their name
    // beside the companions' in Letters and the Treehouse, and neither view
    // should have the house-builder's name compiled into it.
    const { user_name: userName, cast_labels: castLabels } = getAerieConfig().identity;
    res.json({
      companions,
      owner: { slug: getOwnerSlug(), name: userName || 'You' },
      castLabels,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// The owner's card. Declared BEFORE /companions/:id on purpose — express
// matches in registration order, and 'owner-card' is a perfectly good :id.
router.get('/owner-card', authMiddleware, (_req, res) => {
  try {
    const { user_name: userName } = getAerieConfig().identity;
    res.json({ card: getOwnerCard(), slug: getOwnerSlug(), name: userName || 'You' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/owner-card', authMiddleware, (req, res) => {
  try {
    res.json({ card: updateOwnerCard(req.body || {}) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/companions/:id', authMiddleware, (req, res) => {
  try {
    const companion = getCompanion(req.params.id as string) || getCompanionBySlug(req.params.id as string);
    if (!companion) return res.status(404).json({ error: 'Companion not found' });
    res.json({ companion });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/companions', authMiddleware, (req, res) => {
  try {
    const { slug, displayName, archetype, claudeMdPath, mcpJsonPath, model, modelAutonomous, avatarUrl, color, emoji, isPrimary } = req.body;
    if (!slug || !displayName) {
      return res.status(400).json({ error: 'slug and displayName are required' });
    }
    // Idempotent: if a companion with this slug already exists, return it
    // instead of failing on the UNIQUE constraint. The phone fires Register
    // again whenever the local registeredSlugs cache misses, and the user
    // shouldn't see a spurious error.
    const existing = getCompanionBySlug(slug);
    if (existing) {
      return res.status(200).json({ companion: existing, alreadyExists: true });
    }
    // CLAUDE.md and .mcp.json paths default to the global aerie.yaml values
    // so a phone-side "register this contact as a companion" call only needs
    // slug + displayName. The companion shares the global system prompt and
    // MCP server set unless the user explicitly points it elsewhere.
    const cfg = getAerieConfig();
    const resolvedClaudeMd = claudeMdPath || cfg.agent.claude_md_path;
    const resolvedMcpJson = mcpJsonPath || cfg.agent.mcp_json_path;
    if (!resolvedClaudeMd || !resolvedMcpJson) {
      return res.status(400).json({
        error: 'No default CLAUDE.md / .mcp.json path configured. Set agent.claude_md_path and agent.mcp_json_path in aerie.yaml, or pass them in the request body.',
      });
    }
    const companion = createCompanion({
      slug,
      displayName,
      archetype,
      claudeMdPath: resolvedClaudeMd,
      mcpJsonPath: resolvedMcpJson,
      model,
      modelAutonomous,
      avatarUrl,
      color,
      emoji,
      isPrimary,
    });
    // Splitter caches the companion list at construction; it re-reads on
    // refresh(). Without this nudge, a freshly registered contact's voice
    // ID would route to the default voice until the next server restart.
    try {
      const vs = req.app.locals.voiceService as { refresh?: () => void } | undefined;
      vs?.refresh?.();
    } catch { /* non-fatal */ }
    res.status(201).json({ companion });
  } catch (e: any) {
    console.error('[Companions] POST failed:', e);
    res.status(500).json({ error: e?.message || String(e) });
  }
});

router.patch('/companions/:id', authMiddleware, (req, res) => {
  try {
    const ok = updateCompanion(req.params.id as string, req.body);
    if (!ok) return res.status(404).json({ error: 'Companion not found' });
    const companion = getCompanion(req.params.id as string);
    try {
      const vs = req.app.locals.voiceService as { refresh?: () => void } | undefined;
      vs?.refresh?.();
    } catch { /* non-fatal */ }
    res.json({ companion });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/companions/:id', authMiddleware, async (req, res) => {
  try {
    // Accept either a UUID or a slug — the phone deletes by slug after
    // unregistering, and asking it to look up the UUID first just for the
    // delete call is friction without payoff.
    const idOrSlug = req.params.id as string;
    const target = getCompanion(idOrSlug) || getCompanionBySlug(idOrSlug);
    const ok = target ? deleteCompanion(target.id) : false;
    if (!ok) return res.status(404).json({ error: 'Companion not found' });
    // Drop the per-companion voice secret too — the row in the secrets
    // list is keyed on the slug, and leaving it behind would re-surface
    // as an orphan.
    try {
      if (target?.slug) {
        const { deleteSecret } = await import('../services/secrets.js');
        deleteSecret(`elevenlabs_voice_id:${target.slug}`);
        deleteSecret(`elevenlabs_voice_settings:${target.slug}`);
      }
    } catch { /* non-fatal */ }
    try {
      const vs = req.app.locals.voiceService as { refresh?: () => void } | undefined;
      vs?.refresh?.();
    } catch { /* non-fatal */ }
    res.json({ success: true });
  } catch (e: any) {
    if (e.message?.includes('primary')) {
      return res.status(400).json({ error: e.message });
    }
    res.status(500).json({ error: e.message });
  }
});

// ─── Thread-Companion Assignment ──────────────────────────────────

router.get('/threads/:threadId/companions', authMiddleware, (req, res) => {
  try {
    const companions = getThreadCompanions(req.params.threadId as string);
    res.json({ companions });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/threads/:threadId/companions', authMiddleware, (req, res) => {
  try {
    const { companionId, role, canInitiate } = req.body;
    if (!companionId) return res.status(400).json({ error: 'companionId required' });
    assignCompanionToThread(req.params.threadId as string, companionId, role || 'participant', canInitiate !== false);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/threads/:threadId/companions/:companionId', authMiddleware, (req, res) => {
  try {
    removeCompanionFromThread(req.params.threadId as string, req.params.companionId as string);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/voice/reset-all', authMiddleware, async (req, res) => {
  try {
    const all = listCompanions();
    let removed = 0;
    for (const c of all) {
      try {
        if (c.is_primary) continue; // deleteCompanion would throw
        const ok = deleteCompanion(c.id);
        if (ok) removed++;
      } catch { /* skip primary */ }
    }
    const { deleteSecret, listSecretsByPrefix } = await import('../services/secrets.js');
    const voiceIds = listSecretsByPrefix('elevenlabs_voice_id:');
    const voiceSettings = listSecretsByPrefix('elevenlabs_voice_settings:');
    let secretsRemoved = 0;
    for (const key of Object.keys(voiceIds)) { deleteSecret(key); secretsRemoved++; }
    for (const key of Object.keys(voiceSettings)) { deleteSecret(key); secretsRemoved++; }
    try {
      const vs = req.app.locals.voiceService as { refresh?: () => void } | undefined;
      vs?.refresh?.();
    } catch { /* non-fatal */ }
    res.json({ success: true, companionsRemoved: removed, secretsRemoved });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

export default router;
