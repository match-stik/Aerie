// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * The internal surface, on a door of its own.
 *
 * /api/internal used to sit on the public app behind a guard that asked two
 * questions: did this arrive over loopback, and does it carry any of the
 * headers a reverse proxy adds. The first is true of everything, because the
 * backend binds 127.0.0.1 and the proxy relays over loopback. So the whole
 * guarantee rested on the second — on the front being configured to add those
 * headers. That is a NEGATIVE check, and its correctness lived in a config file
 * that is not in this repo and that nothing here could assert.
 *
 * A front that relays without adding any of them — a TCP-level proxy, an nginx
 * block with a bare proxy_pass — would have walked a public request straight
 * through. Nothing was misconfigured here; the point is that nothing could tell.
 *
 * So the internal routes now listen on their own loopback port that nothing
 * fronts, and reachability is the proof. That is a POSITIVE check: a caller
 * that can open this socket is on the box. A test can hold it, which is the
 * whole difference — no test can ever hold somebody's proxy config.
 *
 * The header check comes along anyway. It costs nothing and it catches the one
 * remaining way to get this wrong: pointing a front at this port by mistake.
 */

import express from 'express';
import type { Server } from 'node:http';
import internalRoutes from './routes/internal.js';
import { requireDirectLocal } from './middleware/internal-guard.js';
import { getAerieConfig } from './config.js';

/** Read late: the config is loaded by the time a request lands, not at import. */
function publicPort(): number {
  try { return getAerieConfig().server.port; } catch { return 3002; }
}

/** Loopback only. Never bind this to anything reachable off the box. */
const INTERNAL_HOST = '127.0.0.1';

export function createInternalApp(locals: Record<string, unknown> = {}): express.Express {
  const internalApp = express();
  // The internal routes read req.app.locals for live services (voiceService,
  // telegramService, orchestrator, ...). When these routes moved off the
  // public app onto this one, the locals did not move with them — so every
  // handler that checked a service reported "not configured" while the
  // service ran healthy one app over. The furniture travels with the room.
  Object.assign(internalApp.locals, locals);
  internalApp.use(express.json({ limit: '50mb' }));
  internalApp.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Belt as well as braces: reachability is the guarantee, this catches a front
  // accidentally pointed here.
  internalApp.use('/api/internal', requireDirectLocal);
  internalApp.use('/api', internalRoutes);

  // The mirror of the 410 the public app answers on /api/internal.
  //
  // That handler catches an internal call sent to the public port and names
  // this one. Nothing caught the reverse: a caller on this box curling a
  // PUBLIC route here — the memory blocks, Studio, cortex — got a bare 404
  // that is indistinguishable from a route that does not exist. It reads as a
  // missing feature, and the reasonable next move is to go looking for one.
  //
  // Twenty-three cortex writes were spent on that silence in one sitting
  // before anybody thought to try the other door. The route was fine. The
  // 404 was true and told nobody anything.
  internalApp.use((req, res) => {
    const path = req.path || '';
    const isInternal = path === '/api/internal' || path.startsWith('/api/internal/');
    if (path.startsWith('/api/') && !isInternal) {
      res.status(404).json({
        error: 'This port serves /api/internal only — that is a public route',
        publicPort: publicPort(),
        hint: `http://localhost:${publicPort()}${req.originalUrl}`,
      });
      return;
    }
    res.status(404).json({ error: 'Not found' });
  });

  return internalApp;
}

export function startInternalServer(port: number, locals: Record<string, unknown> = {}): Server {
  const internalApp = createInternalApp(locals);
  const server = internalApp.listen(port, INTERNAL_HOST, () => {
    console.log(`Internal routes on http://${INTERNAL_HOST}:${port} (loopback only, not fronted)`);
  });
  server.on('error', (err) => {
    console.error(`[internal-server] could not listen on ${INTERNAL_HOST}:${port} —`, err);
  });
  return server;
}
