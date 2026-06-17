import {
  pluginCatalogSha256,
  verifyPluginCatalog,
  type PluginCatalog,
  type SignedPluginCatalogDocument,
} from "@thinkwork/plugin-catalog";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getConfig, getSecret } from "@thinkwork/runtime-config";

export const DEFAULT_PLUGIN_CATALOG_REPOSITORY = "thinkwork-ai/thinkwork";
export const DEFAULT_PLUGIN_CATALOG_RELEASE_TAG = "plugin-catalog-main";
export const DEFAULT_PLUGIN_CATALOG_ASSET_NAME =
  "thinkwork-plugin-catalog-main.json";
export const DEFAULT_PLUGIN_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

export interface GitHubPluginCatalogConfig {
  repository: string;
  releaseTag: string;
  assetName: string;
  token?: string;
  cacheTtlMs: number;
  userAgent: string;
}

export interface GitHubPluginCatalogSnapshot {
  catalog: PluginCatalog;
  status: GitHubPluginCatalogStatus;
  etag?: string;
  document: SignedPluginCatalogDocument;
}

export interface GitHubPluginCatalogStatus {
  source: "github-release";
  repository: string;
  releaseTag: string;
  assetName: string;
  catalogSha256: string;
  sourceCommitSha: string | null;
  generatedAt: string;
  fetchedAt: string;
  stale: boolean;
  lastRefreshStatus: "fresh" | "not-modified" | "stale-fallback";
  message?: string;
  rateLimitRemaining?: string | null;
  rateLimitReset?: string | null;
}

export interface GitHubPluginCatalogCache {
  read(): Promise<GitHubPluginCatalogSnapshot | null>;
  write(snapshot: GitHubPluginCatalogSnapshot): Promise<void>;
  clear?(): Promise<void>;
}

export interface LoadGitHubPluginCatalogOptions {
  config: GitHubPluginCatalogConfig;
  trustedPublicKeyPem: string;
  fetchImpl?: typeof fetch;
  cache?: GitHubPluginCatalogCache;
  forceRefresh?: boolean;
  now?: () => Date;
}

interface GitHubReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
}

interface GitHubRelease {
  assets?: unknown;
}

interface S3CacheDocument {
  schemaVersion?: unknown;
  etag?: unknown;
  document?: unknown;
  status?: unknown;
}

export class GitHubPluginCatalogSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubPluginCatalogSourceError";
  }
}

let memorySnapshot: GitHubPluginCatalogSnapshot | null = null;

export function pluginCatalogGitHubConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GitHubPluginCatalogConfig | null {
  const mode = (
    env.THINKWORK_PLUGIN_CATALOG_SOURCE ||
    env.PLUGIN_CATALOG_SOURCE ||
    ""
  ).toLowerCase();
  const enabled =
    mode === "github" ||
    env.THINKWORK_PLUGIN_CATALOG_GITHUB_ENABLED === "true" ||
    env.PLUGIN_CATALOG_GITHUB_ENABLED === "true";
  if (!enabled) return null;

  return {
    repository:
      env.THINKWORK_PLUGIN_CATALOG_REPOSITORY ||
      env.PLUGIN_CATALOG_GITHUB_REPOSITORY ||
      DEFAULT_PLUGIN_CATALOG_REPOSITORY,
    releaseTag:
      env.THINKWORK_PLUGIN_CATALOG_RELEASE_TAG ||
      env.PLUGIN_CATALOG_GITHUB_RELEASE_TAG ||
      DEFAULT_PLUGIN_CATALOG_RELEASE_TAG,
    assetName:
      env.THINKWORK_PLUGIN_CATALOG_ASSET_NAME ||
      env.PLUGIN_CATALOG_GITHUB_ASSET_NAME ||
      DEFAULT_PLUGIN_CATALOG_ASSET_NAME,
    token:
      env.THINKWORK_PLUGIN_CATALOG_GITHUB_TOKEN ||
      env.PLUGIN_CATALOG_GITHUB_TOKEN ||
      env.GITHUB_TOKEN,
    cacheTtlMs: secondsEnvToMs(
      env.THINKWORK_PLUGIN_CATALOG_CACHE_TTL_SECONDS ||
        env.PLUGIN_CATALOG_CACHE_TTL_SECONDS,
      DEFAULT_PLUGIN_CATALOG_CACHE_TTL_MS,
    ),
    userAgent: env.THINKWORK_PLUGIN_CATALOG_USER_AGENT || "thinkwork-api",
  };
}

