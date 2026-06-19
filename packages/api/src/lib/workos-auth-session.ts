import { and, desc, eq, gt } from "drizzle-orm";
import { workosAuthSessions } from "@thinkwork/database-pg/schema";
import { authenticate, type AuthResult } from "./cognito-auth.js";
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
  workosSessionId: string;
}

export interface WorkosLogoutDeps {
  authenticate(
    headers: Record<string, string | undefined>,
  ): Promise<AuthResult | null>;
  consumeActiveSession(args: {
    cognitoPrincipalId: string;
    now: Date;
  }): Promise<WorkosLogoutSession | null>;
  now(): Date;
}

export function createDefaultWorkosLogoutDeps(
  db: DbLike = defaultDb,
): WorkosLogoutDeps {
  return {
    authenticate,
    consumeActiveSession: (args) => consumeActiveWorkosSession(args, db),
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

  const session = await deps.consumeActiveSession({
    cognitoPrincipalId: auth.principalId,
    now: deps.now(),
  });
  if (!session) return { logout_url: null };

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

async function consumeActiveWorkosSession(
  args: { cognitoPrincipalId: string; now: Date },
  db: DbLike,
): Promise<WorkosLogoutSession | null> {
  const [row] = await db
    .select({
      id: workosAuthSessions.id,
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

  if (!row) return null;

  const [updated] = await db
    .update(workosAuthSessions)
    .set({
      status: "logged_out",
      logged_out_at: args.now,
      updated_at: args.now,
    })
    .where(
      and(
        eq(workosAuthSessions.id, row.id),
        eq(workosAuthSessions.status, "active"),
      ),
    )
    .returning({
      id: workosAuthSessions.id,
      workosSessionId: workosAuthSessions.workos_session_id,
    });

  return updated ?? null;
}
