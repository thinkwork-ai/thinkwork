import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";

export const RELEASE_MANIFEST_SCHEMA_VERSION = 1;
export const CUSTOMER_OVERLAY_SCHEMA_VERSION = 1;
export const RELEASE_SIGNATURE_SCHEMA_VERSION = 1;
export const TERRAFORM_MODULE_SOURCE = "thinkwork-ai/thinkwork/aws";
export const RELEASE_SIGNATURE_ALGORITHM = "ed25519";

export type ReleaseArtifactType =
  | "lambda"
  | "static-site"
  | "terraform"
  | "seed";

export type RuntimeImageArchitecture = "amd64" | "arm64";

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

export interface ManagedAppDescriptor {
  id: string;
  displayName: string;
  terraformModule?: {
    source: string;
    version: string;
  };
  requiredArtifacts?: readonly string[];
  requiredImages?: readonly string[];
  smokeContracts?: readonly SmokeContract[];
}

export interface SmokeContract {
  id: string;
  command: string;
  required: boolean;
}

export interface ThinkWorkReleaseManifest {
  schemaVersion: typeof RELEASE_MANIFEST_SCHEMA_VERSION;
  release: {
    version: string;
    gitSha: string;
    createdAt: string;
  };
  compatibility: {
    minCliVersion: string;
    minRunnerVersion: string;
    profileSchemaVersion: number;
  };
  components: {
    cli: {
      version: string;
    };
    terraform: {
      source: string;
      version: string;
    };
    deploymentRunner: {
      version: string;
      image: string | null;
    };
    customerOverlay: {
      schemaVersion: typeof CUSTOMER_OVERLAY_SCHEMA_VERSION;
    };
  };
  artifacts: ReleaseArtifact[];
  runtimeImages: RuntimeImage[];
  managedApps: ManagedAppDescriptor[];
  signing: {
    acceptedKeyIds: string[];
    revokedKeyIds: string[];
  };
}

export interface ReleaseManifestSignature {
  schemaVersion: typeof RELEASE_SIGNATURE_SCHEMA_VERSION;
  algorithm: typeof RELEASE_SIGNATURE_ALGORITHM;
  keyId: string;
  manifestSha256: string;
  signedAt: string;
  notBefore: string;
  expiresAt: string;
  signature: string;
}

export interface TrustedReleaseKey {
  keyId: string;
  publicKeyPem: string;
  notBefore?: string;
  expiresAt?: string;
}

export interface ReleaseManifestVerificationResult {
  manifestSha256: string;
  keyId: string;
}

export class ReleaseManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseManifestError";
  }
}

export function validateReleaseManifest(
  value: unknown,
): ThinkWorkReleaseManifest {
  const manifest = value as Partial<ThinkWorkReleaseManifest>;
  if (!manifest || typeof manifest !== "object") {
    throw new ReleaseManifestError("Release manifest must be an object");
  }
  if (manifest.schemaVersion !== RELEASE_MANIFEST_SCHEMA_VERSION) {
    throw new ReleaseManifestError(
      `Release manifest schemaVersion must be ${RELEASE_MANIFEST_SCHEMA_VERSION}`,
    );
  }
  requireString(manifest.release?.version, "release.version");
  requireString(manifest.release?.gitSha, "release.gitSha");
  requireIsoDate(manifest.release?.createdAt, "release.createdAt");
  requireString(
    manifest.compatibility?.minCliVersion,
    "compatibility.minCliVersion",
  );
  requireString(
    manifest.compatibility?.minRunnerVersion,
    "compatibility.minRunnerVersion",
  );
  requireNumber(
    manifest.compatibility?.profileSchemaVersion,
    "compatibility.profileSchemaVersion",
  );
  requireString(manifest.components?.cli?.version, "components.cli.version");
  requireString(
    manifest.components?.terraform?.source,
    "components.terraform.source",
  );
  requireString(
    manifest.components?.terraform?.version,
    "components.terraform.version",
  );
  requireString(
    manifest.components?.deploymentRunner?.version,
    "components.deploymentRunner.version",
  );
  if (
    manifest.components?.deploymentRunner?.image !== null &&
    typeof manifest.components?.deploymentRunner?.image !== "string"
  ) {
    throw new ReleaseManifestError(
      "components.deploymentRunner.image must be a string or null",
    );
  }
  if (
    manifest.components?.customerOverlay?.schemaVersion !==
    CUSTOMER_OVERLAY_SCHEMA_VERSION
  ) {
    throw new ReleaseManifestError(
      `components.customerOverlay.schemaVersion must be ${CUSTOMER_OVERLAY_SCHEMA_VERSION}`,
    );
  }
  validateArtifacts(manifest.artifacts);
  validateRuntimeImages(manifest.runtimeImages);
  validateManagedApps(manifest.managedApps);
  validateStringArray(
    manifest.signing?.acceptedKeyIds,
    "signing.acceptedKeyIds",
  );
  validateStringArray(manifest.signing?.revokedKeyIds, "signing.revokedKeyIds");
  return manifest as ThinkWorkReleaseManifest;
}

