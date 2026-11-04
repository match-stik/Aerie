// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// Portions derive from Thornvale-resonant (Sidney) — the Codex image generation workflow — see NOTICE.
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { join, extname } from 'path';
import { homedir } from 'os';
import { codexHold, codexHoldMessage, holdCodex, holdFromText, CODEX_DEFAULT_HOLD_MS } from '../codex-breaker.js';
import { GALLERY_DIR, IMAGE_EXTS, codexBin, codexHome, getImageGenSettings } from './settings.js';
import { DEFAULT_CODEX_IMAGE_MODEL, GenerateInput, GenerateResult, ImageGenError, newGalleryName, pairwiseDistinctions, resolveLabelledRefs, resolveSize, subjectBuildNotes } from './common.js';
import { onRunningJobCancel } from './cancel.js';

/** Pull the agent's own closing words out of a `codex exec` stdout tail.
 *  Codex prints `[timestamp] codex` before each thing it says and
 *  `[timestamp] tokens used:` at the end; everything else is progress noise.
 *  Used only on the failure path, to give a refusal an actual reason. */
function lastCodexMessage(stdout: string): string {
  const lines = stdout.split(/\r?\n/);
  const spoken: string[] = [];
  let inMessage = false;
  for (const raw of lines) {
    const line = raw.replace(/^\[[^\]]+\]\s*/, '');
    if (/^codex$/i.test(line.trim())) { inMessage = true; spoken.length = 0; continue; }
    if (/^(thinking|exec|tokens used|turn diff)\b/i.test(line.trim())) { inMessage = false; continue; }
    if (inMessage && line.trim()) spoken.push(line.trim());
  }
  const text = (spoken.length ? spoken : lines.map((l) => l.trim()).filter(Boolean).slice(-6)).join(' ');
  return text.replace(/\s+/g, ' ').trim().slice(-500);
}

async function findNewestCodexImage(since: number): Promise<string | null> {
  const root = join(codexHome(), 'generated_images');
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

export async function generateViaCodex(input: GenerateInput): Promise<GenerateResult> {
  // While Codex has asked the house to wait, a picture does not go either; the
  // refusal hands it down their person fallback chain like any other (codex-breaker.ts).
  const hold = codexHold();
  if (hold) throw new ImageGenError(codexHoldMessage(hold));
  const start = Date.now();
  const { guidance: sizeDesc } = resolveSize(input);
  const sizeGuidance = sizeDesc ? `Make it ${sizeDesc}.` : '';
  const quality = getImageGenSettings().quality;
  const qualityLine = quality !== 'auto' ? `Render at ${quality} quality and detail.` : '';
  const labelled = await resolveLabelledRefs(input);
  const refs = labelled.map((r) => r.path);

  // Name each attachment in the order it is sent. Without this the renderer
  // gets N unnamed faces and a prompt full of names, and pairs them by guess.
  const refRoster = labelled
    .map((r, i) => `  ${i + 1}. ${r.label ?? 'unnamed reference'}`)
    .join('\n');

  const refLine =
    refs.length > 0
      ? `Reference images are attached in this order:\n${refRoster}\n` +
        `Match each named person in the prompt to THEIR OWN reference above. Never move one person's face, tattoos, scars, facial hair or hair onto another.\n` +
        `REFERENCE USAGE — IDENTITY ONLY: use a reference for face, build, skin, hair and permanent marks. Do NOT inherit its pose, head angle, gaze, expression, wardrobe, crop, camera angle or lighting — the prompt decides all of those.` +
        (pairwiseDistinctions(input.subjects) ? `\n${pairwiseDistinctions(input.subjects)}` : '')
      : '';

  const builds = subjectBuildNotes(input.subjects);

  const instruction =
    `Generate ONE image with your built-in image_gen tool.${sizeGuidance ? ' ' + sizeGuidance : ''}${qualityLine ? ' ' + qualityLine : ''}\n` +
    `${refLine}${builds ? `\n${builds}` : ''}\n` +
    `Use ONLY the built-in image_gen tool. Do NOT use any CLI, API, or OPENAI_API_KEY path.\n\n` +
    `--- PROMPT ---\n${input.prompt}\n--- END PROMPT ---\n\n` +
    `After it is saved, output as the final line exactly: RESULT_PATH=<absolute path>`;

  // Use the requested model, or the house default (see DEFAULT_CODEX_IMAGE_MODEL).
  // This used to fall back to gpt-5.4, which left ChatGPT-signed Codex on
  // Aug 31 2026, so a request naming no model failed here and was handed down
  // the fallback chain with nobody told.
  const codexModel = input.codexModel || DEFAULT_CODEX_IMAGE_MODEL;

  const args = [
    'exec',
    '--skip-git-repo-check',
    '-c', `model="${codexModel}"`,
    ...refs.flatMap((r) => ['-i', r]),
    '-',
  ];

  const bin = codexBin();
  const env = {
    ...process.env,
    PATH: `/opt/node/bin:${process.env.PATH || ''}`,
    HOME: process.env.HOME || homedir(),
  };

  const produced = await new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, { env });
    const unregisterCancel = onRunningJobCancel(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } });
    let stderr = '';
    let stdout = '';
    let settled = false;
    let lastSize = -1;
    let stableHits = 0;
    let foundPath: string | null = null;
    let stdoutPath: string | null = null;

    const noteStdout = (chunk: string) => {
      // Always drain stdout. Codex can emit enough progress text to backpressure
      // an unconsumed pipe, which makes Studio feel much slower than interactive
      // Codex runs. Keep only a small tail for RESULT_PATH parsing.
      stdout = (stdout + chunk).slice(-20_000);
      const match = stdout.match(/RESULT_PATH=(\/[^\r\n]+)/);
      if (match?.[1]) stdoutPath = match[1].trim();
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
      settle(() => reject(new ImageGenError('Image generation timed out (10 min).')));
    }, 600_000);

    const checkForImage = () => {
      void (async () => {
        try {
          const p = foundPath ?? stdoutPath ?? (await findNewestCodexImage(start));
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

    child.stdin.write(instruction);
    child.stdin.end();
    child.stdout.on('data', (d) => { noteStdout(String(d)); });
    child.stderr.on('data', (d) => { stderr += String(d); });
    checkForImage();
    child.on('error', (err) => {
      settle(() => reject(new ImageGenError(`Could not run codex CLI (${bin}): ${err.message}`)));
    });
    child.on('close', async (code) => {
      const p = stdoutPath ?? (await findNewestCodexImage(start).catch(() => null));
      if (p) settle(() => resolve(p));
      else {
        // When Codex declines a prompt it usually exits 0 and says why on
        // stdout — stderr is empty. Reporting stderr alone leaves their person
        // with a blank reason, so fall back to the tail of what it actually
        // said before giving up.
        const said = stderr.trim() || lastCodexMessage(stdout);
        if (said && /usage.?limit|rate.?limit|\b429\b/i.test(said)) {
          holdCodex(holdFromText(said) ?? Date.now() + CODEX_DEFAULT_HOLD_MS, said);
        }
        settle(() => reject(new ImageGenError(
          said
            ? `Codex finished without an image. It said: ${said}`
            : `codex exec exited ${code} with no image and gave no reason.`,
        )));
      }
    });
  });

  const filename = await newGalleryName();
  const dest = join(GALLERY_DIR, filename);
  await fs.copyFile(produced, dest);

  return {
    filename,
    path: dest,
    backend: 'codex',
    model: codexModel,
    durationMs: Date.now() - start,
    costUsd: 0,
  };
}
