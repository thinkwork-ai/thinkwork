export const DEPLOYMENT_PROFILE_SCHEMA_VERSION = 1;
export const DEPLOYMENT_PROFILE_SIGNATURE_SCHEMA_VERSION = 1;
export const DEPLOYMENT_PROFILE_SIGNATURE_ALGORITHM = "ed25519";

export type DeploymentProfileTrustStatus =
  | "trusted"
  | "unsigned"
  | "invalid_signature"
  | "unknown_key"
  | "unsupported_schema"
  | "missing_required_field"
  | "malformed_url"
  | "malformed_json"
  | "endpoint_mismatch"
  | "expired";

export interface DeploymentProfileSignature {
  schemaVersion: typeof DEPLOYMENT_PROFILE_SIGNATURE_SCHEMA_VERSION;
  algorithm: typeof DEPLOYMENT_PROFILE_SIGNATURE_ALGORITHM;
  keyId: string;
  profileSha256: string;
  signedAt: string;
  notBefore: string;
  expiresAt: string;
  issuer: string;
  signature: string;
}

export interface DeploymentProfile {
  schemaVersion: typeof DEPLOYMENT_PROFILE_SCHEMA_VERSION;
  deploymentId: string;
  displayName: string;
  stage: string;
  region: string;
  accountId?: string;
  releaseVersion?: string;
  releaseManifestUrl?: string;
  releaseManifestSha256?: string;
  controller?: DeploymentProfileController;
  issuedAt: string;
  spacesUrl: string;
  apiUrl: string;
  graphqlHttpUrl: string;
  appsyncHttpUrl: string;
  appsyncWsUrl: string;
  cognitoDomain: string;
  cognitoUserPoolId: string;
  cognitoClientId: string;
  signature: DeploymentProfileSignature | null;
}

export interface DeploymentProfileController {
  stateMachineArn: string;
  stateMachineName?: string;
  codebuildProjectName?: string;
  codebuildProjectArn?: string;
  evidenceBucketName?: string;
  ssmPrefix?: string;
  appconfigApplicationId?: string;
  appconfigEnvironmentId?: string;
  appconfigConfigurationProfileId?: string;
  verifiedAt?: string;
}

export interface DeploymentProfileSourceConfig {
  deploymentId?: string | null;
  displayName?: string | null;
  stage?: string | null;
  region?: string | null;
  accountId?: string | null;
  releaseVersion?: string | null;
  releaseManifestUrl?: string | null;
  releaseManifestSha256?: string | null;
  controller?: DeploymentProfileController | null;
  issuedAt?: string | null;
  spacesUrl?: string | null;
  apiUrl?: string | null;
  graphqlHttpUrl?: string | null;
  appsyncHttpUrl?: string | null;
  appsyncWsUrl?: string | null;
  cognitoDomain?: string | null;
  cognitoUserPoolId?: string | null;
  cognitoClientId?: string | null;
  signature?: DeploymentProfileSignature | null;
}

export interface TrustedDeploymentProfileKey {
  keyId: string;
  publicKeyPem: string;
  issuer: string;
  notBefore?: string;
  expiresAt?: string;
}

export interface DeploymentProfileValidationIssue {
  status: DeploymentProfileTrustStatus;
  field?: string;
  message: string;
}

export interface DeploymentProfileTrustDetails {
  keyId: string;
  issuer: string;
  publicKeyFingerprint: string;
  signedAt: string;
  expiresAt: string;
}

export interface DeploymentProfileValidationResult {
  ok: boolean;
  status: DeploymentProfileTrustStatus;
  profile: DeploymentProfile | null;
  profileSha256: string | null;
  issues: DeploymentProfileValidationIssue[];
  trust: DeploymentProfileTrustDetails | null;
}

export interface DeploymentProfileValidationOptions {
  allowUnsigned?: boolean;
  allowHttpLocalhost?: boolean;
  now?: Date | string;
  maxAgeMs?: number;
}

export class DeploymentProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeploymentProfileError";
  }
}

