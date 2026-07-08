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
 * Invoked by scripts/provision-analyst-connector.ts (no web UI in v1 —
 * R3: provisioning is scriptable end-to-end).
 */

import { and, eq } from "drizzle-orm";
import { tenantMcpServers } from "@thinkwork/database-pg/schema";

import { db as defaultDb } from "../../graphql/utils.js";
import { computeMcpUrlHash } from "../mcp-server-hash.js";

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
