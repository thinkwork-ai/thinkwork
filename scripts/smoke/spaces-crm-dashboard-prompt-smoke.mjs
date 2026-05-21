#!/usr/bin/env node
/**
 * Smoke test that a deployed Computer can turn a CRM dashboard prompt into a
 * newly saved applet artifact.
 *
 * By default this runs a deterministic dry-run contract check only. Set
 * SMOKE_ENABLE_AGENT_APPLET_PROMPT=1 to invoke the deployed AgentCore/model
 * path.
 *
 * Required for live mode:
 *   DATABASE_URL
 *   SMOKE_COMPUTER_URL
 *   VITE_GRAPHQL_HTTP_URL, GRAPHQL_HTTP_URL, or API_GRAPHQL_URL
 *   API_AUTH_SECRET, THINKWORK_API_SECRET, VITE_GRAPHQL_API_KEY, or GRAPHQL_API_KEY
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_PROMPT =
  "Build a simple CRM pipeline dashboard from the available CRM data.";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 600_000);
const POLL_INTERVAL_MS = Number(process.env.SMOKE_POLL_INTERVAL_MS || 5_000);
const LIVE_ENABLED = process.env.SMOKE_ENABLE_AGENT_APPLET_PROMPT === "1";

const env = {
  ...loadEnvFile(),
  ...process.env,
};

const prompt = first(env.SMOKE_CRM_DASHBOARD_PROMPT, DEFAULT_PROMPT);
const databaseUrl = env.DATABASE_URL;
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
const computerUrl = first(env.SMOKE_COMPUTER_URL, env.COMPUTER_URL);
const context = {};

if (!LIVE_ENABLED) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        skippedLive: true,
        reason:
          "set SMOKE_ENABLE_AGENT_APPLET_PROMPT=1 to run live CRM prompt smoke",
        dryRun: runDryRun(),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (!databaseUrl) fail("Missing DATABASE_URL.");
if (!apiUrl || (!apiSecret && !apiKey)) {
  fail("Missing GraphQL HTTP config or API auth secret/key.");
}
if (!computerUrl) fail("Missing SMOKE_COMPUTER_URL.");

const identity = resolveComputerIdentity(env);

try {
  const result = await runLiveSmoke();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const diagnostics = collectDiagnostics(context.threadId);
  fail(`${message}\n${JSON.stringify(diagnostics, null, 2)}`);
}

async function runLiveSmoke() {
  const threadId = await createBlankThread();
  context.threadId = threadId;
  const messageId = await sendUserMessage(threadId);
  context.messageId = messageId;

  const task = await waitForCompletedTask(threadId);
  context.taskId = task.id;

  const artifacts = findThreadApplets(threadId);
  if (artifacts.length === 0) {
    throw new Error(
      `No applet artifact was linked to CRM prompt thread ${threadId}.`,
    );
  }
  const appId = artifacts[0].id;
  context.appId = appId;

  const loaded = await loadApplet(appId);
  assertCrmDashboardAppletSource(loaded.source, appId);
  const openPath = await verifyOpenPath(appId);

  return {
    tenantId: identity.tenantId,
    computerId: identity.computerId,
    userId: identity.userId,
    threadId,
    messageId,
    taskId: task.id,
    taskStatus: task.status,
    applet: {
      appId,
      name: loaded.applet?.name ?? null,
      version: loaded.applet?.version ?? null,
      sourceBytes: loaded.source.length,
    },
    route: openPath,
    prompt,
  };
}

async function createBlankThread() {
  const data = await gql(
    `
      mutation CreateThread($input: CreateThreadInput!) {
        createThread(input: $input) {
          id
        }
      }
    `,
    {
      input: {
        tenantId: identity.tenantId,
        computerId: identity.computerId,
        title: "CRM dashboard prompt smoke",
        channel: "CHAT",
        createdByType: "user",
        createdById: identity.userId,
      },
    },
  );
  const threadId = data.createThread?.id;
  if (!threadId) throw new Error("createThread returned no thread id.");
  return threadId;
}

async function sendUserMessage(threadId) {
  const data = await gql(
    `
      mutation SendMessage($input: SendMessageInput!) {
        sendMessage(input: $input) {
          id
        }
      }
    `,
    {
      input: {
        threadId,
        role: "USER",
        content: prompt,
      },
    },
  );
  const messageId = data.sendMessage?.id;
  if (!messageId) throw new Error("sendMessage returned no message id.");
  return messageId;
}

async function waitForCompletedTask(threadId) {
  const started = Date.now();
  let lastTask = null;
  while (Date.now() - started < TIMEOUT_MS) {
    const task = latestThreadTask(threadId);
    if (task?.id) {
      lastTask = task;
      context.taskId = task.id;
      if (task.status === "completed") return task;
      if (["failed", "cancelled"].includes(task.status)) {
        throw new Error(
          `Computer task ${task.id} ended with status ${task.status}.`,
        );
      }
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Timed out waiting for CRM dashboard prompt task for thread ${threadId}. Last task: ${JSON.stringify(lastTask)}`,
  );
}

function latestThreadTask(threadId) {
  return parseJsonObject(
    psql(`
      select coalesce(row_to_json(t)::text, '{}')
      from (
        select
          id::text,
          status,
          coalesce(error::text, '') as error,
          left(coalesce(output::text, ''), 1000) as output
        from computer_tasks
        where tenant_id = ${sqlUuid(identity.tenantId)}
          and computer_id = ${sqlUuid(identity.computerId)}
          and input->>'threadId' = '${sqlString(threadId)}'
        order by created_at desc
        limit 1
      ) t
    `),
  );
}

function findThreadApplets(threadId) {
  return parseJsonArray(
    psql(`
      select coalesce(json_agg(row_to_json(t))::text, '[]')
      from (
        select id::text, title, created_at::text
        from artifacts
        where tenant_id = ${sqlUuid(identity.tenantId)}
          and thread_id = ${sqlUuid(threadId)}
          and lower(type) = 'applet'
        order by created_at desc
        limit 5
      ) t
    `),
  );
}

async function loadApplet(appId) {
  const data = await gql(
    `
      query SmokeApplet($appId: ID!) {
        applet(appId: $appId) {
          applet {
            appId
            name
            version
          }
          source
          metadata
        }
      }
    `,
    { appId },
  );
  const payload = data.applet;
  if (!payload?.applet?.appId || !payload.source) {
    throw new Error(`applet(${appId}) did not return source + metadata.`);
  }
  return payload;
}

function assertCrmDashboardAppletSource(source, appId = "unknown") {
  const checks = [
    ["default export", /export\s+default\b/.test(source)],
    ["refresh export", /export\s+(async\s+)?function\s+refresh\b/.test(source)],
    ["stdlib import", source.includes("@thinkwork/computer-stdlib")],
  ];
  const lower = source.toLowerCase();
  for (const term of ["crm", "pipeline", "dashboard"]) {
    checks.push([`${term} term`, lower.includes(term)]);
  }

  const failed = checks.filter(([, ok]) => !ok).map(([label]) => label);
  if (failed.length > 0) {
    throw new Error(
      `CRM dashboard applet ${appId} failed source checks: ${failed.join(", ")}`,
    );
  }
}

async function verifyOpenPath(appId) {
  const url = `${computerUrl.replace(/\/+$/, "")}/artifacts/${appId}`;
  const response = await fetch(url, { redirect: "manual" });
  const body = await response.text();
  const contentType = response.headers.get("content-type") || "";
  if (response.status !== 200) {
    throw new Error(`/artifacts/${appId} returned HTTP ${response.status}.`);
  }
  if (
    !contentType.includes("text/html") ||
    !body.includes("<title>ThinkWork</title>")
  ) {
    throw new Error(
      `/artifacts/${appId} did not return the Computer SPA shell.`,
    );
  }
  return { url, status: response.status, contentType };
}

async function gql(query, variables) {
  const headers = {
    "content-type": "application/json",
    "x-tenant-id": identity.tenantId,
    "x-principal-id": identity.userId,
    "x-computer-id": identity.computerId,
  };
  if (identity.agentId) headers["x-agent-id"] = identity.agentId;
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

function collectDiagnostics(threadId) {
  if (!threadId || !databaseUrl) return { threadId: threadId ?? null };
  return {
    threadId,
    taskId: context.taskId ?? null,
    appId: context.appId ?? null,
    task: latestThreadTask(threadId),
    assistant: parseJsonObject(
      psql(`
        select coalesce(row_to_json(t)::text, '{}')
        from (
          select id::text, left(coalesce(content, ''), 1000) as preview
          from messages
          where tenant_id = ${sqlUuid(identity.tenantId)}
            and thread_id = ${sqlUuid(threadId)}
            and role = 'assistant'
          order by created_at desc
          limit 1
        ) t
      `),
    ),
    recentApplets: findThreadApplets(threadId),
  };
}

function resolveComputerIdentity(source) {
  const supplied = {
    tenantId: first(source.SMOKE_TENANT_ID, source.TENANT_ID),
    computerId: first(source.SMOKE_COMPUTER_ID, source.COMPUTER_ID),
    userId: first(source.SMOKE_USER_ID, source.USER_ID),
    agentId: first(source.SMOKE_AGENT_ID, source.AGENT_ID),
  };
  if (supplied.tenantId && supplied.computerId && supplied.userId) {
    return supplied;
  }

  const row = psql(`
    select
      c.tenant_id::text || '|' ||
      c.id::text || '|' ||
      c.owner_user_id::text || '|' ||
      coalesce(c.migrated_from_agent_id::text, '')
    from computers c
    where c.owner_user_id is not null
    order by c.updated_at desc nulls last, c.created_at desc
    limit 1
  `);
  const [tenantId, computerId, userId, agentId] = row.split("|");
  if (!tenantId || !computerId || !userId) {
    fail(
      "Could not resolve a Computer identity. Set SMOKE_TENANT_ID, SMOKE_COMPUTER_ID, and SMOKE_USER_ID.",
    );
  }
  return { tenantId, computerId, userId, agentId: agentId || null };
}

function runDryRun() {
  const source = `import { AppHeader } from "@thinkwork/computer-stdlib";

export default function CrmPipelineDashboard() {
  return <AppHeader title="CRM Pipeline Dashboard" />;
}

export async function refresh() {
  return { data: { crm: true, pipeline: true, dashboard: true } };
}
`;
  assertCrmDashboardAppletSource(source, "dry-run");
  const fakeTask = parseJsonObject(
    '{"id":"11111111-1111-4111-8111-111111111111","status":"completed"}',
  );
  const fakeApplets = parseJsonArray(
    '[{"id":"22222222-2222-4222-8222-222222222222","title":"CRM Pipeline Dashboard"}]',
  );
  const taskSql = latestThreadTaskSql(
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
    "55555555-5555-4555-8555-555555555555",
  );
  return {
    prompt: DEFAULT_PROMPT,
    fakeTaskStatus: fakeTask.status,
    fakeAppletCount: fakeApplets.length,
    taskSqlIncludesThreadFilter: taskSql.includes("input->>'threadId'"),
  };
}

function latestThreadTaskSql(tenantId, computerId, threadId) {
  return `
    select coalesce(row_to_json(t)::text, '{}')
    from (
      select id::text, status, coalesce(error::text, '') as error
      from computer_tasks
      where tenant_id = ${sqlUuid(tenantId)}
        and computer_id = ${sqlUuid(computerId)}
        and input->>'threadId' = '${sqlString(threadId)}'
      order by created_at desc
      limit 1
    ) t
  `;
}

function psql(sql) {
  return execFileSync("psql", [databaseUrl, "-tAc", sql], {
    encoding: "utf8",
  }).trim();
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadEnvFile() {
  const configured = process.env.COMPUTER_ENV_FILE;
  if (configured === "none") return {};

  const envFile = configured || path.join("apps", "computer", ".env");
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

function sqlUuid(value) {
  if (!isUuid(value)) {
    throw new Error(`Invalid UUID value for smoke SQL: ${value}`);
  }
  return `'${sqlString(value)}'::uuid`;
}

function isUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function sqlString(value) {
  return String(value).replace(/'/g, "''");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function first(...values) {
  return values.find((value) => typeof value === "string" && value.length > 0);
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}
