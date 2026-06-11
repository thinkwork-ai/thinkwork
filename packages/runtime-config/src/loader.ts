/**
 * Runtime configuration loader (plan 2026-06-11-006).
 *
 * Non-identity config lives in one terraform-owned SSM parameter per stage
 * (`/thinkwork/<stage>/runtime-config`, a JSON document) instead of Lambda
 * environment variables, so the hard 4KB env ceiling (#2375) stops being a
 * class of production incident. Secrets never enter the document — they
 * resolve from Secrets Manager.
 *
 * Resolution order for `getConfig` is env → cached SSM document → default.
 * Env-wins preserves vitest env stubbing, local dev, and per-function
 * operator overrides in incidents, and makes reader migration mechanical:
 * a reader switched to `getConfig("X")` behaves identically wherever the
 * env key still exists.
 *
 * Reads prefer the AWS Parameters and Secrets Lambda Extension
 * (localhost:2773, container-lifetime cache) and fall back to one SDK call
 * when the extension is absent (local dev, vitest, layer outage).
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_EXTENSION_PORT = 2773;
const EXTENSION_TIMEOUT_MS = 3_000;

type ConfigDocument = Record<string, string>;

type LoaderState = {
  doc: ConfigDocument | null;
  loadedAt: number;
  ttlMs: number;
  inflight: Promise<void> | null;
  warnedLoadFailure: boolean;
  warnedMissingParam: boolean;
  secrets: Map<string, { value: string; loadedAt: number }>;
  secretInflight: Map<string, Promise<string>>;
};

const state: LoaderState = {
  doc: null,
  loadedAt: 0,
  ttlMs: DEFAULT_TTL_MS,
  inflight: null,
  warnedLoadFailure: false,
  warnedMissingParam: false,
  secrets: new Map(),
  secretInflight: new Map(),
};

function envValue(key: string): string | undefined {
  const value = process.env[key];
  // Terraform wires some keys as "" when a feature is disabled; readers
  // treat that as unset (the `process.env.X || ...` idiom), so the merge
  // layer must fall through to the document rather than pin "".
  return value === undefined || value === "" ? undefined : value;
}

function runtimeConfigParameterName(): string | null {
  const explicit = envValue("THINKWORK_RUNTIME_CONFIG_PARAM");
  if (explicit) return explicit;
  const stage = envValue("STAGE");
  return stage ? `/thinkwork/${stage}/runtime-config` : null;
}

function extensionBaseUrl(): string | null {
  // The extension only runs inside Lambda and authenticates with the
  // container's session token; both must be present to try it.
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME || !process.env.AWS_SESSION_TOKEN) {
    return null;
  }
  const port =
    envValue("PARAMETERS_SECRETS_EXTENSION_HTTP_PORT") ?? String(DEFAULT_EXTENSION_PORT);
  return `http://localhost:${port}`;
}

async function extensionGet(path: string): Promise<unknown> {
  const base = extensionBaseUrl();
  if (!base) throw new Error("parameters-and-secrets extension not available");
  const response = await fetch(`${base}${path}`, {
    headers: { "X-Aws-Parameters-Secrets-Token": process.env.AWS_SESSION_TOKEN ?? "" },
    signal: AbortSignal.timeout(EXTENSION_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`extension responded ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

// Memoized dynamic imports: concurrent first-time callers (e.g. the two
// platform-secret prefetches at cold start) share one module load instead
// of racing the module loader.
let ssmModule: Promise<typeof import("@aws-sdk/client-ssm")> | null = null;
function loadSsmModule() {
  return (ssmModule ??= import("@aws-sdk/client-ssm"));
}

let secretsModule: Promise<typeof import("@aws-sdk/client-secrets-manager")> | null = null;
function loadSecretsModule() {
  return (secretsModule ??= import("@aws-sdk/client-secrets-manager"));
}

function isParameterNotFound(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? "";
  const message = error instanceof Error ? error.message : String(error);
  return name === "ParameterNotFound" || message.includes("ParameterNotFound");
}

async function fetchParameterValue(parameterName: string): Promise<string | null> {
  if (extensionBaseUrl()) {
    try {
      const payload = (await extensionGet(
        `/systemsmanager/get?name=${encodeURIComponent(parameterName)}&withDecryption=true`,
      )) as { Parameter?: { Value?: string } };
      return payload.Parameter?.Value ?? null;
    } catch (error) {
      if (isParameterNotFound(error)) return null;
      // Layer outage or first-boot race — fall through to the SDK.
    }
  }
  const { SSMClient, GetParameterCommand } = await loadSsmModule();
  const client = new SSMClient({});
  try {
    const result = await client.send(
      new GetParameterCommand({ Name: parameterName, WithDecryption: true }),
    );
    return result.Parameter?.Value ?? null;
  } catch (error) {
    if (isParameterNotFound(error)) return null;
    throw error;
  }
}

async function loadDocument(): Promise<void> {
  const parameterName = runtimeConfigParameterName();
  if (!parameterName) {
    // Env-only mode (vitest, local tools without a stage). Everything
    // resolves from process.env and defaults; nothing to load.
    state.doc = {};
    state.loadedAt = Date.now();
    return;
  }
  try {
    const raw = await fetchParameterValue(parameterName);
    if (raw === null) {
      if (!state.warnedMissingParam) {
        state.warnedMissingParam = true;
        console.warn(
          `[runtime-config] parameter ${parameterName} not found; serving env vars and defaults only`,
        );
      }
      state.doc = state.doc ?? {};
      state.loadedAt = Date.now();
      return;
    }
    state.doc = JSON.parse(raw) as ConfigDocument;
    state.loadedAt = Date.now();
  } catch (error) {
    if (!state.warnedLoadFailure) {
      state.warnedLoadFailure = true;
      console.warn(
        `[runtime-config] failed to load ${parameterName}; serving env vars and defaults only`,
        error,
      );
    }
    // Keep any previously loaded document; otherwise degrade to env-only.
    state.doc = state.doc ?? {};
    state.loadedAt = Date.now();
  }
}

function isStale(): boolean {
  return state.doc === null || Date.now() - state.loadedAt >= state.ttlMs;
}

function refresh(): Promise<void> {
  if (!state.inflight) {
    state.inflight = loadDocument().finally(() => {
      state.inflight = null;
    });
  }
  return state.inflight;
}

/**
 * Load (or refresh) the runtime-config document. Never throws — a failed
 * load degrades to env-vars-and-defaults and logs once. Call at cold start;
 * the package's index auto-primes inside Lambda.
 */
