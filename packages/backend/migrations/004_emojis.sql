-- Custom emoji system (separate from stickers)
CREATE TABLE IF NOT EXISTS emojis (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  aliases TEXT DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_emojis_name ON emojis(name);