export async function pluginCatalogGitHubConfigFromRuntime(): Promise<GitHubPluginCatalogConfig | null> {
  const mode =
    getConfig("THINKWORK_PLUGIN_CATALOG_SOURCE")?.toLowerCase() ?? "";
  const enabled =
    mode === "github" ||
    getConfig("THINKWORK_PLUGIN_CATALOG_GITHUB_ENABLED") === "true";
  if (!enabled) return null;

  return {
    repository: getConfig(
      "THINKWORK_PLUGIN_CATALOG_REPOSITORY",
      DEFAULT_PLUGIN_CATALOG_REPOSITORY,
    ),
    releaseTag: getConfig(
      "THINKWORK_PLUGIN_CATALOG_RELEASE_TAG",
      DEFAULT_PLUGIN_CATALOG_RELEASE_TAG,
    ),
    assetName: getConfig(
      "THINKWORK_PLUGIN_CATALOG_ASSET_NAME",
      DEFAULT_PLUGIN_CATALOG_ASSET_NAME,
    ),
    token: await resolveGitHubToken(),
    cacheTtlMs: secondsEnvToMs(
      getConfig("THINKWORK_PLUGIN_CATALOG_CACHE_TTL_SECONDS"),
      DEFAULT_PLUGIN_CATALOG_CACHE_TTL_MS,
    ),
    userAgent: getConfig(
      "THINKWORK_PLUGIN_CATALOG_USER_AGENT",
      "thinkwork-api",
    ),
  };
}

export function pluginCatalogGitHubCacheFromRuntime(
  trustedPublicKeyPem: string,
): GitHubPluginCatalogCache | undefined {
  const bucket = getConfig("THINKWORK_PLUGIN_CATALOG_CACHE_BUCKET");
  const key = getConfig("THINKWORK_PLUGIN_CATALOG_CACHE_KEY");
  if (!bucket || !key) return undefined;
  return createS3GitHubPluginCatalogCache({
    bucket,
    key,
    trustedPublicKeyPem,
  });
}

export function createS3GitHubPluginCatalogCache(options: {
  bucket: string;
  key: string;
  trustedPublicKeyPem: string;
  client?: Pick<S3Client, "send">;
}): GitHubPluginCatalogCache {
  const client = options.client ?? new S3Client({});
  return {
    async read() {
      try {
        const response = await client.send(
          new GetObjectCommand({
            Bucket: options.bucket,
            Key: options.key,
          }),
        );
        const raw = await bodyToString(response.Body);
        const parsed = JSON.parse(raw) as S3CacheDocument;
        return snapshotFromCacheDocument(parsed, options.trustedPublicKeyPem);
      } catch (error) {
        if (isNotFound(error)) return null;
        console.warn(
          "[pluginCatalog] verified S3 cache read failed; ignoring cache:",
          error instanceof Error ? error.message : error,
        );
        return null;
      }
    },
    async write(snapshot) {
      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: options.key,
          Body: JSON.stringify(
            {
              schemaVersion: 1,
              etag: snapshot.etag,
              document: snapshot.document,
              status: snapshot.status,
            },
            null,
            2,
          ),
          ContentType: "application/json; charset=utf-8",
        }),
      );
    },
  };
}

