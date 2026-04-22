/**
 * sandbox-secrets — per-invocation OAuth token writer for the AgentCore
 * Code Interpreter sandbox (plan Unit 8).
 *
 * For each required connection_type on the template, this module:
 *   1. Resolves a fresh access token via the existing oauth-token
 *      refresh path (same plumbing as GMAIL_ACCESS_TOKEN).
 *   2. Performs a close-to-use recheck against `connections.status`
 *      just before write — closes the TOCTOU window between
 *      dispatcher pre-flight (Unit 9) and the Secrets Manager write.
 *   3. Puts the token to Secrets Manager at
 *      `thinkwork/{stage}/sandbox/{tenant_id}/{user_id}/oauth/{connection_type}`.
 *
 * The sandbox's per-tenant IAM role (plan Unit 5) reads these paths at
 * runtime via the preamble. Only access tokens are written — refresh
 * tokens never leave the API Lambda.
 *
 * *** Logging discipline ***
 * This module must never log the token value, the preamble source, or
 * the resolved secret path verbatim. Paths are half-sensitive (they
 * encode tenant_id + user_id, which is fine for platform-operator
 * dashboards but should not escape into tenant-visible surfaces).
 */

import {
  SecretsManagerClient,
  CreateSecretCommand,
  PutSecretValueCommand,
  UpdateSecretCommand,
  DeleteSecretCommand,
  ResourceNotFoundException,
  ResourceExistsException,
} from "@aws-sdk/client-secrets-manager";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@thinkwork/database-pg";

const sm = new SecretsManagerClient({});

// Allowlist matches the brainstorm R11 + Unit 2 OAuth providers + Unit 3
// template validator. Extend together.
export const SANDBOX_ALLOWED_CONNECTION_TYPES = [
  "google",
  "github",
  "slack",
] as const;

export type SandboxConnectionType =
  (typeof SANDBOX_ALLOWED_CONNECTION_TYPES)[number];

export interface WriteSandboxSecretsInput {
  stage: string;
  tenantId: string;
  userId: string;
  /** Which connection_types the template declared as required. */
  requiredConnections: SandboxConnectionType[];
  /**
   * Override the token resolver for tests. Production wires this to
   * oauth-token.resolveOAuthToken so the existing refresh path is the
   * single source of truth for "fresh access token for user + provider".
   */
  resolveTokenForUserProvider?: (
    tenantId: string,
    userId: string,
    providerName: string,
  ) => Promise<{ accessToken: string; connectionId: string } | null>;
}

export interface WriteSandboxSecretsResult {
  /** Map of connection_type → Secrets Manager ARN path for the preamble. */
  secretPaths: Record<SandboxConnectionType, string>;
}

export class ConnectionRevokedError extends Error {
  connectionType: string;
  constructor(connectionType: string, message: string) {
    super(message);
    this.name = "ConnectionRevokedError";
    this.connectionType = connectionType;
  }
}

/**
 * Build the Secrets Manager path for a (tenant, user, connection_type)
 * tuple. Pure — exported for unit tests.
 */
export function buildSandboxSecretPath(args: {
  stage: string;
  tenantId: string;
  userId: string;
  connectionType: string;
}): string {
  return `thinkwork/${args.stage}/sandbox/${args.tenantId}/${args.userId}/oauth/${args.connectionType}`;
}

/**
 * Write fresh per-invocation sandbox secrets. Throws
 * ConnectionRevokedError when the close-to-use recheck sees an
 * expired/revoked connection — the caller should surface
 * ConnectionRevoked to the agent and skip tool invocation.
 */
