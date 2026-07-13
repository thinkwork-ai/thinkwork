/**
 * Operational sqlite store for the factory daemon.
 *
 * The DB lives at `<stateDir>/factory.db`. Schema (src/store/schema.sql) is
 * applied idempotently on every open. The store is a rebuildable cache: every
 * table carries the Linear issue id, so a fresh Linear scan can repopulate it.
 */

import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Attempt states considered terminal — the SINGLE authoritative list.
 *
 * The generated `active` column in schema.sql does not hard-code these
 * states: its `__TERMINAL_ATTEMPT_STATES__` placeholder is substituted from
 * this constant when the schema is applied, and `openStore` asserts on every
 * open that an existing DB file's baked-in list still matches (SQLite bakes
 * the CASE expression into the table at CREATE time, so a factory.db created
 * under an older list would otherwise silently disagree with the app-layer
 * terminal check and break the unique-active-attempt invariant).
 *
 * Add or remove terminal states HERE and only here.
 */
export const TERMINAL_ATTEMPT_STATES = [
  "Succeeded",
  "Failed",
  "TimedOut",
  "Stalled",
  "QuotaCooldown",
  "CanceledByReconciliation",
] as const;

export interface IssueRow {
  issue_id: string;
  identifier: string;
  lane: string;
  phase: string;
  state: string;
  compounded: number;
  slack_thread_ts: string | null;
  updated_at: string;
}

export interface AttemptRow {
  id: number;
  issue_id: string;
  phase: string;
  attempt_number: number;
  state: string;
  host: string | null;
  worktree_path: string | null;
  branch: string | null;
  pid: number | null;
  log_path: string | null;
  started_at: string;
  ended_at: string | null;
  detail: string | null;
  active: number;
}

export interface UpsertIssueInput {
  issueId: string;
  identifier: string;
  lane: string;
  phase: string;
  state: string;
  compounded?: number;
  slackThreadTs?: string;
}

export interface InsertAttemptInput {
  issueId: string;
  phase: string;
  attemptNumber: number;
  /** Initial state; defaults to "Running". */
  state?: string;
  host?: string;
  worktreePath?: string;
  branch?: string;
  pid?: number;
  logPath?: string;
  detail?: string;
}

export interface SlackThreadRow {
  issue_id: string;
  identifier: string;
  channel_id: string;
  thread_ts: string;
  last_relayed_ts: string | null;
  last_escalated_key: string | null;
  /** Slack ts of the newest escalation message (chat.update target for button clicks). */
  last_escalated_ts: string | null;
  last_milestone_key: string | null;
  /** Merged-PR note idempotency: `<branch>=><pr#|none>` after the one check. */
  last_merged_pr_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeaseRow {
  issue_id: string;
  attempt_id: number;
  expires_at: string;
  heartbeat_at: string;
  /** Observed-reachable phase wall-clock (R11): frozen while host-unreachable. */
  sla_accumulated_ms: number;
}

export interface NagTimerRow {
  id: number;
  issue_id: string;
  kind: string;
  next_fire_at: string;
  interval_minutes: number;
  armed: number;
}

export interface NagOutboxRow {
  id: number;
  issue_id: string;
  kind: string;
  text: string;
  created_at: string;
  delivered: number;
}

export interface LockRow {
  name: string;
  holder_issue_id: string;
  acquired_at: string;
}

export interface FactoryStore {
  readonly db: Database.Database;
  upsertIssue(input: UpsertIssueInput): void;
  getIssue(issueId: string): IssueRow | undefined;
  /**
   * Idempotent thread mapping (U8): record the Slack thread opened for an
   * issue. A second call for the same issue is a no-op (the existing row is
   * returned unchanged) so restarts reuse one thread per issue.
   */
  upsertSlackThread(input: {
    issueId: string;
    identifier: string;
    channelId: string;
    threadTs: string;
  }): SlackThreadRow;
  getSlackThreadByIssue(issueId: string): SlackThreadRow | undefined;
  /** Reverse lookup for inbound relay: the issue whose thread this reply is in. */
  getSlackThreadByThreadTs(
    channelId: string,
    threadTs: string,
  ): SlackThreadRow | undefined;
  /** Update one of the outbound/inbound idempotency high-water marks. */
  /** Singleton key/value metadata (U8/U9). */
  getMeta(key: string): string | undefined;
  setMeta(key: string, value: string): void;
  deleteMeta(key: string): void;
  setSlackThreadMarker(
    issueId: string,
    field:
      | "last_relayed_ts"
      | "last_escalated_key"
      | "last_escalated_ts"
      | "last_milestone_key"
      | "last_merged_pr_note",
    value: string,
  ): void;
  /** Every mapped thread, for the R18 status view. */
  listSlackThreads(): SlackThreadRow[];
  /**
   * Delete the Slack thread mapping for an issue (un-enrollment). Idempotent:
   * deleting a non-existent mapping is a silent no-op.
   */
  deleteSlackThread(issueId: string): void;
  insertAttempt(input: InsertAttemptInput): number;
  /**
   * Move an attempt to a new state. Throws if the attempt does not exist.
   * Terminal states also stamp ended_at.
   */
  transitionAttempt(attemptId: number, state: string, detail?: string): void;
  /**
   * Record runtime execution facts (pid, log path, …) learned after the
   * attempt row was created. Only provided fields are updated. Throws if the
   * attempt does not exist.
   */
  updateAttemptExec(
    attemptId: number,
    fields: {
      pid?: number;
      logPath?: string;
      worktreePath?: string;
      branch?: string;
      host?: string;
    },
  ): void;
  getAttempt(attemptId: number): AttemptRow | undefined;
  getActiveAttempt(issueId: string, phase: string): AttemptRow | undefined;
  /** Every active (non-terminal) attempt across all issues — the sweep's input. */
  listActiveAttempts(): AttemptRow[];
  /** All attempts for one issue+phase, newest attempt_number first. */
  listAttemptsForPhase(issueId: string, phase: string): AttemptRow[];
  /**
   * The newest terminal attempt for an issue (any phase), by insertion order —
   * used by the quota classifier to read the most-recent QuotaCooldown + its
   * ended_at.
   */
  getLatestTerminalAttempt(issueId: string): AttemptRow | undefined;

