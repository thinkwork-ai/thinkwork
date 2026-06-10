#!/usr/bin/env node
/**
 * Smoke test deployment teardown readiness without running destroy.
 *
 * Dry-run is the default. Set SMOKE_ENABLE_DEPLOYMENT_TEARDOWN_READINESS=1 to
 * inspect the deployed controller, selected release pins, Terraform backend,
 * and evidence bucket that a later destroy run would use. This script is
 * intentionally read-only: it never calls StartExecution, CodeBuild, Terraform,
 * or any destructive AWS API.
 *
 * Optional live env:
 *   AWS_PROFILE=tei
 *   AWS_REGION=us-east-1
 *   SMOKE_STAGE=tei-e2e
 *   SMOKE_DEPLOYMENT_SSM_PREFIX=/thinkwork/tei-e2e/deployment
 *   SMOKE_RUNTIME_CONFIG_URL=https://.../thinkwork-runtime-config.json
 *   SMOKE_RUNTIME_CONFIG_FILE=/tmp/runtime-config.json
 *   SMOKE_RUNTIME_CONFIG_JSON='{"stage":"tei-e2e",...}'
 *   SMOKE_EVIDENCE_FILE=/tmp/deployment-teardown-readiness.json
 *   SMOKE_EVIDENCE_S3_URI=s3://bucket/prefix
 */

import { execFileSync } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import process from "node:process";
import { attachSmokeEvidence } from "./deployment-evidence.mjs";

const LIVE_ENABLED =
  process.env.SMOKE_ENABLE_DEPLOYMENT_TEARDOWN_READINESS === "1";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15_000);

const env = {
  ...loadEnvFile(),
  ...process.env,
};

const dryRun = {
  requiredWhenRunning: [
    "AWS credentials/profile with read access to the target customer account",
    "AWS_REGION or AWS_DEFAULT_REGION",
    "SMOKE_STAGE or SMOKE_DEPLOYMENT_SSM_PREFIX",
    "Customer deployment SSM parameters for selected release, backend, and profile",
  ],
  verifies: [
    "Selected release version, manifest URL, manifest digest, trust policy, and module pins exist",
    "Customer-owned Step Functions state machine is readable",
    "Customer-owned CodeBuild runner project is readable",
    "Terraform state bucket and DynamoDB lock table are readable",
    "Deployment evidence bucket is readable and contains prior controller evidence",
    "Destroy input preview can be formed without credential material",
  ],
  neverDoes: [
    "Start a Step Functions execution",
    "Start a CodeBuild run",
    "Run Terraform plan/apply/destroy",
    "Delete resources or mutate AWS state",
  ],
};

