/**
 * Per-account Terraform state backend (R11 / KTD-1).
 *
 * Provisions-or-verifies a hardened S3 state bucket + DynamoDB lock table in
 * the TARGET account and produces `-backend-config` args for `terraform init`.
 * Terraform state routinely embeds secret values (db_password,
 * api_auth_secret), so the bucket is created versioned, SSE-encrypted,
 * public-access-blocked, and with a lifecycle rule expiring noncurrent
 * versions — rotated secrets don't live forever in old versions.
 *
 * The repo greenfield layout keeps its hardcoded backend (dev CI depends on
 * it); this module serves init-scaffolded flat layouts and harness stages.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export interface BackendTarget {
  bucket: string;
  lockTable: string;
  key: string;
  region: string;
}

export interface ExecResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type AwsExec = (args: string[]) => ExecResult;

const NONCURRENT_VERSION_RETENTION_DAYS = 90;

function defaultExec(args: string[]): ExecResult {
  const proc = spawnSync("aws", args, { encoding: "utf8" });
  return {
    status: proc.status ?? 1,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
}

/** Account-scoped resource names — one backend per AWS account. */
export function backendResourceNames(accountId: string): {
  bucket: string;
  lockTable: string;
} {
  return {
    bucket: `thinkwork-tfstate-${accountId}`,
    lockTable: `thinkwork-tflocks-${accountId}`,
  };
}

/** Stage-scoped state key inside the account bucket. */
export function backendKey(stage: string): string {
  return `thinkwork/${stage}/terraform.tfstate`;
}

export function backendTarget(
  accountId: string,
  region: string,
  stage: string,
): BackendTarget {
  const names = backendResourceNames(accountId);
  return {
    bucket: names.bucket,
    lockTable: names.lockTable,
    key: backendKey(stage),
    region,
  };
}

/** `-backend-config=` args for `terraform init`. */
export function backendConfigArgs(target: BackendTarget): string[] {
  return [
    `-backend-config=bucket=${target.bucket}`,
    `-backend-config=key=${target.key}`,
    `-backend-config=region=${target.region}`,
    `-backend-config=dynamodb_table=${target.lockTable}`,
    `-backend-config=encrypt=true`,
  ];
}

export interface EnsureStateBackendResult {
  target: BackendTarget;
  createdBucket: boolean;
  createdLockTable: boolean;
}

/**
 * Create-or-verify the account's state bucket and lock table. Idempotent:
 * existing resources are verified (and hardening re-asserted), never
 * recreated. Throws with the failing AWS CLI stderr on any hard error.
 */
export function ensureStateBackend(
  accountId: string,
  region: string,
  stage: string,
  exec: AwsExec = defaultExec,
): EnsureStateBackendResult {
  const target = backendTarget(accountId, region, stage);

  const head = exec(["s3api", "head-bucket", "--bucket", target.bucket]);
  let createdBucket = false;
  if (head.status !== 0) {
    const createArgs = [
      "s3api",
      "create-bucket",
      "--bucket",
      target.bucket,
      "--region",
      region,
    ];
    if (region !== "us-east-1") {
      createArgs.push(
        "--create-bucket-configuration",
        `LocationConstraint=${region}`,
      );
    }
    const created = exec(createArgs);
    if (created.status !== 0) {
      throw new Error(
        `Could not create state bucket ${target.bucket}: ${created.stderr.trim()}`,
      );
    }
    createdBucket = true;
  }

  // Hardening is asserted on every run — cheap, idempotent, and it upgrades
  // buckets created before a given control existed.
  const hardening: string[][] = [
    [
      "s3api",
      "put-bucket-versioning",
      "--bucket",
      target.bucket,
      "--versioning-configuration",
      "Status=Enabled",
    ],
    [
      "s3api",
      "put-bucket-encryption",
      "--bucket",
      target.bucket,
      "--server-side-encryption-configuration",
      '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}',
    ],
    [
      "s3api",
      "put-public-access-block",
      "--bucket",
      target.bucket,
      "--public-access-block-configuration",
      "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true",
    ],
    [
      "s3api",
      "put-bucket-lifecycle-configuration",
      "--bucket",
      target.bucket,
      "--lifecycle-configuration",
      JSON.stringify({
        Rules: [
          {
            ID: "expire-noncurrent-state-versions",
            Status: "Enabled",
            Filter: {},
            NoncurrentVersionExpiration: {
              NoncurrentDays: NONCURRENT_VERSION_RETENTION_DAYS,
            },
          },
        ],
      }),
    ],
  ];
  for (const args of hardening) {
    const res = exec(args);
    if (res.status !== 0) {
      throw new Error(
        `Could not apply ${args[1]} to ${target.bucket}: ${res.stderr.trim()}`,
      );
    }
  }

  const describe = exec([
    "dynamodb",
    "describe-table",
    "--table-name",
    target.lockTable,
    "--region",
    region,
  ]);
  let createdLockTable = false;
  if (describe.status !== 0) {
    const created = exec([
      "dynamodb",
      "create-table",
      "--table-name",
      target.lockTable,
      "--attribute-definitions",
      "AttributeName=LockID,AttributeType=S",
      "--key-schema",
      "AttributeName=LockID,KeyType=HASH",
      "--billing-mode",
      "PAY_PER_REQUEST",
      "--region",
      region,
    ]);
    if (created.status !== 0) {
      throw new Error(
        `Could not create lock table ${target.lockTable}: ${created.stderr.trim()}`,
      );
    }
    createdLockTable = true;
  }

  return { target, createdBucket, createdLockTable };
}

