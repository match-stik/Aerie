// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TASKS } from './orchestrator';

// A fresh install should not start by ringing at somebody else's hours. The
// daily rhythm of a house is the most personal thing in it, so the only bell
// shipped on a schedule is the weekly one — which is about the week rather
// than about anyone's day.
//
// This exists because the change that emptied the daily defaults passed the
// whole suite, and so would have emptying the table completely: nothing here
// tested the shipped schedule at all. Written afterwards and watched to fail.

test('exactly one bell ships on a schedule', () => {
  assert.equal(DEFAULT_TASKS.length, 1, 'a second shipped default is somebody else\'s hour');
  assert.equal(DEFAULT_TASKS[0].wakeType, 'weekly_reflection');
});

test('nothing shipped fires more often than weekly', () => {
  for (const def of DEFAULT_TASKS) {
    const dayOfWeek = def.cronExpr.trim().split(/\s+/)[4];
    assert.notEqual(
      dayOfWeek, '*',
      `${def.wakeType} fires every day — a daily default is a personal hour and belongs to the owner`,
    );
  }
});

test('the one that does ship still has a usable expression and label', () => {
  const [weekly] = DEFAULT_TASKS;
  assert.match(weekly.cronExpr, /^\S+ \S+ \S+ \S+ \S+$/, 'five cron fields');
  assert.ok(weekly.label.trim().length > 0);
});