export function buildDeploymentProfile(
  config: DeploymentProfileSourceConfig,
): DeploymentProfile {
  const profile: DeploymentProfile = {
    schemaVersion: DEPLOYMENT_PROFILE_SCHEMA_VERSION,
    deploymentId: requireConfigString(config.deploymentId, "deploymentId"),
    displayName: requireConfigString(config.displayName, "displayName"),
    stage: requireConfigString(config.stage, "stage"),
    region: requireConfigString(config.region, "region"),
    issuedAt: config.issuedAt?.trim() || new Date().toISOString(),
    spacesUrl: requireConfigString(config.spacesUrl, "spacesUrl"),
    apiUrl: requireConfigString(config.apiUrl, "apiUrl"),
    graphqlHttpUrl: requireConfigString(
      config.graphqlHttpUrl,
      "graphqlHttpUrl",
    ),
    appsyncHttpUrl: requireConfigString(
      config.appsyncHttpUrl,
      "appsyncHttpUrl",
    ),
    appsyncWsUrl: requireConfigString(config.appsyncWsUrl, "appsyncWsUrl"),
    cognitoDomain: requireConfigString(config.cognitoDomain, "cognitoDomain"),
    cognitoUserPoolId: requireConfigString(
      config.cognitoUserPoolId,
      "cognitoUserPoolId",
    ),
    cognitoClientId: requireConfigString(
      config.cognitoClientId,
      "cognitoClientId",
    ),
    signature: config.signature ?? null,
  };
  copyOptionalString(profile, "accountId", config.accountId);
  copyOptionalString(profile, "releaseVersion", config.releaseVersion);
  copyOptionalString(profile, "releaseManifestUrl", config.releaseManifestUrl);
  copyOptionalString(
    profile,
    "releaseManifestSha256",
    config.releaseManifestSha256,
  );
  if (config.controller) {
    profile.controller = compactController(config.controller);
  }
  return profile;
}

export function parseDeploymentProfileJson(
  json: string,
  options: DeploymentProfileValidationOptions = {},
): DeploymentProfileValidationResult {
  try {
    return assessDeploymentProfile(JSON.parse(json), options);
  } catch (error) {
    return failedResult("malformed_json", null, [
      {
        status: "malformed_json",
        message:
          error instanceof Error
            ? `Deployment profile JSON is malformed: ${error.message}`
            : "Deployment profile JSON is malformed.",
      },
    ]);
  }
}

export function validateDeploymentProfile(
  value: unknown,
  options: DeploymentProfileValidationOptions = {},
): DeploymentProfile {
  const result = assessDeploymentProfile(value, {
    ...options,
    allowUnsigned: true,
  });
  if (!result.profile) {
    throw new DeploymentProfileError(
      result.issues[0]?.message ?? result.status,
    );
  }
  return result.profile;
}

export function assessDeploymentProfile(
  value: unknown,
  options: DeploymentProfileValidationOptions = {},
): DeploymentProfileValidationResult {
  const issues: DeploymentProfileValidationIssue[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return failedResult("malformed_json", null, [
      {
        status: "malformed_json",
        message: "Deployment profile must be a JSON object.",
      },
    ]);
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== DEPLOYMENT_PROFILE_SCHEMA_VERSION) {
    return failedResult("unsupported_schema", null, [
      {
        status: "unsupported_schema",
        field: "schemaVersion",
        message: `Deployment profile schemaVersion must be ${DEPLOYMENT_PROFILE_SCHEMA_VERSION}.`,
      },
    ]);
  }

  const stringFields = [
    "deploymentId",
    "displayName",
    "stage",
    "region",
    "issuedAt",
    "spacesUrl",
    "apiUrl",
    "graphqlHttpUrl",
    "appsyncHttpUrl",
    "appsyncWsUrl",
    "cognitoDomain",
    "cognitoUserPoolId",
    "cognitoClientId",
  ] as const;

  for (const field of stringFields) {
    if (typeof candidate[field] !== "string" || !candidate[field].trim()) {
      issues.push({
        status: "missing_required_field",
        field,
        message: `Deployment profile is missing ${field}.`,
      });
    }
  }

  if (issues.length > 0) {
    return failedResult("missing_required_field", null, issues);
  }

  const profile = candidate as unknown as DeploymentProfile;
  const dateIssues = validateDates(profile, options);
  issues.push(...dateIssues);
  issues.push(...validateEndpointFields(profile, options));

  if (!("signature" in candidate)) {
    issues.push({
      status: "missing_required_field",
      field: "signature",
      message:
        "Deployment profile is missing signature metadata; use null only for the explicit development fallback.",
    });
  } else if (profile.signature !== null) {
    issues.push(...validateSignatureMetadata(profile.signature));
  }

  if (issues.length > 0) {
    return failedResult(
      issues[0]?.status ?? "missing_required_field",
      profile,
      issues,
    );
  }

  const profileSha256 = deploymentProfileSha256(profile);
  if (!profile.signature) {
    return {
      ok: Boolean(options.allowUnsigned),
      status: "unsigned",
      profile,
      profileSha256,
      issues: options.allowUnsigned
        ? []
        : [
            {
              status: "unsigned",
              field: "signature",
              message:
                "Deployment profile is unsigned; production OAuth requires a trusted signature.",
            },
          ],
      trust: null,
    };
  }

  if (profile.signature.profileSha256 !== profileSha256) {
    return failedResult("endpoint_mismatch", profile, [
      {
        status: "endpoint_mismatch",
        field: "signature.profileSha256",
        message:
          "Deployment profile contents do not match the signed profile digest.",
      },
    ]);
  }

  return {
    ok: true,
    status: "trusted",
    profile,
    profileSha256,
    issues: [],
    trust: {
      keyId: profile.signature.keyId,
      issuer: profile.signature.issuer,
      publicKeyFingerprint: "",
      signedAt: profile.signature.signedAt,
      expiresAt: profile.signature.expiresAt,
    },
  };
}