export async function loadGitHubPluginCatalog(
  options: LoadGitHubPluginCatalogOptions,
): Promise<GitHubPluginCatalogSnapshot> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const cache = options.cache ?? memoryCache;
  const cached = await cache.read();
  const fetchedAt = now();

  if (
    cached &&
    !options.forceRefresh &&
    fetchedAt.getTime() - Date.parse(cached.status.fetchedAt) <
      options.config.cacheTtlMs
  ) {
    logGitHubCatalogRefresh("cache-hit", cached.status);
    return cached;
  }

  try {
    const release = await fetchRelease(options.config, fetchImpl, cached?.etag);
    if (release.notModified) {
      if (!cached) {
        throw new GitHubPluginCatalogSourceError(
          "GitHub catalog returned 304 but no verified cache exists",
        );
      }
      const snapshot = markSnapshot(cached, {
        fetchedAt,
        stale: false,
        lastRefreshStatus: "not-modified",
        rateLimitRemaining: release.rateLimitRemaining,
        rateLimitReset: release.rateLimitReset,
      });
      await cache.write(snapshot);
      logGitHubCatalogRefresh("not-modified", snapshot.status);
      return snapshot;
    }

    const assetUrl = releaseAssetUrl(release.body, options.config.assetName);
    if (!assetUrl) {
      throw new GitHubPluginCatalogSourceError(
        `GitHub catalog release ${options.config.releaseTag} has no ${options.config.assetName} asset`,
      );
    }
    const document = await fetchCatalogDocument(
      assetUrl,
      options.config,
      fetchImpl,
    );
    const catalog = verifyPluginCatalog({
      document,
      trustedPublicKeyPem: options.trustedPublicKeyPem,
    });
    const snapshot: GitHubPluginCatalogSnapshot = {
      catalog,
      etag: release.etag ?? undefined,
      document: document as SignedPluginCatalogDocument,
      status: {
        source: "github-release",
        repository: options.config.repository,
        releaseTag: options.config.releaseTag,
        assetName: options.config.assetName,
        catalogSha256: pluginCatalogSha256(catalog),
        sourceCommitSha: catalog.source?.commitSha ?? null,
        generatedAt: catalog.generatedAt,
        fetchedAt: fetchedAt.toISOString(),
        stale: false,
        lastRefreshStatus: "fresh",
        rateLimitRemaining: release.rateLimitRemaining,
        rateLimitReset: release.rateLimitReset,
      },
    };
    await cache.write(snapshot);
    logGitHubCatalogRefresh("fresh", snapshot.status);
    return snapshot;
  } catch (error) {
    if (cached) {
      const snapshot = markSnapshot(cached, {
        fetchedAt,
        stale: true,
        lastRefreshStatus: "stale-fallback",
        message: error instanceof Error ? error.message : String(error),
      });
      logGitHubCatalogRefresh("stale-fallback", snapshot.status);
      return snapshot;
    }
    throw error;
  }
}

export function resetGitHubPluginCatalogCacheForTests(): void {
  memorySnapshot = null;
}

const memoryCache: GitHubPluginCatalogCache = {
  async read() {
    return memorySnapshot;
  },
  async write(snapshot) {
    memorySnapshot = snapshot;
  },
  async clear() {
    memorySnapshot = null;
  },
};

async function resolveGitHubToken(): Promise<string | undefined> {
  const envToken = getConfig("THINKWORK_PLUGIN_CATALOG_GITHUB_TOKEN");
  if (envToken) return envToken;

  const secretId = getConfig(
    "THINKWORK_PLUGIN_CATALOG_GITHUB_TOKEN_SECRET_ARN",
  );
  if (!secretId) return undefined;

  const secret = (await getSecret(secretId)).trim();
  if (!secret.startsWith("{")) return secret || undefined;
  const parsed = JSON.parse(secret) as {
    token?: unknown;
    githubToken?: unknown;
  };
  const token = parsed.token ?? parsed.githubToken;
  return typeof token === "string" && token.trim() ? token.trim() : undefined;
}

