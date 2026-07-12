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
  last_milestone_key: string | null;
  created_at: string;
  updated_at: string;
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
  setSlackThreadMarker(
    issueId: string,
    field: "last_relayed_ts" | "last_escalated_key" | "last_milestone_key",
    value: string,
  ): void;
  /** Every mapped thread, for the R18 status view. */
  listSlackThreads(): SlackThreadRow[];
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

export function openStore(
  stateDir: string,
  clock: () => Date = () => new Date(),
): FactoryStore {
  mkdirSync(stateDir, { recursive: true });
  const db = new Database(join(stateDir, "factory.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql());
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

    close() {
      db.close();
    },
  };
}
