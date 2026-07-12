/**
 * POST /msteams/install/start
 *
 * Operator-authenticated entry point for the Microsoft Teams install flow.
 * Verifies the Cognito caller is an owner/admin of the target ThinkWork
 * tenant, mints a signed install state, records a pending install row (so
 * the health surface shows the in-flight install immediately), and returns
 * the Microsoft admin-consent URL.
 *
 * Never logs or returns tokens, signed state (beyond the response body the
 * operator needs), the client_secret, or any Teams profile data.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { and, eq } from "drizzle-orm";
import { getConfig } from "@thinkwork/runtime-config";
import { schema } from "@thinkwork/database-pg";
import { authenticate, type AuthResult } from "../../lib/cognito-auth.js";
import { db } from "../../lib/db.js";
import {
  error,
  forbidden,
  handleCors,
  json,
  unauthorized,
} from "../../lib/response.js";
import {
  createMsteamsInstallState,
  getMsteamsAppCredentials,
  verifyMsteamsInstallState,
  type MsteamsAppCredentials,
} from "../../lib/msteams/install-state.js";
import { reopenRevokedInstall } from "../../lib/msteams/tenant-store.js";

const { users, tenantMembers } = schema;

export interface MsteamsInstallStartDeps {
  authenticate?: (
    headers: Record<string, string | undefined>,
  ) => Promise<AuthResult | null>;
  getCredentials?: () => Promise<MsteamsAppCredentials>;
  resolveUserIdByEmail?: (email: string) => Promise<string | null>;
  isTenantAdmin?: (tenantId: string, userId: string) => Promise<boolean>;
  reopenRevoked?: typeof reopenRevokedInstall;
  redirectUri?: string;
  nowMs?: () => number;
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  return handleMsteamsInstallStart(event);
}

export async function handleMsteamsInstallStart(
  event: APIGatewayProxyEventV2,
  deps: MsteamsInstallStartDeps = {},
): Promise<APIGatewayProxyStructuredResultV2> {
  const preflight = handleCors(event);
  if (preflight) return preflight;

  if (event.requestContext.http.method !== "POST") {
    return error("Method not allowed", 405);
  }

  const doAuthenticate = deps.authenticate ?? authenticate;
  const auth = await doAuthenticate(
    event.headers as Record<string, string | undefined>,
  );
  if (!auth || auth.authType !== "cognito" || !auth.email) {
    return unauthorized("Authentication required");
  }

  const resolveUserIdByEmail =
    deps.resolveUserIdByEmail ?? defaultResolveUserIdByEmail;
  const callerUserId = await resolveUserIdByEmail(auth.email.toLowerCase());
  if (!callerUserId) {
    return forbidden("No ThinkWork user resolved for caller");
  }

  let body: { tenantId?: unknown };
  try {
    body = JSON.parse(event.body ?? "{}") as { tenantId?: unknown };
  } catch {
    return error("Invalid JSON body", 400);
  }
  const tenantId =
    typeof body.tenantId === "string" ? body.tenantId.trim() : "";
  if (!tenantId) {
    return error("tenantId is required", 400);
  }

  const isTenantAdmin = deps.isTenantAdmin ?? defaultIsTenantAdmin;
  if (!(await isTenantAdmin(tenantId, callerUserId))) {
    return forbidden("Tenant admin role required");
  }

  const getCredentials = deps.getCredentials ?? getMsteamsAppCredentials;
  const credentials = await getCredentials();

  const state = createMsteamsInstallState({
    tenantId,
    adminUserId: callerUserId,
    signingKey: credentials.clientSecret,
    nowMs: deps.nowMs,
  });
  const { expiresAt } = verifyMsteamsInstallState(
    state,
    credentials.clientSecret,
    deps.nowMs,
  );

  const redirectUri = deps.redirectUri ?? msteamsInstallRedirectUri();
  const consentUrl = new URL(
    "https://login.microsoftonline.com/organizations/adminconsent",
  );
  consentUrl.searchParams.set("client_id", credentials.appId);
  consentUrl.searchParams.set("state", state);
  consentUrl.searchParams.set("redirect_uri", redirectUri);

  // No install row is written here: the Entra tenant id is unknown until
  // Microsoft redirects back, and the signed state itself carries the
  // pending install. install-complete creates the real binding. The one
  // exception: a REVOKED install is reopened to pending here, because this
  // operator-authenticated entry point is the deliberate re-enable path —
  // callback replay alone can never reactivate a revoked binding.
  const reopenRevoked = deps.reopenRevoked ?? reopenRevokedInstall;
  await reopenRevoked({ tenantId });

  return json({
    state,
    adminConsentUrl: consentUrl.toString(),
    expiresAt,
  });
}

export function msteamsInstallRedirectUri(): string {
  const configured = process.env.MSTEAMS_INSTALL_REDIRECT_URI?.trim();
  if (configured) return configured;
  const apiUrl = getConfig("THINKWORK_API_URL")?.replace(/\/+$/, "");
  if (!apiUrl) {
    throw new Error(
      "THINKWORK_API_URL or MSTEAMS_INSTALL_REDIRECT_URI is required to start the Teams install.",
    );
  }
  return `${apiUrl}/msteams/install/complete`;
}

async function defaultResolveUserIdByEmail(
  email: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Same DB-level check as the GraphQL requireTenantAdmin gate: caller must
 * hold an owner/admin role on the target tenant in tenant_members.
 */
async function defaultIsTenantAdmin(
  tenantId: string,
  userId: string,
): Promise<boolean> {
  const [member] = await db
    .select({ role: tenantMembers.role })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenant_id, tenantId),
        eq(tenantMembers.principal_id, userId),
      ),
    )
    .limit(1);
  return member?.role === "owner" || member?.role === "admin";
}
