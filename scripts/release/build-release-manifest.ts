#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RELEASE_MANIFEST_SCHEMA_VERSION = 1;
export const CUSTOMER_OVERLAY_SCHEMA_VERSION = 1;
export const TERRAFORM_MODULE_SOURCE = "thinkwork-ai/thinkwork/aws";

export type ReleaseArtifactType =
  | "lambda"
  | "static-site"
  | "terraform"
  | "seed";

export type RuntimeImageArchitecture = "amd64" | "arm64";

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
}

export interface BuildReleaseManifestOptions {
  version: string;
  gitSha: string;
  artifactRoot: string;
  outputPath?: string;
  baseUrl?: string;
  artifacts?: ReleaseArtifactInput[];
  lambdaDir?: string;
  runtimeImages?: RuntimeImageInput[];
  createdAt?: string;
}

export interface ReleaseArtifact {
  name: string;
  type: ReleaseArtifactType;
  fileName: string;
  relativePath: string;
  url: string | null;
  sha256: string;
  sizeBytes: number;
}

export interface RuntimeImage {
  name: string;
  repository: string;
  tag: string;
  digest: string;
  architecture: RuntimeImageArchitecture;
  uri: string;
}

export interface ThinkWorkReleaseManifest {
  schemaVersion: number;
  release: {
    version: string;
    gitSha: string;
    createdAt: string;
  };
  components: {
    cli: {
      version: string;
    };
    terraform: {
      source: string;
      version: string;
    };
    customerOverlay: {
      schemaVersion: number;
    };
  };
  artifacts: ReleaseArtifact[];
  runtimeImages: RuntimeImage[];
}

interface ParsedArgs {
  version?: string;
  gitSha?: string;
  artifactRoot: string;
  outputPath?: string;
  baseUrl?: string;
  artifactSpecs: string[];
  imageSpecs: string[];
  lambdaDir?: string;
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
    uri: `${image.repository}:${image.tag}@${image.digest}`,
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
      url: joinReleaseUrl(options.baseUrl, fileName),
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

  return {
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
      customerOverlay: {
        schemaVersion: CUSTOMER_OVERLAY_SCHEMA_VERSION,
      },
    },
    artifacts,
    runtimeImages,
  };
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

export function parseRuntimeImageSpec(spec: string): RuntimeImageInput {
  const values = parseKeyValueSpec(spec);
  const architecture = values.architecture;
  if (architecture !== "amd64" && architecture !== "arm64") {
    throw new Error(
      `Runtime image spec must include architecture=amd64 or architecture=arm64`,
    );
  }
  if (!values.name || !values.repository || !values.tag || !values.digest) {
    throw new Error(
      `Runtime image spec must include name, repository, tag, and digest: ${spec}`,
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

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    artifactRoot: "dist/release",
    artifactSpecs: [],
    imageSpecs: [],
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
      case "--image":
        parsed.imageSpecs.push(requireValue(arg, next));
        index += 1;
        break;
      case "--lambda-dir":
        parsed.lambdaDir = requireValue(arg, next);
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
  const manifest = await buildReleaseManifest({
    version,
    gitSha,
    artifactRoot: args.artifactRoot,
    outputPath,
    baseUrl: args.baseUrl,
    lambdaDir: args.lambdaDir,
    artifacts: args.artifactSpecs.map(parseArtifactSpec),
    runtimeImages: args.imageSpecs.map(parseRuntimeImageSpec),
  });

  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Wrote ThinkWork release manifest to ${outputPath}`);
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
