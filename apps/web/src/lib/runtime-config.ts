type RuntimeEnvKey =
  | "VITE_API_URL"
  | "VITE_GRAPHQL_HTTP_URL"
  | "VITE_GRAPHQL_URL"
  | "VITE_GRAPHQL_WS_URL"
  | "VITE_GRAPHQL_API_KEY"
  | "VITE_COGNITO_DOMAIN"
  | "VITE_COGNITO_USER_POOL_ID"
  | "VITE_COGNITO_CLIENT_ID"
  | "VITE_DEPLOYMENT_ID"
  | "VITE_DEPLOYMENT_DISPLAY_NAME"
  | "VITE_DEPLOYMENT_PROFILE_ISSUED_AT"
  | "VITE_SPACES_URL"
  | "VITE_STAGE"
  | "VITE_AWS_REGION";

type RuntimeEnv = Partial<Record<RuntimeEnvKey, string>>;
type ImportMetaEnvSnapshot = ImportMetaEnv &
  Record<string, string | boolean | undefined>;

interface RuntimeConfigFile {
  viteEnv?: Record<string, unknown>;
}

let runtimeEnv: RuntimeEnv = {};
let loadPromise: Promise<RuntimeEnv> | null = null;

export function readRuntimeEnv(key: RuntimeEnvKey): string {
  return runtimeEnv[key] ?? stringValue(import.meta.env[key]);
}

export function getRuntimeEnvSnapshot(): ImportMetaEnvSnapshot {
  return {
    ...(import.meta.env as ImportMetaEnvSnapshot),
    ...runtimeEnv,
  };
}

export async function loadRuntimeConfig(): Promise<RuntimeEnv> {
  if (loadPromise) return loadPromise;
  loadPromise = fetchRuntimeConfig().then((env) => {
    runtimeEnv = env;
    return runtimeEnv;
  });
  return loadPromise;
}

export function setRuntimeConfigForTest(env: RuntimeEnv): void {
  runtimeEnv = { ...env };
  loadPromise = Promise.resolve(runtimeEnv);
}

async function fetchRuntimeConfig(): Promise<RuntimeEnv> {
  if (typeof window === "undefined") return {};
  try {
    const response = await fetch("/thinkwork-runtime-config.json", {
      cache: "no-store",
    });
    if (!response.ok) return {};
    const raw = (await response.json()) as RuntimeConfigFile;
    return normalizeRuntimeEnv(raw.viteEnv);
  } catch {
    return {};
  }
}

function normalizeRuntimeEnv(raw: Record<string, unknown> | undefined) {
  const env: RuntimeEnv = {};
  if (!raw) return env;
  for (const [key, value] of Object.entries(raw)) {
    if (!isRuntimeEnvKey(key) || typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) env[key] = trimmed;
  }
  return env;
}

function isRuntimeEnvKey(key: string): key is RuntimeEnvKey {
  return key.startsWith("VITE_");
}

function stringValue(value: string | boolean | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}
