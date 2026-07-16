/**
 * Analyst connector provisioning core (THINK-228 U4).
 *
 * The dev Postgres data source registers as a first-party Postgres
 * connector: an APPROVED `tenant_mcp_servers` row pointing at the analyst
 * query-broker Lambda (POST /mcp/analyst), with `service_credential` auth
 * whose auth_config holds only a Secrets Manager reference (never a
 * value). Mirrors the plugin-provisioning precedent
 * (packages/api/src/lib/plugins/handlers/mcp.ts): first-party rows are
 * born `approved` with a pinned `url_hash` (KTD4).
 *
 * Because SI-5 reverts any url/auth_config mutation on an approved row to
 * `pending` — and hash drift between the stored `url_hash` and the live
 * (url, auth_config) excludes the row from buildMcpConfigs — rotation MUST
 * go through {@link provisionAnalystConnector} with `reApprove: true`,
 * which rewrites url/auth_config, recomputes the hash, and restamps
 * approval in one write. A raw UPDATE would silently brick the connector.
 *
 * Invoked by scripts/provision-analyst-connector.mts (no web UI in v1 —
 * R3: provisioning is scriptable end-to-end).
 */

import { and, eq } from "drizzle-orm";
import {
  tenantCredentials,
  tenantMcpServers,
} from "@thinkwork/database-pg/schema";

import { db as defaultDb } from "../../graphql/utils.js";
import { computeMcpUrlHash } from "../mcp-server-hash.js";
import { RDS_IAM_REQUIRED_METADATA_FIELDS } from "../tenant-credentials/secret-store.js";

type DbLike = typeof defaultDb;

export const ANALYST_CONNECTOR_SLUG = "postgres-dev";
export const ANALYST_CONNECTOR_NAME = "Postgres (dev)";

/**
 * The service_credential auth_config shape resolveServiceCredentialAuth
 * expects: a secretRef plus header bindings into the secret's JSON. The
 * broker secret value is `{token, tenantId}`; binding `token` behind
 * `Bearer ` makes every resolved caller present `Authorization: Bearer
 * <token>` — exactly what the broker validates.
 */
export function analystConnectorAuthConfig(
  secretRef: string,
): Record<string, unknown> {
  return {
    secretRef,
    headers: [
      { name: "Authorization", secretJsonKey: "token", valuePrefix: "Bearer " },
    ],
  };
}

export interface AnalystConnectorInput {
  tenantId: string;
  /** Absolute broker endpoint, e.g. https://<api-host>/mcp/analyst */
  brokerUrl: string;
  /** Secrets Manager ARN of the broker credential ({token, tenantId}). */
  secretRef: string;
}

/** The full insert/update column values for the connector row. */
export function analystConnectorRowValues(input: AnalystConnectorInput) {
  const auth_config = analystConnectorAuthConfig(input.secretRef);
  return {
    tenant_id: input.tenantId,
    name: ANALYST_CONNECTOR_NAME,
    slug: ANALYST_CONNECTOR_SLUG,
    url: input.brokerUrl,
    transport: "streamable-http",
    auth_type: "service_credential",
    auth_config,
    enabled: true,
    management_source: "manual",
    status: "approved",
    url_hash: computeMcpUrlHash(input.brokerUrl, auth_config),
    approved_at: new Date(),
  };
}

/**
 * Ensure the broker credential secret holds a value: JSON {token, tenantId}.
 * Generates a token on first run; preserves the existing one after that
 * (`rotate: true` mints a new token — every cached caller token dies, so the
 * script insists on --re-approve alongside it). Lives here rather than in
 * the tsx script because this package declares the Secrets Manager SDK.
 */
export async function ensureAnalystBrokerSecret(input: {
  secretRef: string;
  tenantId: string;
  rotate?: boolean;
}): Promise<"unchanged" | "created" | "updated"> {
  const { randomBytes } = await import("node:crypto");
  const { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand } =
    await import("@aws-sdk/client-secrets-manager");
  const sm = new SecretsManagerClient({
    region: process.env.AWS_REGION || "us-east-1",
  });
  let existing: { token?: string; tenantId?: string } = {};
  try {
    const current = await sm.send(
      new GetSecretValueCommand({ SecretId: input.secretRef }),
    );
    existing = JSON.parse(current.SecretString || "{}") as typeof existing;
  } catch {
    // No value yet (fresh container) — write one below.
  }
  if (!input.rotate && existing.token && existing.tenantId === input.tenantId) {
    return "unchanged";
  }
  const token =
    input.rotate || !existing.token
      ? randomBytes(32).toString("hex")
      : existing.token;
  await sm.send(
    new PutSecretValueCommand({
      SecretId: input.secretRef,
      SecretString: JSON.stringify({ token, tenantId: input.tenantId }),
    }),
  );
  return input.rotate || !existing.token ? "created" : "updated";
}

