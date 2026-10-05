// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messagePreviewText } from '@aerie/shared';

// The rule under test: previews and notifications must say what the bubble
// will render. The bubble renders metadata.segments whenever there are any
// and never falls back to content, so a preview that reads content alone can
// announce a message that isn't there when the thread is opened.

test('a message with no segments previews its content', () => {
  assert.equal(messagePreviewText('plain words', null), 'plain words');
  assert.equal(messagePreviewText('plain words', {}), 'plain words');
  assert.equal(messagePreviewText('plain words', { segments: [] }), 'plain words');
});

test('a message with segments previews the text segments, not the content', () => {
  const metadata = {
    segments: [
      { type: 'tool', toolId: 't1', toolName: 'Bash' },
      { type: 'text', content: 'what the owner will actually see' },
    ],
  };
  assert.equal(messagePreviewText('[No response]', metadata), 'what the owner will actually see');
});

test('a turn that only did tool work has no preview at all', () => {
  const metadata = { segments: [{ type: 'tool', toolId: 't1', toolName: 'Bash' }] };
  // Not '[No response]' — the room shows a chip and no words, so the thread
  // list shows no preview line rather than promising one.
  assert.equal(messagePreviewText('[No response]', metadata), null);
});

test('thinking segments are not spoken text', () => {
  const metadata = { segments: [{ type: 'thinking', content: 'inner', summary: 'inner' }] };
  assert.equal(messagePreviewText('[No response]', metadata), null);
});

test('metadata arrives raw from SQL as well as parsed', () => {
  const raw = JSON.stringify({ segments: [{ type: 'text', content: 'from a string' }] });
  assert.equal(messagePreviewText('ignored', raw), 'from a string');
});

test('malformed metadata falls back to content instead of throwing', () => {
  assert.equal(messagePreviewText('plain words', '{not json'), 'plain words');
});

test('an empty message previews as nothing', () => {
  assert.equal(messagePreviewText('', null), null);
  assert.equal(messagePreviewText(null, null), null);
  assert.equal(messagePreviewText('   \n  ', null), null);
});
