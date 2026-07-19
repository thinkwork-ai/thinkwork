import { readRuntimeEnv } from "./runtime-config";

export interface PublicAuthOptions {
  password: { enabled: boolean; clientId?: string };
  oauthOptions: PublicOAuthOption[];
  legacyMigration?: { authorizePath: string };
}

export interface PublicOAuthOption {
  key: string;
  label: string;
  icon: "google" | "microsoft";
  provider: "google" | "microsoft" | "entra";
  providerSpecific: true;
  route: {
    type: "cognitoHostedUi";
    clientId: string;
    identityProvider: string;
    prompt?: string;
  };
}

const FALLBACK_AUTH_OPTIONS: PublicAuthOptions = {
  password: { enabled: false },
  oauthOptions: [],
};

export async function fetchPublicAuthOptions(
  fetchImpl: typeof fetch = fetch,
  platform: "web" | "desktop" = "web",
): Promise<PublicAuthOptions> {
  try {
    const url = new URL(
      `${apiBaseUrl()}/api/auth/options`,
      window.location.origin,
    );
    url.searchParams.set("host", window.location.hostname);
    url.searchParams.set("platform", platform);
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return FALLBACK_AUTH_OPTIONS;
    return parsePublicAuthOptions(await response.json());
  } catch {
    return FALLBACK_AUTH_OPTIONS;
  }
}

export function parsePublicAuthOptions(raw: unknown): PublicAuthOptions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return FALLBACK_AUTH_OPTIONS;
  }
  const record = raw as Record<string, unknown>;
  const password = parsePassword(record.password);
  const rawOAuthOptions = Array.isArray(record.oauthOptions)
    ? record.oauthOptions
    : [];
  const oauthOptions = rawOAuthOptions.flatMap((entry) => {
    const option = parseOAuthOption(entry);
    return option ? [option] : [];
  });
  const legacyMigration = parseLegacyMigration(record.legacyMigration);
  return {
    password,
    oauthOptions,
    ...(legacyMigration ? { legacyMigration } : {}),
  };
}

function parseLegacyMigration(
  raw: unknown,
): PublicAuthOptions["legacyMigration"] | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const authorizePath = safeString(
    (raw as Record<string, unknown>).authorizePath,
  );
  return authorizePath === "/api/auth/workos/authorize"
    ? { authorizePath }
    : undefined;
}

function parsePassword(raw: unknown): { enabled: boolean; clientId?: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return FALLBACK_AUTH_OPTIONS.password;
  }
  const record = raw as Record<string, unknown>;
  // During the staged rollout the deployed options endpoint may still return
  // the legacy `{ enabled: true }` password shape. The static deployment
  // profile already contains the exact Cognito app client used by that
  // environment, so preserve local/password access until the control-plane
  // reconciliation starts publishing route-specific client IDs.
  const clientId =
    safeString(record.clientId) ||
    (record.enabled === true ? readRuntimeEnv("VITE_COGNITO_CLIENT_ID") : "");
  return {
    enabled: record.enabled === true && Boolean(clientId),
    ...(clientId ? { clientId } : {}),
  };
}

function parseOAuthOption(raw: unknown): PublicOAuthOption | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const route = record.route;
  if (!route || typeof route !== "object" || Array.isArray(route)) {
    return null;
  }
  const routeRecord = route as Record<string, unknown>;
  const key = safeString(record.key);
  const label = safeString(record.label);
  const icon = safeIcon(record.icon);
  const clientId = safeString(routeRecord.clientId);
  const identityProvider = safeString(routeRecord.identityProvider);
  const prompt = safeString(routeRecord.prompt);

  if (
    !key ||
    !label ||
    !icon ||
    !isNativeProvider(record.provider) ||
    record.providerSpecific !== true ||
    routeRecord.type !== "cognitoHostedUi" ||
    !clientId ||
    !identityProvider
  ) {
    return null;
  }

  return {
    key,
    label,
    icon,
    provider: record.provider,
    providerSpecific: true,
    route: {
      type: "cognitoHostedUi",
      clientId,
      identityProvider,
      ...(prompt ? { prompt } : {}),
    },
  };
}

function apiBaseUrl(): string {
  const explicit = readRuntimeEnv("VITE_API_URL");
  if (explicit) return trimTrailingSlash(explicit);
  const graphql = readRuntimeEnv("VITE_GRAPHQL_HTTP_URL");
  if (graphql) return trimTrailingSlash(graphql.replace(/\/graphql\/?$/, ""));
  return "";
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeIcon(value: unknown): PublicOAuthOption["icon"] | null {
  return value === "google" || value === "microsoft" ? value : null;
}

function isNativeProvider(
  value: unknown,
): value is PublicOAuthOption["provider"] {
  return value === "google" || value === "microsoft" || value === "entra";
}