/**
 * Mint the broker credential ONLY when the secret has no value yet.
 *
 * The sourced register ceremonies depend on this credential resolving at
 * dispatch (`resolveServiceCredentialAuth` on the row's secretRef) — on a
 * stage where the built-in connector was never provisioned, the Terraform
 * shell secret has zero versions and every registered source is silently
 * withheld as `credential_missing` (observed live on McPherson 2026-07-14).
 * Unlike `ensureAnalystBrokerSecret`, an existing value is NEVER touched:
 * overwriting would re-scope `tenantId` to the caller on multi-tenant
 * stages, breaking the other tenant's legacy-bearer builtin traffic.
 */
export async function ensureAnalystBrokerSecretValue(input: {
  secretRef: string;
  tenantId: string;
  sm?: { send: (command: unknown) => Promise<{ SecretString?: string }> };
}): Promise<"unchanged" | "created"> {
  const { randomBytes } = await import("node:crypto");
  const { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand } =
    await import("@aws-sdk/client-secrets-manager");
  const sm =
    input.sm ??
    new SecretsManagerClient({ region: process.env.AWS_REGION || "us-east-1" });
  try {
    const current = await sm.send(
      new GetSecretValueCommand({ SecretId: input.secretRef }),
    );
    const existing = JSON.parse(current.SecretString || "{}") as {
      token?: string;
    };
    if (existing.token) return "unchanged";
  } catch (err) {
    // Only "no value yet" is mintable; anything else (denied, missing
    // secret shell, throttle) must fail the registration loudly instead
    // of shipping a source that can never authenticate.
    if ((err as { name?: string })?.name !== "ResourceNotFoundException") {
      throw err;
    }
  }
  await sm.send(
    new PutSecretValueCommand({
      SecretId: input.secretRef,
      SecretString: JSON.stringify({
        token: randomBytes(32).toString("hex"),
        tenantId: input.tenantId,
      }),
    }),
  );
  return "created";
}

/**
 * Resolve + validate the provisioning inputs from an env map. Fails with
 * one clear message naming everything missing (the script must not leave
 * a partial row behind on a misconfigured run).
 */
export function resolveAnalystProvisionConfig(
  env: Record<string, string | undefined>,
): AnalystConnectorInput {
  const tenantId = env.TENANT_ID?.trim();
  const secretRef = env.ANALYST_BROKER_SECRET_ARN?.trim();
  const brokerUrl =
    env.ANALYST_BROKER_URL?.trim() ||
    (env.THINKWORK_API_URL?.trim()
      ? `${env.THINKWORK_API_URL.trim().replace(/\/+$/, "")}/mcp/analyst`
      : undefined);

  const missing: string[] = [];
  if (!tenantId) missing.push("TENANT_ID");
  if (!brokerUrl) missing.push("ANALYST_BROKER_URL (or THINKWORK_API_URL)");
  if (!secretRef) missing.push("ANALYST_BROKER_SECRET_ARN");
  if (missing.length > 0) {
    throw new Error(
      `provision-analyst-connector: missing required env: ${missing.join(", ")}. ` +
        "Nothing was written.",
    );
  }
  return { tenantId: tenantId!, brokerUrl: brokerUrl!, secretRef: secretRef! };
}

export const ANALYST_RDS_IAM_CREDENTIAL_SLUG = "analyst-rds-iam";

export interface AnalystRdsIamCredentialInput {
  tenantId: string;
  clusterEndpoint: string;
  port: number;
  database: string;
  dbUser: string;
  clusterResourceId: string;
}

/**
 * Resolve the optional rds_iam credential inputs from env (THINK-229 U1 /
 * R2). Returns null when the IAM env block isn't wired yet (pre-Terraform
 * runs keep working); throws when it's partially wired — a half-seeded
 * credential row would misdescribe the connect chain.
 */
export function resolveAnalystRdsIamConfig(
  env: Record<string, string | undefined>,
  tenantId: string,
): AnalystRdsIamCredentialInput | null {
  const clusterEndpoint = env.ANALYST_DB_CLUSTER_ENDPOINT?.trim();
  const clusterResourceId = env.ANALYST_DB_CLUSTER_RESOURCE_ID?.trim();
  if (!clusterEndpoint && !clusterResourceId) return null;
  const missing: string[] = [];
  if (!clusterEndpoint) missing.push("ANALYST_DB_CLUSTER_ENDPOINT");
  if (!clusterResourceId) missing.push("ANALYST_DB_CLUSTER_RESOURCE_ID");
  if (missing.length > 0) {
    throw new Error(
      `provision-analyst-connector: partial rds_iam env — missing ${missing.join(", ")}. ` +
        "Wire both (or neither) before seeding the credential row.",
    );
  }
  const port = Number.parseInt(env.ANALYST_DB_PORT || "5432", 10);
  return {
    tenantId,
    clusterEndpoint: clusterEndpoint!,
    port: Number.isFinite(port) && port > 0 ? port : 5432,
    database: env.ANALYST_DB_NAME?.trim() || "thinkwork",
    dbUser: env.ANALYST_DB_USER?.trim() || "analyst_reader",
    clusterResourceId: clusterResourceId!,
  };
}

