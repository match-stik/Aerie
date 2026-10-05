-- The Press — house-global reusable material and object packs.
-- Safe to run on every boot.

CREATE TABLE IF NOT EXISTS press_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  source_format TEXT NOT NULL DEFAULT 'images'
    CHECK(source_format IN ('images', 'zip', 'excalidrawlib')),
  author TEXT,
  license TEXT,
  source_file_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS press_pack_items (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL
    CHECK(kind IN ('image', 'excalidraw')),
  mime_type TEXT,
  source_file_id TEXT,
  data_json TEXT,
  width INTEGER,
  height INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (pack_id) REFERENCES press_packs(id) ON DELETE CASCADE,
  CHECK(
    (kind = 'image' AND source_file_id IS NOT NULL)
    OR (kind = 'excalidraw' AND data_json IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_press_pack_items_pack_order
  ON press_pack_items(pack_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_press_pack_items_source
  ON press_pack_items(source_file_id);