export async function primeRuntimeConfig(options?: {
  force?: boolean;
  ttlMs?: number;
}): Promise<void> {
  if (options?.ttlMs !== undefined) state.ttlMs = options.ttlMs;
  if (!options?.force && state.doc !== null && !isStale()) return;
  await Promise.all([refresh(), prefetchPlatformSecrets()]);
}

/**
 * Read one config value: `process.env[key]` (treating "" as unset) →
 * cached SSM document → `fallback`. Synchronous against the cache; a stale
 * cache serves the old value and refreshes in the background.
 */
export function getConfig(key: string): string | undefined;
export function getConfig(key: string, fallback: string): string;
export function getConfig(key: string, fallback?: string): string | undefined {
  const fromEnv = envValue(key);
  if (fromEnv !== undefined) return fromEnv;
  if (state.doc !== null && isStale()) void refresh();
  return state.doc?.[key] ?? fallback;
}

/**
 * Read a config value that must exist; throws with the key name when it is
 * absent from both env and the document.
 */
export function requireConfig(key: string): string {
  const value = getConfig(key);
  if (value === undefined) {
    throw new Error(`[runtime-config] required config ${key} is not set`);
  }
  return value;
}

async function fetchSecretValue(secretId: string): Promise<string> {
  if (extensionBaseUrl()) {
    try {
      const payload = (await extensionGet(
        `/secretsmanager/get?secretId=${encodeURIComponent(secretId)}`,
      )) as { SecretString?: string };
      if (payload.SecretString !== undefined) return payload.SecretString;
      throw new Error(`secret ${secretId} has no SecretString`);
    } catch {
      // Fall through to the SDK — secrets are load-bearing, so try both
      // paths before surfacing an error to the caller.
    }
  }
  const { SecretsManagerClient, GetSecretValueCommand } = await loadSecretsModule();
  const client = new SecretsManagerClient({});
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (result.SecretString === undefined) {
    throw new Error(`secret ${secretId} has no SecretString`);
  }
  return result.SecretString;
}

/**
 * Fetch a Secrets Manager secret by name or ARN, cached for the container
 * lifetime (TTL shared with the config document). Unlike `getConfig`, a
 * failed fetch throws — secret readers need real errors, not defaults.
 */
