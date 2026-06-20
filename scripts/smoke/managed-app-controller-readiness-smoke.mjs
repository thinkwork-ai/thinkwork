#!/usr/bin/env node
/**
 * Smoke test managed-app controller readiness without enabling apps.
 *
 * Dry-run is the default. Set SMOKE_ENABLE_MANAGED_APP_CONTROLLER_READINESS=1
 * to inspect the selected release manifest and customer controller pointers for
 * optional managed apps. This script is read-only: it does not create managed
 * app jobs, start Step Functions, or mutate Terraform state.
 *
 * Optional live env:
 *   AWS_PROFILE=tei
 *   AWS_REGION=us-east-1
 *   SMOKE_STAGE=tei-e2e
 *   SMOKE_DEPLOYMENT_SSM_PREFIX=/thinkwork/tei-e2e/deployment
 *   SMOKE_MANIFEST_URL=https://.../thinkwork-release.json
 *   SMOKE_MANIFEST_SHA256=<sha256>
 *   SMOKE_MANAGED_APP_KEYS=cognee,n8n,twenty,plane
 *   SMOKE_REQUIRE_MANAGED_APP_DEPLOY_READY=1
 *   SMOKE_EVIDENCE_FILE=/tmp/managed-app-controller-readiness.json
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import process from "node:process";
import { attachSmokeEvidence } from "./deployment-evidence.mjs";

const LIVE_ENABLED =
  process.env.SMOKE_ENABLE_MANAGED_APP_CONTROLLER_READINESS === "1";
const REQUIRE_DEPLOY_READY =
  process.env.SMOKE_REQUIRE_MANAGED_APP_DEPLOY_READY === "1";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15_000);

const env = {
  ...loadEnvFile(),
  ...process.env,
};

const DEFAULT_APP_KEYS = ["cognee", "n8n", "twenty", "plane"];

const dryRun = {
  requiredWhenRunning: [
    "AWS credentials/profile with read access to the target customer account or explicit manifest URL/digest",
    "AWS_REGION or AWS_DEFAULT_REGION when reading customer SSM",
    "SMOKE_STAGE or SMOKE_DEPLOYMENT_SSM_PREFIX when manifest URL/digest are not provided",
  ],
  verifies: [
    "Selected release manifest URL and digest resolve from customer SSM or explicit env",
    "Release manifest digest matches the selected/pinned digest",
    "Selected managed-app descriptors exist in the manifest",
    "Descriptor Terraform module source/version match the selected release contract",
    "Required smoke commands exist in this checkout",
    "Required app images are present in runtimeImages when strict deploy-ready mode is enabled",
  ],
  neverDoes: [
    "Start a managed-app plan",
    "Approve or reject a deployment",
    "Start Step Functions or CodeBuild",
    "Run Terraform or mutate AWS state",
  ],
};

if (!LIVE_ENABLED) {
  const result = await attachSmokeEvidence(
    "managed-app-controller-readiness",
    {
      ok: true,
      skippedLive: true,
      reason:
        "set SMOKE_ENABLE_MANAGED_APP_CONTROLLER_READINESS=1 to run the read-only managed-app controller readiness smoke",
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
      `Managed-app readiness evidence contains sensitive field(s): ${leakage.join(", ")}`,
    );
  }
  console.log(
    JSON.stringify(
      await attachSmokeEvidence(
        "managed-app-controller-readiness",
        result,
        env,
      ),
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
  const selected = resolveSelectedRelease();
  const manifestText = await fetchText(selected.manifestUrl);
  const manifestSha256 = sha256Hex(manifestText);
  if (manifestSha256 !== selected.manifestSha256) {
    throw new Error(
      `Release manifest digest mismatch: expected ${selected.manifestSha256}, got ${manifestSha256}`,
    );
  }

  const manifest = parseJson(manifestText, selected.manifestUrl);
  const releaseVersion = normalizeVersion(
    String(manifest.release?.version ?? selected.version ?? ""),
  );
  const selectedVersion = normalizeVersion(selected.version);
  if (selectedVersion && releaseVersion && selectedVersion !== releaseVersion) {
    throw new Error(
      `Selected release ${selected.version} does not match manifest release ${manifest.release?.version}.`,
    );
  }

  const runtimeImages = runtimeImageMap(manifest.runtimeImages);
  const appKeys = managedAppKeys();
  const appResults = appKeys.map((appKey) =>
    assessManagedAppDescriptor({
      appKey,
      manifest,
      runtimeImages,
      selected,
    }),
  );
  const deployReady = appResults.every((app) => app.deployReady);
  const descriptorReady = appResults.every((app) => app.descriptorReady);

  if (REQUIRE_DEPLOY_READY && !deployReady) {
    const gaps = appResults.flatMap((app) =>
      app.gaps.map((gap) => `${app.key}: ${gap}`),
    );
    throw new Error(
      `Managed-app release is not deploy-ready: ${gaps.join("; ")}`,
    );
  }

  return {
    ok: true,
    readOnly: true,
    deployReady,
    descriptorReady,
    strictDeployReadyRequired: REQUIRE_DEPLOY_READY,
    release: {
      selectedVersion: selected.version,
      manifestVersion: manifest.release?.version ?? null,
      manifestUrl: selected.manifestUrl,
      manifestSha256,
      trustPolicy: selected.trustPolicy,
    },
    controller: selected.controller,
    managedApps: appResults,
    sensitiveFields: [],
  };
}

function resolveSelectedRelease() {
  const manifestUrl = first(env.SMOKE_MANIFEST_URL, env.THINKWORK_MANIFEST_URL);
  const manifestSha256 = first(
    env.SMOKE_MANIFEST_SHA256,
    env.THINKWORK_MANIFEST_SHA256,
  );
  if (manifestUrl && manifestSha256) {
    return {
      version: first(env.SMOKE_RELEASE_VERSION, env.THINKWORK_RELEASE_VERSION),
      manifestUrl,
      manifestSha256: requireSha256(manifestSha256, "manifest SHA-256"),
      trustPolicy: first(env.SMOKE_RELEASE_TRUST_POLICY),
      controller: null,
    };
  }

  const ssmPrefix = resolveSsmPrefix();
  const values = getSsmParameters(ssmPrefix, [
    "selected-release-version",
    "selected-release-manifest-url",
    "selected-release-manifest-sha256",
    "selected-release-trust-policy",
  ]);
  const profile = readProfile(ssmPrefix);
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
    trustPolicy: values["selected-release-trust-policy"] ?? null,
    controller: profile.controller,
  };
}

function assessManagedAppDescriptor({
  appKey,
  manifest,
  runtimeImages,
  selected,
}) {
  const app = manifest.managedApps?.find((entry) => entry.id === appKey);
  const gaps = [];
  if (!app) {
    return {
      key: appKey,
      descriptorReady: false,
      deployReady: false,
      gaps: [
        `managedApps entry ${appKey} is missing from the release manifest`,
      ],
    };
  }

  const expectedModuleSuffix = expectedTerraformModuleSuffix(appKey);
  const moduleSource = app.terraformModule?.source ?? null;
  const moduleVersion = app.terraformModule?.version ?? null;
  if (!moduleSource?.endsWith(expectedModuleSuffix)) {
    gaps.push(
      `terraform module source must end with ${expectedModuleSuffix}, got ${moduleSource ?? "none"}`,
    );
  }
  if (
    moduleVersion &&
    selected.version &&
    normalizeVersion(moduleVersion) !== normalizeVersion(selected.version)
  ) {
    gaps.push(
      `terraform module version ${moduleVersion} does not match selected release ${selected.version}`,
    );
  }

  const smokeContracts = Array.isArray(app.smokeContracts)
    ? app.smokeContracts
    : [];
  const missingSmokeContracts = smokeContracts.filter((contract) => {
    return !contract.command || !fs.existsSync(contract.command);
  });
  if (smokeContracts.length === 0) {
    gaps.push("no smokeContracts declared");
  }
  for (const contract of missingSmokeContracts) {
    gaps.push(`smoke command is missing: ${contract.command ?? "none"}`);
  }

  const requiredImages = Array.isArray(app.requiredImages)
    ? app.requiredImages
    : [];
  const missingImages = requiredImages.filter((image) => !runtimeImages[image]);
  const imageUris = Object.fromEntries(
    requiredImages
      .filter((image) => runtimeImages[image])
      .map((image) => [image, runtimeImages[image].uri]),
  );
  for (const image of missingImages) {
    gaps.push(`required image ${image} is not present in runtimeImages`);
  }

  const descriptorReady =
    Boolean(app.displayName) &&
    Boolean(moduleSource) &&
    smokeContracts.length > 0 &&
    missingSmokeContracts.length === 0;
  const deployReady = descriptorReady && missingImages.length === 0;

  return {
    key: appKey,
    displayName: app.displayName ?? null,
    descriptorReady,
    deployReady,
    terraformModule: {
      source: moduleSource,
      version: moduleVersion,
    },
    requiredImages,
    resolvedImages: imageUris,
    smokeContracts: smokeContracts.map((contract) => ({
      id: contract.id,
      command: contract.command,
      required: contract.required === true,
      exists: Boolean(contract.command && fs.existsSync(contract.command)),
    })),
    gaps,
  };
}

function runtimeImageMap(value) {
  if (!Array.isArray(value)) return {};
  return Object.fromEntries(
    value
      .filter((image) => {
        return (
          typeof image?.name === "string" &&
          typeof image?.uri === "string" &&
          /@sha256:[0-9a-f]{64}$/i.test(image.uri)
        );
      })
      .map((image) => [image.name, image]),
  );
}

function managedAppKeys() {
  const raw = first(env.SMOKE_MANAGED_APP_KEYS);
  if (!raw) return DEFAULT_APP_KEYS;
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function expectedTerraformModuleSuffix(appKey) {
  return appKey === "n8n"
    ? "//plugins/n8n/terraform/n8n"
    : `//modules/app/${appKey}`;
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

function readProfile(ssmPrefix) {
  try {
    const profileJson = awsText([
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
    const profile = parseJson(profileJson, `${ssmPrefix}/profile/json`);
    return {
      controller: {
        stateMachineArn: first(profile.controller?.stateMachineArn),
        codebuildProjectName: first(profile.controller?.codebuildProjectName),
        evidenceBucketName: first(profile.controller?.evidenceBucketName),
        ssmPrefix,
      },
    };
  } catch {
    return { controller: null };
  }
}

function getSsmParameters(ssmPrefix, names) {
  const fullNames = names.map((name) => `${ssmPrefix}/${name}`);
  const response = awsText([
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

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} while fetching ${url}: ${body.slice(0, 200)}`,
      );
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function awsText(args) {
  const awsArgs = [...args];
  const profile = first(env.AWS_PROFILE);
  const region = first(env.AWS_REGION, env.AWS_DEFAULT_REGION);
  if (profile) awsArgs.unshift("--profile", profile);
  if (region) awsArgs.unshift("--region", region);
  return execFileSync("aws", awsArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env,
  }).trim();
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
      const content = fs.readFileSync(candidate, "utf8");
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

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeVersion(value) {
  return value.replace(/^v/, "");
}

function first(...values) {
  return (
    values.find((value) => typeof value === "string" && value.trim())?.trim() ??
    null
  );
}
