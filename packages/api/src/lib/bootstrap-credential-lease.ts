import {
  CreateSecretCommand,
  DeleteSecretCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { createHash } from "node:crypto";

export type BootstrapCredentialLeaseStatus =
  | "pending"
  | "validated"
  | "in_use"
  | "transferred"
  | "revoked"
  | "expired"
  | "failed_cleanup";

export type BootstrapCredentialLeaseType =
  | "temporary_credentials"
  | "assumable_role";

export type BootstrapCredentialLeaseBody = {
  kind?: unknown;
  accessKeyId?: unknown;
  secretAccessKey?: unknown;
  sessionToken?: unknown;
  expiresAt?: unknown;
  roleArn?: unknown;
  externalId?: unknown;
};

export type ValidatedBootstrapCredentialLease = {
  leaseType: BootstrapCredentialLeaseType;
  secretPayload: Record<string, string>;
  secretFingerprint: string;
  externalIdHash: string | null;
  roleArn: string | null;
  expiresAt: Date;
  auditMetadata: Record<string, unknown>;
};

type SecretsManagerLike = Pick<SecretsManagerClient, "send">;

const MAX_TEMPORARY_CREDENTIAL_TTL_MS = 12 * 60 * 60 * 1000;
const MIN_LEASE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_ROLE_LEASE_TTL_MS = 60 * 60 * 1000;
const AWS_ACCESS_KEY_ID_RE = /^A[0-9A-Z]{15,23}$/;
const ROLE_ARN_RE =
  /^arn:aws(?:-[a-z]+)?:iam::\d{12}:role\/[\w+=,.@/-]{1,512}$/;

let smClient: SecretsManagerClient | null = null;

function getClient(): SecretsManagerClient {
  if (!smClient) {
    smClient = new SecretsManagerClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
  }
  return smClient;
}

export function validateBootstrapCredentialLease(
  body: BootstrapCredentialLeaseBody,
  now = new Date(),
): ValidatedBootstrapCredentialLease {
  const kind = stringValue(body.kind);
  if (kind === "assumable_role") {
    return validateAssumableRoleLease(body, now);
  }
  if (kind === "temporary_credentials" || !kind) {
    return validateTemporaryCredentialLease(body, now);
  }
  throw new Error("Unsupported bootstrap credential lease kind");
}

export function bootstrapCredentialLeaseSecretName(input: {
  stage?: string | null;
  sessionId: string;
  leaseId: string;
}): string {
  const prefix =
    process.env.THINKWORK_BOOTSTRAP_LEASE_SECRET_PREFIX ||
    `thinkwork/${input.stage || process.env.STAGE || "dev"}/deployment-bootstrap-leases`;
  return `${prefix.replace(/\/+$/, "")}/${input.sessionId}/${input.leaseId}`;
}

export async function putBootstrapCredentialLeaseSecret(input: {
  secretName: string;
  payload: Record<string, string>;
  sessionId: string;
  leaseId: string;
  leaseType: BootstrapCredentialLeaseType;
  expiresAt: Date;
  client?: SecretsManagerLike;
}): Promise<string> {
  const created = await (input.client ?? getClient()).send(
    new CreateSecretCommand({
      Name: input.secretName,
      Description:
        "Temporary ThinkWork bootstrap credential lease. Delete after customer authority transfer.",
      SecretString: JSON.stringify(input.payload),
      KmsKeyId: process.env.THINKWORK_BOOTSTRAP_LEASE_KMS_KEY_ID || undefined,
      Tags: [
        { Key: "thinkwork:purpose", Value: "bootstrap-credential-lease" },
        { Key: "thinkwork:session-id", Value: input.sessionId },
        { Key: "thinkwork:lease-id", Value: input.leaseId },
        { Key: "thinkwork:lease-type", Value: input.leaseType },
        { Key: "thinkwork:expires-at", Value: input.expiresAt.toISOString() },
      ],
    }),
  );
  return created.ARN || input.secretName;
}

export async function deleteBootstrapCredentialLeaseSecret(input: {
  secretRef: string;
  client?: SecretsManagerLike;
}): Promise<void> {
  await (input.client ?? getClient()).send(
    new DeleteSecretCommand({
      SecretId: input.secretRef,
      ForceDeleteWithoutRecovery: true,
    }),
  );
}

export function bootstrapCredentialLeasePublicMetadata(
  lease: ValidatedBootstrapCredentialLease,
): Record<string, unknown> {
  return {
    leaseType: lease.leaseType,
    secretFingerprint: lease.secretFingerprint,
    expiresAt: lease.expiresAt.toISOString(),
    roleArn: lease.roleArn,
    externalIdHash: lease.externalIdHash,
    credentialMaterialPersisted: false,
  };
}

export function __resetBootstrapCredentialLeaseStoreForTest(): void {
  smClient = null;
}

function validateTemporaryCredentialLease(
  body: BootstrapCredentialLeaseBody,
  now: Date,
): ValidatedBootstrapCredentialLease {
  const accessKeyId = stringValue(body.accessKeyId);
  const secretAccessKey = stringValue(body.secretAccessKey);
  const sessionToken = stringValue(body.sessionToken);
  const expiresAt = dateValue(body.expiresAt);

  if (!AWS_ACCESS_KEY_ID_RE.test(accessKeyId)) {
    throw new Error("Temporary AWS access key ID is required");
  }
  if (secretAccessKey.length < 20) {
    throw new Error("Temporary AWS secret access key is required");
  }
  if (sessionToken.length < 16) {
    throw new Error("Temporary AWS session token is required");
  }
  if (!expiresAt) {
    throw new Error("Temporary AWS credentials require an expiration time");
  }
  assertUsableExpiration(expiresAt, now, MAX_TEMPORARY_CREDENTIAL_TTL_MS);

  const secretPayload = {
    kind: "temporary_credentials",
    accessKeyId,
    secretAccessKey,
    sessionToken,
    expiresAt: expiresAt.toISOString(),
  };
  return {
    leaseType: "temporary_credentials",
    secretPayload,
    secretFingerprint: fingerprint([
      "temporary_credentials",
      accessKeyId,
      expiresAt.toISOString(),
      sessionToken.slice(-12),
    ]),
    externalIdHash: null,
    roleArn: null,
    expiresAt,
    auditMetadata: {
      credentialKind: "sts-temporary-credentials",
      accessKeyIdHash: fingerprint(["access-key-id", accessKeyId]),
      sessionTokenHash: fingerprint(["session-token", sessionToken]),
      maxTtlHours: 12,
    },
  };
}

function validateAssumableRoleLease(
  body: BootstrapCredentialLeaseBody,
  now: Date,
): ValidatedBootstrapCredentialLease {
  const roleArn = stringValue(body.roleArn);
  const externalId = stringValue(body.externalId);
  const expiresAt =
    dateValue(body.expiresAt) ??
    new Date(now.getTime() + DEFAULT_ROLE_LEASE_TTL_MS);

  if (!ROLE_ARN_RE.test(roleArn)) {
    throw new Error("Assumable role ARN is required");
  }
  assertUsableExpiration(expiresAt, now, MAX_TEMPORARY_CREDENTIAL_TTL_MS);

  const externalIdHash = externalId
    ? fingerprint(["external-id", externalId])
    : null;
  return {
    leaseType: "assumable_role",
    secretPayload: {
      kind: "assumable_role",
      roleArn,
      ...(externalId ? { externalId } : {}),
      expiresAt: expiresAt.toISOString(),
    },
    secretFingerprint: fingerprint([
      "assumable_role",
      roleArn,
      externalIdHash ?? "no-external-id",
      expiresAt.toISOString(),
    ]),
    externalIdHash,
    roleArn,
    expiresAt,
    auditMetadata: {
      credentialKind: "assumable-role",
      externalIdPersisted: Boolean(externalId),
    },
  };
}

function assertUsableExpiration(expiresAt: Date, now: Date, maxTtlMs: number) {
  const ttlMs = expiresAt.getTime() - now.getTime();
  if (ttlMs < MIN_LEASE_TTL_MS) {
    throw new Error(
      "Bootstrap credential lease is expired or too close to expiry",
    );
  }
  if (ttlMs > maxTtlMs) {
    throw new Error("Bootstrap credential lease must expire within 12 hours");
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function dateValue(value: unknown): Date | null {
  const raw = stringValue(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function fingerprint(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}
