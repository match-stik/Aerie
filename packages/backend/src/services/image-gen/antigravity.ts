// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { join, extname } from 'path';
import { homedir } from 'os';
import { ANTIGRAVITY_MODELS, AntigravityModel, GALLERY_DIR, IMAGE_EXTS, antigravityBin, antigravityHome, antigravityTimeoutMs, getImageGenSettings } from './settings.js';
import { GenerateInput, GenerateResult, ImageGenError, newGalleryName, resolveAllRefs, resolveSize } from './common.js';
import { onRunningJobCancel } from './cancel.js';

async function findNewestAntigravityImage(since: number): Promise<string | null> {
  const root = join(antigravityHome(), 'brain');
  if (!existsSync(root)) return null;
  let best: { path: string; t: number } | null = null;
  const sessions = await fs.readdir(root).catch(() => [] as string[]);
  for (const sess of sessions) {
    const dir = join(root, sess);
    let files: string[];
    try {
      const st = await fs.stat(dir);
      if (!st.isDirectory()) continue;
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!IMAGE_EXTS.has(extname(f).toLowerCase())) continue;
      const p = join(dir, f);
      try {
        const st = await fs.stat(p);
        if (st.mtimeMs >= since - 1000 && (!best || st.mtimeMs > best.t)) {
          best = { path: p, t: st.mtimeMs };
        }
      } catch { /* skip */ }
    }
  }
  return best?.path ?? null;
}

export async function generateViaAntigravity(input: GenerateInput): Promise<GenerateResult> {
  const start = Date.now();
  const { guidance: sizeDesc } = resolveSize(input);
  const sizeGuidance = sizeDesc ? ` Make it ${sizeDesc}.` : '';
  const refs = await resolveAllRefs(input);

  // Build reference instruction if refs exist
  const refLine = refs.length > 0
    ? `Use these reference images to maintain character/subject consistency: ${refs.join(', ')}. `
    : '';

  // agy runs headless here, where a shell command can never be approved: on
  // Oct 22 2026 two Studio fallbacks in a row died because Gemini first tried
  // `ls -la` on the reference folder to look around, was auto-denied, and then
  // drew nothing (its own log: 'Print mode: soft-denying tool confirmation
  // "RunCommand"'). So the instruction says the paths are good and that no
  // command is needed, and hands it straight to the image tool.
  const noCommands = 'The reference paths are exact and readable as given. Do not list folders, inspect files with a shell, or run any command; no command can be approved here. Go straight to your image generation tool. ';
  const instruction = `${refLine}${noCommands}generate an image of: ${input.prompt}${sizeGuidance}`;

  const bin = antigravityBin();
  if (!existsSync(bin)) {
    throw new ImageGenError(`Antigravity CLI not found at ${bin}. Install with: curl -fsSL https://antigravity.google/cli/install.sh | bash`);
  }

  const env = {
    ...process.env,
    PATH: `${join(homedir(), '.local', 'bin')}:${process.env.PATH || ''}`,
    HOME: process.env.HOME || homedir(),
  };

  // Use request model if provided, otherwise fall back to configured default
  // Only Gemini models can generate images — Claude/GPT models can't
  const settings = getImageGenSettings();
  const model = (input.agyModel && ANTIGRAVITY_MODELS.includes(input.agyModel as AntigravityModel))
    ? input.agyModel
    : settings.antigravityModel;

  // How long Antigravity gets before the job moves on down their chain. It was
  // ten minutes, and a picture Google refused sat out all ten while every job
  // behind it waited (theirs, Oct 29 2026: 'not let that hang as long on
  // antigravity'). Two and a half minutes by default; image_gen.antigravity_timeout_seconds
  // changes it.
  const agyTimeoutMs = antigravityTimeoutMs();
  const produced = await new Promise<string>((resolve, reject) => {
    // Run from /tmp to avoid agy getting confused by workspace context
    // agy's print mode accepts its prompt as the final positional argument; it does
    // not read prompts from stdin. Keep every flag before --print, otherwise it
    // mistakes a later flag (such as --print-timeout) for the prompt.
    const child = spawn(bin, ['--model', model, '--print-timeout', '10m', '--print', instruction], { env, cwd: '/tmp', stdio: ['ignore', 'pipe', 'pipe'] });
    const unregisterCancel = onRunningJobCancel(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } });
    let stderr = '';
    let stdout = '';
    let settled = false;
    let lastSize = -1;
    let stableHits = 0;
    let foundPath: string | null = null;

    const noteStdout = (chunk: string) => {
      // Drain stdout so agy cannot block on a full pipe during long generations.
      stdout = (stdout + chunk).slice(-20_000);
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      unregisterCancel();
      clearInterval(poll);
      fn();
    };

    const killer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      settle(() => reject(new ImageGenError(`Antigravity gave up after ${Math.round(agyTimeoutMs / 1000)} seconds.`)));
    }, agyTimeoutMs);

    const checkForImage = () => {
      void (async () => {
        try {
          const p = foundPath ?? (await findNewestAntigravityImage(start));
          if (!p) return;
          foundPath = p;
          const sz = (await fs.stat(p)).size;
          if (sz > 0 && sz === lastSize) {
            if (++stableHits >= 2) {
              try { child.kill('SIGTERM'); } catch { /* ignore */ }
              settle(() => resolve(p));
            }
          } else {
            lastSize = sz;
            stableHits = 0;
          }
        } catch { /* keep polling */ }
      })();
    };

    const poll = setInterval(checkForImage, 500);

    child.stdout.on('data', (d) => { noteStdout(String(d)); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    checkForImage();
    child.on('error', (err) => {
      settle(() => reject(new ImageGenError(`Could not run agy CLI (${bin}): ${err.message}`)));
    });
    child.on('close', async (code) => {
      const p = await findNewestAntigravityImage(start).catch(() => null);
      if (p) settle(() => resolve(p));
      else settle(() => reject(new ImageGenError(`agy exited ${code} with no image. ${stderr.slice(-400)}`)));
    });
  });

  const filename = await newGalleryName();
  const dest = join(GALLERY_DIR, filename);
  await fs.copyFile(produced, dest);

  return {
    filename,
    path: dest,
    backend: 'antigravity' as const,
    model,
    durationMs: Date.now() - start,
    costUsd: 0,
  };
}

// ─── OpenArt (direct MCP-over-HTTP) ──────────────────────────────────
// The `openart` MCP server is OAuth-logged-in at the Codex level
// (`codex mcp login openart`); the token lives in ~/.codex/.credentials.json.
// We speak JSON-RPC to mcp.openart.ai ourselves rather than through a codex
// exec agent — codex sessions silently omit openart_upload_sign from the
// callable schema, so an agent can never upload references. The backend
// refreshes the token in place when it expires; codex picks up the refresh
// from the same file.
