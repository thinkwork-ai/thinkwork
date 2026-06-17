#!/usr/bin/env node
/**
 * LastMile plugin end-to-end smoke (plan 2026-06-12-001 U9).
 *
 * Two phases with a MANUAL OAuth step in between (the WorkOS AuthKit
 * consent cannot be completed headlessly):
 *
 *   Phase 1 (default)            — discovery drift guard against the live
 *     RFC 9728 metadata, installPlugin as tenant admin (or verify an
 *     existing install), assert state 'installed' with 4 provisioned
 *     components, then start activation for the test user and PRINT the
 *     authorizeUrl. A human opens that URL in a browser signed in as the
 *     activated test user and completes consent.
 *
 *   Phase 2 (--post-activation)  — asserts myPluginActivations is
 *     'active' for the activated user and NOT active for a second,
 *     non-activated user; optionally proves the live tool surface through
 *     the MCP proxy (per-user Cognito token): tools/list must expose the
 *     three lastmile-- servers for the activated user and exclude them
 *     for the non-activated user, plus an optional read tool call
 *     (opportunities_list) per SMOKE_LASTMILE_MCP_CALL=1.
 *
 * THNK-37 catalog freshness note: after a LastMile version bump, use
 * Settings -> Plugins or GraphQL `refreshPluginCatalog` to prove the deployed
 * API has refreshed the signed GitHub-backed catalog before running this
 * install/upgrade smoke. This smoke verifies the ThinkWork install,
 * activation, and MCP proxy path for the verified catalog version.
 *
 * Dry-run is the default. Set SMOKE_ENABLE_LASTMILE_PLUGIN=1 to run live.
 *
 * Live env (GraphQL, service-secret path):
 *   VITE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL or API_GRAPHQL_URL
 *   API_AUTH_SECRET or THINKWORK_API_SECRET
 *   SMOKE_TENANT_ID=<tenant uuid>
 *   SMOKE_ADMIN_USER_ID=<users.id with owner/admin tenant role>
 *   SMOKE_ACTIVATED_USER_ID=<users.id of the user who will/did activate>
 *   SMOKE_NON_ACTIVATED_USER_ID=<users.id of a user who must NOT activate>
 *
 * Optional phase-2 tool-surface proof (Cognito path through /api/mcp):
 *   SMOKE_API_BASE_URL or VITE_API_URL
 *   SMOKE_COGNITO_ID_TOKEN=<activated user's Cognito id token>
 *   SMOKE_AGENT_ID=<agent id in the tenant>
 *   SMOKE_NONACTIVATED_COGNITO_ID_TOKEN=<non-activated user's id token>
 *   SMOKE_LASTMILE_MCP_CALL=1                 # run opportunities_list on CRM
 *   SMOKE_LASTMILE_OPPORTUNITIES_ARGS='{...}' # optional tool arguments
 *   SMOKE_LASTMILE_TASKS_TOOL / SMOKE_LASTMILE_ROUTING_TOOL
 *       — opt-in tool names for the tasks/routing call proof. No default:
 *         opportunities_list is the only LastMile tool name verified as
 *         read-safe, so the other two servers are proven by their
 *         authenticated tools/list round-trip unless a tool is named.
 *
 * NOTE — per-stage endpoint gap: the manifest pins LastMile's
 * DEVELOP-stage endpoints (dev-mcp.lastmile-tei.com); prod is
 * mcp.lastmile-tei.com. Per-stage endpoint parameterization is a known
 * v1 gap (see the manifest header).
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const LIVE_ENABLED = process.env.SMOKE_ENABLE_LASTMILE_PLUGIN === "1";
const POST_ACTIVATION = process.argv.includes("--post-activation");
const CALL_ENABLED = process.env.SMOKE_LASTMILE_MCP_CALL === "1";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 20_000);

// Expected LastMile contract — MUST stay in sync with
// plugins/lastmile/src/manifest.ts and
// .../lastmile/discovery.fixture.ts (the unit test pins manifest↔fixture;
// this smoke pins fixture↔live).
const PLUGIN_KEY = "lastmile";
const MCP_BASE = "https://dev-mcp.lastmile-tei.com";
const AUTH_DOMAIN = "https://straightforward-dragon-14-staging.authkit.app";
const EXPECTED_SCOPES = ["openid", "email", "profile", "offline_access"];
const SERVER_KEYS = ["crm", "tasks", "routing"];
const EXPECTED_SKILL_FOLDER = "skills/lastmile--crm-basics/";
const serverSlug = (key) => `${PLUGIN_KEY}--${key}`;

const env = { ...loadEnvFile(), ...process.env };

const graphqlUrl = first(
  env.VITE_GRAPHQL_HTTP_URL,
  env.GRAPHQL_HTTP_URL,
  env.API_GRAPHQL_URL,
);
const apiSecret = first(env.API_AUTH_SECRET, env.THINKWORK_API_SECRET);
const tenantId = first(env.SMOKE_TENANT_ID, env.TENANT_ID);
const adminUserId = first(env.SMOKE_ADMIN_USER_ID);
const activatedUserId = first(env.SMOKE_ACTIVATED_USER_ID);
const nonActivatedUserId = first(env.SMOKE_NON_ACTIVATED_USER_ID);
const apiBaseUrl = first(env.SMOKE_API_BASE_URL, env.VITE_API_URL);
const cognitoIdToken = first(env.SMOKE_COGNITO_ID_TOKEN);
const nonActivatedIdToken = first(env.SMOKE_NONACTIVATED_COGNITO_ID_TOKEN);
const agentId = first(env.SMOKE_AGENT_ID, env.AGENT_ID);
const opportunityArgs = parseJsonEnv(
  "SMOKE_LASTMILE_OPPORTUNITIES_ARGS",
  env.SMOKE_LASTMILE_OPPORTUNITIES_ARGS,
  {},
);

const checks = [];

function pass(name, detail) {
  checks.push({ name, ok: true, ...(detail ? { detail } : {}) });
  console.log(`PASS — ${name}${detail ? `: ${stringify(detail)}` : ""}`);
}

function failCheck(name, detail) {
  checks.push({ name, ok: false, ...(detail ? { detail } : {}) });
  console.log(`FAIL — ${name}${detail ? `: ${stringify(detail)}` : ""}`);
}

function skip(name, reason) {
  checks.push({ name, ok: true, skipped: true, reason });
  console.log(`SKIP — ${name}: ${reason}`);
}

function stringify(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

if (!LIVE_ENABLED) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        skippedLive: true,
        reason:
          "set SMOKE_ENABLE_LASTMILE_PLUGIN=1 to run the LastMile plugin smoke",
        phases: {
          phase1:
            "node plugins/lastmile/smoke/lastmile-plugin-smoke.mjs — discovery drift guard + installPlugin + activatePlugin authorizeUrl",
          manualStep:
            "open the printed authorizeUrl in a browser signed in as SMOKE_ACTIVATED_USER_ID and complete the WorkOS AuthKit consent",
          phase2:
            "node plugins/lastmile/smoke/lastmile-plugin-smoke.mjs --post-activation — activation + per-user tool surface assertions",
        },
        requiredWhenRunning: [
          "VITE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL",
          "API_AUTH_SECRET or THINKWORK_API_SECRET",
          "SMOKE_TENANT_ID",
          "SMOKE_ADMIN_USER_ID (owner/admin tenant role)",
          "SMOKE_ACTIVATED_USER_ID",
          "SMOKE_NON_ACTIVATED_USER_ID (phase 2)",
        ],
        optionalToolSurfaceProof: [
          "SMOKE_API_BASE_URL or VITE_API_URL",
          "SMOKE_COGNITO_ID_TOKEN (activated user)",
          "SMOKE_AGENT_ID",
          "SMOKE_NONACTIVATED_COGNITO_ID_TOKEN (exclusion proof)",
          "SMOKE_LASTMILE_MCP_CALL=1 (CRM opportunities_list call)",
        ],
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

try {
  if (POST_ACTIVATION) {
    await runPhase2();
  } else {
    await runPhase1();
  }
  const failed = checks.filter((check) => !check.ok);
  console.log(
    JSON.stringify(
      { ok: failed.length === 0, phase: POST_ACTIVATION ? 2 : 1, checks },
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
        phase: POST_ACTIVATION ? 2 : 1,
        error: error instanceof Error ? error.message : String(error),
        checks,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Phase 1 — discovery drift guard + install + activation kickoff
// ---------------------------------------------------------------------------

async function runPhase1() {
  requireEnv("VITE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL", graphqlUrl);
  requireEnv("API_AUTH_SECRET or THINKWORK_API_SECRET", apiSecret);
  requireEnv("SMOKE_TENANT_ID", tenantId);
  requireEnv("SMOKE_ADMIN_USER_ID", adminUserId);
  requireEnv("SMOKE_ACTIVATED_USER_ID", activatedUserId);

  await assertDiscoveryMetadata();

  const install = await ensureInstalled();
  assertInstallShape(install);

  const { activatePlugin } = await gql(
    `mutation LastmileSmokeActivate($input: ActivatePluginInput!) {
       activatePlugin(input: $input) { authorizeUrl }
     }`,
    { input: { installId: install.id } },
    activatedUserId,
  );
  pass("activatePlugin returned an authorizeUrl", {
    installId: install.id,
  });

  console.log("\n=== MANUAL STEP REQUIRED ===");
  console.log(
    `Open this URL in a browser signed in as user ${activatedUserId} and complete the OAuth consent:`,
  );
  console.log(`\n${activatePlugin.authorizeUrl}\n`);
  console.log(
    "Then run: SMOKE_ENABLE_LASTMILE_PLUGIN=1 node plugins/lastmile/smoke/lastmile-plugin-smoke.mjs --post-activation",
  );
}

async function assertDiscoveryMetadata() {
  for (const key of SERVER_KEYS) {
    const url = `${MCP_BASE}/.well-known/oauth-protected-resource/${key}`;
    const metadata = await fetchJson(url);
    const problems = [];
    if (metadata.resource !== `${MCP_BASE}/${key}`) {
      problems.push(
        `resource ${metadata.resource} != manifest endpoint ${MCP_BASE}/${key}`,
      );
    }
    if (!(metadata.authorization_servers ?? []).includes(AUTH_DOMAIN)) {
      problems.push(
        `authorization_servers ${JSON.stringify(metadata.authorization_servers)} missing manifest auth domain ${AUTH_DOMAIN}`,
      );
    }
    const liveScopes = [...(metadata.scopes_supported ?? [])].sort();
    if (
      JSON.stringify(liveScopes) !== JSON.stringify([...EXPECTED_SCOPES].sort())
    ) {
      problems.push(
        `scopes_supported ${JSON.stringify(liveScopes)} != manifest scopes ${JSON.stringify(EXPECTED_SCOPES)}`,
      );
    }
    if (problems.length > 0) {
      failCheck(`discovery metadata for ${key} matches the manifest`, problems);
    } else {
      pass(`discovery metadata for ${key} matches the manifest`);
    }
  }
}

async function ensureInstalled() {
  const { pluginInstalls } = await gql(
    `query LastmileSmokeInstalls {
       pluginInstalls {
         id pluginKey pinnedVersion state lastError
         components { componentKey componentType state handlerRef lastError }
       }
     }`,
    {},
    adminUserId,
  );
  const existing = pluginInstalls.find(
    (install) => install.pluginKey === PLUGIN_KEY,
  );
  if (existing) {
    pass("lastmile install already exists (skipping installPlugin)", {
      installId: existing.id,
      state: existing.state,
      pinnedVersion: existing.pinnedVersion,
    });
    return existing;
  }

  const { installPlugin } = await gql(
    `mutation LastmileSmokeInstall($input: InstallPluginInput!) {
       installPlugin(input: $input) {
         id pluginKey pinnedVersion state lastError
         components { componentKey componentType state handlerRef lastError }
       }
     }`,
    {
      input: {
        pluginKey: PLUGIN_KEY,
        idempotencyKey: `lastmile-smoke-${randomUUID()}`,
      },
    },
    adminUserId,
  );
  pass("installPlugin completed", {
    installId: installPlugin.id,
    state: installPlugin.state,
    pinnedVersion: installPlugin.pinnedVersion,
  });
  return installPlugin;
}

function assertInstallShape(install) {
  if (install.state === "installed") {
    pass("install state is 'installed'");
  } else {
    failCheck("install state is 'installed'", {
      state: install.state,
      lastError: install.lastError,
      componentErrors: install.components
        .filter((component) => component.lastError)
        .map((component) => ({
          componentKey: component.componentKey,
          state: component.state,
          lastError: component.lastError,
        })),
    });
  }

  if (install.components.length === 4) {
    pass("install has 4 components");
  } else {
    failCheck("install has 4 components", {
      got: install.components.map((component) => component.componentKey),
    });
  }

  for (const key of SERVER_KEYS) {
    const component = install.components.find(
      (candidate) =>
        candidate.componentKey === key &&
        candidate.componentType === "mcp-server",
    );
    if (component?.state === "provisioned") {
      pass(`mcp-server component '${key}' is provisioned`, {
        handlerRef: parseHandlerRef(component.handlerRef),
      });
    } else {
      failCheck(`mcp-server component '${key}' is provisioned`, {
        state: component?.state ?? "missing",
        lastError: component?.lastError ?? null,
      });
    }
  }

  const skills = install.components.find(
    (candidate) => candidate.componentType === "skills",
  );
  const skillsRef = skills ? parseHandlerRef(skills.handlerRef) : null;
  if (
    skills?.state === "provisioned" &&
    (skillsRef?.workspaceFolders ?? []).includes(EXPECTED_SKILL_FOLDER)
  ) {
    pass("skills component is provisioned with the crm-basics folder", {
      handlerRef: skillsRef,
    });
  } else {
    failCheck("skills component is provisioned with the crm-basics folder", {
      state: skills?.state ?? "missing",
      handlerRef: skillsRef,
      lastError: skills?.lastError ?? null,
    });
  }
}

// ---------------------------------------------------------------------------
// Phase 2 — activation state + per-user tool surface
// ---------------------------------------------------------------------------

async function runPhase2() {
  requireEnv("VITE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL", graphqlUrl);
  requireEnv("API_AUTH_SECRET or THINKWORK_API_SECRET", apiSecret);
  requireEnv("SMOKE_TENANT_ID", tenantId);
  requireEnv("SMOKE_ACTIVATED_USER_ID", activatedUserId);
  requireEnv("SMOKE_NON_ACTIVATED_USER_ID", nonActivatedUserId);

  const activatedRows = await myActivations(activatedUserId);
  const active = activatedRows.find(
    (row) => row.pluginKey === PLUGIN_KEY && row.status === "active",
  );
  if (active) {
    pass("activated user has an 'active' lastmile activation", {
      activationId: active.id,
      grantedScopes: active.grantedScopes,
    });
  } else {
    failCheck("activated user has an 'active' lastmile activation", {
      rows: activatedRows.map((row) => ({
        pluginKey: row.pluginKey,
        status: row.status,
      })),
      hint: "did the manual OAuth step complete? Re-run phase 1 to mint a fresh authorizeUrl.",
    });
  }

  const nonActivatedRows = await myActivations(nonActivatedUserId);
  const leaked = nonActivatedRows.find(
    (row) => row.pluginKey === PLUGIN_KEY && row.status === "active",
  );
  if (leaked) {
    failCheck("non-activated user has NO active lastmile activation", {
      activationId: leaked.id,
    });
  } else {
    pass("non-activated user has NO active lastmile activation");
  }

  await assertToolSurface();
}

async function myActivations(userId) {
  const { myPluginActivations } = await gql(
    `query LastmileSmokeActivations {
       myPluginActivations { id pluginKey status grantedScopes pluginInstallId }
     }`,
    {},
    userId,
  );
  return myPluginActivations;
}

async function assertToolSurface() {
  if (!apiBaseUrl || !cognitoIdToken || !agentId) {
    skip(
      "activated user's MCP tool surface includes the three lastmile servers",
      "set SMOKE_API_BASE_URL, SMOKE_COGNITO_ID_TOKEN (activated user), and SMOKE_AGENT_ID to prove the live tool surface through /api/mcp/tools/list",
    );
    return;
  }

  // tools/list performs an authenticated MCP round-trip per server with
  // the activation's bearer token — it is itself the per-server proof.
  const toolsByServer = await listToolsByServer(cognitoIdToken);
  for (const key of SERVER_KEYS) {
    const slug = serverSlug(key);
    const tools = toolsByServer.get(slug) ?? [];
    if (tools.length > 0) {
      pass(`activated user's tools/list exposes ${slug}`, {
        toolCount: tools.length,
        sample: tools.slice(0, 5).map((tool) => tool.tool),
      });
    } else {
      failCheck(`activated user's tools/list exposes ${slug}`);
    }
  }

  await runToolCalls(toolsByServer);

  if (!nonActivatedIdToken) {
    skip(
      "non-activated user's tool surface excludes lastmile servers",
      "set SMOKE_NONACTIVATED_COGNITO_ID_TOKEN to prove the fail-closed exclusion through tools/list (the activation-row assertion above covers the gate input)",
    );
    return;
  }
  const excludedSurface = await listToolsByServer(nonActivatedIdToken);
  const leakedServers = SERVER_KEYS.map(serverSlug).filter(
    (slug) => (excludedSurface.get(slug) ?? []).length > 0,
  );
  if (leakedServers.length === 0) {
    pass("non-activated user's tools/list excludes all lastmile servers");
  } else {
    failCheck("non-activated user's tools/list excludes all lastmile servers", {
      leakedServers,
    });
  }
}

async function runToolCalls(toolsByServer) {
  if (!CALL_ENABLED) {
    skip(
      "per-server tool call",
      "set SMOKE_LASTMILE_MCP_CALL=1 to call opportunities_list on the CRM server",
    );
    return;
  }

  // CRM: opportunities_list is the verified read tool.
  await callTool(serverSlug("crm"), "opportunities_list", opportunityArgs);

  // Tasks/Routing: no verified read-safe tool names — opt in by env.
  for (const [key, toolEnv, argsEnv] of [
    ["tasks", "SMOKE_LASTMILE_TASKS_TOOL", "SMOKE_LASTMILE_TASKS_ARGS"],
    ["routing", "SMOKE_LASTMILE_ROUTING_TOOL", "SMOKE_LASTMILE_ROUTING_ARGS"],
  ]) {
    const toolName = first(env[toolEnv]);
    if (!toolName) {
      const available = (toolsByServer.get(serverSlug(key)) ?? []).map(
        (tool) => tool.tool,
      );
      skip(
        `${key} tool call`,
        `no verified read-safe ${key} tool name; set ${toolEnv} to one of ${JSON.stringify(available.slice(0, 10))} (authenticated tools/list already proved the server)`,
      );
      continue;
    }
    await callTool(
      serverSlug(key),
      toolName,
      parseJsonEnv(argsEnv, env[argsEnv], {}),
    );
  }
}

async function callTool(server, tool, args) {
  const response = await api("/api/mcp/tools/call", cognitoIdToken, {
    agentId,
    server,
    tool,
    arguments: args,
  });
  if (response.isError) {
    failCheck(`tools/call ${server} ${tool}`, {
      content: JSON.stringify(response.content ?? []).slice(0, 800),
    });
  } else {
    pass(`tools/call ${server} ${tool}`, {
      contentPreview: JSON.stringify(response.content ?? []).slice(0, 400),
    });
  }
}

async function listToolsByServer(idToken) {
  const response = await api("/api/mcp/tools/list", idToken, { agentId });
  const byServer = new Map();
  for (const tool of response.tools ?? []) {
    const list = byServer.get(tool.server) ?? [];
    list.push(tool);
    byServer.set(tool.server, list);
  }
  return byServer;
}

// ---------------------------------------------------------------------------
// Transport helpers (smoke conventions)
// ---------------------------------------------------------------------------

async function gql(query, variables, principalId) {
  const response = await fetchWithTimeout(graphqlUrl, {
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

async function api(pathname, idToken, body) {
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

function parseHandlerRef(raw) {
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return { unparsed: String(raw).slice(0, 200) };
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
