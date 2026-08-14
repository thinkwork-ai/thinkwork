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
  tenantSettings,
  tenants,
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
  legacyMigration?: { authorizePath: string };
  /** Tenant white-label branding for pre-auth surfaces (mobile sign-in). */
  branding?: PublicSignInBranding;
}

export interface PublicSignInBranding {
  logoDataUrl: string;
}

/** Data-URL logos are capped at 300KB of file bytes on upload; allow base64
 *  expansion plus header slack before treating a stored value as garbage. */
const MAX_LOGO_DATA_URL_LENGTH = 500 * 1024;

export type PublicOAuthOption = NativeAuthOption;

export interface PublicAuthOptionsDeps {
  loadPolicy(
    host: string | null,
    clientFamily: string,
  ): Promise<AuthPolicySnapshot>;
  /** Branding for the host-resolved tenant, or — when the host doesn't map
   *  to a tenant — the deployment's sole tenant if there is exactly one. */
  loadBranding?(tenantId: string | null): Promise<PublicSignInBranding | null>;
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
  const snapshot = await deps.loadPolicy(host ?? null, clientFamily);
  const resolved = resolveNativeAuthPolicy(snapshot, clientFamily);
  const branding = deps.loadBranding
    ? await deps.loadBranding(
        snapshot.scope === "tenant" ? (snapshot.tenantId ?? null) : null,
      )
    : null;
  return {
    ...resolved,
    ...(branding ? { branding } : {}),
    ...(process.env.AUTH_RETIREMENT_PHASE === "coexistence"
      ? {
          legacyMigration: {
            authorizePath: "/api/auth/workos/authorize",
          },
        }
      : {}),
  };
}

export function createDefaultPublicAuthOptionsDeps(
  db: DbLike = defaultDb,
): PublicAuthOptionsDeps {
  return {
    loadPolicy: (host, clientFamily) => loadPolicy(host, clientFamily, db),
    loadBranding: (tenantId) => loadBranding(tenantId, db),
  };
}

async function loadBranding(
  tenantId: string | null,
  db: DbLike,
): Promise<PublicSignInBranding | null> {
  const brandingTenantId = tenantId ?? (await soleTenantId(db));
  if (!brandingTenantId) return null;
  const rows = await db
    .select({ features: tenantSettings.features })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenant_id, brandingTenantId))
    .limit(1);
  return publicSignInBrandingFromFeatures(rows[0]?.features);
}

/** The deployment's only tenant, or null when there are zero or several —
 *  a multi-tenant deployment has no unambiguous pre-auth branding. */
async function soleTenantId(db: DbLike): Promise<string | null> {
  const rows = await db.select({ id: tenants.id }).from(tenants).limit(2);
  return rows.length === 1 ? rows[0].id : null;
}

export function publicSignInBrandingFromFeatures(
  features: unknown,
): PublicSignInBranding | null {
  if (typeof features === "string") {
    try {
      features = JSON.parse(features);
    } catch {
      return null;
    }
  }
  if (typeof features !== "object" || features === null) return null;
  const branding = (features as Record<string, unknown>).branding;
  if (typeof branding !== "object" || branding === null) return null;
  const logoDataUrl = (branding as Record<string, unknown>).logoDataUrl;
  if (
    typeof logoDataUrl !== "string" ||
    !logoDataUrl.startsWith("data:image/") ||
    logoDataUrl.length > MAX_LOGO_DATA_URL_LENGTH
  ) {
    return null;
  }
  return { logoDataUrl };
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