if (!LIVE_ENABLED) {
  const result = await attachSmokeEvidence(
    "deployment-teardown-readiness",
    {
      ok: true,
      skippedLive: true,
      reason:
        "set SMOKE_ENABLE_DEPLOYMENT_TEARDOWN_READINESS=1 to run the read-only teardown readiness smoke",
      dryRun,
    },
    env,
  );
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

try {
  const result = await runLiveSmoke();
  const leakage = findSensitiveKeys(result);
  if (leakage.length > 0) {
    throw new Error(
      `Teardown readiness evidence contains sensitive field(s): ${leakage.join(", ")}`,
    );
  }
  console.log(
    JSON.stringify(
      await attachSmokeEvidence("deployment-teardown-readiness", result, env),
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
  const region = first(env.AWS_REGION, env.AWS_DEFAULT_REGION);
  if (!region) {
    throw new Error("AWS_REGION or AWS_DEFAULT_REGION is required.");
  }

  const ssmPrefix = resolveSsmPrefix();
  const runtimeConfig = await loadRuntimeConfig(ssmPrefix);
  const profile = sanitizeRuntimeProfile(runtimeConfig);
  const release = getReleasePins(ssmPrefix);
  const backend = getBackendPins(ssmPrefix);

  assertReleaseConsistency({ release, profile });

  const controller = {
    stateMachineArn: first(
      profile.controller?.stateMachineArn,
      env.SMOKE_STEP_FUNCTIONS_STATE_MACHINE_ARN,
    ),
    codebuildProjectName: first(
      profile.controller?.codebuildProjectName,
      env.SMOKE_CODEBUILD_PROJECT,
    ),
    evidenceBucketName: first(
      profile.controller?.evidenceBucketName,
      env.SMOKE_EVIDENCE_BUCKET,
    ),
    ssmPrefix,
  };

  requireValue(controller.stateMachineArn, "controller.stateMachineArn");
  requireValue(
    controller.codebuildProjectName,
    "controller.codebuildProjectName",
  );
  requireValue(controller.evidenceBucketName, "controller.evidenceBucketName");
  requireValue(backend.terraformStateBucket, "terraform state bucket");
  requireValue(backend.terraformLockTable, "terraform lock table");

  const checks = {
    stateMachine: describeStateMachine(controller.stateMachineArn),
    codebuildProject: describeCodeBuildProject(controller.codebuildProjectName),
    stateBucket: headS3Bucket(backend.terraformStateBucket),
    lockTable: describeDynamoTable(backend.terraformLockTable),
    evidenceBucket: headS3Bucket(controller.evidenceBucketName),
    evidencePrefix: listEvidencePrefix(controller.evidenceBucketName),
  };

  for (const [name, check] of Object.entries(checks)) {
    if (!check.ok) {
      throw new Error(`${name} readiness check failed: ${check.message}`);
    }
  }

  const destroyInputPreview = {
    schemaVersion: "thinkwork.deployment.controller.v1",
    action: "destroy",
    stage: profile.stage,
    deploymentId: profile.deploymentId,
    region: profile.region,
    accountId: profile.accountId,
    selectedRelease: {
      version: release.version,
      manifestUrl: release.manifestUrl,
      manifestSha256: release.manifestSha256,
      trustPolicy: release.trustPolicy,
    },
    controller: {
      stateMachineArn: controller.stateMachineArn,
      codebuildProjectName: controller.codebuildProjectName,
      evidenceBucketName: controller.evidenceBucketName,
      ssmPrefix,
    },
    terraformBackend: backend,
    safeguards: {
      readOnlySmoke: true,
      destroyExecutionStarted: false,
      requiresExplicitOperatorConfirmation: true,
    },
  };

  return {
    ok: true,
    readOnly: true,
    stage: profile.stage,
    deploymentId: profile.deploymentId,
    release,
    controller,
    terraformBackend: backend,
    checks,
    destroyInputPreview,
    sensitiveFields: [],
  };
}

function resolveSsmPrefix() {
  const explicit = first(env.SMOKE_DEPLOYMENT_SSM_PREFIX);
  if (explicit) return explicit.replace(/\/+$/, "");

  const stage = first(env.SMOKE_STAGE, env.THINKWORK_STAGE, env.VITE_STAGE);
  if (!stage) {
    throw new Error(
      "SMOKE_STAGE, THINKWORK_STAGE, VITE_STAGE, or SMOKE_DEPLOYMENT_SSM_PREFIX is required.",
    );
  }
  return `/thinkwork/${stage}/deployment`;
}

async function loadRuntimeConfig(ssmPrefix) {
  const inline = first(env.SMOKE_RUNTIME_CONFIG_JSON);
  if (inline) return parseJson(inline, "SMOKE_RUNTIME_CONFIG_JSON");

  const file = first(env.SMOKE_RUNTIME_CONFIG_FILE);
  if (file) {
    return parseJson(
      await fs.readFile(file, "utf8"),
      `SMOKE_RUNTIME_CONFIG_FILE ${file}`,
    );
  }

  const runtimeUrl = first(env.SMOKE_RUNTIME_CONFIG_URL);
  if (runtimeUrl) {
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
      return parseJson(body, runtimeUrl);
    } finally {
      clearTimeout(timer);
    }
  }

  const profileJson = awsJson([
    "ssm",
    "get-parameter",
    "--name",
    `${ssmPrefix}/profile/json`,
    "--with-decryption",
    "--query",
    "Parameter.Value",
    "--output",
    "text",
  ]);
  return parseJson(profileJson, `${ssmPrefix}/profile/json`);
}

function getReleasePins(ssmPrefix) {
  const names = [
    "selected-release-version",
    "selected-release-manifest-url",
    "selected-release-manifest-sha256",
    "selected-release-trust-policy",
    "terraform-module-source",
    "terraform-module-version",
  ];
  const values = getSsmParameters(ssmPrefix, names);
  return {
    version: requireValue(
      values["selected-release-version"],
      "release version",
    ),
    manifestUrl: requireValue(
      values["selected-release-manifest-url"],
      "release manifest URL",
    ),
    manifestSha256: requireSha256(
      values["selected-release-manifest-sha256"],
      "release manifest SHA-256",
    ),
    trustPolicy: requireValue(
      values["selected-release-trust-policy"],
      "release trust policy",
    ),
    terraformModuleSource: requireValue(
      values["terraform-module-source"],
      "Terraform module source",
    ),
    terraformModuleVersion: requireValue(
      values["terraform-module-version"],
      "Terraform module version",
    ),
  };
}

function getBackendPins(ssmPrefix) {
  const values = getSsmParameters(ssmPrefix, [
    "terraform-state-bucket",
    "terraform-lock-table",
    "release-artifact-bucket",
  ]);
  return {
    terraformStateBucket: requireValue(
      values["terraform-state-bucket"],
      "Terraform state bucket",
    ),
    terraformLockTable: requireValue(
      values["terraform-lock-table"],
      "Terraform lock table",
    ),
    releaseArtifactBucket: values["release-artifact-bucket"] ?? null,
  };
}

function getSsmParameters(ssmPrefix, names) {
  const fullNames = names.map((name) => `${ssmPrefix}/${name}`);
  const response = awsJson([
    "ssm",
    "get-parameters",
    "--names",
    ...fullNames,
    "--with-decryption",
    "--query",
    "Parameters[].{Name:Name,Value:Value}",
    "--output",
    "json",
  ]);
  const rows = parseJson(response, "SSM get-parameters");
  return Object.fromEntries(
    rows.map((row) => [
      String(row.Name).replace(`${ssmPrefix}/`, ""),
      row.Value,
    ]),
  );
}

function sanitizeRuntimeProfile(runtime) {
  const viteEnv =
    runtime.viteEnv && typeof runtime.viteEnv === "object"
      ? runtime.viteEnv
      : {};
  return {
    deploymentId: first(runtime.deploymentId, viteEnv.VITE_DEPLOYMENT_ID),
    displayName: first(
      runtime.displayName,
      viteEnv.VITE_DEPLOYMENT_DISPLAY_NAME,
    ),
    stage: first(runtime.stage, viteEnv.VITE_STAGE),
    region: first(runtime.region, viteEnv.VITE_AWS_REGION),
    accountId: first(runtime.accountId, viteEnv.VITE_AWS_ACCOUNT_ID),
    releaseVersion: first(runtime.releaseVersion, viteEnv.VITE_RELEASE_VERSION),
    releaseManifestUrl: first(
      runtime.releaseManifestUrl,
      viteEnv.VITE_RELEASE_MANIFEST_URL,
    ),
    releaseManifestSha256: first(
      runtime.releaseManifestSha256,
      viteEnv.VITE_RELEASE_MANIFEST_SHA256,
    ),
    appUrl: first(runtime.appUrl, viteEnv.VITE_SPACES_URL),
    graphqlHttpUrl: first(
      runtime.graphqlHttpUrl,
      viteEnv.VITE_GRAPHQL_HTTP_URL,
    ),
    controller: {
      stateMachineArn: first(
        runtime.controller?.stateMachineArn,
        viteEnv.VITE_DEPLOYMENT_CONTROLLER_ARN,
      ),
      codebuildProjectName: first(
        runtime.controller?.codebuildProjectName,
        viteEnv.VITE_DEPLOYMENT_RUNNER_PROJECT_NAME,
      ),
      evidenceBucketName: first(
        runtime.controller?.evidenceBucketName,
        viteEnv.VITE_DEPLOYMENT_EVIDENCE_BUCKET,
      ),
      ssmPrefix: first(
        runtime.controller?.ssmPrefix,
        viteEnv.VITE_DEPLOYMENT_SSM_PREFIX,
      ),
    },
  };
}

function assertReleaseConsistency({ release, profile }) {
  if (profile.releaseVersion && profile.releaseVersion !== release.version) {
    throw new Error(
      `Runtime profile release ${profile.releaseVersion} does not match selected SSM release ${release.version}.`,
    );
  }
  if (
    profile.releaseManifestSha256 &&
    profile.releaseManifestSha256 !== release.manifestSha256
  ) {
    throw new Error(
      `Runtime profile manifest digest ${profile.releaseManifestSha256} does not match selected SSM digest ${release.manifestSha256}.`,
    );
  }
}

function describeStateMachine(stateMachineArn) {
  const response = awsJson([
    "stepfunctions",
    "describe-state-machine",
    "--state-machine-arn",
    stateMachineArn,
    "--query",
    "{name:name,status:status,type:type,creationDate:creationDate}",
    "--output",
    "json",
  ]);
  const stateMachine = parseJson(response, "Step Functions state machine");
  return {
    ok: stateMachine.status === "ACTIVE",
    name: stateMachine.name,
    status: stateMachine.status,
    type: stateMachine.type,
    message:
      stateMachine.status === "ACTIVE"
        ? "State machine is ACTIVE."
        : `State machine status is ${stateMachine.status}.`,
  };
}

function describeCodeBuildProject(projectName) {
  const response = awsJson([
    "codebuild",
    "batch-get-projects",
    "--names",
    projectName,
    "--query",
    "{projects:projects[].{name:name,arn:arn,serviceRole:serviceRole},notFound:projectsNotFound[]}",
    "--output",
    "json",
  ]);
  const result = parseJson(response, "CodeBuild project");
  const project = result.projects?.[0];
  return {
    ok: Boolean(project) && !result.notFound?.length,
    name: project?.name ?? projectName,
    arn: project?.arn ?? null,
    message: project
      ? "CodeBuild project is readable."
      : `CodeBuild project was not found: ${projectName}`,
  };
}

function headS3Bucket(bucket) {
  awsJson(["s3api", "head-bucket", "--bucket", bucket]);
  return {
    ok: true,
    bucket,
    message: "S3 bucket is readable.",
  };
}

function listEvidencePrefix(bucket) {
  const response = awsJson([
    "s3api",
    "list-objects-v2",
    "--bucket",
    bucket,
    "--prefix",
    "sessions/",
    "--max-keys",
    "5",
    "--query",
    "{keyCount:KeyCount,keys:Contents[].Key}",
    "--output",
    "json",
  ]);
  const result = parseJson(response, "evidence bucket prefix");
  const keys = result.keys ?? [];
  const keyCount = Number(result.keyCount ?? keys.length);
  return {
    ok: keyCount > 0,
    keyCount,
    sampleKeys: keys.slice(0, 5),
    message:
      keyCount > 0
        ? "Evidence bucket contains controller session evidence."
        : "Evidence bucket has no sessions/ objects.",
  };
}

function describeDynamoTable(tableName) {
  const response = awsJson([
    "dynamodb",
    "describe-table",
    "--table-name",
    tableName,
    "--query",
    "{name:Table.TableName,status:Table.TableStatus,billingMode:Table.BillingModeSummary.BillingMode}",
    "--output",
    "json",
  ]);
  const table = parseJson(response, "DynamoDB table");
  return {
    ok: table.status === "ACTIVE",
    name: table.name,
    status: table.status,
    billingMode: table.billingMode ?? null,
    message:
      table.status === "ACTIVE"
        ? "DynamoDB lock table is ACTIVE."
        : `DynamoDB lock table status is ${table.status}.`,
  };
}

function awsJson(args) {
  const awsArgs = [...args];
  const profile = first(env.AWS_PROFILE);
  const region = first(env.AWS_REGION, env.AWS_DEFAULT_REGION);
  if (profile) awsArgs.unshift("--profile", profile);
  if (region) awsArgs.unshift("--region", region);

  try {
    return execFileSync("aws", awsArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env,
    }).trim();
  } catch (error) {
    const stderr = error?.stderr?.toString?.().trim();
    const stdout = error?.stdout?.toString?.().trim();
    throw new Error(stderr || stdout || error.message || String(error));
  }
}

function parseJson(raw, source) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `JSON from ${source} is malformed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function loadEnvFile() {
  const candidates = [
    new URL("../../apps/web/.env", import.meta.url),
    new URL("../../.env", import.meta.url),
  ];
  const loaded = {};
  for (const candidate of candidates) {
    try {
      const content = fsSync.readFileSync(candidate, "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("="))
          continue;
        const [key, ...valueParts] = trimmed.split("=");
        loaded[key] = valueParts.join("=").replace(/^['"]|['"]$/g, "");
      }
    } catch {
      // ignored: env files are optional for smoke scripts
    }
  }
  return loaded;
}

function findSensitiveKeys(value, path = []) {
  const matches = [];
  if (!value || typeof value !== "object") return matches;
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    if (isSensitiveKey(key)) matches.push(childPath.join("."));
    matches.push(...findSensitiveKeys(child, childPath));
  }
  return matches;
}

function isSensitiveKey(key) {
  return /(api[_-]?key|password|secret|token|credential|access[_-]?key|session[_-]?key|private[_-]?key)/i.test(
    key,
  );
}

function requireValue(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function requireSha256(value, label) {
  const normalized = requireValue(value, label).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`${label} must be a 64-character lowercase hex SHA-256.`);
  }
  return normalized;
}

function first(...values) {
  return (
    values.find((value) => typeof value === "string" && value.trim())?.trim() ??
    null
  );
}
