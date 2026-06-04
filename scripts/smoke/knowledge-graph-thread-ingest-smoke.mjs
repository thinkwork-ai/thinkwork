#!/usr/bin/env node
/**
 * Smoke test the Phase II Cognee thread ingest and Explorer GraphQL path.
 *
 * Dry-run is the default so this file is safe to invoke from local checks and
 * CI without mutating a deployed stage. Set SMOKE_ENABLE_KNOWLEDGE_GRAPH=1 to
 * start a real ingest for a supplied or auto-selected thread, poll the run, and
 * verify the normalized table/graph/detail reads that Spaces uses.
 *
 * Live mode requires:
 *   VITE_GRAPHQL_HTTP_URL, GRAPHQL_HTTP_URL, or API_GRAPHQL_URL
 *   API_AUTH_SECRET, THINKWORK_API_SECRET, VITE_GRAPHQL_API_KEY, or GRAPHQL_API_KEY
 *   SMOKE_TENANT_ID, or DATABASE_URL for tenant fallback
 *
 * Optional live mode:
 *   SMOKE_KG_THREAD_ID       exact thread to ingest
 *   SMOKE_KG_THREAD_QUERY    candidate-thread search when thread id omitted
 *   SMOKE_KG_FORCE=1         force a new ingest request
 *   SMOKE_KG_AGENT_ID        use admin-skill impersonation with SMOKE_USER_ID
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const LIVE_ENABLED = process.env.SMOKE_ENABLE_KNOWLEDGE_GRAPH === "1";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 600_000);
const POLL_INTERVAL_MS = Number(process.env.SMOKE_POLL_INTERVAL_MS || 5_000);
const ENTITY_LIMIT = Number(process.env.SMOKE_KG_ENTITY_LIMIT || 25);
const TERMINAL_STATUSES = new Set([
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
  "STALE_NOOP",
]);

const env = {
  ...loadEnvFile(),
  ...process.env,
};

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
const databaseUrl = env.DATABASE_URL;

if (!LIVE_ENABLED) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        skippedLive: true,
        reason:
          "set SMOKE_ENABLE_KNOWLEDGE_GRAPH=1 to run deployed thread ingest smoke",
        dryRun: {
          requiredLiveEnv: [
            "VITE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL or API_GRAPHQL_URL",
            "API_AUTH_SECRET or THINKWORK_API_SECRET or VITE_GRAPHQL_API_KEY or GRAPHQL_API_KEY",
            "SMOKE_TENANT_ID, or DATABASE_URL",
          ],
          optionalLiveEnv: [
            "SMOKE_KG_THREAD_ID",
            "SMOKE_KG_THREAD_QUERY",
            "SMOKE_KG_FORCE=1",
            "SMOKE_KG_AGENT_ID with SMOKE_USER_ID for admin-skill impersonation auth",
          ],
          verifies: [
            "manual ingest mutation returns an ingest run",
            "ingest run reaches a terminal state",
            "entity table and graph queries use the normalized ThinkWork snapshot",
            "entity detail query returns evidence when entities exist",
          ],
        },
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (!apiUrl || (!apiSecret && !apiKey)) {
  fail("Missing GraphQL HTTP config or API auth secret/key.");
}

const scope = resolveSmokeScope(env);

try {
  const result = await runLiveSmoke();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

async function runLiveSmoke() {
  const thread = await resolveThread();
  const run = await startIngest(thread.threadId);
  const terminalRun = await waitForTerminalRun(thread.threadId, run.id);

  if (terminalRun.status !== "SUCCEEDED") {
    throw new Error(
      `Knowledge Graph ingest ${terminalRun.id} ended ${terminalRun.status}: ${terminalRun.error || "no error recorded"}`,
    );
  }

  const entities = await readEntities(thread.threadId);
  const graph = await readGraph(thread.threadId);
  const entityDetail =
    entities.length > 0 ? await readEntityDetail(entities[0].id) : null;
  const emptyGraphDiagnostic =
    graph.nodes.length === 0
      ? {
          message:
            "Ingest succeeded but Cognee returned no normalized graph nodes.",
          runId: terminalRun.id,
          threadId: thread.threadId,
          entityCount: terminalRun.entityCount,
          relationshipCount: terminalRun.relationshipCount,
          evidenceCount: terminalRun.evidenceCount,
        }
      : null;

  if (graph.nodes.length > 0 && entities.length === 0) {
    throw new Error(
      `Graph query returned ${graph.nodes.length} node(s) but entity table returned no rows.`,
    );
  }
  if (entities.length > 0 && !entityDetail) {
    throw new Error("Entity detail query returned null for the first entity.");
  }

  return {
    tenantId: scope.tenantId,
    userId: scope.userId,
    authMode: scope.authMode,
    thread,
    run: summarizeRun(terminalRun),
    tableEntityCount: entities.length,
    graphNodeCount: graph.nodes.length,
    graphEdgeCount: graph.edges.length,
    firstEntity: entityDetail
      ? {
          id: entityDetail.id,
          label: entityDetail.label,
          relationshipCount: entityDetail.relationships.length,
          evidenceCount: entityDetail.evidence.length,
        }
      : null,
    emptyGraphDiagnostic,
  };
}

async function resolveThread() {
  const suppliedThreadId = first(env.SMOKE_KG_THREAD_ID, env.THREAD_ID);
  if (suppliedThreadId) {
    return {
      threadId: suppliedThreadId,
      source: "env",
    };
  }

  const data = await gql(
    `
      query SmokeKnowledgeGraphThreadCandidates(
        $tenantId: ID!
        $query: String
        $limit: Int
      ) {
        knowledgeGraphThreadCandidates(
          tenantId: $tenantId
          query: $query
          limit: $limit
        ) {
          threadId
          title
          number
          messageCount
          lastMessageAt
        }
      }
    `,
    {
      tenantId: scope.tenantId,
      query: first(env.SMOKE_KG_THREAD_QUERY, env.THREAD_QUERY) ?? null,
      limit: 10,
    },
  );
  const candidates = data.knowledgeGraphThreadCandidates ?? [];
  const candidate = candidates.find((row) => row.messageCount > 0);
  if (!candidate) {
    throw new Error(
      "No Knowledge Graph thread candidates with messages found. Set SMOKE_KG_THREAD_ID.",
    );
  }
  return {
    threadId: candidate.threadId,
    source: "candidate",
    title: candidate.title,
    number: candidate.number,
    messageCount: candidate.messageCount,
    lastMessageAt: candidate.lastMessageAt,
  };
}

async function startIngest(threadId) {
  const data = await gql(
    `
      mutation SmokeStartKnowledgeGraphThreadIngest(
        $input: StartKnowledgeGraphThreadIngestInput!
      ) {
        startKnowledgeGraphThreadIngest(input: $input) {
          id
          status
          threadId
          entityCount
          relationshipCount
          evidenceCount
          diagnosticCount
          messageCount
          error
          createdAt
          startedAt
          finishedAt
        }
      }
    `,
    {
      input: {
        tenantId: scope.tenantId,
        threadId,
        force: env.SMOKE_KG_FORCE === "1",
        metadata: JSON.stringify({
          source: "scripts/smoke/knowledge-graph-thread-ingest-smoke.mjs",
          requestedAt: new Date().toISOString(),
        }),
      },
    },
  );
  const run = data.startKnowledgeGraphThreadIngest;
  if (!run?.id)
    throw new Error("startKnowledgeGraphThreadIngest returned no run.");
  return run;
}

async function waitForTerminalRun(threadId, runId) {
  const started = Date.now();
  let latest = null;
  while (Date.now() - started < TIMEOUT_MS) {
    latest = await readRun(threadId, runId);
    if (latest && TERMINAL_STATUSES.has(latest.status)) return latest;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Timed out waiting for Knowledge Graph ingest ${runId}. Last observed status: ${latest?.status ?? "unknown"}.`,
  );
}

async function readRun(threadId, runId) {
  const data = await gql(
    `
      query SmokeKnowledgeGraphIngestRuns(
        $tenantId: ID!
        $threadId: ID!
        $limit: Int
      ) {
        knowledgeGraphIngestRuns(
          tenantId: $tenantId
          threadId: $threadId
          limit: $limit
        ) {
          id
          status
          cogneeDatasetName
          cogneeDatasetId
          entityCount
          relationshipCount
          evidenceCount
          diagnosticCount
          messageCount
          durationMs
          error
          createdAt
          startedAt
          finishedAt
        }
      }
    `,
    { tenantId: scope.tenantId, threadId, limit: 10 },
  );
  const runs = data.knowledgeGraphIngestRuns ?? [];
  return runs.find((run) => run.id === runId) ?? runs[0] ?? null;
}

async function readEntities(threadId) {
  const data = await gql(
    `
      query SmokeKnowledgeGraphEntities(
        $tenantId: ID!
        $threadId: ID!
        $limit: Int
      ) {
        knowledgeGraphEntities(
          tenantId: $tenantId
          threadId: $threadId
          limit: $limit
        ) {
          id
          label
          groundingStatus
          provenanceStatus
          relationshipCount
          evidenceCount
        }
      }
    `,
    { tenantId: scope.tenantId, threadId, limit: ENTITY_LIMIT },
  );
  return data.knowledgeGraphEntities ?? [];
}

async function readGraph(threadId) {
  const data = await gql(
    `
      query SmokeKnowledgeGraphGraph($tenantId: ID!, $threadId: ID!) {
        knowledgeGraphGraph(tenantId: $tenantId, threadId: $threadId) {
          nodes {
            id
            entityId
            label
            groundingStatus
            provenanceStatus
          }
          edges {
            id
            relationshipId
            source
            target
            label
            groundingStatus
            provenanceStatus
          }
        }
      }
    `,
    { tenantId: scope.tenantId, threadId },
  );
  return data.knowledgeGraphGraph ?? { nodes: [], edges: [] };
}

async function readEntityDetail(entityId) {
  const data = await gql(
    `
      query SmokeKnowledgeGraphEntity($tenantId: ID!, $entityId: ID!) {
        knowledgeGraphEntity(tenantId: $tenantId, entityId: $entityId) {
          id
          label
          relationships {
            id
            label
            evidenceCount
          }
          evidence {
            id
            snippet
            messageId
            sourceKind
          }
        }
      }
    `,
    { tenantId: scope.tenantId, entityId },
  );
  return data.knowledgeGraphEntity ?? null;
}

async function gql(query, variables) {
  const headers = {
    "content-type": "application/json",
    "x-tenant-id": scope.tenantId,
  };
  if (scope.authMode === "admin-skill-impersonation") {
    headers["x-principal-id"] = scope.userId;
    headers["x-agent-id"] = scope.agentId;
  }
  if (apiSecret) {
    headers.authorization = `Bearer ${apiSecret}`;
  } else {
    headers["x-api-key"] = apiKey;
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
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

function resolveSmokeScope(source) {
  const agentId = first(source.SMOKE_KG_AGENT_ID, source.SMOKE_AGENT_ID);
  const wantsImpersonation =
    Boolean(agentId) || source.SMOKE_KG_AUTH_MODE === "impersonation";
  const supplied = {
    tenantId: first(source.SMOKE_TENANT_ID, source.TENANT_ID),
    userId: first(source.SMOKE_USER_ID, source.USER_ID),
  };
  if (supplied.tenantId) {
    if (!wantsImpersonation) {
      return {
        tenantId: supplied.tenantId,
        userId: supplied.userId ?? null,
        agentId: null,
        authMode: "service",
      };
    }
    if (!supplied.userId || !agentId) {
      fail(
        "Admin-skill impersonation requires SMOKE_TENANT_ID, SMOKE_USER_ID, and SMOKE_KG_AGENT_ID.",
      );
    }
    return {
      tenantId: supplied.tenantId,
      userId: supplied.userId,
      agentId,
      authMode: "admin-skill-impersonation",
    };
  }

  if (!databaseUrl) {
    fail(
      "Missing tenant scope. Set SMOKE_TENANT_ID, or provide DATABASE_URL for fallback.",
    );
  }

  const row = psql(`
    select tm.tenant_id::text || '|' || tm.principal_id::text
    from tenant_members tm
    where tm.principal_type = 'user'
      and tm.status = 'active'
      and tm.role in ('owner', 'admin')
    order by tm.updated_at desc nulls last, tm.created_at desc
    limit 1
  `);
  const [tenantId, userId] = row.split("|");
  if (!tenantId || !userId) {
    fail("Could not resolve a tenant scope. Set SMOKE_TENANT_ID.");
  }
  if (!wantsImpersonation) {
    return {
      tenantId,
      userId,
      agentId: null,
      authMode: "service",
    };
  }
  if (!agentId) {
    fail("Admin-skill impersonation requires SMOKE_KG_AGENT_ID.");
  }
  return {
    tenantId,
    userId,
    agentId,
    authMode: "admin-skill-impersonation",
  };
}

function summarizeRun(run) {
  return {
    id: run.id,
    status: run.status,
    cogneeDatasetName: run.cogneeDatasetName,
    cogneeDatasetId: run.cogneeDatasetId,
    entityCount: run.entityCount,
    relationshipCount: run.relationshipCount,
    evidenceCount: run.evidenceCount,
    diagnosticCount: run.diagnosticCount,
    messageCount: run.messageCount,
    durationMs: run.durationMs,
    error: run.error,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

function psql(sql) {
  return execFileSync("psql", [databaseUrl, "-tAc", sql], {
    encoding: "utf8",
  }).trim();
}

function loadEnvFile() {
  const configured = process.env.SMOKE_ENV_FILE;
  if (configured === "none") return {};

  const envFile = configured || path.join("apps", "spaces", ".env");
  if (!fs.existsSync(envFile)) return {};

  return Object.fromEntries(
    fs
      .readFileSync(envFile, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        if (index < 0) return [line, ""];
        return [line.slice(0, index), unquote(line.slice(index + 1))];
      }),
  );
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function first(...values) {
  return values.find((value) => typeof value === "string" && value.length > 0);
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}
