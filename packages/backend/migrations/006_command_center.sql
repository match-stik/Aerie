-- Command Center: life management system
-- All tables use TEXT UUIDs for client-side generation

-- Care entries — toggles, ratings, counters, notes
CREATE TABLE IF NOT EXISTS care_entries (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  person TEXT NOT NULL DEFAULT 'user',
  category TEXT NOT NULL,
  value TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_care_date_person ON care_entries(date, person);
CREATE UNIQUE INDEX IF NOT EXISTS idx_care_unique ON care_entries(date, person, category);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  owner TEXT,
  deadline TEXT,
  status TEXT DEFAULT 'active',
  color TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  date TEXT,
  due_date TEXT,
  person TEXT NOT NULL DEFAULT 'user',
  priority INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  sort_order INTEGER DEFAULT 0,
  created_by TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_date_person ON tasks(date, person);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- Events — recurrence as JSON string
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  start_date TEXT NOT NULL,
  start_time TEXT,
  end_date TEXT,
  end_time TEXT,
  all_day INTEGER DEFAULT 0,
  category TEXT DEFAULT 'default',
  color TEXT,
  recurrence TEXT,
  reminder_minutes INTEGER,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_start_date ON events(start_date);

-- Cycle tracking
CREATE TABLE IF NOT EXISTS cycles (
  id TEXT PRIMARY KEY,
  start_date TEXT NOT NULL,
  end_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cycle_daily_logs (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  flow TEXT CHECK(flow IN ('none', 'spotting', 'light', 'medium', 'heavy')),
  symptoms TEXT,
  mood TEXT,
  energy INTEGER CHECK(energy >= 1 AND energy <= 5),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cycle_settings (
  id TEXT PRIMARY KEY DEFAULT '1',
  average_cycle_length INTEGER DEFAULT 28,
  average_period_length INTEGER DEFAULT 5,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pets
CREATE TABLE IF NOT EXISTS pets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  species TEXT,
  breed TEXT,
  birthday TEXT,
  weight TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pet_events (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT,
  date TEXT NOT NULL DEFAULT (date('now')),
  next_due TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pet_events_pet ON pet_events(pet_id);

CREATE TABLE IF NOT EXISTS pet_medications (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dosage TEXT,
  frequency TEXT DEFAULT 'daily',
  next_due TEXT,
  active INTEGER DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pet_meds_pet ON pet_medications(pet_id);

-- Lists
CREATE TABLE IF NOT EXISTS lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  color TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS list_items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  checked INTEGER DEFAULT 0,
  added_by TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_list_items_list ON list_items(list_id);

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  amount REAL NOT NULL,
  category TEXT DEFAULT 'other',
  description TEXT,
  paid_by TEXT,
  date TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);

-- Countdowns
CREATE TABLE IF NOT EXISTS countdowns (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  target_date TEXT NOT NULL,
  emoji TEXT,
  color TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Daily wins
CREATE TABLE IF NOT EXISTS daily_wins (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  who TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(date, who)
);

-- Scratchpad notes — persistent notes (no date scope, manual clear)
CREATE TABLE IF NOT EXISTS scratchpad_notes (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  date TEXT NOT NULL,
  created_by TEXT DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