/**
 * Idempotent upsert of the operator-facing `rds_iam` credential row
 * (THINK-229 U1 / R2, KTD1): metadata only, empty secret_ref sentinel —
 * no long-lived secret exists for this kind. The broker reads its connect
 * config from Terraform-supplied env; this row is the record the signed
 * sidecar's credentialRefs points at.
 */
export async function ensureAnalystRdsIamCredential(
  input: AnalystRdsIamCredentialInput & { db?: DbLike },
): Promise<"created" | "updated" | "unchanged"> {
  const db = input.db ?? defaultDb;
  const metadata = {
    clusterEndpoint: input.clusterEndpoint,
    port: input.port,
    database: input.database,
    dbUser: input.dbUser,
    clusterResourceId: input.clusterResourceId,
  };

  // Kind-filtered match: a slug-colliding credential of another kind must
  // never be overwritten into a chimera (foreign kind + live secret_ref +
  // rds_iam metadata) — collide loudly instead.
  const [existing] = await db
    .select({
      id: tenantCredentials.id,
      kind: tenantCredentials.kind,
      metadata_json: tenantCredentials.metadata_json,
      status: tenantCredentials.status,
    })
    .from(tenantCredentials)
    .where(
      and(
        eq(tenantCredentials.tenant_id, input.tenantId),
        eq(tenantCredentials.slug, ANALYST_RDS_IAM_CREDENTIAL_SLUG),
      ),
    )
    .limit(1);

  if (existing && existing.kind !== "rds_iam") {
    throw new Error(
      `tenant credential slug "${ANALYST_RDS_IAM_CREDENTIAL_SLUG}" is taken by a ` +
        `${existing.kind} credential — refusing to overwrite it.`,
    );
  }

  if (!existing) {
    await db.insert(tenantCredentials).values({
      tenant_id: input.tenantId,
      display_name: "Analyst reader (RDS IAM)",
      slug: ANALYST_RDS_IAM_CREDENTIAL_SLUG,
      kind: "rds_iam",
      status: "active",
      secret_ref: "",
      schema_json: {},
      metadata_json: metadata,
    });
    return "created";
  }

  // Field-by-field compare — jsonb normalizes key order, so stringified
  // equality would report "updated" on every re-run.
  const existingMeta = (existing.metadata_json ?? {}) as Record<
    string,
    unknown
  >;
  const unchanged =
    existing.status === "active" &&
    RDS_IAM_REQUIRED_METADATA_FIELDS.every(
      (field) => existingMeta[field] === metadata[field],
    );
  if (unchanged) return "unchanged";

  // Re-provisioning is the sanctioned control plane for this row —
  // reactivating a deleted/disabled row is deliberate (and clears
  // deleted_at so the row is not active-but-deleted).
  await db
    .update(tenantCredentials)
    .set({
      metadata_json: metadata,
      status: "active",
      deleted_at: null,
      updated_at: new Date(),
    })
    .where(eq(tenantCredentials.id, existing.id));
  return "updated";
}

export type ProvisionOutcome =
  | { action: "created"; id: string }
  | { action: "unchanged"; id: string }
  | { action: "re_approved"; id: string };

/**
 * Idempotent seed (KTD4). Re-running with identical inputs is a no-op.
 * A url/secretRef change on an existing row requires `reApprove: true`
 * (the scripted answer to SI-5 with no approval UI); without it the
 * function throws rather than leaving a hash-drifted row behind.
 */
export async function provisionAnalystConnector(
  input: AnalystConnectorInput & { reApprove?: boolean; db?: DbLike },
): Promise<ProvisionOutcome> {
  const db = input.db ?? defaultDb;
  const values = analystConnectorRowValues(input);

  const [existing] = await db
    .select({
      id: tenantMcpServers.id,
      url: tenantMcpServers.url,
      url_hash: tenantMcpServers.url_hash,
      status: tenantMcpServers.status,
      auth_config: tenantMcpServers.auth_config,
    })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.tenant_id, input.tenantId),
        eq(tenantMcpServers.slug, ANALYST_CONNECTOR_SLUG),
      ),
    )
    .limit(1);

  if (!existing) {
    const [inserted] = await db
      .insert(tenantMcpServers)
      .values(values)
      .returning({ id: tenantMcpServers.id });
    return { action: "created", id: inserted!.id };
  }

  const unchanged =
    existing.url === values.url &&
    existing.url_hash === values.url_hash &&
    existing.status === "approved";
  if (unchanged) {
    return { action: "unchanged", id: existing.id };
  }

  if (!input.reApprove) {
    throw new Error(
      `analyst connector "${ANALYST_CONNECTOR_SLUG}" already exists for tenant ` +
        `${input.tenantId} with a different url/auth_config or non-approved ` +
        `status (stored: ${existing.status}, url: ${existing.url}). ` +
        "Re-run with --re-approve to rewrite it and restamp approval (SI-5).",
    );
  }

  await db
    .update(tenantMcpServers)
    .set({ ...values, approved_by: null, updated_at: new Date() })
    .where(eq(tenantMcpServers.id, existing.id));
  return { action: "re_approved", id: existing.id };
}
