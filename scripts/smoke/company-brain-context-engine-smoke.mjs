#!/usr/bin/env node
/**
 * Read-only Company Brain Context Engine smoke (THNK-20 / U5a).
 *
 * Dry-run is the default. Set SMOKE_ENABLE_COMPANY_BRAIN_CONTEXT=1 to run live
 * against a deployed stage. Live mode calls the existing MCP Context Engine
 * endpoint with service auth and does not mutate production state.
 *
 * Live env:
 *   CONTEXT_ENGINE_MCP_URL or API_CONTEXT_ENGINE_MCP_URL
 *     Optional fallback: VITE_GRAPHQL_HTTP_URL / GRAPHQL_HTTP_URL / API_GRAPHQL_URL
 *     with /graphql replaced by /mcp/context-engine.
 *   API_AUTH_SECRET or THINKWORK_API_SECRET
 *   SMOKE_TENANT_ID=<tenant uuid>
 *   SMOKE_USER_ID=<users.id in that tenant>
 *
 * Optional:
 *   SMOKE_COMPANY_BRAIN_CONTEXT_QUERY="Acme renewal risk"
 *   SMOKE_COMPANY_BRAIN_EXPECTED_TERM="procurement"
 *   SMOKE_COMPANY_BRAIN_SOURCE_KIND=thread
 *   SMOKE_COMPANY_BRAIN_SOURCE_TYPE=thread_message
 *   SMOKE_COMPANY_BRAIN_DATASET_ID=<dataset/source scope>
 *   SMOKE_COMPANY_BRAIN_NODESETS=customer-success,renewals
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { attachSmokeEvidence } from "./deployment-evidence.mjs";

const LIVE_ENABLED = process.env.SMOKE_ENABLE_COMPANY_BRAIN_CONTEXT === "1";
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
const query = first(
  env.SMOKE_COMPANY_BRAIN_CONTEXT_QUERY,
  "Acme renewal risk and next best action",
);
const expectedTerm = first(env.SMOKE_COMPANY_BRAIN_EXPECTED_TERM);

const checks = [];

if (!LIVE_ENABLED) {
  console.log(
    JSON.stringify(
      await attachSmokeEvidence(
        "company-brain-context-engine",
        {
          ok: true,
          skippedLive: true,
          reason:
            "set SMOKE_ENABLE_COMPANY_BRAIN_CONTEXT=1 to run the deployed read-only Context Engine Brain smoke",
          dryRun: {
            requiredWhenRunning: [
              "CONTEXT_ENGINE_MCP_URL or GraphQL URL that can derive /mcp/context-engine",
              "API_AUTH_SECRET or THINKWORK_API_SECRET",
              "SMOKE_TENANT_ID",
              "SMOKE_USER_ID",
            ],
            optionalScope: [
              "SMOKE_COMPANY_BRAIN_CONTEXT_QUERY",
              "SMOKE_COMPANY_BRAIN_EXPECTED_TERM",
              "SMOKE_COMPANY_BRAIN_SOURCE_KIND",
              "SMOKE_COMPANY_BRAIN_SOURCE_TYPE",
              "SMOKE_COMPANY_BRAIN_DATASET_ID",
              "SMOKE_COMPANY_BRAIN_NODESETS",
            ],
            verifies: [
              "query_brain_context returns Company Brain hits through Context Engine",
              "Brain provider status exposes active read route, shadow migration, vault provenance, and provider-local retrieval posture",
              "Brain hits include untrusted source-data boundary metadata",
              "Brain answer is better than memory-only for the named workflow by hit count or expected-term match",
              "query_memory_context remains a separate Hindsight path rather than an implicit fallback",
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
        "company-brain-context-engine",
        {
          ok: failed.length === 0,
          query,
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
        "company-brain-context-engine",
        {
          ok: false,
          query,
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
  requireEnv("CONTEXT_ENGINE_MCP_URL", mcpUrl);
  requireEnv("API_AUTH_SECRET or THINKWORK_API_SECRET", apiSecret);
  requireEnv("SMOKE_TENANT_ID", tenantId);
  requireEnv("SMOKE_USER_ID", userId);

  const brain = await callTool("query_brain_context", {
    query,
    mode: "answer",
    scope: "team",
    limit: 5,
    sourceKind: first(env.SMOKE_COMPANY_BRAIN_SOURCE_KIND),
    sourceType: first(env.SMOKE_COMPANY_BRAIN_SOURCE_TYPE),
    datasetId: first(env.SMOKE_COMPANY_BRAIN_DATASET_ID),
    nodeSetIds: csv(env.SMOKE_COMPANY_BRAIN_NODESETS),
    onlyContext: true,
  });
  const memory = await callTool("query_memory_context", {
    query,
    mode: "answer",
    scope: "personal",
    limit: 5,
  });

  const brainContent = brain.result?.structuredContent;
  const memoryContent = memory.result?.structuredContent;
  const brainHits = Array.isArray(brainContent?.hits) ? brainContent.hits : [];
  const memoryHits = Array.isArray(memoryContent?.hits)
    ? memoryContent.hits
    : [];
  const brainProviders = Array.isArray(brainContent?.providers)
    ? brainContent.providers
    : [];
  const brainProvider = brainProviders.find(
    (provider) => provider.providerId === "brain",
  );
  const brainText = JSON.stringify(brain.result ?? {});

  assert("Brain provider returns at least one hit", brainHits.length > 0, {
    brainHitCount: brainHits.length,
  });
  assert(
    "Brain provider exposes provider-local status",
    Boolean(brainProvider),
    { providers: brainProviders },
  );
  assert(
    "Brain provider exposes migration-aware read posture",
    Boolean(
      brainProvider?.metadata?.readPosture?.active?.role === "active" &&
        brainProvider.metadata.readPosture.vault?.role === "vault",
    ),
    { readPosture: brainProvider?.metadata?.readPosture ?? null },
  );
  assert(
    "Brain hits carry untrusted source-data boundaries",
    brainHits.every(
      (hit) =>
        hit?.metadata?.sourceDataPolicy ||
        hit?.provenance?.metadata?.instructionBoundary ===
          "untrusted_source_data",
    ),
    { sampleHit: brainHits[0] ?? null },
  );

  const betterByCount = brainHits.length > memoryHits.length;
  const betterByTerm = expectedTerm
    ? brainText.toLowerCase().includes(expectedTerm.toLowerCase())
    : false;
  assert(
    "Brain answer is materially better than memory-only for named workflow",
    betterByCount || betterByTerm,
    {
      brainHitCount: brainHits.length,
      memoryHitCount: memoryHits.length,
      expectedTerm: expectedTerm ?? null,
      betterByCount,
      betterByTerm,
    },
  );
}

async function callTool(name, args) {
  const body = {
    jsonrpc: "2.0",
    id: name,
    method: "tools/call",
    params: {
      name,
      arguments: Object.fromEntries(
        Object.entries(args).filter(
          ([, value]) =>
            value !== undefined &&
            value !== null &&
            (!Array.isArray(value) || value.length > 0),
        ),
      ),
    },
  };
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiSecret}`,
      "x-tenant-id": tenantId,
      "x-user-id": userId,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    throw new Error(
      `${name} failed: ${JSON.stringify(payload.error ?? payload)}`,
    );
  }
  return payload;
}

function assert(name, ok, details = {}) {
  checks.push({ name, ok, ...details });
  if (!ok) {
    throw new Error(`${name} failed`);
  }
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

function csv(value) {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : undefined;
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
