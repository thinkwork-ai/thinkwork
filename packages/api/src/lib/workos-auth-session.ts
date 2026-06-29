import { and, desc, eq, gt } from "drizzle-orm";
import { workosAuthSessions } from "@thinkwork/database-pg/schema";
import { authenticate, type AuthResult } from "./cognito-auth.js";
import { emitAuditEvent } from "./compliance/emit.js";
import { db as defaultDb } from "./db.js";

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
}

export interface WorkosLogoutDeps {
  authenticate(
    headers: Record<string, string | undefined>,
  ): Promise<AuthResult | null>;
  findActiveSession(args: {
    cognitoPrincipalId: string;
    now: Date;
  }): Promise<WorkosLogoutSession | null>;
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
  result: "workos_logout_url_issued";
}

export function createDefaultWorkosLogoutDeps(
  db: DbLike = defaultDb,
): WorkosLogoutDeps {
  return {
    authenticate,
    findActiveSession: (args) => findActiveWorkosSession(args, db),
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

  await deps.emitSignOutAudit({
    tenantId: session.tenantId,
    userId: session.userId,
    cognitoSub: auth.principalId,
    sessionId: session.id,
    workosUserId: session.workosUserId,
    authProviderResourceId: session.authProviderResourceId,
    tenantReferenceId: session.tenantReferenceId,
    result: "workos_logout_url_issued",
  });

  return {
    logout_url: buildWorkosLogoutUrl({
      sessionId: session.workosSessionId,
      returnTo: normalizeLogoutReturnTo(args.returnTo),
    }),
  };
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
    })
    .from(workosAuthSessions)
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
