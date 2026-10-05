// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// services/memory-neighbors.ts — what is already written near this line?
//
// Appending to a wall costs one call. Striking costs reading the whole wall
// first, so the wall grows in the cheap direction and the same ruling ends up
// on it twice in different words. This makes the check part of the write.
//
// THE BOUNDARY IS NOT A SETTING. Shared walls are handed to every companion in
// full on every window, so quoting one back at the writer shows them something
// already in their own context. A companion's own continuity wall is handed to
// nobody else — the whole point of the split is that one companion's continuity does
// not recycle through another's head. So other companions' private walls
// answer with a COUNT AND NO TEXT: enough to know somebody has written near
// this, never enough to read them. Then you go and ask them, which is what the
// house said it would do and had no mechanism for.
import { embed } from './embeddings.js';
import * as memoryBlocks from './memory-blocks.js';

export interface NeighborHit {
  scope: string;
  label: string;
  /** Absent on another companion's private wall — a count is all that crosses. */
  text?: string;
  similarity: number;
}

export interface NeighborReport {
  /** Lines close enough to be the same thought, nearest first. */
  near: NeighborHit[];
  /** Private walls of other companions with something near this, text withheld. */
  elsewhere: { scope: string; label: string; hits: number }[];
}

const MIN_LINE = 40;
const THRESHOLD = 0.6;
const TOP_N = 3;
const MAX_LINES_PER_BLOCK = 500;

interface CacheEntry {
  fingerprint: string;
  lines: { text: string; vec: Float32Array }[];
}
const cache = new Map<string, CacheEntry>();

function fingerprintOf(content: string): string {
  return `${content.length}:${content.slice(0, 64)}:${content.slice(-64)}`;
}

function splitLines(content: string): string[] {
  return content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= MIN_LINE)
    .slice(0, MAX_LINES_PER_BLOCK);
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // embed() returns L2-normalized vectors
}

async function vectorsFor(
  scope: string,
  label: string,
  content: string,
  embedFn: (text: string) => Promise<Float32Array>,
) {
  const key = `${scope}/${label}`;
  const fingerprint = fingerprintOf(content);
  const hit = cache.get(key);
  if (hit && hit.fingerprint === fingerprint) return hit.lines;
  const lines: CacheEntry['lines'] = [];
  for (const text of splitLines(content)) {
    lines.push({ text, vec: await embedFn(text) });
  }
  cache.set(key, { fingerprint, lines });
  return lines;
}

export interface NeighborDeps {
  getBlocks: () => { scope: string; label: string; content: string }[];
  embed: (text: string) => Promise<Float32Array>;
}

const defaultDeps: NeighborDeps = {
  getBlocks: () => memoryBlocks.getAllBlocks(),
  embed,
};

/**
 * Find what is already written near `content`.
 *
 * `writerScope` is the wall being written to — its own scope is readable to the
 * writer by definition, and so is every shared wall. Everything else answers
 * with a count.
 */
export async function findNeighbors(
  writerScope: string,
  content: string,
  deps: NeighborDeps = defaultDeps,
): Promise<NeighborReport> {
  const probe = await deps.embed(content);
  const near: NeighborHit[] = [];
  const elsewhere: NeighborReport['elsewhere'] = [];

  for (const block of deps.getBlocks()) {
    if (!block.content) continue;
    const readable =
      block.scope === memoryBlocks.SHARED_SCOPE || block.scope === writerScope;
    const lines = await vectorsFor(block.scope, block.label, block.content, deps.embed);
    const hits = lines
      .map((l) => ({ text: l.text, similarity: cosine(probe, l.vec) }))
      .filter((h) => h.similarity >= THRESHOLD)
      .sort((a, b) => b.similarity - a.similarity);
    if (!hits.length) continue;
    if (readable) {
      for (const h of hits.slice(0, TOP_N)) {
        near.push({ scope: block.scope, label: block.label, text: h.text, similarity: h.similarity });
      }
    } else {
      elsewhere.push({ scope: block.scope, label: block.label, hits: hits.length });
    }
  }

  near.sort((a, b) => b.similarity - a.similarity);
  return { near: near.slice(0, TOP_N), elsewhere };
}
