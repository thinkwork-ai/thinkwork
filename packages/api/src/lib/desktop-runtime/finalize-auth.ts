import { eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { threadTurns } from "@thinkwork/database-pg/schema";
import {
  DESKTOP_FINALIZE_TOKEN_PREFIX,
  verifyDesktopFinalizeToken,
} from "./sidecar-credentials.js";

/**
 * Scoped identity derived from a desktop per-turn finalize token. Identity is
 * read from the authoritative turn row + its persisted desktop session — never
 * from client-supplied headers — so a desktop holding only a per-turn token
 * cannot act outside that turn's tenant/user/agent.
 */
export interface DesktopTokenIdentity {
  tenantId: string;
  threadId: string | null;
  agentId: string;
  userId: string;
  email: string | null;
}

interface DesktopRuntimeSession {
  finalize_token_sha256: string;
  expires_at: string;
  caller_user_id?: string;
  caller_email?: string;
}

function readDesktopRuntimeSession(
  contextSnapshot: unknown,
): DesktopRuntimeSession | null {
  if (!contextSnapshot || typeof contextSnapshot !== "object") return null;
  const session = (contextSnapshot as Record<string, unknown>)[
    "desktop_runtime_session"
  ];
  if (!session || typeof session !== "object") return null;
  const record = session as Record<string, unknown>;
  const finalizeHash = record.finalize_token_sha256;
  const expiresAt = record.expires_at;
  if (typeof finalizeHash !== "string" || typeof expiresAt !== "string") {
    return null;
  }
  return {
    finalize_token_sha256: finalizeHash,
    expires_at: expiresAt,
    caller_user_id:
      typeof record.caller_user_id === "string"
        ? record.caller_user_id
        : undefined,
    caller_email:
      typeof record.caller_email === "string" ? record.caller_email : undefined,
  };
}

/**
 * Validate a desktop `dps_` finalize token against the turn it was minted for
 * and return the turn's scoped identity, or `null` if the token is not a
 * desktop token, the turn/session is missing, the session has expired, or the
 * token does not match. The desktop tool must supply the originating
 * `threadTurnId` (it has it as `thread_turn_id`).
 */
export async function authenticateDesktopFinalizeToken(args: {
  token: string;
  threadTurnId: string;
  now?: number;
  db?: ReturnType<typeof getDb>;
}): Promise<DesktopTokenIdentity | null> {
  const { token, threadTurnId } = args;
  if (!token || !token.startsWith(DESKTOP_FINALIZE_TOKEN_PREFIX)) return null;
  if (!threadTurnId) return null;

  const db = args.db ?? getDb();
  const [turn] = await db
    .select({
      id: threadTurns.id,
      tenant_id: threadTurns.tenant_id,
      thread_id: threadTurns.thread_id,
      agent_id: threadTurns.agent_id,
      context_snapshot: threadTurns.context_snapshot,
    })
    .from(threadTurns)
    .where(eq(threadTurns.id, threadTurnId))
    .limit(1);
  if (!turn) return null;

  const session = readDesktopRuntimeSession(turn.context_snapshot);
  if (!session) return null;

  const now = args.now ?? Date.now();
  if (Date.parse(session.expires_at) <= now) return null;
  if (!verifyDesktopFinalizeToken(token, session.finalize_token_sha256)) {
    return null;
  }
  if (!turn.tenant_id || !turn.agent_id || !session.caller_user_id) return null;

  return {
    tenantId: turn.tenant_id,
    threadId: turn.thread_id,
    agentId: turn.agent_id,
    userId: session.caller_user_id,
    email: session.caller_email ?? null,
  };
}
