// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseClaudeUsage, parseCodexTokenCountLine } from './subscription-usage.js';

test('parses a real-shaped Claude usage payload', () => {
  const usage = parseClaudeUsage({
    five_hour: { utilization: 56.0, resets_at: '2026-07-22T10:49:59.535823+00:00' },
    seven_day: { utilization: 12.0, resets_at: '2026-07-28T11:59:59.535850+00:00' },
    extra_usage: { is_enabled: false },
    limits: [
      { kind: 'session', group: 'session', percent: 56 },
      { kind: 'weekly_all', group: 'weekly', percent: 12 },
      {
        kind: 'weekly_scoped',
        group: 'weekly',
        percent: 19,
        resets_at: '2026-07-28T11:59:59.536201+00:00',
        scope: { model: { id: null, display_name: 'Fable' } },
      },
    ],
  }, 'max');
  assert.equal(usage.fiveHourPercent, 56);
  assert.equal(usage.fiveHourResetsAt, '2026-07-22T10:49:59.535Z');
  assert.equal(usage.weeklyPercent, 12);
  assert.equal(usage.modelWeeklyPercent, 19);
  assert.equal(usage.modelWeeklyLabel, 'Fable');
  assert.equal(usage.extraUsageEnabled, false);
  assert.equal(usage.subscriptionType, 'max');
  assert.equal(usage.limits.length, 3);
  assert.deepEqual(usage.limits.map((l) => l.label), [
    '5-hour window',
    'weekly · all models',
    'weekly · Fable',
  ]);
  assert.equal(usage.limits[2].percent, 19);
  assert.equal(usage.limits[2].severity, 'normal');
});

test('every limit passes through generically, with severity and unknown kinds', () => {
  const usage = parseClaudeUsage({
    limits: [
      { kind: 'session', group: 'session', percent: 92, severity: 'warning', is_active: true },
      { kind: 'weekly_all', group: 'weekly', percent: 40 },
      {
        kind: 'weekly_scoped',
        percent: 61,
        scope: { model: { display_name: 'Fable' } },
      },
      {
        kind: 'weekly_scoped',
        percent: 12,
        scope: { model: { display_name: 'Opus' } },
      },
      { kind: 'monthly_new_thing', percent: 5, scope: { surface: 'cowork' } },
      { kind: 'broken', percent: 'high' },
    ],
  }, 'max');
  assert.deepEqual(usage.limits.map((l) => l.label), [
    '5-hour window',
    'weekly · all models',
    'weekly · Fable',
    'weekly · Opus',
    'monthly new thing · cowork',
  ]);
  assert.equal(usage.limits[0].severity, 'warning');
  assert.equal(usage.limits[0].isActive, true);
  // Legacy flat fields still point at the FIRST scoped model.
  assert.equal(usage.modelWeeklyLabel, 'Fable');
  assert.equal(usage.modelWeeklyPercent, 61);
});

test('extra usage detail and spend pass through', () => {
  const usage = parseClaudeUsage({
    extra_usage: {
      is_enabled: true,
      utilization: 34,
      monthly_limit: 50,
      used_credits: 17,
      disabled_reason: null,
    },
    spend: {
      used: { amount_minor: 1234, currency: 'USD', exponent: 2 },
      limit: { amount_minor: 5000, currency: 'USD', exponent: 2 },
      percent: 25,
      enabled: true,
      can_purchase_credits: true,
    },
  }, 'max');
  assert.deepEqual(usage.extraUsage, {
    enabled: true,
    utilization: 34,
    monthlyLimit: 50,
    usedCredits: 17,
    disabledReason: null,
  });
  assert.ok(usage.spend);
  assert.equal(usage.spend.usedFormatted, '$12.34');
  assert.equal(usage.spend.limitFormatted, '$50.00');
  assert.equal(usage.spend.percent, 25);
  assert.equal(usage.spend.enabled, true);
  assert.equal(usage.spend.canPurchaseCredits, true);
});

