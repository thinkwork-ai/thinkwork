/**
 * Internal cluster browser core (THINK-239).
 *
 * Enumerates the environment's OWN RDS clusters (DBClusterIdentifier starting
 * `thinkwork-<stage>-`) and the databases on each, so an operator can register
 * one as an analyst data source with ZERO credential entry — the backend
 * auto-provisions a hardened read-only role (see provision-reader-role.ts).
 *
 * The admin credential is the cluster master user, resolved from Secrets
 * Manager secret `thinkwork-<stage>-db-credentials` (JSON {username, password});
 * the host comes from the RDS describe, never the secret. Enumeration and role
 * provisioning both connect with this master credential.
 *
 * Fail-soft: a cluster with no resolvable admin secret, or one we cannot
 * connect to, returns an empty `databases` list — never fails the whole query.
 *
 * Effectful pieces take injectable deps so the pure orchestration
 * (listInternalClusters + alreadyRegistered accounting) is unit-testable
 * without AWS or Postgres.
 */

import { eq } from "drizzle-orm";
import { tenantMcpServers } from "@thinkwork/database-pg/schema";
import type { Client as PgClientType } from "pg";

import { db as defaultDb } from "../../graphql/utils.js";

type DbLike = typeof defaultDb;

export interface InternalDatabase {
  name: string;
  alreadyRegistered: boolean;
}

export interface InternalCluster {
  clusterId: string;
  endpoint: string;
  port: number;
  databases: InternalDatabase[];
}

/** DBClusterIdentifier + connect coordinates, before database enumeration. */
export interface RawInternalCluster {
  clusterId: string;
  endpoint: string;
  port: number;
}

export interface AdminCredential {
  username: string;
  password: string;
}

/** The builtin `thinkwork` app database is always offered via the built-in path. */
export const WORKSPACE_DATABASE = "thinkwork";

export function resolveStage(env: NodeJS.ProcessEnv = process.env): string {
  return env.STAGE || "dev";
}

export function internalClusterIdPrefix(stage: string): string {
  return `thinkwork-${stage}-`;
}

/** Secrets Manager secret name for the cluster master user (dash-delimited). */
export function adminDbSecretName(stage: string): string {
  return `thinkwork-${stage}-db-credentials`;
}

const CONNECT_TIMEOUT_MS = 5000;

/**
 * Describe the environment's own RDS clusters. Filters to
 * `thinkwork-<stage>-*` and drops clusters with no reader/writer endpoint.
 */
export async function describeInternalClusters(
  stage: string,
): Promise<RawInternalCluster[]> {
  const { RDSClient, DescribeDBClustersCommand } =
    await import("@aws-sdk/client-rds");
  const client = new RDSClient({
    region: process.env.AWS_REGION || "us-east-1",
  });
  const prefix = internalClusterIdPrefix(stage);
  const out: RawInternalCluster[] = [];
  let marker: string | undefined;
  do {
    const page = await client.send(
      new DescribeDBClustersCommand({ Marker: marker }),
    );
    for (const c of page.DBClusters ?? []) {
      const id = c.DBClusterIdentifier;
      const endpoint = c.Endpoint;
      if (!id || !endpoint || !id.startsWith(prefix)) continue;
      out.push({ clusterId: id, endpoint, port: c.Port ?? 5432 });
    }
    marker = page.Marker;
  } while (marker);
  return out;
}

/**
 * Resolve the cluster master credential from Secrets Manager. Returns null when
 * the secret is missing/unreadable so the caller can fail soft (empty cluster).
 */
