-- Emoji packs system (mirrors sticker_packs)
CREATE TABLE IF NOT EXISTS emoji_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  user_only INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Add pack_id to emojis (nullable for backwards compatibility)
ALTER TABLE emojis ADD COLUMN pack_id TEXT REFERENCES emoji_packs(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_emojis_pack_id ON emojis(pack_id);
