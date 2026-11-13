CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  as_of TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload))
);
CREATE INDEX IF NOT EXISTS idx_snapshots_as_of ON snapshots(as_of DESC);
CREATE TABLE IF NOT EXISTS refresh_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('running', 'success', 'failed')),
  message TEXT,
  snapshot_id TEXT REFERENCES snapshots(id)
);
CREATE INDEX IF NOT EXISTS idx_refresh_runs_started ON refresh_runs(started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_refresh ON refresh_runs(status) WHERE status = 'running';
