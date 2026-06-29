import { and, desc, eq, gt } from "drizzle-orm";
import {
  authProviderResources,
  workosAuthSessions,
} from "@thinkwork/database-pg/schema";
import { authenticate, type AuthResult } from "./cognito-auth.js";
import { emitAuditEvent } from "./compliance/emit.js";
import { db as defaultDb } from "./db.js";
import { createSecretsManagerPluginSecrets } from "./plugins/secrets.js";

type DbLike = typeof defaultDb;

const DEFAULT_WORKOS_API_BASE_URL = "https://api.workos.com";
const FALLBACK_SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface WorkosAuthSessionRecordInput {
  tenantId: string;
  userId: string;
  tenantReferenceId: string;
  authProviderResourceId: string;
  cognitoPrincipalId: string;
  cognitoUsername: string;
  workosUserId: string;
  workosSessionId: string;
  workosEmail: string;
  expiresAt: Date | null;
}

export interface WorkosLogoutSession {
  id: string;
  tenantId: string;
  userId: string;
  authProviderResourceId: string;
  tenantReferenceId: string;
  workosUserId: string;
  workosSessionId: string;
  clientSecretRef: string;
}

export interface WorkosLogoutDeps {
  authenticate(
    headers: Record<string, string | undefined>,
  ): Promise<AuthResult | null>;
  findActiveSession(args: {
    cognitoPrincipalId: string;
    now: Date;
  }): Promise<WorkosLogoutSession | null>;
  getSecret(ref: string): Promise<string | null>;
  revokeWorkosSession(args: {
    sessionId: string;
    clientSecret: string;
  }): Promise<void>;
  markSessionLoggedOut(args: { sessionRowId: string; now: Date }): Promise<void>;
  emitSignOutAudit(args: WorkosSignOutAuditInput): Promise<void>;
  now(): Date;
}

export interface WorkosSignOutAuditInput {
  tenantId: string;
  userId: string;
  cognitoSub: string;
  sessionId: string;
  workosUserId: string;
  authProviderResourceId: string;
  tenantReferenceId: string;
  result: "workos_session_revoked";
}

export function createDefaultWorkosLogoutDeps(
  db: DbLike = defaultDb,
): WorkosLogoutDeps {
  const secrets = createSecretsManagerPluginSecrets();
  return {
    authenticate,
    findActiveSession: (args) => findActiveWorkosSession(args, db),
    getSecret: (ref) => secrets.getSecret(ref),
    revokeWorkosSession: (args) => revokeWorkosSession(args),
    markSessionLoggedOut: (args) => markWorkosSessionLoggedOut(args, db),
    emitSignOutAudit: (args) => emitWorkosSignOutAudit(args, db),
    now: () => new Date(),
  };
}

export async function recordWorkosAuthSession(
  record: WorkosAuthSessionRecordInput,
  db: DbLike = defaultDb,
  now = new Date(),
): Promise<void> {
  await db.insert(workosAuthSessions).values({
    tenant_id: record.tenantId,
    user_id: record.userId,
    tenant_auth_provider_reference_id: record.tenantReferenceId,
    auth_provider_resource_id: record.authProviderResourceId,
    cognito_principal_id: record.cognitoPrincipalId,
    cognito_username: record.cognitoUsername,
    workos_user_id: record.workosUserId,
    workos_session_id: record.workosSessionId,
    workos_email: record.workosEmail,
    status: "active",
    expires_at:
      record.expiresAt && record.expiresAt > now
        ? record.expiresAt
        : new Date(now.getTime() + FALLBACK_SESSION_RETENTION_MS),
    created_at: now,
    updated_at: now,
  });
}

export async function createWorkosLogoutRedirect(args: {
  headers: Record<string, string | undefined>;
  returnTo?: string;
  deps?: WorkosLogoutDeps;
}): Promise<{ logout_url: string | null }> {
  const deps = args.deps ?? createDefaultWorkosLogoutDeps();
  const auth = await deps.authenticate(args.headers);
  if (!auth || auth.authType !== "cognito" || !auth.principalId) {
    throw new WorkosLogoutError("Authentication required", 401);
  }

  const session = await deps.findActiveSession({
    cognitoPrincipalId: auth.principalId,
    now: deps.now(),
  });
  if (!session) return { logout_url: null };

  const secret = await deps.getSecret(session.clientSecretRef);
  const clientSecret = parseWorkosClientSecret(secret);
  if (!clientSecret) {
    throw new WorkosLogoutError("WorkOS client secret is not configured", 500);
  }

  await deps.revokeWorkosSession({
    sessionId: session.workosSessionId,
    clientSecret,
  });
  await deps.markSessionLoggedOut({
    sessionRowId: session.id,
    now: deps.now(),
  });
  await deps.emitSignOutAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    cognitoSub: auth.principalId,
    sessionId: session.id,
    workosUserId: session.workosUserId,
    authProviderResourceId: session.authProviderResourceId,
    tenantReferenceId: session.tenantReferenceId,
    result: "workos_session_revoked",
  });

  return { logout_url: null };
}

