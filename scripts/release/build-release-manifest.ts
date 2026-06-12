#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CUSTOMER_OVERLAY_SCHEMA_VERSION,
  RELEASE_MANIFEST_SCHEMA_VERSION,
  TERRAFORM_MODULE_SOURCE,
  signReleaseManifest,
  validateReleaseManifest,
  type ManagedAppDescriptor,
  type ReleaseArtifactBundle,
  type ReleaseArtifact,
  type ReleaseArtifactType,
  type RuntimeImage,
  type RuntimeImageArchitecture,
  type ThinkWorkReleaseManifest,
} from "../../packages/release-manifest/src/index";

export interface ReleaseArtifactInput {
  name: string;
  type: ReleaseArtifactType;
  path: string;
  required?: boolean;
}

export interface RuntimeImageInput {
  name: string;
  repository: string;
  tag: string;
  digest: string;
  architecture: RuntimeImageArchitecture;
  uri?: string;
}

export interface ReleaseArtifactBundleInput {
  name: string;
  path: string;
  contains?: string[];
}

export interface BuildReleaseManifestOptions {
  version: string;
  gitSha: string;
  artifactRoot: string;
  outputPath?: string;
  baseUrl?: string;
  artifacts?: ReleaseArtifactInput[];
  artifactBundles?: ReleaseArtifactBundleInput[];
  bundleArtifactUrls?: boolean;
  lambdaDir?: string;
  runtimeImages?: RuntimeImageInput[];
  minCliVersion?: string;
  minRunnerVersion?: string;
  profileSchemaVersion?: number;
  deploymentRunnerImage?: string | null;
  managedApps?: ManagedAppDescriptor[];
  acceptedKeyIds?: string[];
  revokedKeyIds?: string[];
  createdAt?: string;
}

interface ParsedArgs {
  version?: string;
  gitSha?: string;
  artifactRoot: string;
  outputPath?: string;
  baseUrl?: string;
  artifactSpecs: string[];
  artifactBundleSpecs: string[];
  bundleArtifactUrls: boolean;
  imageSpecs: string[];
  lambdaDir?: string;
  minCliVersion?: string;
  minRunnerVersion?: string;
  profileSchemaVersion?: number;
  deploymentRunnerImage?: string | null;
  managedAppSpecs: string[];
  acceptedKeyIds: string[];
  revokedKeyIds: string[];
  signingKeyId?: string;
  privateKeyPath?: string;
  signatureOutputPath?: string;
  signatureExpiresAt?: string;
}

function normalizeVersion(version: string): string {
  return version.startsWith("v") ? version.slice(1) : version;
}

function normalizeBaseUrl(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) return undefined;
  return baseUrl.replace(/\/+$/, "");
}

function joinReleaseUrl(
  baseUrl: string | undefined,
  fileName: string,
): string | null {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return null;
  return `${normalized}/${encodeURIComponent(fileName)}`;
}

function artifactUrlFor(
  baseUrl: string | undefined,
  fileName: string,
  bundledArtifacts: boolean,
): string | null {
  if (bundledArtifacts) return null;
  return joinReleaseUrl(baseUrl, fileName);
}

