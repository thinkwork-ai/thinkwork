/**
 * Explicit fail-closed analyst source refresh (THINK-283 U5).
 *
 * The ONLY product flow that adopts newly eligible tables into a registered
 * source's grant + model surface (R8), removes dropped/inaccessible objects
 * (R9), and never grants future objects (R7). PostgreSQL ACLs and S3
 * artifacts cannot share a transaction, so AVAILABILITY is the commit
 * point:
 *
 *   1. Persist `analyst_refresh = {status: running, attemptId, lease}` with
 *      a compare-and-set BEFORE any side effect — the broker (U7) and
 *      dispatch (U4) withhold the source from this moment. A concurrent
 *      attempt inside the lease loses with a conflict; an EXPIRED lease can
 *      be taken over by an operator retry, and every later write compares
 *      the attempt id so a superseded worker can never commit.
 *   2. Reconcile: internal sources re-run the schema-scoped grant
 *      reconciliation WITHOUT rotating the reader password (the stored
 *      credential stays valid); external sources model only the current
 *      DBA-granted exact surface and never issue grants. Then regenerate
 *      model v2 + qualified SCHEMA.md over the fixed S3 keys, rematerialize
 *      connection folders, and run an immediate exact-surface probe.
 *   3. Commit: compare-and-set a NEW source generation + the probe verdict +
 *      `analyst_refresh: ok` in one row update. Only claims minted from the
 *      new generation authorize afterwards (U7).
 *
 * ANY failure persists a sanitized `failed` state (step + remediation) and
 * leaves the source withheld; retry starts over from the stored source
 * identity and converges — a crash after grants but before artifacts cannot
 * make a half-refreshed source dispatchable.
 *
 * In-flight statements: the gate applies to NEW broker calls. A SELECT that
 * was authorized and executing when refresh began is allowed to finish —
 * refresh performs no unsafe query cancellation, and an already-parsed
 * statement cannot reach a newly granted object.
 */

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { and, eq, sql } from "drizzle-orm";
import { tenantMcpServers } from "@thinkwork/database-pg/schema";
import {
  normalizeStoredAnalystModel,
  renderStoredAnalystSchemaMarkdown,
  storedTableDescriptor,
  type StoredAnalystModel,
} from "@thinkwork/database-pg/analyst";

import { db as defaultDb } from "../../graphql/utils.js";
import {
  analystBrokerSourceSlug,
  sourceClaimsFromRuntimeMetadata,
  type AnalystSourceClaims,
} from "./caller-context.js";
import {
  probeAnalystConnection,
  type ConnectionProbeVerdict,
  type ProbePgClient,
} from "./connection-probe.js";
import {
  AnalystRegistrationInputError,
  AnalystRegistrationPostureError,
  analystSourceS3Prefix,
  newAnalystSourceGeneration,
  probeAndModelExternalSource,
  resolveTenantSlug,
  writeSourceModelToS3,
  type NormalizedRegisterInput,
} from "./register-data-source.js";
import {
  describeInternalClusters,
  openAdminClient,
  resolveAdminCredential,
  resolveStage,
} from "./internal-clusters.js";
import {
  provisionReaderRole,
  readerRoleName,
} from "./provision-reader-role.js";
import { materializeAnalystConnectionFolder } from "./connection-folder.js";
import { getConfig } from "@thinkwork/runtime-config";
import type { CapabilitySignedBy } from "../capabilities/sidecar-signing.js";

type DbLike = typeof defaultDb;

/** A running lease older than this can be taken over by a retry. */
export const ANALYST_REFRESH_LEASE_MS = 10 * 60 * 1000;

/** Another attempt holds a live lease; the resolver maps to CONFLICT. */
export class AnalystRefreshConflictError extends Error {}
/** Operator-correctable problems (unknown row, non-sourced row, ...). */
export class AnalystRefreshInputError extends Error {}
/** A refresh step failed; the source stays withheld until a retry succeeds. */
export class AnalystRefreshStepError extends Error {
  constructor(
    readonly step: string,
    message: string,
  ) {
    super(message);
  }
}

