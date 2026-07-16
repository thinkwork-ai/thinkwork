/**
 * Analyst multi-source registration core (THINK-239).
 *
 * Registers an EXTERNAL Postgres data source as a first-party analyst
 * connector, mirroring the builtin `postgres-dev` connector (THINK-228/230)
 * but pointed at a caller-supplied host + a per-source reader credential:
 *
 *   - a born-approved `tenant_mcp_servers` row whose URL is
 *     `<apiBase>/mcp/analyst/<slug>` (the sourced broker route), with the
 *     SAME broker service-credential auth_config as the builtin (one broker
 *     credential per stage) and a pinned url_hash;
 *   - the external source description on `runtime_metadata.analyst_source`
 *     (the signed sourceClaims shape MINUS slug), which dispatch and the
 *     reconciler read back to mint sourceClaims / probe the source;
 *   - a per-source reader credential in Secrets Manager at
 *     `thinkwork/<stage>/analyst/<tenantId>/<slug>-reader-credential`;
 *   - `model.json` + rendered `SCHEMA.md` in S3 under
 *     `tenants/<tenant-slug>/analyst-sources/<slug>/`.
 *
 * The ceremony connects with the supplied credential FIRST and refuses to
 * register anything unless the role is read-only (zero non-SELECT grants) and
 * exposes at least one table — so a mis-scoped credential fails before any
 * write.
 *
 * The pure/validation pieces live here (unit-testable); the resolver
 * (registerAnalystDataSource.mutation.ts) orders the effectful steps.
 */

import { randomUUID } from "node:crypto";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import { tenantMcpServers, tenants } from "@thinkwork/database-pg/schema";
import {
  ANALYST_DEFAULT_SOURCE_SCHEMA,
  renderStoredAnalystSchemaMarkdown,
  storedModelFromColumns,
  type StoredAnalystModel,
} from "@thinkwork/database-pg/analyst";
import { openExternalSourceClient } from "@thinkwork/lambda/analyst-reader-db";

import { db as defaultDb } from "../../graphql/utils.js";
import { computeMcpUrlHash } from "../mcp-server-hash.js";
import { analystConnectorAuthConfig } from "./provision-connector.js";
import type { AnalystSourceTls } from "@thinkwork/lambda/analyst-caller-context";

type DbLike = typeof defaultDb;

export const RESERVED_ANALYST_SOURCE_SLUGS: ReadonlySet<string> = new Set([
  "postgres-dev",
]);

/** Same shape the broker/dispatch enforce for a sourced route path. */
export const ANALYST_SOURCE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}$/;

export type AnalystSourceTlsInput = "VERIFY_FULL" | "REQUIRED";

export interface RegisterAnalystDataSourceInput {
  name: string;
  slug: string;
  host: string;
  port: number;
  database: string;
  dbUser: string;
  password: string;
  tls?: AnalystSourceTlsInput | null;
  /** Selected schema (THINK-283). Omitted/null defaults to `public`. */
  schema?: string | null;
}

export interface NormalizedRegisterInput {
  name: string;
  slug: string;
  host: string;
  port: number;
  database: string;
  dbUser: string;
  password: string;
  tls: AnalystSourceTls;
  /** Always present after normalization; raw catalog case preserved. */
  schema: string;
}

/** Thrown for caller-fixable input problems; the resolver maps to BAD_USER_INPUT. */
export class AnalystRegistrationInputError extends Error {}
/** Thrown when the source credential is not read-only; maps to BAD_USER_INPUT. */
export class AnalystRegistrationPostureError extends Error {}
/** Thrown when the slug is taken; the resolver maps to CONFLICT. */
export class AnalystRegistrationConflictError extends Error {}

/**
 * PostgreSQL-owned schemas are never selectable analyst surfaces
 * (THINK-283). `pg_temp_*`/`pg_toast*` fall under the `pg_` prefix.
 */
export function isSystemPgSchema(schema: string): boolean {
  return schema === "information_schema" || schema.startsWith("pg_");
}

/**
 * Normalize a caller-supplied schema (THINK-283): omitted/null → `public`
 * (legacy contract), everything else trimmed with exact catalog case
 * preserved — NEVER lowercased or silently replaced. An explicitly supplied
 * empty/whitespace/NUL-bearing or PostgreSQL-system value is an input error,
 * not a fallback to `public`.
 */
