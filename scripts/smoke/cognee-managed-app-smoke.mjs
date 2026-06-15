#!/usr/bin/env node
/**
 * Smoke test the Cognee managed application deployment.
 *
 * Dry-run is the default. Set SMOKE_ENABLE_COGNEE_MANAGED_APP=1 after deploy
 * to read Terraform/API deployment status and prove Cognee health through the
 * ThinkWork GraphQL health check. Direct private ALB probing is opt-in because
 * Cognee is normally internal-only.
 *
 * Optional live env:
 *   SMOKE_TERRAFORM_DIR=terraform/examples/greenfield
 *   SMOKE_COGNEE_ENDPOINT=http://internal-alb
 *   SMOKE_ALLOW_PRIVATE_COGNEE_HTTP=1
 *   SMOKE_TENANT_ID=<tenant-id>
 *   VITE_GRAPHQL_HTTP_URL, GRAPHQL_HTTP_URL, or API_GRAPHQL_URL
 *   API_AUTH_SECRET, THINKWORK_API_SECRET, VITE_GRAPHQL_API_KEY, or GRAPHQL_API_KEY
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { attachSmokeEvidence } from "./deployment-evidence.mjs";

const LIVE_ENABLED = process.env.SMOKE_ENABLE_COGNEE_MANAGED_APP === "1";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15_000);

const env = {
  ...loadEnvFile(),
  ...process.env,
};

const terraformDir = env.SMOKE_TERRAFORM_DIR || "terraform/examples/greenfield";
const apiUrl = first(
  env.VITE_GRAPHQL_HTTP_URL,
  env.GRAPHQL_HTTP_URL,
  env.API_GRAPHQL_URL,
);
const apiSecret = first(env.API_AUTH_SECRET, env.THINKWORK_API_SECRET);
const apiKey = first(
  env.VITE_GRAPHQL_API_KEY,
  env.APPSYNC_API_KEY,
  env.GRAPHQL_API_KEY,
);
const tenantId = first(env.SMOKE_TENANT_ID, env.TENANT_ID);

if (!LIVE_ENABLED) {
  console.log(
    JSON.stringify(
      await attachSmokeEvidence(
        "cognee-managed-app",
        {
          ok: true,
          skippedLive: true,
          reason:
            "set SMOKE_ENABLE_COGNEE_MANAGED_APP=1 to run the deployed Cognee managed-app smoke",
          dryRun: {
            terraformDir,
            requiredWhenRunning: [
              "Terraform outputs in SMOKE_TERRAFORM_DIR or SMOKE_COGNEE_ENDPOINT",
              "Cognee enabled deployment status",
              "GraphQL health check credentials or SMOKE_ALLOW_PRIVATE_COGNEE_HTTP=1",
            ],
            optionalGraphqlEnv: [
              "SMOKE_TENANT_ID",
              "VITE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL or API_GRAPHQL_URL",
              "API_AUTH_SECRET or THINKWORK_API_SECRET or VITE_GRAPHQL_API_KEY or GRAPHQL_API_KEY",
            ],
            verifies: [
              "cognee_enabled false skips cleanly",
              "enabled Cognee resolves endpoint and log/status outputs",
              "Terraform and GraphQL cluster identity normalize to brain-cluster",
              "GraphQL knowledgeGraphHealthCheck reports healthy",
              "optional direct /health probe succeeds when explicitly enabled",
            ],
          },
        },
        env,
      ),
      null,
      2,
    ),
  );
  process.exit(0);
}

try {
  const result = await runLiveSmoke();
  console.log(
    JSON.stringify(
      await attachSmokeEvidence(
        "cognee-managed-app",
        { ok: true, ...result },
        env,
      ),
      null,
      2,
    ),
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

async function runLiveSmoke() {
  const terraform = readTerraformOutputs(terraformDir);
  const graphql = await readGraphqlStatus().catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
  const status = resolveStatus({ terraform, graphql });

  if (!status.enabled) {
    return {
      skippedLive: true,
      reason: "Cognee is not enabled for this stage.",
      terraform,
      graphql,
    };
  }

  if (!status.endpoint) {
    throw new Error("Cognee is enabled but no endpoint was resolved.");
  }
  const clusterIdentity = assertClusterIdentity({ terraform, graphql, status });

  const graphqlHealth =
    apiUrl && (apiSecret || apiKey)
      ? await readGraphqlHealth().catch((error) => ({
          error: error instanceof Error ? error.message : String(error),
        }))
      : null;
  const directHealth =
    env.SMOKE_ALLOW_PRIVATE_COGNEE_HTTP === "1"
      ? await probeHealth(status.endpoint)
      : null;

  if (graphqlHealth && "healthy" in graphqlHealth && !graphqlHealth.healthy) {
    throw new Error(
      `GraphQL Cognee health reported unhealthy: ${graphqlHealth.message}`,
    );
  }
  if (graphqlHealth && "error" in graphqlHealth) {
    throw new Error(`GraphQL Cognee health failed: ${graphqlHealth.error}`);
  }
  if (directHealth && !directHealth.healthy) {
    throw new Error(
      `Cognee /health failed: HTTP ${directHealth.statusCode ?? "none"} ${directHealth.message}`,
    );
  }
  if (!graphqlHealth && !directHealth) {
    throw new Error(
      "Cognee is enabled; provide GraphQL smoke credentials or set SMOKE_ALLOW_PRIVATE_COGNEE_HTTP=1 for direct /health probing.",
    );
  }

  return {
    status,
    clusterIdentity,
    graphqlHealth,
    directHealth,
    terraform,
    graphql,
  };
}

function resolveStatus({ terraform, graphql }) {
  const app = graphql?.deploymentStatus?.managedApplications?.find(
    (entry) => entry.key === "cognee",
  );
  const terraformClusterName = clusterNameFromArnOrName(
    terraform.cognee_cluster_arn,
  );
  const deploymentClusterName = clusterNameFromArnOrName(
    graphql?.deploymentStatus?.cogneeClusterArn,
  );
  const managedAppClusterName = clusterNameFromArnOrName(app?.clusterArn);
  return {
    enabled: bool(
      firstDefined(
        app?.provisioned,
        terraform.cognee_enabled,
        !!env.SMOKE_COGNEE_ENDPOINT,
      ),
    ),
    endpoint: first(
      env.SMOKE_COGNEE_ENDPOINT,
      app?.url,
      graphql?.deploymentStatus?.cogneeEndpoint,
      terraform.cognee_endpoint,
    ),
    source: app ? "graphql" : terraform.available ? "terraform" : "env",
    status: app?.status ?? null,
    message: app?.message ?? null,
    serviceName: first(
      app?.serviceName,
      graphql?.deploymentStatus?.cogneeServiceName,
      terraform.cognee_service_name,
    ),
    terraformClusterName,
    deploymentClusterName,
    managedAppClusterName,
    healthCheckTargetCluster:
      deploymentClusterName || managedAppClusterName || terraformClusterName,
  };
}

function assertClusterIdentity({ terraform, graphql, status }) {
  if (!terraform.available) {
    throw new Error(
      `Cognee is enabled but Terraform output was not available: ${terraform.reason ?? "unknown reason"}`,
    );
  }
  if (!terraform.cognee_cluster_arn) {
    throw new Error(
      "Cognee is enabled but Terraform output cognee_cluster_arn is missing.",
    );
  }

  const app = graphql?.deploymentStatus?.managedApplications?.find(
    (entry) => entry.key === "cognee",
  );
  const entries = [
    ["terraform.cognee_cluster_arn", terraform.cognee_cluster_arn],
    [
      "deploymentStatus.cogneeClusterArn",
      graphql?.deploymentStatus?.cogneeClusterArn,
    ],
    ["managedApplications[cognee].clusterArn", app?.clusterArn],
  ].filter(([, value]) => Boolean(value));

  if (entries.length < 2) {
    throw new Error(
      "Cognee cluster identity needs Terraform output plus at least one GraphQL status source.",
    );
  }

  const names = entries.map(([label, value]) => [
    label,
    clusterNameFromArnOrName(value),
  ]);
  const [firstLabel, firstName] = names[0];
  if (!firstName) {
    throw new Error(`${firstLabel} did not include an ECS cluster name.`);
  }

  for (const [label, name] of names.slice(1)) {
    if (name !== firstName) {
      throw new Error(
        `Cognee cluster identity mismatch: ${firstLabel}=${firstName}, ${label}=${name}`,
      );
    }
  }

  if (!firstName.endsWith("-brain-cluster")) {
    const reason = first(env.SMOKE_COGNEE_CLUSTER_BREAK_GLASS_REASON);
    const owner = first(env.SMOKE_COGNEE_CLUSTER_BREAK_GLASS_OWNER);
    if (!reason || !owner) {
      throw new Error(
        `Cognee cluster ${firstName} is not Brain-named; set break-glass reason and owner only for temporary recovery.`,
      );
    }
  }

  return {
    expectedClusterName: firstName,
    serviceName: status.serviceName,
    terraformClusterArnPresent: Boolean(terraform.cognee_cluster_arn),
    deploymentStatusClusterArnPresent: Boolean(
      graphql?.deploymentStatus?.cogneeClusterArn,
    ),
    managedApplicationClusterArnPresent: Boolean(app?.clusterArn),
    healthCheckTargetCluster: status.healthCheckTargetCluster,
    breakGlass: firstName.endsWith("-brain-cluster")
      ? null
      : {
          owner: env.SMOKE_COGNEE_CLUSTER_BREAK_GLASS_OWNER,
          reason: env.SMOKE_COGNEE_CLUSTER_BREAK_GLASS_REASON,
        },
  };
}

async function probeHealth(baseUrl) {
  const endpoint = new URL("/health", baseUrl).toString();
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, { signal: controller.signal });
    const body = await response.text().catch(() => "");
    return {
      endpoint,
      healthy: response.ok,
      statusCode: response.status,
      latencyMs: Date.now() - started,
      message: body.slice(0, 300),
    };
  } finally {
    clearTimeout(timer);
  }
}

function readTerraformOutputs(dir) {
  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved)) {
    return { available: false, reason: `Terraform dir not found: ${dir}` };
  }

  try {
    const raw = execFileSync(
      "terraform",
      ["-chdir=" + resolved, "output", "-json"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const parsed = JSON.parse(raw);
    return {
      available: true,
      cognee_enabled: outputValue(parsed.cognee_enabled),
      cognee_endpoint: outputValue(parsed.cognee_endpoint),
      cognee_log_group_name: outputValue(parsed.cognee_log_group_name),
      cognee_cluster_arn: outputValue(parsed.cognee_cluster_arn),
      cognee_service_name: outputValue(parsed.cognee_service_name),
      cognee_storage_file_system_id: outputValue(
        parsed.cognee_storage_file_system_id,
      ),
    };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readGraphqlStatus() {
  if (!apiUrl || (!apiSecret && !apiKey)) return null;
  return gql(`
    query CogneeSmokeDeploymentStatus {
      deploymentStatus {
        stage
        region
        cogneeEnabled
        cogneeEndpoint
        cogneeClusterArn
        cogneeServiceName
        managedApplications {
          key
          status
          provisioned
          runtimeEnabled
          url
          clusterArn
          serviceName
          message
        }
      }
    }
  `);
}

async function readGraphqlHealth() {
  const data = await gql(`
    query CogneeSmokeManagedApplicationHealth {
      knowledgeGraphHealthCheck {
        healthy
        statusCode
        latencyMs
        endpoint
        message
      }
    }
  `);
  return data.knowledgeGraphHealthCheck;
}

async function gql(query) {
  const headers = { "content-type": "application/json" };
  if (tenantId) headers["x-tenant-id"] = tenantId;
  if (apiSecret) headers.authorization = `Bearer ${apiSecret}`;
  else headers["x-api-key"] = apiKey;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
  });
  if (!response.ok) {
    throw new Error(
      `GraphQL HTTP ${response.status}: ${await response.text()}`,
    );
  }
  const body = await response.json();
  if (body.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);
  }
  return body.data;
}

function outputValue(entry) {
  return entry && Object.prototype.hasOwnProperty.call(entry, "value")
    ? entry.value
    : undefined;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function bool(value) {
  return value === true || value === "true" || value === "1";
}

function clusterNameFromArnOrName(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  const slashIndex = trimmed.lastIndexOf("/");
  return slashIndex >= 0 ? trimmed.slice(slashIndex + 1) : trimmed;
}

function loadEnvFile() {
  const explicit = process.env.COMPUTER_ENV_FILE;
  if (explicit === "none") return {};
  const candidates = [explicit, "apps/web/.env", ".env"].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!fs.existsSync(resolved)) continue;
    return Object.fromEntries(
      fs
        .readFileSync(resolved, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const index = line.indexOf("=");
          const key = line.slice(0, index).trim();
          const value = line
            .slice(index + 1)
            .trim()
            .replace(/^['"]|['"]$/g, "");
          return [key, value];
        }),
    );
  }
  return {};
}

function first(...values) {
  return values.find(
    (value) => value !== undefined && value !== null && value !== "",
  );
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}