export interface RefreshAnalystDataSourceResult {
  serverId: string;
  slug: string;
  /** Qualified (schema.table) names added to the model by this refresh. */
  addedTables: string[];
  /** Qualified (schema.table) names removed from the model. */
  removedTables: string[];
  /** Modeled table count after the refresh. */
  tables: number;
}

export interface SourceRow {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  url: string;
  status: string;
  enabled: boolean;
  runtime_metadata: unknown;
}

/** Durable refresh-state operations (compare-and-set semantics). */
export interface RefreshStateOps {
  /** Own the refresh unless a LIVE lease exists. True = acquired. */
  acquire(serverId: string, attemptId: string, nowMs: number): Promise<boolean>;
  /** Persist a failed state; only the owning running attempt may write. */
  fail(
    serverId: string,
    attemptId: string,
    refresh: Record<string, unknown>,
  ): Promise<boolean>;
  /** Commit generation+verdict+ok in ONE attempt-owned update. */
  commit(
    serverId: string,
    attemptId: string,
    generation: string,
    verdict: ConnectionProbeVerdict,
    nowMs: number,
  ): Promise<boolean>;
}

/** Effects injectable for lifecycle tests (each defaults to the real impl). */
export interface RefreshDeps {
  db?: DbLike;
  nowMs?: () => number;
  /** Row loader (default: drizzle select on tenant_mcp_servers). */
  loadRow?: (tenantId: string, serverId: string) => Promise<SourceRow | null>;
  /** Durable state CAS ops (default: drizzle jsonb_set CAS updates). */
  stateOps?: RefreshStateOps;
  /** Tenant slug for the S3 prefix (default: tenants table lookup). */
  resolveTenant?: (tenantId: string) => Promise<string>;
  /** Read the per-source reader credential secret → password. */
  resolvePassword?: (credentialSecretArn: string) => Promise<string>;
  /** Internal sources: reconcile the schema-scoped ACLs (no rotation). */
  reconcileInternalGrants?: (input: {
    clusterId: string;
    database: string;
    schema: string;
    slug: string;
  }) => Promise<void>;
  /** Probe + model the current exact surface (registration's own ceremony). */
  probeModel?: (input: NormalizedRegisterInput) => Promise<StoredAnalystModel>;
  /** Fetch the previous stored model (null = missing/unreadable). */
  fetchPreviousModel?: (input: {
    bucket: string;
    tenantSlug: string;
    slug: string;
  }) => Promise<StoredAnalystModel | null>;
  /** Overwrite model.json + SCHEMA.md on the fixed per-source keys. */
  writeArtifacts?: (input: {
    bucket: string;
    tenantSlug: string;
    slug: string;
    model: StoredAnalystModel;
    schemaMarkdown: string;
  }) => Promise<void>;
  /** Rematerialize the signed connections/<slug>/ folder into every agent. */
  materializeFolders?: (input: {
    tenantId: string;
    tenantMcpServerId: string;
    schemaMarkdown: string;
    signedBy: CapabilitySignedBy;
  }) => Promise<void>;
  /** Immediate exact-surface probe against the refreshed source. */
  immediateProbe?: (input: {
    claims: AnalystSourceClaims;
    model: StoredAnalystModel;
    schema: string;
  }) => Promise<ConnectionProbeVerdict>;
}

export interface RefreshAnalystDataSourceInput {
  tenantId: string;
  serverId: string;
  /** Operator identity for the re-signed connection folder. */
  signedBy: CapabilitySignedBy;
}

function cfg(key: string): string | undefined {
  try {
    return getConfig(key) || undefined;
  } catch {
    return undefined;
  }
}

/** Qualified-name diff between two normalized models. */
export function diffModels(
  previous: StoredAnalystModel | null,
  next: StoredAnalystModel,
): { addedTables: string[]; removedTables: string[] } {
  const before = new Set(
    (previous?.tables ?? []).map((t) => storedTableDescriptor(t)),
  );
  const after = new Set(next.tables.map((t) => storedTableDescriptor(t)));
  return {
    addedTables: [...after].filter((k) => !before.has(k)).sort(),
    removedTables: [...before].filter((k) => !after.has(k)).sort(),
  };
}

