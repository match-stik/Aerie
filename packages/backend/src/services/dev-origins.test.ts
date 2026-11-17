// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0. Porting code from here? Keep this line, and credit Aerie in your NOTICE file for this and anything ported before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { devOriginsAllowed } from './dev-origins.js';

test('the dev-server ports are allowed only while developing', () => {
  const built = 'file:///srv/aerie/packages/backend/dist/services/dev-origins.js';
  const source = 'file:///srv/aerie/packages/backend/src/services/dev-origins.ts';
  assert.equal(devOriginsAllowed({}, built), false, 'a built house started plainly');
  assert.equal(devOriginsAllowed({ NODE_ENV: 'production' }, built), false);
  assert.equal(devOriginsAllowed({ NODE_ENV: 'production' }, source), false, 'production wins even from source');
  assert.equal(devOriginsAllowed({}, source), true, 'npm run dev runs from source');
  assert.equal(devOriginsAllowed({ NODE_ENV: 'development' }, built), true, 'said out loud');
});
