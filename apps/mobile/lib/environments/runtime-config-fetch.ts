import {
  EnvironmentSetupError,
  environmentSetupError,
  normalizeEnvironmentHost,
  type EnvironmentSetupErrorDetails,
} from "./url-normalize";

export interface EnvironmentRuntimeConfig {
  apiUrl: string;
  graphqlHttpUrl: string;
  graphqlUrl: string;
  graphqlWsUrl: string;
  graphqlApiKey?: string;
  cognitoDomain: string;
  cognitoUserPoolId: string;
  cognitoClientId: string;
  deploymentId: string;
  displayName: string;
  stage: string;
  region: string;
}

export type EnvironmentRuntimeConfigResult =
  | { ok: true; config: EnvironmentRuntimeConfig; host: string }
  | { ok: false; error: EnvironmentSetupErrorDetails };

const RUNTIME_CONFIG_PATH = "/thinkwork-runtime-config.json";
const FETCH_TIMEOUT_MS = 10_000;
const NO_CONFIG_MESSAGE =
  "This environment hasn't published mobile config; redeploy with a current CLI.";

export async function fetchEnvironmentRuntimeConfig(
  host: string,
): Promise<EnvironmentRuntimeConfigResult> {
  let normalizedHost: string;
  try {
    normalizedHost = normalizeEnvironmentHost(host);
  } catch (error) {
    return {
      ok: false,
      error: setupErrorFromUnknown(
        error,
        "invalid-url",
        "Enter a valid ThinkWork environment URL.",
      ),
    };
  }

  try {
    const raw = await fetchRuntimeConfigJson(normalizedHost);
    const config = mapEnvironmentRuntimeConfig(raw);
    const missing = missingRequiredFields(config);
    if (missing.length > 0) {
      return {
        ok: false,
        error: environmentSetupError(
          "malformed",
          `Runtime config is missing required fields: ${missing.join(", ")}.`,
        ),
      };
    }
    return { ok: true, config, host: normalizedHost };
  } catch (error) {
    return {
      ok: false,
      error: setupErrorFromUnknown(
        error,
        "unreachable",
        "Could not reach this ThinkWork environment.",
      ),
    };
  }
}

function mapEnvironmentRuntimeConfig(raw: unknown): EnvironmentRuntimeConfig {
  const record = objectRecord(raw);
  const viteEnv = objectRecord(record.viteEnv);

  return {
    apiUrl: pick(viteEnv, "VITE_API_URL") || pick(record, "apiEndpoint"),
    graphqlHttpUrl:
      pick(viteEnv, "VITE_GRAPHQL_HTTP_URL") ||
      pick(record, "graphqlHttpUrl"),
    graphqlUrl: pick(viteEnv, "VITE_GRAPHQL_URL") || pick(record, "appsyncUrl"),
    graphqlWsUrl:
      pick(viteEnv, "VITE_GRAPHQL_WS_URL") ||
      pick(record, "appsyncRealtimeUrl"),
    graphqlApiKey:
      pick(viteEnv, "VITE_GRAPHQL_API_KEY") ||
      pick(record, "appsyncApiKey") ||
      undefined,
    cognitoDomain:
      pick(viteEnv, "VITE_COGNITO_DOMAIN") ||
      pick(record, "cognitoDomain"),
    cognitoUserPoolId:
      pick(viteEnv, "VITE_COGNITO_USER_POOL_ID") ||
      pick(record, "cognitoUserPoolId"),
    cognitoClientId:
      pick(viteEnv, "VITE_COGNITO_CLIENT_ID") ||
      pick(record, "cognitoClientId"),
    deploymentId:
      pick(viteEnv, "VITE_DEPLOYMENT_ID") || pick(record, "deploymentId"),
    displayName:
      pick(viteEnv, "VITE_DEPLOYMENT_DISPLAY_NAME") ||
      pick(record, "displayName"),
    stage: pick(viteEnv, "VITE_STAGE") || pick(record, "stage"),
    region: pick(viteEnv, "VITE_AWS_REGION") || pick(record, "region"),
  };
}

async function fetchRuntimeConfigJson(host: string): Promise<unknown> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(
        new EnvironmentSetupError(
          "unreachable",
          "Timed out while reaching this ThinkWork environment.",
        ),
      );
    }, FETCH_TIMEOUT_MS);
  });

  try {
    const response = await Promise.race([
      fetch(`${host}${RUNTIME_CONFIG_PATH}`, { signal: controller.signal }),
      timeout,
    ]);

    if (response.status === 404) {
      throw new EnvironmentSetupError("no-config-published", NO_CONFIG_MESSAGE);
    }
    if (!response.ok) {
      throw new EnvironmentSetupError(
        "unreachable",
        `Could not fetch runtime config: HTTP ${response.status}.`,
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    if (contentType.toLowerCase().includes("text/html")) {
      throw new EnvironmentSetupError("no-config-published", NO_CONFIG_MESSAGE);
    }

    try {
      return JSON.parse(body);
    } catch {
      throw new EnvironmentSetupError("no-config-published", NO_CONFIG_MESSAGE);
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function missingRequiredFields(config: EnvironmentRuntimeConfig): string[] {
  const missing: string[] = [];
  if (!config.apiUrl.trim()) missing.push("apiUrl");
  if (!config.graphqlUrl.trim() && !config.graphqlHttpUrl.trim()) {
    missing.push("graphqlUrl or graphqlHttpUrl");
  }
  if (!config.cognitoUserPoolId.trim()) missing.push("cognitoUserPoolId");
  if (!config.cognitoClientId.trim()) missing.push("cognitoClientId");
  if (!config.cognitoDomain.trim()) missing.push("cognitoDomain");
  return missing;
}

function setupErrorFromUnknown(
  error: unknown,
  fallbackKind: EnvironmentSetupErrorDetails["kind"],
  fallbackMessage: string,
): EnvironmentSetupErrorDetails {
  if (error instanceof EnvironmentSetupError) {
    return environmentSetupError(error.kind, error.message);
  }
  return environmentSetupError(fallbackKind, fallbackMessage);
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pick(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}