export function buildWorkosLogoutUrl(args: {
  sessionId: string;
  returnTo: string;
  apiBase?: string;
}): string {
  const url = new URL(
    "/user_management/sessions/logout",
    args.apiBase ?? DEFAULT_WORKOS_API_BASE_URL,
  );
  url.searchParams.set("session_id", args.sessionId);
  url.searchParams.set("return_to", args.returnTo);
  return url.toString();
}

export function normalizeLogoutReturnTo(value: string | undefined): string {
  if (!value) return "https://app.thinkwork.ai/sign-in";
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        (url.hostname === "localhost" || url.hostname === "127.0.0.1"))
    ) {
      url.hash = "";
      return url.toString();
    }
  } catch {
    // Fall through to safe default.
  }
  return "https://app.thinkwork.ai/sign-in";
}

export class WorkosLogoutError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}

async function findActiveWorkosSession(
  args: { cognitoPrincipalId: string; now: Date },
  db: DbLike,
): Promise<WorkosLogoutSession | null> {
  const [row] = await db
    .select({
      id: workosAuthSessions.id,
      tenantId: workosAuthSessions.tenant_id,
      userId: workosAuthSessions.user_id,
      tenantReferenceId: workosAuthSessions.tenant_auth_provider_reference_id,
      authProviderResourceId: workosAuthSessions.auth_provider_resource_id,
      workosUserId: workosAuthSessions.workos_user_id,
      workosSessionId: workosAuthSessions.workos_session_id,
      clientSecretRef: authProviderResources.client_secret_ref,
    })
    .from(workosAuthSessions)
    .innerJoin(
      authProviderResources,
      eq(workosAuthSessions.auth_provider_resource_id, authProviderResources.id),
    )
    .where(
      and(
        eq(workosAuthSessions.cognito_principal_id, args.cognitoPrincipalId),
        eq(workosAuthSessions.status, "active"),
        gt(workosAuthSessions.expires_at, args.now),
      ),
    )
    .orderBy(desc(workosAuthSessions.created_at))
    .limit(1);
  return row ?? null;
}

async function revokeWorkosSession(args: {
  sessionId: string;
  clientSecret: string;
}): Promise<void> {
  const response = await fetch(
    `${DEFAULT_WORKOS_API_BASE_URL}/user_management/sessions/revoke`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${args.clientSecret}`,
      },
      body: JSON.stringify({ session_id: args.sessionId }),
    },
  );
  if (!response.ok) {
    throw new WorkosLogoutError("WorkOS session revoke failed", 502);
  }
}

async function markWorkosSessionLoggedOut(
  args: { sessionRowId: string; now: Date },
  db: DbLike,
): Promise<void> {
  await db
    .update(workosAuthSessions)
    .set({
      status: "logged_out",
      logged_out_at: args.now,
      updated_at: args.now,
    })
    .where(eq(workosAuthSessions.id, args.sessionRowId));
}

function parseWorkosClientSecret(secret: string | null): string | null {
  const trimmed = secret?.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed.client_secret === "string") {
      return parsed.client_secret.trim() || null;
    }
    if (typeof parsed.clientSecret === "string") {
      return parsed.clientSecret.trim() || null;
    }
  } catch {
    return trimmed;
  }
  return null;
}

async function emitWorkosSignOutAudit(
  args: WorkosSignOutAuditInput,
  db: DbLike,
): Promise<void> {
  await emitAuditEvent(db, {
    tenantId: args.tenantId,
    actorId: args.userId,
    actorType: "user",
    eventType: "auth.signout",
    source: "lambda",
    resourceType: "auth_provider_resource",
    resourceId: args.authProviderResourceId,
    action: "workos_signout",
    outcome: args.result,
    payload: {
      userId: args.userId,
      tenantId: args.tenantId,
      sessionId: args.sessionId,
      workosUserId: args.workosUserId,
      cognitoSub: args.cognitoSub,
      authProviderResourceId: args.authProviderResourceId,
      tenantAuthProviderReferenceId: args.tenantReferenceId,
      result: args.result,
    },
  });
}