export async function writeSandboxSecrets(
  input: WriteSandboxSecretsInput,
): Promise<WriteSandboxSecretsResult> {
  const resolve = input.resolveTokenForUserProvider ?? defaultResolveToken;
  const secretPaths: Record<string, string> = {};

  for (const connectionType of input.requiredConnections) {
    if (!SANDBOX_ALLOWED_CONNECTION_TYPES.includes(connectionType)) {
      throw new Error(
        `Unknown connection_type '${connectionType}'; allowed: ${SANDBOX_ALLOWED_CONNECTION_TYPES.join(", ")}`,
      );
    }

    const resolved = await resolve(
      input.tenantId,
      input.userId,
      connectionType,
    );
    if (!resolved) {
      throw new ConnectionRevokedError(
        connectionType,
        `No active ${connectionType} connection for user; refresh failed or never connected.`,
      );
    }

    // Close-to-use recheck — connections.status may have flipped to
    // 'expired' since the pre-flight check ran.
    await rechecConnectionStatus(resolved.connectionId, connectionType);

    const path = buildSandboxSecretPath({
      stage: input.stage,
      tenantId: input.tenantId,
      userId: input.userId,
      connectionType,
    });

    await putSecret(path, resolved.accessToken);
    secretPaths[connectionType] = path;
  }

  return {
    secretPaths: secretPaths as Record<SandboxConnectionType, string>,
  };
}

/**
 * Best-effort cleanup of the per-session sandbox secrets. Called from
 * the dispatcher in the same try/finally that stops the sandbox
 * session — bounds the exposure window to session lifetime (minutes),
 * not until the next invocation overwrites (hours).
 *
 * Log-and-continue on failure: orphaned secrets are harmless (they
 * hold expired/already-rotated tokens) and the next session write
 * overwrites them anyway.
 */
export async function deleteSandboxSecrets(args: {
  stage: string;
  tenantId: string;
  userId: string;
  connectionTypes: string[];
}): Promise<{ deleted: string[]; failed: string[] }> {
  const deleted: string[] = [];
  const failed: string[] = [];
  for (const connectionType of args.connectionTypes) {
    const path = buildSandboxSecretPath({
      stage: args.stage,
      tenantId: args.tenantId,
      userId: args.userId,
      connectionType,
    });
    try {
      await sm.send(
        new DeleteSecretCommand({
          SecretId: path,
          ForceDeleteWithoutRecovery: true,
        }),
      );
      deleted.push(connectionType);
    } catch (err) {
      if (err instanceof ResourceNotFoundException) {
        deleted.push(connectionType); // already gone
      } else {
        console.error(
          `[sandbox-secrets] DeleteSecret failed for connection ${connectionType}:`,
          err,
        );
        failed.push(connectionType);
      }
    }
  }
  return { deleted, failed };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function putSecret(path: string, value: string): Promise<void> {
  // Update-first, fall back to create on ResourceNotFound — avoids the
  // race where two concurrent invocations both see "not found" and
  // both try to Create.
  try {
    await sm.send(
      new PutSecretValueCommand({ SecretId: path, SecretString: value }),
    );
    return;
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }
  try {
    await sm.send(
      new CreateSecretCommand({
        Name: path,
        SecretString: value,
        Description: "AgentCore Code Sandbox session OAuth token",
      }),
    );
  } catch (err) {
    if (err instanceof ResourceExistsException) {
      // Lost the race, try the update path one more time.
      await sm.send(
        new UpdateSecretCommand({
          SecretId: path,
          SecretString: value,
        }),
      );
      return;
    }
    throw err;
  }
}

async function rechecConnectionStatus(
  connectionId: string,
  connectionType: string,
): Promise<void> {
  const db = getDb();
  const { connections } = schema;
  const [row] = await db
    .select({ status: connections.status })
    .from(connections)
    .where(eq(connections.id, connectionId))
    .limit(1);
  if (!row) {
    throw new ConnectionRevokedError(
      connectionType,
      `Connection ${connectionId} disappeared between pre-flight and secret write.`,
    );
  }
  if (row.status !== "active") {
    throw new ConnectionRevokedError(
      connectionType,
      `Connection ${connectionId} flipped to status '${row.status}' during the invocation.`,
    );
  }
}

async function defaultResolveToken(
  tenantId: string,
  userId: string,
  providerName: string,
): Promise<{ accessToken: string; connectionId: string } | null> {
  // Lazy-import so tests can inject a resolver without pulling in
  // oauth-token's transitive AWS/DB imports.
  const { resolveConnectionForUser, resolveOAuthToken } =
    await import("./oauth-token.js");
  const active = await resolveConnectionForUser(tenantId, userId, providerName);
  if (!active) return null;
  const token = await resolveOAuthToken(
    active.connectionId,
    tenantId,
    active.providerId,
  );
  if (!token) return null;
  return { accessToken: token, connectionId: active.connectionId };
}
