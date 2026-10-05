// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  studioWindowWarning,
  warnThresholdFrom,
  DEFAULT_LOW_WINDOW_WARN_PERCENT,
} from './studio-window-warning.js';
import type { CodexUsage } from './subscription-usage.js';

const usage = (over: Partial<CodexUsage>): CodexUsage => ({
  usedPercent: 10,
  windowMinutes: 300,
  resetsAt: '2026-09-08T22:00:00Z',
  planType: 'plus',
  capturedAt: '2026-09-08T18:00:00Z',
  secondary: null,
  creditsBalance: null,
  creditsUnlimited: false,
  hasCredits: false,
  limitReached: null,
  ...over,
});

test('a healthy window says nothing', () => {
  assert.equal(studioWindowWarning(usage({ usedPercent: 40 })), null);
  assert.equal(studioWindowWarning(usage({ usedPercent: 79.9 })), null);
});

test('it warns once the remainder reaches the set threshold', () => {
  const warning = studioWindowWarning(usage({ usedPercent: 82 }));
  assert.equal(warning?.remainingPercent, 18);
  assert.equal(warning?.window, 'primary');
  assert.equal(warning?.thresholdPercent, DEFAULT_LOW_WINDOW_WARN_PERCENT);
  assert.equal(warning?.limitReached, false);
});

// The case that made this worth building: the five-hour window looks fine and
// the weekly one is nearly gone. Reporting only the primary would hide it.
test('the tighter of the two windows is the one reported', () => {
  const warning = studioWindowWarning(
    usage({
      usedPercent: 40,
      secondary: { usedPercent: 96, windowMinutes: 10080, resetsAt: '2026-09-12T00:00:00Z' },
    }),
  );
  assert.equal(warning?.window, 'secondary');
  assert.equal(warning?.remainingPercent, 4);
  assert.equal(warning?.windowMinutes, 10080);
  assert.equal(warning?.resetsAt, '2026-09-12T00:00:00Z');
});

test('a provider already refusing warns however much the meter claims is left', () => {
  const warning = studioWindowWarning(usage({ usedPercent: 3, limitReached: 'primary' }));
  assert.equal(warning?.limitReached, true);
  assert.equal(warning?.remainingPercent, 97);
});

test('no reading and a switched-off threshold both stay quiet', () => {
  assert.equal(studioWindowWarning(null), null);
  assert.equal(studioWindowWarning(usage({ usedPercent: 99 }), 0), null);
});

test('an unreadable percentage is not treated as zero used', () => {
  assert.equal(studioWindowWarning(usage({ usedPercent: NaN as unknown as number })), null);
});

test('the threshold falls back rather than trusting a bad config value', () => {
  assert.equal(warnThresholdFrom('15'), 15);
  assert.equal(warnThresholdFrom('0'), 0);
  for (const bad of [null, undefined, '', '   ', 'soon', '-4', '140']) {
    assert.equal(warnThresholdFrom(bad), DEFAULT_LOW_WINDOW_WARN_PERCENT, String(bad));
  }
});
