/**
 * External confidential capability clients (THINK-280 U8).
 *
 * Operator-only. Each client maps ONE-TO-ONE to an ACTIVE service principal and
 * is permitted EXACTLY the capabilities resource + `capabilities:search` scope.
 * The generated secret is revealed ONCE (create / rotate) and stored only as a
 * slow hash. Revocation and rotation invalidate future tokens; the read path
 * (mcp-capability-search) re-checks client + principal status so revocation is
 * fail-closed at read time regardless of any outstanding token.
 *
 * Public dynamic registration CANNOT reach this path — it lives behind the
 * operator GraphQL authz gate, never `/mcp/oauth/register`.
 */

import type { GraphQLContext } from "../../context.js";
import { and, db, eq } from "../../utils.js";
import { getConfig } from "@thinkwork/runtime-config";
import {
  capabilityExternalClients,
  tenantServicePrincipals,
} from "@thinkwork/database-pg/schema";
import { randomBytes } from "node:crypto";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import {
  generateClientSecret,
  hashClientSecret,
} from "../../../lib/mcp-oauth/client-secret.js";
import {
  emitRuntimeAuditEvent,
  resolveRuntimeActor,
} from "./capabilityRuntime.shared.js";
import type { TenantServicePrincipalRowLike } from "./capabilityRuntime.shared.js";

const SEARCH_SCOPE = "capabilities:search";

type ExternalClientRow = typeof capabilityExternalClients.$inferSelect;

/**
 * The capabilities MCP resource URL a confidential client is bound to. Derived
 * from the deployed API base (the MCP OAuth callback shares that base) so the
 * stored audience matches what the token endpoint validates at runtime.
 */
function capabilitiesResourceUrl(): string {
  const explicit = getConfig("MCP_CAPABILITIES_RESOURCE_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  const callback = getConfig("MCP_OAUTH_CALLBACK_URL") || "";
  const base = callback.replace(/\/mcp\/oauth\/callback\/?$/, "");
  return `${base.replace(/\/+$/, "")}/mcp/capabilities`;
}

function clientToGql(
  row: ExternalClientRow,
  revealedSecret?: string,
): Record<string, unknown> {
  // Explicit field list — client_secret_hash is DELIBERATELY absent so the
  // at-rest hash never crosses the GraphQL boundary. The plaintext secret is
  // only ever present on the create/rotate response, never on a list read.
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clientId: row.client_id,
    servicePrincipalId: row.service_principal_id,
    allowedResource: row.allowed_resource,
    allowedScopes: Array.isArray(row.allowed_scopes_json)
      ? (row.allowed_scopes_json as unknown[]).filter(
          (s): s is string => typeof s === "string",
        )
      : [],
    status: row.status,
    createdAt: row.created_at ? row.created_at.toISOString() : null,
    rotatedAt: row.rotated_at ? row.rotated_at.toISOString() : null,
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
    // Revealed once; null on every subsequent read.
    clientSecret: revealedSecret ?? null,
  };
}

