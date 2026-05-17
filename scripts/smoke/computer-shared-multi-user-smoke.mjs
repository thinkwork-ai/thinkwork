#!/usr/bin/env node
/**
 * Smoke test the shared Computer requester boundary with two assigned users.
 *
 * The check creates one chat thread for each user against the same shared
 * Computer, verifies the persisted thread/task requester identity, then proves
 * user B cannot append a message to user A's thread.
 *
 * Required env:
 *   DATABASE_URL
 *   VITE_GRAPHQL_HTTP_URL, GRAPHQL_HTTP_URL, or API_GRAPHQL_URL
 *   VITE_GRAPHQL_API_KEY, GRAPHQL_API_KEY, API_AUTH_SECRET, or THINKWORK_API_SECRET
 *
 * Optional identity overrides:
 *   SMOKE_TENANT_ID, SMOKE_COMPUTER_ID, SMOKE_USER_A_ID, SMOKE_USER_B_ID
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

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
const apiKey = first(
  env.VITE_GRAPHQL_API_KEY,
  env.GRAPHQL_API_KEY,
  env.API_AUTH_SECRET,
  env.THINKWORK_API_SECRET,
);

if (!databaseUrl) fail("Missing DATABASE_URL.");
if (!apiUrl || !apiKey) {
  fail(
    "Missing GraphQL config. Provide apps/computer/.env or VITE_GRAPHQL_* env vars.",
  );
}

const identity = resolveSharedComputerPair(env);

const threadA = await createThreadForUser(identity.userAId, "A");
const threadB = await createThreadForUser(identity.userBId, "B");

assertThreadRequester(threadA.id, identity.userAId);
assertThreadRequester(threadB.id, identity.userBId);
assertTaskRequester(threadA.id, identity.userAId);
assertTaskRequester(threadB.id, identity.userBId);
await assertWrongUserCannotAppend(threadA.id, identity.userBId);

console.log(
  JSON.stringify(
    {
      ok: true,
      tenantId: identity.tenantId,
      computerId: identity.computerId,
      userAId: identity.userAId,
      userBId: identity.userBId,
      threadAId: threadA.id,
      threadBId: threadB.id,
    },
    null,
    2,
  ),
);

async function createThreadForUser(userId, label) {
  const data = await gql(
    `
      mutation CreateThread($input: CreateThreadInput!) {
        createThread(input: $input) {
          id
          userId
        }
      }
    `,
    {
      input: {
        tenantId: identity.tenantId,
        computerId: identity.computerId,
        title: `Shared Computer multi-user smoke ${label}`,
        channel: "CHAT",
        createdByType: "user",
        createdById: userId,
        firstMessage: `Shared Computer multi-user smoke ${label}`,
      },
    },
    userId,
  );
  const thread = data.createThread;
  if (!thread?.id)
    fail(`createThread returned no thread id for user ${userId}.`);
  if (thread.userId !== userId) {
    fail(
      `createThread returned wrong userId for ${thread.id}: expected ${userId}, got ${thread.userId}`,
    );
  }
  return thread;
}

async function assertWrongUserCannotAppend(threadId, userId) {
  const response = await rawGql(
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
        content: "This should be rejected by the requester boundary.",
      },
    },
    userId,
  );
  const message = response.errors?.[0]?.message || "";
  if (!message.includes("Thread does not belong to requester")) {
    fail(
      `Expected wrong-user sendMessage to fail for thread ${threadId}, got ${JSON.stringify(response)}`,
    );
  }
}

function assertThreadRequester(threadId, expectedUserId) {
  const actual = psql(
    `select coalesce(user_id::text,'') from threads where id='${threadId}'::uuid`,
  );
  if (actual !== expectedUserId) {
    fail(
      `Thread ${threadId} user_id mismatch: expected ${expectedUserId}, got ${actual}`,
    );
  }
}

function assertTaskRequester(threadId, expectedUserId) {
  const row = psql(`
    select coalesce(created_by_user_id::text,'') || '|' || coalesce(input->>'requesterUserId','')
    from computer_tasks
    where input->>'threadId'='${threadId}'
    order by created_at desc
    limit 1
  `);
  const [createdByUserId, requesterUserId] = row.split("|");
  if (
    createdByUserId !== expectedUserId ||
    requesterUserId !== expectedUserId
  ) {
    fail(
      `Task requester mismatch for thread ${threadId}: created_by_user_id=${createdByUserId}, requesterUserId=${requesterUserId}, expected ${expectedUserId}`,
    );
  }
}

async function gql(query, variables, principalId) {
  const body = await rawGql(query, variables, principalId);
  if (body.errors?.length) {
    fail(`GraphQL errors: ${JSON.stringify(body.errors)}`);
  }
  return body.data;
}

async function rawGql(query, variables, principalId) {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "x-tenant-id": identity.tenantId,
      "x-principal-id": principalId,
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json().catch(async () => ({
    errors: [{ message: await response.text() }],
  }));
  if (!response.ok) {
    fail(`GraphQL HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function resolveSharedComputerPair(source) {
  const supplied = {
    tenantId: first(source.SMOKE_TENANT_ID, source.TENANT_ID),
    computerId: first(source.SMOKE_COMPUTER_ID, source.COMPUTER_ID),
    userAId: first(
      source.SMOKE_USER_A_ID,
      source.USER_A_ID,
      source.SMOKE_USER_ID,
    ),
    userBId: first(source.SMOKE_USER_B_ID, source.USER_B_ID),
  };
  if (
    supplied.tenantId &&
    supplied.computerId &&
    supplied.userAId &&
    supplied.userBId
  ) {
    return supplied;
  }

  const row = psql(`
    select
      c.tenant_id::text || '|' ||
      c.id::text || '|' ||
      min(ca.user_id::text) || '|' ||
      max(ca.user_id::text)
    from computers c
    join computer_assignments ca
      on ca.tenant_id = c.tenant_id
     and ca.computer_id = c.id
     and ca.subject_type = 'user'
     and ca.user_id is not null
    where c.scope = 'shared'
      and c.status <> 'archived'
    group by c.tenant_id, c.id
    having count(distinct ca.user_id) >= 2
    order by max(c.updated_at) desc nulls last, max(c.created_at) desc
    limit 1
  `);
  const [tenantId, computerId, userAId, userBId] = row.split("|");
  if (!tenantId || !computerId || !userAId || !userBId || userAId === userBId) {
    fail(
      "Could not resolve a shared Computer with two direct user assignments. Set SMOKE_TENANT_ID, SMOKE_COMPUTER_ID, SMOKE_USER_A_ID, and SMOKE_USER_B_ID.",
    );
  }
  return { tenantId, computerId, userAId, userBId };
}

function psql(sql) {
  return execFileSync("psql", [databaseUrl, "-tAc", sql], {
    encoding: "utf8",
  }).trim();
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

function first(...values) {
  return values.find((value) => typeof value === "string" && value.length > 0);
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}
