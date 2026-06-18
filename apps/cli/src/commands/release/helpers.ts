/**
 * Helpers for `thinkwork release` — list published platform releases and
 * build deployment-controller execution inputs.
 *
 * Customer environments install releases through the deployment controller
 * (Step Functions `thinkwork-<stage>-deployment-orchestrator` + CodeBuild
 * runner). The controller consumes the `thinkwork.deployment.controller.v1`
 * contract; environment-specific facts that are not derivable (customer
 * name, Pi image pin, feature toggles, evidence bucket) are carried forward
 * from the previous successful execution's input, so updates stay
 * config-free once an environment has deployed at least once.
 */

import { createHash, randomUUID } from "node:crypto";

const GITHUB_RELEASES_API =
  "https://api.github.com/repos/thinkwork-ai/thinkwork/releases";
const MANIFEST_FILE_NAME = "thinkwork-release.json";

export interface ReleaseSummary {
  /** Tag name, e.g. `v0.1.0-canary.173`. */
  version: string;
  publishedAt: string;
  manifestUrl: string;
}

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  published_at: string | null;
  assets: GitHubReleaseAsset[];
}

/**
 * List the most recent deployable platform releases (newest first).
 *
 * Platform tags look like `v0.1.0-canary.173`; desktop tags
 * (`desktop-v*`) and releases without a published manifest asset are not
 * deployable through the controller and are filtered out.
 */
export async function fetchRecentReleases(
  limit = 5,
  fetchImpl: typeof fetch = fetch,
): Promise<ReleaseSummary[]> {
  const response = await fetchImpl(
    `${GITHUB_RELEASES_API}?per_page=${Math.max(limit * 4, 20)}`,
    { headers: { accept: "application/vnd.github+json" } },
  );
  if (!response.ok) {
    throw new Error(
      `GitHub releases API responded ${response.status}: ${await response.text()}`,
    );
  }
  const releases = (await response.json()) as GitHubRelease[];

  const summaries: ReleaseSummary[] = [];
  for (const release of releases) {
    if (release.draft) continue;
    if (!/^v\d/.test(release.tag_name)) continue;
    const manifest = release.assets.find((a) => a.name === MANIFEST_FILE_NAME);
    if (!manifest) continue;
    summaries.push({
      version: release.tag_name,
      publishedAt: release.published_at ?? "",
      manifestUrl: manifest.browser_download_url,
    });
    if (summaries.length >= limit) break;
  }
  return summaries;
}

export interface ResolvedReleaseManifest {
  version: string;
  manifestUrl: string;
  manifestSha256: string;
}

/**
 * Download a release manifest and compute the sha256 the controller pins.
 * Sanity-checks that the manifest's own version matches the requested tag.
 */
