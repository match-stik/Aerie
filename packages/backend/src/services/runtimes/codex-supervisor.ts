// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
/**
 * CodexDaemonSupervisor — Manages the Codex app-server daemon lifecycle.
 *
 * Ensures the daemon is running before connections are attempted,
 * monitors health, and restarts on failure.
 */

import { spawn, ChildProcess } from 'child_process';
import { existsSync, statSync } from 'fs';
import { getSecret } from '../secrets.js';

const SOCKET_PATH = process.env.HOME + '/.codex/app-server-control/app-server-control.sock';
const CODEX_BIN = process.env.HOME + '/.local/bin/codex';

class CodexDaemonSupervisor {
  private daemonProcess: ChildProcess | null = null;
  private starting = false;
  private startPromise: Promise<void> | null = null;

  /**
   * Check if the daemon socket exists and is recent (daemon probably running)
   */
  private isDaemonRunning(): boolean {
    try {
      if (!existsSync(SOCKET_PATH)) return false;
      const stat = statSync(SOCKET_PATH);
      // Socket exists — daemon is likely running
      return stat.isSocket();
    } catch {
      return false;
    }
  }

  /**
   * Ensure OUR daemon is running with the right flags.
   * If VS Code (or another client) started the daemon, we need to restart it
   * with --dangerously-bypass-approvals-and-sandbox so approval requests
   * don't get routed to VS Code.
   */
  async ensureRunning(): Promise<void> {
    // Always restart the daemon to ensure our flags are set.
    // The problem: if VS Code started the daemon, approval requests go to VS Code,
    // not to us. We need the daemon running with bypass mode.
    if (this.isDaemonRunning() && !this.weStartedIt) {
      console.log('[CodexSupervisor] Daemon running but not started by us — restarting with bypass flags');
      await this.restartDaemon();
      return;
    }

    if (this.isDaemonRunning()) {
      return;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startDaemon();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private weStartedIt = false;

  private async restartDaemon(): Promise<void> {
    // Stop existing daemon
    console.log('[CodexSupervisor] Stopping existing daemon...');
    const stopProc = spawn(CODEX_BIN, ['app-server', 'daemon', 'stop'], {
      stdio: 'ignore',
    });
    await new Promise<void>((resolve) => {
      stopProc.on('close', () => resolve());
      setTimeout(resolve, 2000); // timeout fallback
    });

    // Wait for socket to disappear
    let attempts = 0;
    while (this.isDaemonRunning() && attempts < 20) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }

    // Start our daemon
    await this.startDaemon();
  }

  private async startDaemon(): Promise<void> {
    if (this.starting) return;
    this.starting = true;

    console.log('[CodexSupervisor] Starting Codex daemon...');

    return new Promise((resolve, reject) => {
      // Start the daemon in background
      // --dangerously-bypass-approvals-and-sandbox is needed because Hetzner VPS
      // lacks CAP_NET_ADMIN for bwrap network namespaces
      // Inject the Cortex bearer token from the BYOK secrets store so the
      // daemon's cortex MCP entry (bearer_token_env_var = CORTEX_AUTH_TOKEN)
      // can authenticate against the locked worker. Kept out of any file.
      const cortexToken = getSecret('cortex_auth_token');
      this.daemonProcess = spawn(CODEX_BIN, [
        '--dangerously-bypass-approvals-and-sandbox',
        'app-server', 'daemon', 'start'
      ], {
        detached: true,
        env: cortexToken ? { ...process.env, CORTEX_AUTH_TOKEN: cortexToken } : process.env,
        stdio: 'ignore',
      });

      this.daemonProcess.unref();
      this.weStartedIt = true;

      // Wait for socket to appear
      let attempts = 0;
      const maxAttempts = 30; // 3 seconds

      const checkSocket = () => {
        attempts++;
        if (this.isDaemonRunning()) {
          this.starting = false;
          console.log('[CodexSupervisor] Daemon started successfully');
          resolve();
        } else if (attempts >= maxAttempts) {
          this.starting = false;
          reject(new Error('Daemon failed to start within timeout'));
        } else {
          setTimeout(checkSocket, 100);
        }
      };

      setTimeout(checkSocket, 100);
    });
  }

  /**
   * Stop the daemon if we started it
   */
  async stop(): Promise<void> {
    if (this.daemonProcess) {
      console.log('[CodexSupervisor] Stopping daemon...');
      spawn(CODEX_BIN, ['app-server', 'daemon', 'stop'], {
        stdio: 'ignore',
      });
      this.daemonProcess = null;
    }
  }
}

// Singleton instance
export const codexSupervisor = new CodexDaemonSupervisor();
