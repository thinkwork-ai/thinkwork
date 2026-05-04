/**
 * Plan §005 U4 — Aurora-backed `SessionStore` for Flue.
 *
 * Flue persists agent loop state as a `SessionData` blob keyed by `id`. We
 * map that 1:1 onto the existing `threads` table (see
 * `packages/database-pg/src/schema/threads.ts`):
 *
 *   - Flue `sessionId` ↔ `threads.id` (UUID, gen_random_uuid())
 *   - `SessionData` blob ↔ `threads.session_data` (jsonb, NULL when no Flue
 *     loop has run for that thread yet)
 *   - Tenant scoping ↔ `threads.tenant_id` (already indexed)
 *   - Agent scoping ↔ `threads.agent_id` (already indexed)
 *
 * Session identity is the `(thread, tenant, agent)` tuple, NOT just
 * `(thread, tenant)`. Pre-Flue threads coexist with `session_data IS NULL`.
 *
 * Why bind agentId in addition to tenantId:
 *   - `escalateThread`, `delegateThread`, and `updateThread` mutations all
 *     change `threads.agent_id` without touching `session_data`. Without
 *     an agent-scoped predicate, the new agent would inherit the prior
 *     agent's session — a fail-open coupling between two distinct agent
 *     identities. With the predicate, load() returns null after
 *     reassignment, the new agent starts fresh, and save() throws if a
 *     stale loop tries to write back over the reassigned thread.
 *   - Mirrors the FR-4a fail-closed pattern: explicit scoping, no implicit
 *     trust on row-level identity beyond what the dispatcher snapshotted.
 *
 * Why a column on `threads` instead of a new table:
 *   - Session is 1:1 with the (thread, agent) pair (every Flue session
 *     belongs to exactly one thread + one agent; threads are the user-
 *     facing conversation primitive).
 *   - `tenant_id` and `agent_id` already live on the row; no duplication.
 *   - Postgres TOASTs large jsonb values, so wide rows don't bloat the
 *     base table.
 *   - Single writer per thread (one Flue loop at a time), so
 *     read-modify-write contention isn't a concern at this scale.
 *
 * Tenant + agent isolation (FR-4a):
 *   - `tenantId` and `agentId` are bound at instantiation. Empty or null
 *     fails closed — the dispatcher MUST snapshot `ctx.auth.tenantId`
 *     (or fall back to `resolveCallerTenantId(ctx)`) and the invocation's
 *     `agentId` before constructing the store.
 *   - Every save/load/delete includes
 *     `tenant_id = :tenant_id AND agent_id = :agent_id`
 *     in the predicate so cross-tenant OR cross-agent access surfaces as
 *     a row-not-found rather than a successful read of another scope's data.
 *   - `save()` errors when `numberOfRecordsUpdated === 0`. This catches
 *     three cases: the thread doesn't exist, the thread exists under a
 *     different tenant, OR the thread has been reassigned to a different
 *     agent since this loop started. Either way Flue's caller sees a typed
 *     error rather than a silent no-op.
 *
 * Connection model:
 *   - Uses AWS RDS Data API (HTTP-based). No VPC plumbing on the agentcore-
 *     flue Lambda is required — the IAM grant in
 *     `terraform/modules/app/agentcore-flue/main.tf` (`rds-data:*` scoped to
 *     `thinkwork-${stage}-db-*`) is sufficient.
 *   - Aurora cluster has Data API enabled
 *     (`enable_http_endpoint = true` in
 *     `terraform/modules/data/aurora-postgres/main.tf`).
 *   - Cluster ARN + secret ARN are passed in via env vars wired in
 *     `terraform/modules/app/agentcore-flue/main.tf`.
 */

import {
  RDSDataClient,
  ExecuteStatementCommand,
} from "@aws-sdk/client-rds-data";
import type { SessionStore, SessionData } from "./flue-session-types.js";

