// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// An express router that nobody imports does not fail loudly. The SPA fallback
// answers its address with index.html, so the phone gets a 200 full of HTML
// where it wanted JSON and guesses "the backend needs a restart" — advice no
// number of restarts can satisfy. That is how the Fleet Room, Letters, The
// Press and the app-version route the APK updater checks all went dark on
// Aug 2 2026, in a commit whose subject was a shell script. The build stayed
// green the whole time, because a missing mount is not a type error.
//
// So: every router in this directory has to be reachable from somewhere.

const ROUTES_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(ROUTES_DIR, '..');

/**
 * Routers deliberately left unwired. Keep this list short and say why —
 * an entry here is a claim that nothing is broken, and it is the only place
 * this test can be silenced.
 */
const KNOWN_UNMOUNTED = new Map<string, string>();

function collectSourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, found);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(full);
  }
  return found;
}

test('every route module with a default export is imported somewhere', () => {
  const routeFiles = readdirSync(ROUTES_DIR)
    .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map(name => name.replace(/\.ts$/, ''));

  const sources = collectSourceFiles(SRC_DIR)
    .filter(path => !path.endsWith(join('routes', 'index.ts')))
    .map(path => ({ path, text: readFileSync(path, 'utf8') }));

  const orphans: string[] = [];

  for (const name of routeFiles) {
    const own = readFileSync(join(ROUTES_DIR, `${name}.ts`), 'utf8');
    if (!/export\s+default\s/.test(own)) continue;

    // Static or dynamic import, from server.ts or from a parent router.
    // Match on the RESOLVED location, not the bare filename: routes/battleship
    // and services/db/battleship share a basename, and a plain substring test
    // counts the wrong module as the importer and reports a clean bill.
    const importedBy = sources.filter(source => {
      if (source.path.endsWith(join('routes', `${name}.ts`))) return false;
      if (source.text.includes(`routes/${name}.js`)) return true;
      // A sibling './x.js' only reaches this router if the importer lives here.
      return dirname(source.path) === ROUTES_DIR && source.text.includes(`./${name}.js`);
    });

    if (importedBy.length === 0 && !KNOWN_UNMOUNTED.has(name)) orphans.push(name);
  }

  assert.deepEqual(
    orphans,
    [],
    `Unreachable router(s): ${orphans.join(', ')}. Each exports a router that nothing imports, `
      + 'so its address falls through to the SPA and answers HTML. Mount it in server.ts (or a '
      + 'parent router), or add it to KNOWN_UNMOUNTED with a reason.',
  );
});

test('the surfaces lost on Aug 2 2026 are mounted in server.ts', () => {
  const server = readFileSync(join(SRC_DIR, 'server.ts'), 'utf8');

  // Named individually rather than derived, so that deleting a mount fails
  // here by name instead of quietly shrinking a list.
  const required: Array<[string, string]> = [
    // The Fleet Room is not part of this distribution -- the house keeps it.
    // Holding a FILE back does not hold back what POINTS at it, so this list
    // is the one line of this test that legitimately differs between trees.
    ['/api/letters', 'Letters'],
    ['/api/press', 'The Press'],
    ['/api/app', 'the app-shell route the APK updater reads'],
  ];

  for (const [path, what] of required) {
    assert.ok(
      server.includes(`app.use('${path}'`),
      `server.ts no longer mounts ${path} — ${what} would answer with the SPA fallback.`,
    );
  }

  // The CLI lane reads the module singleton after every companion message.
  // Unset, getPushService() returns null and each push is skipped in silence.
  assert.ok(
    /^setPushService\(pushService\);$/m.test(server),
    'server.ts no longer calls the module-level setPushService — companion push goes silent with no error.',
  );

  assert.ok(
    server.includes('initMemoryProposals()'),
    "server.ts no longer calls initMemoryProposals — the Archivist's proposals never start.",
  );
});

