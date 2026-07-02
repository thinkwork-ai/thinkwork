/**
 * Release artifact resolution for packaged installs (U9 / KTD-7).
 *
 * An init-scaffolded deploy has no repo checkout to build Lambda zips or web
 * assets from — without this module it would resolve
 * `lambda_artifact_mode = "placeholder"` and ship infrastructure with no
 * application code. Deploys pin a ThinkWork release (latest by default),
 * seed its Lambda zips into the account's state bucket, and thread
 * `lambda_artifact_bucket`/`lambda_artifact_prefix` +
 * `agentcore_pi_source_image_uri` through terraform.tfvars so reruns converge
 * on the same pinned release.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveReleaseManifest } from "../commands/release/helpers.js";
import type { ExecResult } from "./state-backend.js";

export interface ReleaseLambdaZip {
  name: string;
  fileName: string;
  /** Direct download URL — absent when the zip ships inside the bundle. */
  url: string | null;
  /** Path inside the release's artifact bundle (e.g. lambdas/activity.zip). */
  relativePath: string | null;
  sha256?: string;
}

export interface ReleaseBundle {
  fileName: string;
  url: string;
}

export interface ReleaseWebAsset {
  url: string | null;
  relativePath: string | null;
}

export interface ReleaseArtifacts {
  version: string;
  lambdaZips: ReleaseLambdaZip[];
  /** Digest-pinned Pi runtime image (repository@sha256:...), arm64. */
  piImageUri: string | null;
  /** Prebuilt web static-assets bundle (web.tar.gz), when published. */
  webAsset: ReleaseWebAsset | null;
  /** The all-in-one artifact bundle (platform-artifacts.tar.gz), when published. */
  bundle: ReleaseBundle | null;
}

interface ManifestArtifact {
  name?: string;
  type?: string;
  fileName?: string;
  relativePath?: string;
  url?: string | null;
  sha256?: string;
}

interface ManifestRuntimeImage {
  name?: string;
  repository?: string;
  tag?: string;
  digest?: string;
  architecture?: string;
}

interface ReleaseManifestShape {
  release?: { version?: string };
  artifacts?: ManifestArtifact[];
  artifactBundles?: ManifestArtifact[];
  runtimeImages?: ManifestRuntimeImage[];
}

/**
 * Pure parse of a release manifest into the pieces a local deploy needs.
 * Real releases ship all zips inside one bundle (platform-artifacts.tar.gz)
 * with per-artifact `relativePath` and `url: null` — per-artifact URLs exist
 * only for unbundled releases (harness cycle-2 ledger entry).
 */
export function parseReleaseArtifacts(
  manifest: ReleaseManifestShape,
): ReleaseArtifacts {
  const version = manifest.release?.version ?? "unknown";

  const lambdaZips: ReleaseLambdaZip[] = (manifest.artifacts ?? [])
    .filter((a) => a.type === "lambda" && a.name && (a.url || a.relativePath))
    .map((a) => ({
      name: a.name!,
      fileName: a.fileName ?? `${a.name}.zip`,
      url: a.url ?? null,
      relativePath: a.relativePath ?? null,
      sha256: a.sha256,
    }));

  const piImage = (manifest.runtimeImages ?? []).find(
    (img) =>
      img.repository &&
      img.digest &&
      /(agentcore|(^|[-_])pi([-_]|$))/i.test(img.name ?? "") &&
      (img.architecture ?? "arm64") === "arm64",
  );
  const piImageUri = piImage ? `${piImage.repository}@${piImage.digest}` : null;

  const webArtifact = (manifest.artifacts ?? []).find(
    (a) =>
      (a.name === "web" || a.fileName === "web.tar.gz") &&
      a.type !== "lambda" &&
      (a.url || a.relativePath),
  );

  const bundleEntry = (manifest.artifactBundles ?? []).find((b) => b.url);

  return {
    version,
    lambdaZips,
    piImageUri,
    webAsset: webArtifact
      ? {
          url: webArtifact.url ?? null,
          relativePath: webArtifact.relativePath ?? null,
        }
      : null,
    bundle: bundleEntry
      ? {
          fileName: bundleEntry.fileName ?? "platform-artifacts.tar.gz",
          url: bundleEntry.url!,
        }
      : null,
  };
}

/**
 * Download and extract the release's artifact bundle once; returns the
 * extraction root that artifact `relativePath`s resolve against.
 */
export async function materializeBundle(
  bundle: ReleaseBundle,
  fetchImpl: typeof fetch = fetch,
  tempDir?: string,
): Promise<string> {
  const dir = tempDir ?? mkdtempSync(join(tmpdir(), "thinkwork-bundle-"));
  const response = await fetchImpl(bundle.url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(
      `Could not download release bundle ${bundle.fileName} (${response.status}) from ${bundle.url}`,
    );
  }
  const local = join(dir, bundle.fileName);
  writeFileSync(local, Buffer.from(await response.arrayBuffer()));
  const extract = spawnSync("tar", ["-xzf", local, "-C", dir], {
    encoding: "utf8",
  });
  if (extract.status !== 0) {
    throw new Error(`Could not extract ${bundle.fileName}: ${extract.stderr}`);
  }
  return dir;
}

