/**
 * Plugin catalog source — the single access point for the signed plugin
 * catalog inside `packages/api` (plan 2026-06-12-001 U5).
 *
 * Trust model (fails closed, never falls open):
 *
 *   1. The trusted ed25519 public key is read from SSM at
 *      `/thinkwork/{stage}/plugin-catalog/trusted-public-key` (same raw
 *      SSM read pattern as `resolveDeploymentProfileConfig` in
 *      `graphql/resolvers/deployments/shared.ts` — no new env vars on the
 *      GraphQL Lambda).
 *   2. **Signed mode** — when the SSM key is present, a signed catalog
 *      document is REQUIRED and verified via
 *      `verifyPluginCatalog` (digest + ed25519 signature + embedded
 *      manifest re-validation). Any verification failure — bad signature,
 *      digest mismatch, missing/unreadable document — throws; there is no
 *      downgrade to the unsigned path.
 *   3. **Unsigned mode** — when the SSM parameter does not exist (dev /
 *      test stacks where release engineering has not minted the signing
 *      key yet), the catalog is built in-process from the repo-authored
 *      `allPluginManifests` via `buildPluginCatalog`, which re-runs full
 *      manifest validation. Manifest validation is the integrity gate in
 *      this mode: the manifests are compiled into the Lambda bundle, so
 *      the artifact's provenance is the deploy pipeline itself. The signed
 *      path activates automatically once the SSM key is wired — no code
 *      change needed.
 *   4. A non-`ParameterNotFound` SSM error is treated as "trust state
 *      unknown" and throws (fail closed) rather than silently selecting
 *      unsigned mode.
 *
 * The signed document loader is injectable; the default attempts the
 * bundled artifact (`dist/catalog.json` in `@thinkwork/plugin-catalog`,
 * produced by its `build:catalog` script).
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import {
  allPluginManifests,
  buildPluginCatalog,
  verifyPluginCatalog,
  PluginCatalogError,
  SEMVER_RE,
  type PluginCatalog,
  type PluginCatalogEntry,
  type PluginCatalogVersionEntry,
} from "@thinkwork/plugin-catalog";

export class PluginCatalogUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginCatalogUnavailableError";
  }
}

export interface PluginCatalogSourceDeps {
  /** Returns the trusted public key PEM, or null when not provisioned. */
  readTrustedPublicKey?: () => Promise<string | null>;
  /** Returns the signed catalog document (parsed JSON), or null when absent. */
  loadSignedDocument?: () => Promise<unknown | null>;
}

const ssm = new SSMClient({});

let cachedCatalog: PluginCatalog | null = null;

export function trustedPublicKeyParameterName(): string {
  const stage = process.env.STAGE || process.env.THINKWORK_STAGE || "dev";
  return `/thinkwork/${stage}/plugin-catalog/trusted-public-key`;
}

async function defaultReadTrustedPublicKey(): Promise<string | null> {
  try {
    const response = await ssm.send(
      new GetParameterCommand({
        Name: trustedPublicKeyParameterName(),
        WithDecryption: true,
      }),
    );
    const value = response.Parameter?.Value?.trim();
    return value ? value : null;
  } catch (error) {
    if ((error as Error)?.name === "ParameterNotFound") {
      return null;
    }
    // Fail closed: an unreadable trust anchor must not silently select
    // unsigned mode.
    throw new PluginCatalogUnavailableError(
      `Plugin catalog trusted-key lookup failed: ${(error as Error)?.name}: ${
        (error as Error)?.message
      }`,
    );
  }
}

async function defaultLoadSignedDocument(): Promise<unknown | null> {
  try {
    const require = createRequire(import.meta.url);
    const entryPath = require.resolve("@thinkwork/plugin-catalog");
    const artifactUrl = new URL("../dist/catalog.json", `file://${entryPath}`);
    return JSON.parse(readFileSync(artifactUrl, "utf8")) as unknown;
  } catch {
    // Missing artifact is reported by the caller when signed mode is
    // active; in unsigned mode it is irrelevant.
    return null;
  }
}

