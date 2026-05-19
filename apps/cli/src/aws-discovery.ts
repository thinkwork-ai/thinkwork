/**
 * AWS-side Thinkwork deployment discovery.
 *
 * Lightweight queries that return just enough info to populate the stage
 * picker and resolve a deployed stage → API URL + auth secret. The richer
 * scan used by `thinkwork status` lives inline in `commands/status.ts` and
 * covers AgentCore, Hindsight, CloudFront, etc.
 */

import { execSync } from "node:child_process";

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

/** Return the list of deployed Thinkwork stages in a region, sorted. */
export function listDeployedStages(region: string): string[] {
  const raw = runAws(
    `lambda list-functions --region ${region} --query "Functions[?starts_with(FunctionName, 'thinkwork-')].FunctionName" --output json`,
  );
  if (!raw) return [];
  try {
    const functions = JSON.parse(raw) as string[];
    const stages = new Set<string>();
    for (const fn of functions) {
      const m = fn.match(/^thinkwork-(.+?)-api-graphql-http$/);
      if (m) stages.add(m[1]);
    }
    return [...stages].sort();
  } catch {
    return [];
  }
}

/** API Gateway HTTP endpoint for a stage, or null if not deployed. */
export function getApiEndpoint(stage: string, region: string): string | null {
  const raw = runAws(
    `apigatewayv2 get-apis --region ${region} --query "Items[?Name=='thinkwork-${stage}-api'].ApiEndpoint|[0]" --output text`,
  );
  return raw && raw !== "None" ? raw : null;
}

export interface DiscoveredThinkworkStageUrls {
  apiEndpoint?: string;
  adminUrl?: string;
  appSyncUrl?: string;
  docsUrl?: string;
}

export function discoverThinkworkStageUrls(
  stage: string,
  region: string,
): DiscoveredThinkworkStageUrls {
  const urls: DiscoveredThinkworkStageUrls = {};
  const apiEndpoint = getApiEndpoint(stage, region);
  if (apiEndpoint) urls.apiEndpoint = apiEndpoint;

  const appSyncUrl = runAws(
    `appsync list-graphql-apis --region ${region} --query "graphqlApis[?name=='thinkwork-${stage}-subscriptions'].uris.GRAPHQL|[0]" --output text`,
  );
  if (appSyncUrl && appSyncUrl !== "None") urls.appSyncUrl = appSyncUrl;

  const distributions = runAws(
    `cloudfront list-distributions --query "DistributionList.Items[?contains(Origins.Items[0].DomainName, 'thinkwork-${stage}-')].{Origin:Origins.Items[0].DomainName,Domain:DomainName}" --output json`,
  );
  if (distributions) {
    const parsed = JSON.parse(distributions) as Array<{
      Origin: string;
      Domain: string;
    }>;
    for (const distribution of parsed) {
      if (distribution.Origin.includes(`thinkwork-${stage}-admin`)) {
        urls.adminUrl = `https://${distribution.Domain}`;
      }
      if (distribution.Origin.includes(`thinkwork-${stage}-docs`)) {
        urls.docsUrl = `https://${distribution.Domain}`;
      }
    }
  }

  return urls;
}

/**
 * Pull the API_AUTH_SECRET from a deployed Lambda's env. Used as a fallback
 * when the user doesn't have a local terraform.tfvars. The `tenants` Lambda
 * is a safe read target — it exists in every stack and carries the env var.
 */
export function getApiAuthSecretFromLambda(
  stage: string,
  region: string,
): string | null {
  const raw = runAws(
    `lambda get-function-configuration --function-name thinkwork-${stage}-api-tenants --region ${region} --query "Environment.Variables.API_AUTH_SECRET" --output text`,
  );
  return raw && raw !== "None" ? raw : null;
}
