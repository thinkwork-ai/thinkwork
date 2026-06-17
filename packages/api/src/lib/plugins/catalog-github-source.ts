import {
  pluginCatalogSha256,
  verifyPluginCatalog,
  type PluginCatalog,
} from "@thinkwork/plugin-catalog";

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
  now?: () => Date;
}

interface GitHubReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
}

interface GitHubRelease {
  assets?: unknown;
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
    fetchedAt.getTime() - Date.parse(cached.status.fetchedAt) <
      options.config.cacheTtlMs
  ) {
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
      return markSnapshot(cached, {
        fetchedAt,
        stale: false,
        lastRefreshStatus: "not-modified",
      });
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
    return snapshot;
  } catch (error) {
    if (cached) {
      return markSnapshot(cached, {
        fetchedAt,
        stale: true,
        lastRefreshStatus: "stale-fallback",
        message: error instanceof Error ? error.message : String(error),
      });
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
    throw new GitHubPluginCatalogSourceError(
      `GitHub catalog release fetch failed (${response.status})`,
    );
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
    },
  };
}

function secondsEnvToMs(value: string | undefined, fallback: number): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
  return seconds * 1000;
}
