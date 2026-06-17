/**
 * Signed plugin catalog document.
 *
 * The catalog carries every published plugin's version list with the full
 * per-version payload, a sha256 digest per payload (the install-time pin),
 * and one ed25519 signature over the canonical document. Signing follows
 * the `packages/release-manifest` conventions (canonical sorted-key JSON,
 * raw ed25519 over the bytes) adapted to this document shape.
 *
 * Verification fails closed: unknown schema version, digest mismatch, and
 * bad signature each throw a typed error. The trusted public key is a
 * parameter — the SSM-backed wrapper lives in `packages/api`, keeping this
 * package free of AWS imports.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";

import {
  validatePluginManifest,
  type PluginManifest,
  type PremiumPluginMetadata,
  type PluginVersion,
} from "./contracts";

export const PLUGIN_CATALOG_SCHEMA_VERSION = 1;
export const PLUGIN_CATALOG_SIGNATURE_ALGORITHM = "ed25519";

export interface PluginCatalogVersionEntry {
  version: string;
  /** sha256 of the canonical JSON of `payload` — the install-time pin. */
  payloadSha256: string;
  payload: PluginVersion;
}

export interface PluginCatalogEntry {
  pluginKey: string;
  displayName: string;
  description: string;
  premium?: PremiumPluginMetadata;
  versions: PluginCatalogVersionEntry[];
}

export interface PluginCatalogSourceProvenance {
  /** GitHub repository that authored the catalog source, e.g. thinkwork-ai/thinkwork. */
  repository: string;
  /** Source ref or channel used by the publisher, e.g. main or refs/heads/main. */
  ref: string;
  /** Git commit SHA that the generated catalog was built from. */
  commitSha: string;
}

export interface PluginCatalog {
  schemaVersion: typeof PLUGIN_CATALOG_SCHEMA_VERSION;
  generatedAt: string;
  source?: PluginCatalogSourceProvenance;
  plugins: PluginCatalogEntry[];
}

export interface PluginCatalogSignature {
  algorithm: typeof PLUGIN_CATALOG_SIGNATURE_ALGORITHM;
  catalogSha256: string;
  signedAt: string;
  signature: string;
}

export interface SignedPluginCatalogDocument {
  catalog: PluginCatalog;
  signature: PluginCatalogSignature;
}

export class PluginCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginCatalogError";
  }
}

export class PluginCatalogSchemaError extends PluginCatalogError {
  constructor(message: string) {
    super(message);
    this.name = "PluginCatalogSchemaError";
  }
}

export class PluginCatalogDigestError extends PluginCatalogError {
  constructor(message: string) {
    super(message);
    this.name = "PluginCatalogDigestError";
  }
}

export class PluginCatalogSignatureError extends PluginCatalogError {
  constructor(message: string) {
    super(message);
    this.name = "PluginCatalogSignatureError";
  }
}

