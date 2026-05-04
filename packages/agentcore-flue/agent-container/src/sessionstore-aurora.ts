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
 *
 * The blob lives in the same row as the thread's product metadata so
 * thread lifecycle (assign, close, archive) atomically clears Flue's
 * state — no extra junction table to keep in sync. Pre-Flue threads
 * coexist with `session_data IS NULL`.
 *
 * Why a column on `threads` instead of a new table:
 *   - Session is 1:1 with thread (every Flue session belongs to exactly
 *     one thread; threads are the user-facing conversation primitive).
 *   - `tenant_id` and `agent_id` already live on the row; no duplication.
 *   - Postgres TOASTs large jsonb values, so wide rows don't bloat the
 *     base table.
 *   - Single writer per thread (one Flue loop at a time), so
 *     read-modify-write contention isn't a concern at this scale.
 *
 * Tenant isolation (FR-4a):
 *   - The `tenantId` constructor argument is bound at instantiation. Empty
 *     or null fails closed — the dispatcher MUST snapshot
 *     `ctx.auth.tenantId` (or fall back to `resolveCallerTenantId(ctx)`)
 *     before constructing the store.
 *   - Every save/load/delete includes `tenant_id = :tenant_id` in the
 *     predicate so cross-tenant access surfaces as a row-not-found, not as
 *     a successful read of another tenant's data.
 *   - `save()` errors when `numberOfRecordsUpdated === 0`. This catches
 *     two cases: the thread doesn't exist, AND the thread exists under a
 *     different tenant. Either way Flue's caller sees a typed error rather
 *     than a silent no-op.
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
    this.tenantId = opts.tenantId;
    this.clusterArn = opts.clusterArn;
    this.secretArn = opts.secretArn;
    this.database = opts.database ?? "thinkwork";
    this.client = opts.client ?? new RDSDataClient({});
  }

  async save(id: string, data: SessionData): Promise<void> {
    const sql =
      "UPDATE threads " +
      "SET session_data = CAST(:session_data AS jsonb), updated_at = NOW() " +
      "WHERE id = CAST(:thread_id AS uuid) " +
      "AND tenant_id = CAST(:tenant_id AS uuid)";

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

    // numberOfRecordsUpdated is 0 when either the thread doesn't exist OR
    // the thread exists under a different tenant. Flue treats both as
    // "you can't write here" — the caller should surface to the user
    // rather than retry silently.
    const updated = result.numberOfRecordsUpdated ?? 0;
    if (updated === 0) {
      throw new AuroraSessionStoreError(
        "save",
        `Aurora SessionStore save matched no thread row for tenant=${this.tenantId} thread=${id}. ` +
          "Either the thread doesn't exist or it belongs to a different tenant.",
      );
    }
  }

  async load(id: string): Promise<SessionData | null> {
    const sql =
      "SELECT session_data FROM threads " +
      "WHERE id = CAST(:thread_id AS uuid) " +
      "AND tenant_id = CAST(:tenant_id AS uuid)";

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

    try {
      return JSON.parse(raw) as SessionData;
    } catch (err) {
      throw new AuroraSessionStoreError(
        "load",
        `Aurora SessionStore load: thread ${id} stored invalid JSON in session_data: ${asMessage(err)}`,
        err,
      );
    }
  }

  async delete(id: string): Promise<void> {
    // Clear session_data without removing the thread row — message history,
    // assignments, and labels all stay so the admin UI's thread view
    // continues to render. Flue can re-save() if it resumes the thread.
    const sql =
      "UPDATE threads SET session_data = NULL, updated_at = NOW() " +
      "WHERE id = CAST(:thread_id AS uuid) " +
      "AND tenant_id = CAST(:tenant_id AS uuid)";

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