  // ---- Leases (U6, R10/R11/R15) -----------------------------------------
  upsertLease(input: {
    issueId: string;
    attemptId: number;
    expiresAt: string;
    heartbeatAt: string;
    slaAccumulatedMs?: number;
  }): void;
  getLease(issueId: string): LeaseRow | undefined;
  deleteLease(issueId: string): void;
  listLeases(): LeaseRow[];

  // ---- Nag timers (U6, R23) ---------------------------------------------
  /** Arm/refresh a timer for (issue, kind). Idempotent on the unique index. */
  upsertNagTimer(input: {
    issueId: string;
    kind: string;
    nextFireAt: string;
    intervalMinutes: number;
    armed?: boolean;
  }): void;
  getNagTimer(issueId: string, kind: string): NagTimerRow | undefined;
  /** Delete every nag timer for an issue (un-enrollment cleanup). Idempotent. */
  deleteNagTimersForIssue(issueId: string): void;
  setNagArmed(issueId: string, kind: string, armed: boolean): void;
  setNagNextFire(issueId: string, kind: string, nextFireAt: string): void;
  /** Armed timers whose next_fire_at <= the given ISO instant. */
  listDueNagTimers(nowIso: string): NagTimerRow[];
  listNagTimers(): NagTimerRow[];

  // ---- Nag outbox (U6→U8 delivery queue) --------------------------------
  enqueueNag(input: { issueId: string; kind: string; text: string }): void;
  listUndeliveredNags(): NagOutboxRow[];
  markNagDelivered(id: number): void;

  // ---- Locks (KTD-11 dev-deployment mutex) ------------------------------
  /**
   * Acquire a named lock for `holderIssueId`. Returns true when the caller now
   * holds it (freshly acquired, or already held by the same issue — reentrant),
   * false when another issue holds it.
   */
  acquireLock(name: string, holderIssueId: string, acquiredAt: string): boolean;
  /** Release the lock only if `holderIssueId` holds it. Returns true if released. */
  releaseLock(name: string, holderIssueId: string): boolean;
  /**
   * Release EVERY named lock held by an issue (un-enrollment cleanup). Idempotent;
   * covers the dev-deployment mutex and any future per-issue lock.
   */
  releaseLocksHeldBy(issueId: string): void;
  getLock(name: string): LockRow | undefined;

