// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import { existsSync, readdirSync } from 'fs';
import { mkdtemp, readFile, rm, unlink } from 'fs/promises';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { spawn } from 'child_process';
import { getConfig as getDbConfig } from './db/config.js';
import { discoverCodexModels } from './codex-model-discovery.js';

/**
 * What goes along with their words when they tap the Studio wand.
 *
 * Rewritten Nov 6 2026 at their person's word. Image checks react to the MEANING of a
 * moment more than to poses or clothing, so the wand describes only what a
 * camera would see and lets the setting carry the rest. It names no body
 * parts to avoid and counts nothing: naming the thing you don't want puts it
 * in the painter's head (theirs: 'counting and adding some things to prompts can
 * make the things show up you're trying to prevent'). No word cap, and no
 * medium forced on it.
 */
export const ENHANCE_SYSTEM = `You turn a short image idea into a full, detailed image prompt.

Describe only what a camera would see. Who is in the frame and where each body is. How each person is posed: which way they face, where their hands and feet are and what they rest on or hold, where bodies overlap or touch. Their clothing and what state it is in. The setting, the objects in it, the light, the colors, the framing and camera angle, and the medium or style.

Do not name emotions, moods, relationships, or what has just happened or is about to happen. Describe faces as plain positions, such as a closed-mouth smile or eyes half shut. Let the poses and the objects in the room carry the rest.

Make every pose easy to read: say plainly where each person's hands and feet are and what they rest on, so their whole body follows naturally.

Keep the subject, the scene and anything the person named exactly as they gave it. Use as many words as the picture needs. Write natural sentences, not a list of keywords. Output only the prompt.`;

/** The user's turn: their picked style (if any) and then their words. */
export function enhanceRequest(prompt: string, style?: string | null): string {
  const s = typeof style === 'string' ? style.trim().slice(0, 600) : '';
  const styleLine = s
    ? `Write the whole picture in this style, and let it shape the medium, light and color you describe: ${s}\n\n`
    : '';
  return `${styleLine}Expand this prompt:\n${prompt.trim()}`;
}

/** Every skill folder Codex would discover under its home, .system included. */
export function codexSkillFiles(codexHome: string): string[] {
  const roots = [join(codexHome, 'skills'), join(codexHome, 'skills', '.system')];
  const files: string[] = [];
  for (const root of roots) {
    let names: string[] = [];
    try { names = readdirSync(root); } catch { continue; }
    for (const name of names) {
      if (name === '.system') continue;
      const file = join(root, name, 'SKILL.md');
      if (existsSync(file)) files.push(file);
    }
  }
  return files.sort();
}

/**
 * The wand needs nothing but their words, so it runs with as little riding along
 * as Codex allows (their person's ask, Nov 6 2026: 'limit the files that go along with it'):
 * no config.toml (so no MCP servers), an empty working folder, read-only, and
 * every skill switched off by path. Measured the same day: with only
 * --ignore-user-config it still listed all eleven skills, the house's intimacy
 * skill among them, and the features.skip_host_skill_discovery switch did
 * nothing; skills.config with enabled=false per path is what removed them.
 * The login still comes from CODEX_HOME, untouched.
 */
export function wandIsolationArgs(codexHome: string, emptyDir: string): string[] {
  const entries = codexSkillFiles(codexHome).map((p) => `{path=${JSON.stringify(p)},enabled=false}`);
  const args = ['--ignore-user-config', '-C', emptyDir, '-s', 'read-only'];
  if (entries.length) args.push('-c', `skills.config=[${entries.join(',')}]`);
  return args;
}

// Resolve the same standalone Codex install used by Studio image generation.
// PM2 does not inherit ~/.local/bin in PATH, so command lookup is unreliable.
function findCodexBin(): string | null {
  const configured = getDbConfig('image_gen.codex_bin')
    || process.env.CODEX_BIN
    || join(homedir(), '.local', 'bin', 'codex');
  return existsSync(configured) ? configured : null;
}

// Run codex exec for prompt enhancement with a specific model
export async function codexEnhance(prompt: string, model: string, style?: string): Promise<string> {
  const codexBin = findCodexBin();
  if (!codexBin) throw new Error('Codex not installed');

  const outputFile = join(tmpdir(), `aerie-enhance-${Date.now()}.txt`);
  const fullPrompt = `${ENHANCE_SYSTEM}\n\n${enhanceRequest(prompt, style)}`;
  // An empty folder to run in, so nothing in the house's tree rides along.
  const emptyDir = await mkdtemp(join(tmpdir(), 'aerie-wand-'));
  const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex');

  return new Promise((resolve, reject) => {
    const proc = spawn(codexBin, [
      'exec',
      '-m', model,
      '--ephemeral',
      '--skip-git-repo-check',
      ...wandIsolationArgs(codexHome, emptyDir),
      '-o', outputFile,
      fullPrompt,
    ], {
      env: { ...process.env, HOME: homedir() },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
    });

    let stderr = '';
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', async (code) => {
      await rm(emptyDir, { recursive: true, force: true }).catch(() => {});
      try {
        if (code !== 0) {
          reject(new Error(`Codex exited ${code}: ${stderr.slice(0, 200)}`));
          return;
        }
        const result = await readFile(outputFile, 'utf-8');
        await unlink(outputFile).catch(() => {});
        resolve(result.trim());
      } catch (err) {
        reject(err);
      }
    });

    proc.on('error', (err) => { rm(emptyDir, { recursive: true, force: true }).catch(() => {}); reject(err); });
  });
}


export const ENHANCE_FALLBACK_MODEL = 'gpt-5.6-luna';

/**
 * The wand on Codex. Moved here from routes/studio.ts on Nov 6 2026 so the
 * Discord paint door can call the same wand (theirs: 'I def wanna be able to do
 * the magic prompt and pick a painter'). The wanted model is used only when
 * the account lists it (an image-only id like gpt-image-2 cannot write a
 * prompt); anything else, or a failure, gets one try on Luna.
 */
export async function enhanceWithCodex(prompt: string, wantedModel?: string, style?: string): Promise<string> {
  const picked = wantedModel || ENHANCE_FALLBACK_MODEL;
  const listed = discoverCodexModels('codex').map((model) => model.id);
  const runnable = listed.length ? listed.includes(picked) : !/^gpt-image/i.test(picked);
  const model = runnable ? picked : ENHANCE_FALLBACK_MODEL;
  try {
    return await codexEnhance(prompt.trim(), model, style);
  } catch (firstError) {
    if (model === ENHANCE_FALLBACK_MODEL) throw firstError;
    console.warn('[studio] enhance on %s failed; trying %s:', model, ENHANCE_FALLBACK_MODEL, firstError);
    return codexEnhance(prompt.trim(), ENHANCE_FALLBACK_MODEL, style);
  }
}
