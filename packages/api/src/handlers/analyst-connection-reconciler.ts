/**
 * analyst-connection-reconciler Lambda (THINK-229 U5 — R7/R8, KTD8;
 * THINK-239 multi-source).
 *
 * Runs on a 30-minute EventBridge/Scheduler cadence. Probes every approved +
 * enabled analyst connector row — the builtin cluster-global `analyst_reader`
 * connection AND every registered external source (THINK-239) — and stamps
 * the verdict onto each row's `tenant_mcp_servers.runtime_metadata.analyst_probe`.
 *
 * Dispatch (mcp-configs.ts, evaluateAnalystProbeGate) then withholds a
 * connection loudly on a failing OR stale verdict — a capability drop reason
 * in the inspector and a model-visible detail — so the model reports the
 * outage instead of estimating.
 *
 * Builtin rows (bare `/mcp/analyst`): the `analyst_reader` role is
 * cluster-global, so the probe runs ONCE per invocation and the single
 * verdict is stamped on every builtin row. Sourced rows
 * (`/mcp/analyst/<slug>`): each connects via its own signed sourceClaims
 * (reconstructed from runtime_metadata + the per-source secret) and is probed
 * for reachability/auth, zero write privileges, and schema drift against the
 * stored model.json — reusing probeAnalystConnection (same normalizer +
 * descriptor hash as the builtin) with the source's own client + granted
 * surface.
 */

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getConfig } from "@thinkwork/runtime-config";
import type { StoredAnalystModel } from "@thinkwork/database-pg/analyst";
import { connectExternalSource } from "@thinkwork/lambda/analyst-reader-db";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@thinkwork/database-pg";

import {
  analystBrokerSourceSlug,
  isAnalystBrokerUrl,
  sourceClaimsFromRuntimeMetadata,
} from "../lib/analyst/caller-context.js";
import {
  probeAnalystConnection,
  type ConnectionProbeDeps,
  type ConnectionProbeVerdict,
  type ProbePgClient,
} from "../lib/analyst/connection-probe.js";
import { resolveTenantSlug } from "../lib/analyst/register-data-source.js";

const { tenantMcpServers } = schema;

interface AnalystRow {
  id: string;
  tenant_id: string;
  url: string;
  slug: string;
  runtime_metadata: unknown;
}

/** Injectable so the handler is unit-testable without a live DB/source. */
export interface ReconcilerDeps extends ConnectionProbeDeps {
  /** Probe one sourced row. Default: connect via sourceClaims + stored model. */
  probeSourcedRow?: (row: AnalystRow) => Promise<ConnectionProbeVerdict>;
}

export interface ReconcilerResult {
  probed: boolean;
  rows_updated: number;
  /** The builtin cluster-global verdict, if any builtin rows were probed. */
  verdict: ConnectionProbeVerdict | null;
  sourced_probed: number;
}

async function fetchStoredModel(
  bucket: string,
  tenantSlug: string,
  slug: string,
  s3: Pick<S3Client, "send">,
): Promise<StoredAnalystModel | null> {
  const key = `tenants/${tenantSlug}/analyst-sources/${slug}/model.json`;
  try {
    const result = (await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    )) as { Body?: { transformToString?: () => Promise<string> } };
    const body = await result.Body?.transformToString?.();
    if (!body) return null;
    return JSON.parse(body) as StoredAnalystModel;
  } catch {
    return null;
  }
}

