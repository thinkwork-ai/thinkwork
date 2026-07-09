/**
 * analyst-connection-reconciler Lambda (THINK-229 U5 — R7/R8, KTD8).
 *
 * Runs on a 30-minute EventBridge/Scheduler cadence. Probes the analyst
 * `analyst_reader` Aurora connection (reachability, IAM auth, SELECT-grant
 * introspection, zero-write assertion, schema-drift hash — all read-only)
 * and stamps the verdict onto every tenant's analyst connector row under
 * `tenant_mcp_servers.runtime_metadata.analyst_probe`.
 *
 * Dispatch (mcp-configs.ts, evaluateAnalystProbeGate) then withholds the
 * connection loudly on a failing OR stale verdict — a new capability drop
 * reason in the inspector, and a model-visible detail string — so the model
 * reports the outage instead of estimating (the THINK-228 anti-fabrication
 * failure mode).
 *
 * The verdict lives in `runtime_metadata` (operational state), NOT in the
 * signed sidecar or a policy column, so R10's "no new policy on the row"
 * rule stays intact (KTD8).
 *
 * The `analyst_reader` role is cluster-global: one connection, one grant
 * surface, one live schema. So the probe runs ONCE per invocation and the
 * single verdict is stamped on every tenant's row — there is no per-tenant
 * connection to probe separately.
 *
 * Logs one structured line per stamped row plus a summary line so CloudWatch
 * Logs Insights can alert on sustained probe failure.
 */

import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@thinkwork/database-pg";

import { ANALYST_CONNECTOR_SLUG } from "../lib/analyst/provision-connector.js";
import {
  probeAnalystConnection,
  type ConnectionProbeDeps,
  type ConnectionProbeVerdict,
} from "../lib/analyst/connection-probe.js";

const { tenantMcpServers } = schema;

export interface ReconcilerResult {
  probed: boolean;
  rows_updated: number;
  verdict: ConnectionProbeVerdict | null;
}

/** `deps` is injectable so the handler is unit-testable without a live DB. */
export async function handler(
  deps: ConnectionProbeDeps = {},
): Promise<ReconcilerResult> {
  const db = getDb();
  const start = Date.now();

  const rows = await db
    .select({
      id: tenantMcpServers.id,
      tenant_id: tenantMcpServers.tenant_id,
      runtime_metadata: tenantMcpServers.runtime_metadata,
    })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.slug, ANALYST_CONNECTOR_SLUG),
        eq(tenantMcpServers.status, "approved"),
      ),
    );

  if (rows.length === 0) {
    console.log(
      `[analyst-connection-reconciler] no approved analyst connector rows — nothing to probe`,
    );
    return { probed: false, rows_updated: 0, verdict: null };
  }

  // One probe for the cluster-global reader role; one verdict for all rows.
  const verdict = await probeAnalystConnection(deps);

  let updated = 0;
  for (const row of rows) {
    const existing =
      row.runtime_metadata && typeof row.runtime_metadata === "object"
        ? (row.runtime_metadata as Record<string, unknown>)
        : {};
    // MERGE: preserve every other runtime_metadata key (recordLinkHints,
    // etc.) — only the namespaced analyst_probe slot is (re)written.
    await db
      .update(tenantMcpServers)
      .set({
        runtime_metadata: { ...existing, analyst_probe: verdict },
        updated_at: new Date(),
      })
      .where(eq(tenantMcpServers.id, row.id));
    updated++;
    console.log(
      `[analyst-connection-reconciler] verdict_stamped server_id=${row.id} tenant_id=${row.tenant_id} status=${verdict.status}${verdict.reason ? ` reason=${verdict.reason}` : ""}`,
    );
  }

  const duration = Date.now() - start;
  console.log(
    `[analyst-connection-reconciler] status=${verdict.status} rows_updated=${updated} duration_ms=${duration}`,
  );

  return { probed: true, rows_updated: updated, verdict };
}
