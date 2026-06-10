#!/usr/bin/env node
/**
 * Smoke test a deployment profile across the web, desktop, and mobile binding
 * contract.
 *
 * Dry-run is the default. Set SMOKE_ENABLE_DEPLOYMENT_PROFILE_BINDING=1 to read
 * a deployed runtime config, build the canonical deployment profile, validate
 * it, and emit a support evidence envelope. No production mutation is
 * performed.
 *
 * Optional live env:
 *   SMOKE_RUNTIME_CONFIG_URL=https://.../thinkwork-runtime-config.json
 *   SMOKE_SPACES_URL=https://...
 *   SMOKE_RUNTIME_CONFIG_FILE=/tmp/runtime-config.json
 *   SMOKE_RUNTIME_CONFIG_JSON='{"stage":"tei-e2e",...}'
 *   SMOKE_EVIDENCE_FILE=/tmp/deployment-profile-binding-smoke.json
 *   SMOKE_EVIDENCE_S3_URI=s3://bucket/prefix
 */

import fs from "node:fs/promises";
import process from "node:process";
import { attachSmokeEvidence } from "./deployment-evidence.mjs";

const LIVE_ENABLED =
  process.env.SMOKE_ENABLE_DEPLOYMENT_PROFILE_BINDING === "1";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15_000);

const dryRun = {
  requiredWhenRunning: [
    "SMOKE_RUNTIME_CONFIG_URL, SMOKE_SPACES_URL, SMOKE_RUNTIME_CONFIG_FILE, or SMOKE_RUNTIME_CONFIG_JSON",
    "`pnpm --filter @thinkwork/deployment-profile build` so the shared profile contract is available from dist",
  ],
  verifies: [
    "Deployed runtime config can be normalized into a v1 deployment profile",
    "Profile validation rejects missing Auth/API/AppSync fields before OAuth",
    "Web, desktop, and mobile binding snapshots resolve to the same deployment",
    "Profile and smoke evidence omit API keys, passwords, AWS keys, tokens, and Secrets Manager payloads",
  ],
};

