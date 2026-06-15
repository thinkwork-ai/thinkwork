#!/usr/bin/env node
/**
 * Plane MCP seed + work-item loop smoke.
 *
 * Dry-run is the default. Set SMOKE_ENABLE_PLANE_MCP=1 after a Plane runtime
 * is reachable and a user/API token exists. Live mode exercises:
 *   1. tools/list contains the core Plane tools.
 *   2. get_me authenticates with the active user's Plane credentials.
 *   3. a seed project and existing work item can be resolved/read.
 *   4. an existing item can receive a write-back comment.
 *   5. a new work item can be created and read back.
 *
 * Writes are gated by SMOKE_PLANE_MCP_WRITE=1. Without it, live mode proves
 * authentication and read access, then reports the write path as skipped.
 *
 * Direct Plane MCP mode:
 *   SMOKE_PLANE_MCP_URL=https://plane.example.com/mcp
 *   SMOKE_PLANE_API_KEY=<Plane PAT sent as Authorization: Bearer>
 *   SMOKE_PLANE_WORKSPACE_SLUG=<workspace-slug>
 *
 * ThinkWork proxy mode (optional, after plugin install + agent assignment):
 *   SMOKE_PLANE_THINKWORK_PROXY=1
 *   SMOKE_API_BASE_URL or VITE_API_URL
 *   SMOKE_COGNITO_ID_TOKEN=<activated user's Cognito id token>
 *   SMOKE_AGENT_ID=<agent id assigned to the Plane plugin MCP server>
 *   SMOKE_PLANE_MCP_SERVER=plane--issues
 *
 * Optional activation helper for proxy mode:
 *   SMOKE_PLANE_INSTALL_ID=<plugin install id>
 *   VITE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL
 *   API_AUTH_SECRET or THINKWORK_API_SECRET
 *   SMOKE_ACTIVATED_USER_ID=<ThinkWork users.id>
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const LIVE_ENABLED = process.env.SMOKE_ENABLE_PLANE_MCP === "1";
const WRITE_ENABLED = process.env.SMOKE_PLANE_MCP_WRITE === "1";
const VIA_THINKWORK = process.env.SMOKE_PLANE_THINKWORK_PROXY === "1";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 20_000);
const MCP_PROTOCOL_VERSION = "2025-03-26";
const EXTERNAL_SOURCE = "thinkwork-plane-smoke";

const env = {
  ...loadEnvFile(),
  ...process.env,
};

const planeUrl = first(env.SMOKE_PLANE_URL);
const directMcpUrl = first(
  env.SMOKE_PLANE_MCP_URL,
  planeUrl ? new URL("/mcp", planeUrl).toString() : undefined,
);
const planeApiKey = first(env.SMOKE_PLANE_API_KEY, env.PLANE_API_KEY);
const workspaceSlug = first(
  env.SMOKE_PLANE_WORKSPACE_SLUG,
  env.PLANE_WORKSPACE_SLUG,
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
const graphQlUrl = first(
  env.VITE_GRAPHQL_HTTP_URL,
  env.GRAPHQL_HTTP_URL,
  env.API_GRAPHQL_URL,
);
const apiSecret = first(env.API_AUTH_SECRET, env.THINKWORK_API_SECRET);
const tenantId = first(env.SMOKE_TENANT_ID, env.TENANT_ID);
const activatedUserId = first(env.SMOKE_ACTIVATED_USER_ID, env.USER_ID);
const installId = first(env.SMOKE_PLANE_INSTALL_ID);

const serverName = first(env.SMOKE_PLANE_MCP_SERVER, "plane--issues");
const projectIdentifier = first(env.SMOKE_PLANE_PROJECT_IDENTIFIER, "TWSM");
const projectName = first(env.SMOKE_PLANE_PROJECT_NAME, "ThinkWork Smoke");
const runId =
  first(env.SMOKE_PLANE_RUN_ID) ??
  new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
const existingExternalId = first(
  env.SMOKE_PLANE_EXISTING_EXTERNAL_ID,
  `existing-${runId}`,
);
const createdExternalId = first(
  env.SMOKE_PLANE_CREATED_EXTERNAL_ID,
  `created-${runId}`,
);

const checks = [];

if (!LIVE_ENABLED) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        skippedLive: true,
        reason:
          "set SMOKE_ENABLE_PLANE_MCP=1 to run the Plane MCP seed/write smoke",
        dryRun: {
          modes: {
            directPlaneMcp:
              "uses SMOKE_PLANE_MCP_URL + SMOKE_PLANE_API_KEY + SMOKE_PLANE_WORKSPACE_SLUG",
            thinkworkProxy:
              "set SMOKE_PLANE_THINKWORK_PROXY=1 after a Plane plugin MCP server is installed, activated, and assigned to SMOKE_AGENT_ID",
          },
          writes:
            "set SMOKE_PLANE_MCP_WRITE=1 to create the seed project/work items and write comments",
          verifies: [
            "tools/list exposes get_me, list_projects, create_project, list_work_items, retrieve_work_item_by_identifier, create_work_item, create_work_item_comment",
            "get_me authenticates the active Plane user",
            "seed project and existing work item are resolved/read",
            "existing item receives a smoke comment and is re-read",
            "new work item is created and read back",
          ],
        },
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

try {
  const result = await runLiveSmoke();
  const failed = checks.filter((check) => !check.ok);
  console.log(
    JSON.stringify(
      {
        ok: failed.length === 0,
        mode: VIA_THINKWORK ? "thinkwork" : "direct",
        checks,
        ...result,
      },
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
  if (installId) {
    await activateThinkWorkCredentials();
  }

  const client = VIA_THINKWORK ? makeThinkWorkClient() : makeDirectMcpClient();
  const tools = await client.listTools();
  assertRequiredTools(tools);

  const me = await client.call("get_me", {});
  pass("get_me authenticates the Plane user", {
    preview: preview(me),
  });

  const project = await ensureProject(client);
  if (!project) {
    return {
      workspaceSlug,
      project: null,
      existing: { skipped: true },
      comment: { skipped: true },
      created: { skipped: true },
    };
  }
  const existing = await ensureExistingWorkItem(client, project.id);
  if (!existing) {
    return {
      workspaceSlug,
      project: summarizeProject(project),
      existing: { skipped: true },
      comment: { skipped: true },
      created: { skipped: true },
    };
  }
  const readableIdentifier = workItemIdentifier(existing, project);
  const readExisting = await client.call("retrieve_work_item_by_identifier", {
    ...workItemIdentifierArgs(existing, project),
    expand: "assignees,labels,state",
  });
  pass("read seeded work item by readable identifier", {
    identifier: readableIdentifier,
    id: idOf(readExisting),
  });

  const comment = await writeBackComment(
    client,
    project.id,
    idOf(readExisting),
  );
  const created = await createNewWorkItem(client, project.id);
  const readCreated = created?.skipped
    ? created
    : await readWorkItemByIdentifier(client, created, project);

  return {
    workspaceSlug,
    project: summarizeProject(project),
    existing: summarizeWorkItem(readExisting),
    comment,
    created: summarizeWorkItem(readCreated),
  };
}

function assertRequiredTools(tools) {
  const names = new Set(tools.map((tool) => tool.name ?? tool.tool));
  const required = [
    "get_me",
    "list_projects",
    "create_project",
    "list_work_items",
    "retrieve_work_item_by_identifier",
    "create_work_item",
    "create_work_item_comment",
  ];
  const missing = required.filter((name) => !names.has(name));
  if (missing.length > 0) {
    failCheck("Plane MCP exposes required smoke tools", {
      missing,
      available: [...names].sort().slice(0, 80),
    });
  } else {
    pass("Plane MCP exposes required smoke tools", { required });
  }
}

async function ensureProject(client) {
  const projects = normalizeList(
    await client.call("list_projects", {
      per_page: 100,
      fields: "id,name,identifier",
    }),
  );
  const existing = projects.find(
    (project) => String(project.identifier) === projectIdentifier,
  );
  if (existing?.id) {
    pass("seed project already exists", summarizeProject(existing));
    return existing;
  }
  if (!WRITE_ENABLED) {
    skip(
      "seed project",
      `Plane project ${projectIdentifier} not found; set SMOKE_PLANE_MCP_WRITE=1 to create it.`,
    );
    return null;
  }
  const created = await client.call("create_project", {
    name: projectName,
    identifier: projectIdentifier,
    description: "ThinkWork Plane MCP smoke project.",
  });
  pass("created seed project", summarizeProject(created));
  return created;
}

async function ensureExistingWorkItem(client, projectId) {
  const matches = normalizeList(
    await client.call("list_work_items", {
      project_id: projectId,
      external_source: EXTERNAL_SOURCE,
      external_id: existingExternalId,
      per_page: 25,
      fields: "id,name,sequence_id,project,external_source,external_id",
    }),
  );
  const existing = matches.find(
    (item) => item.external_id === existingExternalId,
  );
  if (existing?.id) {
    pass("seed existing work item already exists", summarizeWorkItem(existing));
    return existing;
  }
  if (!WRITE_ENABLED) {
    skip(
      "seed existing work item",
      `Seed existing work item ${existingExternalId} not found; set SMOKE_PLANE_MCP_WRITE=1 to create it.`,
    );
    return null;
  }
  const created = await client.call("create_work_item", {
    project_id: projectId,
    name: `ThinkWork smoke existing ${runId}`,
    description_stripped:
      "Existing work item seeded by ThinkWork Plane MCP smoke.",
    priority: "low",
    external_source: EXTERNAL_SOURCE,
    external_id: existingExternalId,
  });
  pass("created seed existing work item", summarizeWorkItem(created));
  return created;
}

async function writeBackComment(client, projectId, workItemId) {
  if (!WRITE_ENABLED) {
    skip(
      "write back comment to existing work item",
      "set SMOKE_PLANE_MCP_WRITE=1 to create the verification comment",
    );
    return { skipped: true };
  }
  const comment = await client.call("create_work_item_comment", {
    project_id: projectId,
    work_item_id: workItemId,
    comment_html: `<p>ThinkWork Plane MCP smoke write-back passed for run <code>${runId}</code>.</p>`,
    access: "INTERNAL",
    external_source: EXTERNAL_SOURCE,
    external_id: `comment-${runId}`,
  });
  pass("wrote comment to existing work item", {
    id: idOf(comment),
  });
  return { skipped: false, id: idOf(comment) };
}

async function createNewWorkItem(client, projectId) {
  const matches = normalizeList(
    await client.call("list_work_items", {
      project_id: projectId,
      external_source: EXTERNAL_SOURCE,
      external_id: createdExternalId,
      per_page: 25,
      fields: "id,name,sequence_id,project,external_source,external_id",
    }),
  );
  const existing = matches.find(
    (item) => item.external_id === createdExternalId,
  );
  if (existing?.id) {
    pass(
      "new work item already exists for this smoke run",
      summarizeWorkItem(existing),
    );
    return existing;
  }
  if (!WRITE_ENABLED) {
    skip(
      "create new work item",
      `New work item ${createdExternalId} not found; set SMOKE_PLANE_MCP_WRITE=1 to create it.`,
    );
    return { skipped: true };
  }
  const created = await client.call("create_work_item", {
    project_id: projectId,
    name: `ThinkWork smoke created ${runId}`,
    description_stripped: "Created by ThinkWork Plane MCP end-to-end smoke.",
    priority: "low",
    external_source: EXTERNAL_SOURCE,
    external_id: createdExternalId,
  });
  pass("created new work item", summarizeWorkItem(created));
  return created;
}

async function readWorkItemByIdentifier(client, item, project) {
  const identifier = workItemIdentifier(item, project);
  const read = await client.call("retrieve_work_item_by_identifier", {
    ...workItemIdentifierArgs(item, project),
  });
  pass("read newly created work item", {
    identifier,
    id: idOf(read),
  });
  return read;
}

async function activateThinkWorkCredentials() {
  requireEnv("VITE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL", graphQlUrl);
  requireEnv("API_AUTH_SECRET or THINKWORK_API_SECRET", apiSecret);
  requireEnv("SMOKE_TENANT_ID", tenantId);
  requireEnv("SMOKE_ACTIVATED_USER_ID", activatedUserId);
  requireEnv("SMOKE_PLANE_INSTALL_ID", installId);
  requireEnv("SMOKE_PLANE_API_KEY", planeApiKey);
  requireEnv("SMOKE_PLANE_WORKSPACE_SLUG", workspaceSlug);

  const { activatePluginWithCredentials } = await gql(
    `mutation PlaneSmokeActivate($input: ActivatePluginWithCredentialsInput!) {
       activatePluginWithCredentials(input: $input) { id status pluginKey pluginInstallId }
     }`,
    {
      input: {
        installId,
        credentials: [
          { key: "apiKey", value: planeApiKey },
          { key: "workspaceSlug", value: workspaceSlug },
        ],
      },
    },
    activatedUserId,
  );
  pass("activated Plane plugin credentials for ThinkWork proxy", {
    activationId: activatePluginWithCredentials.id,
    status: activatePluginWithCredentials.status,
  });
}

function makeDirectMcpClient() {
  requireEnv("SMOKE_PLANE_MCP_URL or SMOKE_PLANE_URL", directMcpUrl);
  requireEnv("SMOKE_PLANE_API_KEY", planeApiKey);
  requireEnv("SMOKE_PLANE_WORKSPACE_SLUG", workspaceSlug);
  return {
    async listTools() {
      return mcpRequest("tools/list", {}, directMcpUrl, {
        authorization: `Bearer ${planeApiKey}`,
        "x-workspace-slug": workspaceSlug,
      }).then((result) => result.tools ?? []);
    },
    async call(tool, args) {
      return mcpRequest(
        "tools/call",
        { name: tool, arguments: args },
        directMcpUrl,
        {
          authorization: `Bearer ${planeApiKey}`,
          "x-workspace-slug": workspaceSlug,
        },
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
      const response = await api("/api/mcp/tools/list", {
        agentId,
      });
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
          `Plane tool ${tool} returned isError=true: ${JSON.stringify(response.content ?? []).slice(0, 800)}`,
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
      clientInfo: { name: "thinkwork-plane-smoke", version: "1.0.0" },
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

async function gql(query, variables, principalId) {
  const response = await fetchWithTimeout(graphQlUrl, {
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

function parseMcpProxyContent(response) {
  if (response.structuredContent) return unwrapToolPayload(response.structuredContent);
  const text = response.content?.find?.((item) => item.type === "text")?.text;
  if (!text) return response;
  try {
    return unwrapToolPayload(JSON.parse(text));
  } catch {
    return { text };
  }
}

function parseMcpToolResult(result) {
  if (result.structuredContent) return unwrapToolPayload(result.structuredContent);
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

function normalizeList(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.result)) return value.result;
  if (Array.isArray(value?.results)) return value.results;
  if (Array.isArray(value?.result?.records)) return value.result.records;
  if (Array.isArray(value?.records)) return value.records;
  return [];
}

function workItemIdentifier(item, project) {
  const args = workItemIdentifierArgs(item, project);
  return `${args.project_identifier}-${args.issue_identifier}`;
}

function workItemIdentifierArgs(item, project) {
  const explicit = first(item.identifier, item.work_item_identifier);
  if (explicit) {
    const parts = String(explicit).match(/^(.+)-(\d+)$/);
    if (parts) {
      return {
        project_identifier: parts[1],
        issue_identifier: Number(parts[2]),
      };
    }
  }
  const sequence = first(item.sequence_id, item.issue_identifier);
  if (!sequence) {
    throw new Error(`Work item ${idOf(item)} has no sequence_id/identifier.`);
  }
  return {
    project_identifier: project.identifier,
    issue_identifier: Number(sequence),
  };
}

function idOf(value) {
  const id = first(value?.id, value?.work_item_id, value?.uuid);
  if (!id) throw new Error(`Response is missing an id: ${preview(value)}`);
  return id;
}

function summarizeProject(project) {
  return {
    id: project.id,
    name: project.name,
    identifier: project.identifier,
  };
}

function summarizeWorkItem(item) {
  return {
    id: first(item.id, item.work_item_id),
    name: item.name,
    sequenceId: first(item.sequence_id, item.issue_identifier),
    externalSource: item.external_source,
    externalId: item.external_id,
  };
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

function preview(value) {
  return JSON.stringify(value ?? null).slice(0, 1_500);
}