/**
 * Acquire the refresh lease: CAS `analyst_refresh` to `running` unless a
 * LIVE lease exists. Returns true when this attempt now owns the refresh.
 */
async function acquireLease(
  db: DbLike,
  serverId: string,
  attemptId: string,
  nowMs: number,
): Promise<boolean> {
  const nowIso = new Date(nowMs).toISOString();
  const leaseFloorIso = new Date(
    nowMs - ANALYST_REFRESH_LEASE_MS,
  ).toISOString();
  const state = { status: "running", attemptId, updatedAt: nowIso };
  const result = await db
    .update(tenantMcpServers)
    .set({
      runtime_metadata: sql`jsonb_set(coalesce(${tenantMcpServers.runtime_metadata}, '{}'::jsonb), '{analyst_refresh}', ${JSON.stringify(state)}::jsonb)`,
      updated_at: new Date(nowMs),
    })
    .where(
      and(
        eq(tenantMcpServers.id, serverId),
        // No live lease: absent state, non-running state, or an expired
        // running lease (operator takeover).
        sql`(
          ${tenantMcpServers.runtime_metadata} -> 'analyst_refresh' IS NULL
          OR ${tenantMcpServers.runtime_metadata} -> 'analyst_refresh' ->> 'status' <> 'running'
          OR coalesce(${tenantMcpServers.runtime_metadata} -> 'analyst_refresh' ->> 'updatedAt', '') < ${leaseFloorIso}
        )`,
      ),
    )
    .returning({ id: tenantMcpServers.id });
  return result.length > 0;
}

/**
 * CAS-write a terminal refresh state. Only the owning attempt can write;
 * a superseded worker's late completion is silently ignored (the winner's
 * state stands).
 */
async function casWriteState(
  db: DbLike,
  serverId: string,
  attemptId: string,
  patch: { refresh: Record<string, unknown> },
): Promise<boolean> {
  const refreshJson = JSON.stringify(patch.refresh);
  const result = await db
    .update(tenantMcpServers)
    .set({
      runtime_metadata: sql`jsonb_set(coalesce(${tenantMcpServers.runtime_metadata}, '{}'::jsonb), '{analyst_refresh}', ${refreshJson}::jsonb)`,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(tenantMcpServers.id, serverId),
        sql`${tenantMcpServers.runtime_metadata} -> 'analyst_refresh' ->> 'attemptId' = ${attemptId}`,
        sql`${tenantMcpServers.runtime_metadata} -> 'analyst_refresh' ->> 'status' = 'running'`,
      ),
    )
    .returning({ id: tenantMcpServers.id });
  return result.length > 0;
}

/**
 * Commit: new source generation + immediate probe verdict + refresh ok, in
 * ONE compare-and-set update owned by this attempt.
 */
async function casCommit(
  db: DbLike,
  serverId: string,
  attemptId: string,
  generation: string,
  verdict: ConnectionProbeVerdict,
  nowMs: number,
): Promise<boolean> {
  const nowIso = new Date(nowMs).toISOString();
  const refreshJson = JSON.stringify({
    status: "ok",
    attemptId,
    updatedAt: nowIso,
  });
  const verdictJson = JSON.stringify(verdict);
  const result = await db
    .update(tenantMcpServers)
    .set({
      runtime_metadata: sql`jsonb_set(
        jsonb_set(
          jsonb_set(
            coalesce(${tenantMcpServers.runtime_metadata}, '{}'::jsonb),
            '{analyst_source,sourceGeneration}', to_jsonb(${generation}::text)
          ),
          '{analyst_probe}', ${verdictJson}::jsonb
        ),
        '{analyst_refresh}', ${refreshJson}::jsonb
      )`,
      updated_at: new Date(nowMs),
    })
    .where(
      and(
        eq(tenantMcpServers.id, serverId),
        sql`${tenantMcpServers.runtime_metadata} -> 'analyst_refresh' ->> 'attemptId' = ${attemptId}`,
        sql`${tenantMcpServers.runtime_metadata} -> 'analyst_refresh' ->> 'status' = 'running'`,
      ),
    )
    .returning({ id: tenantMcpServers.id });
  return result.length > 0;
}