if (!LIVE_ENABLED) {
  const result = await attachSmokeEvidence("deployment-profile-binding", {
    ok: true,
    skippedLive: true,
    reason:
      "set SMOKE_ENABLE_DEPLOYMENT_PROFILE_BINDING=1 to run the deployed profile binding smoke",
    dryRun,
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

try {
  const result = await runLiveSmoke();
  console.log(
    JSON.stringify(
      await attachSmokeEvidence("deployment-profile-binding", result),
      null,
      2,
    ),
  );
} catch (error) {
  const result = {
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  };
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

async function runLiveSmoke() {
  const contract = await importDeploymentProfileContract();
  const runtimeConfig = await loadRuntimeConfig();
  const profile = contract.buildDeploymentProfile(
    profileConfigFromRuntime(runtimeConfig),
  );
  const validation = contract.assessDeploymentProfile(profile, {
    allowUnsigned: true,
  });

  if (!validation.ok || !validation.profile) {
    throw new Error(
      validation.issues[0]?.message ??
        `Deployment profile validation failed with ${validation.status}.`,
    );
  }

  const runtime = contract.profileToRuntimeConfig(profile);
  const profileSha256 = contract.deploymentProfileSha256(profile);
  const leakage = findSensitiveKeys(profile);
  if (leakage.length > 0) {
    throw new Error(
      `Deployment profile contains sensitive field(s): ${leakage.join(", ")}`,
    );
  }

  const bindings = bindingSnapshots({ profile, profileSha256, runtime });
  assertBindingConsistency(bindings, profile);

  const spaces = await probeSpacesUrl(profile.spacesUrl);
  if (!spaces.ok) {
    throw new Error(
      `Spaces URL failed: HTTP ${spaces.statusCode ?? "none"} ${spaces.message}`,
    );
  }

  const evidenceResult = {
    ok: true,
    release: {
      version: profile.releaseVersion ?? null,
      manifestDigest: profile.releaseManifestSha256 ?? null,
    },
    profile: {
      deploymentId: profile.deploymentId,
      displayName: profile.displayName,
      stage: profile.stage,
      region: profile.region,
      accountId: profile.accountId ?? null,
      profileSha256,
      trustStatus: validation.status,
      controller: profile.controller
        ? {
            stateMachineArn: profile.controller.stateMachineArn,
            codebuildProjectName:
              profile.controller.codebuildProjectName ?? null,
            evidenceBucketName: profile.controller.evidenceBucketName ?? null,
            ssmPrefix: profile.controller.ssmPrefix ?? null,
            verifiedAt: profile.controller.verifiedAt ?? null,
          }
        : null,
    },
    bindings,
    spaces,
    sensitiveFields: [],
  };

  const evidenceLeakage = findSensitiveKeys(evidenceResult);
  if (evidenceLeakage.length > 0) {
    throw new Error(
      `Profile binding evidence contains sensitive field(s): ${evidenceLeakage.join(", ")}`,
    );
  }

  return evidenceResult;
}

async function importDeploymentProfileContract() {
  const moduleUrl = new URL(
    "../../packages/deployment-profile/dist/index.js",
    import.meta.url,
  );
  try {
    return await import(moduleUrl.href);
  } catch (error) {
    throw new Error(
      `Could not load @thinkwork/deployment-profile dist. Run pnpm --filter @thinkwork/deployment-profile build first. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function loadRuntimeConfig() {
  const inline = first(process.env.SMOKE_RUNTIME_CONFIG_JSON);
  if (inline) return parseRuntimeConfig(inline, "SMOKE_RUNTIME_CONFIG_JSON");

  const file = first(process.env.SMOKE_RUNTIME_CONFIG_FILE);
  if (file) {
    return parseRuntimeConfig(
      await fs.readFile(file, "utf8"),
      `SMOKE_RUNTIME_CONFIG_FILE ${file}`,
    );
  }

  const runtimeUrl =
    first(process.env.SMOKE_RUNTIME_CONFIG_URL) ||
    runtimeConfigUrlFromSpaces(first(process.env.SMOKE_SPACES_URL));
  if (!runtimeUrl) {
    throw new Error(
      "Provide SMOKE_RUNTIME_CONFIG_URL, SMOKE_SPACES_URL, SMOKE_RUNTIME_CONFIG_FILE, or SMOKE_RUNTIME_CONFIG_JSON.",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(runtimeUrl, { signal: controller.signal });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `Runtime config request failed: HTTP ${response.status} ${body.slice(0, 200)}`,
      );
    }
    return parseRuntimeConfig(body, runtimeUrl);
  } finally {
    clearTimeout(timer);
  }
}

function parseRuntimeConfig(raw, source) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected a JSON object");
    }
    return parsed;
  } catch (error) {
    throw new Error(
      `Runtime config from ${source} is malformed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function profileConfigFromRuntime(runtime) {
  const stage = stringValue(runtime.stage, runtime.VITE_STAGE) || "dev";
  const deploymentId =
    stringValue(runtime.deploymentId, runtime.VITE_DEPLOYMENT_ID) ||
    `thinkwork-${stage}`;
  const appUrl = stringValue(
    runtime.appUrl,
    runtime.spacesUrl,
    runtime.VITE_SPACES_URL,
  );
  const apiUrl = stringValue(
    runtime.apiEndpoint,
    runtime.apiUrl,
    runtime.VITE_API_URL,
  );
  const graphqlHttpUrl =
    stringValue(runtime.graphqlHttpUrl, runtime.VITE_GRAPHQL_HTTP_URL) ||
    appendPath(apiUrl, "graphql");
  const appsyncHttpUrl = stringValue(
    runtime.appsyncUrl,
    runtime.appsyncHttpUrl,
    runtime.graphqlUrl,
    runtime.VITE_GRAPHQL_URL,
  );

  return {
    deploymentId,
    displayName:
      stringValue(runtime.displayName, runtime.VITE_DEPLOYMENT_DISPLAY_NAME) ||
      "ThinkWork",
    stage,
    region:
      stringValue(runtime.region, runtime.awsRegion, runtime.VITE_AWS_REGION) ||
      "us-east-1",
    accountId: stringValue(runtime.accountId, runtime.VITE_AWS_ACCOUNT_ID),
    releaseVersion: stringValue(
      runtime.releaseVersion,
      runtime.VITE_RELEASE_VERSION,
    ),
    releaseManifestUrl: stringValue(
      runtime.releaseManifestUrl,
      runtime.VITE_RELEASE_MANIFEST_URL,
    ),
    releaseManifestSha256: stringValue(
      runtime.releaseManifestSha256,
      runtime.VITE_RELEASE_MANIFEST_SHA256,
    ),
    controller: compactController(runtime.controller, runtime),
    issuedAt: stringValue(
      runtime.deploymentProfileIssuedAt,
      runtime.VITE_DEPLOYMENT_PROFILE_ISSUED_AT,
      runtime.generatedAt,
      runtime.updatedAt,
      runtime.controller?.verifiedAt,
    ),
    spacesUrl: appUrl,
    apiUrl,
    graphqlHttpUrl,
    appsyncHttpUrl,
    appsyncWsUrl: stringValue(
      runtime.appsyncRealtimeUrl,
      runtime.appsyncWsUrl,
      runtime.graphqlWsUrl,
      runtime.VITE_GRAPHQL_WS_URL,
    ),
    cognitoDomain: stringValue(
      runtime.cognitoDomain,
      runtime.VITE_COGNITO_DOMAIN,
    ),
    cognitoUserPoolId: stringValue(
      runtime.cognitoUserPoolId,
      runtime.VITE_COGNITO_USER_POOL_ID,
    ),
    cognitoClientId: stringValue(
      runtime.cognitoClientId,
      runtime.VITE_COGNITO_CLIENT_ID,
    ),
    signature: null,
  };
}

function compactController(controller = {}, runtime = {}) {
  const stateMachineArn = stringValue(
    controller.stateMachineArn,
    runtime.VITE_DEPLOYMENT_CONTROLLER_ARN,
  );
  if (!stateMachineArn) return null;
  return {
    stateMachineArn,
    stateMachineName: stringValue(
      controller.stateMachineName,
      runtime.VITE_DEPLOYMENT_CONTROLLER_NAME,
    ),
    codebuildProjectName: stringValue(
      controller.codebuildProjectName,
      runtime.VITE_DEPLOYMENT_RUNNER_PROJECT_NAME,
    ),
    codebuildProjectArn: stringValue(
      controller.codebuildProjectArn,
      runtime.VITE_DEPLOYMENT_RUNNER_PROJECT_ARN,
    ),
    evidenceBucketName: stringValue(
      controller.evidenceBucketName,
      runtime.VITE_DEPLOYMENT_EVIDENCE_BUCKET,
    ),
    ssmPrefix: stringValue(
      controller.ssmPrefix,
      runtime.VITE_DEPLOYMENT_SSM_PREFIX,
    ),
    appconfigApplicationId: stringValue(controller.appconfigApplicationId),
    appconfigEnvironmentId: stringValue(controller.appconfigEnvironmentId),
    appconfigConfigurationProfileId: stringValue(
      controller.appconfigConfigurationProfileId,
    ),
    verifiedAt: stringValue(controller.verifiedAt),
  };
}

function bindingSnapshots({ profile, profileSha256, runtime }) {
  return {
    web: {
      okForOAuth: true,
      displayName: profile.displayName,
      stage: profile.stage,
      region: profile.region,
      requiredEnv: {
        VITE_SPACES_URL: profile.spacesUrl,
        VITE_API_URL: profile.apiUrl,
        VITE_GRAPHQL_HTTP_URL: profile.graphqlHttpUrl,
        VITE_GRAPHQL_URL: profile.appsyncHttpUrl,
        VITE_GRAPHQL_WS_URL: profile.appsyncWsUrl,
        VITE_COGNITO_DOMAIN: runtime.cognitoDomain,
        VITE_COGNITO_USER_POOL_ID: runtime.cognitoUserPoolId,
        VITE_COGNITO_CLIENT_ID: runtime.cognitoClientId,
      },
    },
    desktop: {
      configured: true,
      stage: runtime.stage,
      deployment: {
        source: "profile",
        deploymentId: profile.deploymentId,
        displayName: profile.displayName,
        stage: profile.stage,
        region: profile.region,
        profileSha256,
        trustStatus: profile.signature ? "trusted" : "unsigned",
      },
      endpoints: {
        apiUrl: runtime.apiUrl,
        graphqlHttpUrl: runtime.graphqlHttpUrl,
        graphqlUrl: runtime.graphqlUrl,
        graphqlWsUrl: runtime.graphqlWsUrl,
        cognitoDomain: runtime.cognitoDomain,
      },
    },
    mobile: {
      configured: true,
      deployment: {
        source: "profile",
        deploymentId: profile.deploymentId,
        displayName: profile.displayName,
        stage: profile.stage,
        region: profile.region,
        profileSha256,
        trustStatus: profile.signature ? "trusted" : "unsigned",
      },
      graphqlUrl: runtime.graphqlUrl,
      graphqlWsUrl: runtime.graphqlWsUrl,
      cognitoDomain: runtime.cognitoDomain,
      cognitoUserPoolId: runtime.cognitoUserPoolId,
      cognitoClientId: runtime.cognitoClientId,
    },
  };
}

function assertBindingConsistency(bindings, profile) {
  const mismatches = [];
  for (const [surface, binding] of Object.entries(bindings)) {
    const deployment = binding.deployment;
    if (deployment) {
      if (deployment.deploymentId !== profile.deploymentId) {
        mismatches.push(`${surface}.deployment.deploymentId`);
      }
      if (deployment.stage !== profile.stage) {
        mismatches.push(`${surface}.deployment.stage`);
      }
      if (deployment.region !== profile.region) {
        mismatches.push(`${surface}.deployment.region`);
      }
    } else {
      if (binding.stage !== profile.stage) mismatches.push(`${surface}.stage`);
      if (binding.region !== profile.region)
        mismatches.push(`${surface}.region`);
    }
  }
  if (mismatches.length > 0) {
    throw new Error(
      `Deployment profile binding mismatch: ${mismatches.join(", ")}`,
    );
  }
}

async function probeSpacesUrl(url) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return {
      endpoint: url,
      ok: response.ok,
      statusCode: response.status,
      latencyMs: Date.now() - started,
      message: (await response.text()).slice(0, 200),
    };
  } finally {
    clearTimeout(timer);
  }
}

function findSensitiveKeys(value, path = []) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findSensitiveKeys(item, [...path, String(index)]),
    );
  }
  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = [...path, key];
    const found = isSensitiveKey(key) ? [childPath.join(".")] : [];
    return found.concat(findSensitiveKeys(child, childPath));
  });
}

function isSensitiveKey(key) {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return [
    "apikey",
    "appsyncapikey",
    "graphqlapikey",
    "secret",
    "password",
    "token",
    "credential",
    "accesskeyid",
    "secretaccesskey",
    "sessiontoken",
    "privatekey",
  ].some((needle) => normalized.includes(needle));
}

function runtimeConfigUrlFromSpaces(spacesUrl) {
  if (!spacesUrl) return "";
  return `${spacesUrl.replace(/\/+$/, "")}/thinkwork-runtime-config.json`;
}

function appendPath(baseUrl, path) {
  if (!baseUrl) return "";
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function stringValue(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function first(...values) {
  return stringValue(...values) || null;
}
