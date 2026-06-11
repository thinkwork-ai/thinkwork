import { createHash } from "node:crypto";
import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { requireDeploymentTenantAdmin } from "./shared.js";

const DEFAULT_RELEASE_LIMIT = 12;
const MAX_RELEASE_LIMIT = 25;
const GITHUB_RELEASE_PAGE_SIZE = 100;

interface GitHubReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
}

interface GitHubRelease {
  tag_name?: unknown;
  name?: unknown;
  prerelease?: unknown;
  draft?: unknown;
  published_at?: unknown;
  html_url?: unknown;
  assets?: unknown;
}

export interface DeploymentRelease {
  version: string;
  name: string | null;
  prerelease: boolean;
  draft: boolean;
  publishedAt: string | null;
  htmlUrl: string;
  manifestUrl: string;
  manifestSha256: string;
  signatureUrl: string | null;
  signed: boolean;
  deployable: boolean;
}

export interface DeploymentReleaseDeps {
  fetch?: typeof fetch;
}

/**
 * GitHub responses are cached per warm container. The releases list is
 * fetched unauthenticated (customer environments carry no GITHUB_TOKEN),
 * and GitHub's anonymous quota is 60 requests/hour per egress IP — shared
 * with everything else behind the environment's NAT. Without a cache the
 * operator Releases panel reads "Releases unavailable." whenever the quota
 * is burned. On fetch failure the last good list is served instead;
 * manifest digests are immutable per asset URL and cached unbounded.
 */
const RELEASES_CACHE_TTL_MS = 5 * 60 * 1000;

let releasesCache: { releases: GitHubRelease[]; fetchedAt: number } | null =
  null;
const manifestSha256Cache = new Map<string, string>();

export function resetDeploymentReleasesCacheForTests() {
  releasesCache = null;
  manifestSha256Cache.clear();
}

export async function deploymentReleases(
  _parent: unknown,
  args: { limit?: number | null },
  ctx: GraphQLContext,
  deps: DeploymentReleaseDeps = {},
): Promise<DeploymentRelease[]> {
  await requireDeploymentTenantAdmin(ctx);
  const limit = releaseLimit(args.limit);
  const releases = await fetchGitHubReleases(deps.fetch ?? fetch);
  const deploymentReleases: DeploymentRelease[] = [];

  for (const release of sortGitHubReleases(releases)) {
    const deploymentRelease = await toDeploymentRelease(
      release,
      deps.fetch ?? fetch,
    );
    if (!deploymentRelease?.deployable) continue;
    deploymentReleases.push(deploymentRelease);
    if (deploymentReleases.length >= limit) break;
  }

  return deploymentReleases;
}

async function fetchGitHubReleases(
  fetchImpl: typeof fetch,
): Promise<GitHubRelease[]> {
  const now = Date.now();
  if (releasesCache && now - releasesCache.fetchedAt < RELEASES_CACHE_TTL_MS) {
    return releasesCache.releases;
  }
  try {
    const releases = await fetchGitHubReleasesUncached(fetchImpl);
    releasesCache = { releases, fetchedAt: now };
    return releases;
  } catch (error) {
    if (releasesCache) {
      console.warn(
        "[deploymentReleases] GitHub fetch failed; serving stale release list:",
        error instanceof Error ? error.message : error,
      );
      return releasesCache.releases;
    }
    throw error;
  }
}

async function fetchGitHubReleasesUncached(
  fetchImpl: typeof fetch,
): Promise<GitHubRelease[]> {
  const response = await fetchImpl(
    `https://api.github.com/repos/${releaseRepository()}/releases?per_page=${GITHUB_RELEASE_PAGE_SIZE}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "thinkwork-deployment-controller",
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
    },
  );
  if (!response.ok) {
    throw new GraphQLError("Unable to load ThinkWork releases", {
      extensions: { code: "BAD_GATEWAY" },
    });
  }
  const body = (await response.json()) as unknown;
  if (!Array.isArray(body)) return [];
  return body as GitHubRelease[];
}

function releaseLimit(limit: number | null | undefined): number {
  return Math.min(
    Math.max(
      Number.isFinite(limit ?? NaN) ? Number(limit) : DEFAULT_RELEASE_LIMIT,
      1,
    ),
    MAX_RELEASE_LIMIT,
  );
}

function sortGitHubReleases(releases: GitHubRelease[]): GitHubRelease[] {
  return [...releases].sort((a, b) => {
    const publishedAtDelta =
      timestampValue(b.published_at) - timestampValue(a.published_at);
    if (publishedAtDelta !== 0) return publishedAtDelta;
    return canaryNumber(b.tag_name) - canaryNumber(a.tag_name);
  });
}

async function toDeploymentRelease(
  release: GitHubRelease,
  fetchImpl: typeof fetch,
): Promise<DeploymentRelease | null> {
  const version = stringValue(release.tag_name);
  const htmlUrl = stringValue(release.html_url);
  const assets = Array.isArray(release.assets)
    ? (release.assets as GitHubReleaseAsset[])
    : [];
  const manifestUrl = assetUrl(assets, "thinkwork-release.json");
  if (!version || !htmlUrl || !manifestUrl) return null;

  const signatureUrl =
    assetUrl(assets, "thinkwork-release.json.sig") ||
    assetUrl(assets, "thinkwork-release.sig");
  const manifestSha256 = await sha256FromUrl(manifestUrl, fetchImpl);
  const signed = Boolean(signatureUrl);
  return {
    version,
    name: stringValue(release.name) || null,
    prerelease: Boolean(release.prerelease),
    draft: Boolean(release.draft),
    publishedAt: stringValue(release.published_at) || null,
    htmlUrl,
    manifestUrl,
    manifestSha256,
    signatureUrl: signatureUrl || null,
    signed,
    deployable: signed || allowUnsignedReleaseManifests(),
  };
}

async function sha256FromUrl(
  url: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const cached = manifestSha256Cache.get(url);
  if (cached) return cached;
  const response = await fetchImpl(url, {
    headers: { "User-Agent": "thinkwork-deployment-controller" },
  });
  if (!response.ok) {
    throw new GraphQLError("Unable to load release manifest", {
      extensions: { code: "BAD_GATEWAY" },
    });
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  manifestSha256Cache.set(url, digest);
  return digest;
}

function releaseRepository(): string {
  return process.env.THINKWORK_RELEASE_REPOSITORY || "thinkwork-ai/thinkwork";
}

function allowUnsignedReleaseManifests(): boolean {
  return process.env.THINKWORK_ALLOW_UNSIGNED_RELEASE_MANIFESTS !== "false";
}

function assetUrl(assets: GitHubReleaseAsset[], name: string): string {
  const asset = assets.find((candidate) => candidate.name === name);
  return stringValue(asset?.browser_download_url);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function timestampValue(value: unknown): number {
  const timestamp = Date.parse(stringValue(value));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function canaryNumber(value: unknown): number {
  const match = stringValue(value).match(/canary\.(\d+)$/);
  return match ? Number(match[1]) : 0;
}