  close(): void;
}

const TERMINAL_STATES_PLACEHOLDER = "__TERMINAL_ATTEMPT_STATES__";

function schemaSql(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const template = readFileSync(join(here, "schema.sql"), "utf-8");
  if (!template.includes(TERMINAL_STATES_PLACEHOLDER)) {
    throw new Error(
      `schema.sql is missing the ${TERMINAL_STATES_PLACEHOLDER} placeholder — ` +
        "the terminal-state list must come from TERMINAL_ATTEMPT_STATES, not be hard-coded",
    );
  }
  const list = TERMINAL_ATTEMPT_STATES.map(
    (s) => `'${s.replaceAll("'", "''")}'`,
  ).join(", ");
  return template.replaceAll(TERMINAL_STATES_PLACEHOLDER, list);
}

/**
 * Read the terminal-state list baked into the `attempts` table's generated
 * `active` column of an OPEN database (from the CREATE TABLE text SQLite
 * stores in sqlite_master). Exposed so tests can assert it equals
 * TERMINAL_ATTEMPT_STATES.
 */
export function readDbTerminalAttemptStates(db: Database.Database): string[] {
  const row = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'attempts'",
    )
    .get() as { sql: string } | undefined;
  if (row === undefined) {
    throw new Error("attempts table does not exist in this database");
  }
  const match = row.sql.match(/\bstate\s+IN\s*\(([^)]*)\)/i);
  if (match === null) {
    throw new Error(
      "attempts.active generated column has no `state IN (...)` CASE — cannot verify terminal states",
    );
  }
  return [...match[1].matchAll(/'((?:[^']|'')*)'/g)].map((m) =>
    m[1].replaceAll("''", "'"),
  );
}

/**
 * Fail loudly if the DB's baked-in terminal set differs from
 * TERMINAL_ATTEMPT_STATES (e.g. a factory.db created under an older list).
 * CREATE TABLE IF NOT EXISTS never rewrites an existing table, so this is
 * the only guard keeping the generated `active` column and the app-layer
 * terminal check in agreement.
 */
function assertDbTerminalStatesMatch(db: Database.Database): void {
  const inDb = readDbTerminalAttemptStates(db);
  const expected = new Set<string>(TERMINAL_ATTEMPT_STATES);
  const actual = new Set(inDb);
  const missing = [...expected].filter((s) => !actual.has(s));
  const extra = [...actual].filter((s) => !expected.has(s));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      "factory.db terminal-attempt-state drift: the attempts.active generated column " +
        `treats [${inDb.join(", ")}] as terminal but TERMINAL_ATTEMPT_STATES is ` +
        `[${TERMINAL_ATTEMPT_STATES.join(", ")}] ` +
        `(missing in DB: [${missing.join(", ")}]; extra in DB: [${extra.join(", ")}]). ` +
        "The DB file was created under a different list — migrate or rebuild it " +
        "(the store is a rebuildable cache) before running the daemon.",
    );
  }
}