export async function signDeploymentProfile(options: {
  profile: Omit<DeploymentProfile, "signature"> | DeploymentProfile;
  keyId: string;
  privateKeyPem: string;
  issuer: string;
  signedAt?: Date | string;
  notBefore?: Date | string;
  expiresAt: Date | string;
}): Promise<DeploymentProfile> {
  const profile = {
    ...options.profile,
    signature: null,
  } satisfies DeploymentProfile;
  const profileSha256 = deploymentProfileSha256(profile);
  const signedAt = toIso(options.signedAt ?? new Date());
  const notBefore = toIso(options.notBefore ?? signedAt);
  const expiresAt = toIso(options.expiresAt);
  const privateKey = await importPemPrivateKey(options.privateKeyPem);
  const signatureBytes = await cryptoSubtle().sign(
    { name: "Ed25519" },
    privateKey,
    toArrayBuffer(deploymentProfileCanonicalBytes(profile)),
  );

  return {
    ...profile,
    signature: {
      schemaVersion: DEPLOYMENT_PROFILE_SIGNATURE_SCHEMA_VERSION,
      algorithm: DEPLOYMENT_PROFILE_SIGNATURE_ALGORITHM,
      keyId: options.keyId,
      profileSha256,
      signedAt,
      notBefore,
      expiresAt,
      issuer: requireConfigString(options.issuer, "issuer"),
      signature: bytesToBase64(new Uint8Array(signatureBytes)),
    },
  };
}

export async function verifyDeploymentProfile(
  value: unknown,
  trustedKeys: readonly TrustedDeploymentProfileKey[],
  options: DeploymentProfileValidationOptions = {},
): Promise<DeploymentProfileValidationResult> {
  const structural = assessDeploymentProfile(value, options);
  if (!structural.profile || structural.status !== "trusted") {
    return structural;
  }

  const signature = structural.profile.signature;
  if (!signature) return structural;

  const key = trustedKeys.find(
    (candidate) => candidate.keyId === signature.keyId,
  );
  if (!key) {
    return failedResult("unknown_key", structural.profile, [
      {
        status: "unknown_key",
        field: "signature.keyId",
        message: `Deployment profile signing key ${signature.keyId} is not trusted.`,
      },
    ]);
  }

  const now = toDate(options.now ?? new Date());
  if (key.issuer !== signature.issuer) {
    return failedResult("unknown_key", structural.profile, [
      {
        status: "unknown_key",
        field: "signature.issuer",
        message: `Deployment profile issuer ${signature.issuer} does not match trusted key ${key.keyId}.`,
      },
    ]);
  }
  if (key.notBefore && now < toDate(key.notBefore)) {
    return failedResult("unknown_key", structural.profile, [
      {
        status: "unknown_key",
        field: "trustedKey.notBefore",
        message: `Deployment profile signing key ${key.keyId} is not active yet.`,
      },
    ]);
  }
  if (key.expiresAt && now > toDate(key.expiresAt)) {
    return failedResult("unknown_key", structural.profile, [
      {
        status: "unknown_key",
        field: "trustedKey.expiresAt",
        message: `Deployment profile signing key ${key.keyId} has expired.`,
      },
    ]);
  }

  const publicKey = await importPemPublicKey(key.publicKeyPem);
  const verified = await cryptoSubtle().verify(
    { name: "Ed25519" },
    publicKey,
    toArrayBuffer(base64ToBytes(signature.signature)),
    toArrayBuffer(deploymentProfileCanonicalBytes(structural.profile)),
  );
  if (!verified) {
    return failedResult("invalid_signature", structural.profile, [
      {
        status: "invalid_signature",
        field: "signature.signature",
        message: "Deployment profile signature could not be verified.",
      },
    ]);
  }

  return {
    ok: true,
    status: "trusted",
    profile: structural.profile,
    profileSha256: structural.profileSha256,
    issues: [],
    trust: {
      keyId: key.keyId,
      issuer: key.issuer,
      publicKeyFingerprint: await publicKeyFingerprint(key.publicKeyPem),
      signedAt: signature.signedAt,
      expiresAt: signature.expiresAt,
    },
  };
}

