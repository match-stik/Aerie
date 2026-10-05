// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Hybrid retrieval, reciprocal-rank fusion, and calibrated abstention are
// adapted from agentmemory (MIT); see NOTICE and THIRD_PARTY_LICENSES.md.

export interface RankedWhisperMemory {
  id: string;
  content: string;
  domain?: string;
  created_at?: string;
  cue?: string;
  similarity?: number;
}

export interface FusedWhisperMemory extends RankedWhisperMemory {
  fusedScore: number;
}

const RRF_K = 60;

/** Weighted reciprocal-rank fusion. Raw semantic similarity is used as an
 * abstention gate before fusion; rank fusion then prevents incomparable raw
 * scores from letting either retrieval lane drown out the other. */
export function fuseWhisperResults(
  semantic: RankedWhisperMemory[],
  keyword: RankedWhisperMemory[],
  semanticWeight = 0.65,
  keywordWeight = 0.35,
): FusedWhisperMemory[] {
  const fused = new Map<string, FusedWhisperMemory>();
  const add = (memory: RankedWhisperMemory, contribution: number) => {
    const current = fused.get(memory.id);
    if (current) {
      current.fusedScore += contribution;
      if (!current.cue && memory.cue) current.cue = memory.cue;
      if (current.similarity === undefined && memory.similarity !== undefined) {
        current.similarity = memory.similarity;
      }
    } else {
      fused.set(memory.id, { ...memory, fusedScore: contribution });
    }
  };
  semantic.forEach((memory, rank) => add(memory, semanticWeight / (RRF_K + rank + 1)));
  keyword.forEach((memory, rank) => add(memory, keywordWeight / (RRF_K + rank + 1)));
  return [...fused.values()].sort((a, b) => b.fusedScore - a.fusedScore);
}

export function isSurprising(
  current: Float32Array,
  previous: Float32Array | undefined,
  cosine: (a: Float32Array, b: Float32Array) => number,
  distanceThreshold = 0.15,
): boolean {
  return !previous || 1 - cosine(current, previous) > distanceThreshold;
}