export function validateReleaseManifestSignature(
  value: unknown,
): ReleaseManifestSignature {
  const signature = value as Partial<ReleaseManifestSignature>;
  if (!signature || typeof signature !== "object") {
    throw new ReleaseManifestError(
      "Release manifest signature must be an object",
    );
  }
  if (signature.schemaVersion !== RELEASE_SIGNATURE_SCHEMA_VERSION) {
    throw new ReleaseManifestError(
      `Release manifest signature schemaVersion must be ${RELEASE_SIGNATURE_SCHEMA_VERSION}`,
    );
  }
  if (signature.algorithm !== RELEASE_SIGNATURE_ALGORITHM) {
    throw new ReleaseManifestError(
      `Release manifest signature algorithm must be ${RELEASE_SIGNATURE_ALGORITHM}`,
    );
  }
  requireString(signature.keyId, "signature.keyId");
  requireSha256(signature.manifestSha256, "signature.manifestSha256");
  requireIsoDate(signature.signedAt, "signature.signedAt");
  requireIsoDate(signature.notBefore, "signature.notBefore");
  requireIsoDate(signature.expiresAt, "signature.expiresAt");
  requireString(signature.signature, "signature.signature");
  return signature as ReleaseManifestSignature;
}

export function canonicalReleaseManifestBytes(
  manifest: ThinkWorkReleaseManifest,
): Buffer {
  return Buffer.from(
    stableStringify(validateReleaseManifest(manifest)),
    "utf8",
  );
}

export function releaseManifestSha256(
  manifest: ThinkWorkReleaseManifest,
): string {
  return sha256Hex(canonicalReleaseManifestBytes(manifest));
}

export function signReleaseManifest(options: {
  manifest: ThinkWorkReleaseManifest;
  keyId: string;
  privateKeyPem: string;
  signedAt?: Date | string;
  notBefore?: Date | string;
  expiresAt: Date | string;
}): ReleaseManifestSignature {
  const manifestSha256 = releaseManifestSha256(options.manifest);
  const signedAt = toIso(options.signedAt ?? new Date());
  const notBefore = toIso(options.notBefore ?? signedAt);
  const expiresAt = toIso(options.expiresAt);
  const privateKey = createPrivateKey(options.privateKeyPem);
  const signature = signBytes(
    null,
    canonicalReleaseManifestBytes(options.manifest),
    privateKey,
  ).toString("base64");

  return {
    schemaVersion: RELEASE_SIGNATURE_SCHEMA_VERSION,
    algorithm: RELEASE_SIGNATURE_ALGORITHM,
    keyId: options.keyId,
    manifestSha256,
    signedAt,
    notBefore,
    expiresAt,
    signature,
  };
}

