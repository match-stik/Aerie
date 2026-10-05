-- Add 'sticker' to messages.content_type CHECK constraint
-- SQLite doesn't support ALTER CONSTRAINT, so we recreate the table

PRAGMA foreign_keys=OFF;

CREATE TABLE messages_new (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('companion', 'user', 'system')),
  content TEXT NOT NULL,
  content_type TEXT DEFAULT 'text' CHECK(content_type IN ('text', 'image', 'audio', 'file', 'sticker')),
  platform TEXT DEFAULT 'web',
  metadata TEXT,
  reply_to_id TEXT,
  reply_to_preview TEXT,
  edited_at TEXT,
  deleted_at TEXT,
  original_content TEXT,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  read_at TEXT,
  FOREIGN KEY (thread_id) REFERENCES threads(id)
);

INSERT INTO messages_new SELECT * FROM messages;

DROP TABLE messages;

ALTER TABLE messages_new RENAME TO messages;

CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

PRAGMA foreign_keys=ON;
