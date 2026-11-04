// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { Router } from 'express';
import { isLocalhost } from './local.js';
import { getBattleshipCompanionView, fireAtPlayerFleet, addBattleshipChat, assertFleetCompanion, BattleshipError } from '../../services/db.js';
import { registry } from '../../services/ws.js';

const router = Router();

// ─── Fleet Room (localhost-only) ──────────────────────────────
// The companion lane can see only called coordinates and results. Their person's
// sealed fleet never crosses this route; a shot receives exactly hit, miss, or
// sunk.

router.get('/internal/games/battleship', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  try {
    const gameId = typeof req.query.gameId === 'string' ? req.query.gameId : undefined;
    res.json({ game: getBattleshipCompanionView(gameId) });
  } catch (error) {
    if (error instanceof BattleshipError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post('/internal/games/battleship/fire', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  try {
    const { gameId, companion, coordinate } = req.body as {
      gameId?: string;
      companion?: string;
      coordinate?: string;
    };
    if (!companion || !coordinate) {
      res.status(400).json({ error: 'companion and coordinate are required' });
      return;
    }
    const result = fireAtPlayerFleet(gameId, companion, coordinate);
    registry.broadcast({ type: 'battleship_update', gameId: result.gameId });
    res.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof BattleshipError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.post('/internal/games/battleship/chat', (req, res) => {
  if (!isLocalhost(req)) {
    res.status(403).json({ error: 'Localhost only' });
    return;
  }
  try {
    const { gameId, companion, content } = req.body as {
      gameId?: string;
      companion?: string;
      content?: string;
    };
    if (!companion || !content) {
      res.status(400).json({ error: 'companion and content are required' });
      return;
    }
    const game = addBattleshipChat(gameId, assertFleetCompanion(companion), content);
    registry.broadcast({ type: 'battleship_update', gameId: game.id });
    res.json({ success: true, gameId: game.id });
  } catch (error) {
    if (error instanceof BattleshipError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

export default router;