async function defaultResolvePassword(
  credentialSecretArn: string,
): Promise<string> {
  const { SecretsManagerClient, GetSecretValueCommand } =
    await import("@aws-sdk/client-secrets-manager");
  const sm = new SecretsManagerClient({
    region: process.env.AWS_REGION || "us-east-1",
  });
  const res = await sm.send(
    new GetSecretValueCommand({ SecretId: credentialSecretArn }),
  );
  const parsed = JSON.parse(res.SecretString || "{}") as {
    password?: unknown;
  };
  if (typeof parsed.password !== "string" || !parsed.password) {
    throw new Error("stored reader credential has no password");
  }
  return parsed.password;
}

async function defaultReconcileInternalGrants(input: {
  clusterId: string;
  database: string;
  schema: string;
  slug: string;
}): Promise<void> {
  const stage = resolveStage();
  const clusters = await describeInternalClusters(stage);
  const cluster = clusters.find((c) => c.clusterId === input.clusterId);
  if (!cluster) {
    throw new Error(
      `internal cluster "${input.clusterId}" was not found in this environment`,
    );
  }
  const admin = await resolveAdminCredential(stage);
  if (!admin) {
    throw new Error(
      `no admin credential is available for cluster "${input.clusterId}"`,
    );
  }
  const client = await openAdminClient({
    host: cluster.endpoint,
    port: cluster.port,
    database: input.database,
    credential: admin,
  });
  try {
    await provisionReaderRole({
      client,
      database: input.database,
      roleName: readerRoleName(input.slug),
      password: null, // refresh mode: reconcile grants, keep the credential
      schema: input.schema,
    });
  } finally {
    try {
      await client.end();
    } catch {
      // best-effort close
    }
  }
}

async function defaultFetchPreviousModel(input: {
  bucket: string;
  tenantSlug: string;
  slug: string;
}): Promise<StoredAnalystModel | null> {
  const s3 = new S3Client({
    region:
      process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
  });
  const key = `${analystSourceS3Prefix(input.tenantSlug, input.slug)}model.json`;
  try {
    const result = (await s3.send(
      new GetObjectCommand({ Bucket: input.bucket, Key: key }),
    )) as { Body?: { transformToString?: () => Promise<string> } };
    const body = await result.Body?.transformToString?.();
    if (!body) return null;
    return normalizeStoredAnalystModel(JSON.parse(body));
  } catch {
    return null;
  }
}

async function defaultImmediateProbe(input: {
  claims: AnalystSourceClaims;
  model: StoredAnalystModel;
  schema: string;
}): Promise<ConnectionProbeVerdict> {
  const { connectExternalSource } =
    await import("@thinkwork/lambda/analyst-reader-db");
  return probeAnalystConnection({
    getClient: () =>
      connectExternalSource(input.claims) as unknown as Promise<ProbePgClient>,
    grantedTables: input.model.tables.map((t) => ({
      schema: t.schema,
      name: t.name,
      columns: t.columns.map((c) => ({ name: c.name, type: c.pgType })),
    })),
    role: input.claims.dbUser,
    sourceSchema: input.schema,
  });
}

/**
 * Run the full refresh for one sourced analyst connector. See module docs
 * for the lifecycle contract. Throws:
 *   - {@link AnalystRefreshInputError} — unknown/non-sourced row (no writes);
 *   - {@link AnalystRefreshConflictError} — live lease held by another attempt;
 *   - {@link AnalystRefreshStepError} — a step failed; `analyst_refresh` is
 *     persisted `failed` with the sanitized step detail and the source stays
 *     withheld until a retry succeeds.
 */
