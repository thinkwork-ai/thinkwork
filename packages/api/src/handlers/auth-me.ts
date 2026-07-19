/**
 * Lightweight caller-identity endpoint.
 *
 * GET /api/auth/me
 *
 * Cognito-authenticated. Returns just enough about the caller to gate
 * UI affordances (e.g. owner-only nav items) without forcing a GraphQL
 * round-trip through the admin urql client. Both admin Sidebar and
 * mobile Settings consume this.
 *
 *   200 → { email, userId, tenantId, role, name }
 *   401 → unauthenticated
 *   403 → authenticated but no tenant resolved (pre-bootstrap state)
 *
 * Role comes from tenant_members.role for (tenantId, userId) — the
 * same shape requireTenantAdmin() checks server-side. Null when the
 * caller is authenticated but not yet a member (edge case during
 * provisioning; UI treats as non-owner).
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, and } from "drizzle-orm";
import { authenticate } from "../lib/cognito-auth.js";
import { resolveCallerFromAuth } from "../graphql/resolvers/core/resolve-auth-user.js";
import {
  AuthAdmissionError,
  discoverCognitoTenantAdmissions,
} from "../lib/auth-admission.js";
import { handleCors, json, error, unauthorized } from "../lib/response.js";
import { db } from "../lib/db.js";
import { schema } from "@thinkwork/database-pg";

const { users, tenantMembers } = schema;

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const preflight = handleCors(event);
  if (preflight) return preflight;

  if (event.requestContext.http.method !== "GET") {
    return error("Method not allowed", 405);
  }

  const auth = await authenticate(
    event.headers as Record<string, string | undefined>,
  );
  if (!auth || !auth.email) {
    return unauthorized("Authentication required");
  }

  const migration = {
    migrationRequired:
      auth.authType === "cognito" &&
      auth.route?.providerKind === "legacy_workos" &&
      auth.route.lifecycleState === "coexistence",
    migrationRecoveryDeadline:
      process.env.AUTH_MIGRATION_RECOVERY_DEADLINE?.trim() || null,
  };

  const requestedTenantId =
    event.queryStringParameters?.tenantId?.trim() ||
    event.headers["x-tenant-id"]?.trim() ||
    event.headers["X-Tenant-Id"]?.trim();
  let admitted: { userId: string | null; tenantId: string | null };
  let availableTenants: Array<{ tenantId: string; role: string }> = [];
  if (auth.authType === "cognito") {
    try {
      const discovery = await discoverCognitoTenantAdmissions(auth);
      availableTenants = discovery.tenants;
      const selected = requestedTenantId
        ? discovery.tenants.find(
            (tenant) => tenant.tenantId === requestedTenantId,
          )
        : discovery.tenants.length === 1
          ? discovery.tenants[0]
          : undefined;
      admitted = {
        userId: discovery.userId,
        tenantId: selected?.tenantId ?? null,
      };
    } catch (cause) {
      if (!(cause instanceof AuthAdmissionError)) throw cause;
      admitted = { userId: null, tenantId: null };
    }
  } else {
    admitted = await resolveCallerFromAuth(auth, requestedTenantId);
  }
  // Resolve user row only by the identity admitted from the Cognito subject.
  const [userRow] = admitted.userId
    ? await db
        .select()
        .from(users)
        .where(eq(users.id, admitted.userId))
        .limit(1)
    : [];

  if (!userRow) {
    return json(
      {
        ...migration,
        email: auth.email,
        userId: null,
        tenantId: null,
        role: null,
        name: null,
        note: "user_not_bootstrapped",
      },
      200,
    );
  }

  const tenantId = admitted.tenantId;
  if (!tenantId) {
    return json({
      ...migration,
      email: userRow.email,
      userId: userRow.id,
      tenantId: null,
      role: null,
      name: userRow.name ?? null,
      tenantSelectionRequired: availableTenants.length > 1,
      availableTenants,
    });
  }

  // Look up the caller's role in this tenant. Matched on
  // (tenant_id, principal_type='user', principal_id=userRow.id) —
  // the shape tenant_members uses.
  const [memberRow] = await db
    .select()
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenant_id, tenantId),
        eq(tenantMembers.principal_type, "user"),
        eq(tenantMembers.principal_id, userRow.id),
        eq(tenantMembers.status, "active"),
      ),
    )
    .limit(1);

  if (!memberRow) {
    return json({
      ...migration,
      email: userRow.email,
      userId: userRow.id,
      tenantId: null,
      role: null,
      name: userRow.name ?? null,
      note: "tenant_membership_inactive",
    });
  }

  return json({
    ...migration,
    email: userRow.email,
    userId: userRow.id,
    tenantId,
    role: memberRow?.role ?? null,
    name: userRow.name ?? null,
    tenantSelectionRequired: false,
    availableTenants,
  });
}
