// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
// A sound's loudness as a toy line: one level from 0 to 20 for every tenth of
// a second, worked out once from the audio itself, so a sound on the shelf
// can drive their toys in time with it (theirs, Nov 10 2026: 'hook up the wave
// form that the audio would make to control the wave of the toy').
//
// ffmpeg decodes the file to mono 16-bit at 8 kHz; each tenth of a second's
// loudness (RMS) is set against the loud end of the whole sound (its 95th
// percentile), so a quiet whisper track and a loud song both use the full
// range, and anything under the room's own hum is off. The line is kept
// beside the file store (data/sound-envelopes/<fileId>.json) and made once.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../config.js';
import { getFile } from './files.js';

export const ENVELOPE_STEP_MS = 100;
const RATE = 8000;
const DIR = join(PROJECT_ROOT, 'data/sound-envelopes');
/** Longer than this and the line is cut: a toy line is for listening along. */
const MAX_SECONDS = 3 * 60 * 60;

/** Levels 0 to 20, one per step, from raw mono samples. */
export function envelopeFromPcm(samples: Int16Array, rate = RATE, stepMs = ENVELOPE_STEP_MS): number[] {
  const per = Math.max(1, Math.round((rate * stepMs) / 1000));
  const rms: number[] = [];
  for (let start = 0; start < samples.length; start += per) {
    const end = Math.min(samples.length, start + per);
    let sum = 0;
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    rms.push(Math.sqrt(sum / Math.max(1, end - start)));
  }
  if (rms.length === 0) return [];
  const sorted = [...rms].sort((a, b) => a - b);
  const loud = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const hum = sorted[Math.floor(sorted.length * 0.1)];
  if (loud <= 0 || loud - hum < 50) return rms.map(() => 0);
  return rms.map((v) => {
    if (v <= hum * 1.2) return 0;
    const share = Math.min(1, (v - hum) / (loud - hum));
    return Math.max(1, Math.round(share * 20));
  });
}

function decode(path: string): Promise<Int16Array> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-v', 'error', '-i', path, '-t', String(MAX_SECONDS), '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.stderr.on('data', (c: Buffer) => { err += c.toString().slice(0, 400); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(err.trim() || `ffmpeg ended with ${code}`));
        return;
      }
      const all = Buffer.concat(chunks);
      const even = all.subarray(0, all.length - (all.length % 2));
      resolve(new Int16Array(even.buffer.slice(even.byteOffset, even.byteOffset + even.length)));
    });
  });
}

const making = new Map<string, Promise<number[]>>();

/** The sound's toy line, made the first time it is asked for. */
export async function soundEnvelope(fileId: string): Promise<number[] | null> {
  const cached = join(DIR, `${fileId.replace(/[^\w.-]/g, '_')}.json`);
  if (existsSync(cached)) {
    try {
      const levels = JSON.parse(readFileSync(cached, 'utf8')) as unknown;
      if (Array.isArray(levels)) return levels as number[];
    } catch {
      // Remade below.
    }
  }
  const file = getFile(fileId);
  if (!file) return null;
  let job = making.get(fileId);
  if (!job) {
    job = decode(file.path).then((samples) => {
      const levels = envelopeFromPcm(samples);
      mkdirSync(DIR, { recursive: true });
      writeFileSync(cached, JSON.stringify(levels));
      return levels;
    });
    making.set(fileId, job);
    job.finally(() => making.delete(fileId)).catch(() => {});
  }
  return job;
}