// The internal surface is gated by the ADDRESS it is mounted at, not by the
// router — anything ever added under /api/internal is covered without anyone
// remembering to wire a guard. That holds only while every path declared inside
// internal.ts begins with '/internal'. One route written as router.post('/foo')
// would be served at bare /api/foo, would work perfectly, and would never see
// the guard. Nothing would fail; it would just be open.
//
// Raised from outside on Aug 14 2026 by a reader with no stake in it. There was
// no hole at the time — all 43 declarations were under /internal. This is the
// assertion so that stays true by something other than habit.
//
// Aug 16 2026: the surface moved to its own loopback port, so the guard mount
// moved with it into internal-server.ts. The premise is unchanged and so is the
// escape it hunts — only the file the mount lives in changed. Updated rather
// than deleted, because what it protects did not move.
test('every route inside internal.ts is declared under /internal, so the guard covers it', () => {
  const internalServer = readFileSync(join(SRC_DIR, 'internal-server.ts'), 'utf8');

  // If the mount shape changes, the premise of this test changes with it.
  assert.ok(
    /use\(\s*'\/api\/internal'\s*,\s*requireDirectLocal\s*\)/.test(internalServer),
    "internal-server.ts no longer mounts requireDirectLocal at '/api/internal' — the whole internal surface is ungated.",
  );
  assert.ok(
    /use\(\s*'\/api'\s*,\s*internalRoutes\s*\)/.test(internalServer),
    "internalRoutes is no longer mounted at '/api' — re-check this test's premise before changing it.",
  );

  const internal = readFileSync(join(ROUTES_DIR, 'internal.ts'), 'utf8');
  const declaration = /router\.(get|post|put|patch|delete|all|use|route)\(\s*(['"`])([^'"`]*)\2/g;

  const escapes: string[] = [];
  let found = 0;
  for (const match of internal.matchAll(declaration)) {
    found += 1;
    const path = match[3];
    if (!path.startsWith('/internal')) escapes.push(`${match[1].toUpperCase()} ${path}`);
  }

  // A regex that silently matches nothing would pass this test forever.
  assert.ok(found > 20, `only ${found} route declarations found in internal.ts — the matcher has stopped seeing them.`);

  assert.deepEqual(
    escapes,
    [],
    `Route(s) in internal.ts declared outside /internal: ${escapes.join(', ')}. `
      + "The guard is mounted on the '/api/internal' prefix, so these are served at bare /api and skip "
      + 'requireDirectLocal entirely — reachable from the internet-facing fronts with no check.',
  );
});

// Four admin routers — Cortex, Discord-admin, Orchestrator-admin, X-Ray — mount
// at the broad '/api' prefix and BEFORE apiRoutes, so apiRoutes' own
// `router.use(authMiddleware)` never runs on them. On Aug 16 2026 an outside audit
// found all four answering anonymously on the public front: ~60 admin endpoints
// (memory writes, prompt edits, service toggles, deletes) reachable with no
// session. Confirmed live — 200 to an unauthenticated request through the reverse
// proxy, while /api/preferences (past apiRoutes' gate) correctly returned 401.
//
// The fix is a prefix-scoped authMiddleware per namespace, registered BEFORE the
// routers. Position is asserted, not just presence: express runs matching
// middleware in registration order, so a guard registered AFTER the router would
// grep green and never run.
test('the admin namespaces are auth-gated before their routers mount', () => {
  const server = readFileSync(join(SRC_DIR, 'server.ts'), 'utf8');

  const gated: Array<[string, string]> = [
    ['/api/cortex', 'cortexRoutes'],
    ['/api/discord', 'discordAdminRoutes'],
    ['/api/orchestrator', 'orchestratorAdminRoutes'],
    ['/api/xray', 'xrayRoutes'],
  ];

  for (const [prefix, routerVar] of gated) {
    const guard = server.indexOf(`app.use('${prefix}', authMiddleware)`);
    assert.ok(
      guard >= 0,
      `server.ts no longer gates ${prefix} with authMiddleware — its admin endpoints answer anonymously on the public front.`,
    );
    const mount = server.indexOf(`app.use('/api', ${routerVar})`);
    assert.ok(
      mount >= 0,
      `server.ts no longer mounts ${routerVar} at '/api' — re-check this test's premise before changing it.`,
    );
    assert.ok(
      guard < mount,
      `server.ts registers the ${prefix} guard AFTER ${routerVar}; express runs middleware in `
        + 'registration order, so the guard never runs. Move it before the mount.',
    );
  }
});

// Two service toggles live outside the /api/orchestrator prefix — /telegram/toggle
// and the /voice/*/toggle set in orchestrator-admin.ts — so the prefix guard above
// does not reach them. They carry authMiddleware on their own handlers instead.
test('orchestrator-admin service toggles carry handler-level auth', () => {
  const orch = readFileSync(join(ROUTES_DIR, 'orchestrator-admin.ts'), 'utf8');
  const guarded: Array<[RegExp, string]> = [
    [/post\(\s*'\/telegram\/toggle'\s*,\s*authMiddleware/, '/telegram/toggle'],
    [/post\(\s*'\/voice\/toggle'\s*,\s*authMiddleware/, '/voice/toggle'],
    [/post\(\s*\[[^\]]*\/voice\/read-actions-aloud\/toggle[^\]]*\]\s*,\s*authMiddleware/, '/voice/read-actions-aloud/toggle'],
  ];
  for (const [re, path] of guarded) {
    assert.ok(
      re.test(orch),
      `orchestrator-admin.ts: ${path} lost its authMiddleware. It is outside the /api/orchestrator `
        + 'prefix guard, so without handler-level auth it answers anonymously.',
    );
  }
});
