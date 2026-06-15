#!/usr/bin/env node
/**
 * Smoke test the Plane managed application deployment.
 *
 * Dry-run is the default. Set SMOKE_ENABLE_PLANE_MANAGED_APP=1 after deploy to
 * read Terraform/API deployment status and probe the public Plane URL when the
 * runtime is enabled.
 *
 * Optional live env:
 *   SMOKE_TERRAFORM_DIR=terraform/examples/greenfield
 *   SMOKE_PLANE_URL=https://plane.example.com
 *   SMOKE_PLANE_HEALTH_PATH=/             # defaults to the ALB health path
 *   SMOKE_TENANT_ID=<tenant-id>
 *   VITE_GRAPHQL_HTTP_URL, GRAPHQL_HTTP_URL, or API_GRAPHQL_URL
 *   API_AUTH_SECRET, THINKWORK_API_SECRET, VITE_GRAPHQL_API_KEY, or GRAPHQL_API_KEY
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { attachSmokeEvidence } from "../../../scripts/smoke/deployment-evidence.mjs";

const LIVE_ENABLED = process.env.SMOKE_ENABLE_PLANE_MANAGED_APP === "1";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15_000);

const env = {
  ...loadEnvFile(),
  ...process.env,
};

const terraformDir = env.SMOKE_TERRAFORM_DIR || "terraform/examples/greenfield";
const healthPath = env.SMOKE_PLANE_HEALTH_PATH || "/";
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
        "plane-managed-app",
        {
          ok: true,
          skippedLive: true,
          reason:
            "set SMOKE_ENABLE_PLANE_MANAGED_APP=1 to run the deployed Plane managed-app smoke",
          dryRun: {
            terraformDir,
            healthPath,
            requiredWhenRunning: [
              "Terraform outputs in SMOKE_TERRAFORM_DIR or SMOKE_PLANE_URL",
              "Plane provisioned/runtime deployment status",
            ],
            optionalGraphqlEnv: [
              "SMOKE_TENANT_ID",
              "VITE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL or API_GRAPHQL_URL",
              "API_AUTH_SECRET or THINKWORK_API_SECRET or VITE_GRAPHQL_API_KEY or GRAPHQL_API_KEY",
            ],
            verifies: [
              "plane_provisioned false skips cleanly",
              "plane_runtime_enabled true requires HTTPS plane_url",
              "public Plane health path responds successfully",
              "optional GraphQL deployment status and managed-app health agree with the public URL",
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
        "plane-managed-app",
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

  if (!status.provisioned) {
    return {
      skippedLive: true,
      reason: "Plane is not provisioned for this stage.",
      terraform,
      graphql,
    };
  }

  if (!status.runtimeEnabled) {
    return {
      skippedLive: true,
      reason: "Plane is provisioned but runtime is parked.",
      status,
      terraform,
      graphql,
    };
  }

  if (!status.url) {
    throw new Error("Plane runtime is enabled but no public URL was resolved.");
  }
  if (!status.url.startsWith("https://")) {
    throw new Error(`Plane URL must be HTTPS, got ${status.url}.`);
  }

  const publicHealth = await probeHealth(status.url);
  const graphqlHealth =
    graphql?.deploymentStatus && !graphql.error
      ? await readGraphqlHealth().catch((error) => ({
          error: error instanceof Error ? error.message : String(error),
        }))
      : null;

  if (!publicHealth.healthy) {
    throw new Error(
      `Plane health probe failed: HTTP ${publicHealth.statusCode ?? "none"} ${publicHealth.message}`,
    );
  }
  if (graphqlHealth && "healthy" in graphqlHealth && !graphqlHealth.healthy) {
    throw new Error(
      `GraphQL managed health reported unhealthy: ${graphqlHealth.message}`,
    );
  }

  return {
    status,
    publicHealth,
    graphqlHealth,
    terraform,
    graphql,
  };
}

function resolveStatus({ terraform, graphql }) {
  const app = graphql?.deploymentStatus?.managedApplications?.find(
    (entry) => entry.key === "plane",
  );
  return {
    provisioned: bool(
      firstDefined(
        app?.provisioned,
        terraform.plane_provisioned,
        !!env.SMOKE_PLANE_URL,
      ),
    ),
    runtimeEnabled: bool(
      firstDefined(
        app?.runtimeEnabled,
        terraform.plane_runtime_enabled,
        !!env.SMOKE_PLANE_URL,
      ),
    ),
    url: first(env.SMOKE_PLANE_URL, app?.url, terraform.plane_url),
    source: app ? "graphql" : terraform.available ? "terraform" : "env",
    status: app?.status ?? null,
    message: app?.message ?? null,
  };
}

async function probeHealth(baseUrl) {
  const endpoint = new URL(healthPath, baseUrl).toString();
  const started = Date.now();
  const response = await fetchWithTimeout(endpoint, {
    headers: { accept: "text/html,application/json,*/*" },
  });
  const body = await response.text().catch(() => "");
  return {
    endpoint,
    healthy: response.ok,
    statusCode: response.status,
    latencyMs: Date.now() - started,
    message: body.slice(0, 300),
  };
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
      plane_provisioned: outputValue(parsed.plane_provisioned),
      plane_runtime_enabled: outputValue(parsed.plane_runtime_enabled),
      plane_url: outputValue(parsed.plane_url),
      plane_web_log_group_name: outputValue(parsed.plane_web_log_group_name),
      plane_api_log_group_name: outputValue(parsed.plane_api_log_group_name),
      plane_worker_log_group_name: outputValue(
        parsed.plane_worker_log_group_name,
      ),
      plane_cache_endpoint: outputValue(parsed.plane_cache_endpoint),
      plane_rabbitmq_broker_arn: outputValue(parsed.plane_rabbitmq_broker_arn),
      plane_storage_bucket_name: outputValue(parsed.plane_storage_bucket_name),
    };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readGraphqlStatus() {
  if (!apiUrl || !tenantId || (!apiSecret && !apiKey)) {
    return {
      skipped: true,
      reason:
        "set API URL, tenant id, and API_AUTH_SECRET/THINKWORK_API_SECRET or GraphQL API key to compare GraphQL deployment status",
    };
  }
  const data = await gql(
    `query PlaneManagedAppSmoke {
       deploymentStatus {
         managedApplications { key provisioned runtimeEnabled url status message }
       }
     }`,
    {},
  );
  return { deploymentStatus: data.deploymentStatus };
}

async function readGraphqlHealth() {
  const data = await gql(
    `query PlaneManagedAppHealth($key: String!) {
       managedApplicationHealth(key: $key) { key healthy statusCode message url }
     }`,
    { key: "plane" },
  );
  return data.managedApplicationHealth;
}

async function gql(query, variables) {
  const response = await fetchWithTimeout(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiSecret
        ? { authorization: `Bearer ${apiSecret}` }
        : { "x-api-key": apiKey }),
      ...(tenantId ? { "x-tenant-id": tenantId } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GraphQL HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  const body = JSON.parse(text);
  if (body.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);
  }
  return body.data;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function outputValue(output) {
  return output && typeof output === "object" && "value" in output
    ? output.value
    : undefined;
}

function bool(value) {
  return value === true || value === "true";
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
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
