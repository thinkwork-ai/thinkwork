/** Public, provider-neutral Cognito login catalog. */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { and, eq } from "drizzle-orm";
import { domainToASCII } from "node:url";
import {
  authProviderResources,
  authRouteClients,
  tenantAuthHosts,
  tenantAuthPolicies,
  tenantAuthProviderReferences,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../lib/db.js";
import {
  resolveNativeAuthPolicy,
  type AuthPolicySnapshot,
  type NativeAuthOption,
} from "../lib/auth-provider-policy.js";
import { handleCors } from "../lib/response.js";

type DbLike = typeof defaultDb;

export interface PublicAuthOptionsResponse {
  password: { enabled: boolean; clientId?: string };
  oauthOptions: NativeAuthOption[];
}

export type PublicOAuthOption = NativeAuthOption;

export interface PublicAuthOptionsDeps {
  loadPolicy(
    host: string | null,
    clientFamily: string,
  ): Promise<AuthPolicySnapshot>;
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

    const query = new URLSearchParams(event.rawQueryString ?? "");
    const platform = query.get("platform") || "web";
    if (!["web", "mobile", "desktop", "cli"].includes(platform)) {
      return publicJson(emptyOptions());
    }

    // The requested browser host selects public presentation only. It is not
    // trusted for authorization; authenticated admission checks the route
    // client, exact identity, target tenant, and active membership separately.
    const requestedHost = normalizeTrustedHost(query.get("host") ?? undefined);
    const gatewayHost = normalizeTrustedHost(event.requestContext.domainName);

    try {
      return publicJson(
        await resolvePublicAuthOptions({
          routingHost: requestedHost ?? gatewayHost,
          clientFamily: platform,
          deps,
        }),
      );
    } catch (error) {
      console.error("[public-auth-options] failed:", error);
      return publicJson(emptyOptions(), 200);
    }
  };
}

export const handler = createPublicAuthOptionsHandler();

export async function resolvePublicAuthOptions(args: {
  routingHost?: string | null;
  /** Backward-compatible name for characterization callers. */
  trustedDomainName?: string;
  clientFamily?: string;
  deps?: PublicAuthOptionsDeps;
}): Promise<PublicAuthOptionsResponse> {
  const deps = args.deps ?? createDefaultPublicAuthOptionsDeps();
  const host =
    args.routingHost === undefined
      ? normalizeTrustedHost(args.trustedDomainName)
      : args.routingHost;
  const clientFamily = args.clientFamily ?? "web";
  return resolveNativeAuthPolicy(
    await deps.loadPolicy(host ?? null, clientFamily),
    clientFamily,
  );
}

export function createDefaultPublicAuthOptionsDeps(
  db: DbLike = defaultDb,
): PublicAuthOptionsDeps {
  return {
    loadPolicy: (host, clientFamily) => loadPolicy(host, clientFamily, db),
  };
}

async function loadPolicy(
  host: string | null,
  clientFamily: string,
  db: DbLike,
): Promise<AuthPolicySnapshot> {
  const hostRows = host
    ? await db
        .select({
          tenantId: tenantAuthHosts.tenant_id,
          localPasswordEnabled: tenantAuthPolicies.local_password_enabled,
        })
        .from(tenantAuthHosts)
        .innerJoin(
          tenantAuthPolicies,
          eq(tenantAuthPolicies.tenant_id, tenantAuthHosts.tenant_id),
        )
        .where(
          and(
            eq(tenantAuthHosts.hostname, host),
            eq(tenantAuthHosts.status, "verified"),
            eq(tenantAuthPolicies.status, "active"),
          ),
        )
    : [];

  if (hostRows.length > 1) {
    return {
      scope: "ambiguous",
      localPasswordEnabled: false,
      routes: [],
      connections: [],
    };
  }

  const routeRows = await db
    .select({
      routeKey: authRouteClients.route_key,
      clientFamily: authRouteClients.client_family,
      cognitoAppClientId: authRouteClients.cognito_app_client_id,
      providerNames: authRouteClients.provider_names,
      lifecycleState: authRouteClients.lifecycle_state,
      validationStatus: authRouteClients.validation_status,
    })
    .from(authRouteClients)
    .where(eq(authRouteClients.client_family, clientFamily));

  const connectionRows = await db
    .select({
      resourceId: authProviderResources.id,
      connectionKey: authProviderResources.connection_key,
      providerKind: authProviderResources.provider_kind,
      displayName: authProviderResources.display_name,
      cognitoIdentityProviderName:
        authProviderResources.cognito_identity_provider_name,
      cognitoAppClientIds: authProviderResources.cognito_app_client_ids,
      lifecycleState: authProviderResources.lifecycle_state,
      validationStatus: authProviderResources.validation_status,
      publicOptionsPublished: authProviderResources.public_options_published,
      tenantId: tenantAuthProviderReferences.tenant_id,
      tenantReferenceStatus: tenantAuthProviderReferences.status,
      publicOptionLabel: tenantAuthProviderReferences.public_option_label,
    })
    .from(authProviderResources)
    .leftJoin(
      tenantAuthProviderReferences,
      eq(
        tenantAuthProviderReferences.auth_provider_resource_id,
        authProviderResources.id,
      ),
    );

  const tenant = hostRows[0];
  return {
    scope: tenant ? "tenant" : "deployment",
    ...(tenant ? { tenantId: tenant.tenantId } : {}),
    localPasswordEnabled: tenant
      ? tenant.localPasswordEnabled
      : process.env.THINKWORK_PASSWORD_SIGN_IN_ENABLED !== "false",
    routes: routeRows,
    connections: connectionRows,
  };
}

function emptyOptions(): PublicAuthOptionsResponse {
  return { password: { enabled: false }, oauthOptions: [] };
}

export function normalizeTrustedHost(value: string | undefined): string | null {
  if (!value) return null;
  const withoutPort = value.trim().replace(/:\d+$/, "").replace(/\.+$/, "");
  if (!withoutPort) return null;
  const ascii = domainToASCII(withoutPort);
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