export function sha256Hex(bytes: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function pluginVersionSha256(payload: PluginVersion): string {
  return sha256Hex(Buffer.from(stableStringify(payload), "utf8"));
}

export function canonicalPluginCatalogBytes(catalog: PluginCatalog): Buffer {
  return Buffer.from(stableStringify(catalog), "utf8");
}

export function pluginCatalogSha256(catalog: PluginCatalog): string {
  return sha256Hex(canonicalPluginCatalogBytes(catalog));
}

/**
 * Build a catalog document from validated manifests. Rejects duplicate
 * plugin keys; computes the per-version payload digest.
 */
export function buildPluginCatalog(options: {
  manifests: readonly PluginManifest[];
  generatedAt?: Date | string;
  source?: PluginCatalogSourceProvenance;
}): PluginCatalog {
  const seenKeys = new Set<string>();
  const plugins: PluginCatalogEntry[] = [];
  for (const candidate of options.manifests) {
    const manifest = validatePluginManifest(candidate);
    if (seenKeys.has(manifest.pluginKey)) {
      throw new PluginCatalogError(
        `Duplicate plugin key in catalog: ${manifest.pluginKey}`,
      );
    }
    seenKeys.add(manifest.pluginKey);
    plugins.push({
      pluginKey: manifest.pluginKey,
      displayName: manifest.displayName,
      description: manifest.description,
      premium: manifest.premium,
      versions: manifest.versions.map((payload) => ({
        version: payload.version,
        payloadSha256: pluginVersionSha256(payload),
        payload,
      })),
    });
  }
  return {
    schemaVersion: PLUGIN_CATALOG_SCHEMA_VERSION,
    generatedAt: toIso(options.generatedAt ?? new Date()),
    source: options.source
      ? validateSourceProvenance(options.source)
      : undefined,
    plugins,
  };
}

export function signPluginCatalog(options: {
  catalog: PluginCatalog;
  privateKeyPem: string;
  signedAt?: Date | string;
}): SignedPluginCatalogDocument {
  const catalog = validatePluginCatalog(options.catalog);
  const privateKey = createPrivateKey(options.privateKeyPem);
  const signature = signBytes(
    null,
    canonicalPluginCatalogBytes(catalog),
    privateKey,
  ).toString("base64");
  return {
    catalog,
    signature: {
      algorithm: PLUGIN_CATALOG_SIGNATURE_ALGORITHM,
      catalogSha256: pluginCatalogSha256(catalog),
      signedAt: toIso(options.signedAt ?? new Date()),
      signature,
    },
  };
}

/**
 * Verify a signed catalog document against the trusted public key.
 * Returns the verified catalog; throws a typed PluginCatalogError subclass
 * on any failure (fail closed — never returns a partially trusted catalog).
 */
export function verifyPluginCatalog(options: {
  document: unknown;
  trustedPublicKeyPem: string;
}): PluginCatalog {
  const document = options.document as Partial<SignedPluginCatalogDocument>;
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new PluginCatalogError("Plugin catalog document must be an object");
  }
  const catalog = validatePluginCatalog(document.catalog);
  const signature = validateSignatureShape(document.signature);

  const catalogSha256 = pluginCatalogSha256(catalog);
  if (signature.catalogSha256 !== catalogSha256) {
    throw new PluginCatalogDigestError(
      `Plugin catalog digest mismatch: expected ${signature.catalogSha256}, got ${catalogSha256}`,
    );
  }

  const valid = verifyBytes(
    null,
    canonicalPluginCatalogBytes(catalog),
    createPublicKey(options.trustedPublicKeyPem),
    Buffer.from(signature.signature, "base64"),
  );
  if (!valid) {
    throw new PluginCatalogSignatureError(
      "Plugin catalog signature is invalid",
    );
  }

  // Per-version payload digests are the install-time pins; verify each so a
  // mismatch surfaces here rather than at install.
  for (const plugin of catalog.plugins) {
    for (const entry of plugin.versions) {
      const actual = pluginVersionSha256(entry.payload);
      if (actual !== entry.payloadSha256) {
        throw new PluginCatalogDigestError(
          `Plugin ${plugin.pluginKey}@${entry.version} payload digest mismatch: expected ${entry.payloadSha256}, got ${actual}`,
        );
      }
    }
  }

  return catalog;
}

/**
 * Structural validation of the catalog half of the document. Re-runs full
 * manifest validation on the embedded payloads so a verified catalog is
 * also a structurally valid one.
 */
