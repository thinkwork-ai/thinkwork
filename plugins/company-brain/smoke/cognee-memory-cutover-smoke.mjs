#!/usr/bin/env node
/**
 * Cognee user + space memory cutover smoke (THNK-79 U6).
 *
 * Dry-run is the default. Set SMOKE_ENABLE_COGNEE_MEMORY_CUTOVER=1 to run
 * live against a deployed stage. Live mode writes explicit smoke memories
 * through ThinkWork GraphQL and recalls them through ThinkWork GraphQL plus
 * Context Engine. It never calls raw Cognee endpoints.
 *
 * Live env:
 *   VITE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL or API_GRAPHQL_URL
 *   CONTEXT_ENGINE_MCP_URL or API_CONTEXT_ENGINE_MCP_URL
 *     Optional fallback: GraphQL URL with /graphql replaced by
 *     /mcp/context-engine.
 *   API_AUTH_SECRET or THINKWORK_API_SECRET
 *   SMOKE_TENANT_ID=<tenant uuid>
 *   SMOKE_USER_ID=<users.id for user-memory capture/search>
 *   SMOKE_SPACE_ID=<space id for space-memory capture/search>
 *   SMOKE_SPACE_THREAD_ID=<thread id attached to SMOKE_SPACE_ID>
 *   SMOKE_OTHER_SPACE_THREAD_ID=<thread id in another allowed space>
 *
 * Optional:
 *   SMOKE_AUTHORIZED_MEMBER_USER_ID=<authorized member user id>
 *   SMOKE_UNAUTHORIZED_AUTH_TOKEN=<Cognito bearer for a user outside the space>
 *   SMOKE_REQUIRE_UNAUTHORIZED_CHECK=1
 *   SMOKE_COGNEE_MEMORY_RUN_ID=<stable smoke token>
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { attachSmokeEvidence } from "../../../scripts/smoke/deployment-evidence.mjs";

const LIVE_ENABLED = process.env.SMOKE_ENABLE_COGNEE_MEMORY_CUTOVER === "1";
const REQUIRE_UNAUTHORIZED =
  process.env.SMOKE_REQUIRE_UNAUTHORIZED_CHECK === "1";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 20_000);
const env = { ...loadEnvFile(), ...process.env };

const graphqlUrl = first(
  env.VITE_GRAPHQL_HTTP_URL,
  env.GRAPHQL_HTTP_URL,
  env.API_GRAPHQL_URL,
);
const mcpUrl = first(
  env.CONTEXT_ENGINE_MCP_URL,
  env.API_CONTEXT_ENGINE_MCP_URL,
  deriveMcpUrl(graphqlUrl),
);
const apiSecret = first(env.API_AUTH_SECRET, env.THINKWORK_API_SECRET);
const tenantId = first(env.SMOKE_TENANT_ID, env.TENANT_ID);
const userId = first(env.SMOKE_USER_ID, env.SMOKE_ADMIN_USER_ID);
const authorizedMemberUserId = first(
  env.SMOKE_AUTHORIZED_MEMBER_USER_ID,
  userId,
);
const spaceId = first(env.SMOKE_SPACE_ID);
const spaceThreadId = first(env.SMOKE_SPACE_THREAD_ID);
const otherSpaceThreadId = first(env.SMOKE_OTHER_SPACE_THREAD_ID);
const unauthorizedAuthToken = first(env.SMOKE_UNAUTHORIZED_AUTH_TOKEN);
const runId = first(
  env.SMOKE_COGNEE_MEMORY_RUN_ID,
  `tw-cognee-memory-smoke-${Date.now()}`,
);
const userToken = `${runId}-user`;
const spaceToken = `${runId}-space`;
const userMemoryText = `THNK-79 smoke user memory ${userToken}: requester prefers customer renewal briefs before Monday standup.`;
const spaceMemoryText = `THNK-79 smoke space memory ${spaceToken}: the space decision is to verify Cognee memory through Context Engine before wiki projection.`;

const checks = [];

if (!LIVE_ENABLED) {
  console.log(
    JSON.stringify(
      await attachSmokeEvidence(
        "cognee-memory-cutover",
        {
          ok: true,
          skippedLive: true,
          reason:
            "set SMOKE_ENABLE_COGNEE_MEMORY_CUTOVER=1 to run the deployed Cognee user + space memory cutover smoke",
          dryRun: {
            requiredWhenRunning: [
              "VITE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL or API_GRAPHQL_URL",
              "CONTEXT_ENGINE_MCP_URL or GraphQL URL that can derive /mcp/context-engine",
              "API_AUTH_SECRET or THINKWORK_API_SECRET",
              "SMOKE_TENANT_ID",
              "SMOKE_USER_ID",
              "SMOKE_SPACE_ID",
              "SMOKE_SPACE_THREAD_ID",
              "SMOKE_OTHER_SPACE_THREAD_ID",
            ],
            optionalChecks: [
              "SMOKE_AUTHORIZED_MEMBER_USER_ID verifies another authorized member can recall space memory",
              "SMOKE_UNAUTHORIZED_AUTH_TOKEN verifies a non-space user is rejected by the deployed auth path",
              "SMOKE_REQUIRE_UNAUTHORIZED_CHECK=1 makes the unauthorized token mandatory",
            ],
            verifies: [
              "memorySystemConfig reports Cognee as active user + space memory and Hindsight as non-active legacy",
              "captureMobileMemory writes user memory through the ThinkWork GraphQL API",
              "memorySearch recalls that user memory for the same user",
              "query_memory_context with scope personal recalls user memory from a different Space thread",
              "captureSpaceMemory writes a separate space-owned memory through the ThinkWork GraphQL API",
              "spaceMemorySearch recalls the space memory for an authorized caller",
              "query_memory_context with scope team recalls current-space memory via Context Engine",
              "an unauthorized Cognito caller cannot read the private space memory when a token is supplied",
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
        "cognee-memory-cutover",
        {
          ok: failed.length === 0,
          runId,
          userToken,
          spaceToken,
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
        "cognee-memory-cutover",
        {
          ok: false,
          runId,
          userToken,
          spaceToken,
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
  requireEnv("CONTEXT_ENGINE_MCP_URL", mcpUrl);
  requireEnv("API_AUTH_SECRET or THINKWORK_API_SECRET", apiSecret);
  requireEnv("SMOKE_TENANT_ID", tenantId);
  requireEnv("SMOKE_USER_ID", userId);
  requireEnv("SMOKE_SPACE_ID", spaceId);
  requireEnv("SMOKE_SPACE_THREAD_ID", spaceThreadId);
  requireEnv("SMOKE_OTHER_SPACE_THREAD_ID", otherSpaceThreadId);

  const system = await gql(
    `query CogneeMemorySystemConfig {
      memorySystemConfig {
        activeEngine
        managedMemoryEnabled
        hindsightEnabled
        cogneeMemoryEnabled
        userMemoryEnabled
        spaceMemoryEnabled
        legacyHindsightAvailable
        companyDistillationEnabled
        wikiProjectionEnabled
      }
    }`,
    {},
    userId,
  );
  const config = system.memorySystemConfig;
  assert(
    "Cognee is the active memory engine",
    config.activeEngine === "cognee",
    {
      config,
    },
  );
  assert(
    "Cognee user and space memory are enabled",
    config.cogneeMemoryEnabled &&
      config.userMemoryEnabled &&
      config.spaceMemoryEnabled,
    { config },
  );
  assert(
    "Hindsight is not the active memory engine",
    !config.hindsightEnabled,
    {
      config,
    },
  );
  assert(
    "Company distillation and wiki projection remain deferred",
    !config.companyDistillationEnabled && !config.wikiProjectionEnabled,
    { config },
  );

  const userCapture = await gql(
    `mutation CaptureSmokeUserMemory($tenantId: ID!, $userId: ID!, $content: String!, $metadata: AWSJSON, $clientCaptureId: ID) {
      captureMobileMemory(
        tenantId: $tenantId
        userId: $userId
        content: $content
        metadata: $metadata
        clientCaptureId: $clientCaptureId
      ) {
        id
        content
        syncedAt
      }
    }`,
    {
      tenantId,
      userId,
      content: userMemoryText,
      metadata: { smoke: "thnk-79", runId, token: userToken },
      clientCaptureId: `${runId}:user`,
    },
    userId,
  );
  assert(
    "captureMobileMemory writes a user memory",
    Boolean(userCapture.captureMobileMemory?.id),
    { capture: userCapture.captureMobileMemory },
  );

  const userSearch = await searchUserMemory(userToken, userId);
  assert(
    "memorySearch recalls the captured user memory",
    containsToken(userSearch, userToken),
    { search: summarize(userSearch) },
  );

  const personalContext = await callMemoryContext({
    query: userToken,
    scope: "personal",
    threadId: otherSpaceThreadId,
    userId,
  });
  assert(
    "Context Engine personal memory recalls user memory from another Space thread",
    containsToken(personalContext, userToken),
    { context: summarize(personalContext) },
  );

  const spaceCapture = await gql(
    `mutation CaptureSmokeSpaceMemory($tenantId: ID!, $spaceId: ID!, $content: String!, $metadata: AWSJSON, $clientCaptureId: ID) {
      captureSpaceMemory(
        tenantId: $tenantId
        spaceId: $spaceId
        content: $content
        metadata: $metadata
        clientCaptureId: $clientCaptureId
      ) {
        memoryRecordId
        content { text }
        createdAt
      }
    }`,
    {
      tenantId,
      spaceId,
      content: spaceMemoryText,
      metadata: { smoke: "thnk-79", runId, token: spaceToken },
      clientCaptureId: `${runId}:space`,
    },
    userId,
  );
  assert(
    "captureSpaceMemory writes a space-owned memory",
    Boolean(spaceCapture.captureSpaceMemory?.memoryRecordId),
    { capture: spaceCapture.captureSpaceMemory },
  );

  const spaceSearch = await searchSpaceMemory(
    spaceToken,
    authorizedMemberUserId,
  );
  assert(
    "spaceMemorySearch recalls space memory for an authorized caller",
    containsToken(spaceSearch, spaceToken),
    { search: summarize(spaceSearch), authorizedMemberUserId },
  );

  const teamContext = await callMemoryContext({
    query: spaceToken,
    scope: "team",
    threadId: spaceThreadId,
    userId: authorizedMemberUserId,
  });
  assert(
    "Context Engine team memory recalls current-space memory",
    containsToken(teamContext, spaceToken),
    { context: summarize(teamContext), authorizedMemberUserId },
  );

  await verifyUnauthorizedSpaceRead();
}

async function searchUserMemory(query, principalId) {
  return await gql(
    `query SearchSmokeUserMemory($tenantId: ID!, $userId: ID!, $query: String!, $limit: Int) {
      memorySearch(tenantId: $tenantId, userId: $userId, query: $query, limit: $limit) {
        totalCount
        records {
          memoryRecordId
          content { text }
          score
        }
      }
    }`,
    { tenantId, userId, query, limit: 5 },
    principalId,
  );
}

async function searchSpaceMemory(query, principalId) {
  return await gql(
    `query SearchSmokeSpaceMemory($tenantId: ID!, $spaceId: ID!, $query: String!, $limit: Int) {
      spaceMemorySearch(tenantId: $tenantId, spaceId: $spaceId, query: $query, limit: $limit) {
        totalCount
        records {
          memoryRecordId
          content { text }
          score
        }
      }
    }`,
    { tenantId, spaceId, query, limit: 5 },
    principalId,
  );
}

async function verifyUnauthorizedSpaceRead() {
  if (!unauthorizedAuthToken) {
    const message =
      "set SMOKE_UNAUTHORIZED_AUTH_TOKEN to verify deployed Cognito space authorization";
    if (REQUIRE_UNAUTHORIZED) {
      assert("unauthorized space-memory read is rejected", false, { message });
    } else {
      skip("unauthorized space-memory read is rejected", message);
    }
    return;
  }

  const response = await gqlRaw(
    `query UnauthorizedSpaceMemory($tenantId: ID!, $spaceId: ID!, $query: String!) {
      spaceMemorySearch(tenantId: $tenantId, spaceId: $spaceId, query: $query) {
        totalCount
      }
    }`,
    { tenantId, spaceId, query: spaceToken },
    { bearerToken: unauthorizedAuthToken },
  );
  assert(
    "unauthorized space-memory read is rejected",
    Array.isArray(response.errors) && response.errors.length > 0,
    { errors: response.errors ?? null },
  );
}

async function callMemoryContext({
  query,
  scope,
  threadId,
  userId: callerUserId,
}) {
  const body = {
    jsonrpc: "2.0",
    id: `query_memory_context:${scope}`,
    method: "tools/call",
    params: {
      name: "query_memory_context",
      arguments: {
        query,
        scope,
        mode: "results",
        limit: 5,
        threadId,
      },
    },
  };
  const response = await fetchWithTimeout(mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiSecret}`,
      "x-tenant-id": tenantId,
      "x-user-id": callerUserId,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    throw new Error(
      `query_memory_context ${scope} failed: ${JSON.stringify(
        payload.error ?? payload,
      )}`,
    );
  }
  return payload;
}

async function gql(query, variables, principalId) {
  const body = await gqlRaw(query, variables, { principalId });
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

function deriveMcpUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    parsed.pathname = parsed.pathname.replace(/\/graphql\/?$/, "");
    parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/mcp/context-engine`;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
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