export function normalizeAnalystSourceSchema(
  raw: string | null | undefined,
): string {
  if (raw === undefined || raw === null) return ANALYST_DEFAULT_SOURCE_SCHEMA;
  const schema = raw.trim();
  if (!schema) {
    throw new AnalystRegistrationInputError(
      "schema, when supplied, must be a non-empty PostgreSQL schema name",
    );
  }
  if (schema.includes("\0")) {
    throw new AnalystRegistrationInputError(
      "schema contains invalid characters",
    );
  }
  if (isSystemPgSchema(schema)) {
    throw new AnalystRegistrationInputError(
      `schema "${schema}" is a PostgreSQL system schema and cannot be registered as an analyst source`,
    );
  }
  return schema;
}

export function tlsFromInput(
  input: AnalystSourceTlsInput | null | undefined,
): AnalystSourceTls {
  return input === "REQUIRED" ? "required" : "verify-full";
}

/** Validate + normalize the caller input. Pure — no DB. */
export function validateRegisterInput(
  input: RegisterAnalystDataSourceInput,
): NormalizedRegisterInput {
  const name = (input.name ?? "").trim();
  if (!name) {
    throw new AnalystRegistrationInputError("name is required");
  }
  const slug = (input.slug ?? "").trim();
  if (!ANALYST_SOURCE_SLUG_PATTERN.test(slug)) {
    throw new AnalystRegistrationInputError(
      `slug "${slug}" is invalid — must match ${ANALYST_SOURCE_SLUG_PATTERN.source} ` +
        "(lowercase letters/digits/hyphens, 2–39 chars, not starting with a hyphen).",
    );
  }
  if (RESERVED_ANALYST_SOURCE_SLUGS.has(slug)) {
    throw new AnalystRegistrationInputError(
      `slug "${slug}" is reserved for a built-in data source — choose another.`,
    );
  }
  const host = (input.host ?? "").trim();
  if (!host) throw new AnalystRegistrationInputError("host is required");
  const database = (input.database ?? "").trim();
  if (!database)
    throw new AnalystRegistrationInputError("database is required");
  const dbUser = (input.dbUser ?? "").trim();
  if (!dbUser) throw new AnalystRegistrationInputError("dbUser is required");
  const password = input.password ?? "";
  if (!password)
    throw new AnalystRegistrationInputError("password is required");
  const port = Number(input.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new AnalystRegistrationInputError(
      `port ${input.port} is not a valid TCP port`,
    );
  }
  return {
    name,
    slug,
    host,
    port,
    database,
    dbUser,
    password,
    tls: tlsFromInput(input.tls),
    schema: normalizeAnalystSourceSchema(input.schema),
  };
}

/** Reject a slug already registered for the tenant (any status). */
export async function assertSlugAvailable(opts: {
  tenantId: string;
  slug: string;
  db?: DbLike;
}): Promise<void> {
  const db = opts.db ?? defaultDb;
  const [existing] = await db
    .select({ id: tenantMcpServers.id })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.tenant_id, opts.tenantId),
        eq(tenantMcpServers.slug, opts.slug),
      ),
    )
    .limit(1);
  if (existing) {
    throw new AnalystRegistrationConflictError(
      `a data source with slug "${opts.slug}" is already registered for this tenant`,
    );
  }
}