/** Add a column to a table if it is not already present (idempotent). */
function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const cols = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function openStore(
  stateDir: string,
  clock: () => Date = () => new Date(),
): FactoryStore {
  mkdirSync(stateDir, { recursive: true });
  const db = new Database(join(stateDir, "factory.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql());
  // Idempotent additive migration: a factory.db created before U6 has a
  // `leases` table without sla_accumulated_ms. CREATE TABLE IF NOT EXISTS never
  // alters an existing table, so add the column here (the store is a
  // rebuildable cache — no data migration needed, it just starts at 0).
  ensureColumn(db, "leases", "sla_accumulated_ms", "INTEGER NOT NULL DEFAULT 0");
  // Same pattern for the answer-forms feature: a factory.db created before
  // last_escalated_ts existed just gains the (nullable) column — the click
  // handler treats null as "no escalation message to update" and moves on.
  ensureColumn(db, "slack_threads", "last_escalated_ts", "TEXT");
  // U5 (console merge): merged-PR-note idempotency marker.
  ensureColumn(db, "slack_threads", "last_merged_pr_note", "TEXT");
  try {
    assertDbTerminalStatesMatch(db);
  } catch (err) {
    db.close();
    throw err;
  }

  const now = () => clock().toISOString();

  const upsertIssueStmt = db.prepare(`
    INSERT INTO issues (issue_id, identifier, lane, phase, state, compounded, slack_thread_ts, updated_at)
    VALUES (@issue_id, @identifier, @lane, @phase, @state, @compounded, @slack_thread_ts, @updated_at)
    ON CONFLICT (issue_id) DO UPDATE SET
      identifier = excluded.identifier,
      lane = excluded.lane,
      phase = excluded.phase,
      state = excluded.state,
      compounded = excluded.compounded,
      slack_thread_ts = COALESCE(excluded.slack_thread_ts, issues.slack_thread_ts),
      updated_at = excluded.updated_at
  `);

  const getIssueStmt = db.prepare("SELECT * FROM issues WHERE issue_id = ?");

  const insertAttemptStmt = db.prepare(`
    INSERT INTO attempts (issue_id, phase, attempt_number, state, host, worktree_path, branch, pid, log_path, started_at, detail)
    VALUES (@issue_id, @phase, @attempt_number, @state, @host, @worktree_path, @branch, @pid, @log_path, @started_at, @detail)
  `);

  const transitionStmt = db.prepare(`
    UPDATE attempts SET state = @state, detail = COALESCE(@detail, detail), ended_at = @ended_at
    WHERE id = @id
  `);

  const updateAttemptExecStmt = db.prepare(`
    UPDATE attempts SET
      pid = COALESCE(@pid, pid),
      log_path = COALESCE(@log_path, log_path),
      worktree_path = COALESCE(@worktree_path, worktree_path),
      branch = COALESCE(@branch, branch),
      host = COALESCE(@host, host)
    WHERE id = @id
  `);

  const getAttemptStmt = db.prepare("SELECT * FROM attempts WHERE id = ?");

  const getActiveAttemptStmt = db.prepare(
    "SELECT * FROM attempts WHERE issue_id = ? AND phase = ? AND active = 1",
  );

  const listActiveAttemptsStmt = db.prepare(
    "SELECT * FROM attempts WHERE active = 1 ORDER BY id ASC",
  );
  const listAttemptsForPhaseStmt = db.prepare(
    "SELECT * FROM attempts WHERE issue_id = ? AND phase = ? ORDER BY attempt_number DESC",
  );
  const getLatestTerminalAttemptStmt = db.prepare(
    "SELECT * FROM attempts WHERE issue_id = ? AND active = 0 ORDER BY id DESC LIMIT 1",
  );

  const upsertLeaseStmt = db.prepare(`
    INSERT INTO leases (issue_id, attempt_id, expires_at, heartbeat_at, sla_accumulated_ms)
    VALUES (@issue_id, @attempt_id, @expires_at, @heartbeat_at, @sla_accumulated_ms)
    ON CONFLICT (issue_id) DO UPDATE SET
      attempt_id = excluded.attempt_id,
      expires_at = excluded.expires_at,
      heartbeat_at = excluded.heartbeat_at,
      sla_accumulated_ms = excluded.sla_accumulated_ms
  `);
  const getLeaseStmt = db.prepare("SELECT * FROM leases WHERE issue_id = ?");
  const deleteLeaseStmt = db.prepare("DELETE FROM leases WHERE issue_id = ?");
  const listLeasesStmt = db.prepare(
    "SELECT * FROM leases ORDER BY issue_id ASC",
  );

  const upsertNagTimerStmt = db.prepare(`
    INSERT INTO nag_timers (issue_id, kind, next_fire_at, interval_minutes, armed)
    VALUES (@issue_id, @kind, @next_fire_at, @interval_minutes, @armed)
    ON CONFLICT (issue_id, kind) DO UPDATE SET
      next_fire_at = excluded.next_fire_at,
      interval_minutes = excluded.interval_minutes,
      armed = excluded.armed
  `);
  const getNagTimerStmt = db.prepare(
    "SELECT * FROM nag_timers WHERE issue_id = ? AND kind = ?",
  );
  const deleteNagTimersForIssueStmt = db.prepare(
    "DELETE FROM nag_timers WHERE issue_id = ?",
  );
  const setNagArmedStmt = db.prepare(
    "UPDATE nag_timers SET armed = @armed WHERE issue_id = @issue_id AND kind = @kind",
  );
  const setNagNextFireStmt = db.prepare(
    "UPDATE nag_timers SET next_fire_at = @next_fire_at WHERE issue_id = @issue_id AND kind = @kind",
  );
  const listDueNagTimersStmt = db.prepare(
    "SELECT * FROM nag_timers WHERE armed = 1 AND next_fire_at <= ? ORDER BY next_fire_at ASC",
  );
  const listNagTimersStmt = db.prepare(
    "SELECT * FROM nag_timers ORDER BY id ASC",
  );

  const enqueueNagStmt = db.prepare(`
    INSERT INTO nag_outbox (issue_id, kind, text, created_at, delivered)
    VALUES (@issue_id, @kind, @text, @created_at, 0)
  `);
  const listUndeliveredNagsStmt = db.prepare(
    "SELECT * FROM nag_outbox WHERE delivered = 0 ORDER BY id ASC",
  );
  const markNagDeliveredStmt = db.prepare(
    "UPDATE nag_outbox SET delivered = 1 WHERE id = ?",
  );

  const acquireLockStmt = db.prepare(`
    INSERT INTO locks (name, holder_issue_id, acquired_at)
    VALUES (@name, @holder_issue_id, @acquired_at)
    ON CONFLICT (name) DO NOTHING
  `);
  const getLockStmt = db.prepare("SELECT * FROM locks WHERE name = ?");
  const releaseLockStmt = db.prepare(
    "DELETE FROM locks WHERE name = ? AND holder_issue_id = ?",
  );
  const releaseLocksHeldByStmt = db.prepare(
    "DELETE FROM locks WHERE holder_issue_id = ?",
  );

  const insertSlackThreadStmt = db.prepare(`
    INSERT INTO slack_threads (issue_id, identifier, channel_id, thread_ts, created_at, updated_at)
    VALUES (@issue_id, @identifier, @channel_id, @thread_ts, @now, @now)
    ON CONFLICT (issue_id) DO NOTHING
  `);
  const getSlackThreadByIssueStmt = db.prepare(
    "SELECT * FROM slack_threads WHERE issue_id = ?",
  );
  const getSlackThreadByThreadTsStmt = db.prepare(
    "SELECT * FROM slack_threads WHERE channel_id = ? AND thread_ts = ?",
  );
  const listSlackThreadsStmt = db.prepare(
    "SELECT * FROM slack_threads ORDER BY created_at ASC",
  );
  const deleteSlackThreadStmt = db.prepare(
    "DELETE FROM slack_threads WHERE issue_id = ?",
  );

  return {
    db,

    upsertIssue(input) {
      upsertIssueStmt.run({
        issue_id: input.issueId,
        identifier: input.identifier,
        lane: input.lane,
        phase: input.phase,
        state: input.state,
        compounded: input.compounded ?? 0,
        slack_thread_ts: input.slackThreadTs ?? null,
        updated_at: now(),
      });
    },

    getIssue(issueId) {
      return getIssueStmt.get(issueId) as IssueRow | undefined;
    },

    insertAttempt(input) {
      const result = insertAttemptStmt.run({
        issue_id: input.issueId,
        phase: input.phase,
        attempt_number: input.attemptNumber,
        state: input.state ?? "Running",
        host: input.host ?? null,
        worktree_path: input.worktreePath ?? null,
        branch: input.branch ?? null,
        pid: input.pid ?? null,
        log_path: input.logPath ?? null,
        started_at: now(),
        detail: input.detail ?? null,
      });
      return Number(result.lastInsertRowid);
    },

    transitionAttempt(attemptId, state, detail) {
      const isTerminal = (
        TERMINAL_ATTEMPT_STATES as readonly string[]
      ).includes(state);
      const result = transitionStmt.run({
        id: attemptId,
        state,
        detail: detail ?? null,
        ended_at: isTerminal ? now() : null,
      });
      if (result.changes === 0) {
        throw new Error(`attempt ${attemptId} does not exist`);
      }
    },

    updateAttemptExec(attemptId, fields) {
      const result = updateAttemptExecStmt.run({
        id: attemptId,
        pid: fields.pid ?? null,
        log_path: fields.logPath ?? null,
        worktree_path: fields.worktreePath ?? null,
        branch: fields.branch ?? null,
        host: fields.host ?? null,
      });
      if (result.changes === 0) {
        throw new Error(`attempt ${attemptId} does not exist`);
      }
    },

    getAttempt(attemptId) {
      return getAttemptStmt.get(attemptId) as AttemptRow | undefined;
    },

    getActiveAttempt(issueId, phase) {
      return getActiveAttemptStmt.get(issueId, phase) as AttemptRow | undefined;
    },

    listActiveAttempts() {
      return listActiveAttemptsStmt.all() as AttemptRow[];
    },

    listAttemptsForPhase(issueId, phase) {
      return listAttemptsForPhaseStmt.all(issueId, phase) as AttemptRow[];
    },

    getLatestTerminalAttempt(issueId) {
      return getLatestTerminalAttemptStmt.get(issueId) as
        | AttemptRow
        | undefined;
    },

    upsertLease(input) {
      upsertLeaseStmt.run({
        issue_id: input.issueId,
        attempt_id: input.attemptId,
        expires_at: input.expiresAt,
        heartbeat_at: input.heartbeatAt,
        sla_accumulated_ms: input.slaAccumulatedMs ?? 0,
      });
    },

    getLease(issueId) {
      return getLeaseStmt.get(issueId) as LeaseRow | undefined;
    },

    deleteLease(issueId) {
      deleteLeaseStmt.run(issueId);
    },

    listLeases() {
      return listLeasesStmt.all() as LeaseRow[];
    },

    upsertNagTimer(input) {
      upsertNagTimerStmt.run({
        issue_id: input.issueId,
        kind: input.kind,
        next_fire_at: input.nextFireAt,
        interval_minutes: input.intervalMinutes,
        armed: input.armed === false ? 0 : 1,
      });
    },

    getNagTimer(issueId, kind) {
      return getNagTimerStmt.get(issueId, kind) as NagTimerRow | undefined;
    },

    deleteNagTimersForIssue(issueId) {
      deleteNagTimersForIssueStmt.run(issueId);
    },

    setNagArmed(issueId, kind, armed) {
      setNagArmedStmt.run({ issue_id: issueId, kind, armed: armed ? 1 : 0 });
    },

    setNagNextFire(issueId, kind, nextFireAt) {
      setNagNextFireStmt.run({ issue_id: issueId, kind, next_fire_at: nextFireAt });
    },

    listDueNagTimers(nowIso) {
      return listDueNagTimersStmt.all(nowIso) as NagTimerRow[];
    },

    listNagTimers() {
      return listNagTimersStmt.all() as NagTimerRow[];
    },

    enqueueNag(input) {
      enqueueNagStmt.run({
        issue_id: input.issueId,
        kind: input.kind,
        text: input.text,
        created_at: now(),
      });
    },

    listUndeliveredNags() {
      return listUndeliveredNagsStmt.all() as NagOutboxRow[];
    },

    markNagDelivered(id) {
      markNagDeliveredStmt.run(id);
    },

    acquireLock(name, holderIssueId, acquiredAt) {
      acquireLockStmt.run({
        name,
        holder_issue_id: holderIssueId,
        acquired_at: acquiredAt,
      });
      const row = getLockStmt.get(name) as LockRow | undefined;
      return row !== undefined && row.holder_issue_id === holderIssueId;
    },

    releaseLock(name, holderIssueId) {
      const result = releaseLockStmt.run(name, holderIssueId);
      return result.changes > 0;
    },

    releaseLocksHeldBy(issueId) {
      releaseLocksHeldByStmt.run(issueId);
    },

    getLock(name) {
      return getLockStmt.get(name) as LockRow | undefined;
    },

    upsertSlackThread(input) {
      insertSlackThreadStmt.run({
        issue_id: input.issueId,
        identifier: input.identifier,
        channel_id: input.channelId,
        thread_ts: input.threadTs,
        now: now(),
      });
      // Always return the authoritative row (existing one wins on conflict).
      return getSlackThreadByIssueStmt.get(input.issueId) as SlackThreadRow;
    },

    getSlackThreadByIssue(issueId) {
      return getSlackThreadByIssueStmt.get(issueId) as
        | SlackThreadRow
        | undefined;
    },

    getSlackThreadByThreadTs(channelId, threadTs) {
      return getSlackThreadByThreadTsStmt.get(channelId, threadTs) as
        | SlackThreadRow
        | undefined;
    },

    getMeta(key) {
      const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
        | { value: string }
        | undefined;
      return row?.value;
    },

    setMeta(key, value) {
      db.prepare(
        "INSERT INTO meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      ).run(key, value, new Date().toISOString());
    },

    deleteMeta(key) {
      db.prepare("DELETE FROM meta WHERE key = ?").run(key);
    },

    setSlackThreadMarker(issueId, field, value) {
      // Field name is a fixed union, never user input — safe to interpolate.
      const result = db
        .prepare(
          `UPDATE slack_threads SET ${field} = @value, updated_at = @now WHERE issue_id = @issue_id`,
        )
        .run({ value, now: now(), issue_id: issueId });
      if (result.changes === 0) {
        throw new Error(`slack thread for issue ${issueId} does not exist`);
      }
    },

    listSlackThreads() {
      return listSlackThreadsStmt.all() as SlackThreadRow[];
    },

    deleteSlackThread(issueId) {
      deleteSlackThreadStmt.run(issueId);
    },

    close() {
      db.close();
    },
  };
}
