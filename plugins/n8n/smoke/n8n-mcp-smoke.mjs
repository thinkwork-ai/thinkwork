#!/usr/bin/env node
/**
 * n8n native MCP smoke.
 *
 * Dry-run is the default. Set SMOKE_ENABLE_N8N_MCP=1 after the n8n plugin is
 * installed, deployed, and assigned to a ThinkWork agent.
 *
 * ThinkWork proxy mode (preferred end-to-end path):
 *   SMOKE_N8N_THINKWORK_PROXY=1
 *   SMOKE_API_BASE_URL or VITE_API_URL
 *   SMOKE_COGNITO_ID_TOKEN=<operator/user Cognito id token>
 *   SMOKE_AGENT_ID=<agent id assigned to n8n MCP>
 *   SMOKE_N8N_MCP_SERVER=n8n--workflow-management
 *
 * Direct n8n MCP mode (diagnostic only):
 *   SMOKE_N8N_MCP_URL=https://n8n.example.com/mcp-server/http
 *   SMOKE_N8N_MCP_SERVICE_TOKEN=<tenant service credential token>
 *
 * Optional GraphQL install check:
 *   SMOKE_N8N_INSTALL_ID=<plugin install id>
 *   SMOKE_TENANT_ID=<tenant-id>
 *   VITE_GRAPHQL_HTTP_URL, GRAPHQL_HTTP_URL, or API_GRAPHQL_URL
 *   API_AUTH_SECRET, THINKWORK_API_SECRET, VITE_GRAPHQL_API_KEY, or GRAPHQL_API_KEY
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { attachSmokeEvidence } from "../../../scripts/smoke/deployment-evidence.mjs";

const LIVE_ENABLED = process.env.SMOKE_ENABLE_N8N_MCP === "1";
const VIA_THINKWORK = process.env.SMOKE_N8N_THINKWORK_PROXY === "1";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 20_000);
const MCP_PROTOCOL_VERSION = "2025-03-26";

const env = {
  ...loadEnvFile(),
  ...process.env,
};

const n8nUrl = first(env.SMOKE_N8N_URL);
const directMcpUrl = first(
  env.SMOKE_N8N_MCP_URL,
  n8nUrl ? new URL("/mcp-server/http", n8nUrl).toString() : undefined,
);
const serviceToken = first(
  env.SMOKE_N8N_MCP_SERVICE_TOKEN,
  env.N8N_MCP_SERVICE_CREDENTIAL,
);
const apiBaseUrl = first(
  env.SMOKE_API_BASE_URL,
  env.VITE_API_URL,
  env.API_BASE_URL,
);
const idToken = first(
  env.SMOKE_COGNITO_ID_TOKEN,
  env.COGNITO_ID_TOKEN,
  env.THINKWORK_ID_TOKEN,
);
const agentId = first(env.SMOKE_AGENT_ID, env.AGENT_ID);
const serverName = first(env.SMOKE_N8N_MCP_SERVER, "n8n--workflow-management");
const graphQlUrl = first(
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
const installId = first(env.SMOKE_N8N_INSTALL_ID);
const requiredTools = csv(
  first(env.SMOKE_N8N_REQUIRED_TOOLS) ?? "list_workflows,get_workflow",
);
const workflowListTool = first(env.SMOKE_N8N_WORKFLOW_LIST_TOOL);
const workflowListArgs = parseJsonEnv(
  "SMOKE_N8N_WORKFLOW_LIST_ARGS",
  env.SMOKE_N8N_WORKFLOW_LIST_ARGS,
  {},
);
const workflowGetTool = first(env.SMOKE_N8N_WORKFLOW_GET_TOOL);
const workflowId = first(env.SMOKE_N8N_WORKFLOW_ID);
const workflowGetArgs = parseJsonEnv(
  "SMOKE_N8N_WORKFLOW_GET_ARGS",
  env.SMOKE_N8N_WORKFLOW_GET_ARGS,
  workflowId ? { id: workflowId } : {},
);
const checks = [];

if (!LIVE_ENABLED) {
  console.log(
    JSON.stringify(
      await attachSmokeEvidence(
        "n8n-mcp",
        {
          ok: true,
          skippedLive: true,
          reason: "set SMOKE_ENABLE_N8N_MCP=1 to run the n8n native MCP smoke",
          dryRun: {
            preferredMode:
              "ThinkWork proxy mode proves the installed plugin MCP path through an assigned agent",
            directMode: "direct n8n MCP mode is diagnostic only",
            requiredWhenRunning: [
              "n8n plugin installed through Settings -> Plugins",
              "n8n runtime deployed and instance-level MCP enabled",
              "MCP access enabled on the workflow, project, or folder",
              "n8n MCP server assigned to SMOKE_AGENT_ID for ThinkWork proxy mode",
            ],
            optionalGraphqlEnv: [
              "SMOKE_N8N_INSTALL_ID",
              "SMOKE_TENANT_ID",
              "VITE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL or API_GRAPHQL_URL",
              "API_AUTH_SECRET or THINKWORK_API_SECRET or VITE_GRAPHQL_API_KEY or GRAPHQL_API_KEY",
            ],
            verifies: [
              "plugin install is n8n and has provisioned MCP/infrastructure components when SMOKE_N8N_INSTALL_ID is set",
              "tools/list exposes native n8n workflow tools",
              "a low-risk workflow list call succeeds when a list tool is available",
              "a specific workflow read succeeds when SMOKE_N8N_WORKFLOW_ID and get tool are configured",
              "production publish, unpublish, and activation are never called by this smoke",
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
    mode: VIA_THINKWORK ? "thinkwork" : "direct",
    checks,
    ...result,
  };
  console.log(
    JSON.stringify(await attachSmokeEvidence("n8n-mcp", payload, env), null, 2),
  );
  process.exit(failed.length === 0 ? 0 : 1);
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        mode: VIA_THINKWORK ? "thinkwork" : "direct",
        error: error instanceof Error ? error.message : String(error),
        checks,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

async function runLiveSmoke() {
  const install = installId
    ? await readGraphqlInstall().catch((error) => ({
        error: error instanceof Error ? error.message : String(error),
      }))
    : { skipped: true, reason: "SMOKE_N8N_INSTALL_ID not set" };
  validateInstall(install);

  const client = VIA_THINKWORK ? makeThinkWorkClient() : makeDirectMcpClient();
  const tools = await client.listTools();
  assertWorkflowTools(tools);

  const listTool =
    workflowListTool ??
    findTool(tools, [
      /^list[_-]?workflows?$/i,
      /^search[_-]?workflows?$/i,
      /^find[_-]?workflows?$/i,
      /^workflows?[_-]?(list|search|find)$/i,
    ]);
  const workflowList = listTool
    ? await callReadTool(client, listTool, workflowListArgs, "workflow list")
    : skip(
        "workflow list",
        "no workflow-like list tool was found; set SMOKE_N8N_WORKFLOW_LIST_TOOL",
      );

  const getTool =
    workflowGetTool ??
    findTool(tools, [
      /^get[_-]?workflow$/i,
      /^read[_-]?workflow$/i,
      /^retrieve[_-]?workflow$/i,
    ]);
  const workflowRead =
    workflowId && getTool
      ? await callReadTool(client, getTool, workflowGetArgs, "workflow read")
      : skip(
          "workflow read",
          "set SMOKE_N8N_WORKFLOW_ID and SMOKE_N8N_WORKFLOW_GET_TOOL to inspect a disposable workflow",
        );

  return {
    install,
    toolCount: tools.length,
    availableTools: summarizeTools(tools),
    workflowList: previewObject(workflowList),
    workflowRead: previewObject(workflowRead),
    activationGuardrail:
      "Smoke is read-only by default and does not publish, unpublish, activate, or deactivate production workflows.",
  };
}

function validateInstall(install) {
  if (install.skipped) {
    skip("GraphQL plugin install check", install.reason);
    return;
  }
  if (install.error) {
    failCheck("GraphQL plugin install check", install);
    return;
  }
  if (!install.pluginInstall) {
    failCheck("GraphQL plugin install check", {
      reason: `pluginInstall ${installId} was not found`,
    });
    return;
  }
  const row = install.pluginInstall;
  const componentStates = Object.fromEntries(
    row.components.map((component) => [
      `${component.componentType}:${component.componentKey}`,
      component.state,
    ]),
  );
  const required = ["mcp-server:workflow-management", "infrastructure:runtime"];
  const missing = required.filter((key) => !componentStates[key]);
  if (row.pluginKey !== "n8n" || missing.length > 0) {
    failCheck("GraphQL plugin install check", {
      pluginKey: row.pluginKey,
      state: row.state,
      missing,
      componentStates,
    });
    return;
  }
  pass("GraphQL plugin install check", {
    id: row.id,
    state: row.state,
    componentStates,
  });
}

function assertWorkflowTools(tools) {
  const names = new Set(tools.map(toolName).filter(Boolean));
  const present = requiredTools.filter((tool) => names.has(tool));
  const hasWorkflowNamedTool = [...names].some((name) =>
    /workflow/i.test(name),
  );
  if (present.length === 0 && !hasWorkflowNamedTool) {
    failCheck("n8n MCP exposes workflow tools", {
      requiredTools,
      available: [...names].sort().slice(0, 80),
    });
    return;
  }
  pass("n8n MCP exposes workflow tools", {
    matched: present.length > 0 ? present : ["workflow-named tool"],
    available: [...names].sort().slice(0, 80),
  });
}

async function callReadTool(client, tool, args, label) {
  const result = await client.call(tool, args);
  pass(label, { tool, preview: preview(result) });
  return result;
}

function makeDirectMcpClient() {
  requireEnv("SMOKE_N8N_MCP_URL or SMOKE_N8N_URL", directMcpUrl);
  requireEnv("SMOKE_N8N_MCP_SERVICE_TOKEN", serviceToken);
  return {
    async listTools() {
      return mcpRequest("tools/list", {}, directMcpUrl, {
        authorization: `Bearer ${serviceToken}`,
      }).then((result) => result.tools ?? []);
    },
    async call(tool, args) {
      return mcpRequest(
        "tools/call",
        { name: tool, arguments: args },
        directMcpUrl,
        { authorization: `Bearer ${serviceToken}` },
      ).then(parseMcpToolResult);
    },
  };
}

function makeThinkWorkClient() {
  requireEnv("SMOKE_API_BASE_URL or VITE_API_URL", apiBaseUrl);
  requireEnv("SMOKE_COGNITO_ID_TOKEN", idToken);
  requireEnv("SMOKE_AGENT_ID", agentId);
  return {
    async listTools() {
      const response = await api("/api/mcp/tools/list", { agentId });
      return (response.tools ?? []).filter(
        (tool) => tool.server === serverName,
      );
    },
    async call(tool, args) {
      const response = await api("/api/mcp/tools/call", {
        agentId,
        server: serverName,
        tool,
        arguments: args,
      });
      if (response.isError) {
        throw new Error(
          `n8n tool ${tool} returned isError=true: ${JSON.stringify(response.content ?? []).slice(0, 800)}`,
        );
      }
      return parseMcpProxyContent(response);
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
      clientInfo: { name: "thinkwork-n8n-smoke", version: "1.0.0" },
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

async function api(pathname, body) {
  const url = new URL(pathname, apiBaseUrl).toString();
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${idToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${url}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function readGraphqlInstall() {
  requireEnv("VITE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL", graphQlUrl);
  requireEnv("SMOKE_TENANT_ID", tenantId);
  if (!apiSecret && !apiKey) {
    throw new Error(
      "Missing API_AUTH_SECRET/THINKWORK_API_SECRET or GraphQL API key",
    );
  }
  const data = await gql(
    `query N8nMcpSmokeInstall($id: ID!) {
       pluginInstall(id: $id) {
         id
         pluginKey
         state
         components {
           componentKey
           componentType
           state
           handlerRef
           lastError
         }
       }
     }`,
    { id: installId },
  );
  return { pluginInstall: data.pluginInstall };
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

function parseMcpProxyContent(response) {
  if (response.structuredContent)
    return unwrapToolPayload(response.structuredContent);
  const text = response.content?.find?.((item) => item.type === "text")?.text;
  if (!text) return response;
  try {
    return unwrapToolPayload(JSON.parse(text));
  } catch {
    return { text };
  }
}

function parseMcpToolResult(result) {
  if (result.structuredContent)
    return unwrapToolPayload(result.structuredContent);
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

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function findTool(tools, patterns) {
  for (const pattern of patterns) {
    const match = tools.find((tool) => pattern.test(toolName(tool)));
    if (match) return toolName(match);
  }
  return null;
}

function summarizeTools(tools) {
  return tools
    .map((tool) => ({
      name: toolName(tool),
      server: tool.server,
      description: tool.description
        ? String(tool.description).slice(0, 160)
        : undefined,
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
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

function csv(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
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
