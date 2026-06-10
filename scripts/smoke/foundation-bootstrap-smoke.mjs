#!/usr/bin/env node
/**
 * Smoke test a GitHub-free foundation bootstrap.
 *
 * Dry-run is the default. Set SMOKE_ENABLE_FOUNDATION_BOOTSTRAP=1 after
 * bootstrap to read Terraform outputs, verify generated endpoints, and emit a
 * support evidence envelope. No production mutation is performed.
 *
 * Optional live env:
 *   SMOKE_TERRAFORM_DIR=terraform/examples/greenfield
 *   SMOKE_SPACES_URL=https://...
 *   SMOKE_GRAPHQL_URL=https://...
 *   SMOKE_COGNITO_DOMAIN=https://...
 *   SMOKE_DEPLOYMENT_PROFILE_JSON='{"schemaVersion":1,...}'
 *   VITE_GRAPHQL_API_KEY, GRAPHQL_API_KEY, API_AUTH_SECRET, or THINKWORK_API_SECRET
 *   SMOKE_EVIDENCE_FILE=/tmp/foundation-smoke.json
 *   SMOKE_EVIDENCE_S3_URI=s3://bucket/prefix
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { attachSmokeEvidence } from "./deployment-evidence.mjs";

const LIVE_ENABLED = process.env.SMOKE_ENABLE_FOUNDATION_BOOTSTRAP === "1";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15_000);

const env = {
  ...loadEnvFile(),
  ...process.env,
};

const terraformDir = env.SMOKE_TERRAFORM_DIR || "terraform/examples/greenfield";

const dryRun = {
  terraformDir,
  requiredWhenRunning: [
    "Terraform outputs in SMOKE_TERRAFORM_DIR or explicit SMOKE_* endpoint env",
    "Generated Spaces URL",
    "Generated GraphQL/AppSync URL",
    "Generated Cognito hosted UI domain",
    "Deployment control-plane outputs when GitHub-free deploys are enabled",
  ],
  optionalGraphqlEnv: [
    "VITE_GRAPHQL_API_KEY or GRAPHQL_API_KEY",
    "API_AUTH_SECRET or THINKWORK_API_SECRET",
  ],
  optionalEvidenceEnv: [
    "SMOKE_EVIDENCE_FILE",
    "SMOKE_EVIDENCE_S3_URI",
    "SMOKE_MANIFEST_SHA256",
    "SMOKE_STEP_FUNCTIONS_EXECUTION_ARN",
    "SMOKE_CODEBUILD_BUILD_ARN",
  ],
  verifies: [
    "Spaces URL is reachable",
    "GraphQL endpoint accepts a basic query when credentials are available",
    "Cognito domain is a valid HTTPS endpoint",
    "Deployment profile JSON includes all client-binding fields when provided",
    "Control-plane/evidence Terraform outputs are present when enabled",
  ],
};

if (!LIVE_ENABLED) {
  const result = await attachSmokeEvidence(
    "foundation-bootstrap",
    {
      ok: true,
      skippedLive: true,
      reason:
        "set SMOKE_ENABLE_FOUNDATION_BOOTSTRAP=1 to run the deployed foundation bootstrap smoke",
      dryRun,
    },
    env,
  );
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

try {
  const result = await runLiveSmoke();
  console.log(
    JSON.stringify(
      await attachSmokeEvidence(
        "foundation-bootstrap",
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
  const endpoints = resolveEndpoints(terraform);

  if (!endpoints.spacesUrl) throw new Error("Spaces URL was not resolved.");
  if (!endpoints.graphqlUrl)
    throw new Error("GraphQL/AppSync URL was not resolved.");
  if (!endpoints.cognitoDomain)
    throw new Error("Cognito domain was not resolved.");

  const spaces = await probeHttp(endpoints.spacesUrl);
  const graphql = await probeGraphql(endpoints.graphqlUrl);
  const cognito = validateCognitoDomain(endpoints.cognitoDomain);
  const deploymentProfile = validateDeploymentProfileJson();
  const controlPlane = validateControlPlane(terraform, endpoints);

  if (!spaces.ok) {
    throw new Error(
      `Spaces URL failed: HTTP ${spaces.statusCode ?? "none"} ${spaces.message}`,
    );
  }
  if (graphql && !graphql.skipped && !graphql.ok) {
    throw new Error(
      `GraphQL query failed: HTTP ${graphql.statusCode ?? "none"} ${graphql.message}`,
    );
  }
  if (!cognito.ok) throw new Error(cognito.message);
  if (!deploymentProfile.ok) throw new Error(deploymentProfile.message);
  if (!controlPlane.ok) throw new Error(controlPlane.message);

  return {
    endpoints,
    spaces,
    graphql,
    cognito,
    deploymentProfile,
    controlPlane,
    terraform,
  };
}

function resolveEndpoints(terraform) {
  return {
    spacesUrl: first(
      env.SMOKE_SPACES_URL,
      env.VITE_SPACES_URL,
      terraform.app_url,
    ),
    apiUrl: first(env.SMOKE_API_URL, terraform.api_endpoint),
    graphqlUrl: first(
      env.SMOKE_GRAPHQL_URL,
      env.VITE_GRAPHQL_URL,
      env.GRAPHQL_URL,
      terraform.appsync_api_url,
    ),
    graphqlWsUrl: first(
      env.SMOKE_GRAPHQL_WS_URL,
      terraform.appsync_realtime_url,
    ),
    cognitoDomain: normalizedUrl(
      first(
        env.SMOKE_COGNITO_DOMAIN,
        env.VITE_COGNITO_DOMAIN,
        terraform.auth_domain,
      ),
    ),
    evidenceBucket: first(
      env.SMOKE_EVIDENCE_BUCKET,
      terraform.deployment_evidence_bucket_name,
    ),
    stateMachineArn: first(
      env.SMOKE_STEP_FUNCTIONS_STATE_MACHINE_ARN,
      terraform.deployment_state_machine_arn,
    ),
    codeBuildProject: first(
      env.SMOKE_CODEBUILD_PROJECT,
      terraform.deployment_runner_project_name,
    ),
  };
}

async function probeHttp(url) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.text().catch(() => "");
    return {
      endpoint: url,
      ok: response.ok,
      statusCode: response.status,
      latencyMs: Date.now() - started,
      message: body.slice(0, 300),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeGraphql(url) {
  const apiSecret = first(env.API_AUTH_SECRET, env.THINKWORK_API_SECRET);
  const apiKey = first(
    env.VITE_GRAPHQL_API_KEY,
    env.APPSYNC_API_KEY,
    env.GRAPHQL_API_KEY,
  );
  if (!apiSecret && !apiKey) {
    return {
      skipped: true,
      reason:
        "GraphQL credentials were not provided; endpoint URL was resolved but not queried.",
    };
  }

  const headers = { "content-type": "application/json" };
  if (apiSecret) headers.authorization = `Bearer ${apiSecret}`;
  else headers["x-api-key"] = apiKey;

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: "{ __typename }" }),
      signal: controller.signal,
    });
    const body = await response.json().catch(async () => ({
      text: await response.text().catch(() => ""),
    }));
    return {
      endpoint: url,
      ok: response.ok && !body.errors?.length,
      statusCode: response.status,
      latencyMs: Date.now() - started,
      message: JSON.stringify(body).slice(0, 300),
    };
  } finally {
    clearTimeout(timer);
  }
}

function validateCognitoDomain(value) {
  try {
    const url = new URL(value);
    return {
      endpoint: value,
      ok: url.protocol === "https:",
      message:
        url.protocol === "https:"
          ? "Cognito domain is HTTPS."
          : `Cognito domain must be HTTPS, got ${url.protocol}.`,
    };
  } catch (error) {
    return {
      endpoint: value,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function validateDeploymentProfileJson() {
  const raw = first(env.SMOKE_DEPLOYMENT_PROFILE_JSON);
  if (!raw) {
    return {
      ok: true,
      skipped: true,
      reason: "SMOKE_DEPLOYMENT_PROFILE_JSON was not provided.",
    };
  }

  try {
    const profile = JSON.parse(raw);
    const missing = missingDeploymentProfileFields(profile);
    return {
      ok: missing.length === 0,
      missing,
      profileSha256: first(env.SMOKE_DEPLOYMENT_PROFILE_SHA256),
      message:
        missing.length === 0
          ? "Deployment profile includes required v1 fields."
          : `Deployment profile missing required fields: ${missing.join(", ")}`,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `Deployment profile JSON is malformed: ${error.message}`
          : "Deployment profile JSON is malformed.",
    };
  }
}

function missingDeploymentProfileFields(profile) {
  const required = [
    ["schemaVersion"],
    ["deploymentId"],
    ["displayName"],
    ["stage"],
    ["region"],
    ["appUrl", "spacesUrl"],
    ["apiEndpoint", "apiUrl"],
    ["graphqlHttpUrl"],
    ["appsyncUrl", "appsyncHttpUrl"],
    ["appsyncRealtimeUrl", "appsyncWsUrl"],
    ["cognitoDomain"],
    ["cognitoUserPoolId"],
    ["cognitoClientId"],
  ];

  return required
    .filter((fields) => {
      if (fields.includes("schemaVersion")) return profile.schemaVersion !== 1;
      return !fields.some((field) => {
        const value = profile[field];
        return typeof value === "string" && value.trim();
      });
    })
    .map((fields) => fields.join(" or "));
}

function validateControlPlane(terraform, endpoints) {
  const endpointValues = {
    deployment_state_machine_arn: endpoints.stateMachineArn,
    deployment_runner_project_name: endpoints.codeBuildProject,
    deployment_evidence_bucket_name: endpoints.evidenceBucket,
  };
  const hasEndpointControlPlane = Object.values(endpointValues).some(Boolean);
  const enabled =
    bool(terraform.deployment_control_plane_enabled) ||
    hasEndpointControlPlane ||
    env.SMOKE_REQUIRE_CONTROL_PLANE === "1";
  if (!enabled) {
    return {
      ok: true,
      enabled: false,
      skipped: true,
      reason:
        "deployment_control_plane_enabled is false or unavailable, and no SMOKE_* control-plane endpoints were provided.",
    };
  }

  const missing = [
    [
      "deployment_state_machine_arn",
      first(
        terraform.deployment_state_machine_arn,
        endpointValues.deployment_state_machine_arn,
      ),
    ],
    [
      "deployment_runner_project_name",
      first(
        terraform.deployment_runner_project_name,
        endpointValues.deployment_runner_project_name,
      ),
    ],
    [
      "deployment_evidence_bucket_name",
      first(
        terraform.deployment_evidence_bucket_name,
        endpointValues.deployment_evidence_bucket_name,
      ),
    ],
  ].filter(([, value]) => !value);

  return {
    ok: missing.length === 0,
    enabled: true,
    source: bool(terraform.deployment_control_plane_enabled)
      ? "terraform"
      : "runtime-config-or-env",
    stateMachineArn: first(
      terraform.deployment_state_machine_arn,
      endpointValues.deployment_state_machine_arn,
    ),
    codeBuildProject: first(
      terraform.deployment_runner_project_name,
      endpointValues.deployment_runner_project_name,
    ),
    evidenceBucket: first(
      terraform.deployment_evidence_bucket_name,
      endpointValues.deployment_evidence_bucket_name,
    ),
    missing: missing.map(([name]) => name),
    message:
      missing.length === 0
        ? "Deployment control-plane outputs are present."
        : `Missing deployment control-plane outputs: ${missing.map(([name]) => name).join(", ")}`,
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
      app_url: outputValue(parsed.app_url),
      admin_url: outputValue(parsed.admin_url),
      api_endpoint: outputValue(parsed.api_endpoint),
      appsync_api_url: outputValue(parsed.appsync_api_url),
      appsync_realtime_url: outputValue(parsed.appsync_realtime_url),
      auth_domain: outputValue(parsed.auth_domain),
      deployment_control_plane_enabled: outputValue(
        parsed.deployment_control_plane_enabled,
      ),
      deployment_state_machine_arn: outputValue(
        parsed.deployment_state_machine_arn,
      ),
      deployment_runner_project_name: outputValue(
        parsed.deployment_runner_project_name,
      ),
      deployment_evidence_bucket_name: outputValue(
        parsed.deployment_evidence_bucket_name,
      ),
    };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function outputValue(entry) {
  return entry && Object.prototype.hasOwnProperty.call(entry, "value")
    ? entry.value
    : undefined;
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
          return [
            line.slice(0, index),
            line.slice(index + 1).replace(/^['"]|['"]$/g, ""),
          ];
        }),
    );
  }
  return {};
}

function normalizedUrl(value) {
  if (!value) return "";
  if (value.startsWith("https://") || value.startsWith("http://")) {
    return value.replace(/\/+$/, "");
  }
  return `https://${value.replace(/\/+$/, "")}`;
}

function first(...values) {
  return (
    values.find((value) => typeof value === "string" && value.trim())?.trim() ??
    ""
  );
}

function bool(value) {
  return value === true || value === "true" || value === "1";
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, message }, null, 2));
  process.exit(1);
}
