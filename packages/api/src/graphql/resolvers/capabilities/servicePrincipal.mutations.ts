/**
 * createServicePrincipal / revokeServicePrincipal — stable, revocable
 * non-human identity for 'service'-mode credential bindings
 * (THINK-280 U2, R6).
 *
 * Operator/admin-gated. Slugs are [a-z0-9-] and unique per tenant — a
 * conflict is outcome 'rejected' reason 'slug_taken', never a thrown
 * 500. Revocation is terminal and idempotent (second call = noop, no
 * audit event).
 */

import type { GraphQLContext } from "../../context.js";
import { and, db, eq } from "../../utils.js";
import { tenantServicePrincipals } from "@thinkwork/database-pg/schema";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import {
  emitRuntimeAuditEvent,
  servicePrincipalToGql,
  resolveRuntimeActor,
  type TenantServicePrincipalRowLike,
} from "./capabilityRuntime.shared.js";

const SLUG_RE = /^[a-z0-9-]{1,64}$/;

interface CreateServicePrincipalGqlInput {
  tenantId: string;
  slug: string;
  displayName: string;
  purpose?: string | null;
}

export async function createServicePrincipal(
  _parent: unknown,
  args: { input: CreateServicePrincipalGqlInput },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
  const { input } = args;
  await requireAdminOrServiceCaller(
    ctx,
    input.tenantId,
    "capabilities:manage_service_principals",
  );
  const actor = await resolveRuntimeActor(ctx);

  const slug = typeof input.slug === "string" ? input.slug.trim() : "";
  if (!SLUG_RE.test(slug)) {
    return {
      outcome: "rejected",
      reason: "slug: must match [a-z0-9-] (max 64 chars)",
    };
  }
  const displayName =
    typeof input.displayName === "string" ? input.displayName.trim() : "";
  if (displayName === "") {
    return { outcome: "rejected", reason: "displayName: required" };
  }

  const [existing] = (await db
    .select()
    .from(tenantServicePrincipals)
    .where(
      and(
        eq(tenantServicePrincipals.tenant_id, input.tenantId),
        eq(tenantServicePrincipals.slug, slug),
      ),
    )
    .limit(1)) as TenantServicePrincipalRowLike[];
  if (existing) {
    return { outcome: "rejected", reason: "slug_taken" };
  }

  let created: TenantServicePrincipalRowLike | undefined;
  try {
    const rows = (await db
      .insert(tenantServicePrincipals)
      .values({
        tenant_id: input.tenantId,
        slug,
        display_name: displayName,
        purpose: input.purpose?.trim() || null,
        status: "active",
        created_by_user_id: actor.userId,
      })
      .returning()) as TenantServicePrincipalRowLike[];
    created = rows[0];
  } catch {
    // Unique-index race on (tenant_id, slug) — same safe outcome as the
    // pre-check.
    return { outcome: "rejected", reason: "slug_taken" };
  }
  if (!created) {
    return { outcome: "rejected", reason: "insert_failed" };
  }

  await emitRuntimeAuditEvent({
    tenantId: input.tenantId,
    actor,
    eventType: "agent.service_principal_created",
    resourceType: "tenant_service_principal",
    resourceId: created.id,
    action: "create",
    payload: {
      servicePrincipalId: created.id,
      slug: created.slug,
      status: created.status,
    },
  });

  return {
    outcome: "applied",
    reason: null,
    servicePrincipal: servicePrincipalToGql(created),
  };
}

export async function revokeServicePrincipal(
  _parent: unknown,
  args: { tenantId: string; servicePrincipalId: string },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
  await requireAdminOrServiceCaller(
    ctx,
    args.tenantId,
    "capabilities:manage_service_principals",
  );
  const actor = await resolveRuntimeActor(ctx);

  const [principal] = (await db
    .select()
    .from(tenantServicePrincipals)
    .where(eq(tenantServicePrincipals.id, args.servicePrincipalId))
    .limit(1)) as TenantServicePrincipalRowLike[];
  if (!principal || principal.tenant_id !== args.tenantId) {
    return { outcome: "rejected", reason: "service_principal_not_found" };
  }
  if (principal.status === "revoked") {
    return {
      outcome: "noop",
      reason: null,
      servicePrincipal: servicePrincipalToGql(principal),
    };
  }

  const now = new Date();
  const rows = (await db
    .update(tenantServicePrincipals)
    .set({
      status: "revoked",
      revoked_at: now,
      revoked_by_user_id: actor.userId,
      updated_at: now,
    })
    .where(eq(tenantServicePrincipals.id, principal.id))
    .returning()) as TenantServicePrincipalRowLike[];
  const revoked =
    rows[0] ??
    ({
      ...principal,
      status: "revoked",
      revoked_at: now,
    } as TenantServicePrincipalRowLike);

  await emitRuntimeAuditEvent({
    tenantId: args.tenantId,
    actor,
    eventType: "agent.service_principal_revoked",
    resourceType: "tenant_service_principal",
    resourceId: principal.id,
    action: "revoke",
    payload: {
      servicePrincipalId: principal.id,
      slug: principal.slug,
      status: "revoked",
    },
  });

  return {
    outcome: "applied",
    reason: null,
    servicePrincipal: servicePrincipalToGql(revoked),
  };
}