export interface RecordedBackend {
  type: string;
  bucket?: string;
  key?: string;
  region?: string;
  dynamodb_table?: string;
}

/**
 * Read the backend recorded by a prior `terraform init` in this directory.
 * Returns null when the directory has never been initialized.
 */
export function readRecordedBackend(cwd: string): RecordedBackend | null {
  const recordPath = path.join(cwd, ".terraform", "terraform.tfstate");
  if (!existsSync(recordPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(recordPath, "utf8")) as {
      backend?: { type?: string; config?: Record<string, unknown> };
    };
    if (!parsed.backend?.type) return null;
    const config = parsed.backend.config ?? {};
    return {
      type: parsed.backend.type,
      bucket: config.bucket as string | undefined,
      key: config.key as string | undefined,
      region: config.region as string | undefined,
      dynamodb_table: config.dynamodb_table as string | undefined,
    };
  } catch {
    return null;
  }
}

/** Does the recorded backend already match the desired target? */
export function backendMatches(
  recorded: RecordedBackend | null,
  target: BackendTarget,
): boolean {
  return (
    recorded !== null &&
    recorded.type === "s3" &&
    recorded.bucket === target.bucket &&
    recorded.key === target.key &&
    recorded.dynamodb_table === target.lockTable
  );
}

/**
 * True when switching this directory to a remote backend would orphan real
 * local state: a local terraform.tfstate (or workspace states) with resources.
 * `terraform init -reconfigure` does NOT migrate state — callers must fail
 * loudly and point at `-migrate-state` instead of silently orphaning.
 */
export function detectLocalStateOrphanRisk(cwd: string): boolean {
  const candidates = [path.join(cwd, "terraform.tfstate")];
  const workspaceDir = path.join(cwd, "terraform.tfstate.d");
  if (existsSync(workspaceDir)) {
    try {
      for (const ws of readdirSync(workspaceDir)) {
        candidates.push(path.join(workspaceDir, ws, "terraform.tfstate"));
      }
    } catch {
      /* unreadable workspace dir — treat as no additional candidates */
    }
  }
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as {
        resources?: unknown[];
      };
      if ((parsed.resources?.length ?? 0) > 0) return true;
    } catch {
      // Unparseable state is still state — err on the side of protecting it.
      return true;
    }
  }
  return false;
}

export interface LockInfo {
  id?: string;
  who?: string;
  operation?: string;
  created?: string;
}

/**
 * Parse terraform's `Error acquiring the state lock` output into its fields.
 * Returns null when the text is not a lock error.
 */
export function parseLockError(text: string): LockInfo | null {
  if (!/Error acquiring the state lock/i.test(text)) return null;
  const field = (name: string): string | undefined => {
    const match = text.match(new RegExp(`${name}:\\s*(.+)`, "i"));
    return match?.[1]?.trim();
  };
  return {
    id: field("ID"),
    who: field("Who"),
    operation: field("Operation"),
    created: field("Created"),
  };
}