export async function resolveAdminCredential(
  stage: string,
): Promise<AdminCredential | null> {
  try {
    const { SecretsManagerClient, GetSecretValueCommand } =
      await import("@aws-sdk/client-secrets-manager");
    const sm = new SecretsManagerClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
    const res = await sm.send(
      new GetSecretValueCommand({ SecretId: adminDbSecretName(stage) }),
    );
    const parsed = JSON.parse(res.SecretString || "{}") as {
      username?: unknown;
      password?: unknown;
    };
    if (
      typeof parsed.username === "string" &&
      typeof parsed.password === "string" &&
      parsed.username &&
      parsed.password
    ) {
      return { username: parsed.username, password: parsed.password };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Open a fresh (uncached) pg client to a database on an internal cluster as the
 * master user. The caller owns the lifecycle (`client.end()`). TLS is enabled
 * but the server certificate is not verified — acceptable for this admin
 * enumeration/provisioning against the environment's own clusters.
 */
export async function openAdminClient(params: {
  host: string;
  port: number;
  database: string;
  credential: AdminCredential;
}): Promise<PgClientType> {
  const { Client } = await import("pg");
  const client = new Client({
    host: params.host,
    port: params.port,
    database: params.database,
    user: params.credential.username,
    password: params.credential.password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  await client.connect();
  return client;
}

/**
 * Enumerate the non-template, operator-visible databases on a cluster. Connects
 * to the `postgres` database as the master user. Excludes `postgres` and
 * `rdsadmin`; keeps `thinkwork` (offered via the built-in path).
 */
export async function enumerateDatabases(
  cluster: RawInternalCluster,
  credential: AdminCredential,
): Promise<string[]> {
  const client = await openAdminClient({
    host: cluster.endpoint,
    port: cluster.port,
    database: "postgres",
    credential,
  });
  try {
    const res = await client.query(
      `SELECT datname FROM pg_database
        WHERE NOT datistemplate AND datname NOT IN ('postgres', 'rdsadmin')
        ORDER BY datname`,
    );
    return res.rows.map((r: Record<string, unknown>) => String(r.datname));
  } finally {
    try {
      await client.end();
    } catch {
      // best-effort close
    }
  }
}

/** Which (endpoint, database) pairs the tenant already has an analyst row for. */
interface RegisteredCoverage {
  builtinExists: boolean;
  sourcedPairs: Set<string>;
}

function coverageKey(host: string, database: string): string {
  return `${host}::${database}`;
}

async function resolveRegisteredCoverage(
  tenantId: string,
  db: DbLike,
): Promise<RegisteredCoverage> {
  const rows = await db
    .select({
      slug: tenantMcpServers.slug,
      runtime_metadata: tenantMcpServers.runtime_metadata,
    })
    .from(tenantMcpServers)
    .where(eq(tenantMcpServers.tenant_id, tenantId));

  let builtinExists = false;
  const sourcedPairs = new Set<string>();
  for (const row of rows) {
    if (row.slug === "postgres-dev") builtinExists = true;
    const meta =
      row.runtime_metadata && typeof row.runtime_metadata === "object"
        ? (row.runtime_metadata as Record<string, unknown>)
        : null;
    const source =
      meta && typeof meta.analyst_source === "object" && meta.analyst_source
        ? (meta.analyst_source as Record<string, unknown>)
        : null;
    if (
      source &&
      typeof source.host === "string" &&
      typeof source.database === "string"
    ) {
      sourcedPairs.add(coverageKey(source.host, source.database));
    }
  }
  return { builtinExists, sourcedPairs };
}

export interface ListInternalClustersDeps {
  describeClusters?: (stage: string) => Promise<RawInternalCluster[]>;
  resolveAdmin?: (stage: string) => Promise<AdminCredential | null>;
  enumerate?: (
    cluster: RawInternalCluster,
    credential: AdminCredential,
  ) => Promise<string[]>;
  db?: DbLike;
  stage?: string;
}

/**
 * List the internal clusters + databases with per-database `alreadyRegistered`
 * accounting for the tenant. Fail-soft per cluster.
 */
export async function listInternalClusters(
  opts: { tenantId: string } & ListInternalClustersDeps,
): Promise<InternalCluster[]> {
  const db = opts.db ?? defaultDb;
  const stage = opts.stage ?? resolveStage();
  const describeClusters = opts.describeClusters ?? describeInternalClusters;
  const resolveAdmin = opts.resolveAdmin ?? resolveAdminCredential;
  const enumerate = opts.enumerate ?? enumerateDatabases;

  const [clusters, coverage, admin] = await Promise.all([
    describeClusters(stage),
    resolveRegisteredCoverage(opts.tenantId, db),
    resolveAdmin(stage),
  ]);

  const result: InternalCluster[] = [];
  for (const cluster of clusters) {
    let databases: string[] = [];
    if (admin) {
      try {
        databases = await enumerate(cluster, admin);
      } catch {
        // Fail soft — a cluster we cannot reach shows no databases.
        databases = [];
      }
    }
    result.push({
      clusterId: cluster.clusterId,
      endpoint: cluster.endpoint,
      port: cluster.port,
      databases: databases.map((name) => ({
        name,
        alreadyRegistered:
          coverage.sourcedPairs.has(coverageKey(cluster.endpoint, name)) ||
          (name === WORKSPACE_DATABASE && coverage.builtinExists),
      })),
    });
  }
  return result;
}