export interface AuroraSessionStoreOptions {
  /**
   * Tenant ID snapshot — bound at constructor time. Missing or empty
   * fail-closes immediately so the caller can never accidentally
   * construct an unscoped store.
   */
  tenantId: string;
  /**
   * Agent ID snapshot — bound at constructor time. Pairs with `tenantId`
   * to express the (thread, tenant, agent) tuple Flue's session is keyed
   * on. Missing or empty fail-closes; the dispatcher must snapshot the
   * invocation's `agentId` before constructing the store.
   */
  agentId: string;
  /** Aurora DB cluster ARN — RDS Data API target. */
  clusterArn: string;
  /** Secrets Manager ARN holding the DB credentials. */
  secretArn: string;
  /** Postgres database name. Defaults to `"thinkwork"`. */
  database?: string;
  /**
   * Optional pre-built RDS Data API client. Tests inject
   * `aws-sdk-client-mock` clients here; production callers omit it.
   */
  client?: RDSDataClient;
}

export class AuroraSessionStoreError extends Error {
  constructor(
    public readonly op: "save" | "load" | "delete",
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AuroraSessionStoreError";
  }
}

export class AuroraSessionStore implements SessionStore {
  private readonly tenantId: string;
  private readonly agentId: string;
  private readonly clusterArn: string;
  private readonly secretArn: string;
  private readonly database: string;
  private readonly client: RDSDataClient;

  constructor(opts: AuroraSessionStoreOptions) {
    if (!opts.tenantId || typeof opts.tenantId !== "string") {
      throw new AuroraSessionStoreError(
        "load",
        "AuroraSessionStore: tenantId is required and must be a non-empty string. " +
          "The dispatcher must snapshot ctx.auth.tenantId (or call " +
          "resolveCallerTenantId) before constructing the store — fail-closed " +
          "per FR-4a.",
      );
    }
    if (!opts.agentId || typeof opts.agentId !== "string") {
      throw new AuroraSessionStoreError(
        "load",
        "AuroraSessionStore: agentId is required and must be a non-empty string. " +
          "Flue's session is keyed on the (thread, tenant, agent) tuple — the " +
          "dispatcher must snapshot the invocation's agentId before constructing " +
          "the store. Without it, an escalate/delegate that changes threads.agent_id " +
          "would let the new agent inherit the prior agent's session.",
      );
    }
    if (!opts.clusterArn || typeof opts.clusterArn !== "string") {
      throw new AuroraSessionStoreError(
        "load",
        "AuroraSessionStore: clusterArn is required and must be a non-empty string. " +
          "Wire DB_CLUSTER_ARN in terraform/modules/app/agentcore-flue/main.tf and " +
          "thread it through to the construction site.",
      );
    }
    if (!opts.secretArn || typeof opts.secretArn !== "string") {
      throw new AuroraSessionStoreError(
        "load",
        "AuroraSessionStore: secretArn is required and must be a non-empty string. " +
          "Wire DB_SECRET_ARN in terraform/modules/app/agentcore-flue/main.tf and " +
          "thread it through to the construction site.",
      );
    }
    this.tenantId = opts.tenantId;
    this.agentId = opts.agentId;
    this.clusterArn = opts.clusterArn;
    this.secretArn = opts.secretArn;
    this.database = opts.database ?? "thinkwork";
    this.client = opts.client ?? new RDSDataClient({});
  }

  async save(id: string, data: SessionData): Promise<void> {
    // Note on `updated_at`: Flue saves session state on every agent-loop
    // tick, which can be many writes per user-visible turn. We deliberately
    // do NOT bump `threads.updated_at` here — that column drives the admin
    // UI's "last activity" sort, and a Flue tick isn't a user-facing thread
    // event. If we ever need a runtime-state freshness signal, add a
    // `session_updated_at` column instead.
    const sql =
      "UPDATE threads " +
      "SET session_data = CAST(:session_data AS jsonb) " +
      "WHERE id = CAST(:thread_id AS uuid) " +
      "AND tenant_id = CAST(:tenant_id AS uuid) " +
      "AND agent_id = CAST(:agent_id AS uuid)";

    let result;
    try {
      result = await this.client.send(
        new ExecuteStatementCommand({
          resourceArn: this.clusterArn,
          secretArn: this.secretArn,
          database: this.database,
          sql,
          parameters: [
            { name: "thread_id", value: { stringValue: id } },
            { name: "tenant_id", value: { stringValue: this.tenantId } },
            { name: "agent_id", value: { stringValue: this.agentId } },
            {
              name: "session_data",
              value: { stringValue: JSON.stringify(data) },
            },
          ],
        }),
      );
    } catch (err) {
      throw new AuroraSessionStoreError(
        "save",
        `Aurora SessionStore save failed for thread ${id}: ${asMessage(err)}`,
        err,
      );
    }

    // numberOfRecordsUpdated is 0 when any of three predicates miss:
    // (a) the thread doesn't exist, (b) the thread exists under a different
    // tenant, or (c) the thread has been reassigned to a different agent
    // since this loop started (e.g. an escalateThread mutation flipped
    // agent_id mid-flight). Flue treats all three as "you can't write here"
    // — the caller surfaces to the user rather than retrying silently.
    const updated = result.numberOfRecordsUpdated ?? 0;
    if (updated === 0) {
      throw new AuroraSessionStoreError(
        "save",
        `Aurora SessionStore save matched no thread row for tenant=${this.tenantId} agent=${this.agentId} thread=${id}. ` +
          "Either the thread doesn't exist, it belongs to a different tenant, " +
          "or it has been reassigned to a different agent.",
      );
    }
  }