async function bodyToString(body: unknown): Promise<string> {
  if (!body) return "";
  if (typeof body === "string") return body;
  if (
    typeof body === "object" &&
    "transformToString" in body &&
    typeof body.transformToString === "function"
  ) {
    return body.transformToString();
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<
    Buffer | Uint8Array | string
  >) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function snapshotFromCacheDocument(
  parsed: S3CacheDocument,
  trustedPublicKeyPem: string,
): GitHubPluginCatalogSnapshot | null {
  if (parsed.schemaVersion !== 1 || parsed.document === undefined) return null;
  const catalog = verifyPluginCatalog({
    document: parsed.document,
    trustedPublicKeyPem,
  });
  const status = parseCachedStatus(parsed.status);
  if (!status) return null;
  return {
    catalog,
    etag: typeof parsed.etag === "string" ? parsed.etag : undefined,
    document: parsed.document as SignedPluginCatalogDocument,
    status: {
      ...status,
      catalogSha256: pluginCatalogSha256(catalog),
      sourceCommitSha: catalog.source?.commitSha ?? null,
      generatedAt: catalog.generatedAt,
    },
  };
}

function parseCachedStatus(value: unknown): GitHubPluginCatalogStatus | null {
  if (!value || typeof value !== "object") return null;
  const status = value as Partial<GitHubPluginCatalogStatus>;
  if (
    status.source !== "github-release" ||
    typeof status.repository !== "string" ||
    typeof status.releaseTag !== "string" ||
    typeof status.assetName !== "string" ||
    typeof status.catalogSha256 !== "string" ||
    typeof status.generatedAt !== "string" ||
    typeof status.fetchedAt !== "string" ||
    typeof status.stale !== "boolean" ||
    !["fresh", "not-modified", "stale-fallback"].includes(
      status.lastRefreshStatus ?? "",
    )
  ) {
    return null;
  }
  return status as GitHubPluginCatalogStatus;
}

function isNotFound(error: unknown): boolean {
  const name =
    error && typeof error === "object" && "name" in error
      ? String(error.name)
      : "";
  return name === "NoSuchKey" || name === "NotFound" || name === "NoSuchBucket";
}

async function fetchRelease(
  config: GitHubPluginCatalogConfig,
  fetchImpl: typeof fetch,
  etag: string | undefined,
): Promise<
  | {
      notModified: true;
      etag: string | null;
      rateLimitRemaining: string | null;
      rateLimitReset: string | null;
    }
  | {
      notModified: false;
      body: GitHubRelease;
      etag: string | null;
      rateLimitRemaining: string | null;
      rateLimitReset: string | null;
    }
> {
  const response = await fetchImpl(
    `https://api.github.com/repos/${config.repository}/releases/tags/${config.releaseTag}`,
    {
      headers: githubHeaders(config, etag),
    },
  );
  const metadata = {
    etag: response.headers.get("etag"),
    rateLimitRemaining: response.headers.get("x-ratelimit-remaining"),
    rateLimitReset: response.headers.get("x-ratelimit-reset"),
  };
  if (response.status === 304) {
    return { notModified: true, ...metadata };
  }
  if (!response.ok) {
    const message = [
      `GitHub catalog release fetch failed (${response.status})`,
      metadata.rateLimitRemaining !== null
        ? `rateLimitRemaining=${metadata.rateLimitRemaining}`
        : null,
      metadata.rateLimitReset !== null
        ? `rateLimitReset=${metadata.rateLimitReset}`
        : null,
    ]
      .filter(Boolean)
      .join(" ");
    throw new GitHubPluginCatalogSourceError(message);
  }
  return {
    notModified: false,
    body: (await response.json()) as GitHubRelease,
    ...metadata,
  };
}

async function fetchCatalogDocument(
  url: string,
  config: GitHubPluginCatalogConfig,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: githubHeaders(config),
  });
  if (!response.ok) {
    throw new GitHubPluginCatalogSourceError(
      `GitHub catalog asset fetch failed (${response.status})`,
    );
  }
  return (await response.json()) as unknown;
}

function githubHeaders(
  config: GitHubPluginCatalogConfig,
  etag?: string,
): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": config.userAgent,
    ...(etag ? { "If-None-Match": etag } : {}),
    ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
  };
}

function releaseAssetUrl(
  release: GitHubRelease,
  assetName: string,
): string | null {
  const assets = Array.isArray(release.assets)
    ? (release.assets as GitHubReleaseAsset[])
    : [];
  const asset = assets.find((candidate) => candidate.name === assetName);
  return typeof asset?.browser_download_url === "string"
    ? asset.browser_download_url
    : null;
}

function markSnapshot(
  snapshot: GitHubPluginCatalogSnapshot,
  status: Pick<GitHubPluginCatalogStatus, "lastRefreshStatus" | "stale"> & {
    fetchedAt: Date;
    message?: string;
    rateLimitRemaining?: string | null;
    rateLimitReset?: string | null;
  },
): GitHubPluginCatalogSnapshot {
  return {
    ...snapshot,
    status: {
      ...snapshot.status,
      fetchedAt: status.fetchedAt.toISOString(),
      stale: status.stale,
      lastRefreshStatus: status.lastRefreshStatus,
      message: status.message,
      rateLimitRemaining:
        status.rateLimitRemaining ?? snapshot.status.rateLimitRemaining,
      rateLimitReset: status.rateLimitReset ?? snapshot.status.rateLimitReset,
    },
  };
}

function logGitHubCatalogRefresh(
  event: string,
  status: GitHubPluginCatalogStatus,
): void {
  console.info("[pluginCatalog] GitHub catalog refresh", {
    event,
    repository: status.repository,
    releaseTag: status.releaseTag,
    assetName: status.assetName,
    catalogSha256: status.catalogSha256,
    sourceCommitSha: status.sourceCommitSha,
    stale: status.stale,
    lastRefreshStatus: status.lastRefreshStatus,
    rateLimitRemaining: status.rateLimitRemaining ?? null,
    rateLimitReset: status.rateLimitReset ?? null,
  });
}

function secondsEnvToMs(value: string | undefined, fallback: number): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
  return seconds * 1000;
}
