#!/usr/bin/env node
/**
 * Smoke test the Computer runbook foundation.
 *
 * By default this performs a deterministic dry-run against repo-authored
 * runbooks and smoke assertions. Set SMOKE_ENABLE_COMPUTER_RUNBOOKS=1 to run
 * the deployed GraphQL/DB path against a real Computer.
 *
 * Required for live mode:
 *   DATABASE_URL
 *   VITE_GRAPHQL_HTTP_URL, GRAPHQL_HTTP_URL, or API_GRAPHQL_URL
 *   API_AUTH_SECRET, THINKWORK_API_SECRET, VITE_GRAPHQL_API_KEY, or GRAPHQL_API_KEY
 *
 * Computer identity can be supplied with SMOKE_TENANT_ID, SMOKE_COMPUTER_ID,
 * and SMOKE_USER_ID. If omitted, the script uses the most recently updated
 * Computer with an owner_user_id.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const LIVE_ENABLED = process.env.SMOKE_ENABLE_COMPUTER_RUNBOOKS === "1";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 240_000);
const POLL_INTERVAL_MS = Number(process.env.SMOKE_POLL_INTERVAL_MS || 3_000);

const PROMPTS = {
  autoMap:
    process.env.SMOKE_RUNBOOK_MAP_PROMPT || "Build me a map of supplier risk.",
  explicitCrm:
    process.env.SMOKE_RUNBOOK_CRM_PROMPT ||
    "Run the CRM dashboard runbook for LastMile.",
  research:
    process.env.SMOKE_RUNBOOK_RESEARCH_PROMPT ||
    "Run the research dashboard runbook comparing these vendors.",
  noMatch:
    process.env.SMOKE_RUNBOOK_NO_MATCH_PROMPT ||
    "Help me decide how to reorganize my desk next week.",
};

const env = {
  ...loadEnvFile(),
  ...process.env,
};

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

if (!LIVE_ENABLED) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        skippedLive: true,
        reason:
          "set SMOKE_ENABLE_COMPUTER_RUNBOOKS=1 to run the deployed Computer runbook smoke",
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

const identity = resolveComputerIdentity(env);

try {
  const result = await runLiveSmoke();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

async function runLiveSmoke() {
  const autoMap = await exerciseAutoSelectedMapRunbook();
  const explicitCrm = await exerciseExplicitRunbook({
    slug: "crm-dashboard",
    prompt: PROMPTS.explicitCrm,
    title: "CRM dashboard runbook smoke",
  });
  const research = await exerciseExplicitRunbook({
    slug: "research-dashboard",
    prompt: PROMPTS.research,
    title: "Research dashboard runbook smoke",
    cancelAfterQueue: true,
  });
  const noMatch = await exerciseNoMatchPrompt();

  return {
    tenantId: identity.tenantId,
    computerId: identity.computerId,
    userId: identity.userId,
    autoMap,
    explicitCrm,
    research,
    noMatch,
  };
}

async function exerciseAutoSelectedMapRunbook() {
  const threadId = await createThread("Map runbook smoke");
  await sendUserMessage(threadId, PROMPTS.autoMap);
  const run = await waitForRunbookRun({
    threadId,
    slug: "map-artifact",
    expectedMode: "auto",
  });
  if (run.status !== "awaiting_confirmation") {
    throw new Error(
      `Expected auto-selected map runbook to await confirmation, got ${run.status}.`,
    );
  }
  await waitForAssistantPart(threadId, "data-runbook-confirmation");
  const confirmed = await confirmRunbookRun(run.id);
  const queued = await waitForRunbookRunStatus(run.id, [
    "queued",
    "running",
    "completed",
  ]);
  return {
    threadId,
    runId: run.id,
    beforeConfirmStatus: run.status,
    confirmedStatus: lowerEnum(confirmed.status),
    observedStatus: queued.status,
  };
}

async function exerciseExplicitRunbook({
  slug,
  prompt,
  title,
  cancelAfterQueue = false,
}) {
  const threadId = await createThread(title);
  await sendUserMessage(threadId, prompt);
  const run = await waitForRunbookRun({
    threadId,
    slug,
    expectedMode: "explicit",
  });
  if (run.status === "awaiting_confirmation") {
    throw new Error(`Explicit ${slug} run unexpectedly awaited confirmation.`);
  }
  await waitForAssistantPart(threadId, "data-runbook-queue");
  const tasks = runbookTasks(run.id);
  if (tasks.length === 0) throw new Error(`Runbook ${slug} expanded no tasks.`);

  let cancelled = null;
  if (cancelAfterQueue) {
    cancelled = await cancelRunbookRun(run.id);
  }

  return {
    threadId,
    runId: run.id,
    slug,
    status: run.status,
    taskCount: tasks.length,
    phases: [...new Set(tasks.map((task) => task.phase_id))],
    cancelledStatus: cancelled ? lowerEnum(cancelled.status) : null,
  };
}

async function exerciseNoMatchPrompt() {
  const threadId = await createThread("No-match runbook smoke");
  await sendUserMessage(threadId, PROMPTS.noMatch);
  await delay(Math.min(POLL_INTERVAL_MS * 2, 10_000));
  const runCount = Number(
    psql(`
      select count(*)
      from computer_runbook_runs
      where tenant_id = ${sqlUuid(identity.tenantId)}
        and computer_id = ${sqlUuid(identity.computerId)}
        and thread_id = ${sqlUuid(threadId)}
    `) || "0",
  );
  if (runCount > 0) {
    throw new Error(
      `No-match prompt created ${runCount} published runbook run(s).`,
    );
  }
  const adHocQueueObserved = messageHasPart(threadId, "data-runbook-queue");
  if (env.SMOKE_REQUIRE_AD_HOC_QUEUE === "1" && !adHocQueueObserved) {
    throw new Error(
      "No-match prompt did not persist a data-runbook-queue part.",
    );
  }
  return {
    threadId,
    publishedRunCount: runCount,
    adHocQueueObserved,
  };
}

async function createThread(title) {
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
        title,
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

async function sendUserMessage(threadId, content) {
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
        content,
      },
    },
  );
  const messageId = data.sendMessage?.id;
  if (!messageId) throw new Error("sendMessage returned no message id.");
  return messageId;
}

async function confirmRunbookRun(id) {
  const data = await gql(
    `
      mutation ConfirmRunbookRun($id: ID!) {
        confirmRunbookRun(id: $id) {
          id
          status
        }
      }
    `,
    { id },
  );
  return data.confirmRunbookRun;
}

async function cancelRunbookRun(id) {
  const data = await gql(
    `
      mutation CancelRunbookRun($id: ID!) {
        cancelRunbookRun(id: $id) {
          id
          status
        }
      }
    `,
    { id },
  );
  return data.cancelRunbookRun;
}

async function waitForRunbookRun({ threadId, slug, expectedMode }) {
  const started = Date.now();
  while (Date.now() - started < TIMEOUT_MS) {
    const run = latestRunbookRun({ threadId, slug });
    if (run?.id) {
      if (expectedMode && run.invocation_mode !== expectedMode) {
        throw new Error(
          `Runbook ${slug} expected mode ${expectedMode}, got ${run.invocation_mode}.`,
        );
      }
      return run;
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Timed out waiting for runbook ${slug} on thread ${threadId}.`,
  );
}

async function waitForRunbookRunStatus(id, statuses) {
  const expected = new Set(statuses);
  const started = Date.now();
  while (Date.now() - started < TIMEOUT_MS) {
    const run = runbookRunById(id);
    if (run?.id && expected.has(run.status)) return run;
    if (["failed", "cancelled", "rejected"].includes(run?.status)) return run;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Timed out waiting for runbook run ${id} status ${statuses.join(", ")}.`,
  );
}

async function waitForAssistantPart(threadId, partType) {
  const started = Date.now();
  while (Date.now() - started < TIMEOUT_MS) {
    if (messageHasPart(threadId, partType)) return true;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Timed out waiting for assistant part ${partType} on ${threadId}.`,
  );
}

function latestRunbookRun({ threadId, slug }) {
  return parseJsonObject(
    psql(`
      select coalesce(row_to_json(t)::text, '{}')
      from (
        select id::text, runbook_slug, runbook_version, status, invocation_mode
        from computer_runbook_runs
        where tenant_id = ${sqlUuid(identity.tenantId)}
          and computer_id = ${sqlUuid(identity.computerId)}
          and thread_id = ${sqlUuid(threadId)}
          and runbook_slug = '${sqlString(slug)}'
        order by created_at desc
        limit 1
      ) t
    `),
  );
}

function runbookRunById(id) {
  return parseJsonObject(
    psql(`
      select coalesce(row_to_json(t)::text, '{}')
      from (
        select id::text, runbook_slug, runbook_version, status, invocation_mode
        from computer_runbook_runs
        where tenant_id = ${sqlUuid(identity.tenantId)}
          and id = ${sqlUuid(id)}
        limit 1
      ) t
    `),
  );
}

function runbookTasks(runId) {
  return parseJsonArray(
    psql(`
      select coalesce(json_agg(row_to_json(t) order by sort_order)::text, '[]')
      from (
        select id::text, phase_id, task_key, title, status, sort_order
        from computer_runbook_tasks
        where tenant_id = ${sqlUuid(identity.tenantId)}
          and run_id = ${sqlUuid(runId)}
      ) t
    `),
  );
}

function messageHasPart(threadId, partType) {
  return (
    psql(`
      select exists (
        select 1
        from messages m
        cross join lateral jsonb_array_elements(coalesce(m.parts, '[]'::jsonb)) part
        where m.tenant_id = ${sqlUuid(identity.tenantId)}
          and m.thread_id = ${sqlUuid(threadId)}
          and m.role = 'assistant'
          and part->>'type' = '${sqlString(partType)}'
      )
    `) === "t"
  );
}

async function gql(query, variables) {
  const headers = {
    "content-type": "application/json",
    "x-tenant-id": identity.tenantId,
    "x-principal-id": identity.userId,
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
  const crm = loadRunbook("crm-dashboard");
  const research = loadRunbook("research-dashboard");
  const map = loadRunbook("map-artifact");

  assertRunbook(crm, {
    slug: "crm-dashboard",
    explicitAlias: "crm dashboard",
    produceContains: ["CrmDashboardData", "metadata.runbookSlug", "save_app"],
  });
  assertRunbook(research, {
    slug: "research-dashboard",
    explicitAlias: "research dashboard",
    produceContains: [
      "findings alongside evidence",
      "research-dashboard",
      "save_app",
    ],
  });
  assertRunbook(map, {
    slug: "map-artifact",
    explicitAlias: "map artifact",
    produceContains: ["MapView", "map-artifact", "save_app"],
  });

  return {
    prompts: PROMPTS,
    runbooks: [crm.slug, research.slug, map.slug],
    expectedPartTypes: ["data-runbook-confirmation", "data-runbook-queue"],
    liveModeEnv: "SMOKE_ENABLE_COMPUTER_RUNBOOKS=1",
  };
}

function loadRunbook(slug) {
  const root = path.join("packages", "runbooks", "runbooks", slug);
  const yaml = fs.readFileSync(path.join(root, "runbook.yaml"), "utf8");
  const phases = ["discover", "analyze", "produce", "validate"].map((id) => ({
    id,
    guidanceMarkdown: fs.readFileSync(
      path.join(root, "phases", `${id}.md`),
      "utf8",
    ),
  }));
  return {
    slug: readScalar(yaml, "slug"),
    yaml,
    phases,
  };
}

function assertRunbook(runbook, { slug, explicitAlias, produceContains }) {
  if (runbook.slug !== slug) throw new Error(`Expected runbook ${slug}.`);
  if (!yamlListIncludes(runbook.yaml, "explicitAliases", explicitAlias)) {
    throw new Error(`${slug} missing explicit alias ${explicitAlias}.`);
  }
  const phaseIds = phaseIdsFromYaml(runbook.yaml).join(",");
  if (phaseIds !== "discover,analyze,produce,validate") {
    throw new Error(`${slug} phase order drifted: ${phaseIds}.`);
  }
  const produceYaml = phaseBlock(runbook.yaml, "produce");
  const produce = runbook.phases.find((phase) => phase.id === "produce");
  if (!yamlListIncludes(produceYaml, "capabilityRoles", "artifact_build")) {
    throw new Error(`${slug} produce phase must declare artifact_build.`);
  }
  for (const token of produceContains) {
    if (!produce.guidanceMarkdown.includes(token)) {
      throw new Error(`${slug} produce guidance missing ${token}.`);
    }
  }
}

function readScalar(yaml, key) {
  const match = yaml.match(new RegExp(`^${escapeRegex(key)}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim();
}

function yamlListIncludes(yaml, key, value) {
  const block = yamlSection(yaml, key);
  return block.split(/\r?\n/).some((line) => line.trim() === `- ${value}`);
}

function yamlSection(yaml, key) {
  const match = yaml.match(
    new RegExp(
      `(^|\\n)\\s*${escapeRegex(key)}:\\s*\\n([\\s\\S]*?)(?=\\n\\S|$)`,
    ),
  );
  return match?.[2] || "";
}

function phaseIdsFromYaml(yaml) {
  return [
    ...yamlSection(yaml, "phases").matchAll(/^\s{2}- id: ([^\n]+)$/gm),
  ].map((match) => match[1].trim());
}

function phaseBlock(yaml, phaseId) {
  const phases = yamlSection(yaml, "phases");
  const match = yaml.match(
    new RegExp(
      `(^|\\n)\\s{2}- id: ${escapeRegex(phaseId)}\\s*\\n([\\s\\S]*?)(?=\\n\\s{2}- id: |$)`,
    ),
  );
  const phaseMatch = phases.match(
    new RegExp(
      `(^|\\n)\\s{2}- id: ${escapeRegex(phaseId)}\\s*\\n([\\s\\S]*?)(?=\\n\\s{2}- id: |$)`,
    ),
  );
  return phaseMatch?.[0] || match?.[0] || "";
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function psql(sql) {
  return execFileSync("psql", [databaseUrl, "-tAc", sql], {
    encoding: "utf8",
  }).trim();
}

function sqlUuid(value) {
  return `'${sqlString(value)}'::uuid`;
}

function sqlString(value) {
  return String(value).replace(/'/g, "''");
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

function lowerEnum(value) {
  return String(value || "").toLowerCase();
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
