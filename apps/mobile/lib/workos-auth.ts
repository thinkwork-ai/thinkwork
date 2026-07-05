import type { OAuthTokens } from "./auth";
import type { PublicOAuthOption } from "./auth-options";

export const WORKOS_MOBILE_REDIRECT_URI = "thinkwork://oauth/callback";

export class WorkosAuthError extends Error {
  constructor(
    message: string,
    readonly code:
      | "missing_bridge_code"
      | "bridge_expired"
      | "bridge_exchange_failed"
      | "malformed_tokens",
  ) {
    super(message);
    this.name = "WorkosAuthError";
  }
}

export function buildWorkosAuthorizeUrl(
  option: PublicOAuthOption,
  apiUrl: string,
): string {
  const params = new URLSearchParams({
    redirect_uri: WORKOS_MOBILE_REDIRECT_URI,
  });
  if (option.route.prompt) params.set("prompt", option.route.prompt);
  return `${trimTrailingSlash(apiUrl)}${option.route.authorizePath}?${params.toString()}`;
}

export function parseWorkosCallbackUrl(url: string): {
  bridgeCode: string;
  next: string | null;
} {
  const withoutFragment = url.split("#", 1)[0] ?? "";
  const queryStart = withoutFragment.indexOf("?");
  const query = queryStart >= 0 ? withoutFragment.slice(queryStart + 1) : "";
  return parseWorkosCallbackParams(
    Object.fromEntries(
      query
        .split("&")
        .filter(Boolean)
        .map((pair) => {
          const [rawKey = "", rawValue = ""] = pair.split("=", 2);
          return [decodeParam(rawKey), decodeParam(rawValue)];
        }),
    ),
  );
}

export function parseWorkosCallbackParams(params: {
  workos_bridge?: string | string[] | null;
  next?: string | string[] | null;
}): { bridgeCode: string; next: string | null } {
  const bridgeCode = firstParam(params.workos_bridge)?.trim();
  if (!bridgeCode) {
    throw new WorkosAuthError(
      "No WorkOS bridge code in callback URL.",
      "missing_bridge_code",
    );
  }
  return {
    bridgeCode,
    next: firstParam(params.next),
  };
}

export async function exchangeWorkosBridgeCode(
  bridgeCode: string,
  apiUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OAuthTokens> {
  const response = await fetchImpl(
    `${trimTrailingSlash(apiUrl)}/api/auth/workos/bridge`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ bridge_code: bridgeCode }),
    },
  );

  const body = await readJsonObject(response);
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) {
      throw new WorkosAuthError(
        "Sign-in link expired or already used. Please try again.",
        "bridge_expired",
      );
    }
    throw new WorkosAuthError(
      readableError(body) || "Unable to complete sign-in.",
      "bridge_exchange_failed",
    );
  }

  const idToken = body.id_token;
  const accessToken = body.access_token;
  const refreshToken = body.refresh_token;
  if (
    typeof idToken !== "string" ||
    !idToken ||
    typeof accessToken !== "string" ||
    !accessToken ||
    typeof refreshToken !== "string" ||
    !refreshToken
  ) {
    throw new WorkosAuthError(
      "Unable to complete sign-in.",
      "malformed_tokens",
    );
  }

  return {
    id_token: idToken,
    access_token: accessToken,
    refresh_token: refreshToken,
  };
}

async function readJsonObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const body = await response.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // Fall through to an empty object; callers choose the user-facing error.
  }
  return {};
}

function readableError(body: Record<string, unknown>): string | null {
  return typeof body.error === "string" && body.error.trim()
    ? body.error.trim()
    : null;
}

function firstParam(value?: string | string[] | null): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
