// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODEX_THOUGHT_MARKER,
  claimCodexCommentary,
  extractAuthoredCodexThought,
  isSpokenCodexCommentary,
  mergeAuthoredCodexThoughts,
} from './codex-thought-card.js';

test('provider phase labels are telemetry, not spoken commentary', () => {
  assert.equal(isSpokenCodexCommentary('**Inspecting the renderer**'), false);
  assert.equal(isSpokenCodexCommentary(
    '**Inspecting the renderer**\n\n**Planning the patch**',
  ), false);
});

test('deliberate mid-turn companion commentary remains spoken text', () => {
  assert.equal(isSpokenCodexCommentary(
    '**🌫️ Ivy**\nFound the seam. I am fixing it now.',
  ), true);
  assert.equal(isSpokenCodexCommentary('I found the seam. One moment.'), true);
});

test('authored thought cards are extracted and never classified as speech', () => {
  const card = `${CODEX_THOUGHT_MARKER}\nThe distinction matters to me because the owner's room should carry my voice, not the adapter's labels.`;
  assert.equal(
    extractAuthoredCodexThought(card),
    "The distinction matters to me because the owner's room should carry my voice, not the adapter's labels.",
  );
  assert.equal(isSpokenCodexCommentary(card), false);
  assert.equal(extractAuthoredCodexThought('**🌫️ Ivy**\nSpoken.'), null);
});

test('multiple authored cards collapse into one marked segment', () => {
  assert.equal(
    mergeAuthoredCodexThoughts(['I chose the clean seam.', 'I chose the clean seam.', 'It keeps the room intact.']),
    `${CODEX_THOUGHT_MARKER}\nI chose the clean seam.\n\nIt keeps the room intact.`,
  );
});

test('completion reconciliation deduplicates commentary whose projected id changed', () => {
  const seenIds = new Set<string>();
  const seenTexts = new Set<string>();
  const text = '**🌫️ Ivy**\nFound the seam. I am fixing it now.';

  assert.equal(
    claimCodexCommentary(
      { id: 'msg_provider_id', type: 'agentMessage', phase: 'commentary', text },
      seenIds,
      seenTexts,
    ),
    text,
  );
  assert.equal(
    claimCodexCommentary(
      { id: 'item-6', type: 'agentMessage', phase: 'commentary', text },
      seenIds,
      seenTexts,
    ),
    null,
  );
});