export function deploymentProfileCanonicalJson(
  profile: DeploymentProfile,
): string {
  return stableStringify(unsignedProfile(profile));
}

export function deploymentProfileCanonicalBytes(
  profile: DeploymentProfile,
): Uint8Array {
  return new TextEncoder().encode(deploymentProfileCanonicalJson(profile));
}

export function deploymentProfileSha256(profile: DeploymentProfile): string {
  return sha256HexSync(deploymentProfileCanonicalBytes(profile));
}

export function profileToRuntimeConfig(profile: DeploymentProfile) {
  const validated = validateDeploymentProfile(profile);
  return {
    deploymentId: validated.deploymentId,
    displayName: validated.displayName,
    stage: validated.stage,
    region: validated.region,
    accountId: validated.accountId,
    releaseVersion: validated.releaseVersion,
    releaseManifestUrl: validated.releaseManifestUrl,
    releaseManifestSha256: validated.releaseManifestSha256,
    controller: validated.controller,
    apiUrl: validated.apiUrl,
    graphqlHttpUrl: validated.graphqlHttpUrl,
    graphqlUrl: validated.appsyncHttpUrl,
    graphqlWsUrl: validated.appsyncWsUrl,
    cognitoDomain: normalizedCognitoDomain(validated.cognitoDomain),
    cognitoUserPoolId: validated.cognitoUserPoolId,
    cognitoClientId: validated.cognitoClientId,
  };
}

function copyOptionalString(
  target: object,
  key: string,
  value: string | null | undefined,
): void {
  if (typeof value === "string" && value.trim()) {
    (target as Record<string, unknown>)[key] = value.trim();
  }
}

function compactController(
  controller: DeploymentProfileController,
): DeploymentProfileController {
  return Object.fromEntries(
    Object.entries(controller).filter(
      ([, value]) => typeof value === "string" && value.trim(),
    ),
  ) as unknown as DeploymentProfileController;
}

function unsignedProfile(
  profile: DeploymentProfile,
): Omit<DeploymentProfile, "signature"> {
  const { signature: _signature, ...unsigned } = profile;
  return unsigned;
}

function validateDates(
  profile: DeploymentProfile,
  options: DeploymentProfileValidationOptions,
): DeploymentProfileValidationIssue[] {
  const issues: DeploymentProfileValidationIssue[] = [];
  const now = toDate(options.now ?? new Date());
  const issuedAt = safeDate(profile.issuedAt);
  if (!issuedAt) {
    issues.push({
      status: "missing_required_field",
      field: "issuedAt",
      message: "Deployment profile issuedAt must be an ISO timestamp.",
    });
  } else if (
    options.maxAgeMs &&
    now.getTime() - issuedAt.getTime() > options.maxAgeMs
  ) {
    issues.push({
      status: "expired",
      field: "issuedAt",
      message: "Deployment profile is older than the allowed maximum age.",
    });
  }

  if (!profile.signature) return issues;
  const signedAt = safeDate(profile.signature.signedAt);
  const notBefore = safeDate(profile.signature.notBefore);
  const expiresAt = safeDate(profile.signature.expiresAt);
  if (signedAt && notBefore && expiresAt) {
    if (now < notBefore) {
      issues.push({
        status: "expired",
        field: "signature.notBefore",
        message: "Deployment profile signature is not valid yet.",
      });
    }
    if (now > expiresAt) {
      issues.push({
        status: "expired",
        field: "signature.expiresAt",
        message: "Deployment profile signature has expired.",
      });
    }
  }
  return issues;
}