async function loadActivePrincipal(
  tenantId: string,
  servicePrincipalId: string,
): Promise<TenantServicePrincipalRowLike | null> {
  const [principal] = (await db
    .select()
    .from(tenantServicePrincipals)
    .where(eq(tenantServicePrincipals.id, servicePrincipalId))
    .limit(1)) as TenantServicePrincipalRowLike[];
  if (
    !principal ||
    principal.tenant_id !== tenantId ||
    principal.status !== "active"
  ) {
    return null;
  }
  return principal;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export async function externalCapabilityClients(
  _parent: unknown,
  args: { tenantId: string },
  ctx: GraphQLContext,
): Promise<Array<Record<string, unknown>>> {
  await requireAdminOrServiceCaller(
    ctx,
    args.tenantId,
    "capabilities:manage_external_clients",
  );
  const rows = (await db
    .select()
    .from(capabilityExternalClients)
    .where(eq(capabilityExternalClients.tenant_id, args.tenantId))) as
    | ExternalClientRow[]
    | [];
  return [...rows]
    .sort((a, b) => a.client_id.localeCompare(b.client_id))
    .map((row) => clientToGql(row));
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

interface CreateExternalCapabilityClientGqlInput {
  tenantId: string;
  servicePrincipalId: string;
}

export async function createExternalCapabilityClient(
  _parent: unknown,
  args: { input: CreateExternalCapabilityClientGqlInput },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
  const { input } = args;
  await requireAdminOrServiceCaller(
    ctx,
    input.tenantId,
    "capabilities:manage_external_clients",
  );
  const actor = await resolveRuntimeActor(ctx);

  const servicePrincipalId =
    typeof input.servicePrincipalId === "string"
      ? input.servicePrincipalId.trim()
      : "";
  if (!servicePrincipalId) {
    return { outcome: "rejected", reason: "servicePrincipalId: required" };
  }
  const principal = await loadActivePrincipal(
    input.tenantId,
    servicePrincipalId,
  );
  if (!principal) {
    return { outcome: "rejected", reason: "service_principal_not_active" };
  }

  const clientId = `twcap_${randomBytes(18).toString("base64url")}`;
  const secret = generateClientSecret();
  const secretHash = hashClientSecret(secret);

  let created: ExternalClientRow | undefined;
  try {
    const rows = (await db
      .insert(capabilityExternalClients)
      .values({
        tenant_id: input.tenantId,
        client_id: clientId,
        client_secret_hash: secretHash,
        service_principal_id: servicePrincipalId,
        allowed_resource: capabilitiesResourceUrl(),
        allowed_scopes_json: [SEARCH_SCOPE],
        status: "active",
        created_by_user_id: actor.userId,
      })
      .returning()) as ExternalClientRow[];
    created = rows[0];
  } catch {
    return { outcome: "rejected", reason: "insert_failed" };
  }
  if (!created) return { outcome: "rejected", reason: "insert_failed" };

  await emitRuntimeAuditEvent({
    tenantId: input.tenantId,
    actor,
    eventType: "agent.external_capability_client_created",
    resourceType: "capability_external_client",
    resourceId: created.id,
    action: "create",
    payload: {
      clientId: created.client_id,
      servicePrincipalId,
      allowedScopes: [SEARCH_SCOPE],
    },
  });

  return {
    outcome: "applied",
    reason: null,
    client: clientToGql(created, secret),
  };
}

export async function rotateExternalCapabilityClient(
  _parent: unknown,
  args: { tenantId: string; clientId: string },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
  await requireAdminOrServiceCaller(
    ctx,
    args.tenantId,
    "capabilities:manage_external_clients",
  );
  const actor = await resolveRuntimeActor(ctx);

  const [row] = (await db
    .select()
    .from(capabilityExternalClients)
    .where(eq(capabilityExternalClients.client_id, args.clientId))
    .limit(1)) as ExternalClientRow[];
  if (!row || row.tenant_id !== args.tenantId) {
    return { outcome: "rejected", reason: "external_client_not_found" };
  }
  if (row.status !== "active") {
    return { outcome: "rejected", reason: "external_client_not_active" };
  }

  const secret = generateClientSecret();
  const now = new Date();
  const rows = (await db
    .update(capabilityExternalClients)
    .set({
      client_secret_hash: hashClientSecret(secret),
      rotated_at: now,
      updated_at: now,
    })
    .where(eq(capabilityExternalClients.id, row.id))
    .returning()) as ExternalClientRow[];
  const rotated = rows[0] ?? { ...row, rotated_at: now };

  await emitRuntimeAuditEvent({
    tenantId: args.tenantId,
    actor,
    eventType: "agent.external_capability_client_rotated",
    resourceType: "capability_external_client",
    resourceId: row.id,
    action: "rotate",
    payload: { clientId: row.client_id },
  });

  return {
    outcome: "applied",
    reason: null,
    client: clientToGql(rotated, secret),
  };
}

export async function revokeExternalCapabilityClient(
  _parent: unknown,
  args: { tenantId: string; clientId: string },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
  await requireAdminOrServiceCaller(
    ctx,
    args.tenantId,
    "capabilities:manage_external_clients",
  );
  const actor = await resolveRuntimeActor(ctx);

  const [row] = (await db
    .select()
    .from(capabilityExternalClients)
    .where(eq(capabilityExternalClients.client_id, args.clientId))
    .limit(1)) as ExternalClientRow[];
  if (!row || row.tenant_id !== args.tenantId) {
    return { outcome: "rejected", reason: "external_client_not_found" };
  }
  if (row.status === "revoked") {
    return { outcome: "noop", reason: null, client: clientToGql(row) };
  }

  const now = new Date();
  const rows = (await db
    .update(capabilityExternalClients)
    .set({ status: "revoked", revoked_at: now, updated_at: now })
    .where(
      and(
        eq(capabilityExternalClients.id, row.id),
        eq(capabilityExternalClients.status, "active"),
      ),
    )
    .returning()) as ExternalClientRow[];
  const revoked = rows[0] ?? { ...row, status: "revoked", revoked_at: now };

  await emitRuntimeAuditEvent({
    tenantId: args.tenantId,
    actor,
    eventType: "agent.external_capability_client_revoked",
    resourceType: "capability_external_client",
    resourceId: row.id,
    action: "revoke",
    payload: { clientId: row.client_id },
  });

  return { outcome: "applied", reason: null, client: clientToGql(revoked) };
}
