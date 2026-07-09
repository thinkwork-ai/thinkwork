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

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import {
  agentProfiles,
  tenantMcpServers,
  tenants,
} from "@thinkwork/database-pg/schema";
import {
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
}

/** Thrown for caller-fixable input problems; the resolver maps to BAD_USER_INPUT. */
export class AnalystRegistrationInputError extends Error {}
/** Thrown when the source credential is not read-only; maps to BAD_USER_INPUT. */
export class AnalystRegistrationPostureError extends Error {}
/** Thrown when the slug is taken; the resolver maps to CONFLICT. */
export class AnalystRegistrationConflictError extends Error {}

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
 * Connect with the supplied credential, verify read-only posture, and
 * introspect the granted surface into a stored model. Always closes the
 * client. Throws {@link AnalystRegistrationPostureError} when the role holds
 * any non-SELECT grant or exposes no tables.
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

  const client = await openClient(input);
  try {
    // Read-only posture: ANY non-SELECT grant held by the connecting role is a
    // hard reject — we will not register a source we could write to.
    const writeGrants = await client.query(
      `SELECT table_name, privilege_type
         FROM information_schema.role_table_grants
        WHERE grantee = current_user AND privilege_type <> 'SELECT'`,
    );
    if (writeGrants.rows.length > 0) {
      const sample = writeGrants.rows
        .slice(0, 5)
        .map((r) => `${String(r.table_name)}:${String(r.privilege_type)}`)
        .join(", ");
      throw new AnalystRegistrationPostureError(
        `the supplied credential holds non-SELECT privileges (${sample}) — register a read-only (SELECT-only) role`,
      );
    }

    // Introspect the visible/granted surface. information_schema.columns is
    // privilege-filtered by Postgres to the columns the current_user can see,
    // so the visible surface IS the granted surface (we connect AS the reader
    // role). Array element types survive only in udt_name ('_text' → 'text
    // array'), mirroring the builtin probe's normalizer input.
    const columns = await client.query(
      `SELECT table_name, column_name,
              CASE WHEN data_type = 'ARRAY'
                   THEN ltrim(udt_name, '_') || ' array'
                   ELSE data_type END AS pg_type
         FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position`,
    );
    const model = storedModelFromColumns(
      columns.rows.map((r) => ({
        table: String(r.table_name),
        column: String(r.column_name),
        pgType: String(r.pg_type),
      })),
    );
    if (model.tables.length === 0) {
      throw new AnalystRegistrationPostureError(
        "the supplied credential can see no tables in the public schema — grant SELECT on at least one table",
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

export interface ExternalSourceRuntimeMeta {
  host: string;
  port: number;
  database: string;
  dbUser: string;
  tls: AnalystSourceTls;
  credentialSecretArn: string;
  tenantScoped: boolean;
}

/** The `runtime_metadata.analyst_source` block — sourceClaims minus slug. */
export function analystSourceRuntimeMetadata(
  input: NormalizedRegisterInput,
  credentialSecretArn: string,
): ExternalSourceRuntimeMeta {
  return {
    host: input.host,
    port: input.port,
    database: input.database,
    dbUser: input.dbUser,
    tls: input.tls,
    credentialSecretArn,
    tenantScoped: true,
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

// ---------------------------------------------------------------------------
// Analyst profile tool policy
// ---------------------------------------------------------------------------

/**
 * Union the new source slug into the tenant's analyst profile
 * `tool_policy.mcpServers` (mirrors refreshAnalystProfileFromSeed's union).
 * No-op-safe: absent profile is tolerated (a tenant may register a source
 * before opening the profiles surface — the slug is added the next time the
 * profile is seeded/refreshed, and dispatch reads servers from the registry
 * regardless).
 */
export async function appendSourceToAnalystProfile(opts: {
  tenantId: string;
  slug: string;
  db?: DbLike;
}): Promise<boolean> {
  const db = opts.db ?? defaultDb;
  const [row] = await db
    .select({ id: agentProfiles.id, tool_policy: agentProfiles.tool_policy })
    .from(agentProfiles)
    .where(
      and(
        eq(agentProfiles.tenant_id, opts.tenantId),
        eq(agentProfiles.built_in_key, "analyst"),
      ),
    )
    .limit(1);
  if (!row) return false;
  const current =
    row.tool_policy && typeof row.tool_policy === "object"
      ? (row.tool_policy as Record<string, unknown>)
      : {};
  const existingServers = Array.isArray(current.mcpServers)
    ? current.mcpServers.filter((x): x is string => typeof x === "string")
    : [];
  if (existingServers.includes(opts.slug)) return true;
  await db
    .update(agentProfiles)
    .set({
      tool_policy: {
        ...current,
        mcpServers: [...existingServers, opts.slug],
      },
      updated_at: new Date(),
    })
    .where(eq(agentProfiles.id, row.id));
  return true;
}