export function verifyReleaseManifest(options: {
  manifest: ThinkWorkReleaseManifest;
  signature: ReleaseManifestSignature;
  trustedKeys: readonly TrustedReleaseKey[];
  now?: Date | string;
  revokedKeyIds?: readonly string[];
}): ReleaseManifestVerificationResult {
  const manifest = validateReleaseManifest(options.manifest);
  const signature = validateReleaseManifestSignature(options.signature);
  const now = new Date(options.now ?? Date.now());
  const revoked = new Set([
    ...manifest.signing.revokedKeyIds,
    ...(options.revokedKeyIds ?? []),
  ]);

  if (revoked.has(signature.keyId)) {
    throw new ReleaseManifestError(
      `Release manifest signing key is revoked: ${signature.keyId}`,
    );
  }

  const trustedKey = options.trustedKeys.find(
    (candidate) => candidate.keyId === signature.keyId,
  );
  if (!trustedKey) {
    throw new ReleaseManifestError(
      `Release manifest signing key is not trusted: ${signature.keyId}`,
    );
  }
  if (!manifest.signing.acceptedKeyIds.includes(signature.keyId)) {
    throw new ReleaseManifestError(
      `Release manifest does not accept signing key: ${signature.keyId}`,
    );
  }
  assertWithinWindow(
    now,
    signature.notBefore,
    signature.expiresAt,
    `signature ${signature.keyId}`,
  );
  if (trustedKey.notBefore || trustedKey.expiresAt) {
    assertWithinWindow(
      now,
      trustedKey.notBefore ?? "1970-01-01T00:00:00.000Z",
      trustedKey.expiresAt ?? "9999-12-31T23:59:59.999Z",
      `trusted key ${signature.keyId}`,
    );
  }

  const manifestSha256 = releaseManifestSha256(manifest);
  if (signature.manifestSha256 !== manifestSha256) {
    throw new ReleaseManifestError(
      `Release manifest digest mismatch: expected ${signature.manifestSha256}, got ${manifestSha256}`,
    );
  }

  const valid = verifyBytes(
    null,
    canonicalReleaseManifestBytes(manifest),
    createPublicKey(trustedKey.publicKeyPem),
    Buffer.from(signature.signature, "base64"),
  );
  if (!valid) {
    throw new ReleaseManifestError("Release manifest signature is invalid");
  }

  return { manifestSha256, keyId: signature.keyId };
}

export function verifyArtifactHash(
  artifact: Pick<ReleaseArtifact, "name" | "sha256">,
  bytes: Buffer | Uint8Array | string,
): void {
  const actual = sha256Hex(bytes);
  if (actual !== artifact.sha256) {
    throw new ReleaseManifestError(
      `Release artifact "${artifact.name}" hash mismatch: expected ${artifact.sha256}, got ${actual}`,
    );
  }
}

export function assertManifestCompatible(options: {
  manifest: ThinkWorkReleaseManifest;
  cliVersion: string;
  runnerVersion?: string;
  profileSchemaVersion?: number;
}): void {
  const manifest = validateReleaseManifest(options.manifest);
  if (
    compareSemver(
      normalizeVersion(options.cliVersion),
      normalizeVersion(manifest.compatibility.minCliVersion),
    ) < 0
  ) {
    throw new ReleaseManifestError(
      `CLI ${options.cliVersion} is older than release manifest minimum ${manifest.compatibility.minCliVersion}`,
    );
  }
  if (
    options.runnerVersion &&
    compareSemver(
      normalizeVersion(options.runnerVersion),
      normalizeVersion(manifest.compatibility.minRunnerVersion),
    ) < 0
  ) {
    throw new ReleaseManifestError(
      `Runner ${options.runnerVersion} is older than release manifest minimum ${manifest.compatibility.minRunnerVersion}`,
    );
  }
  if (
    options.profileSchemaVersion !== undefined &&
    options.profileSchemaVersion < manifest.compatibility.profileSchemaVersion
  ) {
    throw new ReleaseManifestError(
      `Profile schema ${options.profileSchemaVersion} is older than release manifest minimum ${manifest.compatibility.profileSchemaVersion}`,
    );
  }
}

export function normalizeVersion(version: string): string {
  return version.startsWith("v") ? version.slice(1) : version;
}