  async load(id: string): Promise<SessionData | null> {
    const sql =
      "SELECT session_data FROM threads " +
      "WHERE id = CAST(:thread_id AS uuid) " +
      "AND tenant_id = CAST(:tenant_id AS uuid) " +
      "AND agent_id = CAST(:agent_id AS uuid)";

    let result;
    try {
      result = await this.client.send(
        new ExecuteStatementCommand({
          resourceArn: this.clusterArn,
          secretArn: this.secretArn,
          database: this.database,
          sql,
          parameters: [
            { name: "thread_id", value: { stringValue: id } },
            { name: "tenant_id", value: { stringValue: this.tenantId } },
            { name: "agent_id", value: { stringValue: this.agentId } },
          ],
        }),
      );
    } catch (err) {
      throw new AuroraSessionStoreError(
        "load",
        `Aurora SessionStore load failed for thread ${id}: ${asMessage(err)}`,
        err,
      );
    }

    const records = result.records ?? [];
    if (records.length === 0) return null;

    const cell = records[0]?.[0];
    if (!cell || cell.isNull) return null;

    const raw = cell.stringValue;
    if (!raw) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new AuroraSessionStoreError(
        "load",
        `Aurora SessionStore load: thread ${id} stored invalid JSON in session_data: ${asMessage(err)}`,
        err,
      );
    }
    // Defensive guard: if some out-of-band writer stored the literal jsonb
    // value `null` (vs SQL NULL), JSON.parse returns the JS null and the
    // caller would otherwise see it as a valid SessionData of null shape.
    // Treat it the same as "no session yet" so Flue starts fresh.
    if (parsed === null) return null;
    return parsed as SessionData;
  }

  async delete(id: string): Promise<void> {
    // Clear session_data without removing the thread row — message history,
    // assignments, and labels all stay so the admin UI's thread view
    // continues to render. Flue can re-save() if it resumes the thread.
    // Same `updated_at` rationale as save(): runtime state, not user-facing.
    const sql =
      "UPDATE threads SET session_data = NULL " +
      "WHERE id = CAST(:thread_id AS uuid) " +
      "AND tenant_id = CAST(:tenant_id AS uuid) " +
      "AND agent_id = CAST(:agent_id AS uuid)";

    try {
      await this.client.send(
        new ExecuteStatementCommand({
          resourceArn: this.clusterArn,
          secretArn: this.secretArn,
          database: this.database,
          sql,
          parameters: [
            { name: "thread_id", value: { stringValue: id } },
            { name: "tenant_id", value: { stringValue: this.tenantId } },
            { name: "agent_id", value: { stringValue: this.agentId } },
          ],
        }),
      );
    } catch (err) {
      throw new AuroraSessionStoreError(
        "delete",
        `Aurora SessionStore delete failed for thread ${id}: ${asMessage(err)}`,
        err,
      );
    }
    // No numberOfRecordsUpdated check on delete — clearing a row that's
    // already NULL or that doesn't exist is a successful no-op (Flue's
    // contract: delete is idempotent).
  }
}

function asMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
