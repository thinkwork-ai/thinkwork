import { createHash } from "node:crypto";
import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { requireDeploymentTenantAdmin } from "./shared.js";

const DEFAULT_RELEASE_LIMIT = 12;
const MAX_RELEASE_LIMIT = 25;

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

export async function deploymentReleases(
  _parent: unknown,
  args: { limit?: number | null },
  ctx: GraphQLContext,
  deps: DeploymentReleaseDeps = {},
): Promise<DeploymentRelease[]> {
  await requireDeploymentTenantAdmin(ctx);
  const releases = await fetchGitHubReleases(args.limit, deps.fetch ?? fetch);
  const deploymentReleases = await Promise.all(
    releases.map((release) =>
      toDeploymentRelease(release, deps.fetch ?? fetch),
    ),
  );
  return deploymentReleases
    .filter((release): release is DeploymentRelease => release !== null)
    .filter((release) => release.deployable);
}

async function fetchGitHubReleases(
  limit: number | null | undefined,
  fetchImpl: typeof fetch,
): Promise<GitHubRelease[]> {
  const perPage = Math.min(
    Math.max(
      Number.isFinite(limit ?? NaN) ? Number(limit) : DEFAULT_RELEASE_LIMIT,
      1,
    ),
    MAX_RELEASE_LIMIT,
  );
  const response = await fetchImpl(
    `https://api.github.com/repos/${releaseRepository()}/releases?per_page=${perPage}`,
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
  const response = await fetchImpl(url, {
    headers: { "User-Agent": "thinkwork-deployment-controller" },
  });
  if (!response.ok) {
    throw new GraphQLError("Unable to load release manifest", {
      extensions: { code: "BAD_GATEWAY" },
    });
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return createHash("sha256").update(bytes).digest("hex");
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