function validateEndpointFields(
  profile: DeploymentProfile,
  options: DeploymentProfileValidationOptions,
): DeploymentProfileValidationIssue[] {
  const issues: DeploymentProfileValidationIssue[] = [];
  for (const field of [
    "spacesUrl",
    "apiUrl",
    "graphqlHttpUrl",
    "appsyncHttpUrl",
  ] as const) {
    if (!isAllowedUrl(profile[field], "https:", options.allowHttpLocalhost)) {
      issues.push({
        status: "malformed_url",
        field,
        message: `${field} must be an HTTPS URL.`,
      });
    }
  }
  if (!isAllowedUrl(profile.appsyncWsUrl, "wss:", options.allowHttpLocalhost)) {
    issues.push({
      status: "malformed_url",
      field: "appsyncWsUrl",
      message: "appsyncWsUrl must be a WSS URL.",
    });
  }
  if (
    !isAllowedCognitoDomain(profile.cognitoDomain, options.allowHttpLocalhost)
  ) {
    issues.push({
      status: "malformed_url",
      field: "cognitoDomain",
      message: "cognitoDomain must be a hostname or HTTPS URL.",
    });
  }
  return issues;
}

function validateSignatureMetadata(
  value: unknown,
): DeploymentProfileValidationIssue[] {
  const signature = value as Partial<DeploymentProfileSignature>;
  const issues: DeploymentProfileValidationIssue[] = [];
  if (!signature || typeof signature !== "object") {
    return [
      {
        status: "missing_required_field",
        field: "signature",
        message: "Deployment profile signature must be an object or null.",
      },
    ];
  }
  if (signature.schemaVersion !== DEPLOYMENT_PROFILE_SIGNATURE_SCHEMA_VERSION) {
    issues.push({
      status: "unsupported_schema",
      field: "signature.schemaVersion",
      message: `Deployment profile signature schemaVersion must be ${DEPLOYMENT_PROFILE_SIGNATURE_SCHEMA_VERSION}.`,
    });
  }
  if (signature.algorithm !== DEPLOYMENT_PROFILE_SIGNATURE_ALGORITHM) {
    issues.push({
      status: "invalid_signature",
      field: "signature.algorithm",
      message: `Deployment profile signature algorithm must be ${DEPLOYMENT_PROFILE_SIGNATURE_ALGORITHM}.`,
    });
  }
  for (const field of [
    "keyId",
    "profileSha256",
    "signedAt",
    "notBefore",
    "expiresAt",
    "issuer",
    "signature",
  ] as const) {
    if (typeof signature[field] !== "string" || !signature[field]?.trim()) {
      issues.push({
        status: "missing_required_field",
        field: `signature.${field}`,
        message: `Deployment profile signature is missing ${field}.`,
      });
    }
  }
  if (
    signature.profileSha256 &&
    !/^[a-f0-9]{64}$/.test(signature.profileSha256)
  ) {
    issues.push({
      status: "invalid_signature",
      field: "signature.profileSha256",
      message:
        "Deployment profile signature digest must be a SHA-256 hex value.",
    });
  }
  for (const field of ["signedAt", "notBefore", "expiresAt"] as const) {
    if (signature[field] && !safeDate(signature[field])) {
      issues.push({
        status: "missing_required_field",
        field: `signature.${field}`,
        message: `Deployment profile signature ${field} must be an ISO timestamp.`,
      });
    }
  }
  return issues;
}

function failedResult(
  status: DeploymentProfileTrustStatus,
  profile: DeploymentProfile | null,
  issues: DeploymentProfileValidationIssue[],
): DeploymentProfileValidationResult {
  return {
    ok: false,
    status,
    profile,
    profileSha256: profile ? deploymentProfileSha256(profile) : null,
    issues,
    trust: null,
  };
}

function requireConfigString(
  value: string | null | undefined,
  field: string,
): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new DeploymentProfileError(
      `Deployment profile config is missing ${field}.`,
    );
  }
  return trimmed;
}

function isAllowedUrl(
  value: string,
  protocol: "https:" | "wss:",
  allowHttpLocalhost = false,
): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === protocol) return true;
    if (!allowHttpLocalhost) return false;
    if (
      protocol === "https:" &&
      parsed.protocol === "http:" &&
      isLocalhost(parsed.hostname)
    ) {
      return true;
    }
    if (
      protocol === "wss:" &&
      parsed.protocol === "ws:" &&
      isLocalhost(parsed.hostname)
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function isAllowedCognitoDomain(
  value: string,
  allowHttpLocalhost = false,
): boolean {
  const normalized = normalizedCognitoDomain(value);
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === "https:") return true;
    return Boolean(
      allowHttpLocalhost &&
      parsed.protocol === "http:" &&
      isLocalhost(parsed.hostname),
    );
  } catch {
    return false;
  }
}

