import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const N8N_PACKAGE_CONFIG_SCHEMA_VERSION = 1;

export interface NormalizedN8nPackage {
  name: string;
  version: string;
  spec: string;
}

export interface NormalizedN8nPackageConfig {
  schemaVersion: typeof N8N_PACKAGE_CONFIG_SCHEMA_VERSION;
  packages: NormalizedN8nPackage[];
  packageNames: string[];
  packageSpecs: string[];
  allowExternal: string;
  digest: string;
}

export function normalizeN8nPackageConfig(
  value: unknown,
): NormalizedN8nPackageConfig {
  const specs = packageSpecsFrom(value);
  const byName = new Map<string, NormalizedN8nPackage>();

  for (const rawSpec of specs) {
    const parsed = parseExactPublicNpmSpec(rawSpec);
    const existing = byName.get(parsed.name);
    if (existing) {
      if (existing.version !== parsed.version) {
        throw new Error(
          `n8n custom package ${parsed.name} declares multiple versions: ${existing.version} and ${parsed.version}`,
        );
      }
      continue;
    }
    byName.set(parsed.name, parsed);
  }

  const packages = [...byName.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const digestPayload = {
    schemaVersion: N8N_PACKAGE_CONFIG_SCHEMA_VERSION,
    packages: packages.map(({ name, version }) => ({ name, version })),
  };

  return {
    schemaVersion: N8N_PACKAGE_CONFIG_SCHEMA_VERSION,
    packages,
    packageNames: packages.map((entry) => entry.name),
    packageSpecs: packages.map((entry) => entry.spec),
    allowExternal: packages.map((entry) => entry.name).join(","),
    digest: sha256Hex(canonicalJson(digestPayload)),
  };
}

export function assertN8nPackageConfigDigest(args: {
  expectedDigest?: unknown;
  actualDigest: string;
  fieldName: string;
}): void {
  if (args.expectedDigest === undefined || args.expectedDigest === null) return;
  if (typeof args.expectedDigest !== "string" || !args.expectedDigest.trim()) {
    throw new Error(`${args.fieldName} must be a sha256 hex digest`);
  }
  if (!/^[a-f0-9]{64}$/i.test(args.expectedDigest)) {
    throw new Error(`${args.fieldName} must be a sha256 hex digest`);
  }
  if (args.expectedDigest.toLowerCase() !== args.actualDigest.toLowerCase()) {
    throw new Error(
      `${args.fieldName} must match normalized n8n package config digest ${args.actualDigest}`,
    );
  }
}

function packageSpecsFrom(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const rawSpecs = Array.isArray(value)
    ? value
    : typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).customPackageSpecs
      : value;
  if (rawSpecs === undefined || rawSpecs === null) return [];
  if (!Array.isArray(rawSpecs)) {
    throw new Error(
      "n8n customPackageSpecs must be an array of exact package specs",
    );
  }
  return rawSpecs.map((entry, index) => {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new Error(
        `n8n customPackageSpecs[${index}] must be a non-empty string`,
      );
    }
    return entry.trim();
  });
}

function parseExactPublicNpmSpec(spec: string): NormalizedN8nPackage {
  rejectUnsafeSpecShape(spec);
  const versionSeparatorIndex = spec.lastIndexOf("@");
  if (versionSeparatorIndex <= 0) {
    throw new Error(
      `n8n custom package "${spec}" must include an exact public npm version like lodash@4.17.21`,
    );
  }

  const name = spec.slice(0, versionSeparatorIndex);
  const version = spec.slice(versionSeparatorIndex + 1);
  assertPublicPackageName(name, spec);
  assertExactSemver(version, spec);
  return { name, version, spec: `${name}@${version}` };
}

function rejectUnsafeSpecShape(spec: string): void {
  if (/\s/.test(spec)) {
    throw new Error(`n8n custom package "${spec}" must not contain whitespace`);
  }
  if (
    /^(?:git\+|git:|ssh:|http:|https:|file:|workspace:|link:|portal:|npm:)/i.test(
      spec,
    ) ||
    spec.includes("://")
  ) {
    throw new Error(
      `n8n custom package "${spec}" must be an exact public npm package spec, not a URL, path, alias, or workspace reference`,
    );
  }
  if (
    spec.startsWith("./") ||
    spec.startsWith("../") ||
    spec.startsWith("/") ||
    spec.endsWith(".tgz")
  ) {
    throw new Error(
      `n8n custom package "${spec}" must be resolved from the public npm registry`,
    );
  }
}

function assertPublicPackageName(name: string, spec: string): void {
  const packagePart = "[a-z0-9][a-z0-9._~-]*";
  const unscoped = new RegExp(`^${packagePart}$`);
  const scoped = new RegExp(`^@${packagePart}/${packagePart}$`);
  if (
    name.length > 214 ||
    name.startsWith(".") ||
    name.startsWith("_") ||
    (!unscoped.test(name) && !scoped.test(name))
  ) {
    throw new Error(
      `n8n custom package "${spec}" has an invalid npm package name`,
    );
  }
}

function assertExactSemver(version: string, spec: string): void {
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/.test(
      version,
    )
  ) {
    throw new Error(
      `n8n custom package "${spec}" must pin an exact semver version; ranges, tags, and wildcards are not allowed`,
    );
  }
}

function sha256Hex(value: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(value)));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}
