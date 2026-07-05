import { getPlatformConfig } from "./platform-config";

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

export interface PublicAuthOptionsResult {
  options: PublicAuthOptions;
  failed: boolean;
}

export const FALLBACK_AUTH_OPTIONS: PublicAuthOptions = {
  password: { enabled: true },
  oauthOptions: [],
};

export async function fetchAuthOptionsForActiveEnvironment(
  fetchImpl: typeof fetch = fetch,
): Promise<PublicAuthOptionsResult> {
  try {
    const baseUrl = trimTrailingSlash(getPlatformConfig().apiUrl);
    const response = await fetchImpl(`${baseUrl}/api/auth/options`, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return { options: FALLBACK_AUTH_OPTIONS, failed: true };
    }
    return {
      options: parsePublicAuthOptions(await response.json()),
      failed: false,
    };
  } catch {
    return { options: FALLBACK_AUTH_OPTIONS, failed: true };
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

export interface AuthOptionsUiState {
  loading: boolean;
  failed: boolean;
  options: PublicAuthOptions;
}

export function deriveAuthOptionsDisplay(state: AuthOptionsUiState) {
  const ssoOption = state.options.oauthOptions[0] ?? null;
  const showSsoButton = !state.loading && Boolean(ssoOption);
  const showPasswordForm = state.options.password.enabled;
  return {
    ssoOption,
    showSsoButton,
    showPasswordForm,
    showDivider: showSsoButton && showPasswordForm,
    showRetry: !state.loading && state.failed,
    showUnavailable:
      !state.loading && !showSsoButton && !showPasswordForm && !state.failed,
  };
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
