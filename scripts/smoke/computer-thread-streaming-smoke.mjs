#!/usr/bin/env node
/**
 * Smoke test a real Computer thread turn streaming end-to-end.
 *
 * Creates a blank Computer thread, attaches an AppSync subscription before
 * sending the first user message, then asserts:
 *   1. at least one live chunk arrived,
 *   2. the durable assistant message persisted,
 *   3. live chunks do not duplicate text, and
 *   4. streamed text matches the persisted answer.
 *
 * Required env:
 *   DATABASE_URL
 *
 * Env resolution:
 *   VITE_GRAPHQL_HTTP_URL, APPSYNC_ENDPOINT, or GRAPHQL_HTTP_URL
 *   VITE_GRAPHQL_URL or APPSYNC_ENDPOINT
 *   VITE_GRAPHQL_WS_URL, APPSYNC_REALTIME_URL, or GRAPHQL_WS_URL
 *   VITE_GRAPHQL_API_KEY, APPSYNC_API_KEY, or GRAPHQL_API_KEY
 *
 * Computer identity can be supplied with SMOKE_TENANT_ID, SMOKE_COMPUTER_ID,
 * and SMOKE_USER_ID. If omitted, the script uses the most recently updated
 * shared Computer with a direct user assignment in the target database.
 *
 * By default this reads apps/computer/.env when present. Override with
 * COMPUTER_ENV_FILE=/path/to/env, or set COMPUTER_ENV_FILE=none to skip.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 180_000);
const SUBSCRIPTION_READY_DELAY_MS = Number(
  process.env.SMOKE_SUBSCRIPTION_READY_DELAY_MS || 3_000,
);
const EXPECTED_TEXT =
  process.env.SMOKE_EXPECTED_TEXT || "Streaming chunks are visible now.";

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
const appsyncUrl = first(
  env.VITE_GRAPHQL_URL,
  env.APPSYNC_ENDPOINT,
  env.GRAPHQL_URL,
);
const realtimeUrl = first(
  env.VITE_GRAPHQL_WS_URL,
  env.APPSYNC_REALTIME_URL,
  env.GRAPHQL_WS_URL,
);
const apiKey = first(
  env.VITE_GRAPHQL_API_KEY,
  env.APPSYNC_API_KEY,
  env.GRAPHQL_API_KEY,
);

if (!databaseUrl) fail("Missing DATABASE_URL.");
if (!apiUrl || !appsyncUrl || !realtimeUrl || !apiKey) {
  fail(
    "Missing GraphQL/AppSync config. Provide apps/computer/.env or set the VITE_GRAPHQL_* env vars.",
  );
}
if (typeof WebSocket !== "function") {
  fail("This smoke requires Node 20+ with global WebSocket support.");
}

const identity = resolveComputerIdentity(env);
const host = new URL(appsyncUrl).host;
const websocketUrl = buildRealtimeUrl({ realtimeUrl, host, apiKey });
const prompt = `Computer deterministic live streaming smoke ${new Date().toISOString()}: reply with exactly this sentence: ${EXPECTED_TEXT}`;

let socket;
try {
  const result = await runSmoke();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} finally {
  try {
    socket?.close();
  } catch {
    // best effort
  }
}

process.exit(0);

async function runSmoke() {
  const threadId = await createBlankThread();
  const chunks = [];

  await subscribeToChunks(threadId, chunks);
  await delay(SUBSCRIPTION_READY_DELAY_MS);
  await sendUserMessage(threadId);

  const persisted = await waitForPersistedAnswer(threadId);
  const parsedChunks = chunks.map((chunk) => ({
    seq: chunk.seq,
    text: parseChunk(chunk.chunk).text || "",
    publishedAt: chunk.publishedAt,
  }));
  const streamedText = parsedChunks.map((chunk) => chunk.text).join("");
  const duplicateAdjacent = parsedChunks.some(
    (chunk, index) => index > 0 && chunk.text === parsedChunks[index - 1].text,
  );
  const duplicateAny =
    new Set(parsedChunks.map((chunk) => chunk.text)).size !==
    parsedChunks.length;

  if (parsedChunks.length === 0) {
    fail(`No AppSync chunks received for thread ${threadId}.`);
  }
  if (duplicateAdjacent || duplicateAny) {
    fail(
      `Duplicate AppSync chunks received for thread ${threadId}: ${JSON.stringify(parsedChunks)}`,
    );
  }
  if (streamedText.trim() !== persisted.assistant.trim()) {
    fail(
      `Streamed text did not match persisted answer for thread ${threadId}: streamed=${JSON.stringify(streamedText)} assistant=${JSON.stringify(persisted.assistant)}`,
    );
  }
  if (persisted.assistant.trim() !== EXPECTED_TEXT) {
    fail(
      `Persisted answer did not match expected text for thread ${threadId}: ${JSON.stringify(persisted.assistant)}`,
    );
  }
  if (persisted.taskStatus.toLowerCase() !== "completed") {
    fail(
      `Computer task did not complete for thread ${threadId}: ${persisted.taskStatus}`,
    );
  }

  return {
    threadId,
    computerId: identity.computerId,
    tenantId: identity.tenantId,
    chunkCount: parsedChunks.length,
    chunks: parsedChunks,
    streamedText,
    taskStatus: persisted.taskStatus,
    assistant: persisted.assistant,
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
        title: "Computer deterministic streaming smoke",
        channel: "CHAT",
        createdByType: "user",
        createdById: identity.userId,
      },
    },
  );
  const threadId = data.createThread?.id;
  if (!threadId) fail("createThread returned no thread id.");
  return threadId;
}

async function subscribeToChunks(threadId, chunks) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      rejectOnce(new Error("Timed out waiting for AppSync subscription ack"));
    }, 10_000);

    function rejectOnce(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    }

    function resolveOnce() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    }

    socket = new WebSocket(websocketUrl, ["graphql-ws"]);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "connection_init" }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "connection_ack") {
        socket.send(
          JSON.stringify({
            id: "1",
            type: "start",
            payload: {
              data: JSON.stringify({
                query: `
                  subscription ComputerThreadChunk($threadId: ID!) {
                    onComputerThreadChunk(threadId: $threadId) {
                      threadId
                      chunk
                      seq
                      publishedAt
                    }
                  }
                `,
                variables: { threadId },
              }),
              extensions: {
                authorization: {
                  host,
                  "x-api-key": apiKey,
                },
              },
            },
          }),
        );
        resolveOnce();
        return;
      }
      if (message.type === "data") {
        const chunk = message.payload?.data?.onComputerThreadChunk;
        if (chunk) chunks.push(chunk);
        return;
      }
      if (message.type === "error") {
        rejectOnce(
          new Error(`AppSync error: ${JSON.stringify(message.payload)}`),
        );
      }
    });
    socket.addEventListener("error", () => {
      rejectOnce(new Error("WebSocket error while connecting to AppSync"));
    });
  });
}

async function sendUserMessage(threadId) {
  await gql(
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
}

async function waitForPersistedAnswer(threadId) {
  const started = Date.now();
  while (Date.now() - started < TIMEOUT_MS) {
    const taskStatus = psql(
      `select coalesce(status,'') from computer_tasks where input->>'threadId'='${threadId}' order by created_at desc limit 1`,
    );
    const assistant = psql(
      `select coalesce(left(content,500),'') from messages where thread_id='${threadId}'::uuid and role='assistant' order by created_at desc limit 1`,
    );
    if (assistant && taskStatus.toLowerCase() !== "running") {
      return { assistant, taskStatus };
    }
    if (taskStatus.toLowerCase() === "failed") {
      fail(`Computer task failed for thread ${threadId}.`);
    }
    await delay(5_000);
  }
  fail(
    `Timed out waiting for persisted assistant response for thread ${threadId}.`,
  );
}

async function gql(query, variables) {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "x-tenant-id": identity.tenantId,
      "x-principal-id": identity.userId,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    fail(`GraphQL HTTP ${response.status}: ${await response.text()}`);
  }
  const body = await response.json();
  if (body.errors?.length) {
    fail(`GraphQL errors: ${JSON.stringify(body.errors)}`);
  }
  return body.data;
}

function resolveComputerIdentity(source) {
  const supplied = {
    tenantId: first(source.SMOKE_TENANT_ID, source.TENANT_ID),
    computerId: first(source.SMOKE_COMPUTER_ID, source.COMPUTER_ID),
    userId: first(source.SMOKE_USER_ID, source.USER_ID),
  };
  if (supplied.tenantId && supplied.computerId && supplied.userId) {
    return supplied;
  }

  const row = psql(`
    select c.tenant_id::text || '|' || c.id::text || '|' || ca.user_id::text
    from computers c
    join computer_assignments ca
      on ca.tenant_id = c.tenant_id
     and ca.computer_id = c.id
     and ca.subject_type = 'user'
     and ca.user_id is not null
    where c.scope = 'shared'
      and c.status <> 'archived'
    order by c.updated_at desc nulls last, c.created_at desc, ca.created_at asc
    limit 1
  `);
  const [tenantId, computerId, userId] = row.split("|");
  if (!tenantId || !computerId || !userId) {
    fail(
      "Could not resolve a Computer identity. Set SMOKE_TENANT_ID, SMOKE_COMPUTER_ID, and SMOKE_USER_ID.",
    );
  }
  return { tenantId, computerId, userId };
}

function psql(sql) {
  return execFileSync("psql", [databaseUrl, "-tAc", sql], {
    encoding: "utf8",
  }).trim();
}

function buildRealtimeUrl({ realtimeUrl, host, apiKey }) {
  const header = Buffer.from(
    JSON.stringify({
      host,
      "x-api-key": apiKey,
    }),
  ).toString("base64");
  return `${normalizeWebSocketUrl(realtimeUrl)}?header=${encodeURIComponent(
    header,
  )}&payload=e30=`;
}

function normalizeWebSocketUrl(value) {
  const url = new URL(value);
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol === "http:") url.protocol = "ws:";
  return `${url.protocol}//${url.host}${url.pathname || "/graphql"}`;
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

function parseChunk(value) {
  if (typeof value !== "string") return value || {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
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
