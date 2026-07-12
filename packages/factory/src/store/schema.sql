-- Factory daemon operational store.
--
-- Every table carries the Linear issue id where sensible: this store is a
-- cache/ledger, and must be rebuildable from a fresh Linear scan.
--
-- Applied idempotently (CREATE ... IF NOT EXISTS) on every daemon start.

CREATE TABLE IF NOT EXISTS issues (
  issue_id        TEXT PRIMARY KEY,
  identifier      TEXT NOT NULL,
  lane            TEXT NOT NULL,
  phase           TEXT NOT NULL,
  state           TEXT NOT NULL,
  compounded      INTEGER NOT NULL DEFAULT 0,
  slack_thread_ts TEXT,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id       TEXT NOT NULL,
  phase          TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  state          TEXT NOT NULL,
  host           TEXT,
  worktree_path  TEXT,
  branch         TEXT,
  pid            INTEGER,
  log_path       TEXT,
  started_at     TEXT NOT NULL,
  ended_at       TEXT,
  detail         TEXT,
  -- Generated flag: 1 while the attempt is in a non-terminal state. Kept in
  -- sync by SQLite itself, so the unique index below cannot drift from the
  -- state column. (Partial indexes can't reference an IN list via a plain
  -- WHERE on state in older SQLite grammars; a generated column is cleanest.)
  active INTEGER GENERATED ALWAYS AS (
    CASE WHEN state IN ('Succeeded', 'Failed', 'TimedOut', 'Stalled', 'QuotaCooldown', 'CanceledByReconciliation')
      THEN 0 ELSE 1 END
  ) VIRTUAL
);

-- At most ONE active attempt per issue+phase.
CREATE UNIQUE INDEX IF NOT EXISTS idx_attempts_one_active
  ON attempts (issue_id, phase)
  WHERE active = 1;

CREATE INDEX IF NOT EXISTS idx_attempts_issue ON attempts (issue_id);

CREATE TABLE IF NOT EXISTS leases (
  issue_id     TEXT PRIMARY KEY,
  attempt_id   INTEGER NOT NULL,
  expires_at   TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nag_timers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id         TEXT NOT NULL,
  kind             TEXT NOT NULL,
  next_fire_at     TEXT NOT NULL,
  interval_minutes INTEGER NOT NULL,
  armed            INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_nag_timers_issue ON nag_timers (issue_id);

CREATE TABLE IF NOT EXISTS locks (
  name            TEXT PRIMARY KEY,
  holder_issue_id TEXT NOT NULL,
  acquired_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hosts (
  name          TEXT PRIMARY KEY,
  state         TEXT NOT NULL,
  last_probe_at TEXT
);
