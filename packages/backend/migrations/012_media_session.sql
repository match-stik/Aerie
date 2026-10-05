-- What her phone says is playing, carried to the house.
--
-- THIS IS A LOG RATHER THAN A SINGLE VALUE, ON PURPOSE. A streaming service
-- with adverts in it does not stop publishing a position when the advert
-- starts, and nobody in this house yet knows WHICH position it publishes --
-- the episode's or the advert's. One stored value can never answer that; a
-- short run of readings across a break can. The rows are cheap and pruned.
--
-- Nothing here is ever shown to her unasked. It exists so a companion can
-- look, rather than so she has to go and fetch a number from another screen.

CREATE TABLE IF NOT EXISTS media_session_readings (
  id TEXT PRIMARY KEY,
  package TEXT NOT NULL,
  state TEXT NOT NULL,
  reports_position INTEGER NOT NULL DEFAULT 0,
  position_ms INTEGER,
  live_position_ms INTEGER,
  duration_ms INTEGER,
  speed REAL,
  title TEXT,
  -- when the house received it, in wall-clock ms. The phone's own clock is
  -- deliberately not trusted here: it is a different machine.
  received_at_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_session_received
  ON media_session_readings(received_at_ms DESC);
