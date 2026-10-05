// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import { parse as parseCookie } from 'cookie';
import type { IncomingMessage, Server as HTTPServer } from 'http';
import type { Socket } from 'net';
import type { WebSocketServer } from 'ws';
import { getAerieConfig } from '../../config.js';
import { getWebSession } from '../db.js';

const COOKIE_NAME = 'aerie_session';

function getAllowedOrigins(): string[] {
  const config = getAerieConfig();
  const port = config.server.port;
  const origins = new Set<string>([
    'http://localhost:5173',
    'http://localhost:5174',
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    'capacitor://localhost',
    'tauri://localhost',
  ]);
  for (const o of config.cors.origins) {
    origins.add(o);
  }
  return Array.from(origins);
}

export function registerWebSocketUpgradeHandler(server: HTTPServer, wss: WebSocketServer): void {
  const config = getAerieConfig();
  const appPassword = config.auth.password;

  server.on('upgrade', (request: IncomingMessage, socket, head) => {
    const origin = request.headers.origin;
    const allowedOrigins = getAllowedOrigins();

    // An Origin whose host matches the Host header is same-origin: the page
    // was served by this very server, so it is safe whatever hostname or IP
    // (e.g. a Tailscale address) the client used to reach it.
    let sameOrigin = false;
    if (origin) {
      try {
        sameOrigin = new URL(origin).host === request.headers.host;
      } catch {
        sameOrigin = false;
      }
    }
    const isOriginAllowed = !!origin && (allowedOrigins.includes(origin) || sameOrigin);

    // Allow localhost connections without origin (CLI tools, internal)
    const remoteAddr = (socket as Socket).remoteAddress || '';
    const isLocalhost = remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';

    // Validate origin — require valid origin for non-localhost connections
    if (!isLocalhost) {
      if (!isOriginAllowed) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
    } else if (origin && !isOriginAllowed) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    // Validate session if password is set
    if (appPassword) {
      const cookieHeader = request.headers.cookie;
      if (!cookieHeader) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const cookies = parseCookie(cookieHeader);
      const sessionToken = cookies[COOKIE_NAME];

      if (!sessionToken) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const session = getWebSession(sessionToken);
      if (!session || new Date(session.expires_at) < new Date()) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });
}