test('zero spend formats as $0.00 and null money as null', () => {
  const usage = parseClaudeUsage({
    spend: {
      used: { amount_minor: 0, currency: 'USD', exponent: 2 },
      limit: null,
      percent: 0,
      enabled: false,
      can_purchase_credits: false,
    },
  }, 'max');
  assert.ok(usage.spend);
  assert.equal(usage.spend.usedFormatted, '$0.00');
  assert.equal(usage.spend.limitFormatted, null);
  assert.equal(usage.spend.canPurchaseCredits, false);
});

test('Claude parser degrades safely on garbage (SPA-fallback insurance)', () => {
  const usage = parseClaudeUsage({}, 'unknown');
  assert.equal(usage.fiveHourPercent, 0);
  assert.equal(usage.fiveHourResetsAt, null);
  assert.equal(usage.weeklyPercent, 0);
  assert.equal(usage.modelWeeklyPercent, null);
  assert.equal(usage.modelWeeklyLabel, null);
  assert.equal(usage.extraUsageEnabled, false);
  assert.deepEqual(usage.limits, []);
  assert.deepEqual(usage.extraUsage, {
    enabled: false,
    utilization: null,
    monthlyLimit: null,
    usedCredits: null,
    disabledReason: null,
  });
  assert.equal(usage.spend, null);
});

test('extra usage enabled is only true on the literal flag', () => {
  assert.equal(parseClaudeUsage({ extra_usage: { is_enabled: true } }, 'max').extraUsageEnabled, true);
  assert.equal(parseClaudeUsage({ extra_usage: { is_enabled: 'yes' } }, 'max').extraUsageEnabled, false);
});

test('parses a real-shaped Codex token_count stamp', () => {
  const usage = parseCodexTokenCountLine({
    timestamp: '2026-07-22T06:45:10.410Z',
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { total_token_usage: { total_tokens: 22151 } },
      rate_limits: {
        limit_id: 'codex',
        primary: { used_percent: 88.0, window_minutes: 10080, resets_at: 1785259844 },
        secondary: null,
        plan_type: 'plus',
      },
    },
  });
  assert.ok(usage);
  assert.equal(usage.usedPercent, 88);
  assert.equal(usage.windowMinutes, 10080);
  assert.equal(usage.resetsAt, new Date(1785259844 * 1000).toISOString());
  assert.equal(usage.planType, 'plus');
  assert.equal(usage.capturedAt, '2026-07-22T06:45:10.410Z');
  assert.equal(usage.secondary, null);
  assert.equal(usage.limitReached, null);
});

test('Codex secondary window, credits, and limit-reached pass through', () => {
  const usage = parseCodexTokenCountLine({
    timestamp: '2026-07-22T06:45:10.410Z',
    payload: {
      type: 'token_count',
      rate_limits: {
        primary: { used_percent: 42.0, window_minutes: 300, resets_at: 1785259844 },
        secondary: { used_percent: 88.0, window_minutes: 10080, resets_at: 1785259900 },
        credits: { has_credits: true, unlimited: false, balance: '12.50' },
        plan_type: 'plus',
        rate_limit_reached_type: 'secondary',
      },
    },
  });
  assert.ok(usage);
  assert.equal(usage.usedPercent, 42);
  assert.ok(usage.secondary);
  assert.equal(usage.secondary.usedPercent, 88);
  assert.equal(usage.secondary.windowMinutes, 10080);
  assert.equal(usage.secondary.resetsAt, new Date(1785259900 * 1000).toISOString());
  assert.equal(usage.creditsBalance, '12.50');
  assert.equal(usage.hasCredits, true);
  assert.equal(usage.creditsUnlimited, false);
  assert.equal(usage.limitReached, 'secondary');
});

test('non-token_count lines and stamps without rate limits return null', () => {
  assert.equal(parseCodexTokenCountLine({ type: 'event_msg', payload: { type: 'agent_message' } }), null);
  assert.equal(
    parseCodexTokenCountLine({ type: 'event_msg', payload: { type: 'token_count', info: {} } }),
    null,
  );
  assert.equal(
    parseCodexTokenCountLine({
      payload: { type: 'token_count', rate_limits: { primary: { used_percent: 'high' } } },
    }),
    null,
  );
});
