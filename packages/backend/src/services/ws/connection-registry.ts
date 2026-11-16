// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { WebSocket } from 'ws';
import type { ServerMessage } from '@aerie/shared';

export interface ExtendedWebSocket extends WebSocket {
  isAlive: boolean;
  /** The login session this socket was opened with, re-checked on every heartbeat. */
  sessionToken?: string;
  userId: string;
  voiceModeEnabled: boolean;
  audioChunks: Buffer[];
  audioBytes: number;
  voiceAudioChunkCount: number;
  isRecording: boolean;
  audioMimeType: string;
  voiceCaptureMode: 'dictation' | 'conversation';
  activeRecordingId: string | null;
  transcriptionAbort: AbortController | null;
  deviceType: 'mobile' | 'desktop' | 'unknown';
  userAgent: string;
  tabVisible: boolean;
  messageCount: number;
  messageWindowStart: number;
}

/** The mark desktop/main.cjs adds to the app's user agent. */
export function isLaptopApp(userAgent: string | undefined): boolean {
  return typeof userAgent === 'string' && /\bAerieDesktop\//.test(userAgent);
}

export class ConnectionRegistry {
  private connections = new Map<string, Set<ExtendedWebSocket>>();
  private _lastUserActivity: Date = new Date();
  private _lastUserWebActivity: Date = new Date(0);
  private connectionsByIp = new Map<string, number>();
  private readonly MAX_CONNECTIONS_PER_IP = 10;

  canAcceptConnection(ip: string): boolean {
    const current = this.connectionsByIp.get(ip) || 0;
    return current < this.MAX_CONNECTIONS_PER_IP;
  }

  add(userId: string, ws: ExtendedWebSocket, ip?: string): void {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set());
    }
    this.connections.get(userId)!.add(ws);
    if (ip) {
      this.connectionsByIp.set(ip, (this.connectionsByIp.get(ip) || 0) + 1);
    }
    if (userId === 'user') {
      this._lastUserActivity = new Date();
      this._lastUserWebActivity = new Date();
    }
  }

  remove(userId: string, ws: ExtendedWebSocket, ip?: string): void {
    const userConnections = this.connections.get(userId);
    if (userConnections) {
      userConnections.delete(ws);
      if (userConnections.size === 0) {
        this.connections.delete(userId);
      }
    }
    if (ip) {
      const current = this.connectionsByIp.get(ip) || 0;
      if (current <= 1) {
        this.connectionsByIp.delete(ip);
      } else {
        this.connectionsByIp.set(ip, current - 1);
      }
    }
  }

  touchUserActivity(): void {
    this._lastUserActivity = new Date();
  }

  touchUserWebActivity(): void {
    this._lastUserWebActivity = new Date();
  }

  minutesSinceLastUserWebActivity(): number {
    return (Date.now() - this._lastUserWebActivity.getTime()) / 60000;
  }

  broadcast(message: ServerMessage): void {
    const messageStr = JSON.stringify(message);
    for (const connections of this.connections.values()) {
      for (const ws of connections) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(messageStr);
        }
      }
    }
  }

  broadcastExcept(excludeWs: WebSocket, message: ServerMessage): void {
    const messageStr = JSON.stringify(message);
    for (const connections of this.connections.values()) {
      for (const ws of connections) {
        if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
          ws.send(messageStr);
        }
      }
    }
  }

  getCount(): number {
    let count = 0;
    for (const connections of this.connections.values()) {
      count += connections.size;
    }
    return count;
  }

  hasConnections(): boolean {
    return this.getCount() > 0;
  }

  isUserConnected(): boolean {
    const userConns = this.connections.get('user');
    return !!userConns && userConns.size > 0;
  }

  getLastUserActivity(): Date {
    return this._lastUserActivity;
  }

  minutesSinceLastUserActivity(): number {
    return (Date.now() - this._lastUserActivity.getTime()) / 60000;
  }

  getConnectionsForUser(userId: string): ExtendedWebSocket[] {
    const conns = this.connections.get(userId);
    if (!conns) return [];
    return Array.from(conns).filter(ws => ws.readyState === WebSocket.OPEN);
  }

  /**
   * Their Aerie app on a computer (desktop/main.cjs marks its user agent), as
   * opposed to a browser on the same laptop: only the app can start Spotify.
   */
  laptopApps(): ExtendedWebSocket[] {
    return this.getConnectionsForUser('user').filter((ws) => isLaptopApp(ws.userAgent));
  }

  /** Send one message to their laptop apps only; answers how many took it. */
  sendToLaptopApps(message: ServerMessage): number {
    const apps = this.laptopApps();
    const messageStr = JSON.stringify(message);
    for (const ws of apps) ws.send(messageStr);
    return apps.length;
  }

  /** They are on the laptop app right now: it is open, showing, and the newest thing they touched. */
  laptopAppInUse(): boolean {
    const conns = this.getConnectionsForUser('user');
    if (conns.length === 0) return false;
    const newest = conns[conns.length - 1];
    return isLaptopApp(newest.userAgent) && newest.tabVisible;
  }

  getUserDeviceType(): 'mobile' | 'desktop' | 'unknown' {
    const conns = this.getConnectionsForUser('user');
    if (conns.length === 0) return 'unknown';
    // Return device type of most recent connection (last in set)
    return conns[conns.length - 1].deviceType;
  }

  isUserTabVisible(): boolean {
    const conns = this.getConnectionsForUser('user');
    return conns.some(c => c.tabVisible);
  }

  getUserPresenceState(): 'active' | 'idle' | 'offline' {
    if (!this.isUserConnected()) return 'offline';
    if (!this.isUserTabVisible()) return 'idle';
    if (this.minutesSinceLastUserActivity() < 5) return 'active';
    return 'idle';
  }
}

export const registry = new ConnectionRegistry();
