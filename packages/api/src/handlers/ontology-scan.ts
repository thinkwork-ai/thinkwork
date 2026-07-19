import { inArray } from "drizzle-orm";
import {
  ontologySuggestionScanJobs,
  tenants,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../lib/db.js";
import {
  runOntologySuggestionScan,
  startOntologySuggestionScanJob,
} from "../lib/ontology/suggestions.js";

export interface OntologyScanEvent {
  tenantId?: string;
  jobId?: string;
  /** Scheduled sweep mode (THINK-320 KTD-3 / R9): enumerate tenants and
   * start a scan job per tenant. */
  sweep?: boolean;
  trigger?: string;
}

export interface OntologyScanSweepTenantResult {
  tenantId: string;
  state: "enqueued" | "skipped_in_flight" | "error";
  jobId?: string;
  error?: string;
}

interface OntologyScanDeps {
  db?: typeof defaultDb;
  /** Injectable for tests; defaults to the real scan-job starter. */
  startScanJob?: typeof startOntologySuggestionScanJob;
}

export const handler = async (event: OntologyScanEvent) =>
  processOntologyScan(event);

export async function processOntologyScan(
  event: OntologyScanEvent,
  deps: OntologyScanDeps = {},
) {
  if (event.sweep) {
    const db = deps.db ?? defaultDb;
    const startScanJob = deps.startScanJob ?? startOntologySuggestionScanJob;
    const tenantRows = await db.select({ id: tenants.id }).from(tenants);
    // A tenant with a pending/running scan is skipped — the daily sweep is a
    // cadence, not a queue, and startOntologySuggestionScanJob's bucket
    // dedupe only covers same-bucket starts.
    const inFlightRows = await db
      .select({ tenant_id: ontologySuggestionScanJobs.tenant_id })
      .from(ontologySuggestionScanJobs)
      .where(
        inArray(ontologySuggestionScanJobs.status, ["pending", "running"]),
      );
    const inFlightTenantIds = new Set(inFlightRows.map((row) => row.tenant_id));

    const results: OntologyScanSweepTenantResult[] = [];
    for (const tenant of tenantRows) {
      if (inFlightTenantIds.has(tenant.id)) {
        results.push({ tenantId: tenant.id, state: "skipped_in_flight" });
        continue;
      }
      try {
        const job = await startScanJob({
          tenantId: tenant.id,
          trigger: event.trigger ?? "scheduled",
          db,
        });
        results.push({
          tenantId: tenant.id,
          state: "enqueued",
          jobId: job.id,
        });
      } catch (err) {
        results.push({
          tenantId: tenant.id,
          state: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return {
      statusCode: results.some((result) => result.state === "error")
        ? 500
        : 200,
      body: JSON.stringify({ sweep: true, results }),
    };
  }

  if (!event.tenantId || !event.jobId) {
    throw new Error("ontology-scan requires tenantId and jobId");
  }

  const result = await runOntologySuggestionScan({
    tenantId: event.tenantId,
    jobId: event.jobId,
  });

  return {
    statusCode: result.status === "failed" ? 500 : 200,
    body: JSON.stringify(result),
  };
}