function normalizedCognitoDomain(value: string): string {
  const trimmed = value.trim().replace(/\/$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function isLocalhost(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

function safeDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DeploymentProfileError(`Invalid timestamp: ${String(value)}`);
  }
  return date;
}

function toIso(value: Date | string): string {
  return toDate(value).toISOString();
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

function sha256HexSync(bytes: Uint8Array): string {
  // FNV is not used here; this compact SHA-256 implementation keeps the
  // profile package browser-native without pulling Node crypto into Spaces.
  const words = bytesToWords(bytes);
  const bitLength = bytes.length * 8;
  words[bitLength >> 5] =
    (words[bitLength >> 5] ?? 0) | (0x80 << (24 - (bitLength % 32)));
  words[(((bitLength + 64) >> 9) << 4) + 15] = bitLength;

  let a = 0x6a09e667;
  let b = 0xbb67ae85;
  let c = 0x3c6ef372;
  let d = 0xa54ff53a;
  let e = 0x510e527f;
  let f = 0x9b05688c;
  let g = 0x1f83d9ab;
  let h = 0x5be0cd19;
  const w = new Array<number>(64);

  for (let i = 0; i < words.length; i += 16) {
    const oldA = a;
    const oldB = b;
    const oldC = c;
    const oldD = d;
    const oldE = e;
    const oldF = f;
    const oldG = g;
    const oldH = h;
    for (let j = 0; j < 64; j += 1) {
      w[j] =
        j < 16
          ? (words[i + j] ?? 0)
          : add32(
              add32(
                add32(sigma1(w[j - 2] ?? 0), w[j - 7] ?? 0),
                sigma0(w[j - 15] ?? 0),
              ),
              w[j - 16] ?? 0,
            );
      const t1 = add32(
        add32(add32(add32(h, bigSigma1(e)), choice(e, f, g)), SHA256_K[j] ?? 0),
        w[j] ?? 0,
      );
      const t2 = add32(bigSigma0(a), majority(a, b, c));
      h = g;
      g = f;
      f = e;
      e = add32(d, t1);
      d = c;
      c = b;
      b = a;
      a = add32(t1, t2);
    }
    a = add32(a, oldA);
    b = add32(b, oldB);
    c = add32(c, oldC);
    d = add32(d, oldD);
    e = add32(e, oldE);
    f = add32(f, oldF);
    g = add32(g, oldG);
    h = add32(h, oldH);
  }

  return [a, b, c, d, e, f, g, h]
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("");
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function bytesToWords(bytes: Uint8Array): number[] {
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    words[i >> 2] = (words[i >> 2] ?? 0) | (bytes[i] << (24 - (i % 4) * 8));
  }
  return words;
}

function rotateRight(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift));
}

function add32(...values: number[]): number {
  return values.reduce((sum, value) => (sum + value) >>> 0, 0);
}

function choice(x: number, y: number, z: number): number {
  return (x & y) ^ (~x & z);
}

function majority(x: number, y: number, z: number): number {
  return (x & y) ^ (x & z) ^ (y & z);
}

function bigSigma0(x: number): number {
  return rotateRight(x, 2) ^ rotateRight(x, 13) ^ rotateRight(x, 22);
}

function bigSigma1(x: number): number {
  return rotateRight(x, 6) ^ rotateRight(x, 11) ^ rotateRight(x, 25);
}

function sigma0(x: number): number {
  return rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
}

function sigma1(x: number): number {
  return rotateRight(x, 17) ^ rotateRight(x, 19) ^ (x >>> 10);
}

async function importPemPrivateKey(privateKeyPem: string): Promise<CryptoKey> {
  return cryptoSubtle().importKey(
    "pkcs8",
    toArrayBuffer(pemToBytes(privateKeyPem)),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
}

async function importPemPublicKey(publicKeyPem: string): Promise<CryptoKey> {
  return cryptoSubtle().importKey(
    "spki",
    toArrayBuffer(pemToBytes(publicKeyPem)),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
}

function cryptoSubtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new DeploymentProfileError("WebCrypto subtle API is unavailable.");
  }
  return globalThis.crypto.subtle;
}

async function publicKeyFingerprint(publicKeyPem: string): Promise<string> {
  const digest = await cryptoSubtle().digest(
    "SHA-256",
    toArrayBuffer(pemToBytes(publicKeyPem)),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function pemToBytes(pem: string): Uint8Array {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s/g, "");
  return base64ToBytes(base64);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
