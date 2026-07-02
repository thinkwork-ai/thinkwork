/**
 * Clean-slate destroy helpers (U7 / R5).
 *
 * `terraform destroy` alone does not return an account to a redeployable
 * state: versioned/non-empty S3 buckets block bucket deletion, Secrets
 * Manager entries linger in a 7-day recovery window and break redeploys with
 * AlreadyExists, and dependency-order errors leave partial teardown. These
 * helpers pre-empty buckets, force-delete stage secrets, and scan for
 * orphans so `destroy → deploy` of the same stage always works.
 */

import { spawnSync } from "node:child_process";
import type { ExecResult } from "./state-backend.js";

export type AwsExec = (args: string[]) => ExecResult;

function defaultExec(args: string[]): ExecResult {
  const proc = spawnSync("aws", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: proc.status ?? 1,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
  };
}

/** Buckets belonging to the stage (name prefix `thinkwork-<stage>-`). */
export function listStageBuckets(
  stage: string,
  exec: AwsExec = defaultExec,
): string[] {
  const res = exec([
    "s3api",
    "list-buckets",
    "--query",
    `Buckets[?starts_with(Name, 'thinkwork-${stage}-')].Name`,
    "--output",
    "json",
  ]);
  if (res.status !== 0) return [];
  try {
    return JSON.parse(res.stdout) as string[];
  } catch {
    return [];
  }
}

/**
 * Empty a bucket including all versions and delete markers so terraform's
 * bucket deletion succeeds. Iterates until the version listing is empty.
 */
export function emptyBucket(
  bucket: string,
  exec: AwsExec = defaultExec,
  maxRounds = 50,
): { emptied: boolean; rounds: number } {
  // Fast path for current objects.
  exec(["s3", "rm", `s3://${bucket}`, "--recursive", "--only-show-errors"]);

  for (let round = 1; round <= maxRounds; round++) {
    const listing = exec([
      "s3api",
      "list-object-versions",
      "--bucket",
      bucket,
      "--max-items",
      "500",
      "--query",
      "{Objects: [Versions[].{Key:Key,VersionId:VersionId}, DeleteMarkers[].{Key:Key,VersionId:VersionId}][] | [0:500]}",
      "--output",
      "json",
    ]);
    if (listing.status !== 0) return { emptied: false, rounds: round };
    let objects: { Key: string; VersionId: string }[] = [];
    try {
      objects =
        (JSON.parse(listing.stdout) as { Objects?: typeof objects }).Objects ??
        [];
    } catch {
      return { emptied: false, rounds: round };
    }
    if (objects.length === 0) return { emptied: true, rounds: round };

    const del = exec([
      "s3api",
      "delete-objects",
      "--bucket",
      bucket,
      "--delete",
      JSON.stringify({ Objects: objects, Quiet: true }),
    ]);
    if (del.status !== 0) return { emptied: false, rounds: round };
  }
  return { emptied: false, rounds: maxRounds };
}

/**
 * Force-delete the stage's Secrets Manager entries (no recovery window) so an
 * immediate redeploy never hits AlreadyExists-with-scheduled-deletion.
 */
export function forceDeleteStageSecrets(
  stage: string,
  region: string,
  exec: AwsExec = defaultExec,
): string[] {
  const res = exec([
    "secretsmanager",
    "list-secrets",
    "--include-planned-deletion",
    "--region",
    region,
    "--query",
    `SecretList[?starts_with(Name, 'thinkwork-${stage}-')].ARN`,
    "--output",
    "json",
  ]);
  if (res.status !== 0) return [];
  let arns: string[] = [];
  try {
    arns = JSON.parse(res.stdout) as string[];
  } catch {
    return [];
  }
  const deleted: string[] = [];
  for (const arn of arns) {
    const del = exec([
      "secretsmanager",
      "delete-secret",
      "--secret-id",
      arn,
      "--force-delete-without-recovery",
      "--region",
      region,
    ]);
    if (del.status === 0) deleted.push(arn);
  }
  return deleted;
}

/**
 * Aurora clusters deploy with deletion_protection = true (the right default
 * for customer stages) — but that makes terraform's DeleteDBCluster fail with
 * InvalidParameterCombination at the very end of an otherwise-clean teardown
 * (harness cycle-5 ledger entry). An explicit `thinkwork destroy` IS the
 * deliberate act the protection exists to require, so drop the flag first.
 *
 * Returns true when the cluster is unprotected (or doesn't exist) afterwards.
 */
export function disableClusterDeletionProtection(
  stage: string,
  region: string,
  exec: AwsExec = defaultExec,
): { found: boolean; disabled: boolean } {
  const clusterId = `thinkwork-${stage}-db`;
  const describe = exec([
    "rds",
    "describe-db-clusters",
    "--db-cluster-identifier",
    clusterId,
    "--region",
    region,
    "--query",
    "DBClusters[0].DeletionProtection",
    "--output",
    "text",
  ]);
  if (describe.status !== 0) return { found: false, disabled: true };
  if (describe.stdout.trim() !== "True") return { found: true, disabled: true };
  const modify = exec([
    "rds",
    "modify-db-cluster",
    "--db-cluster-identifier",
    clusterId,
    "--no-deletion-protection",
    "--apply-immediately",
    "--region",
    region,
  ]);
  return { found: true, disabled: modify.status === 0 };
}

export interface OrphanReport {
  lambdas: string[];
  buckets: string[];
  dbClusters: string[];
  secrets: string[];
  logGroups: string[];
}

/** Post-destroy scan for anything still carrying the stage's name prefix. */
export function scanOrphans(
  stage: string,
  region: string,
  exec: AwsExec = defaultExec,
): OrphanReport {
  const jsonList = (args: string[]): string[] => {
    const res = exec(args);
    if (res.status !== 0) return [];
    try {
      return (JSON.parse(res.stdout) as (string | null)[]).filter(
        (v): v is string => Boolean(v),
      );
    } catch {
      return [];
    }
  };
  const prefix = `thinkwork-${stage}-`;
  return {
    lambdas: jsonList([
      "lambda",
      "list-functions",
      "--region",
      region,
      "--query",
      `Functions[?starts_with(FunctionName, '${prefix}')].FunctionName`,
      "--output",
      "json",
    ]),
    buckets: listStageBuckets(stage, exec),
    dbClusters: jsonList([
      "rds",
      "describe-db-clusters",
      "--region",
      region,
      "--query",
      `DBClusters[?starts_with(DBClusterIdentifier, '${prefix}') || starts_with(DBClusterIdentifier, 'thinkwork-${stage}')].DBClusterIdentifier`,
      "--output",
      "json",
    ]),
    secrets: jsonList([
      "secretsmanager",
      "list-secrets",
      "--region",
      region,
      "--query",
      `SecretList[?starts_with(Name, '${prefix}')].Name`,
      "--output",
      "json",
    ]),
    logGroups: jsonList([
      "logs",
      "describe-log-groups",
      "--region",
      region,
      "--log-group-name-prefix",
      `/aws/lambda/${prefix}`,
      "--query",
      "logGroups[].logGroupName",
      "--output",
      "json",
    ]),
  };
}

export function orphanCount(report: OrphanReport): number {
  return (
    report.lambdas.length +
    report.buckets.length +
    report.dbClusters.length +
    report.secrets.length +
    report.logGroups.length
  );
}
