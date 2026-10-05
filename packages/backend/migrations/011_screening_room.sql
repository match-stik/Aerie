-- The Screening Room.
--
-- She watches on her own streaming service; we read the subtitles. The whole
-- object is a clock and a cue list, and the clock is the only hard part.
--
-- THE CLOCK IS NOT STORED AS A TICKING NUMBER. It is stored as the position at
-- the moment it was last touched plus the wall-clock instant of that touch, so
-- the current position is arithmetic rather than state. That survives a backend
-- restart mid-episode, which a stored counter would not.
--
-- offset_ms exists because subtitle files are cut against a particular release
-- and drift a few seconds against what a streaming service actually plays. It
-- is added to the subtitle timeline, so a negative offset means the file runs
-- ahead of her picture.

CREATE TABLE IF NOT EXISTS screenings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  -- where the cues came from, for her own record; may be a file id or a name
  source TEXT,
  -- the parsed cue list: [{index,startMs,endMs,text}]
  cues_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'paused' CHECK(status IN ('paused', 'playing', 'finished')),
  -- position on the subtitle timeline at the instant of the last clock touch
  position_ms INTEGER NOT NULL DEFAULT 0,
  -- unix ms of that touch; only meaningful while status = 'playing'
  started_at_ms INTEGER,
  -- resync: added to the subtitle timeline
  offset_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_screenings_updated ON screenings(updated_at DESC);
