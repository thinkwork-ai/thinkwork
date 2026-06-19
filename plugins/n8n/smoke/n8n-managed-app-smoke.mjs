#!/usr/bin/env node
/**
 * Smoke test the n8n managed application deployment.
 *
 * Dry-run is the default. Set SMOKE_ENABLE_N8N_MANAGED_APP=1 after installing
 * and deploying the n8n plugin through ThinkWork to read deployment status,
 * inspect generated evidence, and probe the public n8n health path.
 *
 * Optional live env:
 *   SMOKE_TERRAFORM_DIR=terraform/examples/greenfield
 *   SMOKE_N8N_URL=https://n8n.example.com
 *   SMOKE_N8N_HEALTH_PATH=/healthz
 *   SMOKE_TENANT_ID=<tenant-id>
 *   VITE_GRAPHQL_HTTP_URL, GRAPHQL_HTTP_URL, or API_GRAPHQL_URL
 *   API_AUTH_SECRET, THINKWORK_API_SECRET, VITE_GRAPHQL_API_KEY, or GRAPHQL_API_KEY
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { attachSmokeEvidence } from "../../../scripts/smoke/deployment-evidence.mjs";

const LIVE_ENABLED = process.env.SMOKE_ENABLE_N8N_MANAGED_APP === "1";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15_000);

const env = {
  ...loadEnvFile(),
  ...process.env,
};

const terraformDir = env.SMOKE_TERRAFORM_DIR || "terraform/examples/greenfield";
const healthPath = env.SMOKE_N8N_HEALTH_PATH || "/healthz";
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
        "n8n-managed-app",
        {
          ok: true,
          skippedLive: true,
          reason:
            "set SMOKE_ENABLE_N8N_MANAGED_APP=1 to run the deployed n8n managed-app smoke",
          dryRun: {
            terraformDir,
            healthPath,
            requiredWhenRunning: [
              "n8n plugin installed and deployed through ThinkWork Settings -> Plugins",
              "Terraform outputs in SMOKE_TERRAFORM_DIR or SMOKE_N8N_URL",
              "n8n provisioned/runtime deployment status",
            ],
            optionalGraphqlEnv: [
              "SMOKE_TENANT_ID",
              "VITE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL or API_GRAPHQL_URL",
              "API_AUTH_SECRET or THINKWORK_API_SECRET or VITE_GRAPHQL_API_KEY or GRAPHQL_API_KEY",
            ],
            verifies: [
              "n8n_provisioned false skips cleanly",
              "n8n_runtime_enabled true requires HTTPS n8n_url",
              "public n8n health path responds successfully",
              "main and worker service evidence is present",
              "database, queue, storage, image digest, and service credential evidence is present",
              "package configuration digest is recorded when custom packages are configured",
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
        "n8n-managed-app",
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
      reason: "n8n is not provisioned for this stage.",
      terraform,
      graphql,
    };
  }

  if (!status.runtimeEnabled) {
    return {
      skippedLive: true,
      reason: "n8n is provisioned but runtime is parked.",
      status,
      terraform,
      graphql,
    };
  }

  if (!status.url) {
    throw new Error("n8n runtime is enabled but no public URL was resolved.");
  }
  if (!status.url.startsWith("https://")) {
    throw new Error(`n8n URL must be HTTPS, got ${status.url}.`);
  }

  validateRuntimeEvidence(status.evidence, status.source);
  const publicHealth = await probeHealth(status.url);

  if (!publicHealth.healthy) {
    throw new Error(
      `n8n health probe failed: HTTP ${publicHealth.statusCode ?? "none"} ${publicHealth.message}`,
    );
  }

  return {
    status,
    publicHealth,
    terraform,
    graphql,
  };
}

function resolveStatus({ terraform, graphql }) {
  const app = graphql?.deploymentStatus?.managedApplications?.find(
    (entry) => entry.key === "n8n",
  );
  const source = app ? "graphql" : terraform.available ? "terraform" : "env";
  const evidence = {
    mainServiceName: first(
      terraform.n8n_main_service_name,
      app?.serviceNames?.[0],
    ),
    workerServiceName: first(
      terraform.n8n_worker_service_name,
      app?.serviceNames?.[1],
    ),
    mainLogGroupName: terraform.n8n_main_log_group_name,
    workerLogGroupName: terraform.n8n_worker_log_group_name,
    databaseName: first(terraform.n8n_database_name, app?.databaseName),
    databaseSecretArn: terraform.n8n_database_secret_arn,
    valkeyEndpoint: terraform.n8n_valkey_endpoint,
    storageBucketName: first(
      terraform.n8n_storage_bucket_name,
      app?.storageBucketName,
    ),
    storagePrefix: terraform.n8n_storage_prefix,
    imageDigest: terraform.n8n_image_digest,
    packageConfigDigest: terraform.n8n_package_config_digest,
    serviceCredentialSecretArn: terraform.n8n_service_credential_secret_arn,
  };

  return {
    provisioned: bool(
      firstDefined(
        app?.provisioned,
        terraform.n8n_provisioned,
        !!env.SMOKE_N8N_URL,
      ),
    ),
    runtimeEnabled: bool(
      firstDefined(
        app?.runtimeEnabled,
        terraform.n8n_runtime_enabled,
        !!env.SMOKE_N8N_URL,
      ),
    ),
    url: first(env.SMOKE_N8N_URL, app?.url, terraform.n8n_url),
    source,
    status: app?.status ?? null,
    message: app?.message ?? null,
    evidence,
  };
}

function validateRuntimeEvidence(evidence, source) {
  if (env.SMOKE_N8N_ALLOW_URL_ONLY === "1") {
    return;
  }
  const required = [
    "mainServiceName",
    "workerServiceName",
    "databaseName",
    "valkeyEndpoint",
    "storageBucketName",
    "imageDigest",
    "serviceCredentialSecretArn",
  ];
  const missing = required.filter((key) => !evidence[key]);
  if (missing.length > 0) {
    throw new Error(
      `n8n live smoke requires managed-app evidence from Terraform or GraphQL; missing ${missing.join(", ")} from ${source}. Set SMOKE_N8N_ALLOW_URL_ONLY=1 only for endpoint-only diagnostics.`,
    );
  }
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
      n8n_provisioned: outputValue(parsed.n8n_provisioned),
      n8n_runtime_enabled: outputValue(parsed.n8n_runtime_enabled),
      n8n_url: outputValue(parsed.n8n_url),
      n8n_alb_arn: outputValue(parsed.n8n_alb_arn),
      n8n_target_group_arn: outputValue(parsed.n8n_target_group_arn),
      n8n_cluster_arn: outputValue(parsed.n8n_cluster_arn),
      n8n_main_service_name: outputValue(parsed.n8n_main_service_name),
      n8n_worker_service_name: outputValue(parsed.n8n_worker_service_name),
      n8n_main_log_group_name: outputValue(parsed.n8n_main_log_group_name),
      n8n_worker_log_group_name: outputValue(parsed.n8n_worker_log_group_name),
      n8n_database_name: outputValue(parsed.n8n_database_name),
      n8n_database_secret_arn: outputValue(parsed.n8n_database_secret_arn),
      n8n_valkey_endpoint: outputValue(parsed.n8n_valkey_endpoint),
      n8n_storage_bucket_name: outputValue(parsed.n8n_storage_bucket_name),
      n8n_storage_prefix: outputValue(parsed.n8n_storage_prefix),
      n8n_image_digest: outputValue(parsed.n8n_image_digest),
      n8n_package_config_digest: outputValue(parsed.n8n_package_config_digest),
      n8n_service_credential_secret_arn: outputValue(
        parsed.n8n_service_credential_secret_arn,
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
  if (!apiUrl || !tenantId || (!apiSecret && !apiKey)) {
    return {
      skipped: true,
      reason:
        "set API URL, tenant id, and API_AUTH_SECRET/THINKWORK_API_SECRET or GraphQL API key to compare GraphQL deployment status",
    };
  }
  const data = await gql(
    `query N8nManagedAppSmoke {
       deploymentStatus {
         managedApplications {
           key
           provisioned
           runtimeEnabled
           url
           status
           message
           serviceNames
           storageBucketName
           databaseName
         }
       }
     }`,
    {},
  );
  return { deploymentStatus: data.deploymentStatus };
}

async function gql(query, variables) {
  const headers = {
    "content-type": "application/json",
    "x-tenant-id": tenantId,
  };
  if (apiSecret) headers.authorization = `Bearer ${apiSecret}`;
  if (apiKey) headers["x-api-key"] = apiKey;

  const response = await fetchWithTimeout(apiUrl, {
    method: "POST",
    headers,
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

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}

function outputValue(output) {
  return output && typeof output === "object" && "value" in output
    ? output.value
    : undefined;
}

function bool(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return Boolean(value);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function first(...values) {
  return (
    values.find((value) => typeof value === "string" && value.trim())?.trim() ??
    null
  );
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
