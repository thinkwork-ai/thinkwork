/**
 * identity-match — bootstrap/drift identity matching Lambda (THINK-321 U7,
 * KTD-7 — R9/R10).
 *
 * Two modes, mirroring ontology-scan:
 *
 *   - **Job mode** (`{tenantId, jobId}`) — Event-invoked by
 *     `startIdentityMatchJob` after the durable `identity.match_jobs` row is
 *     inserted. Runs the match pass: fetches source rows server-side
 *     (Postgres via the analyst broker seam, Twenty via the memory-source
 *     credential client), feeds each through the canonical matcher, writes
 *     mappings/cases per verdict, and records visible metrics — including
 *     queue-budget displacement (F4).
 *
 *   - **Drift mode** (`{drift: true, trigger: "scheduled"}`) — invoked by
 *     the terraform-managed EventBridge Scheduler rule (var-gated
 *     `identity_drift_match_enabled`, ships DISABLED). Enumerates tenants
 *     with registered identity sources and starts a per-tenant job; tenants
 *     with a pending/running job are skipped (the sweep is a cadence, not a
 *     queue) and the job dedupe key drops same-bucket duplicate starts.
 */

import { inArray } from "drizzle-orm";
import {
  identityMatchJobs,
  sourceSystemConnectors,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../lib/db.js";
import {
  runIdentityMatchJob,
  startIdentityMatchJob,
} from "../lib/entity-identity/bootstrap.js";

export interface IdentityMatchEvent {
  tenantId?: string;
  jobId?: string;
  /** Drift sweep mode (R10): enumerate tenants with registered sources. */
  drift?: boolean;
  trigger?: string;
}

export interface IdentityMatchDriftTenantResult {
  tenantId: string;
  state: "enqueued" | "skipped_in_flight" | "error";
  jobId?: string;
  error?: string;
}

interface IdentityMatchDeps {
  db?: typeof defaultDb;
  /** Injectable for tests; defaults to the real job starter. */
  startJob?: typeof startIdentityMatchJob;
  /** Injectable for tests; defaults to the real job runner. */
  runJob?: typeof runIdentityMatchJob;
}

export const handler = async (event: IdentityMatchEvent) =>
  processIdentityMatch(event);

export async function processIdentityMatch(
  event: IdentityMatchEvent,
  deps: IdentityMatchDeps = {},
) {
  if (event.drift) {
    const db = deps.db ?? defaultDb;
    const startJob = deps.startJob ?? startIdentityMatchJob;
    const tenantRows = await db
      .selectDistinct({ tenant_id: sourceSystemConnectors.tenant_id })
      .from(sourceSystemConnectors);
    const inFlightRows = await db
      .select({ tenant_id: identityMatchJobs.tenant_id })
      .from(identityMatchJobs)
      .where(inArray(identityMatchJobs.status, ["pending", "running"]));
    const inFlightTenantIds = new Set(inFlightRows.map((row) => row.tenant_id));

    const results: IdentityMatchDriftTenantResult[] = [];
    for (const tenant of tenantRows) {
      if (inFlightTenantIds.has(tenant.tenant_id)) {
        results.push({
          tenantId: tenant.tenant_id,
          state: "skipped_in_flight",
        });
        continue;
      }
      try {
        const job = await startJob({
          tenantId: tenant.tenant_id,
          trigger: event.trigger ?? "scheduled",
          db,
        });
        results.push({
          tenantId: tenant.tenant_id,
          state: "enqueued",
          jobId: job.id,
        });
      } catch (err) {
        results.push({
          tenantId: tenant.tenant_id,
          state: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return {
      statusCode: results.some((result) => result.state === "error")
        ? 500
        : 200,
      body: JSON.stringify({ drift: true, results }),
    };
  }

  if (!event.tenantId || !event.jobId) {
    throw new Error("identity-match requires tenantId and jobId");
  }

  const runJob = deps.runJob ?? runIdentityMatchJob;
  const result = await runJob(
    { tenantId: event.tenantId, jobId: event.jobId },
    deps.db ? { db: deps.db } : {},
  );

  return {
    statusCode: result.status === "failed" ? 500 : 200,
    body: JSON.stringify(result),
  };
}
