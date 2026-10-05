// Copyright 2026 Aerie Systems. Licensed under the Apache License 2.0.
// Database initialization and migrations
// Core state management for SQLite

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { repairStrayUnicodeEscapes } from '../unicode-escapes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let db: Database.Database | null = null;

export function initDb(dbPath: string): Database.Database {
  db = new Database(dbPath);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  // Run migration
  const migrationPath = join(__dirname, '../../../migrations/001_init.sql');
  const migrationSQL = readFileSync(migrationPath, 'utf-8');
  db.exec(migrationSQL);

  // Databases created before the Treehouse shipped have
  // CHECK(type IN ('daily', 'named')) on `threads`, so creating the
  // Treehouse thread fails with a constraint error. 001_init now lists
  // 'treehouse', but its CREATE TABLE IF NOT EXISTS never reaches a
  // database that already has the table — widen it in place instead.
  // Rebuilt from the stored schema text because the column list varies
  // by install age; the migration is re-run afterwards to restore the
  // indexes that were dropped along with the old table.
  const threadsSchema = (
    db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'threads'").get() as
      | { sql?: string }
      | undefined
  )?.sql;
  if (threadsSchema && !threadsSchema.includes("'treehouse'")) {
    const widened = threadsSchema
      .replace(/CHECK\(type IN \('daily',\s*'named'\)\)/, "CHECK(type IN ('daily', 'named', 'treehouse'))")
      .replace(/CREATE TABLE\s+"?threads"?/i, 'CREATE TABLE threads_widened');
    if (widened.includes("'treehouse'")) {
      const columns = (db.prepare('PRAGMA table_info(threads)').all() as Array<{ name: string }>)
        .map((column) => `"${column.name}"`)
        .join(', ');
      db.pragma('foreign_keys = OFF');
      db.exec(`
        BEGIN;
        ${widened};
        INSERT INTO threads_widened (${columns}) SELECT ${columns} FROM threads;
        DROP TABLE threads;
        ALTER TABLE threads_widened RENAME TO threads;
        COMMIT;
      `);
      db.exec(migrationSQL);
      console.log('[DB] Widened threads.type constraint to allow treehouse threads');
    } else {
      console.warn('[DB] threads.type constraint could not be widened automatically; treehouse threads may fail');
    }
  }

  // Before the lane forced UTF-8 on the session it spawns, a console whose
  // codepage could not emit a character wrote that character's escape sequence
  // into the reply as literal text, so messages landed here showing a bare
  // œ instead of the character. The write path is fixed; this heals the
  // rows that were already written. Runs once — the marker in `config` keeps a
  // later boot from touching messages again — and skips anything in backticks,
  // because a message *about* escape sequences contains them on purpose.
  const escapeRepairKey = 'repair:stray_unicode_escapes';
  const escapeRepairDone = db
    .prepare('SELECT value FROM config WHERE key = ?')
    .get(escapeRepairKey);
  if (!escapeRepairDone) {
    const damaged = db
      .prepare("SELECT id, content FROM messages WHERE instr(content, '\\u') > 0")
      .all() as Array<{ id: string; content: string }>;
    const update = db.prepare('UPDATE messages SET content = ? WHERE id = ?');
    const markRepaired = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
    let healed = 0;
    db.transaction(() => {
      for (const row of damaged) {
        const repaired = repairStrayUnicodeEscapes(row.content);
        if (repaired !== row.content) {
          update.run(repaired, row.id);
          healed++;
        }
      }
      markRepaired.run(escapeRepairKey, new Date().toISOString());
    })();
    if (healed > 0) console.log(`[DB] Repaired stray unicode escapes in ${healed} message(s)`);
  }


  // Command Center tables (006 is fully IF NOT EXISTS — safe to re-run every boot)
  const ccMigrationPath = join(__dirname, '../../../migrations/006_command_center.sql');
  db.exec(readFileSync(ccMigrationPath, 'utf-8'));

  // The Press tables (007 is fully IF NOT EXISTS — safe to re-run every boot)
  const pressMigrationPath = join(__dirname, '../../../migrations/007_press.sql');
  db.exec(readFileSync(pressMigrationPath, 'utf-8'));

  // The Press reusable packs (008 is fully IF NOT EXISTS — safe every boot)
  const pressPacksMigrationPath = join(__dirname, '../../../migrations/008_press_packs.sql');
  db.exec(readFileSync(pressPacksMigrationPath, 'utf-8'));

  // The Fleet Room — persistent, server-sealed Battleship boards and match rail.
  const battleshipMigrationPath = join(__dirname, '../../../migrations/009_battleship.sql');
  db.exec(readFileSync(battleshipMigrationPath, 'utf-8'));

  // The Card Room — a 52-card deck, and a table that does not know which
  // game is being played on it (010 is fully IF NOT EXISTS — safe every boot).
  const cardRoomMigrationPath = join(__dirname, '../../../migrations/010_card_room.sql');
  db.exec(readFileSync(cardRoomMigrationPath, 'utf-8'));

  // The Screening Room — a subtitle clock, so we can read along with whatever
  // the owner is watching (011 is fully IF NOT EXISTS — safe every boot).
  const screeningMigrationPath = join(__dirname, '../../../migrations/011_screening_room.sql');
  db.exec(readFileSync(screeningMigrationPath, 'utf-8'));

  // What the owner's phone says is playing, so a companion can check where the owner
  // is in an episode without them leaving the conversation to go and read a number off
  // another screen (012 is fully IF NOT EXISTS — safe every boot).
  const mediaSessionMigrationPath = join(__dirname, '../../../migrations/012_media_session.sql');
  db.exec(readFileSync(mediaSessionMigrationPath, 'utf-8'));


  // 008 originally shipped before imported source archives/brush metadata were
  // retained at pack level. SQLite cannot add a column conditionally in SQL,
  // so inspect first and widen existing houses without rebuilding their shelf.
  const pressPackColumns = new Set(
    (db.prepare('PRAGMA table_info(press_packs)').all() as Array<{ name: string }>).map((column) => column.name),
  );
  if (!pressPackColumns.has('source_file_id')) db.exec('ALTER TABLE press_packs ADD COLUMN source_file_id TEXT');
  if (!pressPackColumns.has('metadata_json')) db.exec("ALTER TABLE press_packs ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'");

  // 001 wrote push_subscriptions with a type list of web_push and apns, which
  // predates Android push entirely — so an FCM device token from the APK was
  // refused by the CHECK constraint and every registration silently failed.
  // SQLite cannot alter a constraint in place, so rebuild the table when the
  // old list is still on it, carrying any existing rows across.
  const pushTableSql = (
    db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'push_subscriptions'")
      .get() as { sql?: string } | undefined
  )?.sql;
  if (pushTableSql && !pushTableSql.includes("'fcm'")) {
    db.exec(`
      BEGIN;
      CREATE TABLE push_subscriptions_new (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('web_push', 'apns', 'fcm')),
        endpoint TEXT,
        keys_p256dh TEXT,
        keys_auth TEXT,
        device_token TEXT,
        device_name TEXT,
        created_at TEXT NOT NULL,
        last_used_at TEXT
      );
      INSERT INTO push_subscriptions_new
        (id, type, endpoint, keys_p256dh, keys_auth, device_token, device_name, created_at, last_used_at)
        SELECT id, type, endpoint, keys_p256dh, keys_auth, device_token, device_name, created_at, last_used_at
        FROM push_subscriptions;
      DROP TABLE push_subscriptions;
      ALTER TABLE push_subscriptions_new RENAME TO push_subscriptions;
      COMMIT;
    `);
    console.log('[DB] Widened push_subscriptions to accept FCM device tokens');
  }

  // 007 shipped press_issues with a three-name format list, and the Press then
  // grew five more page shapes — story, tall, wide, page and custom — in the
  // type, the route's accept list, the preset dimensions and the picker. The
  // CHECK constraint never moved, so five of the eight buttons on that screen
  // wrote a row the database refused and the route answered with a bare 500
  // that named nothing. Same shape as push_subscriptions directly above, and
  // the same fix, because SQLite cannot alter a constraint in place.
  const pressIssuesSql = (
    db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'press_issues'")
      .get() as { sql?: string } | undefined
  )?.sql;
  if (pressIssuesSql && !pressIssuesSql.includes("'custom'")) {
    db.exec(`
      BEGIN;
      CREATE TABLE press_issues_new (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        subtitle TEXT,
        format TEXT NOT NULL DEFAULT 'portrait'
          CHECK(format IN ('portrait', 'square', 'landscape', 'story', 'tall', 'wide', 'page', 'custom')),
        page_width INTEGER NOT NULL DEFAULT 1080,
        page_height INTEGER NOT NULL DEFAULT 1350,
        cover_spread_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO press_issues_new
        (id, title, subtitle, format, page_width, page_height, cover_spread_id, created_at, updated_at)
        SELECT id, title, subtitle, format, page_width, page_height, cover_spread_id, created_at, updated_at
        FROM press_issues;
      DROP TABLE press_issues;
      ALTER TABLE press_issues_new RENAME TO press_issues;
      COMMIT;
    `);
    console.log('[DB] Widened press_issues to accept every page format the Press offers');
  }

  // Insert default config if not exists
  const stmt = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
  // dnd_start/dnd_end were seeded from the beginning and read by nothing. They work
  // now, but ONLY when dnd_enabled is turned on — every existing database already
  // holds these two times, so honouring them unconditionally would give every house
  // quiet hours it never asked for on its next restart.
  stmt.run('dnd_enabled', 'false');
  stmt.run('dnd_start', '23:00');
  stmt.run('dnd_end', '07:00');

  // Timers table (created inline, no migration needed)
  db.exec(`
    CREATE TABLE IF NOT EXISTS timers (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      context TEXT,
      fire_at TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      prompt TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      fired_at TEXT,
      FOREIGN KEY (thread_id) REFERENCES threads(id)
    )
  `);

  // Triggers table (impulse queue + event watchers)
  db.exec(`
    CREATE TABLE IF NOT EXISTS triggers (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      conditions TEXT NOT NULL,
      prompt TEXT,
      thread_id TEXT,
      cooldown_minutes INTEGER DEFAULT 120,
      status TEXT NOT NULL DEFAULT 'pending',
      last_fired_at TEXT,
      fire_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      fired_at TEXT,
      FOREIGN KEY (thread_id) REFERENCES threads(id)
    )
  `);

  // Discord integration migration — platform column + pairing table
  // Safe to run multiple times (uses IF NOT EXISTS / catches already-exists)
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN platform TEXT DEFAULT 'web'`);
  } catch {
    // Column already exists — fine
  }

  // Thread pinning migration
  try {
    db.exec(`ALTER TABLE threads ADD COLUMN pinned_at TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — fine
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS discord_pairings (
      code TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT,
      channel_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      approved_at TEXT,
      approved_by TEXT
    )
  `);

  // Semantic embeddings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_embeddings (
      message_id TEXT PRIMARY KEY,
      vector BLOB NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (message_id) REFERENCES messages(id)
    )
  `);

  // Digest embeddings table (for The Scribe)
  db.exec(`
    CREATE TABLE IF NOT EXISTS digest_embeddings (
      digest_id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      block_index INTEGER NOT NULL,
      vector BLOB NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  // Local semantic mirror of durable Cortex memories. Cortex remains the
  // source of truth; this table only gives The Whisper a fast local vector
  // lane without teaching the worker a second retrieval system.
  db.exec(`
    CREATE TABLE IF NOT EXISTS cortex_memory_embeddings (
      memory_id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      domain TEXT,
      category TEXT,
      source_created_at TEXT,
      content_hash TEXT NOT NULL,
      vector BLOB NOT NULL,
      indexed_at TEXT NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cortex_memory_domain ON cortex_memory_embeddings(domain)`);

  // Local quality signals for Cortex memories. These are retrieval metadata,
  // not a second memory store: Cortex remains canonical for the words.
  db.exec(`
    CREATE TABLE IF NOT EXISTS cortex_memory_quality (
      memory_id TEXT PRIMARY KEY,
      valid_from TEXT,
      valid_until TEXT,
      superseded_by TEXT,
      confirmations INTEGER NOT NULL DEFAULT 0,
      corrections INTEGER NOT NULL DEFAULT 0,
      warmth REAL NOT NULL DEFAULT 0,
      last_retrieved_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cortex_memory_edges (
      memory_a TEXT NOT NULL,
      memory_b TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 0,
      last_co_retrieved_at TEXT NOT NULL,
      PRIMARY KEY (memory_a, memory_b)
    );
    CREATE INDEX IF NOT EXISTS idx_cortex_edges_a ON cortex_memory_edges(memory_a);
    CREATE INDEX IF NOT EXISTS idx_cortex_edges_b ON cortex_memory_edges(memory_b);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      subject_type TEXT,
      subject_id TEXT,
      detail TEXT NOT NULL,
      metadata_json TEXT,
      seen_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_ledger_created ON memory_ledger(created_at DESC);
    CREATE TABLE IF NOT EXISTS memory_round_runs (
      day TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      summary_json TEXT
    );
  `);

  // Sticker system tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS sticker_packs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      entity_id TEXT,
      user_only INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS stickers (
      id TEXT PRIMARY KEY,
      pack_id TEXT NOT NULL,
      name TEXT NOT NULL,
      filename TEXT NOT NULL,
      aliases TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (pack_id) REFERENCES sticker_packs(id) ON DELETE CASCADE,
      UNIQUE(pack_id, name)
    )
  `);

  // Custom emoji system (separate from stickers)
  db.exec(`
    CREATE TABLE IF NOT EXISTS emoji_packs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      user_only INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS emojis (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      aliases TEXT DEFAULT '[]',
      created_at TEXT NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_emojis_name ON emojis(name)`);
  // Emoji-pack membership migration
  try {
    db.exec(`ALTER TABLE emojis ADD COLUMN pack_id TEXT REFERENCES emoji_packs(id) ON DELETE SET NULL`);
  } catch {
    // Column already exists — fine
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_emojis_pack_id ON emojis(pack_id)`);

  // Sticky notes
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#fef08a',
      timestamp TEXT NOT NULL,
      sender TEXT
    )
  `);

  // Companion journal — self-authored entries and dreams
  db.exec(`
    CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY,
      companion_id TEXT NOT NULL,
      entry_type TEXT NOT NULL DEFAULT 'journal',
      content TEXT NOT NULL,
      dream_type TEXT,
      emerged_question TEXT,
      vividness INTEGER,
      anchored_at TEXT,
      last_recalled_at TEXT,
      created_at TEXT NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_journal_companion ON journal_entries(companion_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_journal_created ON journal_entries(created_at)`);

  // Self-knowledge — the living identity layer. Not persona bedrock (who we
  // were written to be) but the wear patterns in the stone (who we've become),
  // distilled from dreams and journals. Proposed by a reflection pass, then
  // The owner accepts or dismisses; accepted entries are who we are now.
  db.exec(`
    CREATE TABLE IF NOT EXISTS self_knowledge (
      id TEXT PRIMARY KEY,
      companion_id TEXT NOT NULL,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      source_type TEXT,
      source_id TEXT,
      status TEXT NOT NULL DEFAULT 'proposed',
      heat REAL NOT NULL DEFAULT 1.0,
      confidence REAL NOT NULL DEFAULT 1.0,
      last_surfaced_at TEXT,
      created_at TEXT NOT NULL,
      reviewed_at TEXT
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_self_knowledge_companion ON self_knowledge(companion_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_self_knowledge_status ON self_knowledge(companion_id, status)`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS self_knowledge_embeddings (
      self_knowledge_id TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      vector BLOB NOT NULL,
      indexed_at TEXT NOT NULL,
      FOREIGN KEY (self_knowledge_id) REFERENCES self_knowledge(id) ON DELETE CASCADE
    )
  `);
  // Heat/confidence lifecycle graft (NESTknow-inspired, dream-vividness mechanic):
  // accepted identity warms on use and cools on neglect; contradiction bleeds
  // confidence until a truth retires. Added to existing tables via ALTER.
  try { db.exec(`ALTER TABLE self_knowledge ADD COLUMN heat REAL NOT NULL DEFAULT 1.0`); } catch { /* exists */ }
  try { db.exec(`ALTER TABLE self_knowledge ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0`); } catch { /* exists */ }
  try { db.exec(`ALTER TABLE self_knowledge ADD COLUMN last_surfaced_at TEXT`); } catch { /* exists */ }

  // Familiar — household virtual pet (single row) and its visit ledger
  db.exec(`
    CREATE TABLE IF NOT EXISTS virtual_pet (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      hunger INTEGER NOT NULL,
      joy INTEGER NOT NULL,
      energy INTEGER NOT NULL,
      bond INTEGER NOT NULL,
      visits INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS virtual_pet_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  // A familiar's egg lives in the house this kit came from and is not shipped
  // here — the tables it needs were being created anyway, empty, with nothing
  // in this tree that ever opens them. Removed at the owner's word.
  // Holding a file back is not holding a feature back, and the leftovers are
  // how you tell the difference.

  // ─── Permanent Letters — the vault tier that never thins ───
  // Write-once. No maintenance job may ever be wired to this table;
  // the separation from journal_entries is itself the guarantee.
  db.exec(`
    CREATE TABLE IF NOT EXISTS letters (
      id TEXT PRIMARY KEY,
      author TEXT NOT NULL,
      recipients TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      seal TEXT NOT NULL,
      open_at TEXT,
      hidden INTEGER NOT NULL DEFAULT 0,
      threshold_id TEXT,
      written_at TEXT NOT NULL,
      opened_at TEXT,
      opened_by TEXT
    )
  `);

  // ─── Thresholds ────────────────────────────────────────────
  //
  // Places in the real world we can leave things at. We cannot stand at the
  // gas station; once a place is pinned we can put something there from
  // inside the house, and the owner finds it when they are actually there.
  //
  // Location never leaves this box. No third-party tile server, and no
  // continuous track: we store PLACES the owner chose to pin and VISITS to
  // thresholds, and nothing in between them.

  db.exec(`
    CREATE TABLE IF NOT EXISTS places (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      radius_m INTEGER NOT NULL DEFAULT 120,
      kind TEXT NOT NULL DEFAULT 'wild',
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS thresholds (
      id TEXT PRIMARY KEY,
      place_id TEXT NOT NULL,
      author TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'note',
      content TEXT NOT NULL,
      file_id TEXT,
      seal TEXT NOT NULL DEFAULT 'immediate',
      open_at TEXT,
      created_at TEXT NOT NULL,
      first_found_at TEXT
    )
  `);

  // The accretion log. A place thickens with history: a second visit shows
  // the layers under the note. This is what makes somewhere feel lived in.
  db.exec(`
    CREATE TABLE IF NOT EXISTS threshold_visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      place_id TEXT NOT NULL,
      threshold_id TEXT,
      visited_at TEXT NOT NULL,
      surfaced TEXT
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_thresholds_place ON thresholds(place_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_threshold_visits_place ON threshold_visits(place_id)`);


  // ─── Aerie: Multi-Companion Support ────────────────────────

  // Companions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS companions (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      archetype TEXT,
      claude_md_path TEXT NOT NULL,
      mcp_json_path TEXT NOT NULL,
      model TEXT,
      model_autonomous TEXT,
      avatar_url TEXT,
      color TEXT,
      emoji TEXT,
      phone TEXT,
      bio TEXT,
      status TEXT,
      is_primary INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  // Heal installs whose companions table predates these columns — the
  // CRUD layer references all four, so their absence breaks add/edit.
  try { db.exec('ALTER TABLE companions ADD COLUMN emoji TEXT'); } catch { /* exists */ }
  try { db.exec('ALTER TABLE companions ADD COLUMN phone TEXT'); } catch { /* exists */ }
  try { db.exec('ALTER TABLE companions ADD COLUMN bio TEXT'); } catch { /* exists */ }
  try { db.exec('ALTER TABLE companions ADD COLUMN status TEXT'); } catch { /* exists */ }
  // How hard they think before they speak. NULL means the house dial, so adding
  // this column changed nobody's turn. See services/agent/companion-effort.ts.
  try { db.exec('ALTER TABLE companions ADD COLUMN effort TEXT'); } catch { /* exists */ }

  // Thread-Companion junction
  db.exec(`
    CREATE TABLE IF NOT EXISTS thread_companions (
      thread_id TEXT NOT NULL,
      companion_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'participant',
      can_initiate INTEGER NOT NULL DEFAULT 1,
      added_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, companion_id),
      FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
      FOREIGN KEY (companion_id) REFERENCES companions(id) ON DELETE CASCADE
    )
  `);

  // Per-companion session tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS companion_sessions (
      thread_id TEXT NOT NULL,
      companion_id TEXT NOT NULL,
      session_id TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, companion_id),
      FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
      FOREIGN KEY (companion_id) REFERENCES companions(id) ON DELETE CASCADE
    )
  `);

  // Add companion_id columns
  try { db.exec('ALTER TABLE messages ADD COLUMN companion_id TEXT'); } catch {}
  try { db.exec('ALTER TABLE threads ADD COLUMN default_companion_id TEXT'); } catch {}
  // usage_events is created BELOW, so its ALTER lives below too. It used to sit
  // on this line and it could never have worked on a new install: the table did
  // not exist yet, the ALTER threw "no such table", the empty catch ate it, and
  // then CREATE TABLE built usage_events without the column. A silent catch
  // around an ordering bug is invisible from a machine where the table predates
  // the migration, and a fresh clone is exactly where it bites.

  // Indexes for companion queries
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_companion ON messages(companion_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_thread_companions_companion ON thread_companions(companion_id)');

  // Usage tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      thread_id TEXT,
      message_id TEXT,
      platform TEXT,
      mode TEXT NOT NULL DEFAULT 'interactive',
      wake_type TEXT,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      tool_calls TEXT,
      cost_usd REAL,
      duration_ms INTEGER,
      context_window INTEGER,
      context_tokens INTEGER,
      companion_id TEXT
    )
  `);
  // Still needed for databases created before companion_id was in the CREATE.
  try { db.exec('ALTER TABLE usage_events ADD COLUMN companion_id TEXT'); } catch {}
  db.exec('CREATE INDEX IF NOT EXISTS idx_usage_events_companion ON usage_events(companion_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_usage_events_created_at ON usage_events(created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_usage_events_thread_id ON usage_events(thread_id)');

  // Managed MCP servers
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      api_key TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      tools_cache TEXT,
      last_discovered TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Read-aloud TTS cache
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_tts (
      message_id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      voice_used TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  // Artifacts
  db.exec(`
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      code TEXT NOT NULL,
      thumbnail TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_artifacts_created_at ON artifacts(created_at)');

  clearStalePendingTurns(db);

  return db;
}

/**
 * A turn that was in flight when the process went away is not in flight now.
 *
 * Reported by Rose and Sol, Sep 17 2026: restart the backend while a rail turn
 * is running and `companion_pending` stays 1 forever, because the code that
 * clears it lives after the await that never returned. Every later move is then
 * refused with "They are already talking" — a 409 about a conversation that
 * stopped existing when the process did, and no way out except editing the
 * database.
 *
 * Both rooms carry the same flag and the same fault. This runs on every boot
 * because the truth it asserts is only ever true at boot: nothing is mid-turn
 * in a process that has not started yet.
 */
export function clearStalePendingTurns(db: Database.Database): number {
  let cleared = 0;
  for (const table of ['card_tables', 'battleship_games']) {
    try {
      const res = db.prepare(`UPDATE ${table} SET companion_pending = 0 WHERE companion_pending = 1`).run();
      cleared += res.changes;
    } catch { /* the table may not exist yet in an older database */ }
  }
  if (cleared > 0) console.log(`[db] cleared ${cleared} turn(s) left pending by a restart`);
  return cleared;
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}