/**
 * Load (and cache for the Lambda lifetime) the trusted plugin catalog.
 * Throws `PluginCatalogUnavailableError` / `PluginCatalogError` on any
 * trust failure — callers surface that as a GraphQL error, never a
 * partial catalog.
 */
export async function getPluginCatalog(
  deps: PluginCatalogSourceDeps = {},
): Promise<PluginCatalog> {
  if (cachedCatalog) return cachedCatalog;

  const readKey = deps.readTrustedPublicKey ?? defaultReadTrustedPublicKey;
  const loadDocument = deps.loadSignedDocument ?? defaultLoadSignedDocument;

  const trustedPublicKeyPem = await readKey();
  if (trustedPublicKeyPem) {
    const document = await loadDocument();
    if (document === null || document === undefined) {
      throw new PluginCatalogUnavailableError(
        "Plugin catalog signed mode is active (trusted key present in SSM) " +
          "but no signed catalog document is available. Refusing to fall " +
          "back to the unsigned in-process catalog.",
      );
    }
    // Throws typed PluginCatalogError subclasses on tamper/bad signature.
    cachedCatalog = verifyPluginCatalog({ document, trustedPublicKeyPem });
    return cachedCatalog;
  }

  // Unsigned mode: build from the bundled repo-authored manifests.
  // buildPluginCatalog re-runs validatePluginManifest on every manifest.
  cachedCatalog = buildPluginCatalog({ manifests: allPluginManifests });
  return cachedCatalog;
}

export function resetPluginCatalogCacheForTests(): void {
  cachedCatalog = null;
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export function findCatalogPlugin(
  catalog: PluginCatalog,
  pluginKey: string,
): PluginCatalogEntry | null {
  return (
    catalog.plugins.find((plugin) => plugin.pluginKey === pluginKey) ?? null
  );
}

/**
 * Resolve one published version of a plugin. `version` omitted/null means
 * the latest published version (semver-descending).
 */
export async function getPluginVersion(
  pluginKey: string,
  version?: string | null,
  deps: PluginCatalogSourceDeps = {},
): Promise<{
  plugin: PluginCatalogEntry;
  versionEntry: PluginCatalogVersionEntry;
} | null> {
  const catalog = await getPluginCatalog(deps);
  const plugin = findCatalogPlugin(catalog, pluginKey);
  if (!plugin) return null;
  const versionEntry = version
    ? (plugin.versions.find((entry) => entry.version === version) ?? null)
    : latestVersionEntry(plugin);
  if (!versionEntry) return null;
  return { plugin, versionEntry };
}

export function latestVersionEntry(
  plugin: PluginCatalogEntry,
): PluginCatalogVersionEntry | null {
  if (plugin.versions.length === 0) return null;
  return [...plugin.versions].sort((a, b) =>
    compareSemverDesc(a.version, b.version),
  )[0]!;
}

export function sortVersionsNewestFirst(
  plugin: PluginCatalogEntry,
): PluginCatalogVersionEntry[] {
  return [...plugin.versions].sort((a, b) =>
    compareSemverDesc(a.version, b.version),
  );
}

/**
 * Semver-descending comparator covering the SEMVER_RE shape the manifest
 * validator enforces (numeric core; a prerelease sorts below its release).
 */
export function compareSemverDesc(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa.core[i]! !== pb.core[i]!) return pb.core[i]! - pa.core[i]!;
  }
  if (pa.prerelease === pb.prerelease) return 0;
  if (pa.prerelease === null) return -1; // release > prerelease → a first
  if (pb.prerelease === null) return 1;
  return pa.prerelease < pb.prerelease ? 1 : -1;
}

function parseSemver(version: string): {
  core: [number, number, number];
  prerelease: string | null;
} {
  if (!SEMVER_RE.test(version)) {
    throw new PluginCatalogError(`Invalid semver in catalog: ${version}`);
  }
  const [coreAndPre] = version.split("+", 1);
  const [core, ...pre] = coreAndPre!.split("-");
  const [major, minor, patch] = core!.split(".").map(Number);
  return {
    core: [major!, minor!, patch!],
    prerelease: pre.length > 0 ? pre.join("-") : null,
  };
}
