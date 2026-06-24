#!/usr/bin/env node
/**
 * Smoke test the Twenty CRM managed MCP + per-user OAuth path.
 *
 * Dry-run is the default. Set SMOKE_ENABLE_TWENTY_MCP_OAUTH=1 after Twenty is
 * running and the user has connected Twenty from Settings -> MCP Servers.
 *
 * Live mode is read-oriented unless SMOKE_TWENTY_MCP_CALL=1 is also set. The
 * call step uses the ThinkWork MCP proxy with the caller's Cognito token, so it
 * exercises the same per-user vault token selection and runtime injection path
 * as the desktop agent experience.
 *
 * Optional live env:
 *   SMOKE_API_BASE_URL=https://api.example.com
 *   VITE_API_URL=https://api.example.com
 *   SMOKE_COGNITO_ID_TOKEN=<current user's Cognito id token>
 *   SMOKE_TENANT_ID=<tenant uuid>
 *   SMOKE_USER_ID=<ThinkWork users.id for the authenticated user>
 *   SMOKE_AGENT_ID=<agent id assigned to the Twenty MCP server>
 *   SMOKE_TWENTY_URL=https://crm.thinkwork.ai
 *   SMOKE_TWENTY_MCP_CALL=1
 *   SMOKE_TWENTY_USER_EMAIL=user@example.com
 *   SMOKE_TWENTY_WORKSPACE_MEMBER_ID=<Twenty workspace member uuid>
 *   SMOKE_TWENTY_OPPORTUNITIES_TOOL=execute_tool
 *   SMOKE_TWENTY_OPPORTUNITIES_ARGS='{"assignedTo":"me"}'
 *   SMOKE_TWENTY_EXPECTED_OPPORTUNITY_ID=<optional expected opportunity uuid>
 *   SMOKE_TWENTY_VERIFY_RECORD_URL=1
 *   SMOKE_TWENTY_WEB_COOKIE='twenty_session=...'
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const LIVE_ENABLED = process.env.SMOKE_ENABLE_TWENTY_MCP_OAUTH === "1";
const CALL_ENABLED = process.env.SMOKE_TWENTY_MCP_CALL === "1";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15_000);

const env = {
  ...loadEnvFile(),
  ...process.env,
};

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
const tenantId = first(env.SMOKE_TENANT_ID, env.TENANT_ID);
const userId = first(env.SMOKE_USER_ID, env.USER_ID);
const agentId = first(env.SMOKE_AGENT_ID, env.AGENT_ID);
const twentyUrl = first(env.SMOKE_TWENTY_URL, "https://crm.thinkwork.ai");
const expectedServerName = env.SMOKE_TWENTY_MCP_SERVER_NAME || "twenty--crm";
const expectedServerTitle = env.SMOKE_TWENTY_MCP_TITLE || "Twenty CRM";
const opportunityToolOverride = first(env.SMOKE_TWENTY_OPPORTUNITIES_TOOL);
const twentyUserEmail = first(env.SMOKE_TWENTY_USER_EMAIL, env.USER_EMAIL);
const twentyWorkspaceMemberId = first(env.SMOKE_TWENTY_WORKSPACE_MEMBER_ID);
const opportunityArgs = parseJsonEnv(
  "SMOKE_TWENTY_OPPORTUNITIES_ARGS",
  env.SMOKE_TWENTY_OPPORTUNITIES_ARGS,
  null,
);
const expectedOpportunityId = first(env.SMOKE_TWENTY_EXPECTED_OPPORTUNITY_ID);
const verifyRecordUrl = env.SMOKE_TWENTY_VERIFY_RECORD_URL === "1";
const twentyWebCookie = first(env.SMOKE_TWENTY_WEB_COOKIE);
const twentyWebAuthorization = first(env.SMOKE_TWENTY_WEB_AUTHORIZATION);

if (!LIVE_ENABLED) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        skippedLive: true,
        reason:
          "set SMOKE_ENABLE_TWENTY_MCP_OAUTH=1 to run the deployed Twenty MCP OAuth smoke",
        dryRun: {
          requiredWhenRunning: [
            "SMOKE_API_BASE_URL or VITE_API_URL",
            "SMOKE_COGNITO_ID_TOKEN",
            "SMOKE_TENANT_ID",
            "SMOKE_USER_ID",
            "SMOKE_AGENT_ID",
            "Twenty CRM running at SMOKE_TWENTY_URL or https://crm.thinkwork.ai",
          ],
          optionalAgentProof: [
            "SMOKE_TWENTY_MCP_CALL=1",
            "SMOKE_TWENTY_USER_EMAIL=<Twenty user email> or SMOKE_TWENTY_WORKSPACE_MEMBER_ID=<uuid>",
            "SMOKE_TWENTY_OPPORTUNITIES_TOOL=<Twenty MCP opportunity-list tool or execute_tool>",
            'SMOKE_TWENTY_OPPORTUNITIES_ARGS=\'{"ownerId":{"eq":"<workspace-member-id>"},"limit":20,"offset":0,"select":["id","name","ownerId"]}\'',
            "SMOKE_TWENTY_EXPECTED_OPPORTUNITY_ID=<optional expected Opportunity uuid>",
            "SMOKE_TWENTY_VERIFY_RECORD_URL=1 plus SMOKE_TWENTY_WEB_COOKIE or SMOKE_TWENTY_WEB_AUTHORIZATION to HTTP-probe the generated record URL",
          ],
          verifies: [
            "Twenty public MCP OAuth protected-resource metadata resolves",
            "Settings -> MCP Servers server-side list contains managed Twenty CRM",
            "Current user's Twenty auth status is active",
            "ThinkWork MCP proxy tools/list exposes Twenty tools for the agent",
            "Optional tools/call fetches assigned opportunities through ThinkWork runtime auth",
            "Optional tools/call proof requires generated Opportunity recordLinks from the MCP proxy",
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
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

async function runLiveSmoke() {
  requireEnv("SMOKE_API_BASE_URL or VITE_API_URL", apiBaseUrl);
  requireEnv("SMOKE_COGNITO_ID_TOKEN", idToken);
  requireEnv("SMOKE_TENANT_ID", tenantId);
  requireEnv("SMOKE_USER_ID", userId);
  requireEnv("SMOKE_AGENT_ID", agentId);

  const metadata = await readOAuthMetadata(twentyUrl);
  const userServers = await api("/api/skills/user-mcp-servers", {
    method: "GET",
    headers: {
      "x-tenant-id": tenantId,
      "x-principal-id": userId,
    },
  });
  const twentyServer = findTwentyServer(userServers.servers ?? []);
  if (!twentyServer) {
    throw new Error(
      `Managed Twenty MCP server was not visible in /api/skills/user-mcp-servers for user ${userId}.`,
    );
  }
  if (twentyServer.authStatus !== "active") {
    throw new Error(
      `Twenty MCP authStatus must be active before agent proof; got ${twentyServer.authStatus ?? "missing"}.`,
    );
  }

  const toolsList = await api("/api/mcp/tools/list", {
    method: "POST",
    body: { agentId },
  });
  const twentyTools = (toolsList.tools ?? []).filter(
    (tool) => tool.server === expectedServerName,
  );
  if (twentyTools.length === 0) {
    throw new Error(
      `MCP proxy tools/list did not expose tools for server ${expectedServerName}.`,
    );
  }

  const opportunityProof = CALL_ENABLED
    ? await runOpportunityProof(twentyTools)
    : {
        skipped: true,
        reason:
          "set SMOKE_TWENTY_MCP_CALL=1 and SMOKE_TWENTY_OPPORTUNITIES_TOOL to run the assigned-opportunities tool call",
      };

  return {
    metadata,
    twentyServer: summarizeServer(twentyServer),
    twentyTools: twentyTools.map((tool) => ({
      name: tool.name,
      tool: tool.tool,
      description: tool.description ?? null,
    })),
    opportunityProof,
  };
}

async function readOAuthMetadata(baseUrl) {
  const resourceUrl = new URL(
    "/.well-known/oauth-protected-resource/mcp",
    baseUrl,
  ).toString();
  const resource = await fetchJson(resourceUrl);
  const authorizationServer = resource.authorization_servers?.[0];
  if (!authorizationServer) {
    throw new Error(
      `Twenty OAuth protected-resource metadata did not include authorization_servers: ${resourceUrl}`,
    );
  }
  const authMetadata = await fetchJson(
    new URL("/.well-known/oauth-authorization-server", authorizationServer),
  ).catch(() =>
    fetchJson(
      new URL("/.well-known/openid-configuration", authorizationServer),
    ),
  );
  if (!authMetadata.authorization_endpoint || !authMetadata.token_endpoint) {
    throw new Error(
      `Twenty OAuth authorization metadata is missing authorization_endpoint or token_endpoint.`,
    );
  }
  return {
    resourceUrl,
    authorizationServer,
    authorizationEndpoint: authMetadata.authorization_endpoint,
    tokenEndpoint: authMetadata.token_endpoint,
  };
}

async function runOpportunityProof(twentyTools) {
  const executeTool = twentyTools.find((tool) => tool.tool === "execute_tool");
  const selected = opportunityToolOverride
    ? twentyTools.find(
        (tool) =>
          tool.tool === opportunityToolOverride ||
          tool.name === opportunityToolOverride,
      )
    : (executeTool ??
      twentyTools.find((tool) =>
        /opportunit/i.test(
          `${tool.name} ${tool.tool} ${tool.description ?? ""}`,
        ),
      ));

  if (!selected) {
    throw new Error(
      opportunityToolOverride
        ? `Configured opportunity tool ${opportunityToolOverride} was not found in Twenty tools/list.`
        : "Could not infer an opportunity tool from Twenty tools/list; set SMOKE_TWENTY_OPPORTUNITIES_TOOL.",
    );
  }

  const toolArguments =
    selected.tool === "execute_tool"
      ? await buildTwentyExecuteOpportunityArgs()
      : (opportunityArgs ?? {});

  const response = await api("/api/mcp/tools/call", {
    method: "POST",
    body: {
      agentId,
      server: expectedServerName,
      tool: selected.tool,
      arguments: toolArguments,
    },
  });
  if (response.isError) {
    throw new Error(
      `Twenty opportunity tool returned isError=true: ${JSON.stringify(response.content)}`,
    );
  }
  const recordLinks = validateOpportunityRecordLinks(response);
  const urlOpenProof = await verifyRecordLinkUrl(recordLinks[0].url);
  return {
    skipped: false,
    server: expectedServerName,
    tool: selected.tool,
    qualifiedName: selected.name,
    argumentSummary: summarizeToolArguments(toolArguments),
    contentSummary: summarizeContent(response.content),
    recordLinkProof: {
      count: recordLinks.length,
      links: recordLinks,
      urlOpenProof,
    },
  };
}

async function buildTwentyExecuteOpportunityArgs() {
  if (opportunityArgs) {
    return {
      toolName: "find_many_opportunities",
      arguments: opportunityArgs,
    };
  }

  const workspaceMemberId =
    twentyWorkspaceMemberId ?? (await discoverTwentyWorkspaceMemberId());
  return {
    toolName: "find_many_opportunities",
    arguments: {
      limit: 20,
      offset: 0,
      select: ["id", "name", "stage", "amount", "closeDate", "ownerId"],
      ownerId: { eq: workspaceMemberId },
    },
  };
}

async function discoverTwentyWorkspaceMemberId() {
  requireEnv(
    "SMOKE_TWENTY_USER_EMAIL or SMOKE_TWENTY_WORKSPACE_MEMBER_ID",
    twentyUserEmail,
  );

  const response = await api("/api/mcp/tools/call", {
    method: "POST",
    body: {
      agentId,
      server: expectedServerName,
      tool: "execute_tool",
      arguments: {
        toolName: "find_many_workspace_members",
        arguments: {
          limit: 100,
          offset: 0,
          select: ["id", "userEmail", "name"],
        },
      },
    },
  });
  if (response.isError) {
    throw new Error(
      `Twenty workspace member lookup returned isError=true: ${JSON.stringify(response.content)}`,
    );
  }
  const payload = parseTwentyToolPayload(response);
  const records = payload?.result?.records;
  if (!Array.isArray(records)) {
    throw new Error("Twenty workspace member lookup did not return records.");
  }
  const targetEmail = String(twentyUserEmail).toLowerCase();
  const member = records.find(
    (record) =>
      typeof record?.userEmail === "string" &&
      record.userEmail.toLowerCase() === targetEmail,
  );
  if (!member?.id) {
    throw new Error(
      `Could not find Twenty workspace member for ${twentyUserEmail}.`,
    );
  }
  return member.id;
}

function parseTwentyToolPayload(response) {
  const text = response.content?.find?.((item) => item.type === "text")?.text;
  if (!text) return null;
  return JSON.parse(text);
}

function validateOpportunityRecordLinks(response) {
  const links = Array.isArray(response.recordLinks) ? response.recordLinks : [];
  if (links.length === 0) {
    throw new Error(
      "Twenty opportunity proof did not return recordLinks. Health checks and tools/list are not sufficient proof; ensure the deployed API/runtime includes MCP record-link hints and the selected tool returns Opportunity records.",
    );
  }

  const normalizedTwentyOrigin = originOf(twentyUrl);
  const validLinks = links
    .filter((link) => link?.objectType === "opportunity")
    .map((link) => ({
      objectType: link.objectType,
      id: String(link.id ?? ""),
      label: String(link.label ?? ""),
      url: String(link.url ?? ""),
    }))
    .filter((link) => link.id && link.url);

  if (validLinks.length === 0) {
    throw new Error(
      "Twenty opportunity proof returned recordLinks, but none were Opportunity links with an id and URL.",
    );
  }

  if (
    expectedOpportunityId &&
    !validLinks.some((link) => link.id === expectedOpportunityId)
  ) {
    throw new Error(
      `Twenty opportunity proof did not include expected Opportunity id ${expectedOpportunityId}.`,
    );
  }

  const offOrigin = validLinks.find(
    (link) => originOf(link.url) !== normalizedTwentyOrigin,
  );
  if (offOrigin) {
    throw new Error(
      `Generated record link does not use the expected Twenty origin ${normalizedTwentyOrigin}: ${redactUrl(offOrigin.url)}`,
    );
  }

  return validLinks;
}

async function verifyRecordLinkUrl(url) {
  if (!verifyRecordUrl) {
    return {
      skipped: true,
      reason:
        "set SMOKE_TWENTY_VERIFY_RECORD_URL=1 with SMOKE_TWENTY_WEB_COOKIE or SMOKE_TWENTY_WEB_AUTHORIZATION to HTTP-probe the generated URL; otherwise open the URL as the authorized user and record evidence.",
    };
  }

  const headers = { accept: "text/html,application/xhtml+xml" };
  if (twentyWebCookie) headers.cookie = twentyWebCookie;
  if (twentyWebAuthorization) headers.authorization = twentyWebAuthorization;
  if (!twentyWebCookie && !twentyWebAuthorization) {
    throw new Error(
      "SMOKE_TWENTY_VERIFY_RECORD_URL=1 requires SMOKE_TWENTY_WEB_COOKIE or SMOKE_TWENTY_WEB_AUTHORIZATION for the authorized Twenty user.",
    );
  }

  const response = await fetchWithTimeout(url, { headers });
  if (!response.ok) {
    throw new Error(
      `Generated Twenty record URL did not open for the authorized user: HTTP ${response.status} ${redactUrl(url)}`,
    );
  }
  await response.text().catch(() => "");
  return {
    skipped: false,
    status: response.status,
    url: redactUrl(url),
  };
}

function summarizeToolArguments(args) {
  if (args?.toolName) {
    return {
      toolName: args.toolName,
      argumentKeys: Object.keys(args.arguments ?? {}).sort(),
    };
  }
  return { argumentKeys: Object.keys(args ?? {}).sort() };
}

function summarizeContent(content) {
  const blocks = Array.isArray(content) ? content : [];
  const textLength = blocks
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .reduce((total, item) => total + item.text.length, 0);
  return {
    blockCount: blocks.length,
    textLength,
  };
}

function originOf(value) {
  return new URL(value).origin;
}

function redactUrl(value) {
  const url = new URL(value);
  return `${url.origin}${url.pathname ? "/..." : ""}`;
}

function findTwentyServer(servers) {
  return servers.find(
    (server) =>
      server.managedApplicationKey === "twenty-crm" ||
      server.slug === "twenty--crm" ||
      server.slug === "twenty-crm" ||
      server.name === expectedServerTitle,
  );
}

function summarizeServer(server) {
  return {
    id: server.id,
    name: server.name,
    slug: server.slug,
    url: server.url,
    authType: server.authType,
    authStatus: server.authStatus,
    managementSource: server.managementSource,
    managedApplicationKey: server.managedApplicationKey,
    runtimeAssigned: server.runtimeAssigned,
    runtimeEnabled: server.runtimeEnabled,
  };
}

async function api(pathname, options) {
  const url = new URL(pathname, apiBaseUrl).toString();
  const headers = {
    authorization: `Bearer ${idToken}`,
    "content-type": "application/json",
    ...(options.headers ?? {}),
  };
  const response = await fetchWithTimeout(url, {
    method: options.method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${url}: ${text.slice(0, 500)}`);
  }
  return body;
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url, {
    headers: { accept: "application/json" },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${url}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : {};
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

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}
