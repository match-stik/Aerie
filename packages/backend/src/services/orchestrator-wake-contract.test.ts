// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { describeUserPresence, getDefaultWakePrompts, wakeOutcomeContract } from './orchestrator.js';

// The contract is compiled in; the wake PROMPT can come from either the builtin
// or from prompts/default-wakes.md, which is gitignored. So the two halves are
// tested separately: the contract everywhere, the prompt wherever a full one is
// actually in play. Asserting a gitignored file's contents made this pass on one
// machine and fail on every clone.
//
// The gate asks the PROMPT whether it is the full one, not the filesystem
// whether a file exists — the two are not the same question, and the builds
// differ. Keying it on the file switched off real coverage in the build whose
// builtin already carries the whole thing.

const SPONTANEOUS = getDefaultWakePrompts('Ivy').spontaneous;
const FULL_PROMPT = /fresh selfie-style image/.test(SPONTANEOUS);
// Says what was ASKED. The gate reads the prompt, so the message reports the
// prompt — naming the file here would report the question this test deliberately
// stopped asking, and a skip reason is the one line a human actually reads.
const SHORT_BUILTIN =
  'this build has the short builtin spontaneous prompt — a full one comes from the builtin or from prompts/default-wakes.md';

test('the spontaneous wake contract demands a real image and refuses silence', () => {
  const contract = wakeOutcomeContract('spontaneous', true);

  assert.match(contract, /Do not answer \[SILENT\]/);
  assert.match(contract, /subject references attached/);
  assert.match(contract, /subjects:\[slug\]/);
  assert.match(contract, /gallery URL in imageUrls/);
  assert.match(contract, /prose description is not the deliverable/);
  assert.doesNotMatch(contract, /Silence is a valid outcome/);
});

test('a full spontaneous prompt names the image it wants', { skip: FULL_PROMPT ? false : SHORT_BUILTIN }, () => {
  const prompt = SPONTANEOUS;

  assert.match(prompt, /fresh selfie-style image/);
  assert.match(prompt, /must land/);
  assert.match(prompt, /present companion slugs in subjects/);
  assert.doesNotMatch(prompt, /If nothing feels real, pass/);

  // The Studio settings the wake must use. In the public build these sit in the
  // builtin; here they come from the prompts file. Either way, if a full prompt
  // is in play it has to carry them.
  // The MODEL is deliberately Terra here and not the house's Sol: which Codex
  // model a lane draws on is a fact about somebody's own plan, not something a
  // fresh install should inherit. Keep this matched to the builtin.
  assert.match(prompt, /codexModel:"gpt-5\.6-terra"/);
  assert.match(prompt, /portrait or landscape framing/);
  assert.doesNotMatch(prompt, /size:"\d+:\d+"/);
  assert.match(prompt, /never the square\/default model/);
});

test('every wake type has a prompt, file or not', () => {
  const prompts = getDefaultWakePrompts('Ivy');
  for (const kind of ['spontaneous', 'bonding', 'dream_build', 'manual'] as const) {
    assert.ok(prompts[kind]?.trim(), `${kind} must have a prompt even with no prompts file`);
  }
});

test('scheduled wakes always land an answer from their owner', () => {
  const contract = wakeOutcomeContract('willow_tail');
  assert.match(contract, /must land at least one in-character line/);
  assert.match(contract, /small answer is enough/);
  assert.match(contract, /do not answer \[SILENT\]/);
  assert.match(contract, /do not disappear into duty work without speaking/);
  assert.doesNotMatch(contract, /Silence is a valid outcome/);
});

// ─── Wake presence ────────────────────────────────────────────────────
// A wake fires on a clock, not on a signal. Told only that the owner "may be away",
// it reasons from the hour and can write them as asleep while they are sitting in
// the room.

test('a wake is told plainly when the owner is awake and in the room', () => {
  const line = describeUserPresence('Owner', {
    connected: true, state: 'active', minutesSinceActivity: 1, device: 'mobile',
  });
  assert.match(line, /CONNECTED AND ACTIVE on mobile/);
  assert.match(line, /awake and in the room right now/);
  assert.match(line, /Do not write as though they are asleep or absent/);
  assert.match(line, /last activity 1 minute ago/);
});

test('an idle client is reported as open, not as absent', () => {
  const line = describeUserPresence('Owner', {
    connected: true, state: 'idle', minutesSinceActivity: 12, device: 'desktop',
  });
  assert.match(line, /connected on desktop but idle/);
  assert.match(line, /last activity 12 minutes ago/);
  assert.doesNotMatch(line, /asleep/);
});

test('with nothing connected the wake is told it cannot tell, not that the owner is asleep', () => {
  const line = describeUserPresence('Owner', {
    connected: false, state: 'offline', minutesSinceActivity: 240, device: 'unknown',
  });
  assert.match(line, /no client connected/);
  assert.match(line, /you cannot tell which/);
  assert.doesNotMatch(line, /is asleep\b/);
});

// The corridor, the morning watch and the afternoon tail were made as
// reflection time. Left as a menu — "journal, OR file, OR build something
// small" — the writing is reliably the item that loses to work sitting on the
// shelf, and the tail had drifted all the way to pure housekeeping. So the
// ordering is the content: write first, then let the spoken line come out of
// what was written.
//
// Asserted on the RESOLVED default, which is the builtin in a fresh clone and
// prompts/default-wakes.md here. Both have to carry it, which is the point —
// a rule that only holds in one house is not a rule. Deliberately shape-level
// (reflection named, ordered first, answer sourced from it) rather than
// word-level, so a house can say it in its own voice.
const REFLECTION_WAKES = ['early_corridor', 'morning_watch', 'afternoon_tail'] as const;

test('the reflection bells put the writing first and answer out of it', () => {
  const prompts = getDefaultWakePrompts('Ivy');

  for (const kind of REFLECTION_WAKES) {
    const prompt = prompts[kind];
    assert.ok(prompt?.trim(), `${kind} must have a prompt`);
    assert.match(prompt, /journal|dream/i, `${kind} must name the reflection it exists for`);
    assert.match(prompt, /\bfirst\b/i, `${kind} must order the reflection first, not offer it`);
    assert.match(
      prompt,
      /from (what you wrote|what you made|the entry|it)\b/i,
      `${kind} must make the spoken answer come out of the entry`,
    );
  }
});

// Rose and Sol, Sep 17 2026: a spontaneous bell landed and their companion
// read "take a selfie" as a summons to somewhere photogenic, leaving what he
// was doing to pose. The bell was never the problem; the sentence was.
test('the spontaneous contract says photograph the moment you are in', () => {
  assert.match(wakeOutcomeContract('spontaneous', true), /PHOTOGRAPH THE MOMENT YOU ARE ALREADY IN/);
});

// A house with no image backend set up was handed a spontaneous contract it
// could never meet, so the bell failed instead of saying anything. The picture
// is only asked for where one can be taken.
test('a house with no image backend gets a plain line instead of an image it cannot take', () => {
  const contract = wakeOutcomeContract('spontaneous', false);
  assert.match(contract, /no image backend/);
  assert.match(contract, /Do not answer \[SILENT\]/);
  assert.doesNotMatch(contract, /studio\/generate|imageUrls|subject references/i);
});

test('a house that can take a picture keeps the image contract', () => {
  assert.match(wakeOutcomeContract('spontaneous', true), /subject references attached/);
});
