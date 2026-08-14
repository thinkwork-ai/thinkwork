import { getPlatformConfig } from "./platform-config";
import { getActiveEnvironmentEntry } from "./environments/store";

export interface PublicAuthOptions {
  password: { enabled: boolean; clientId?: string };
  oauthOptions: PublicOAuthOption[];
  /** Tenant white-label branding for the pre-auth sign-in screen. */
  branding?: PublicSignInBranding;
}

export interface PublicSignInBranding {
  logoDataUrl: string;
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

export interface PublicAuthOptionsResult {
  options: PublicAuthOptions;
  failed: boolean;
}

export const FALLBACK_AUTH_OPTIONS: PublicAuthOptions = {
  // A failed catalog lookup must not fall back to the deployment-profile
  // client: only a reconciled route-specific client is admitted server-side.
  password: { enabled: false },
  oauthOptions: [],
};

export async function fetchAuthOptionsForActiveEnvironment(
  fetchImpl: typeof fetch = fetch,
): Promise<PublicAuthOptionsResult> {
  try {
    const baseUrl = trimTrailingSlash(getPlatformConfig().apiUrl);
    const url = new URL(`${baseUrl}/api/auth/options`);
    url.searchParams.set("platform", "mobile");
    const environmentHost = getActiveEnvironmentEntry()?.host;
    if (environmentHost) url.searchParams.set("host", environmentHost);
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return { options: FALLBACK_AUTH_OPTIONS, failed: true };
    }
    const options = parsePublicAuthOptions(await response.json());
    if (environmentHost) {
      void writeCachedSignInBranding(environmentHost, options.branding ?? null);
    }
    return { options, failed: false };
  } catch {
    return { options: FALLBACK_AUTH_OPTIONS, failed: true };
  }
}

// Last-known branding per environment host, persisted so the sign-in screen
// shows the tenant logo immediately on later launches instead of flashing
// the default mark while /api/auth/options is in flight. Reconciled (or
// cleared) every time the fetch settles successfully.
const SIGN_IN_BRANDING_CACHE_PREFIX = "thinkwork.signInBranding.v1:";

export async function readCachedSignInBranding(
  host: string | null | undefined,
): Promise<PublicSignInBranding | null> {
  if (!host) return null;
  try {
    const storage = await brandingStorage();
    const raw = await storage?.getItem(
      `${SIGN_IN_BRANDING_CACHE_PREFIX}${host}`,
    );
    if (!raw) return null;
    return parseSignInBranding(JSON.parse(raw)) ?? null;
  } catch {
    return null;
  }
}

async function writeCachedSignInBranding(
  host: string,
  branding: PublicSignInBranding | null,
): Promise<void> {
  const key = `${SIGN_IN_BRANDING_CACHE_PREFIX}${host}`;
  try {
    const storage = await brandingStorage();
    if (!storage) return;
    if (branding) {
      await storage.setItem(key, JSON.stringify(branding));
    } else {
      await storage.removeItem(key);
    }
  } catch {
    // Storage failures just mean no instant logo next launch.
  }
}

async function brandingStorage(): Promise<{
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
} | null> {
  try {
    const module = await import("@react-native-async-storage/async-storage");
    return module.default;
  } catch {
    return null;
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
  const branding = parseSignInBranding(record.branding);
  return { password, oauthOptions, ...(branding ? { branding } : {}) };
}

export function parseSignInBranding(
  raw: unknown,
): PublicSignInBranding | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const logoDataUrl = (raw as Record<string, unknown>).logoDataUrl;
  if (
    typeof logoDataUrl !== "string" ||
    !logoDataUrl.startsWith("data:image/")
  ) {
    return undefined;
  }
  return { logoDataUrl };
}

export interface AuthOptionsUiState {
  loading: boolean;
  failed: boolean;
  options: PublicAuthOptions;
}

export function deriveAuthOptionsDisplay(state: AuthOptionsUiState) {
  const oauthOptions = state.options.oauthOptions;
  const showOAuthButtons = !state.loading && oauthOptions.length > 0;
  const showPasswordForm = state.options.password.enabled;
  return {
    oauthOptions,
    showOAuthButtons,
    showPasswordForm,
    showDivider: showOAuthButtons && showPasswordForm,
    showRetry: !state.loading && state.failed,
    showUnavailable:
      !state.loading && !showOAuthButtons && !showPasswordForm && !state.failed,
  };
}

function parsePassword(raw: unknown): { enabled: boolean; clientId?: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return FALLBACK_AUTH_OPTIONS.password;
  }
  const record = raw as Record<string, unknown>;
  const clientId =
    safeString(record.clientId) ||
    (record.enabled === true ? getPlatformConfig().cognitoClientId.trim() : "");
  return {
    enabled: record.enabled !== false && Boolean(clientId),
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
