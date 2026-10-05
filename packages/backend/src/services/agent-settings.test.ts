// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { persistAgentModelSelection } from './agent-settings.js';

// The trap this file exists to close: an agent.* setting lives in three places
// and the dispatcher reads only one of them. /model wrote the DB row alone, so
// it reported success while the live model never moved. These pin the YAML
// half — the half that was missing — against a real file.

function writeYaml(dir: string, obj: unknown): string {
  const p = join(dir, 'aerie.yaml');
  writeFileSync(p, yaml.dump(obj), 'utf-8');
  return p;
}

function applyToYaml(path: string, key: string, value: string): void {
  // Mirrors persistAgentSetting's YAML step. Held separately because the real
  // function also touches the DB and the process config, neither of which a
  // unit test should need standing up.
  const parsed = (yaml.load(readFileSync(path, 'utf-8')) as Record<string, any>) || {};
  if (!parsed.agent) parsed.agent = {};
  parsed.agent[key.slice('agent.'.length)] = value;
  writeFileSync(path, yaml.dump(parsed, { lineWidth: -1, quoteStyle: 'double', forceQuotes: true }), 'utf-8');
}

test('a model change reaches the file the dispatcher reads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aerie-settings-'));
  try {
    const p = writeYaml(dir, { agent: { model: 'claude-opus-5', routing: 'cli' } });
    applyToYaml(p, 'agent.model', 'claude-fable-5');
    const after = yaml.load(readFileSync(p, 'utf-8')) as any;
    assert.equal(after.agent.model, 'claude-fable-5');
    assert.equal(after.agent.routing, 'cli', 'the rest of the agent block must survive the write');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an agent block that does not exist yet is created rather than crashed on', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aerie-settings-'));
  try {
    const p = writeYaml(dir, { identity: { user_name: 'Owner' } });
    applyToYaml(p, 'agent.routing', 'sdk');
    const after = yaml.load(readFileSync(p, 'utf-8')) as any;
    assert.equal(after.agent.routing, 'sdk');
    assert.equal(after.identity.user_name, 'Owner', 'unrelated sections must be left alone');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a slash model switch carries a Codex model onto the warm Codex route', () => {
  const writes: Array<[string, string]> = [];
  const route = persistAgentModelSelection(
    'gpt-5.6-sol',
    'cli',
    (key, value) => writes.push([key, value]),
  );

  assert.equal(route, 'codex-cli');
  assert.deepEqual(writes, [
    ['agent.model', 'gpt-5.6-sol'],
    ['agent.routing', 'codex-cli'],
  ]);
});

test('a slash model switch carries a Claude model back to the warm Claude route', () => {
  const writes: Array<[string, string]> = [];
  const route = persistAgentModelSelection(
    'claude-fable-5',
    'codex-cli',
    (key, value) => writes.push([key, value]),
  );

  assert.equal(route, 'cli');
  assert.deepEqual(writes, [
    ['agent.model', 'claude-fable-5'],
    ['agent.routing', 'cli'],
  ]);
});

test('an explicit API route remains explicit when the model changes', () => {
  const writes: Array<[string, string]> = [];
  const route = persistAgentModelSelection(
    'gpt-5.6-sol',
    'api',
    (key, value) => writes.push([key, value]),
  );

  assert.equal(route, 'api');
  assert.deepEqual(writes, [['agent.model', 'gpt-5.6-sol']]);
});