/** Stage-independent S3 prefix for a pinned release's Lambda zips. */
export function releaseLambdaPrefix(version: string): string {
  return `release-artifacts/${version}/lambdas`;
}

function defaultExec(args: string[]): ExecResult {
  const proc = spawnSync("aws", args, { encoding: "utf8" });
  return {
    status: proc.status ?? 1,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
}

export interface SeedResult {
  uploaded: number;
  skipped: number;
}

/**
 * Idempotently seed the release's Lambda zips into s3://bucket/prefix/.
 * Already-present objects are skipped, so harness reruns and converging
 * deploys don't re-download the world.
 */
export async function seedLambdaArtifacts(options: {
  zips: ReleaseLambdaZip[];
  bucket: string;
  prefix: string;
  /** Extraction root from materializeBundle() for relativePath-only zips. */
  bundleRoot?: string;
  exec?: (args: string[]) => ExecResult;
  fetchImpl?: typeof fetch;
  tempDir?: string;
}): Promise<SeedResult> {
  const exec = options.exec ?? defaultExec;
  const fetchImpl = options.fetchImpl ?? fetch;
  const tempDir =
    options.tempDir ?? mkdtempSync(join(tmpdir(), "thinkwork-release-"));

  let uploaded = 0;
  let skipped = 0;
  for (const zip of options.zips) {
    const key = `${options.prefix}/${zip.fileName}`;
    const head = exec([
      "s3api",
      "head-object",
      "--bucket",
      options.bucket,
      "--key",
      key,
    ]);
    if (head.status === 0) {
      skipped += 1;
      continue;
    }

    let local: string;
    if (options.bundleRoot && zip.relativePath) {
      local = join(options.bundleRoot, zip.relativePath);
      if (!existsSync(local)) {
        throw new Error(
          `Release bundle is missing ${zip.relativePath} (artifact ${zip.name}).`,
        );
      }
    } else if (zip.url) {
      const response = await fetchImpl(zip.url, { redirect: "follow" });
      if (!response.ok) {
        throw new Error(
          `Could not download release artifact ${zip.fileName} (${response.status}) from ${zip.url}`,
        );
      }
      local = join(tempDir, zip.fileName);
      writeFileSync(local, Buffer.from(await response.arrayBuffer()));
    } else {
      throw new Error(
        `Artifact ${zip.name} has neither a download URL nor a bundle path — is the release bundle missing?`,
      );
    }

    const put = exec([
      "s3",
      "cp",
      local,
      `s3://${options.bucket}/${key}`,
      "--only-show-errors",
    ]);
    if (put.status !== 0) {
      throw new Error(
        `Could not upload ${zip.fileName} to s3://${options.bucket}/${key}: ${put.stderr.trim()}`,
      );
    }
    uploaded += 1;
  }
  return { uploaded, skipped };
}

/**
 * Update-or-append `key = "value"` assignments in a terraform.tfvars body,
 * preserving everything else byte-for-byte. Used to pin the resolved release's
 * artifact variables so reruns converge on the same release.
 */
export function upsertTfvarsValues(
  content: string,
  values: Record<string, string>,
): string {
  const lines = content.split("\n");
  const pending = new Map(Object.entries(values));

  const updated = lines.map((line) => {
    const match = line.match(/^(\s*)([a-zA-Z0-9_]+)(\s*)=\s*".*"\s*$/);
    if (match && pending.has(match[2])) {
      const value = pending.get(match[2])!;
      pending.delete(match[2]);
      return `${match[1]}${match[2]}${match[3]}= "${value}"`;
    }
    return line;
  });

  if (pending.size > 0) {
    while (updated.length > 0 && updated[updated.length - 1].trim() === "") {
      updated.pop();
    }
    updated.push("");
    updated.push(
      `# ── Release artifacts (pinned by \`thinkwork deploy\`) ─────────────`,
    );
    for (const [key, value] of pending) {
      updated.push(`${key} = "${value}"`);
    }
    updated.push("");
  }
  return updated.join("\n");
}

/**
 * Resolve a release version's full artifact set: version pin via the existing
 * GitHub Releases manifest helpers, then a manifest fetch + parse.
 */
export async function resolveReleaseArtifacts(
  version: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ReleaseArtifacts> {
  const { manifestUrl } = await resolveReleaseManifest(version, fetchImpl);
  const response = await fetchImpl(manifestUrl, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(
      `Could not fetch release manifest for ${version} (${response.status}).`,
    );
  }
  const manifest = (await response.json()) as ReleaseManifestShape;
  return parseReleaseArtifacts(manifest);
}
