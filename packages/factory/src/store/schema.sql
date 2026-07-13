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

-- Worker heartbeat lease (U6, R10/R11/R15). One row per issue whose active
-- attempt the daemon is monitoring. `sla_accumulated_ms` is the phase's
-- observed-reachable wall-clock: the sweep advances it ONLY on ticks where the
-- host probed reachable, so a host-unreachable window freezes the clock (R11)
-- rather than counting against the SLA. A missed heartbeat expires the lease
-- (→ R15 recovery) only after the host is reachable AND the old pid is
-- confirmed dead (the duplicate-worker guard, AE4). db.ts adds
-- `sla_accumulated_ms` to any pre-existing lease table on open (rebuildable
-- cache — an older factory.db simply gains the column).
CREATE TABLE IF NOT EXISTS leases (
  issue_id           TEXT PRIMARY KEY,
  attempt_id         INTEGER NOT NULL,
  expires_at         TEXT NOT NULL,
  heartbeat_at       TEXT NOT NULL,
  sla_accumulated_ms INTEGER NOT NULL DEFAULT 0
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
-- At most one timer per (issue, kind) so arm/disarm is an idempotent upsert.
CREATE UNIQUE INDEX IF NOT EXISTS idx_nag_timers_issue_kind
  ON nag_timers (issue_id, kind);

-- Store-side nag delivery queue (U6→U8 seam). When the Slack surface is
-- absent, a fired nag is enqueued here (delivered = 0) so U8 can flush it once
-- Slack is online. When Slack IS present the sweep delivers via postNag
-- directly and never touches this table.
CREATE TABLE IF NOT EXISTS nag_outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id   TEXT NOT NULL,
  kind       TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivered  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_nag_outbox_undelivered
  ON nag_outbox (delivered);

-- Named mutex (KTD-11). The single dev-deployment lock is acquired around
-- phases that touch the shared dev stack (Verification, anything running
-- `db:push`); every other phase runs without it. `holder_issue_id` records the
-- issue currently holding the lock so a second contender waits visibly and can
-- see who to wait on.
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
--   last_escalated_ts   — Slack ts of the newest escalation MESSAGE, so an
--                         answer-form button click can chat.update that exact
--                         message (strip the buttons once answered).
CREATE TABLE IF NOT EXISTS slack_threads (
  issue_id           TEXT PRIMARY KEY,
  identifier         TEXT NOT NULL,
  channel_id         TEXT NOT NULL,
  thread_ts          TEXT NOT NULL,
  last_relayed_ts    TEXT,
  last_escalated_key TEXT,
  last_escalated_ts  TEXT,
  last_merged_pr_note TEXT,
  last_milestone_key TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_slack_threads_thread
  ON slack_threads (channel_id, thread_ts);

-- Singleton key/value metadata (U8/U9): pinned-board message channel/ts,
-- release-confirm one-shot tokens, done-today board memory. Small, unindexed
-- beyond the PK — a handful of rows, read per tick.
CREATE TABLE IF NOT EXISTS meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
