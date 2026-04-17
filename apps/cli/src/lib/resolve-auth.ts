/**
 * Resolve auth headers for a command targeting a given stage.
 *
 * Two modes:
 *
 *   cognito   — preferred for interactive users. The id_token from
 *               `thinkwork login --stage <s>` goes into `Authorization` and
 *               AppSync / graphql-http's authoriser extracts the Cognito
 *               claims. If the token's within 5 minutes of expiry we
 *               transparently refresh via the stored refresh_token before
 *               returning.
 *
 *   api-key   — for CI / service callers. The static `api_auth_secret` bearer
 *               goes into `Authorization`, and `x-tenant-id` identifies which
 *               workspace to scope reads/writes to. Matches the existing
 *               `resolveApiConfig` path so today's commands keep working.
 *
 * A stage with no stored session falls through to the api-key path via the
 * existing terraform-tfvars / Lambda-env discovery. That keeps the CLI
 * usable out of the box against any deployment the operator can reach.
 */

import {
  loadStageSession,
  saveStageSession,
  type CognitoSession,
  type ApiKeySession,
} from "../cli-config.js";
import { resolveApiConfig } from "../api-client.js";
import { discoverCognitoConfig } from "../cognito-discovery.js";
import { refreshCognitoTokens } from "../cognito-oauth.js";
import { printError } from "../ui.js";

export interface ResolvedAuth {
  mode: "cognito" | "api-key";
  headers: Record<string, string>;
  /** Cognito `sub` claim — only set in cognito mode. */
  principalId?: string;
  tenantId?: string;
  tenantSlug?: string;
}

export interface ResolveAuthOptions {
  stage: string;
  region?: string;
  /**
   * When true, don't fall back to api-key auto-discovery — used by commands
   * that need real user identity (e.g. `thinkwork me`).
   */
  requireCognito?: boolean;
}

/** 5-minute safety window so long-running commands don't see mid-flight expiry. */
const REFRESH_WINDOW_SECONDS = 5 * 60;

export async function resolveAuth(
  opts: ResolveAuthOptions,
): Promise<ResolvedAuth> {
  const region = opts.region ?? "us-east-1";
  const session = loadStageSession(opts.stage);

  if (session?.kind === "cognito") {
    const fresh = await ensureCognitoFresh(opts.stage, session, region);
    return cognitoAuth(fresh);
  }

  if (opts.requireCognito) {
    printError(
      `Stage "${opts.stage}" has no Cognito session. Run \`thinkwork login --stage ${opts.stage}\` (not --api-key — this command needs a user identity).`,
    );
    process.exit(1);
  }

  if (session?.kind === "api-key") {
    return apiKeyAuth(session);
  }

  // Auto-fallback: discover api_auth_secret from the deployed stack. This keeps
  // infra-focused commands working without an explicit `thinkwork login`.
  const api = resolveApiConfig(opts.stage, region);
  if (!api) process.exit(1);
  return {
    mode: "api-key",
    headers: {
      Authorization: `Bearer ${api.authSecret}`,
    },
  };
}

function cognitoAuth(session: CognitoSession): ResolvedAuth {
  return {
    mode: "cognito",
    headers: {
      // graphql-http Lambda reads the id_token from `Authorization` (no
      // `Bearer ` prefix per admin's fetchOptions). Keep the same shape.
      Authorization: session.idToken,
    },
    principalId: session.principalId,
    tenantId: session.tenantId,
    tenantSlug: session.tenantSlug,
  };
}

function apiKeyAuth(session: ApiKeySession): ResolvedAuth {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.authSecret}`,
  };
  if (session.tenantId) headers["x-tenant-id"] = session.tenantId;
  return {
    mode: "api-key",
    headers,
    tenantId: session.tenantId,
    tenantSlug: session.tenantSlug,
  };
}

async function ensureCognitoFresh(
  stage: string,
  session: CognitoSession,
  region: string,
): Promise<CognitoSession> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const safeUntil = session.expiresAt - REFRESH_WINDOW_SECONDS;
  if (nowSeconds < safeUntil) return session;

  // Re-discover Cognito config — cached fields on the session may be stale
  // after a re-deploy (client rotation, domain change).
  const cognito =
    discoverCognitoConfig(stage, region) ?? {
      userPoolId: session.userPoolId,
      clientId: session.userPoolClientId,
      domain: session.cognitoDomain,
      domainUrl: `https://${session.cognitoDomain}.auth.${session.region}.amazoncognito.com`,
      region: session.region,
    };

  try {
    const refreshed = await refreshCognitoTokens(cognito, session.refreshToken);
    const next: CognitoSession = {
      ...session,
      idToken: refreshed.idToken,
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
    };
    saveStageSession(stage, next);
    return next;
  } catch (err) {
    printError(
      `Session refresh failed for stage "${stage}": ${
        err instanceof Error ? err.message : String(err)
      }. Run \`thinkwork login --stage ${stage}\` to sign in again.`,
    );
    process.exit(1);
  }
}