export async function getSecret(secretId: string): Promise<string> {
  const cached = state.secrets.get(secretId);
  if (cached && Date.now() - cached.loadedAt < state.ttlMs) return cached.value;
  const inflight = state.secretInflight.get(secretId);
  if (inflight) return inflight;
  const promise = fetchSecretValue(secretId)
    .then((value) => {
      state.secrets.set(secretId, { value, loadedAt: Date.now() });
      return value;
    })
    .finally(() => {
      state.secretInflight.delete(secretId);
    });
  state.secretInflight.set(secretId, promise);
  return promise;
}

function stageSecretName(suffix: string): string | null {
  const stage = envValue("STAGE");
  return stage ? `thinkwork/${stage}/${suffix}` : null;
}

function cachedSecret(suffix: string): string | undefined {
  const name = stageSecretName(suffix);
  return name ? state.secrets.get(name)?.value : undefined;
}

let warnedSecretPrefetch = false;

/**
 * Prefetch the platform secrets that sync accessors below serve. Runs as
 * part of the Lambda cold-start prime; skipped wherever the env copies
 * still exist (transition window) or outside Lambda. Failures degrade to
 * the env fallback and log once — request-time auth then fails loudly.
 */
async function prefetchPlatformSecrets(): Promise<void> {
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME) return;
  const wanted: string[] = [];
  if (!envValue("THINKWORK_API_SECRET") && !envValue("API_AUTH_SECRET")) {
    wanted.push("api-auth");
  }
  if (!envValue("APPSYNC_API_KEY")) {
    wanted.push("appsync-api-key");
  }
  await Promise.all(
    wanted.map(async (suffix) => {
      const name = stageSecretName(suffix);
      if (!name) return;
      try {
        await getSecret(name);
      } catch (error) {
        if (!warnedSecretPrefetch) {
          warnedSecretPrefetch = true;
          console.warn(`[runtime-config] failed to prefetch secret ${name}`, error);
        }
      }
    }),
  );
}

/**
 * The shared service-auth secret (Bearer token between platform services).
 * Env-wins during the migration window (THINKWORK_API_SECRET is the legacy
 * alias of API_AUTH_SECRET — #2377); once terraform stops injecting the env
 * copies, the value comes from the thinkwork/<stage>/api-auth secret
 * prefetched at cold start. Returns "" when unresolved, matching the
 * legacy `process.env.API_AUTH_SECRET || ""` reader idiom — callers fail
 * with a 401 at request time rather than at import time.
 */
export function getApiAuthSecret(): string {
  return (
    envValue("THINKWORK_API_SECRET") ??
    envValue("API_AUTH_SECRET") ??
    cachedSecret("api-auth") ??
    ""
  );
}

/** AppSync API key for subscription-notify fan-out. Same contract as getApiAuthSecret. */
export function getAppsyncApiKey(): string {
  return envValue("APPSYNC_API_KEY") ?? cachedSecret("appsync-api-key") ?? "";
}

/**
 * Derive an api handler function name from the per-stage naming pattern.
 * Anything shaped `thinkwork-<stage>-api-<name>` is computed, never stored
 * (R7 — #2377 established the pattern with CHAT_AGENT_INVOKE_FN_ARN).
 */
export function deriveFunctionName(shortName: string): string {
  const stage = envValue("STAGE") ?? getConfig("STAGE");
  if (!stage) {
    throw new Error(`[runtime-config] cannot derive function name for ${shortName}: STAGE unset`);
  }
  return `thinkwork-${stage}-api-${shortName}`;
}

/** Derive a full Lambda ARN for an api handler from identity env. */
export function deriveFunctionArn(shortName: string): string {
  const region = envValue("AWS_REGION") ?? envValue("AWS_DEFAULT_REGION");
  const accountId = getConfig("AWS_ACCOUNT_ID");
  if (!region || !accountId) {
    throw new Error(
      `[runtime-config] cannot derive function ARN for ${shortName}: region or AWS_ACCOUNT_ID unset`,
    );
  }
  return `arn:aws:lambda:${region}:${accountId}:function:${deriveFunctionName(shortName)}`;
}

/** Test hook: drop all cached state so each test starts cold. */
export function __resetRuntimeConfigForTests(): void {
  warnedSecretPrefetch = false;
  state.doc = null;
  state.loadedAt = 0;
  state.ttlMs = DEFAULT_TTL_MS;
  state.inflight = null;
  state.warnedLoadFailure = false;
  state.warnedMissingParam = false;
  state.secrets.clear();
  state.secretInflight.clear();
}
