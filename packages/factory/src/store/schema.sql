-- Factory daemon operational store.
--
-- Every table carries the Linear issue id where sensible: this store is a
-- cache/ledger, and must be rebuildable from a fresh Linear scan.
--
-- Applied idempotently (CREATE ... IF NOT EXISTS) on every daemon start.
--
-- NOT standalone SQL: this file is a template consumed by src/store/db.ts,
-- which substitutes __TERMINAL_ATTEMPT_STATES__ from the authoritative
-- TERMINAL_ATTEMPT_STATES constant before applying it.

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
  --
  -- INVARIANT: the terminal-state list is NOT written here. The placeholder
  -- below is substituted at schema-application time from the single
  -- authoritative list, TERMINAL_ATTEMPT_STATES in src/store/db.ts — add or
  -- remove terminal states THERE, never here. openStore() additionally
  -- asserts on every open that the list baked into an existing DB file's
  -- generated column still matches the TS constant, so a stale factory.db
  -- (or an edit to only one side) fails loudly instead of silently breaking
  -- the unique-active-attempt invariant.
  active INTEGER GENERATED ALWAYS AS (
    CASE WHEN state IN (__TERMINAL_ATTEMPT_STATES__)
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

-- One Slack thread per enrolled issue (U8). issue_id is the primary key so a
-- thread is opened idempotently and reused across daemon restarts; the
-- (channel_id, thread_ts) index powers the inbound-relay reverse lookup
-- (given the thread an operator replied in, find the issue). Like every other
-- table here this carries the issue id and is rebuildable from a Linear +
-- Slack scan.
--
-- Idempotency high-water marks:
--   last_relayed_ts     — newest inbound message ts already processed by the
--                         relay; a re-delivered event with ts <= this is a
--                         no-op (Slack redelivers on missed acks).
--   last_escalated_key  — id of the newest question comment already mirrored
--                         to Slack as an @mention escalation (outbound dedupe).
--   last_milestone_key  — phase/status of the newest milestone already posted
--                         (outbound dedupe; milestones carry no @mention).
CREATE TABLE IF NOT EXISTS slack_threads (
  issue_id           TEXT PRIMARY KEY,
  identifier         TEXT NOT NULL,
  channel_id         TEXT NOT NULL,
  thread_ts          TEXT NOT NULL,
  last_relayed_ts    TEXT,
  last_escalated_key TEXT,
  last_milestone_key TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_slack_threads_thread
  ON slack_threads (channel_id, thread_ts);