export async function resolveReleaseManifest(
  version: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ResolvedReleaseManifest> {
  const manifestUrl = `https://github.com/thinkwork-ai/thinkwork/releases/download/${version}/${MANIFEST_FILE_NAME}`;
  const response = await fetchImpl(manifestUrl, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(
      `Release manifest not found for ${version} (HTTP ${response.status}). ` +
        `Has the Release workflow for the tag finished publishing assets?`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const manifestSha256 = createHash("sha256").update(bytes).digest("hex");

  const parsed = JSON.parse(bytes.toString("utf8")) as {
    release?: { version?: string };
  };
  const manifestVersion = parsed.release?.version;
  if (manifestVersion && `v${manifestVersion}` !== version) {
    throw new Error(
      `Manifest at ${manifestUrl} declares version v${manifestVersion}, expected ${version}.`,
    );
  }

  return { version, manifestUrl, manifestSha256 };
}

/**
 * The subset of a prior controller execution input that must be carried
 * forward into the next update (environment facts the CLI cannot derive).
 */
export interface PriorControllerInput {
  customerName: string;
  environmentName: string;
  awsAccountId: string;
  awsRegion: string;
  availabilityZones: unknown[];
  evidenceBucket: string;
  runnerSecretArn?: string;
  releaseVersion?: string;
  agentcorePiSourceImageUri?: string;
  customerDomain?: string;
  customerDomainDelegated?: boolean;
  customerDomainLegacyRetired?: boolean;
  features?: unknown;
  terraform?: unknown;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && value) {
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  }
  return undefined;
}

/** Validate and narrow a prior execution's parsed input JSON. */
export function parsePriorControllerInput(raw: unknown): PriorControllerInput {
  const input = objectValue(raw) ?? {};
  const preservedConfig = objectValue(input.preservedConfig) ?? {};
  const required = [
    "customerName",
    "environmentName",
    "awsAccountId",
    "awsRegion",
    "evidenceBucket",
  ] as const;
  for (const key of required) {
    if (typeof input?.[key] !== "string" || input[key] === "") {
      throw new Error(
        `Previous controller execution input is missing "${key}" — cannot ` +
          `carry environment facts forward. Deploy once via bootstrap first.`,
      );
    }
  }
  return {
    customerName: input.customerName as string,
    environmentName: input.environmentName as string,
    awsAccountId: input.awsAccountId as string,
    awsRegion: input.awsRegion as string,
    availabilityZones: Array.isArray(input.availabilityZones)
      ? input.availabilityZones
      : [],
    evidenceBucket: input.evidenceBucket as string,
    runnerSecretArn:
      stringValue(input.runnerSecretArn) ??
      stringValue(input.deploymentSecretsSecretArn),
    releaseVersion:
      typeof input.releaseVersion === "string"
        ? input.releaseVersion
        : undefined,
    agentcorePiSourceImageUri:
      typeof input.agentcorePiSourceImageUri === "string"
        ? input.agentcorePiSourceImageUri
        : undefined,
    customerDomain:
      stringValue(input.customerDomain) ??
      stringValue(preservedConfig.customerDomain),
    customerDomainDelegated:
      booleanValue(input.customerDomainDelegated) ??
      booleanValue(preservedConfig.customerDomainDelegated),
    customerDomainLegacyRetired:
      booleanValue(input.customerDomainLegacyRetired) ??
      booleanValue(preservedConfig.customerDomainLegacyRetired),
    features: input.features,
    terraform: input.terraform,
  };
}

/**
 * Build the controller-v1 update input for a release, carrying forward the
 * non-derivable environment facts from the previous execution.
 */
export function buildControllerUpdateInput(options: {
  prior: PriorControllerInput;
  release: ResolvedReleaseManifest;
  sessionId?: string;
  webOnly?: boolean;
}): Record<string, unknown> {
  const { prior, release } = options;
  const sessionId = options.sessionId ?? randomUUID();
  const action = options.webOnly ? "web" : "update";
  const operationKind = options.webOnly ? "web" : "foundation";
  const releasePin = {
    version: release.version,
    manifestUrl: release.manifestUrl,
    manifestSha256: release.manifestSha256,
  };
  const preservedConfig = {
    ...(prior.customerDomain ? { customerDomain: prior.customerDomain } : {}),
    ...(prior.customerDomainDelegated !== undefined
      ? { customerDomainDelegated: prior.customerDomainDelegated }
      : {}),
    ...(prior.customerDomainLegacyRetired !== undefined
      ? { customerDomainLegacyRetired: prior.customerDomainLegacyRetired }
      : {}),
  };
  const hasPreservedConfig = Object.keys(preservedConfig).length > 0;
  return {
    schemaVersion: 1,
    contract: "thinkwork.deployment.controller.v1",
    phase: action,
    action,
    sessionId,
    customerName: prior.customerName,
    environmentName: prior.environmentName,
    awsAccountId: prior.awsAccountId,
    awsRegion: prior.awsRegion,
    availabilityZones: prior.availabilityZones,
    source: "manual-cli",
    evidenceBucket: prior.evidenceBucket,
    runnerSecretArn:
      prior.runnerSecretArn ??
      `/thinkwork/${prior.environmentName}/deployment/runner-secrets`,
    ...(hasPreservedConfig
      ? {
          preservedConfig,
          ...preservedConfig,
        }
      : {}),
    evidence: {
      bucket: prior.evidenceBucket,
      prefix: `settings/releases/${release.version}/${sessionId}`,
      expectedArtifacts: [
        "controller-input-summary.json",
        "redacted-terraform-vars.json",
        "terraform-plan.json",
        "terraform-outputs.json",
        "deployment-evidence.json",
      ],
    },
    releaseVersion: release.version,
    releaseManifestUrl: release.manifestUrl,
    releaseManifestSha256: release.manifestSha256,
    terraformModuleVersion: release.version.replace(/^v/, ""),
    release: releasePin,
    ...(prior.agentcorePiSourceImageUri
      ? { agentcorePiSourceImageUri: prior.agentcorePiSourceImageUri }
      : {}),
    operation: {
      kind: operationKind,
      action,
      plan: !options.webOnly,
      apply: true,
      destroy: false,
    },
    features: prior.features ?? {
      baseInstall: {
        cognee: false,
        slack: false,
        stripe: false,
        twenty: false,
      },
      optionalApps: [],
    },
    terraform: prior.terraform ?? {
      stateRecovery: { mode: "state", recoverByTags: false },
    },
  };
}

/**
 * Step Functions execution name: `tw-<stage>-update-v<NNN>-<timestamp>`,
 * matching the convention of prior manual runs. Falls back to the full
 * sanitized version when no trailing canary number exists. SFN names are
 * capped at 80 chars from [a-zA-Z0-9-_].
 */
export function controllerExecutionName(
  stage: string,
  version: string,
  now: Date,
): string {
  const canary = version.match(/-canary\.(\d+)$/)?.[1];
  const shortVersion = canary
    ? `v${canary}`
    : version.replace(/[^a-zA-Z0-9-_]/g, "-");
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `tw-${stage}-update-${shortVersion}-${timestamp}`.slice(0, 80);
}
