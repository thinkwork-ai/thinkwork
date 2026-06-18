/**
 * Public auth options endpoint (THNK-43 U4).
 *
 * Login clients need an unauthenticated, public-safe projection of available
 * auth controls. This handler resolves tenant-scoped WorkOS options only from
 * API Gateway's trusted domainName and fails closed for shared/unknown hosts.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { and, eq, inArray } from "drizzle-orm";
import { domainToASCII } from "node:url";
import {
  authProviderResources,
  pluginComponents,
  pluginInstalls,
  tenantAuthProviderReferences,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../lib/db.js";
import { handleCors } from "../lib/response.js";

type DbLike = typeof defaultDb;

export interface PublicAuthOptionsResponse {
  password: { enabled: boolean };
  oauthOptions: PublicOAuthOption[];
}

export interface PublicOAuthOption {
  key: string;
  label: string;
  icon: "sso" | "google" | "microsoft";
  provider: "workos";
  providerSpecific: boolean;
  cognitoIdentityProviderName: string;
  route: {
    type: "cognitoHostedUi";
    identityProvider: string;
  };
}

interface AuthProviderPublication {
  displayName: string;
  cognitoIdentityProviderName: string;
  publicOptionMode: string;
  providerOptions: Array<Record<string, unknown>>;
  publicOptionLabel: string;
  hostnames: string[];
  componentHandlerRef: Record<string, unknown>;
}

export interface PublicAuthOptionsDeps {
  loadPublicationForHost(host: string): Promise<AuthProviderPublication | null>;
  passwordSignInEnabled(): boolean;
}

export function createPublicAuthOptionsHandler(
  deps: PublicAuthOptionsDeps = createDefaultPublicAuthOptionsDeps(),
) {
  return async function publicAuthOptionsHandler(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const preflight = handleCors(event);
    if (preflight) return preflight;

    if (event.requestContext.http.method !== "GET") {
      return publicJson({ error: "Method not allowed" }, 405);
    }
    if (event.rawPath !== "/api/auth/options") {
      return publicJson({ error: "Not found" }, 404);
    }

    try {
      const options = await resolvePublicAuthOptions({
        trustedDomainName: event.requestContext.domainName,
        deps,
      });
      return publicJson(options);
    } catch (error) {
      console.error("[public-auth-options] failed:", error);
      return publicJson(defaultOptions(deps), 200);
    }
  };
}

export const handler = createPublicAuthOptionsHandler();

export async function resolvePublicAuthOptions(args: {
  trustedDomainName?: string;
  deps?: PublicAuthOptionsDeps;
}): Promise<PublicAuthOptionsResponse> {
  const deps = args.deps ?? createDefaultPublicAuthOptionsDeps();
  const base = defaultOptions(deps);
  const host = normalizeTrustedHost(args.trustedDomainName);
  if (!host) return base;

  const publication = await deps.loadPublicationForHost(host);
  if (!publication) return base;

  const option = publicOption(publication);
  if (!option) return base;
  return { ...base, oauthOptions: [option] };
}

export function createDefaultPublicAuthOptionsDeps(
  db: DbLike = defaultDb,
): PublicAuthOptionsDeps {
  return {
    loadPublicationForHost: (host) => loadPublicationForHost(host, db),
    passwordSignInEnabled: () =>
      process.env.THINKWORK_PASSWORD_SIGN_IN_ENABLED !== "false",
  };
}

function defaultOptions(
  deps: Pick<PublicAuthOptionsDeps, "passwordSignInEnabled">,
): PublicAuthOptionsResponse {
  return {
    password: { enabled: deps.passwordSignInEnabled() },
    oauthOptions: [],
  };
}

async function loadPublicationForHost(
  host: string,
  db: DbLike,
): Promise<AuthProviderPublication | null> {
  const rows = await db
    .select({
      displayName: authProviderResources.display_name,
      cognitoIdentityProviderName:
        authProviderResources.cognito_identity_provider_name,
      publicOptionMode: authProviderResources.public_option_mode,
      providerOptions: authProviderResources.provider_options,
      publicOptionLabel: tenantAuthProviderReferences.public_option_label,
      hostnames: tenantAuthProviderReferences.hostnames,
      componentHandlerRef: pluginComponents.handler_ref,
    })
    .from(tenantAuthProviderReferences)
    .innerJoin(
      authProviderResources,
      eq(
        tenantAuthProviderReferences.auth_provider_resource_id,
        authProviderResources.id,
      ),
    )
    .innerJoin(
      pluginInstalls,
      eq(tenantAuthProviderReferences.plugin_install_id, pluginInstalls.id),
    )
    .innerJoin(
      pluginComponents,
      and(
        eq(pluginComponents.plugin_install_id, pluginInstalls.id),
        eq(pluginComponents.component_type, "auth-provider"),
      ),
    )
    .where(
      and(
        eq(tenantAuthProviderReferences.status, "enabled"),
        inArray(pluginInstalls.state, ["installed", "partially_installed"]),
        eq(pluginComponents.state, "provisioned"),
        eq(authProviderResources.provider_key, "workos"),
        inArray(authProviderResources.validation_status, [
          "valid",
          "partially_valid",
        ]),
        eq(authProviderResources.public_options_published, true),
      ),
    );

  const matches = rows.filter((row) =>
    row.hostnames.some((candidate) => normalizeTrustedHost(candidate) === host),
  );
  if (matches.length !== 1) return null;
  return matches[0];
}

function publicOption(
  publication: AuthProviderPublication,
): PublicOAuthOption | null {
  if (!componentAllowsPublication(publication.componentHandlerRef)) {
    return null;
  }

  // U1 proved only the single WorkOS-backed SSO fallback. Provider-specific
  // Google/Microsoft buttons stay hidden until a later unit proves routing.
  if (publication.publicOptionMode !== "single_sso") {
    return null;
  }

  const label =
    safeDisplayString(publication.publicOptionLabel) ||
    safeDisplayString(publication.displayName) ||
    "Continue with SSO";

  return {
    key: "workos-sso",
    label,
    icon: "sso",
    provider: "workos",
    providerSpecific: false,
    cognitoIdentityProviderName: publication.cognitoIdentityProviderName,
    route: {
      type: "cognitoHostedUi",
      identityProvider: publication.cognitoIdentityProviderName,
    },
  };
}

function componentAllowsPublication(handlerRef: Record<string, unknown>) {
  return (
    handlerRef.status === "valid" && handlerRef.publicOptionsPublished === true
  );
}

function safeDisplayString(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

export function normalizeTrustedHost(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\.+$/, "");
  if (!trimmed) return null;
  const ascii = domainToASCII(trimmed);
  return ascii ? ascii.toLowerCase() : null;
}

function publicJson(
  body: unknown,
  statusCode = 200,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}