export function sha256Hex(bytes: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function validateArtifacts(value: unknown): void {
  if (!Array.isArray(value)) {
    throw new ReleaseManifestError("artifacts must be an array");
  }
  const names = new Set<string>();
  for (const artifact of value as Partial<ReleaseArtifact>[]) {
    requireString(artifact.name, "artifact.name");
    if (names.has(artifact.name)) {
      throw new ReleaseManifestError(
        `Duplicate release artifact logical name: ${artifact.name}`,
      );
    }
    names.add(artifact.name);
    if (
      artifact.type !== "lambda" &&
      artifact.type !== "static-site" &&
      artifact.type !== "terraform" &&
      artifact.type !== "seed"
    ) {
      throw new ReleaseManifestError(
        `Invalid release artifact type for ${artifact.name}`,
      );
    }
    requireString(artifact.fileName, `artifact ${artifact.name}.fileName`);
    requireString(
      artifact.relativePath,
      `artifact ${artifact.name}.relativePath`,
    );
    if (artifact.url !== null && typeof artifact.url !== "string") {
      throw new ReleaseManifestError(
        `artifact ${artifact.name}.url must be a string or null`,
      );
    }
    requireSha256(artifact.sha256, `artifact ${artifact.name}.sha256`);
    requireNumber(artifact.sizeBytes, `artifact ${artifact.name}.sizeBytes`);
  }
}

function validateRuntimeImages(value: unknown): void {
  if (!Array.isArray(value)) {
    throw new ReleaseManifestError("runtimeImages must be an array");
  }
  for (const image of value as Partial<RuntimeImage>[]) {
    requireString(image.name, "runtimeImage.name");
    requireString(image.repository, `runtimeImage ${image.name}.repository`);
    requireString(image.tag, `runtimeImage ${image.name}.tag`);
    if (!image.digest?.startsWith("sha256:")) {
      throw new ReleaseManifestError(
        `runtimeImage ${image.name}.digest must start with sha256:`,
      );
    }
    if (image.architecture !== "amd64" && image.architecture !== "arm64") {
      throw new ReleaseManifestError(
        `runtimeImage ${image.name}.architecture must be amd64 or arm64`,
      );
    }
    requireString(image.uri, `runtimeImage ${image.name}.uri`);
  }
}

function validateManagedApps(value: unknown): void {
  if (!Array.isArray(value)) {
    throw new ReleaseManifestError("managedApps must be an array");
  }
  for (const app of value as Partial<ManagedAppDescriptor>[]) {
    requireString(app.id, "managedApp.id");
    requireString(app.displayName, `managedApp ${app.id}.displayName`);
    if (app.terraformModule) {
      requireString(
        app.terraformModule.source,
        `managedApp ${app.id}.terraformModule.source`,
      );
      requireString(
        app.terraformModule.version,
        `managedApp ${app.id}.terraformModule.version`,
      );
    }
    if (app.requiredArtifacts) {
      validateStringArray(
        app.requiredArtifacts,
        `managedApp ${app.id}.requiredArtifacts`,
      );
    }
    if (app.requiredImages) {
      validateStringArray(
        app.requiredImages,
        `managedApp ${app.id}.requiredImages`,
      );
    }
    if (app.smokeContracts) {
      if (!Array.isArray(app.smokeContracts)) {
        throw new ReleaseManifestError(
          `managedApp ${app.id}.smokeContracts must be an array`,
        );
      }
      for (const contract of app.smokeContracts as Partial<SmokeContract>[]) {
        requireString(contract.id, `managedApp ${app.id}.smokeContract.id`);
        requireString(
          contract.command,
          `managedApp ${app.id}.smokeContract.command`,
        );
        if (typeof contract.required !== "boolean") {
          throw new ReleaseManifestError(
            `managedApp ${app.id}.smokeContract.required must be a boolean`,
          );
        }
      }
    }
  }
}

function validateStringArray(value: unknown, path: string): void {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new ReleaseManifestError(`${path} must be an array of strings`);
  }
}

function requireString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ReleaseManifestError(`${path} is required`);
  }
}

function requireNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ReleaseManifestError(`${path} must be a number`);
  }
}

function requireSha256(value: unknown, path: string): asserts value is string {
  requireString(value, path);
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new ReleaseManifestError(
      `${path} must be a lowercase SHA-256 hex digest`,
    );
  }
}

function requireIsoDate(value: unknown, path: string): asserts value is string {
  requireString(value, path);
  if (Number.isNaN(Date.parse(value))) {
    throw new ReleaseManifestError(`${path} must be an ISO timestamp`);
  }
}

function assertWithinWindow(
  now: Date,
  notBefore: string,
  expiresAt: string,
  label: string,
): void {
  if (now < new Date(notBefore)) {
    throw new ReleaseManifestError(`${label} is not valid before ${notBefore}`);
  }
  if (now > new Date(expiresAt)) {
    throw new ReleaseManifestError(`${label} expired at ${expiresAt}`);
  }
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new ReleaseManifestError(`Invalid date: ${String(value)}`);
  }
  return date.toISOString();
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => a.localeCompare(b),
  );
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

function compareSemver(left: string, right: string): number {
  const leftParts = left
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}