export function validatePluginCatalog(value: unknown): PluginCatalog {
  const catalog = value as Partial<PluginCatalog>;
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new PluginCatalogError("Plugin catalog must be an object");
  }
  if (catalog.schemaVersion !== PLUGIN_CATALOG_SCHEMA_VERSION) {
    throw new PluginCatalogSchemaError(
      `Plugin catalog schemaVersion must be ${PLUGIN_CATALOG_SCHEMA_VERSION} (got ${String(catalog.schemaVersion)})`,
    );
  }
  requireIsoDate(catalog.generatedAt, "catalog.generatedAt");
  if (catalog.source !== undefined) {
    validateSourceProvenance(catalog.source);
  }
  if (!Array.isArray(catalog.plugins)) {
    throw new PluginCatalogError("catalog.plugins must be an array");
  }
  const seenKeys = new Set<string>();
  for (const plugin of catalog.plugins as Partial<PluginCatalogEntry>[]) {
    if (!plugin || typeof plugin !== "object" || Array.isArray(plugin)) {
      throw new PluginCatalogError("catalog plugin entries must be objects");
    }
    if (!Array.isArray(plugin.versions) || plugin.versions.length === 0) {
      throw new PluginCatalogError(
        `catalog plugin ${String(plugin.pluginKey)}: versions must be a non-empty array`,
      );
    }
    for (const entry of plugin.versions as Partial<PluginCatalogVersionEntry>[]) {
      if (!entry || typeof entry !== "object") {
        throw new PluginCatalogError(
          `catalog plugin ${String(plugin.pluginKey)}: version entries must be objects`,
        );
      }
      requireSha256(
        entry.payloadSha256,
        `catalog plugin ${String(plugin.pluginKey)}@${String(entry.version)}.payloadSha256`,
      );
      if (
        entry.version !== (entry.payload as Partial<PluginVersion>)?.version
      ) {
        throw new PluginCatalogError(
          `catalog plugin ${String(plugin.pluginKey)}: version entry "${String(entry.version)}" does not match its payload version`,
        );
      }
    }
    // Reconstruct the manifest shape and reuse contract validation.
    validatePluginManifest({
      pluginKey: plugin.pluginKey,
      displayName: plugin.displayName,
      description: plugin.description,
      premium: plugin.premium,
      versions: plugin.versions.map((entry) => entry.payload),
    });
    if (seenKeys.has(plugin.pluginKey as string)) {
      throw new PluginCatalogError(
        `Duplicate plugin key in catalog: ${plugin.pluginKey}`,
      );
    }
    seenKeys.add(plugin.pluginKey as string);
  }
  return catalog as PluginCatalog;
}

function validateSourceProvenance(
  value: unknown,
): PluginCatalogSourceProvenance {
  const source = value as Partial<PluginCatalogSourceProvenance>;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new PluginCatalogError("catalog.source must be an object");
  }
  requireRepository(source.repository, "catalog.source.repository");
  requireRef(source.ref, "catalog.source.ref");
  requireCommitSha(source.commitSha, "catalog.source.commitSha");
  return {
    repository: source.repository,
    ref: source.ref,
    commitSha: source.commitSha,
  };
}

function validateSignatureShape(value: unknown): PluginCatalogSignature {
  const signature = value as Partial<PluginCatalogSignature>;
  if (!signature || typeof signature !== "object" || Array.isArray(signature)) {
    throw new PluginCatalogSignatureError(
      "Plugin catalog signature must be an object",
    );
  }
  if (signature.algorithm !== PLUGIN_CATALOG_SIGNATURE_ALGORITHM) {
    throw new PluginCatalogSignatureError(
      `Plugin catalog signature algorithm must be ${PLUGIN_CATALOG_SIGNATURE_ALGORITHM}`,
    );
  }
  requireSha256(signature.catalogSha256, "signature.catalogSha256");
  requireIsoDate(signature.signedAt, "signature.signedAt");
  if (
    typeof signature.signature !== "string" ||
    signature.signature.length === 0
  ) {
    throw new PluginCatalogSignatureError("signature.signature is required");
  }
  return signature as PluginCatalogSignature;
}

function requireSha256(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new PluginCatalogError(
      `${path} must be a lowercase SHA-256 hex digest`,
    );
  }
}

function requireIsoDate(value: unknown, path: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new PluginCatalogError(`${path} must be an ISO timestamp`);
  }
}

function requireRepository(
  value: unknown,
  path: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)
  ) {
    throw new PluginCatalogError(
      `${path} must be a GitHub repository in owner/name form`,
    );
  }
}

function requireRef(value: unknown, path: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 255 ||
    /\s/.test(value)
  ) {
    throw new PluginCatalogError(
      `${path} must be a non-empty Git ref without whitespace`,
    );
  }
}

function requireCommitSha(
  value: unknown,
  path: string,
): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) {
    throw new PluginCatalogError(
      `${path} must be a lowercase 40-character Git commit SHA`,
    );
  }
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new PluginCatalogError(`Invalid date: ${String(value)}`);
  }
  return date.toISOString();
}

// Same canonical form as release-manifest: sorted keys, no whitespace —
// signature stability depends on this never changing.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}
