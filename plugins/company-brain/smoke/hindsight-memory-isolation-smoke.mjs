#!/usr/bin/env node
/**
 * Hindsight user + Space memory isolation smoke (THNK-83 U6).
 *
 * Dry-run is the default. Set SMOKE_ENABLE_HINDSIGHT_MEMORY_ISOLATION=1 to run
 * live against a deployed stage. Live mode writes unique user, Space A, and
 * Space B tokens through ThinkWork GraphQL, then verifies each search path only
 * returns the intended scope. It never calls raw Hindsight endpoints.
 *
 * Live env:
 *   VITE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL or API_GRAPHQL_URL
 *   API_AUTH_SECRET or THINKWORK_API_SECRET
 *   SMOKE_TENANT_ID=<tenant uuid>
 *   SMOKE_USER_ID=<users.id for user-memory capture/search>
 *   SMOKE_SPACE_A_ID=<first authorized space id>
 *   SMOKE_SPACE_B_ID=<second authorized space id>
 *
 * Optional:
 *   SMOKE_UNAUTHORIZED_AUTH_TOKEN=<Cognito bearer for a user outside Space A>
 *   SMOKE_REQUIRE_UNAUTHORIZED_CHECK=1
 *   SMOKE_HINDSIGHT_MEMORY_RUN_ID=<stable smoke token>
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { attachSmokeEvidence } from "../../../scripts/smoke/deployment-evidence.mjs";

const LIVE_ENABLED =
  process.env.SMOKE_ENABLE_HINDSIGHT_MEMORY_ISOLATION === "1";
const REQUIRE_UNAUTHORIZED =
  process.env.SMOKE_REQUIRE_UNAUTHORIZED_CHECK === "1";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 20_000);
const env = { ...loadEnvFile(), ...process.env };

const graphqlUrl = first(
  env.VITE_GRAPHQL_HTTP_URL,
  env.GRAPHQL_HTTP_URL,
  env.API_GRAPHQL_URL,
);
const apiSecret = first(env.API_AUTH_SECRET, env.THINKWORK_API_SECRET);
const tenantId = first(env.SMOKE_TENANT_ID, env.TENANT_ID);
const userId = first(env.SMOKE_USER_ID, env.SMOKE_ADMIN_USER_ID);
const spaceAId = first(env.SMOKE_SPACE_A_ID, env.SMOKE_SPACE_ID);
const spaceBId = first(env.SMOKE_SPACE_B_ID);
const unauthorizedAuthToken = first(env.SMOKE_UNAUTHORIZED_AUTH_TOKEN);
const runId = first(
  env.SMOKE_HINDSIGHT_MEMORY_RUN_ID,
  `tw-hindsight-isolation-${Date.now()}`,
);

const userToken = `${runId}-user-only`;
const spaceAToken = `${runId}-space-a-only`;
const spaceBToken = `${runId}-space-b-only`;
const userMemoryText = `THNK-83 Hindsight isolation user memory ${userToken}: requester-only renewal preference.`;
const spaceAMemoryText = `THNK-83 Hindsight isolation Space A memory ${spaceAToken}: alpha onboarding decision.`;
const spaceBMemoryText = `THNK-83 Hindsight isolation Space B memory ${spaceBToken}: beta onboarding decision.`;
const checks = [];

if (!LIVE_ENABLED) {
  console.log(
    JSON.stringify(
      await attachSmokeEvidence(
        "hindsight-memory-isolation",
        {
          ok: true,
          skippedLive: true,
          reason:
            "set SMOKE_ENABLE_HINDSIGHT_MEMORY_ISOLATION=1 to run the deployed Hindsight user + Space memory isolation smoke",
          dryRun: {
            requiredWhenRunning: [
              "VITE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL or API_GRAPHQL_URL",
              "API_AUTH_SECRET or THINKWORK_API_SECRET",
              "SMOKE_TENANT_ID",
              "SMOKE_USER_ID",
              "SMOKE_SPACE_A_ID",
              "SMOKE_SPACE_B_ID",
            ],
            optionalChecks: [
              "SMOKE_UNAUTHORIZED_AUTH_TOKEN verifies a non-space user is rejected by the deployed auth path",
              "SMOKE_REQUIRE_UNAUTHORIZED_CHECK=1 makes the unauthorized token mandatory",
              "SMOKE_HINDSIGHT_MEMORY_RUN_ID reuses deterministic client capture ids for repeatable evidence",
            ],
            verifies: [
              "memorySystemConfig reports Hindsight-backed user + Space memory enabled",
              "captureMobileMemory writes user memory through ThinkWork GraphQL",
              "memorySearch recalls the user token and not Space A/B tokens",
              "captureSpaceMemory writes isolated Space A and Space B memories",
              "spaceMemorySearch for Space A recalls only the Space A token",
              "spaceMemorySearch for Space B recalls only the Space B token",
              "operator memoryRecords(scope: OPERATOR) search can inspect the same isolation tokens from /settings/memory",
              "an unauthorized Cognito caller cannot search Space A memory when a token is supplied",
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
        "hindsight-memory-isolation",
        {
          ok: failed.length === 0,
          runId,
          userToken,
          spaceAToken,
          spaceBToken,
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
        "hindsight-memory-isolation",
        {
          ok: false,
          runId,
          userToken,
          spaceAToken,
          spaceBToken,
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
  requireEnv("SMOKE_USER_ID", userId);
  requireEnv("SMOKE_SPACE_A_ID", spaceAId);
  requireEnv("SMOKE_SPACE_B_ID", spaceBId);
  if (spaceAId === spaceBId) {
    throw new Error("SMOKE_SPACE_A_ID and SMOKE_SPACE_B_ID must differ");
  }

  const { memorySystemConfig: config } = await gql(
    `query HindsightMemorySystemConfig {
      memorySystemConfig {
        activeEngine
        hindsightEnabled
        userMemoryEnabled
        spaceMemoryEnabled
        cogneeMemoryEnabled
      }
    }`,
    {},
  );
  assert(
    "Hindsight user and Space memory are active",
    config.hindsightEnabled &&
      config.userMemoryEnabled &&
      config.spaceMemoryEnabled,
    { config },
  );

  await captureUserMemory();
  await captureSpaceMemory(spaceAId, spaceAMemoryText, spaceAToken, "space-a");
  await captureSpaceMemory(spaceBId, spaceBMemoryText, spaceBToken, "space-b");

  const userSearch = await searchUserMemory(userToken);
  assertTokenIsolation("user memorySearch", userSearch, {
    expected: [userToken],
    forbidden: [spaceAToken, spaceBToken],
  });

  const spaceASearch = await searchSpaceMemory(spaceAId, spaceAToken);
  assertTokenIsolation("Space A spaceMemorySearch", spaceASearch, {
    expected: [spaceAToken],
    forbidden: [spaceBToken, userToken],
  });

  const spaceBSearch = await searchSpaceMemory(spaceBId, spaceBToken);
  assertTokenIsolation("Space B spaceMemorySearch", spaceBSearch, {
    expected: [spaceBToken],
    forbidden: [spaceAToken, userToken],
  });

  await assertOperatorTableFinds("operator table search finds user token", {
    query: userToken,
    expected: userToken,
  });
  await assertOperatorTableFinds("operator table search finds Space A token", {
    query: spaceAToken,
    expected: spaceAToken,
  });
  await assertOperatorTableFinds("operator table search finds Space B token", {
    query: spaceBToken,
    expected: spaceBToken,
  });

  await verifyUnauthorizedSpaceRead();
}

async function captureUserMemory() {
  const result = await gql(
    `mutation CaptureHindsightUserMemory($tenantId: ID!, $userId: ID!, $content: String!, $metadata: AWSJSON, $clientCaptureId: ID) {
      captureMobileMemory(
        tenantId: $tenantId
        userId: $userId
        content: $content
        metadata: $metadata
        clientCaptureId: $clientCaptureId
      ) {
        id
        content
      }
    }`,
    {
      tenantId,
      userId,
      content: userMemoryText,
      metadata: { smoke: "thnk-83", runId, token: userToken },
      clientCaptureId: `${runId}:user`,
    },
  );
  assert(
    "captureMobileMemory writes user isolation token",
    Boolean(result.captureMobileMemory?.id),
    {
      capture: result.captureMobileMemory,
    },
  );
}

async function captureSpaceMemory(spaceId, content, token, label) {
  const result = await gql(
    `mutation CaptureHindsightSpaceMemory($tenantId: ID!, $spaceId: ID!, $content: String!, $metadata: AWSJSON, $clientCaptureId: ID) {
      captureSpaceMemory(
        tenantId: $tenantId
        spaceId: $spaceId
        content: $content
        metadata: $metadata
        clientCaptureId: $clientCaptureId
      ) {
        memoryRecordId
        content { text }
        namespace
      }
    }`,
    {
      tenantId,
      spaceId,
      content,
      metadata: { smoke: "thnk-83", runId, token, label },
      clientCaptureId: `${runId}:${label}`,
    },
  );
  assert(
    `captureSpaceMemory writes ${label} isolation token`,
    Boolean(result.captureSpaceMemory?.memoryRecordId),
    {
      capture: result.captureSpaceMemory,
    },
  );
}

async function searchUserMemory(query) {
  return await gql(
    `query SearchHindsightUserMemory($tenantId: ID!, $userId: ID!, $query: String!, $limit: Int) {
      memorySearch(tenantId: $tenantId, userId: $userId, query: $query, limit: $limit) {
        totalCount
        records { memoryRecordId content { text } score namespace }
      }
    }`,
    { tenantId, userId, query, limit: 5 },
  );
}

async function searchSpaceMemory(spaceId, query) {
  return await gql(
    `query SearchHindsightSpaceMemory($tenantId: ID!, $spaceId: ID!, $query: String!, $limit: Int) {
      spaceMemorySearch(tenantId: $tenantId, spaceId: $spaceId, query: $query, limit: $limit) {
        totalCount
        records { memoryRecordId content { text } score namespace }
      }
    }`,
    { tenantId, spaceId, query, limit: 5 },
  );
}

async function assertOperatorTableFinds(name, { query, expected }) {
  const result = await gql(
    `query OperatorHindsightMemoryRecords($tenantId: ID!, $query: String!) {
      memoryRecords(
        tenantId: $tenantId
        namespace: "requester"
        scope: OPERATOR
        query: $query
        limit: 25
      ) {
        memoryRecordId
        content { text }
        bankId
        ownerType
        ownerId
        createdAt
        updatedAt
      }
    }`,
    { tenantId, query },
  );
  assert(name, containsToken(result, expected), {
    records: summarize(result.memoryRecords),
  });
}

async function verifyUnauthorizedSpaceRead() {
  if (!unauthorizedAuthToken) {
    const message =
      "set SMOKE_UNAUTHORIZED_AUTH_TOKEN to verify deployed Cognito space authorization";
    if (REQUIRE_UNAUTHORIZED) {
      assert("unauthorized Space A memory search is rejected", false, {
        message,
      });
    } else {
      skip("unauthorized Space A memory search is rejected", message);
    }
    return;
  }

  const response = await gqlRaw(
    `query UnauthorizedSpaceMemory($tenantId: ID!, $spaceId: ID!, $query: String!) {
      spaceMemorySearch(tenantId: $tenantId, spaceId: $spaceId, query: $query) {
        totalCount
      }
    }`,
    { tenantId, spaceId: spaceAId, query: spaceAToken },
    { bearerToken: unauthorizedAuthToken },
  );
  assert(
    "unauthorized Space A memory search is rejected",
    Array.isArray(response.errors) && response.errors.length > 0,
    { errors: response.errors ?? null },
  );
}

function assertTokenIsolation(name, value, { expected, forbidden }) {
  const details = { result: summarize(value), expected, forbidden };
  assert(
    `${name} contains expected token(s)`,
    expected.every((token) => containsToken(value, token)),
    details,
  );
  assert(
    `${name} excludes sibling scope token(s)`,
    forbidden.every((token) => !containsToken(value, token)),
    details,
  );
}

async function gql(query, variables) {
  const body = await gqlRaw(query, variables, { principalId: userId });
  if (body.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);
  }
  return body.data;
}

async function gqlRaw(query, variables, opts = {}) {
  const response = await fetchWithTimeout(graphqlUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${opts.bearerToken ?? apiSecret}`,
      ...(opts.bearerToken
        ? { "x-tenant-id": tenantId }
        : {
            "x-tenant-id": tenantId,
            ...(opts.principalId ? { "x-principal-id": opts.principalId } : {}),
          }),
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await response.text();
  if (!response.ok) {
    if (opts.bearerToken) {
      return {
        errors: [
          {
            message: `GraphQL HTTP ${response.status}`,
            body: text.slice(0, 500),
          },
        ],
      };
    }
    throw new Error(`GraphQL HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text);
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

function containsToken(value, token) {
  return JSON.stringify(value).toLowerCase().includes(token.toLowerCase());
}

function summarize(value) {
  const text = JSON.stringify(value);
  return text.length > 1200 ? `${text.slice(0, 1200)}...` : value;
}

function assert(name, ok, details = {}) {
  checks.push({ name, ok: Boolean(ok), ...details });
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