function relativeToArtifactRoot(
  artifactRoot: string,
  artifactPath: string,
): string {
  const relative = path.relative(artifactRoot, artifactPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return path.basename(artifactPath);
  }
  return relative.split(path.sep).join("/");
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function collectLambdaArtifacts(
  lambdaDir: string | undefined,
): Promise<ReleaseArtifactInput[]> {
  if (!lambdaDir) return [];

  const entries = await readdir(lambdaDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".zip"))
    .map((entry) => ({
      name: entry.name.replace(/\.zip$/, ""),
      type: "lambda" as const,
      path: path.join(lambdaDir, entry.name),
      required: true,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function assertRuntimeImage(image: RuntimeImageInput): RuntimeImage {
  if (!image.name) {
    throw new Error("Runtime image is missing name");
  }
  if (!image.repository) {
    throw new Error(`Runtime image ${image.name} is missing repository`);
  }
  if (!image.tag) {
    throw new Error(`Runtime image ${image.name} is missing tag`);
  }
  if (!image.digest.startsWith("sha256:")) {
    throw new Error(
      `Runtime image ${image.name} digest must start with sha256:`,
    );
  }
  if (image.architecture !== "amd64" && image.architecture !== "arm64") {
    throw new Error(
      `Runtime image ${image.name} architecture must be amd64 or arm64`,
    );
  }

  return {
    name: image.name,
    repository: image.repository,
    tag: image.tag,
    digest: image.digest,
    architecture: image.architecture,
    uri: image.uri ?? `${image.repository}:${image.tag}@${image.digest}`,
  };
}

export async function buildReleaseManifest(
  options: BuildReleaseManifestOptions,
): Promise<ThinkWorkReleaseManifest> {
  const version = normalizeVersion(options.version);
  const artifactRoot = path.resolve(options.artifactRoot);
  const explicitArtifacts = options.artifacts ?? [];
  const lambdaArtifacts = await collectLambdaArtifacts(options.lambdaDir);
  const artifactInputs = [...lambdaArtifacts, ...explicitArtifacts];
  const bundledArtifacts = (options.artifactBundles?.length ?? 0) > 0;
  const names = new Set<string>();
  const artifacts: ReleaseArtifact[] = [];

  for (const artifact of artifactInputs) {
    if (names.has(artifact.name)) {
      throw new Error(
        `Duplicate release artifact logical name: ${artifact.name}`,
      );
    }
    names.add(artifact.name);

    const artifactPath = path.resolve(artifact.path);
    let fileStat;
    try {
      fileStat = await stat(artifactPath);
    } catch {
      if (artifact.required === false) continue;
      throw new Error(
        `Required release artifact "${artifact.name}" is missing: ${artifactPath}`,
      );
    }
    if (!fileStat.isFile()) {
      throw new Error(
        `Release artifact "${artifact.name}" is not a file: ${artifactPath}`,
      );
    }

    const fileName = path.basename(artifactPath);
    artifacts.push({
      name: artifact.name,
      type: artifact.type,
      fileName,
      relativePath: relativeToArtifactRoot(artifactRoot, artifactPath),
      url: artifactUrlFor(
        options.baseUrl,
        fileName,
        bundledArtifacts && !options.bundleArtifactUrls,
      ),
      sha256: await sha256File(artifactPath),
      sizeBytes: fileStat.size,
    });
  }

  artifacts.sort((left, right) => {
    const typeOrder = left.type.localeCompare(right.type);
    return typeOrder === 0 ? left.name.localeCompare(right.name) : typeOrder;
  });

  const runtimeImages = (options.runtimeImages ?? [])
    .map(assertRuntimeImage)
    .sort((left, right) => left.name.localeCompare(right.name));

  const artifactBundles = await buildArtifactBundles({
    artifactRoot,
    baseUrl: options.baseUrl,
    bundles: options.artifactBundles ?? [],
    artifacts,
  });

  const manifest: ThinkWorkReleaseManifest = {
    schemaVersion: RELEASE_MANIFEST_SCHEMA_VERSION,
    release: {
      version,
      gitSha: options.gitSha,
      createdAt: options.createdAt ?? new Date().toISOString(),
    },
    components: {
      cli: {
        version,
      },
      terraform: {
        source: TERRAFORM_MODULE_SOURCE,
        version,
      },
      deploymentRunner: {
        version,
        image: options.deploymentRunnerImage ?? null,
      },
      customerOverlay: {
        schemaVersion: CUSTOMER_OVERLAY_SCHEMA_VERSION,
      },
    },
    compatibility: {
      minCliVersion: normalizeVersion(options.minCliVersion ?? version),
      minRunnerVersion: normalizeVersion(options.minRunnerVersion ?? version),
      profileSchemaVersion: options.profileSchemaVersion ?? 1,
    },
    ...(artifactBundles.length > 0 ? { artifactBundles } : {}),
    artifacts,
    runtimeImages,
    managedApps: (options.managedApps ?? defaultManagedApps(version)).sort(
      (left, right) => left.id.localeCompare(right.id),
    ),
    signing: {
      acceptedKeyIds: options.acceptedKeyIds ?? [],
      revokedKeyIds: options.revokedKeyIds ?? [],
    },
  };

  return validateReleaseManifest(manifest);
}

async function buildArtifactBundles(args: {
  artifactRoot: string;
  baseUrl: string | undefined;
  bundles: ReleaseArtifactBundleInput[];
  artifacts: ReleaseArtifact[];
}): Promise<ReleaseArtifactBundle[]> {
  const bundles: ReleaseArtifactBundle[] = [];
  for (const bundle of args.bundles) {
    const bundlePath = path.resolve(bundle.path);
    let fileStat;
    try {
      fileStat = await stat(bundlePath);
    } catch {
      throw new Error(
        `Required release artifact bundle "${bundle.name}" is missing: ${bundlePath}`,
      );
    }
    if (!fileStat.isFile()) {
      throw new Error(
        `Release artifact bundle "${bundle.name}" is not a file: ${bundlePath}`,
      );
    }
    const fileName = path.basename(bundlePath);
    bundles.push({
      name: bundle.name,
      fileName,
      relativePath: relativeToArtifactRoot(args.artifactRoot, bundlePath),
      url: joinReleaseUrl(args.baseUrl, fileName),
      sha256: await sha256File(bundlePath),
      sizeBytes: fileStat.size,
      contains:
        bundle.contains && bundle.contains.length > 0
          ? bundle.contains
          : args.artifacts.map((artifact) => artifact.name),
    });
  }
  return bundles.sort((left, right) => left.name.localeCompare(right.name));
}

function parseKeyValueSpec(spec: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const part of spec.split(",")) {
    const index = part.indexOf("=");
    if (index === -1) {
      throw new Error(`Invalid key=value spec segment: ${part}`);
    }
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    values[key] = value;
  }
  return values;
}

export function parseArtifactSpec(spec: string): ReleaseArtifactInput {
  const values = parseKeyValueSpec(spec);
  const type = values.type;
  if (
    type !== "lambda" &&
    type !== "static-site" &&
    type !== "terraform" &&
    type !== "seed"
  ) {
    throw new Error(`Invalid artifact type for spec "${spec}"`);
  }
  if (!values.name || !values.path) {
    throw new Error(`Artifact spec must include name and path: ${spec}`);
  }
  return {
    name: values.name,
    type,
    path: values.path,
    required:
      values.required === undefined ? true : values.required !== "false",
  };
}

export function parseArtifactBundleSpec(
  spec: string,
): ReleaseArtifactBundleInput {
  const values = parseKeyValueSpec(spec);
  if (!values.name || !values.path) {
    throw new Error(`Artifact bundle spec must include name and path: ${spec}`);
  }
  return {
    name: values.name,
    path: values.path,
    contains: values.contains ? splitCsvList(values.contains) : undefined,
  };
}

export function parseRuntimeImageSpec(spec: string): RuntimeImageInput {
  const values = parseKeyValueSpec(spec);
  const architecture = values.architecture;
  if (architecture !== "amd64" && architecture !== "arm64") {
    throw new Error(
      `Runtime image spec must include architecture=amd64 or architecture=arm64`,
    );
  }
  if (values.uri) {
    if (!values.name) {
      throw new Error(`Runtime image URI spec must include name: ${spec}`);
    }
    return {
      name: values.name,
      ...parsePinnedImageUri(values.name, values.uri),
      architecture,
      uri: values.uri,
    };
  }
  if (!values.name || !values.repository || !values.tag || !values.digest) {
    throw new Error(
      `Runtime image spec must include either name, uri, and architecture or name, repository, tag, digest, and architecture: ${spec}`,
    );
  }
  return {
    name: values.name,
    repository: values.repository,
    tag: values.tag,
    digest: values.digest,
    architecture,
  };
}

function parsePinnedImageUri(
  imageName: string,
  uri: string,
): Pick<RuntimeImageInput, "repository" | "tag" | "digest"> {
  const separator = uri.lastIndexOf("@");
  if (separator === -1) {
    throw new Error(`Runtime image ${imageName} URI must include @sha256:`);
  }
  const repositoryAndTag = uri.slice(0, separator);
  const digest = uri.slice(separator + 1);
  if (!/^sha256:[0-9a-f]{64}$/i.test(digest)) {
    throw new Error(
      `Runtime image ${imageName} URI digest must be a sha256 digest`,
    );
  }

  const lastSlash = repositoryAndTag.lastIndexOf("/");
  const lastColon = repositoryAndTag.lastIndexOf(":");
  const hasTag = lastColon > lastSlash;
  const repository = hasTag
    ? repositoryAndTag.slice(0, lastColon)
    : repositoryAndTag;
  const tag = hasTag ? repositoryAndTag.slice(lastColon + 1) : "digest";
  if (!repository) {
    throw new Error(`Runtime image ${imageName} URI is missing repository`);
  }
  if (!tag) {
    throw new Error(`Runtime image ${imageName} URI is missing tag`);
  }

  return { repository, tag, digest: digest.toLowerCase() };
}

export function parseManagedAppSpec(spec: string): ManagedAppDescriptor {
  const values = parseKeyValueSpec(spec);
  if (!values.id || !values.displayName) {
    throw new Error(
      `Managed app spec must include id and displayName: ${spec}`,
    );
  }
  return {
    id: values.id,
    displayName: values.displayName,
    terraformModule:
      values.terraformSource || values.terraformVersion
        ? {
            source: values.terraformSource ?? TERRAFORM_MODULE_SOURCE,
            version: values.terraformVersion ?? values.version ?? "0.0.0",
          }
        : undefined,
    requiredArtifacts: values.requiredArtifacts
      ? splitCsvList(values.requiredArtifacts)
      : undefined,
    requiredImages: values.requiredImages
      ? splitCsvList(values.requiredImages)
      : undefined,
    smokeContracts: values.smokeCommand
      ? [
          {
            id: values.smokeId ?? `${values.id}-smoke`,
            command: values.smokeCommand,
            required: values.smokeRequired
              ? values.smokeRequired !== "false"
              : true,
          },
        ]
      : undefined,
  };
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    artifactRoot: "dist/release",
    artifactSpecs: [],
    artifactBundleSpecs: [],
    bundleArtifactUrls: false,
    imageSpecs: [],
    managedAppSpecs: [],
    acceptedKeyIds: [],
    revokedKeyIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--version":
        parsed.version = requireValue(arg, next);
        index += 1;
        break;
      case "--commit":
        parsed.gitSha = requireValue(arg, next);
        index += 1;
        break;
      case "--artifact-root":
        parsed.artifactRoot = requireValue(arg, next);
        index += 1;
        break;
      case "--output":
        parsed.outputPath = requireValue(arg, next);
        index += 1;
        break;
      case "--base-url":
        parsed.baseUrl = requireValue(arg, next);
        index += 1;
        break;
      case "--artifact":
        parsed.artifactSpecs.push(requireValue(arg, next));
        index += 1;
        break;
      case "--artifact-bundle":
        parsed.artifactBundleSpecs.push(requireValue(arg, next));
        index += 1;
        break;
      case "--bundle-artifact-urls":
        parsed.bundleArtifactUrls = true;
        break;
      case "--image":
        parsed.imageSpecs.push(requireValue(arg, next));
        index += 1;
        break;
      case "--lambda-dir":
        parsed.lambdaDir = requireValue(arg, next);
        index += 1;
        break;
      case "--created-at":
        parsed.createdAt = requireValue(arg, next);
        index += 1;
        break;
      case "--min-cli-version":
        parsed.minCliVersion = requireValue(arg, next);
        index += 1;
        break;
      case "--min-runner-version":
        parsed.minRunnerVersion = requireValue(arg, next);
        index += 1;
        break;
      case "--profile-schema-version":
        parsed.profileSchemaVersion = Number.parseInt(
          requireValue(arg, next),
          10,
        );
        index += 1;
        break;
      case "--deployment-runner-image":
        parsed.deploymentRunnerImage = requireValue(arg, next);
        index += 1;
        break;
      case "--managed-app":
        parsed.managedAppSpecs.push(requireValue(arg, next));
        index += 1;
        break;
      case "--accepted-key-id":
        parsed.acceptedKeyIds.push(requireValue(arg, next));
        index += 1;
        break;
      case "--revoked-key-id":
        parsed.revokedKeyIds.push(requireValue(arg, next));
        index += 1;
        break;
      case "--signing-key-id":
        parsed.signingKeyId = requireValue(arg, next);
        index += 1;
        break;
      case "--private-key-path":
        parsed.privateKeyPath = requireValue(arg, next);
        index += 1;
        break;
      case "--signature-output":
        parsed.signatureOutputPath = requireValue(arg, next);
        index += 1;
        break;
      case "--signature-expires-at":
        parsed.signatureExpiresAt = requireValue(arg, next);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const version =
    args.version ??
    process.env.THINKWORK_RELEASE_VERSION ??
    process.env.GITHUB_REF_NAME;
  const gitSha = args.gitSha ?? process.env.GITHUB_SHA;

  if (!version) {
    throw new Error("--version or THINKWORK_RELEASE_VERSION is required");
  }
  if (!gitSha) {
    throw new Error("--commit or GITHUB_SHA is required");
  }

  const outputPath =
    args.outputPath ?? path.join(args.artifactRoot, "thinkwork-release.json");
  const acceptedKeyIds = [...args.acceptedKeyIds];
  if (args.signingKeyId && !acceptedKeyIds.includes(args.signingKeyId)) {
    acceptedKeyIds.push(args.signingKeyId);
  }
  const manifest = await buildReleaseManifest({
    version,
    gitSha,
    artifactRoot: args.artifactRoot,
    outputPath,
    baseUrl: args.baseUrl,
    lambdaDir: args.lambdaDir,
    artifacts: args.artifactSpecs.map(parseArtifactSpec),
    artifactBundles: args.artifactBundleSpecs.map(parseArtifactBundleSpec),
    bundleArtifactUrls: args.bundleArtifactUrls,
    runtimeImages: args.imageSpecs.map(parseRuntimeImageSpec),
    minCliVersion: args.minCliVersion,
    minRunnerVersion: args.minRunnerVersion,
    profileSchemaVersion: args.profileSchemaVersion,
    deploymentRunnerImage: args.deploymentRunnerImage,
    managedApps:
      args.managedAppSpecs.length > 0
        ? args.managedAppSpecs.map(parseManagedAppSpec)
        : undefined,
    acceptedKeyIds,
    revokedKeyIds: args.revokedKeyIds,
  });

  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Wrote ThinkWork release manifest to ${outputPath}`);

  if (args.signingKeyId || args.privateKeyPath || args.signatureOutputPath) {
    if (
      !args.signingKeyId ||
      !args.privateKeyPath ||
      !args.signatureOutputPath
    ) {
      throw new Error(
        "--signing-key-id, --private-key-path, and --signature-output are all required when signing",
      );
    }
    const signature = signReleaseManifest({
      manifest,
      keyId: args.signingKeyId,
      privateKeyPem: await readFile(args.privateKeyPath, "utf8"),
      expiresAt:
        args.signatureExpiresAt ??
        defaultSignatureExpiration(manifest.release.createdAt),
    });
    await writeFile(
      args.signatureOutputPath,
      `${JSON.stringify(signature, null, 2)}\n`,
      "utf8",
    );
    console.log(
      `Wrote ThinkWork release manifest signature to ${args.signatureOutputPath}`,
    );
  }
}

function defaultManagedApps(version: string): ManagedAppDescriptor[] {
  return [
    {
      id: "cognee",
      displayName: "Cognee",
      terraformModule: {
        source: `${TERRAFORM_MODULE_SOURCE}//modules/app/cognee`,
        version,
      },
      requiredImages: ["cognee"],
      smokeContracts: [
        {
          id: "cognee-health",
          command: "scripts/smoke/cognee-managed-app-smoke.mjs",
          required: true,
        },
      ],
    },
    {
      id: "twenty",
      displayName: "Twenty CRM",
      terraformModule: {
        source: `${TERRAFORM_MODULE_SOURCE}//modules/app/twenty`,
        version,
      },
      requiredImages: ["twenty"],
      smokeContracts: [
        {
          id: "twenty-health",
          command: "scripts/smoke/twenty-managed-app-smoke.mjs",
          required: true,
        },
      ],
    },
  ];
}

function splitCsvList(value: string): string[] {
  return value
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function defaultSignatureExpiration(createdAt: string): string {
  const date = new Date(createdAt);
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString();
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
