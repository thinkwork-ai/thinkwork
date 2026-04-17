/**
 * Cognito configuration lookup for a deployed stage.
 *
 * For `thinkwork login --stage <s>` we need:
 *   - The user pool ID
 *   - The admin app client ID (the one with OAuth enabled)
 *   - The hosted-UI domain (e.g. "thinkwork-dev")
 *   - The AWS region
 *
 * We try two sources in order:
 *   1. Terraform outputs (fast, authoritative for operators with a checkout).
 *   2. AWS CLI discovery via `aws cognito-idp` (works for any user with the
 *      right IAM, including npm-installed CLI users with no terraform checkout).
 *
 * Returns null if neither path yields a complete config — callers print a
 * clear remediation hint instead of crashing mid-login.
 */

import { execSync } from "node:child_process";
import { resolveTerraformDir } from "./environments.js";
import { resolveTierDir } from "./terraform.js";

export interface CognitoConfig {
  userPoolId: string;
  clientId: string;
  /** Short domain prefix, e.g. "thinkwork-dev". */
  domain: string;
  /** Full hosted-UI base, e.g. "https://thinkwork-dev.auth.us-east-1.amazoncognito.com". */
  domainUrl: string;
  region: string;
}

function runAws(cmd: string): string | null {
  try {
    return execSync(`aws ${cmd}`, {
      encoding: "utf-8",
      timeout: 15_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function tryTerraformOutput(stage: string): Partial<CognitoConfig> | null {
  const tfRoot = resolveTerraformDir(stage);
  if (!tfRoot) return null;

  let cwd: string;
  try {
    cwd = resolveTierDir(tfRoot, stage, "foundation");
  } catch {
    return null;
  }

  // Skip `terraform init` / workspace selection here — this path is a
  // best-effort shortcut for operators who already have state hydrated. If the
  // reads fail we fall back to AWS CLI discovery which doesn't need any of it.
  const read = (key: string): string | null => {
    try {
      return execSync(`terraform output -raw ${key}`, {
        cwd,
        encoding: "utf-8",
        timeout: 15_000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch {
      return null;
    }
  };

  const userPoolId = read("user_pool_id") ?? undefined;
  const clientId = read("admin_client_id") ?? undefined;
  const domain = read("auth_domain") ?? undefined;
  return { userPoolId, clientId, domain };
}

function tryAwsDiscovery(
  stage: string,
  region: string,
): Partial<CognitoConfig> {
  // 1. Find the user pool by name convention.
  const listRaw = runAws(
    `cognito-idp list-user-pools --max-results 60 --region ${region} --output json`,
  );
  if (!listRaw) return {};

  const poolList = JSON.parse(listRaw) as {
    UserPools: Array<{ Id: string; Name: string }>;
  };
  const pool = poolList.UserPools.find((p) =>
    // `foundation/cognito/main.tf`:93 pattern
    p.Name === `thinkwork-${stage}-user-pool` ||
    p.Name === `thinkwork-${stage}-users`,
  );
  if (!pool) return {};

  // 2. Find the admin client inside that pool.
  const clientsRaw = runAws(
    `cognito-idp list-user-pool-clients --user-pool-id ${pool.Id} --region ${region} --output json`,
  );
  let clientId: string | undefined;
  if (clientsRaw) {
    const clients = JSON.parse(clientsRaw) as {
      UserPoolClients: Array<{ ClientId: string; ClientName: string }>;
    };
    const admin = clients.UserPoolClients.find(
      (c) => c.ClientName === "ThinkworkAdmin",
    );
    clientId = admin?.ClientId;
  }

  // 3. Domain follows a predictable "thinkwork-<stage>" pattern.
  const domain = `thinkwork-${stage}`;

  return { userPoolId: pool.Id, clientId, domain };
}

/**
 * Resolve Cognito config, merging terraform + AWS-CLI discovery.
 * Returns null when any critical field is missing.
 */
export function discoverCognitoConfig(
  stage: string,
  region: string,
): CognitoConfig | null {
  const fromTf = tryTerraformOutput(stage) ?? {};
  const fromAws = tryAwsDiscovery(stage, region);

  const userPoolId = fromTf.userPoolId ?? fromAws.userPoolId;
  const clientId = fromTf.clientId ?? fromAws.clientId;
  const domain = fromTf.domain ?? fromAws.domain;

  if (!userPoolId || !clientId || !domain) return null;

  return {
    userPoolId,
    clientId,
    domain,
    domainUrl: `https://${domain}.auth.${region}.amazoncognito.com`,
    region,
  };
}
