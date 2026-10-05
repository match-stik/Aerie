// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { contextWindowFor } from './usage-pricing.js';
import { CLAUDE_MODELS } from './model-catalog.js';

// The context meter is only as honest as the window it divides by. This file
// exists because that window used to be a second hand-written table kept in
// step with the picker's list by a comment.

test('every listed model measures against its own stated window', () => {
  for (const model of CLAUDE_MODELS) {
    if (!model.context_length) continue;
    assert.equal(
      contextWindowFor(model.id),
      model.context_length,
      `${model.id} is listed at ${model.context_length} and measured at ${contextWindowFor(model.id)}`,
    );
  }
});

test('a model nobody has written down reads as 200k rather than nothing', () => {
  assert.equal(contextWindowFor('claude-opus-9-unreleased'), 200_000);
});

test('the [1m] suffix asks for the long window whatever the base model is', () => {
  assert.equal(contextWindowFor('claude-sonnet-4-6[1m]'), 1_000_000);
});

test('a dated build measures the same as its base model', () => {
  assert.equal(contextWindowFor('claude-opus-5-20260101'), contextWindowFor('claude-opus-5'));
});
