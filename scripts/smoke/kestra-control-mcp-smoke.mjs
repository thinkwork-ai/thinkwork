#!/usr/bin/env node
/**
 * Smoke test the Kestra managed control MCP endpoint.
 *
 * Dry-run is the default. Set SMOKE_ENABLE_KESTRA_CONTROL_MCP=1 after Kestra is
 * running and the managed MCP row has been installed from the Kestra settings
 * page or deployment reconciliation path.
 *
 * Optional live env:
 *   SMOKE_API_BASE_URL=https://api.example.com
 *   VITE_API_URL=https://api.example.com
 *   SMOKE_KESTRA_MCP_URL=https://api.example.com/mcp/kestra
 *   SMOKE_KESTRA_MCP_BEARER=<Kestra control MCP bearer>
 *   API_AUTH_SECRET or THINKWORK_API_SECRET (accepted by the endpoint as break-glass service auth)
 *   SMOKE_TENANT_ID=<tenant-id>
 *   VITE_GRAPHQL_HTTP_URL, GRAPHQL_HTTP_URL, or API_GRAPHQL_URL
 *   SMOKE_KESTRA_CONTROL_MUTATE=0 to skip the upsert/start/poll mutation proof
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { attachSmokeEvidence } from "./deployment-evidence.mjs";

const LIVE_ENABLED = process.env.SMOKE_ENABLE_KESTRA_CONTROL_MCP === "1";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 30_000);
const POLL_INTERVAL_MS = Number(
  process.env.SMOKE_KESTRA_EXECUTION_POLL_INTERVAL_MS || 2_000,
);

const env = {
  ...loadEnvFile(),
  ...process.env,
};

const apiBaseUrl = first(
  env.SMOKE_API_BASE_URL,
  env.VITE_API_URL,
  env.API_BASE_URL,
  env.API_ENDPOINT,
  env.THINKWORK_API_URL,
);
const mcpUrl = first(
  env.SMOKE_KESTRA_MCP_URL,
  apiBaseUrl ? new URL("/mcp/kestra", apiBaseUrl).toString() : null,
);
const bearer = first(
  env.SMOKE_KESTRA_MCP_BEARER,
  env.API_AUTH_SECRET,
  env.THINKWORK_API_SECRET,
);
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
const tenantId = first(env.SMOKE_TENANT_ID, env.TENANT_ID);
const mutateEnabled = env.SMOKE_KESTRA_CONTROL_MUTATE !== "0";
const namespace = first(env.SMOKE_KESTRA_NAMESPACE, "thinkwork.smoke");
const flowId = first(env.SMOKE_KESTRA_FLOW_ID, "agent_control_smoke");

if (!LIVE_ENABLED) {
  console.log(
    JSON.stringify(
      await attachSmokeEvidence(
        "kestra-control-mcp",
        {
          ok: true,
          skippedLive: true,
          reason:
            "set SMOKE_ENABLE_KESTRA_CONTROL_MCP=1 to run the deployed Kestra control MCP smoke",
          dryRun: {
            requiredWhenRunning: [
              "SMOKE_API_BASE_URL or VITE_API_URL",
              "SMOKE_KESTRA_MCP_BEARER or API_AUTH_SECRET or THINKWORK_API_SECRET",
              "Kestra runtime running and the managed kestra-control MCP row installed",
            ],
            optionalGraphqlEnv: [
              "SMOKE_TENANT_ID",
              "VITE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL or API_GRAPHQL_URL",
              "API_AUTH_SECRET or THINKWORK_API_SECRET or VITE_GRAPHQL_API_KEY or GRAPHQL_API_KEY",
            ],
            optionalMutationControl: [
              "SMOKE_KESTRA_NAMESPACE=thinkwork.smoke",
              "SMOKE_KESTRA_FLOW_ID=agent_control_smoke",
              "SMOKE_KESTRA_CONTROL_MUTATE=0 to skip flow upsert/execution",
            ],
            verifies: [
              "deploymentStatus reports Kestra running and managed MCP installed when GraphQL credentials are available",
              "POST /mcp/kestra initialize succeeds",
              "tools/list exposes curated Kestra tools",
              "kestra_flows_validate accepts a Fargate-safe flow",
              "kestra_flows_validate rejects unsupported Docker/host execution task classes",
              "live mutation mode upserts, starts, polls, and summarizes a safe flow execution",
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
  const result = await runLiveSmoke();
  console.log(
    JSON.stringify(
      await attachSmokeEvidence(
        "kestra-control-mcp",
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
  requireEnv("SMOKE_API_BASE_URL or VITE_API_URL", apiBaseUrl);
  requireEnv(
    "SMOKE_KESTRA_MCP_BEARER or API_AUTH_SECRET or THINKWORK_API_SECRET",
    bearer,
  );

  const graphql = await readGraphqlStatus().catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
  const kestra = graphql?.deploymentStatus?.managedApplications?.find(
    (entry) => entry.key === "kestra",
  );

  if (kestra && !kestra.provisioned) {
    return {
      skippedLive: true,
      reason: "Kestra is not provisioned for this stage.",
      graphql,
    };
  }
  if (kestra && !kestra.runtimeEnabled) {
    return {
      skippedLive: true,
      reason: "Kestra runtime is parked.",
      graphql,
    };
  }
  if (kestra && kestra.managedMcpStatus !== "installed") {
    throw new Error(
      `Kestra managed MCP status must be installed before control smoke; got ${kestra.managedMcpStatus}.`,
    );
  }

  const initialize = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "thinkwork-kestra-smoke", version: "0.1.0" },
  });
  const toolsList = await rpc("tools/list");
  const tools = toolsList.tools ?? [];
  const toolNames = tools.map((tool) => tool.name);
  assertIncludes(toolNames, [
    "kestra_flows_validate",
    "kestra_flows_upsert",
    "kestra_executions_start",
    "kestra_executions_get",
    "kestra_executions_logs",
  ]);

  const safeSource = safeFlowSource();
  const unsafeSource = unsafeFlowSource();
  const safeValidation = await toolCall("kestra_flows_validate", {
    source: safeSource,
  });
  if (safeValidation.isError || !safeValidation.payload?.valid) {
    throw new Error(
      `Safe flow validation failed: ${JSON.stringify(safeValidation.payload)}`,
    );
  }

  const unsafeValidation = await toolCall("kestra_flows_validate", {
    source: unsafeSource,
  });
  if (unsafeValidation.isError || unsafeValidation.payload?.valid !== false) {
    throw new Error(
      `Unsafe flow validation did not reject Docker/host execution classes: ${JSON.stringify(unsafeValidation.payload)}`,
    );
  }

  const mutationProof = mutateEnabled
    ? await runMutationProof(safeSource)
    : {
        skipped: true,
        reason:
          "SMOKE_KESTRA_CONTROL_MUTATE=0 disabled flow upsert and execution start.",
      };

  return {
    graphql,
    mcp: {
      endpoint: mcpUrl,
      serverInfo: initialize.serverInfo,
      toolNames,
    },
    safeValidation: safeValidation.payload,
    unsafeValidation: unsafeValidation.payload,
    mutationProof,
  };
}

async function runMutationProof(source) {
  const upsert = await toolCall("kestra_flows_upsert", { source });
  if (upsert.isError) {
    throw new Error(`Kestra flow upsert failed: ${JSON.stringify(upsert)}`);
  }

  const start = await toolCall("kestra_executions_start", {
    namespace,
    flowId,
  });
  if (start.isError) {
    throw new Error(`Kestra execution start failed: ${JSON.stringify(start)}`);
  }
  const executionId = executionIdFromPayload(start.payload);
  if (!executionId) {
    throw new Error(
      `Kestra execution start did not return an execution id: ${JSON.stringify(start.payload)}`,
    );
  }

  const execution = await pollExecution(executionId);
  const logs = await toolCall("kestra_executions_logs", { executionId }).catch(
    (error) => ({
      isError: true,
      payload: {
        message: error instanceof Error ? error.message : String(error),
      },
    }),
  );

  return {
    skipped: false,
    namespace,
    flowId,
    executionId,
    upsert: upsert.payload,
    execution,
    logsPreview: JSON.stringify(logs.payload ?? {}).slice(0, 1_500),
  };
}

async function pollExecution(executionId) {
  const deadline = Date.now() + TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    const result = await toolCall("kestra_executions_get", { executionId });
    if (result.isError) {
      throw new Error(
        `Kestra execution get failed: ${JSON.stringify(result.payload)}`,
      );
    }
    last = result.payload?.execution ?? result.payload;
    const state = executionState(last);
    if (isTerminalExecutionState(state)) {
      if (state !== "SUCCESS") {
        throw new Error(
          `Kestra execution reached terminal state ${state}: ${JSON.stringify(last).slice(0, 1_500)}`,
        );
      }
      return summarizeExecution(last);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Kestra execution ${executionId} did not finish before ${TIMEOUT_MS}ms; last=${JSON.stringify(last).slice(0, 1_500)}`,
  );
}

async function toolCall(name, args) {
  const result = await rpc("tools/call", {
    name,
    arguments: args,
  });
  const text = result.content?.find?.((item) => item.type === "text")?.text;
  return {
    isError: result.isError === true,
    payload: text ? JSON.parse(text) : result,
  };
}

async function rpc(method, params) {
  const response = await fetchWithTimeout(mcpUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      ...(params === undefined ? {} : { params }),
    }),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`MCP HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  if (body.error) {
    throw new Error(`MCP ${method} error: ${JSON.stringify(body.error)}`);
  }
  return body.result ?? {};
}

async function readGraphqlStatus() {
  if (!apiUrl || (!apiSecret && !apiKey)) return null;
  const data = await gql(`
    query KestraControlMcpSmokeDeploymentStatus {
      deploymentStatus {
        stage
        region
        managedApplications {
          key
          status
          provisioned
          runtimeEnabled
          url
          managedMcpServerId
          managedMcpStatus
          managedMcpInstalled
          managedMcpMessage
        }
      }
    }
  `);
  return data;
}

async function gql(query) {
  const headers = { "content-type": "application/json" };
  if (tenantId) headers["x-tenant-id"] = tenantId;
  if (apiSecret) headers.authorization = `Bearer ${apiSecret}`;
  else headers["x-api-key"] = apiKey;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
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

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function safeFlowSource() {
  return [
    `id: ${flowId}`,
    `namespace: ${namespace}`,
    "",
    "tasks:",
    "  - id: log",
    "    type: io.kestra.plugin.core.log.Log",
    "    message: ThinkWork Kestra managed-app smoke",
    "",
  ].join("\n");
}

function unsafeFlowSource() {
  return [
    `id: ${flowId}_unsafe`,
    `namespace: ${namespace}`,
    "",
    "tasks:",
    "  - id: docker",
    "    type: io.kestra.plugin.docker.Run",
    "    commands:",
    "      - echo unsafe",
    "",
  ].join("\n");
}

function executionIdFromPayload(payload) {
  return (
    payload?.execution?.id ??
    payload?.execution?.executionId ??
    payload?.id ??
    null
  );
}

function executionState(execution) {
  return (
    execution?.state?.current ??
    execution?.state?.type ??
    execution?.status ??
    execution?.state ??
    null
  );
}

function isTerminalExecutionState(state) {
  return [
    "SUCCESS",
    "WARNING",
    "FAILED",
    "KILLED",
    "CANCELLED",
    "CANCELED",
  ].includes(String(state ?? "").toUpperCase());
}

function summarizeExecution(execution) {
  return {
    id: execution?.id ?? null,
    namespace: execution?.namespace ?? namespace,
    flowId: execution?.flowId ?? execution?.flow_id ?? flowId,
    state: executionState(execution),
    startDate: execution?.startDate ?? execution?.start_date ?? null,
    endDate: execution?.endDate ?? execution?.end_date ?? null,
  };
}

function assertIncludes(actual, expected) {
  const missing = expected.filter((entry) => !actual.includes(entry));
  if (missing.length > 0) {
    throw new Error(
      `MCP tools/list missing expected tools: ${missing.join(", ")}`,
    );
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireEnv(label, value) {
  if (!value) {
    throw new Error(`Missing required live smoke env: ${label}`);
  }
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
          const key = line.slice(0, index).trim();
          const value = line
            .slice(index + 1)
            .trim()
            .replace(/^['"]|['"]$/g, "");
          return [key, value];
        }),
    );
  }
  return {};
}

function first(...values) {
  return values.find(
    (value) => value !== undefined && value !== null && value !== "",
  );
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}
