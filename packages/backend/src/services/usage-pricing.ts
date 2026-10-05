// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Published Anthropic API pricing — $ per million tokens.
// Cache writes are priced at 1.25× input; cache reads at 0.1× input.
// Update this table when pricing changes.

import { CLAUDE_MODELS, extraModelsFor } from './model-catalog.js';

interface ModelPricing {
  input: number;  // USD per million input tokens
  output: number; // USD per million output tokens
}

const PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-7': { input: 15, output: 75 },
  'claude-opus-4-6': { input: 15, output: 75 },
  'claude-opus-4-5': { input: 15, output: 75 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

// Derived from the catalog, not copied out of it. This used to be a second
// hand-written table with a comment asking whoever edited one to remember the
// other — and a comment is not a mechanism. The picker's list and the number
// the meter measures against are now the same list, which also means a model
// the owner adds themselves arrives with its window rather than silently reading
// as 200k.
function contextWindows(): Record<string, number> {
  const windows: Record<string, number> = {};
  for (const model of CLAUDE_MODELS) {
    if (model.context_length) windows[model.id] = model.context_length;
  }
  for (const extra of extraModelsFor('claude')) {
    if (extra.contextLength) windows[extra.id] = extra.contextLength;
  }
  return windows;
}

// Drops a bracketed variant like [1m] from the end of a model id, from the first
// '[' on, without a regex that backtracks on a long id full of brackets.
function stripVariant(model: string): string {
  const open = model.indexOf('[');
  return open !== -1 && model.endsWith(']') ? model.slice(0, open) : model;
}

export function contextWindowFor(model: string): number {
  // The [1m] beta suffix requests the 1M window regardless of base model.
  if (model.endsWith('[1m]')) return 1_000_000;
  const windows = contextWindows();
  if (windows[model]) return windows[model];
  const base = stripVariant(model).replace(/-\d{8}$/, '');
  if (windows[base]) return windows[base];
  for (const [k, v] of Object.entries(windows)) {
    if (model.startsWith(k)) return v;
  }
  return 200_000;
}

function pricingFor(model: string): ModelPricing {
  // Try exact match first, then strip trailing suffixes (e.g. "[1m]")
  if (PRICING[model]) return PRICING[model];
  const base = stripVariant(model).replace(/-\d{8}$/, '');
  if (PRICING[base]) return PRICING[base];
  // Fallback: match prefix
  for (const [k, v] of Object.entries(PRICING)) {
    if (model.startsWith(k)) return v;
  }
  // Default if unknown — use sonnet-tier
  return { input: 3, output: 15 };
}

export function estimateCost(params: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}): number {
  const p = pricingFor(params.model);
  const MILLION = 1_000_000;
  const inputCost = (params.inputTokens * p.input) / MILLION;
  const outputCost = (params.outputTokens * p.output) / MILLION;
  const cacheReadCost = ((params.cacheReadTokens ?? 0) * p.input * 0.1) / MILLION;
  const cacheCreationCost = ((params.cacheCreationTokens ?? 0) * p.input * 1.25) / MILLION;
  return inputCost + outputCost + cacheReadCost + cacheCreationCost;
}
