/**
 * Plugin app-level OAuth routes (plan 2026-06-12-001 U6), registered by
 * the skills handler router:
 *
 *   GET /api/skills/plugin-oauth/authorize?pluginInstallId=...&returnTo=...
 *       AUTHENTICATED (Bearer / x-api-key). The activating user is the
 *       CANONICAL caller resolved from the auth principal — a userId
 *       query parameter is never read (the legacy per-server mcp-oauth
 *       authorize route trusts ?userId=; this route deliberately does
 *       not). Responds 302 to the authorization server.
 *
 *   GET /api/skills/plugin-oauth/callback?code=...&state=...
 *       PUBLIC (browser redirect from the AS). The HMAC-signed state is
 *       the authenticator: the signature is verified before ANY state
 *       field is consumed, and expired state is rejected. Redirects to
 *       /settings/plugins/{pluginKey}?pluginOAuth=success|error&reason=...
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { and, eq, or } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { pluginInstalls, users } from "@thinkwork/database-pg/schema";
import { GraphQLError } from "graphql";
import type { AuthResult } from "../lib/cognito-auth.js";
import { normalizeMcpOAuthReturnTo } from "../lib/mcp-oauth-client.js";
import {
  completeActivation,
  createDefaultPluginActivationDeps,
  startActivation,
  type PluginActivationDeps,
  type PluginOAuthCompletionResult,
} from "../lib/plugins/activation.js";
import { error, notFound } from "../lib/response.js";

const db = getDb();

const FALLBACK_WEB_ORIGIN = "https://app.thinkwork.ai";

/**
 * Build the web redirect for the callback:
 * /settings/plugins/{pluginKey}?pluginOAuth=success|error&reason=...
 * resolved against the configured web origin (same resolution chain as
 * the per-server mcp-oauth callback's returnTo handling).
 */
export function pluginOAuthCompletionRedirect(
  result: PluginOAuthCompletionResult,
): string {
  const path = result.pluginKey
    ? `/settings/plugins/${result.pluginKey}`
    : "/settings/plugins";
  const base =
    result.returnTo ??
    normalizeMcpOAuthReturnTo(path) ??
    `${FALLBACK_WEB_ORIGIN}${path}`;
  const url = new URL(base);
  url.searchParams.set("pluginOAuth", result.ok ? "success" : "error");
  if (!result.ok) {
    url.searchParams.set("reason", result.reason);
  } else {
    url.searchParams.delete("reason");
  }
  return url.toString();
}

export async function pluginOAuthAuthorize(
  event: APIGatewayProxyEventV2,
  auth: AuthResult,
  deps: PluginActivationDeps = createDefaultPluginActivationDeps(),
): Promise<APIGatewayProxyStructuredResultV2> {
  const qs = event.queryStringParameters || {};
  const pluginInstallId = qs.pluginInstallId;
  if (!pluginInstallId) {
    return error("pluginInstallId is required", 400);
  }

  // Canonical caller binding: ONLY the authenticated principal. Any
  // caller-supplied userId query parameter is ignored entirely.
  const principal = auth.principalId;
  if (!principal) {
    return error(
      "Plugin activation requires a caller identity (no service-only auth)",
      403,
    );
  }

  const [install] = await db
    .select({
      id: pluginInstalls.id,
      tenant_id: pluginInstalls.tenant_id,
    })
    .from(pluginInstalls)
    .where(eq(pluginInstalls.id, pluginInstallId))
    .limit(1);
  if (!install) return notFound("Plugin install not found");

  // Resolve the canonical user row inside the install's tenant — by user
  // id (apikey-asserted principal) or Cognito sub (JWT principal).
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.tenant_id, install.tenant_id),
        or(eq(users.id, principal), eq(users.cognito_sub, principal)),
      ),
    )
    .limit(1);
  if (!user) {
    return error("Caller is not a member of this plugin's tenant", 403);
  }

  const rawReturnTo = qs.returnTo || qs.redirectTo;
  const returnTo = normalizeMcpOAuthReturnTo(rawReturnTo);
  if (rawReturnTo && !returnTo) {
    return error("Invalid plugin OAuth return URL", 400);
  }

  try {
    const { authorizeUrl } = await startActivation(
      {
        userId: user.id,
        tenantId: install.tenant_id,
        pluginInstallId: install.id,
        returnTo,
        apiBaseUrl: event.headers.host
          ? `https://${event.headers.host}`
          : undefined,
      },
      deps,
    );
    return { statusCode: 302, headers: { Location: authorizeUrl }, body: "" };
  } catch (err) {
    const code =
      err instanceof GraphQLError ? String(err.extensions?.code ?? "") : "";
    if (code === "NOT_FOUND") return notFound("Plugin install not found");
    console.error("[plugin-oauth] authorize failed:", err);
    return error(
      err instanceof Error ? err.message : "Plugin OAuth authorize failed",
      code === "FAILED_PRECONDITION" ? 409 : 502,
    );
  }
}

export async function pluginOAuthCallback(
  event: APIGatewayProxyEventV2,
  deps: PluginActivationDeps = createDefaultPluginActivationDeps(),
): Promise<APIGatewayProxyStructuredResultV2> {
  const qs = event.queryStringParameters || {};
  let result: PluginOAuthCompletionResult;
  try {
    result = await completeActivation(
      {
        state: qs.state,
        code: qs.code,
        error: qs.error,
        errorDescription: qs.error_description,
      },
      deps,
    );
  } catch (err) {
    console.error("[plugin-oauth] callback failed:", err);
    result = { ok: false, reason: "activation_failed" };
  }
  return {
    statusCode: 302,
    headers: { Location: pluginOAuthCompletionRedirect(result) },
    body: "",
  };
}
