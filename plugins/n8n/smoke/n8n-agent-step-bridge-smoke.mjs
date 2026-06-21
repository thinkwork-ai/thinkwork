#!/usr/bin/env node
/**
 * n8n agent-step bridge smoke.
 *
 * Dry-run is the default. Set SMOKE_ENABLE_N8N_AGENT_STEP_BRIDGE=1 after the
 * n8n plugin, native n8n MCP endpoint, and ThinkWork bridge endpoint are
 * deployed for a tenant.
 *
 * The safest live path is to provide a disposable workflow trigger URL for a
 * workflow that uses stock HTTP Request + Wait nodes to call ThinkWork:
 *   SMOKE_ENABLE_N8N_AGENT_STEP_BRIDGE=1
 *   SMOKE_N8N_MCP_URL=https://n8n.example.com/mcp-server/http
 *   SMOKE_N8N_MCP_SERVICE_TOKEN=<n8n MCP service credential>
 *   SMOKE_N8N_BRIDGE_TRIGGER_URL=<disposable n8n webhook URL>
 *   SMOKE_N8N_BRIDGE_CORRELATION_ID=<unique smoke correlation id>
 *   SMOKE_GRAPHQL_HTTP_URL=<ThinkWork GraphQL URL>
 *   SMOKE_TENANT_ID=<tenant id>
 *   API_AUTH_SECRET=<internal API secret> or GRAPHQL_API_KEY=<GraphQL API key>
 *
 * Optional workflow import:
 *   SMOKE_N8N_BRIDGE_WORKFLOW_FILE=plugins/n8n/smoke/example-workflow.json
 *   SMOKE_N8N_BRIDGE_CREATE_TOOL=create_workflow_from_code
 *   SMOKE_N8N_BRIDGE_CREATE_ARGS='{"code":"..."}'
 *
 * Optional execution inspection:
 *   SMOKE_N8N_BRIDGE_EXECUTION_ID=<n8n execution id>
 *   SMOKE_N8N_BRIDGE_GET_EXECUTION_TOOL=get_execution
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { attachSmokeEvidence } from "../../../scripts/smoke/deployment-evidence.mjs";

const LIVE_ENABLED = process.env.SMOKE_ENABLE_N8N_AGENT_STEP_BRIDGE === "1";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 20_000);
const POLL_TIMEOUT_MS = Number(
  process.env.SMOKE_N8N_BRIDGE_POLL_TIMEOUT_MS || 180_000,
);
const POLL_INTERVAL_MS = Number(
  process.env.SMOKE_N8N_BRIDGE_POLL_INTERVAL_MS || 5_000,
);
const MCP_PROTOCOL_VERSION = "2025-03-26";

const env = {
  ...loadEnvFile(),
  ...process.env,
};

const n8nUrl = first(env.SMOKE_N8N_URL);
const mcpUrl = first(
  env.SMOKE_N8N_MCP_URL,
  n8nUrl ? new URL("/mcp-server/http", n8nUrl).toString() : undefined,
);
const mcpToken = first(
  env.SMOKE_N8N_MCP_SERVICE_TOKEN,
  env.N8N_MCP_SERVICE_CREDENTIAL,
);
const triggerUrl = first(env.SMOKE_N8N_BRIDGE_TRIGGER_URL);
const triggerMethod = first(env.SMOKE_N8N_BRIDGE_TRIGGER_METHOD, "POST");
const triggerHeaders = parseJsonEnv(
  "SMOKE_N8N_BRIDGE_TRIGGER_HEADERS",
  env.SMOKE_N8N_BRIDGE_TRIGGER_HEADERS,
  {},
);
const smokeId = first(
  env.SMOKE_N8N_BRIDGE_SMOKE_ID,
  `n8n-bridge-smoke-${Date.now()}`,
);
const correlationId = first(env.SMOKE_N8N_BRIDGE_CORRELATION_ID, smokeId);
const workflowId = first(env.SMOKE_N8N_BRIDGE_WORKFLOW_ID);
const workflowName = first(
  env.SMOKE_N8N_BRIDGE_WORKFLOW_NAME,
  `ThinkWork bridge smoke ${smokeId}`,
);
const workflowFile = first(env.SMOKE_N8N_BRIDGE_WORKFLOW_FILE);
const createWorkflowTool = first(
  env.SMOKE_N8N_BRIDGE_CREATE_TOOL,
  "create_workflow_from_code",
);
const validateWorkflowTool = first(
  env.SMOKE_N8N_BRIDGE_VALIDATE_TOOL,
  "validate_workflow",
);
const executeWorkflowTool = first(
  env.SMOKE_N8N_BRIDGE_EXECUTE_TOOL,
  "execute_workflow",
);
const getExecutionTool = first(
  env.SMOKE_N8N_BRIDGE_GET_EXECUTION_TOOL,
  "get_execution",
);
const archiveWorkflowTool = first(
  env.SMOKE_N8N_BRIDGE_ARCHIVE_TOOL,
  "archive_workflow",
);
const executionId = first(env.SMOKE_N8N_BRIDGE_EXECUTION_ID);
const shouldArchiveWorkflow = env.SMOKE_N8N_BRIDGE_ARCHIVE_CREATED === "1";
const requireTelemetry = env.SMOKE_N8N_BRIDGE_REQUIRE_TELEMETRY !== "0";
const graphQlUrl = first(
  env.SMOKE_GRAPHQL_HTTP_URL,
  env.VITE_GRAPHQL_HTTP_URL,
  env.GRAPHQL_HTTP_URL,
  env.API_GRAPHQL_URL,
);
const tenantId = first(env.SMOKE_TENANT_ID, env.TENANT_ID);
const apiSecret = first(env.API_AUTH_SECRET, env.THINKWORK_API_SECRET);
const apiKey = first(
  env.VITE_GRAPHQL_API_KEY,
  env.APPSYNC_API_KEY,
  env.GRAPHQL_API_KEY,
);

const checks = [];

if (!LIVE_ENABLED) {
  console.log(
    JSON.stringify(
      await attachSmokeEvidence(
        "n8n-agent-step-bridge",
        {
          ok: true,
          skippedLive: true,
          reason:
            "set SMOKE_ENABLE_N8N_AGENT_STEP_BRIDGE=1 to run the deployed n8n agent-step bridge smoke",
          dryRun: {
            requiredWhenRunning: [
              "n8n plugin installed and deployed through ThinkWork Settings -> Plugins",
              "native n8n MCP endpoint reachable with the tenant service credential",
              "a disposable n8n workflow trigger URL, or workflow import/execute MCP tool args",
              "workflow uses stock HTTP Request plus Wait nodes and passes $execution.resumeUrl to ThinkWork",
              "ThinkWork GraphQL telemetry access for the target tenant",
            ],
            optionalWorkflowImportEnv: [
              "SMOKE_N8N_BRIDGE_WORKFLOW_FILE",
              "SMOKE_N8N_BRIDGE_CREATE_TOOL",
              "SMOKE_N8N_BRIDGE_CREATE_ARGS",
              "SMOKE_N8N_BRIDGE_VALIDATE_ARGS",
            ],
            liveEnv: [
              "SMOKE_N8N_MCP_URL or SMOKE_N8N_URL",
              "SMOKE_N8N_MCP_SERVICE_TOKEN",
              "SMOKE_N8N_BRIDGE_TRIGGER_URL or SMOKE_N8N_BRIDGE_EXECUTE_ARGS",
              "SMOKE_N8N_BRIDGE_CORRELATION_ID",
              "SMOKE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL",
              "SMOKE_TENANT_ID",
              "API_AUTH_SECRET/THINKWORK_API_SECRET or GraphQL API key",
            ],
            verifies: [
              "n8n MCP exposes workflow create/validate/execute/read helpers",
              "disposable workflow is imported or an existing workflow is addressed",
              "workflow start accepts a unique correlation id",
              "ThinkWork records a bridge run with thread id and n8n workflow/execution evidence",
              "ThinkWork reaches a terminal resumed status and n8n execution evidence is inspectable when configured",
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
  const failed = checks.filter((check) => !check.ok);
  const payload = {
    ok: failed.length === 0,
    checks,
    ...result,
  };
  console.log(
    JSON.stringify(
      await attachSmokeEvidence("n8n-agent-step-bridge", payload, env),
      null,
      2,
    ),
  );
  process.exit(failed.length === 0 ? 0 : 1);
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        checks,
      },
      null,
    ),
  );
  process.exit(1);
}

async function runLiveSmoke() {
  requireEnv("SMOKE_N8N_MCP_URL or SMOKE_N8N_URL", mcpUrl);
  requireEnv("SMOKE_N8N_MCP_SERVICE_TOKEN", mcpToken);

  const client = makeDirectMcpClient();
  const tools = await client.listTools();
  const toolNames = new Set(tools.map(toolName).filter(Boolean));
  assertBridgeTools(toolNames);

  let createdWorkflow = null;
  if (!workflowId && workflowFile) {
    createdWorkflow = await createWorkflow(client, toolNames);
  } else if (workflowId) {
    pass("workflow selected", { workflowId, workflowName });
  } else {
    skip(
      "workflow import",
      "SMOKE_N8N_BRIDGE_WORKFLOW_ID and SMOKE_N8N_BRIDGE_WORKFLOW_FILE are unset; assuming SMOKE_N8N_BRIDGE_TRIGGER_URL targets a disposable workflow",
    );
  }

  const targetWorkflowId = workflowId ?? extractWorkflowId(createdWorkflow);
  if (targetWorkflowId && toolNames.has(validateWorkflowTool)) {
    await validateWorkflow(client, targetWorkflowId);
  } else {
    skip(
      "workflow validation",
      "no workflow id resolved or validate_workflow tool unavailable",
    );
  }

  const start = await startWorkflow(client, toolNames, targetWorkflowId);
  const telemetry = await waitForBridgeTelemetry({
    targetWorkflowId,
    triggerResult: start,
  });
  const execution = await inspectExecution(client, toolNames, {
    telemetry,
    triggerResult: start,
  });

  if (
    createdWorkflow &&
    shouldArchiveWorkflow &&
    toolNames.has(archiveWorkflowTool)
  ) {
    await archiveWorkflow(client, extractWorkflowId(createdWorkflow));
  } else if (createdWorkflow) {
    skip(
      "archive imported workflow",
      "SMOKE_N8N_BRIDGE_ARCHIVE_CREATED=1 not set or archive tool unavailable; leave workflow disabled/disposable",
    );
  }

  return {
    smokeId,
    correlationId,
    workflowId: targetWorkflowId ?? workflowId ?? null,
    workflowName,
    trigger: previewObject(start),
    bridgeRun: telemetry,
    n8nExecution: execution,
  };
}

function assertBridgeTools(toolNames) {
  const available = [...toolNames].sort();
  const hasCreate = toolNames.has(createWorkflowTool);
  const hasExecute = toolNames.has(executeWorkflowTool);
  const hasGetExecution = toolNames.has(getExecutionTool);
  const hasValidate = toolNames.has(validateWorkflowTool);
  const hasWorkflowNamedTool = available.some((name) => /workflow/i.test(name));

  if (
    !hasWorkflowNamedTool &&
    !hasCreate &&
    !hasExecute &&
    !hasGetExecution &&
    !hasValidate
  ) {
    failCheck("n8n MCP exposes workflow tools", { available });
    return;
  }
  pass("n8n MCP exposes workflow tools", {
    createWorkflowTool: hasCreate,
    executeWorkflowTool: hasExecute,
    getExecutionTool: hasGetExecution,
    validateWorkflowTool: hasValidate,
    available: available.slice(0, 80),
  });
}

async function createWorkflow(client, toolNames) {
  if (!toolNames.has(createWorkflowTool)) {
    throw new Error(
      `MCP tool ${createWorkflowTool} is unavailable; set SMOKE_N8N_BRIDGE_WORKFLOW_ID or SMOKE_N8N_BRIDGE_CREATE_TOOL`,
    );
  }
  const args = parseJsonEnv(
    "SMOKE_N8N_BRIDGE_CREATE_ARGS",
    env.SMOKE_N8N_BRIDGE_CREATE_ARGS,
    defaultCreateArgsFromFile(workflowFile),
  );
  const result = await client.call(createWorkflowTool, args);
  pass("workflow imported", {
    tool: createWorkflowTool,
    workflowId: extractWorkflowId(result),
    preview: preview(result),
  });
  return result;
}

function defaultCreateArgsFromFile(file) {
  const raw = fs.readFileSync(path.resolve(file), "utf8");
  return {
    code: raw,
    name: workflowName,
    description:
      "Disposable ThinkWork n8n agent-step bridge smoke workflow. Keep disabled unless actively testing.",
  };
}

async function validateWorkflow(client, targetWorkflowId) {
  const args = parseJsonEnv(
    "SMOKE_N8N_BRIDGE_VALIDATE_ARGS",
    env.SMOKE_N8N_BRIDGE_VALIDATE_ARGS,
    { id: targetWorkflowId },
  );
  const result = await client.call(validateWorkflowTool, args);
  pass("workflow validation", {
    tool: validateWorkflowTool,
    workflowId: targetWorkflowId,
    preview: preview(result),
  });
}

async function startWorkflow(client, toolNames, targetWorkflowId) {
  if (triggerUrl) {
    const body = parseJsonEnv(
      "SMOKE_N8N_BRIDGE_TRIGGER_BODY",
      env.SMOKE_N8N_BRIDGE_TRIGGER_BODY,
      {
        smokeId,
        correlationId,
        requestedAt: new Date().toISOString(),
        classificationInput: "Classify this as an n8n ThinkWork bridge smoke.",
      },
    );
    const response = await fetchWithTimeout(triggerUrl, {
      method: triggerMethod,
      headers: {
        accept: "application/json, text/plain, */*",
        "content-type": "application/json",
        ...triggerHeaders,
      },
      body:
        triggerMethod.toUpperCase() === "GET"
          ? undefined
          : JSON.stringify(body),
    });
    const text = await response.text();
    const result = {
      mode: "webhook",
      url: redactUrl(triggerUrl),
      statusCode: response.status,
      ok: response.ok,
      bodyPreview: text.slice(0, 1_500),
    };
    if (!response.ok) {
      failCheck("workflow trigger", result);
      throw new Error(`n8n workflow trigger failed: HTTP ${response.status}`);
    }
    pass("workflow trigger", result);
    return result;
  }

  if (!toolNames.has(executeWorkflowTool)) {
    throw new Error(
      `Set SMOKE_N8N_BRIDGE_TRIGGER_URL or provide MCP tool ${executeWorkflowTool}`,
    );
  }
  const args = parseJsonEnv(
    "SMOKE_N8N_BRIDGE_EXECUTE_ARGS",
    env.SMOKE_N8N_BRIDGE_EXECUTE_ARGS,
    targetWorkflowId
      ? { id: targetWorkflowId, input: { smokeId, correlationId } }
      : null,
  );
  if (!args) {
    throw new Error(
      "SMOKE_N8N_BRIDGE_EXECUTE_ARGS is required when no trigger URL or workflow id is available",
    );
  }
  const result = await client.call(executeWorkflowTool, args);
  pass("workflow execute", {
    tool: executeWorkflowTool,
    workflowId: targetWorkflowId,
    preview: preview(result),
  });
  return result;
}

