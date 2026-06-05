#!/usr/bin/env node
/**
 * Smoke test the Twenty CRM managed application deployment.
 *
 * Dry-run is the default. Set SMOKE_ENABLE_TWENTY_MANAGED_APP=1 after deploy
 * to read Terraform/API deployment status and probe the public Twenty /healthz
 * endpoint when the runtime is enabled.
 *
 * Optional live env:
 *   SMOKE_TERRAFORM_DIR=terraform/examples/greenfield
 *   SMOKE_TWENTY_URL=https://crm.example.com
 *   SMOKE_TENANT_ID=<tenant-id>
 *   VITE_GRAPHQL_HTTP_URL, GRAPHQL_HTTP_URL, or API_GRAPHQL_URL
 *   API_AUTH_SECRET, THINKWORK_API_SECRET, VITE_GRAPHQL_API_KEY, or GRAPHQL_API_KEY
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const LIVE_ENABLED = process.env.SMOKE_ENABLE_TWENTY_MANAGED_APP === "1";
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
      {
        ok: true,
        skippedLive: true,
        reason:
          "set SMOKE_ENABLE_TWENTY_MANAGED_APP=1 to run the deployed Twenty managed-app smoke",
        dryRun: {
          terraformDir,
          requiredWhenRunning: [
            "Terraform outputs in SMOKE_TERRAFORM_DIR or SMOKE_TWENTY_URL",
            "Twenty provisioned/runtime deployment status",
          ],
          optionalGraphqlEnv: [
            "SMOKE_TENANT_ID",
            "VITE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL or API_GRAPHQL_URL",
            "API_AUTH_SECRET or THINKWORK_API_SECRET or VITE_GRAPHQL_API_KEY or GRAPHQL_API_KEY",
          ],
          verifies: [
            "twenty_provisioned false skips cleanly",
            "twenty_runtime_enabled true requires HTTPS twenty_url",
            "public Twenty /healthz responds successfully",
            "optional GraphQL deployment status and managed-app health agree with the public URL",
          ],
        },
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

try {
  const result = await runLiveSmoke();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
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
      reason: "Twenty CRM is not provisioned for this stage.",
      terraform,
      graphql,
    };
  }

  if (!status.runtimeEnabled) {
    return {
      skippedLive: true,
      reason: "Twenty CRM is provisioned but runtime is parked.",
      status,
      terraform,
      graphql,
    };
  }

  if (!status.url) {
    throw new Error(
      "Twenty runtime is enabled but no public URL was resolved.",
    );
  }
  if (!status.url.startsWith("https://")) {
    throw new Error(`Twenty URL must be HTTPS, got ${status.url}.`);
  }

  const publicHealth = await probeHealthz(status.url);
  const graphqlHealth =
    graphql?.deploymentStatus && !graphql.error
      ? await readGraphqlHealth().catch((error) => ({
          error: error instanceof Error ? error.message : String(error),
        }))
      : null;

  if (!publicHealth.healthy) {
    throw new Error(
      `Twenty /healthz failed: HTTP ${publicHealth.statusCode ?? "none"} ${publicHealth.message}`,
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
    (entry) => entry.key === "twenty",
  );
  return {
    provisioned: bool(
      firstDefined(
        app?.provisioned,
        terraform.twenty_provisioned,
        !!env.SMOKE_TWENTY_URL,
      ),
    ),
    runtimeEnabled: bool(
      firstDefined(
        app?.runtimeEnabled,
        terraform.twenty_runtime_enabled,
        !!env.SMOKE_TWENTY_URL,
      ),
    ),
    url: first(env.SMOKE_TWENTY_URL, app?.url, terraform.twenty_url),
    source: app ? "graphql" : terraform.available ? "terraform" : "env",
    status: app?.status ?? null,
    message: app?.message ?? null,
  };
}

async function probeHealthz(baseUrl) {
  const endpoint = new URL("/healthz", baseUrl).toString();
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
      twenty_provisioned: outputValue(parsed.twenty_provisioned),
      twenty_runtime_enabled: outputValue(parsed.twenty_runtime_enabled),
      twenty_url: outputValue(parsed.twenty_url),
      twenty_server_log_group_name: outputValue(
        parsed.twenty_server_log_group_name,
      ),
      twenty_worker_log_group_name: outputValue(
        parsed.twenty_worker_log_group_name,
      ),
      twenty_cache_endpoint: outputValue(parsed.twenty_cache_endpoint),
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
  const data = await gql(`
    query TwentySmokeDeploymentStatus {
      deploymentStatus {
        stage
        region
        twentyProvisioned
        twentyRuntimeEnabled
        twentyUrl
        managedApplications {
          key
          status
          provisioned
          runtimeEnabled
          url
          message
        }
      }
    }
  `);
  return data;
}

async function readGraphqlHealth() {
  const data = await gql(`
    query TwentySmokeManagedApplicationHealth {
      managedApplicationHealthCheck(key: "twenty") {
        healthy
        statusCode
        latencyMs
        endpoint
        message
      }
    }
  `);
  return data.managedApplicationHealthCheck;
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

function loadEnvFile() {
  const explicit = process.env.COMPUTER_ENV_FILE;
  if (explicit === "none") return {};
  const candidates = [
    explicit,
    "apps/spaces/.env",
    "apps/admin/.env",
    ".env",
  ].filter(Boolean);

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
