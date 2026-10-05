-- The Press — mobile-first zine/scrapbook documents.
-- Safe to run on every boot.

CREATE TABLE IF NOT EXISTS press_issues (
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

CREATE TABLE IF NOT EXISTS press_spreads (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  scene_json TEXT NOT NULL DEFAULT '{}',
  thumbnail_file_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (issue_id) REFERENCES press_issues(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_press_spreads_issue_order
  ON press_spreads(issue_id, sort_order);

CREATE TABLE IF NOT EXISTS press_assets (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL,
  spread_id TEXT,
  name TEXT,
  kind TEXT NOT NULL DEFAULT 'other'
    CHECK(kind IN ('photo', 'border', 'tape', 'sticker', 'audio', 'other')),
  source_file_id TEXT NOT NULL,
  rendered_file_id TEXT,
  mime_type TEXT NOT NULL,
  recipe_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (issue_id) REFERENCES press_issues(id) ON DELETE CASCADE,
  FOREIGN KEY (spread_id) REFERENCES press_spreads(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_press_assets_issue ON press_assets(issue_id);
CREATE INDEX IF NOT EXISTS idx_press_assets_spread ON press_assets(spread_id);
CREATE INDEX IF NOT EXISTS idx_press_assets_source ON press_assets(source_file_id);
CREATE INDEX IF NOT EXISTS idx_press_assets_rendered ON press_assets(rendered_file_id);