async function waitForBridgeTelemetry({ targetWorkflowId, triggerResult }) {
  if (!graphQlUrl || (!apiSecret && !apiKey) || !tenantId) {
    const reason =
      "GraphQL telemetry env missing; set SMOKE_GRAPHQL_HTTP_URL/GRAPHQL_HTTP_URL, SMOKE_TENANT_ID, and API auth";
    if (requireTelemetry) throw new Error(reason);
    return skip("ThinkWork bridge telemetry", reason);
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastRuns = [];
  while (Date.now() <= deadline) {
    lastRuns = await readBridgeRuns();
    const match = findBridgeRun(lastRuns, {
      targetWorkflowId,
      triggerResult,
    });
    if (match) {
      pass("ThinkWork bridge run observed", summarizeBridgeRun(match));
      if (isTerminalBridgeRun(match)) {
        pass("ThinkWork bridge run terminal", summarizeBridgeRun(match));
        if (!isSuccessfulBridgeRun(match)) {
          failCheck("ThinkWork bridge run resumed successfully", {
            reason: "bridge run reached an unsuccessful terminal state",
            run: summarizeBridgeRun(match),
          });
        } else {
          pass(
            "ThinkWork bridge run resumed successfully",
            summarizeBridgeRun(match),
          );
        }
        return summarizeBridgeRun(match);
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }

  failCheck("ThinkWork bridge telemetry", {
    reason: "timed out waiting for terminal bridge run",
    correlationId,
    workflowId: targetWorkflowId ?? null,
    lastRuns: lastRuns.slice(0, 5).map(summarizeBridgeRun),
  });
  throw new Error(
    `Timed out after ${POLL_TIMEOUT_MS}ms waiting for bridge run ${correlationId}`,
  );
}

async function readBridgeRuns() {
  const data = await gql(
    `query N8nBridgeSmokeRuns($limit: Int) {
       n8nAgentStepRuns(limit: $limit) {
         id
         pluginInstallId
         managedApplicationId
         spaceId
         agentId
         threadId
         status
         resumeStatus
         workflowId
         workflowName
         executionId
         stepId
         correlationId
         requestId
         outputPreview
         errorMessage
         summary
         links
         resumeAttemptCount
         lastResumeHttpStatus
         lastResumeError
         expiresAt
         updatedAt
       }
     }`,
    { limit: Number(env.SMOKE_N8N_BRIDGE_TELEMETRY_LIMIT || 20) },
  );
  return data.n8nAgentStepRuns ?? [];
}

function findBridgeRun(runs, { targetWorkflowId, triggerResult }) {
  const expectedExecutionId = first(
    executionId,
    extractExecutionId(triggerResult),
  );
  return runs.find((run) => {
    if (run.correlationId !== correlationId) return false;
    if (targetWorkflowId && run.workflowId !== String(targetWorkflowId)) {
      return false;
    }
    if (
      expectedExecutionId &&
      run.executionId !== String(expectedExecutionId)
    ) {
      return false;
    }
    return true;
  });
}

function summarizeBridgeRun(run) {
  if (!run || run.skipped) return run;
  return {
    id: run.id,
    status: run.status,
    resumeStatus: run.resumeStatus,
    workflowId: run.workflowId,
    workflowName: run.workflowName,
    executionId: run.executionId,
    stepId: run.stepId,
    correlationId: run.correlationId,
    threadId: run.threadId,
    summary: run.summary,
    outputPreview: run.outputPreview,
    errorMessage: run.errorMessage,
    links: run.links,
    resumeAttemptCount: run.resumeAttemptCount,
    lastResumeHttpStatus: run.lastResumeHttpStatus,
    lastResumeError: run.lastResumeError,
    expiresAt: run.expiresAt,
    updatedAt: run.updatedAt,
  };
}

async function inspectExecution(
  client,
  toolNames,
  { telemetry, triggerResult },
) {
  const resolvedExecutionId = first(
    executionId,
    telemetry?.executionId,
    extractExecutionId(triggerResult),
  );
  if (!resolvedExecutionId || !toolNames.has(getExecutionTool)) {
    return skip(
      "n8n execution inspection",
      "execution id is unavailable or get_execution tool is unavailable",
    );
  }
  const args = parseJsonEnv(
    "SMOKE_N8N_BRIDGE_GET_EXECUTION_ARGS",
    env.SMOKE_N8N_BRIDGE_GET_EXECUTION_ARGS,
    { id: resolvedExecutionId },
  );
  const result = await client.call(getExecutionTool, args);
  pass("n8n execution inspection", {
    tool: getExecutionTool,
    executionId: resolvedExecutionId,
    preview: preview(result),
  });
  return previewObject(result);
}

async function archiveWorkflow(client, targetWorkflowId) {
  if (!targetWorkflowId) {
    skip("archive imported workflow", "no workflow id resolved");
    return;
  }
  const args = parseJsonEnv(
    "SMOKE_N8N_BRIDGE_ARCHIVE_ARGS",
    env.SMOKE_N8N_BRIDGE_ARCHIVE_ARGS,
    { id: targetWorkflowId },
  );
  const result = await client.call(archiveWorkflowTool, args);
  pass("archive imported workflow", {
    tool: archiveWorkflowTool,
    workflowId: targetWorkflowId,
    preview: preview(result),
  });
}

function makeDirectMcpClient() {
  return {
    async listTools() {
      return mcpRequest("tools/list", {}, mcpUrl, {
        authorization: `Bearer ${mcpToken}`,
      }).then((result) => result.tools ?? []);
    },
    async call(tool, args) {
      return mcpRequest("tools/call", { name: tool, arguments: args }, mcpUrl, {
        authorization: `Bearer ${mcpToken}`,
      }).then(parseMcpToolResult);
    },
  };
}

async function mcpRequest(method, params, url, headers) {
  let id = 1;
  let sessionId = null;
  const initialize = await jsonRpc(url, headers, {
    jsonrpc: "2.0",
    id: id++,
    method: "initialize",
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "thinkwork-n8n-agent-step-bridge-smoke",
        version: "1.0.0",
      },
    },
  });
  sessionId = initialize.sessionId;
  await jsonRpc(
    url,
    headers,
    {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    },
    sessionId,
  );
  const response = await jsonRpc(
    url,
    headers,
    { jsonrpc: "2.0", id: id++, method, params },
    sessionId,
  );
  if (response.body.error) {
    throw new Error(
      `${method} JSON-RPC error: ${JSON.stringify(response.body.error)}`,
    );
  }
  return response.body.result ?? {};
}

async function jsonRpc(url, authHeaders, body, sessionId = null) {
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      ...authHeaders,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`MCP HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  if (!("id" in body)) return { body: {}, sessionId };
  return {
    body: parseMcpResponse(text, response.headers.get("content-type")),
    sessionId: response.headers.get("mcp-session-id") ?? sessionId,
  };
}

function parseMcpResponse(text, contentType) {
  if (contentType?.includes("text/event-stream")) {
    const data = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    return data ? JSON.parse(data) : {};
  }
  return text ? JSON.parse(text) : {};
}

function parseMcpToolResult(result) {
  if (result.structuredContent) {
    return unwrapToolPayload(result.structuredContent);
  }
  const text = result.content?.find?.((item) => item.type === "text")?.text;
  if (!text) return result;
  try {
    return unwrapToolPayload(JSON.parse(text));
  } catch {
    return { text };
  }
}

function unwrapToolPayload(value) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, "result")
  ) {
    return value.result;
  }
  return value;
}

async function gql(query, variables) {
  const headers = {
    "content-type": "application/json",
    "x-tenant-id": tenantId,
  };
  if (apiSecret) headers.authorization = `Bearer ${apiSecret}`;
  if (apiKey) headers["x-api-key"] = apiKey;

  const response = await fetchWithTimeout(graphQlUrl, {
    method: "POST",
    headers,
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

function isTerminalBridgeRun(run) {
  return ["RESUMED", "RESUME_FAILED", "FAILED", "EXPIRED"].includes(
    normalizeEnum(run.status),
  );
}

function isSuccessfulBridgeRun(run) {
  return (
    normalizeEnum(run.status) === "RESUMED" &&
    normalizeEnum(run.resumeStatus) === "RESUMED"
  );
}

function extractWorkflowId(value) {
  return firstStringByKey(value, ["workflowId", "workflow_id", "id"]);
}

function extractExecutionId(value) {
  return firstStringByKey(value, ["executionId", "execution_id", "id"]);
}

function firstStringByKey(value, keys) {
  if (!value || typeof value !== "object") return null;
  const seen = new Set();
  const queue = [value];
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    for (const key of keys) {
      const candidate = current[key];
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
      if (typeof candidate === "number") {
        return String(candidate);
      }
    }
    for (const child of Object.values(current)) {
      if (child && typeof child === "object") queue.push(child);
    }
  }
  return null;
}

function toolName(tool) {
  return String(tool?.name ?? tool?.tool ?? "");
}

function pass(name, detail) {
  checks.push({ name, ok: true, ...(detail ? { detail } : {}) });
  console.log(`PASS - ${name}${detail ? `: ${JSON.stringify(detail)}` : ""}`);
}

function failCheck(name, detail) {
  checks.push({ name, ok: false, ...(detail ? { detail } : {}) });
  console.log(`FAIL - ${name}${detail ? `: ${JSON.stringify(detail)}` : ""}`);
}

function skip(name, reason) {
  checks.push({ name, ok: true, skipped: true, reason });
  console.log(`SKIP - ${name}: ${reason}`);
  return { skipped: true, reason };
}

function parseJsonEnv(name, value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(
      `${name} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function requireEnv(label, value) {
  if (!value) {
    throw new Error(`Missing required live smoke env: ${label}`);
  }
}

function first(...values) {
  return values.find(
    (value) => value !== undefined && value !== null && value !== "",
  );
}

function preview(value) {
  return JSON.stringify(value ?? null).slice(0, 1_500);
}

function previewObject(value) {
  if (value?.skipped) return value;
  return { preview: preview(value) };
}

function normalizeEnum(value) {
  return String(value ?? "").toUpperCase();
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = url.search ? "?<redacted>" : "";
    return url.toString();
  } catch {
    return "<invalid-url>";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
