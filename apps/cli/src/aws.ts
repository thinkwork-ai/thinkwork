/**
 * AWS identity resolution — displays the target account + region before
 * mutating operations so the operator can verify they're hitting the right
 * account. Uses STS GetCallerIdentity.
 */

import { execSync } from "node:child_process";

export interface AwsIdentity {
  account: string;
  region: string;
  arn: string;
}

/**
 * Resolves the current AWS identity by calling `aws sts get-caller-identity`.
 * Falls back gracefully if the AWS CLI is not available.
 */
export function getAwsIdentity(): AwsIdentity | null {
  try {
    const raw = execSync("aws sts get-caller-identity --output json", {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const parsed = JSON.parse(raw) as { Account: string; Arn: string };

    // Region from env or AWS config
    const region =
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION ||
      execSync("aws configure get region", {
        encoding: "utf-8",
        timeout: 5_000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim() ||
      "unknown";

    return {
      account: parsed.Account,
      region,
      arn: parsed.Arn,
    };
  } catch {
    return null;
  }
}

/**
 * Formats the AWS identity for display before a mutating operation.
 */
export function formatIdentity(identity: AwsIdentity): string {
  return `AWS Account: ${identity.account}  Region: ${identity.region}  (${identity.arn})`;
}