async function defaultProbeSourcedRow(
  row: AnalystRow,
): Promise<ConnectionProbeVerdict> {
  const checkedAt = new Date().toISOString();
  const slug = row.slug ?? analystBrokerSourceSlug(row.url) ?? "";
  const claims = sourceClaimsFromRuntimeMetadata(slug, row.runtime_metadata);
  if (!claims) {
    return {
      status: "fail",
      reason: "probe_error",
      detail: `analyst source "${slug}" has missing/invalid runtime_metadata.analyst_source`,
      checkedAt,
    };
  }
  const bucket = getConfig("WORKSPACE_BUCKET");
  if (!bucket) {
    return {
      status: "fail",
      reason: "probe_error",
      detail:
        "WORKSPACE_BUCKET is not configured — cannot load the stored model",
      checkedAt,
    };
  }
  const s3 = new S3Client({
    region:
      process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
  });
  let tenantSlug: string;
  try {
    tenantSlug = await resolveTenantSlug(row.tenant_id);
  } catch (err) {
    return {
      status: "fail",
      reason: "probe_error",
      detail: err instanceof Error ? err.message : String(err),
      checkedAt,
    };
  }
  const model = await fetchStoredModel(bucket, tenantSlug, slug, s3);
  if (!model) {
    return {
      status: "fail",
      reason: "schema_drift",
      detail: `stored model for analyst source "${slug}" is missing from S3 — re-register the source`,
      checkedAt,
    };
  }
  const grantedTables = model.tables.map((t) => ({
    name: t.name,
    columns: t.columns.map((c) => ({ name: c.name, type: c.pgType })),
  }));
  return probeAnalystConnection({
    getClient: () =>
      connectExternalSource(claims) as unknown as Promise<ProbePgClient>,
    grantedTables,
    role: claims.dbUser,
  });
}

export async function handler(
  deps: ReconcilerDeps = {},
): Promise<ReconcilerResult> {
  const db = getDb();
  const start = Date.now();

  const allRows = await db
    .select({
      id: tenantMcpServers.id,
      tenant_id: tenantMcpServers.tenant_id,
      url: tenantMcpServers.url,
      slug: tenantMcpServers.slug,
      runtime_metadata: tenantMcpServers.runtime_metadata,
    })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.status, "approved"),
        eq(tenantMcpServers.enabled, true),
      ),
    );

  const analystRows = allRows.filter(
    (r): r is AnalystRow => !!r.url && isAnalystBrokerUrl(r.url),
  );
  const builtinRows = analystRows.filter(
    (r) => analystBrokerSourceSlug(r.url) === null,
  );
  const sourcedRows = analystRows.filter(
    (r) => analystBrokerSourceSlug(r.url) !== null,
  );

  if (analystRows.length === 0) {
    console.log(
      `[analyst-connection-reconciler] no approved analyst connector rows — nothing to probe`,
    );
    return { probed: false, rows_updated: 0, verdict: null, sourced_probed: 0 };
  }

  const stamp = async (
    row: AnalystRow,
    verdict: ConnectionProbeVerdict,
  ): Promise<void> => {
    const existing =
      row.runtime_metadata && typeof row.runtime_metadata === "object"
        ? (row.runtime_metadata as Record<string, unknown>)
        : {};
    // MERGE: preserve every other runtime_metadata key (analyst_source,
    // recordLinkHints, ...) — only the namespaced analyst_probe slot changes.
    await db
      .update(tenantMcpServers)
      .set({
        runtime_metadata: { ...existing, analyst_probe: verdict },
        updated_at: new Date(),
      })
      .where(eq(tenantMcpServers.id, row.id));
    console.log(
      `[analyst-connection-reconciler] verdict_stamped server_id=${row.id} tenant_id=${row.tenant_id} slug=${row.slug ?? ""} status=${verdict.status}${verdict.reason ? ` reason=${verdict.reason}` : ""}`,
    );
  };

  let updated = 0;

  // Builtin: one cluster-global probe, stamped on every builtin row.
  let builtinVerdict: ConnectionProbeVerdict | null = null;
  if (builtinRows.length > 0) {
    builtinVerdict = await probeAnalystConnection(deps);
    for (const row of builtinRows) {
      await stamp(row, builtinVerdict);
      updated++;
    }
  }

  // Sourced: probe each row independently.
  const probeSourced = deps.probeSourcedRow ?? defaultProbeSourcedRow;
  for (const row of sourcedRows) {
    const verdict = await probeSourced(row);
    await stamp(row, verdict);
    updated++;
  }

  const duration = Date.now() - start;
  console.log(
    `[analyst-connection-reconciler] builtin_status=${builtinVerdict?.status ?? "none"} sourced_probed=${sourcedRows.length} rows_updated=${updated} duration_ms=${duration}`,
  );

  return {
    probed: true,
    rows_updated: updated,
    verdict: builtinVerdict,
    sourced_probed: sourcedRows.length,
  };
}
