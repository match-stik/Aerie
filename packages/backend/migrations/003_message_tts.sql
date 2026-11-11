-- Per-message read-aloud cache.
-- One rendered TTS audio file per message. Click read-aloud → render once,
-- cache here, subsequent clicks play the cached file without re-synthesizing.
CREATE TABLE IF NOT EXISTS message_tts (
  message_id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  voice_used TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_message_tts_created ON message_tts(created_at DESC);
