// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('./FilesApp.tsx', import.meta.url), 'utf8');

// Every file is stored under a uuid, so a row of names in the Images tab says
// nothing about which picture is which.
test('an image row shows the picture itself, small, and opens it', () => {
  assert.match(app, /import \{ thumbSrc \} from '\.\.\/lib\/thumb'/);
  assert.match(app, /thumbSrc\(`\/api\/files\/\$\{file\.fileId\}`, 256\)/);
  assert.match(app, /loading="lazy"/);
  assert.match(app, /aria-label=\{`View \$\{file\.filename\}`\}/);
});
