import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const LIVE_ENABLED = process.env.SMOKE_ENABLE_KNOWLEDGE_GRAPH === "1";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 600_000);
const POLL_INTERVAL_MS = Number(process.env.SMOKE_POLL_INTERVAL_MS || 5_000);
const ENTITY_LIMIT = Number(process.env.SMOKE_KG_ENTITY_LIMIT || 25);
const SOURCE_LIMIT = Number(process.env.SMOKE_KG_SOURCE_LIMIT || 8);
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

export async function runSourceSmoke(config) {
  if (!LIVE_ENABLED) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          skippedLive: true,
          reason:
            "set SMOKE_ENABLE_KNOWLEDGE_GRAPH=1 to run deployed source ingest smoke",
          sourceKind: config.sourceKind,
          dryRun: {
            requiredLiveEnv: [
              "VITE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL or API_GRAPHQL_URL",
              "API_AUTH_SECRET or THINKWORK_API_SECRET or VITE_GRAPHQL_API_KEY or GRAPHQL_API_KEY",
              "SMOKE_TENANT_ID, or DATABASE_URL",
            ],
            optionalLiveEnv: config.optionalEnv,
            verifies: [
              "source-aware ingest mutation returns an ingest run",
              "ingest run reaches a terminal state",
              "source-scoped table and graph queries read the normalized ThinkWork snapshot",
              "empty approved output includes Cognee/normalizer diagnostics",
            ],
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!apiUrl || (!apiSecret && !apiKey)) {
    fail("Missing GraphQL HTTP config or API auth secret/key.");
  }

  const scope = resolveSmokeScope(config);
  const source = resolveSourceSelection(config, scope);
  const result = await runLiveSmoke(config, scope, source);
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

async function runLiveSmoke(config, scope, source) {
  const run = await startIngest(config, scope, source);
  const terminalRun = await waitForTerminalRun(
    config.sourceKind,
    scope.tenantId,
    run.sourceRef,
    run.id,
  );

  if (terminalRun.status !== "SUCCEEDED") {
    throw new Error(
      `Knowledge Graph ${config.sourceKind} ingest ${terminalRun.id} ended ${terminalRun.status}: ${terminalRun.error || "no error recorded"}`,
    );
  }

  const entities = await readEntities(config.sourceKind, scope, run);
  const graph = await readGraph(config.sourceKind, scope, run);
  const entityDetail =
    entities.length > 0 ? await readEntityDetail(scope, entities[0].id) : null;
  const diagnostics = summarizeDiagnostics(terminalRun.metrics);
  const allowEmpty = env.SMOKE_KG_ALLOW_EMPTY === "1";

  if (!allowEmpty && entities.length === 0) {
    throw new Error(
      `${config.sourceKind} ingest succeeded but produced no approved ontology entities. Diagnostics: ${JSON.stringify(diagnostics)}`,
    );
  }
  if (entities.length > 0 && !entityDetail) {
    throw new Error("Entity detail query returned null for the first entity.");
  }

  return {
    tenantId: scope.tenantId,
    userId: scope.userId,
    authMode: scope.authMode,
    source,
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
    diagnostics,
  };
}

async function startIngest(config, scope, source) {
  const data = await gql(
    scope,
    `
      mutation SmokeStartKnowledgeGraphIngest(
        $input: StartKnowledgeGraphIngestInput!
      ) {
        startKnowledgeGraphIngest(input: $input) {
          id
          status
          threadId
          sourceKind
          sourceRef
          sourceLabel
          entityCount
          relationshipCount
          evidenceCount
          diagnosticCount
          messageCount
          metrics
          durationMs
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
        sourceKind: config.sourceKind,
        ownerUserId: source.ownerUserId,
        pageIds: source.pageIds,
        force: env.SMOKE_KG_FORCE === "1",
        metadata: JSON.stringify({
          source: config.scriptName,
          selectedSourceIds: source.pageIds,
          requestedAt: new Date().toISOString(),
        }),
      },
    },
  );
  const run = data.startKnowledgeGraphIngest;
  if (!run?.id) throw new Error("startKnowledgeGraphIngest returned no run.");
  return run;
}

async function waitForTerminalRun(sourceKind, tenantId, sourceRef, runId) {
  const started = Date.now();
  let latest = null;
  while (Date.now() - started < TIMEOUT_MS) {
    latest = await readRun(sourceKind, tenantId, sourceRef, runId);
    if (latest && TERMINAL_STATUSES.has(latest.status)) return latest;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Timed out waiting for Knowledge Graph ingest ${runId}. Last observed status: ${latest?.status ?? "unknown"}.`,
  );
}

async function readRun(sourceKind, tenantId, sourceRef, runId) {
  const data = await gql(
    { tenantId },
    `
      query SmokeKnowledgeGraphSourceIngestRuns(
        $tenantId: ID!
        $sourceKind: KnowledgeGraphSourceKind!
        $sourceRef: String!
        $limit: Int
      ) {
        knowledgeGraphIngestRuns(
          tenantId: $tenantId
          sourceKind: $sourceKind
          sourceRef: $sourceRef
          limit: $limit
        ) {
          id
          status
          sourceKind
          sourceRef
          sourceLabel
          cogneeDatasetName
          cogneeDatasetId
          entityCount
          relationshipCount
          evidenceCount
          diagnosticCount
          messageCount
          metrics
          durationMs
          error
          createdAt
          startedAt
          finishedAt
        }
      }
    `,
    { tenantId, sourceKind, sourceRef, limit: 10 },
  );
  const runs = data.knowledgeGraphIngestRuns ?? [];
  return runs.find((run) => run.id === runId) ?? runs[0] ?? null;
}

async function readEntities(sourceKind, scope, run) {
  const data = await gql(
    scope,
    `
      query SmokeKnowledgeGraphSourceEntities(
        $tenantId: ID!
        $sourceKind: KnowledgeGraphSourceKind!
        $sourceRef: String!
        $runId: ID!
        $limit: Int
      ) {
        knowledgeGraphEntities(
          tenantId: $tenantId
          sourceKind: $sourceKind
          sourceRef: $sourceRef
          runId: $runId
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
    {
      tenantId: scope.tenantId,
      sourceKind,
      sourceRef: run.sourceRef,
      runId: run.id,
      limit: ENTITY_LIMIT,
    },
  );
  return data.knowledgeGraphEntities ?? [];
}

async function readGraph(sourceKind, scope, run) {
  const data = await gql(
    scope,
    `
      query SmokeKnowledgeGraphSourceGraph(
        $tenantId: ID!
        $sourceKind: KnowledgeGraphSourceKind!
        $sourceRef: String!
        $runId: ID!
      ) {
        knowledgeGraphGraph(
          tenantId: $tenantId
          sourceKind: $sourceKind
          sourceRef: $sourceRef
          runId: $runId
        ) {
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
    {
      tenantId: scope.tenantId,
      sourceKind,
      sourceRef: run.sourceRef,
      runId: run.id,
    },
  );
  return data.knowledgeGraphGraph ?? { nodes: [], edges: [] };
}

async function readEntityDetail(scope, entityId) {
  const data = await gql(
    scope,
    `
      query SmokeKnowledgeGraphSourceEntity($tenantId: ID!, $entityId: ID!) {
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
            evidenceSourceKind
            evidenceSourceRef
          }
        }
      }
    `,
    { tenantId: scope.tenantId, entityId },
  );
  return data.knowledgeGraphEntity ?? null;
}

async function gql(scope, query, variables) {
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

function resolveSmokeScope(config) {
  const agentId = first(env.SMOKE_KG_AGENT_ID, env.SMOKE_AGENT_ID);
  const wantsImpersonation =
    Boolean(agentId) || env.SMOKE_KG_AUTH_MODE === "impersonation";
  const supplied = {
    tenantId: first(env.SMOKE_TENANT_ID, env.TENANT_ID),
    userId: first(env.SMOKE_USER_ID, env.USER_ID),
  };
  if (supplied.tenantId) {
    return buildScope(supplied.tenantId, supplied.userId ?? null, agentId);
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
  return buildScope(tenantId, userId, agentId);

  function buildScope(tenantId, userId, maybeAgentId) {
    if (!wantsImpersonation) {
      return {
        tenantId,
        userId,
        agentId: null,
        authMode: "service",
      };
    }
    if (!userId || !maybeAgentId) {
      fail(
        `${config.sourceKind} admin-skill impersonation requires SMOKE_TENANT_ID, SMOKE_USER_ID, and SMOKE_KG_AGENT_ID.`,
      );
    }
    return {
      tenantId,
      userId,
      agentId: maybeAgentId,
      authMode: "admin-skill-impersonation",
    };
  }
}

function resolveSourceSelection(config, scope) {
  const explicitPageIds = parseList(env[config.pageIdsEnv]);
  const ownerUserId =
    config.sourceKind === "WIKI"
      ? first(env.SMOKE_KG_WIKI_OWNER_USER_ID, scope.userId)
      : null;
  if (config.sourceKind === "WIKI" && !ownerUserId) {
    fail("Wiki smoke requires SMOKE_KG_WIKI_OWNER_USER_ID or SMOKE_USER_ID.");
  }

  const pageIds =
    explicitPageIds.length > 0 || !databaseUrl
      ? explicitPageIds
      : config.selectPageIds({ tenantId: scope.tenantId, ownerUserId });

  return {
    sourceKind: config.sourceKind,
    ownerUserId,
    pageIds,
    selectionSource: explicitPageIds.length
      ? config.pageIdsEnv
      : databaseUrl
        ? "DATABASE_URL"
        : "recent-source-fallback",
  };
}

export function selectWikiPageIds({ tenantId, ownerUserId }) {
  return psqlRows(`
    select p.id::text
    from wiki.pages p
    where p.tenant_id = ${sqlLiteral(tenantId)}
      and p.owner_id = ${sqlLiteral(ownerUserId)}
      and p.status = 'active'
      and p.entity_subtype is not null
    order by p.hubness_score desc, p.updated_at desc
    limit ${Math.max(1, Math.min(SOURCE_LIMIT, 25))}
  `);
}

export function selectBrainPageIds({ tenantId }) {
  return psqlRows(`
    select p.id::text
    from brain.pages p
    where p.tenant_id = ${sqlLiteral(tenantId)}
      and p.status = 'active'
      and p.entity_subtype is not null
    order by p.hubness_score desc, p.updated_at desc
    limit ${Math.max(1, Math.min(SOURCE_LIMIT, 25))}
  `);
}

function summarizeRun(run) {
  return {
    id: run.id,
    status: run.status,
    sourceKind: run.sourceKind,
    sourceRef: run.sourceRef,
    sourceLabel: run.sourceLabel,
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

function summarizeDiagnostics(value) {
  const metrics = parseJsonRecord(value) ?? {};
  return {
    sourcePacketCount: numberValue(metrics.sourcePacketCount),
    skippedSourceCount: numberValue(metrics.skippedSourceCount),
    cogneeNodeCount: numberValue(metrics.cogneeNodeCount),
    cogneeEdgeCount: numberValue(metrics.cogneeEdgeCount),
    entityCount: numberValue(metrics.entityCount),
    relationshipCount: numberValue(metrics.relationshipCount),
    evidenceCount: numberValue(metrics.evidenceCount),
    droppedNodeCount: numberValue(metrics.droppedNodeCount),
    droppedEdgeCount: numberValue(metrics.droppedEdgeCount),
    droppedNodeSamples: sample(metrics.droppedNodeSamples),
    droppedEdgeSamples: sample(metrics.droppedEdgeSamples),
    sourceDiagnostics: parseJsonRecord(metrics.sourceDiagnostics) ?? null,
  };
}

function parseJsonRecord(value) {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isRecord(value) ? value : null;
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function sample(value) {
  return Array.isArray(value) ? value.slice(0, 5) : [];
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function psqlRows(sql) {
  return psql(sql)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function psql(sql) {
  return execFileSync("psql", [databaseUrl, "-tAc", sql], {
    encoding: "utf8",
  }).trim();
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
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

function parseList(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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