/** Minimal pg.Client surface the probe/introspection need (mockable in tests). */
export interface RegisterProbeClient {
  query(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

export interface ProbeAndModelDeps {
  /** Open the client. Default: openExternalSourceClient (real TLS connect). */
  openClient?: (
    params: NormalizedRegisterInput,
  ) => Promise<RegisterProbeClient>;
}

/**
 * The credential's effective write surface anywhere in the database
 * (THINK-283). Privilege functions (not role_table_grants) so role
 * membership and PUBLIC grants are included; unqualified has_table_privilege
 * evaluates as current_user (we connect AS the reader).
 */
const PROBE_EFFECTIVE_WRITE_SQL = `SELECT n.nspname AS schema, c.relname AS name
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname <> 'information_schema'
    AND n.nspname NOT LIKE 'pg\\_%'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND has_table_privilege(c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE')
  ORDER BY n.nspname, c.relname
  LIMIT 20`;

/**
 * The credential's effective SELECT surface outside the contract: anything
 * readable that is NOT an ordinary base table of the selected schema — other
 * user schemas, or views/matviews/foreign tables inside the selection
 * (unsupported relation kinds; a view can read another schema under its
 * owner's privileges).
 */
const PROBE_OUT_OF_SCHEMA_SQL = `SELECT n.nspname AS schema, c.relname AS name, c.relkind::text AS relkind
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname <> 'information_schema'
    AND n.nspname NOT LIKE 'pg\\_%'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND has_table_privilege(c.oid, 'SELECT')
    AND NOT (n.nspname = $1 AND c.relkind IN ('r', 'p'))
  ORDER BY n.nspname, c.relname
  LIMIT 20`;

/** CREATE on any user schema lets the role escape the read-only posture. */
const PROBE_SCHEMA_CREATE_SQL = `SELECT n.nspname AS schema
   FROM pg_namespace n
  WHERE n.nspname <> 'information_schema'
    AND n.nspname NOT LIKE 'pg\\_%'
    AND has_schema_privilege(n.oid, 'CREATE')
  ORDER BY n.nspname
  LIMIT 20`;

/**
 * Column introspection restricted to the selected schema's ordinary base
 * tables (information_schema table_type BASE TABLE covers relkind r and p;
 * views/foreign tables are excluded by type). Array element types survive
 * only in udt_name ('_text' → 'text array'), mirroring the builtin probe's
 * normalizer input.
 */
const PROBE_BASE_TABLE_COLUMNS_SQL = `SELECT col.table_name, col.column_name,
        CASE WHEN col.data_type = 'ARRAY'
             THEN ltrim(col.udt_name, '_') || ' array'
             ELSE col.data_type END AS pg_type
   FROM information_schema.columns col
   JOIN information_schema.tables t
     ON t.table_schema = col.table_schema AND t.table_name = col.table_name
  WHERE col.table_schema = $1 AND t.table_type = 'BASE TABLE'
  ORDER BY col.table_name, col.ordinal_position`;

/**
 * Connect with the supplied credential, verify the read-only single-schema
 * posture on the EFFECTIVE privilege surface, and introspect the selected
 * schema's base tables into a stored model (THINK-283). Always closes the
 * client. Throws {@link AnalystRegistrationPostureError} with a
 * schema-specific diagnostic when the schema is missing/empty/no-SELECT or
 * the credential's surface exceeds the one-schema contract — ThinkWork never
 * expands or narrows an external role's grants, so remediation is the DBA's.
 */
export async function probeAndModelExternalSource(
  input: NormalizedRegisterInput,
  deps: ProbeAndModelDeps = {},
): Promise<StoredAnalystModel> {
  const openClient =
    deps.openClient ??
    ((params: NormalizedRegisterInput) =>
      openExternalSourceClient({
        host: params.host,
        port: params.port,
        database: params.database,
        dbUser: params.dbUser,
        tls: params.tls,
        password: params.password,
      }) as unknown as Promise<RegisterProbeClient>);

  const schema = input.schema;
  const client = await openClient(input);
  try {
    // Selected schema must exist (visible in the catalog regardless of
    // privileges — pg_namespace is world-readable).
    const schemaRow = await client.query(
      "SELECT 1 FROM pg_namespace WHERE nspname = $1",
      [schema],
    );
    if (schemaRow.rows.length === 0) {
      throw new AnalystRegistrationPostureError(
        `schema "${schema}" does not exist in database "${input.database}" — ` +
          "check the schema name (exact case) or have the DBA create it",
      );
    }

    // Read-only posture on the EFFECTIVE surface: any write capability,
    // anywhere, through any role membership or PUBLIC grant, is a hard
    // reject — we will not register a source we could write to.
    const writable = await client.query(PROBE_EFFECTIVE_WRITE_SQL);
    if (writable.rows.length > 0) {
      const sample = writable.rows
        .slice(0, 5)
        .map((r) => `${String(r.schema)}.${String(r.name)}`)
        .join(", ");
      throw new AnalystRegistrationPostureError(
        `the supplied credential holds effective write privileges (${sample}) — ` +
          "register a read-only (SELECT-only) role",
      );
    }
    const creatable = await client.query(PROBE_SCHEMA_CREATE_SQL);
    if (creatable.rows.length > 0) {
      const sample = creatable.rows
        .slice(0, 5)
        .map((r) => String(r.schema))
        .join(", ");
      throw new AnalystRegistrationPostureError(
        `the supplied credential can CREATE in schema(s) ${sample} — ` +
          "have the DBA revoke CREATE so the role cannot escape its read-only posture",
      );
    }

    // Single-schema isolation (THINK-283): the credential must not read
    // anything outside the selected schema's base tables. Registration must
    // not advertise an isolation the database role does not enforce.
    const outOfSchema = await client.query(PROBE_OUT_OF_SCHEMA_SQL, [schema]);
    if (outOfSchema.rows.length > 0) {
      const sample = outOfSchema.rows
        .slice(0, 5)
        .map(
          (r) => `${String(r.schema)}.${String(r.name)} (${String(r.relkind)})`,
        )
        .join(", ");
      throw new AnalystRegistrationPostureError(
        `the supplied credential can read objects outside schema "${schema}"'s base tables ` +
          `(${sample}). An analyst source is scoped to exactly one schema's ordinary tables — ` +
          "have the DBA revoke the extra grants (least privilege) and retry",
      );
    }

    // Introspect the granted base-table surface of the selected schema.
    // information_schema.columns is privilege-filtered to what current_user
    // can see, so the visible surface IS the granted surface.
    const columns = await client.query(PROBE_BASE_TABLE_COLUMNS_SQL, [schema]);
    const model = storedModelFromColumns(
      columns.rows.map((r) => ({
        schema,
        table: String(r.table_name),
        column: String(r.column_name),
        pgType: String(r.pg_type),
      })),
    );
    if (model.tables.length === 0) {
      throw new AnalystRegistrationPostureError(
        `the supplied credential can see no base tables in schema "${schema}" — ` +
          "grant SELECT on at least one ordinary table in that schema (or select a different schema)",
      );
    }
    return model;
  } finally {
    try {
      await client.end();
    } catch {
      // best-effort close
    }
  }
}

// ---------------------------------------------------------------------------
// Credential secret
// ---------------------------------------------------------------------------

export function analystSourceCredentialSecretName(opts: {
  stage?: string | null;
  tenantId: string;
  slug: string;
}): string {
  const stage = opts.stage || process.env.STAGE || "dev";
  return `thinkwork/${stage}/analyst/${opts.tenantId}/${opts.slug}-reader-credential`;
}

/**
 * Create-or-update the per-source reader credential secret. Value is JSON
 * `{password, dbUser, host}`. Returns the secret ARN (or name on update).
 */
export async function writeSourceCredentialSecret(opts: {
  secretName: string;
  password: string;
  dbUser: string;
  host: string;
  sm?: {
    send: (command: unknown) => Promise<{ ARN?: string }>;
  };
}): Promise<string> {
  const { SecretsManagerClient, CreateSecretCommand, UpdateSecretCommand } =
    await import("@aws-sdk/client-secrets-manager");
  const sm =
    opts.sm ??
    new SecretsManagerClient({ region: process.env.AWS_REGION || "us-east-1" });
  const SecretString = JSON.stringify({
    password: opts.password,
    dbUser: opts.dbUser,
    host: opts.host,
  });
  try {
    const created = await sm.send(
      new CreateSecretCommand({ Name: opts.secretName, SecretString }),
    );
    return created.ARN || opts.secretName;
  } catch (err) {
    if ((err as { name?: string })?.name !== "ResourceExistsException")
      throw err;
    await sm.send(
      new UpdateSecretCommand({ SecretId: opts.secretName, SecretString }),
    );
    return opts.secretName;
  }
}

// ---------------------------------------------------------------------------
// S3 model + schema
// ---------------------------------------------------------------------------

export async function resolveTenantSlug(
  tenantId: string,
  db: DbLike = defaultDb,
): Promise<string> {
  const [row] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!row?.slug) {
    throw new Error(
      `tenant ${tenantId} has no slug — cannot resolve its S3 prefix`,
    );
  }
  return row.slug;
}

export function analystSourceS3Prefix(
  tenantSlug: string,
  slug: string,
): string {
  return `tenants/${tenantSlug}/analyst-sources/${slug}/`;
}

export async function writeSourceModelToS3(opts: {
  bucket: string;
  tenantSlug: string;
  slug: string;
  model: StoredAnalystModel;
  schemaMarkdown: string;
  s3?: Pick<S3Client, "send">;
}): Promise<{ modelKey: string; schemaKey: string }> {
  const s3 =
    opts.s3 ??
    new S3Client({
      region:
        process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
    });
  const prefix = analystSourceS3Prefix(opts.tenantSlug, opts.slug);
  const modelKey = `${prefix}model.json`;
  const schemaKey = `${prefix}SCHEMA.md`;
  await s3.send(
    new PutObjectCommand({
      Bucket: opts.bucket,
      Key: modelKey,
      Body: JSON.stringify(opts.model, null, 2),
      ContentType: "application/json",
    }),
  );
  await s3.send(
    new PutObjectCommand({
      Bucket: opts.bucket,
      Key: schemaKey,
      Body: opts.schemaMarkdown,
      ContentType: "text/markdown; charset=utf-8",
    }),
  );
  return { modelKey, schemaKey };
}

// ---------------------------------------------------------------------------
// Registry row
// ---------------------------------------------------------------------------

/** How a sourced connector was registered (THINK-283). */
export type AnalystSourceKind = "external" | "internal";

export interface ExternalSourceRuntimeMeta {
  host: string;
  port: number;
  database: string;
  dbUser: string;
  tls: AnalystSourceTls;
  credentialSecretArn: string;
  tenantScoped: boolean;
  /** Selected schema, raw catalog case (THINK-283). */
  schema: string;
  /** external (operator credential) or internal (auto-provisioned reader). */
  kind: AnalystSourceKind;
  /** Internal sources: DBClusterIdentifier for refresh routing (THINK-283). */
  clusterId?: string;
  /**
   * Opaque generation stamped at registration; advanced only by a successful
   * explicit refresh. Signed claims carry it; the broker requires equality.
   */
  sourceGeneration: string;
}

/** A fresh opaque source generation (registration and each refresh commit). */
export function newAnalystSourceGeneration(): string {
  return randomUUID();
}

export interface AnalystSourceMetadataOpts {
  kind: AnalystSourceKind;
  clusterId?: string;
  sourceGeneration?: string;
}

/** The `runtime_metadata.analyst_source` block — sourceClaims minus slug. */
export function analystSourceRuntimeMetadata(
  input: NormalizedRegisterInput,
  credentialSecretArn: string,
  opts: AnalystSourceMetadataOpts,
): ExternalSourceRuntimeMeta {
  return {
    host: input.host,
    port: input.port,
    database: input.database,
    dbUser: input.dbUser,
    tls: input.tls,
    credentialSecretArn,
    tenantScoped: true,
    schema: input.schema,
    kind: opts.kind,
    ...(opts.clusterId ? { clusterId: opts.clusterId } : {}),
    sourceGeneration: opts.sourceGeneration ?? newAnalystSourceGeneration(),
  };
}

export function externalSourceUrl(apiBase: string, slug: string): string {
  return `${apiBase.replace(/\/+$/, "")}/mcp/analyst/${slug}`;
}

export function externalSourceRowValues(opts: {
  tenantId: string;
  input: NormalizedRegisterInput;
  apiBase: string;
  brokerSecretRef: string;
  credentialSecretArn: string;
  source: AnalystSourceMetadataOpts;
}) {
  const url = externalSourceUrl(opts.apiBase, opts.input.slug);
  // Same broker service-credential auth_config as the builtin connector —
  // one broker credential per stage; the sourced route binds the source via
  // the signed sourceClaims, not a per-source bearer.
  const auth_config = analystConnectorAuthConfig(opts.brokerSecretRef);
  return {
    tenant_id: opts.tenantId,
    name: opts.input.name,
    slug: opts.input.slug,
    url,
    transport: "streamable-http",
    auth_type: "service_credential",
    auth_config,
    enabled: true,
    management_source: "manual",
    status: "approved",
    url_hash: computeMcpUrlHash(url, auth_config),
    approved_at: new Date(),
    runtime_metadata: {
      analyst_source: analystSourceRuntimeMetadata(
        opts.input,
        opts.credentialSecretArn,
        opts.source,
      ),
    },
  };
}

export async function insertExternalSourceRow(opts: {
  tenantId: string;
  input: NormalizedRegisterInput;
  apiBase: string;
  brokerSecretRef: string;
  credentialSecretArn: string;
  source: AnalystSourceMetadataOpts;
  db?: DbLike;
}): Promise<{ id: string }> {
  const db = opts.db ?? defaultDb;
  const values = externalSourceRowValues(opts);
  const [inserted] = await db
    .insert(tenantMcpServers)
    .values(values)
    .returning({ id: tenantMcpServers.id });
  return { id: inserted!.id };
}