export async function refreshAnalystDataSource(
  input: RefreshAnalystDataSourceInput,
  deps: RefreshDeps = {},
): Promise<RefreshAnalystDataSourceResult> {
  const db = deps.db ?? defaultDb;
  const nowMs = deps.nowMs ?? (() => Date.now());
  const stateOps: RefreshStateOps = deps.stateOps ?? {
    acquire: (serverId, attemptId, now) =>
      acquireLease(db, serverId, attemptId, now),
    fail: (serverId, attemptId, refresh) =>
      casWriteState(db, serverId, attemptId, { refresh }),
    commit: (serverId, attemptId, generation, verdict, now) =>
      casCommit(db, serverId, attemptId, generation, verdict, now),
  };
  const loadRow =
    deps.loadRow ??
    (async (tenantId: string, serverId: string) => {
      const [found] = (await db
        .select({
          id: tenantMcpServers.id,
          tenant_id: tenantMcpServers.tenant_id,
          name: tenantMcpServers.name,
          slug: tenantMcpServers.slug,
          url: tenantMcpServers.url,
          status: tenantMcpServers.status,
          enabled: tenantMcpServers.enabled,
          runtime_metadata: tenantMcpServers.runtime_metadata,
        })
        .from(tenantMcpServers)
        .where(
          and(
            eq(tenantMcpServers.id, serverId),
            eq(tenantMcpServers.tenant_id, tenantId),
          ),
        )
        .limit(1)) as SourceRow[];
      return found ?? null;
    });

  // Resolve the row: exact tenant + id, sourced analyst connectors only.
  const row = await loadRow(input.tenantId, input.serverId);
  if (!row) {
    throw new AnalystRefreshInputError("analyst data source not found");
  }
  const sourceSlug = row.url ? analystBrokerSourceSlug(row.url) : null;
  if (!sourceSlug || sourceSlug !== row.slug) {
    throw new AnalystRefreshInputError(
      "refresh applies only to registered (sourced) analyst data sources — " +
        "the built-in connector has its own provisioning action",
    );
  }
  const claims = sourceClaimsFromRuntimeMetadata(
    row.slug,
    row.runtime_metadata,
  );
  if (!claims) {
    throw new AnalystRefreshInputError(
      `analyst source "${row.slug}" has missing or malformed runtime metadata — re-register the source`,
    );
  }
  const meta = row.runtime_metadata as Record<string, unknown>;
  const source = meta.analyst_source as Record<string, unknown>;
  const schema = claims.schema ?? "public";
  const kind =
    source.kind === "internal" || source.kind === "external"
      ? source.kind
      : // Legacy rows predate the kind field: internal rows always carried a
        // clusterId only post-THINK-283, so a legacy row refreshes as
        // external (models the current surface; issues no grants) — safe for
        // both kinds.
        "external";
  const clusterId =
    typeof source.clusterId === "string" ? source.clusterId : null;

  const bucket = cfg("WORKSPACE_BUCKET");
  if (!bucket) {
    throw new AnalystRefreshInputError(
      "WORKSPACE_BUCKET is not configured — nothing was changed",
    );
  }

  // 1. Own the refresh: durable running state BEFORE any side effect.
  const attemptId = newAnalystSourceGeneration();
  const acquired = await stateOps.acquire(row.id, attemptId, nowMs());
  if (!acquired) {
    throw new AnalystRefreshConflictError(
      "a refresh for this source is already running — wait for it to finish or retry after it fails",
    );
  }

  const failStep = async (step: string, err: unknown): Promise<never> => {
    const raw = err instanceof Error ? err.message : String(err);
    // Sanitized: step + first line, no stack, no credentials.
    const detail = `refresh failed at step "${step}": ${raw.split("\n")[0]} — retry the refresh; the source stays withheld until a retry succeeds`;
    await stateOps
      .fail(row.id, attemptId, {
        status: "failed",
        attemptId,
        step,
        detail,
        updatedAt: new Date(nowMs()).toISOString(),
      })
      .catch(() => undefined);
    throw new AnalystRefreshStepError(step, detail);
  };

  // 2a. Credential: the stored per-source reader password (never rotated).
  let password: string;
  try {
    password = await (deps.resolvePassword ?? defaultResolvePassword)(
      claims.credentialSecretArn,
    );
  } catch (err) {
    return failStep("credential", err);
  }

  // 2b. Internal sources: reconcile the schema-scoped ACL surface.
  if (kind === "internal") {
    if (!clusterId) {
      return failStep(
        "grants",
        new Error(
          "internal source has no stored clusterId — re-register the source to adopt refresh",
        ),
      );
    }
    try {
      await (deps.reconcileInternalGrants ?? defaultReconcileInternalGrants)({
        clusterId,
        database: claims.database,
        schema,
        slug: row.slug,
      });
    } catch (err) {
      return failStep("grants", err);
    }
  }

  // 2c. Model the CURRENT exact surface (same posture checks as
  //     registration: base tables only, effective privileges, one schema).
  let model: StoredAnalystModel;
  try {
    model = await (deps.probeModel ?? probeAndModelExternalSource)({
      name: row.name,
      slug: row.slug,
      host: claims.host,
      port: claims.port,
      database: claims.database,
      dbUser: claims.dbUser,
      password,
      tls: claims.tls,
      schema,
    });
  } catch (err) {
    return failStep("model", err);
  }

  // 2d. Diff + artifacts on the fixed per-source keys.
  let tenantSlug: string;
  let previous: StoredAnalystModel | null;
  const schemaMarkdown = renderStoredAnalystSchemaMarkdown(model, {
    sourceName: row.name,
  });
  try {
    tenantSlug = await (
      deps.resolveTenant ?? ((t: string) => resolveTenantSlug(t, db))
    )(input.tenantId);
    previous = await (deps.fetchPreviousModel ?? defaultFetchPreviousModel)({
      bucket,
      tenantSlug,
      slug: row.slug,
    });
    await (
      deps.writeArtifacts ??
      (async (a) => {
        await writeSourceModelToS3(a);
      })
    )({
      bucket,
      tenantSlug,
      slug: row.slug,
      model,
      schemaMarkdown,
    });
  } catch (err) {
    return failStep("artifacts", err);
  }

  // 2e. Rematerialize the signed connection folders.
  try {
    await (
      deps.materializeFolders ??
      (async (a) => {
        await materializeAnalystConnectionFolder(a);
      })
    )({
      tenantId: input.tenantId,
      tenantMcpServerId: row.id,
      schemaMarkdown,
      signedBy: input.signedBy,
    });
  } catch (err) {
    return failStep("folders", err);
  }

  // 2f. Immediate exact-surface probe — the refreshed source must verify
  //     healthy BEFORE availability is restored.
  let verdict: ConnectionProbeVerdict;
  try {
    verdict = await (deps.immediateProbe ?? defaultImmediateProbe)({
      claims,
      model,
      schema,
    });
  } catch (err) {
    return failStep("probe", err);
  }
  if (verdict.status !== "ok") {
    return failStep(
      "probe",
      new Error(verdict.detail ?? `probe failed (${verdict.reason})`),
    );
  }

  // 3. Commit: new generation + verdict + refresh ok, attempt-owned CAS.
  const generation = newAnalystSourceGeneration();
  const committed = await stateOps
    .commit(row.id, attemptId, generation, verdict, nowMs())
    .catch(async (err) => {
      await failStep("commit", err);
      return false;
    });
  if (!committed) {
    // Superseded (an operator takeover won) — this worker must not clear
    // the winner's gate or mint availability.
    throw new AnalystRefreshConflictError(
      "this refresh attempt was superseded by a newer one — its result was discarded",
    );
  }

  const { addedTables, removedTables } = diffModels(previous, model);
  return {
    serverId: row.id,
    slug: row.slug,
    addedTables,
    removedTables,
    tables: model.tables.length,
  };
}

// Re-exported for the resolver's error mapping.
export { AnalystRegistrationInputError, AnalystRegistrationPostureError };
