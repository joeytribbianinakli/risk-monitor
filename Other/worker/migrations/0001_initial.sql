CREATE TABLE IF NOT EXISTS user_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS checks (
  key TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL,
  value REAL,
  asof TEXT,
  checked_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_url TEXT,
  metrics_json TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  old_status TEXT,
  new_status TEXT,
  message TEXT NOT NULL,
  source_url TEXT,
  notified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
CREATE TABLE IF NOT EXISTS cursors (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS run_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  checked INTEGER NOT NULL,
  changed INTEGER NOT NULL,
  errors TEXT NOT NULL
);
