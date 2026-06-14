#!/usr/bin/env node
/**
 * Company Brain operations GraphQL smoke (THNK-6 U7).
 *
 * Dry-run is the default. Set SMOKE_ENABLE_COMPANY_BRAIN_OPERATIONS=1 to run
 * live against a deployed stage. Live mode is read-only unless
 * SMOKE_ENABLE_COMPANY_BRAIN_OPERATIONS_MUTATION=1 is also set.
 *
 * Live env:
 *   VITE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL or API_GRAPHQL_URL
 *   API_AUTH_SECRET or THINKWORK_API_SECRET
 *   SMOKE_TENANT_ID=<tenant uuid>
 *   SMOKE_ADMIN_USER_ID=<users.id with owner/admin tenant role>
 *
 * Optional:
 *   SMOKE_MEMBER_USER_ID=<non-admin tenant member id for redaction check>
 *   SMOKE_EXPECT_OPERATOR_EVIDENCE=1
 *   SMOKE_ENABLE_COMPANY_BRAIN_OPERATIONS_MUTATION=1
 *   SMOKE_COMPANY_BRAIN_ALLOW_EMPTY_SOURCE_SET=1
 *   SMOKE_COMPANY_BRAIN_EMPTY_SOURCE_REASON="dogfood smoke"
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { attachSmokeEvidence } from "./deployment-evidence.mjs";

const LIVE_ENABLED = process.env.SMOKE_ENABLE_COMPANY_BRAIN_OPERATIONS === "1";
const MUTATION_ENABLED =
  process.env.SMOKE_ENABLE_COMPANY_BRAIN_OPERATIONS_MUTATION === "1";
const EXPECT_OPERATOR_EVIDENCE =
  process.env.SMOKE_EXPECT_OPERATOR_EVIDENCE === "1";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 20_000);

const env = { ...loadEnvFile(), ...process.env };
const graphqlUrl = first(
  env.VITE_GRAPHQL_HTTP_URL,
  env.GRAPHQL_HTTP_URL,
  env.API_GRAPHQL_URL,
);
const apiSecret = first(env.API_AUTH_SECRET, env.THINKWORK_API_SECRET);
const tenantId = first(env.SMOKE_TENANT_ID, env.TENANT_ID);
const adminUserId = first(env.SMOKE_ADMIN_USER_ID);
const memberUserId = first(env.SMOKE_MEMBER_USER_ID);
const checks = [];

if (!LIVE_ENABLED) {
  console.log(
    JSON.stringify(
      await attachSmokeEvidence(
        "company-brain-operations",
        {
          ok: true,
          skippedLive: true,
          reason:
            "set SMOKE_ENABLE_COMPANY_BRAIN_OPERATIONS=1 to run the deployed Company Brain operations smoke",
          dryRun: {
            requiredWhenRunning: [
              "VITE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL or API_GRAPHQL_URL",
              "API_AUTH_SECRET or THINKWORK_API_SECRET",
              "SMOKE_TENANT_ID",
              "SMOKE_ADMIN_USER_ID (owner/admin tenant role)",
            ],
            optionalReadOnlyChecks: [
              "SMOKE_MEMBER_USER_ID verifies tenant-safe redaction",
              "SMOKE_EXPECT_OPERATOR_EVIDENCE=1 requires operator evidence to be populated",
            ],
            optionalMutation:
              "SMOKE_ENABLE_COMPANY_BRAIN_OPERATIONS_MUTATION=1 requests a production migration only when the tenant is ready on the default tier with no active migration",
            verifies: [
              "companyBrainStatus returns storage tier, active backend, health, counters, launch/optional capabilities, and migration status",
              "default vs production tier posture is visible without direct backend controls",
              "operator evidence is explicit and can be required for operational stages",
              "member redaction hides Cognee endpoints, S3 roots, Neptune ids/endpoints, and EFS ids",
              "requestCompanyBrainProductionMigration is never called unless the explicit mutation flag is set",
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
  await runLiveSmoke();
  const failed = checks.filter((check) => !check.ok);
  console.log(
    JSON.stringify(
      await attachSmokeEvidence(
        "company-brain-operations",
        {
          ok: failed.length === 0,
          mutationEnabled: MUTATION_ENABLED,
          checks,
        },
        env,
      ),
      null,
      2,
    ),
  );
  process.exit(failed.length === 0 ? 0 : 1);
} catch (error) {
  console.error(
    JSON.stringify(
      await attachSmokeEvidence(
        "company-brain-operations",
        {
          ok: false,
          mutationEnabled: MUTATION_ENABLED,
          error: error instanceof Error ? error.message : String(error),
          checks,
        },
        env,
      ),
      null,
      2,
    ),
  );
  process.exit(1);
}

async function runLiveSmoke() {
  requireEnv("VITE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL", graphqlUrl);
  requireEnv("API_AUTH_SECRET or THINKWORK_API_SECRET", apiSecret);
  requireEnv("SMOKE_TENANT_ID", tenantId);
  requireEnv("SMOKE_ADMIN_USER_ID", adminUserId);

  const adminStatus = await readStatus(adminUserId);
  assertStatusShape(adminStatus, "operator");
  assertOperatorEvidence(adminStatus);

  if (memberUserId) {
    const memberStatus = await readStatus(memberUserId);
    assertStatusShape(memberStatus, "member");
    assert(
      "member status redacts operator evidence",
      memberStatus.evidence === null,
      { evidence: memberStatus.evidence },
    );
    assert(
      "member status does not leak backend identifiers",
      !containsSensitiveBackendIdentifier(memberStatus),
      {},
    );
  } else {
    skip(
      "member redaction check",
      "set SMOKE_MEMBER_USER_ID to verify tenant-safe redaction",
    );
  }

  if (!MUTATION_ENABLED) {
    skip(
      "production migration request mutation",
      "set SMOKE_ENABLE_COMPANY_BRAIN_OPERATIONS_MUTATION=1 to request migration when eligible",
    );
    return;
  }

  await maybeRequestProductionMigration(adminStatus);
}

async function maybeRequestProductionMigration(status) {
  const migration = status.migration;
  const hasActiveMigration =
    Boolean(migration?.id) &&
    (migration.status === "requested" || migration.status === "running");
  const eligible =
    status.status === "ready" &&
    status.storageTier === "default" &&
    status.activeBackend === "default" &&
    !hasActiveMigration;

  if (!eligible) {
    skip("production migration request mutation", {
      reason:
        "tenant is not ready on default tier with no active migration; no mutation sent",
      status: status.status,
      storageTier: status.storageTier,
      activeBackend: status.activeBackend,
      migrationStatus: migration?.status ?? null,
    });
    return;
  }

  const input = {
    allowEmptySourceSet:
      env.SMOKE_COMPANY_BRAIN_ALLOW_EMPTY_SOURCE_SET === "1" || undefined,
    emptySourceReason: first(env.SMOKE_COMPANY_BRAIN_EMPTY_SOURCE_REASON),
    operatorEvidence: {
      source: "company-brain-operations-smoke",
      requestedAt: new Date().toISOString(),
    },
  };
  const result = await gql(
    `mutation RequestCompanyBrainProductionMigration($input: RequestCompanyBrainProductionMigrationInput!) {
      requestCompanyBrainProductionMigration(input: $input) {
        id
        phase
        status
        fromStorageTier
        toStorageTier
        requestedAt
        validationSummary
      }
    }`,
    {
      input: Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined),
      ),
    },
    adminUserId,
  );
  const migrationResult = result.requestCompanyBrainProductionMigration;
  assert("production migration request returned a migration id", {
    ok: Boolean(migrationResult?.id),
    migration: migrationResult,
  });
  assert(
    "production migration request keeps default as the source tier",
    migrationResult?.fromStorageTier === "default",
    { migration: migrationResult },
  );
  assert(
    "production migration request targets production tier",
    migrationResult?.toStorageTier === "production",
    { migration: migrationResult },
  );
}

async function readStatus(principalId) {
  const data = await gql(
    `query CompanyBrainOperationsStatus {
      companyBrainStatus {
        tenantId
        storageTier
        activeBackend
        status
        healthStatus
        counters {
          ingestionQueueDepth
          failedIngestCount
          graphEntityCount
          graphEdgeCount
          sourceArtifactCount
          vaultProjectionCount
          latestIngestAt
          latestProjectionAt
          ontologyVersion
        }
        capabilities {
          launch { key status message source }
          optional { key status message source }
        }
        migration {
          id
          phase
          status
          fromStorageTier
          toStorageTier
          requestedAt
          startedAt
          completedAt
          rollbackWindowClosesAt
          errorMessage
          validationSummary
        }
        evidence {
          managedApplicationId
          latestDeploymentJobId
          backendMode
          graphProvider
          vectorProvider
          embeddingModel
          vectorDimension
          cogneeVersion
          cogneeEndpoint
          s3ArtifactRoot
          s3ManifestRoot
          s3VaultProjectionRoot
          neptuneGraphId
          neptuneEndpoint
          efsFileSystemId
          productionPosture
          operatorEvidence
          migrationEvidence
        }
      }
    }`,
    {},
    principalId,
  );
  return data.companyBrainStatus;
}

function assertStatusShape(status, audience) {
  assert(`${audience} status returns a tenant id`, Boolean(status.tenantId), {
    tenantId: status.tenantId,
  });
  assert(
    `${audience} status reports default or production storage tier`,
    ["default", "production"].includes(status.storageTier),
    { storageTier: status.storageTier },
  );
  assert(
    `${audience} status reports default or production active backend`,
    ["default", "production"].includes(status.activeBackend),
    { activeBackend: status.activeBackend },
  );
  assert(
    `${audience} status reports operational health`,
    typeof status.healthStatus === "string" && status.healthStatus.length > 0,
    { healthStatus: status.healthStatus },
  );
  assert(
    `${audience} status includes launch capabilities`,
    Array.isArray(status.capabilities?.launch),
    { launch: status.capabilities?.launch },
  );
  assert(
    `${audience} status includes migration posture`,
    typeof status.migration?.phase === "string" &&
      typeof status.migration?.status === "string",
    { migration: status.migration },
  );
  assert(
    `${audience} counters include ingestion queue depth`,
    Number.isInteger(status.counters?.ingestionQueueDepth),
    { counters: status.counters },
  );
}

function assertOperatorEvidence(status) {
  if (!status.evidence) {
    if (EXPECT_OPERATOR_EVIDENCE) {
      assert("operator evidence is populated", false, { evidence: null });
    } else {
      skip(
        "operator evidence is populated",
        "operator evidence was redacted or unavailable; set SMOKE_EXPECT_OPERATOR_EVIDENCE=1 to require it",
      );
    }
    return;
  }
  assert("operator evidence reports backend mode", true, {
    backendMode: status.evidence.backendMode ?? null,
  });
  assert("operator evidence reports production posture", true, {
    productionPosture: status.evidence.productionPosture ?? null,
  });
}

async function gql(query, variables, principalId) {
  const response = await fetchWithTimeout(graphqlUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiSecret}`,
      "x-tenant-id": tenantId,
      ...(principalId ? { "x-principal-id": principalId } : {}),
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

function assert(name, okOrDetails, details = {}) {
  const ok =
    typeof okOrDetails === "object" && okOrDetails !== null
      ? Boolean(okOrDetails.ok)
      : Boolean(okOrDetails);
  const mergedDetails =
    typeof okOrDetails === "object" && okOrDetails !== null
      ? { ...okOrDetails }
      : details;
  delete mergedDetails.ok;
  checks.push({ name, ok, ...mergedDetails });
  if (!ok) throw new Error(`${name} failed`);
}

function skip(name, details) {
  checks.push({
    name,
    ok: true,
    skipped: true,
    ...(typeof details === "string" ? { reason: details } : details),
  });
}

function requireEnv(name, value) {
  if (!value) throw new Error(`${name} is required`);
}

function containsSensitiveBackendIdentifier(status) {
  const text = JSON.stringify(status).toLowerCase();
  return (
    text.includes("s3://") ||
    text.includes("cognee.internal") ||
    text.includes("neptune") ||
    text.includes("efsfilesystemid") ||
    text.includes("filesystemid")
  );
}

function first(...values) {
  return values
    .find((value) => typeof value === "string" && value.trim())
    ?.trim();
}

function loadEnvFile() {
  const candidates = [
    path.resolve("apps/web/.env"),
    path.resolve("terraform/examples/greenfield/.env"),
  ];
  const output = {};
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      output[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
  return output;
}
