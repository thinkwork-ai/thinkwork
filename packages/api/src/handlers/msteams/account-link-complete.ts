/**
 * POST /msteams/account-link/complete
 *
 * Authenticated end-user completion of the Teams account-link flow. The
 * caller presents the signed link token minted for their verified Teams
 * identity (Entra tenant + AAD object id); the handler binds that identity
 * to the AUTHENTICATED caller's ThinkWork user — never to a user id carried
 * in the request.
 *
 * Also supports action: "unlink" to remove the caller's OWN link.
 *
 * Never logs or returns tokens, signed state, client_secret, or Teams
 * profile data beyond ids/display name.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { and, eq } from "drizzle-orm";
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
  getMsteamsAppCredentials,
  verifyMsteamsAccountLinkToken,
  type MsteamsAppCredentials,
} from "../../lib/msteams/install-state.js";
import { findActiveTenantInstall } from "../../lib/msteams/tenant-store.js";
import {
  findActiveUserLink,
  unlinkUser,
  upsertUserLink,
} from "../../lib/msteams/user-link-store.js";

const { users, tenantMembers } = schema;

interface CallerUser {
  id: string;
  tenantId: string | null;
}

export interface MsteamsAccountLinkDeps {
  authenticate?: (
    headers: Record<string, string | undefined>,
  ) => Promise<AuthResult | null>;
  getCredentials?: () => Promise<MsteamsAppCredentials>;
  resolveUserByEmail?: (email: string) => Promise<CallerUser | null>;
  isTenantMember?: (tenantId: string, userId: string) => Promise<boolean>;
  findInstall?: typeof findActiveTenantInstall;
  upsertLink?: typeof upsertUserLink;
  findLink?: typeof findActiveUserLink;
  unlink?: typeof unlinkUser;
  nowMs?: () => number;
}

interface LinkBody {
  action?: unknown;
  token?: unknown;
  entraTenantId?: unknown;
  aadObjectId?: unknown;
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  return handleMsteamsAccountLinkComplete(event);
}

export async function handleMsteamsAccountLinkComplete(
  event: APIGatewayProxyEventV2,
  deps: MsteamsAccountLinkDeps = {},
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

  const resolveUserByEmail =
    deps.resolveUserByEmail ?? defaultResolveUserByEmail;
  const caller = await resolveUserByEmail(auth.email.toLowerCase());
  if (!caller) {
    return forbidden("No ThinkWork user resolved for caller");
  }

  let body: LinkBody;
  try {
    body = JSON.parse(event.body ?? "{}") as LinkBody;
  } catch {
    return error("Invalid JSON body", 400);
  }

  if (body.action === "unlink") {
    return handleUnlink(body, caller, deps);
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) {
    return error("token is required", 400);
  }

  const getCredentials = deps.getCredentials ?? getMsteamsAppCredentials;
  const credentials = await getCredentials();

  let payload;
  try {
    payload = verifyMsteamsAccountLinkToken(token, credentials.clientSecret, {
      nowMs: deps.nowMs,
    });
  } catch (err) {
    return error((err as Error).message, 401);
  }

  const findInstall = deps.findInstall ?? findActiveTenantInstall;
  const install = await findInstall({ entraTenantId: payload.entraTenantId });
  if (!install) {
    return error("Microsoft Teams install is not active for this tenant", 409);
  }
  if (install.tenant_id !== payload.tenantId) {
    return error(
      "Microsoft Teams install belongs to a different ThinkWork tenant",
      409,
    );
  }
  if (payload.aadObjectId === install.bot_app_id) {
    return forbidden("The Teams bot identity cannot be linked to a user");
  }

  const isTenantMember = deps.isTenantMember ?? defaultIsTenantMember;
  const callerBelongs =
    caller.tenantId === payload.tenantId ||
    (await isTenantMember(payload.tenantId, caller.id));
  if (!callerBelongs) {
    return forbidden("Caller does not belong to the linked tenant");
  }

  const upsertLink = deps.upsertLink ?? upsertUserLink;
  await upsertLink({
    tenantId: payload.tenantId,
    entraTenantId: payload.entraTenantId,
    aadObjectId: payload.aadObjectId,
    userId: caller.id,
  });

  return json({ linked: true, userId: caller.id });
}

async function handleUnlink(
  body: LinkBody,
  caller: CallerUser,
  deps: MsteamsAccountLinkDeps,
): Promise<APIGatewayProxyStructuredResultV2> {
  const entraTenantId =
    typeof body.entraTenantId === "string" ? body.entraTenantId.trim() : "";
  const aadObjectId =
    typeof body.aadObjectId === "string" ? body.aadObjectId.trim() : "";
  if (!entraTenantId || !aadObjectId) {
    return error("entraTenantId and aadObjectId are required to unlink", 400);
  }

  const findLink = deps.findLink ?? findActiveUserLink;
  const link = await findLink({ entraTenantId, aadObjectId });
  if (!link) {
    return error("No active Teams link found", 404);
  }
  if (link.user_id !== caller.id) {
    // Caller-scoped: users may only unlink their own Teams identity.
    return forbidden("Only the linked user may unlink this Teams identity");
  }

  const unlink = deps.unlink ?? unlinkUser;
  await unlink({ entraTenantId, aadObjectId });
  return json({ linked: false });
}

async function defaultResolveUserByEmail(
  email: string,
): Promise<CallerUser | null> {
  const [row] = await db
    .select({ id: users.id, tenantId: users.tenant_id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return row ? { id: row.id, tenantId: row.tenantId } : null;
}

async function defaultIsTenantMember(
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
  const role = member?.role;
  return role === "owner" || role === "admin" || role === "member";
}
