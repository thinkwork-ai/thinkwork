export type McpOAuthResourceMetadata = {
  resource?: string;
  authorization_servers?: string[];
};

type EnvLike = Record<string, string | undefined>;

const DEFAULT_WEB_RETURN_ORIGINS = [
  "https://app.thinkwork.ai",
  "https://admin.thinkwork.ai",
];

const CONFIGURED_RETURN_URL_KEYS = [
  "SPACES_URL",
  "APP_URL",
  "ADMIN_URL",
  "WEB_APP_URL",
  "PUBLIC_APP_URL",
];

export function resolveMcpOAuthResource(input: {
  serverUrl: string;
  authConfig?: Record<string, unknown> | null;
  resourceMetadata?: McpOAuthResourceMetadata | null;
}): string {
  const configured = stringValue(input.authConfig?.oauth_resource);
  if (configured) return configured.replace(/\/+$/, "");

  const discovered = stringValue(input.resourceMetadata?.resource);
  if (discovered) return discovered.replace(/\/+$/, "");

  return input.serverUrl.replace(/\/+$/, "");
}

export function normalizeMcpOAuthReturnTo(
  rawReturnTo: string | undefined,
  env: EnvLike = process.env,
): string | null {
  if (!rawReturnTo) return null;

  if (rawReturnTo.startsWith("thinkwork://")) {
    return rawReturnTo;
  }

  const baseUrl =
    firstConfiguredReturnOrigin(env) ?? DEFAULT_WEB_RETURN_ORIGINS[0];

  let candidate: URL;
  try {
    candidate = rawReturnTo.startsWith("/")
      ? new URL(rawReturnTo, baseUrl)
      : new URL(rawReturnTo);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(candidate.protocol)) return null;

  if (isLoopbackHost(candidate.hostname)) {
    return candidate.toString();
  }

  if (allowedReturnOrigins(env).has(candidate.origin)) {
    return candidate.toString();
  }

  return null;
}

export function mcpOAuthCompletionUrl(
  returnTo: string | null | undefined,
  status: "success" | "error",
  extras: Record<string, string> = {},
): string {
  if (!returnTo) {
    const params = new URLSearchParams({ status, ...extras });
    return `thinkwork://mcp-oauth-complete?${params.toString()}`;
  }

  const url = new URL(returnTo);
  url.searchParams.set("mcpOAuth", status);
  for (const [key, value] of Object.entries(extras)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function allowedReturnOrigins(env: EnvLike): Set<string> {
  const origins = new Set(DEFAULT_WEB_RETURN_ORIGINS);
  for (const key of CONFIGURED_RETURN_URL_KEYS) {
    const value = env[key];
    if (!value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      // Ignore malformed deployment env vars; they should not open redirects.
    }
  }
  return origins;
}

function firstConfiguredReturnOrigin(env: EnvLike): string | null {
  for (const key of CONFIGURED_RETURN_URL_KEYS) {
    const value = env[key];
    if (!value) continue;
    try {
      return new URL(value).origin;
    } catch {
      // Keep scanning.
    }
  }
  return null;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
