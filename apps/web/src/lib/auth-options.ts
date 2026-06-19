import { readRuntimeEnv } from "./runtime-config";

export interface PublicAuthOptions {
  password: { enabled: boolean };
  oauthOptions: PublicOAuthOption[];
}

export interface PublicOAuthOption {
  key: string;
  label: string;
  icon: "sso" | "google" | "microsoft";
  provider: "workos";
  providerSpecific: boolean;
  route: {
    type: "workosAuthorize";
    authorizePath: "/api/auth/workos/authorize";
    prompt?: string;
  };
}

const FALLBACK_AUTH_OPTIONS: PublicAuthOptions = {
  password: { enabled: true },
  oauthOptions: [],
};

export async function fetchPublicAuthOptions(
  fetchImpl: typeof fetch = fetch,
): Promise<PublicAuthOptions> {
  try {
    const response = await fetchImpl(`${apiBaseUrl()}/api/auth/options`, {
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
  const oauthOptions = Array.isArray(record.oauthOptions)
    ? record.oauthOptions.flatMap((entry) => {
        const option = parseOAuthOption(entry);
        return option ? [option] : [];
      })
    : [];
  return { password, oauthOptions };
}

function parsePassword(raw: unknown): { enabled: boolean } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return FALLBACK_AUTH_OPTIONS.password;
  }
  return {
    enabled: (raw as Record<string, unknown>).enabled !== false,
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
  const authorizePath = safeString(routeRecord.authorizePath);
  const prompt = safeString(routeRecord.prompt);

  if (
    !key ||
    !label ||
    !icon ||
    record.provider !== "workos" ||
    typeof record.providerSpecific !== "boolean" ||
    routeRecord.type !== "workosAuthorize" ||
    authorizePath !== "/api/auth/workos/authorize"
  ) {
    return null;
  }

  return {
    key,
    label,
    icon,
    provider: "workos",
    providerSpecific: record.providerSpecific,
    route: {
      type: "workosAuthorize",
      authorizePath,
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
  return value === "sso" || value === "google" || value === "microsoft"
    ? value
    : null;
}
