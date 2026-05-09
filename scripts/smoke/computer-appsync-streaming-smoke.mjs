#!/usr/bin/env node
/**
 * Smoke test the Computer AppSync streaming channel.
 *
 * Opens an AppSync realtime subscription for a temporary thread id, publishes
 * one `publishComputerThreadChunk` mutation through the GraphQL endpoint, and
 * exits non-zero if the subscribed socket does not receive the chunk.
 *
 * Env resolution:
 *   APPSYNC_ENDPOINT or VITE_GRAPHQL_URL
 *   APPSYNC_REALTIME_URL or VITE_GRAPHQL_WS_URL
 *   APPSYNC_API_KEY, GRAPHQL_API_KEY, or VITE_GRAPHQL_API_KEY
 *
 * By default this also reads apps/computer/.env when present. Override with
 * COMPUTER_ENV_FILE=/path/to/env, or set COMPUTER_ENV_FILE=none to skip.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15_000);
const THREAD_ID = process.env.SMOKE_THREAD_ID || `smoke-${crypto.randomUUID()}`;
const CHUNK_TEXT = process.env.SMOKE_CHUNK_TEXT || "hello-stream";

const env = {
  ...loadEnvFile(),
  ...process.env,
};

const graphqlUrl = first(
  env.APPSYNC_ENDPOINT,
  env.VITE_GRAPHQL_URL,
  env.GRAPHQL_URL,
);
const realtimeUrl = first(
  env.APPSYNC_REALTIME_URL,
  env.VITE_GRAPHQL_WS_URL,
  env.GRAPHQL_WS_URL,
);
const apiKey = first(
  env.APPSYNC_API_KEY,
  env.GRAPHQL_API_KEY,
  env.VITE_GRAPHQL_API_KEY,
);

if (!graphqlUrl || !realtimeUrl || !apiKey) {
  fail(
    "Missing AppSync config. Set APPSYNC_ENDPOINT, APPSYNC_REALTIME_URL, and APPSYNC_API_KEY, or provide apps/computer/.env.",
  );
}

if (typeof WebSocket !== "function") {
  fail("This smoke requires Node 20+ with global WebSocket support.");
}

const host = new URL(graphqlUrl).host;
const websocketUrl = buildRealtimeUrl({ realtimeUrl, host, apiKey });

const subscription = `
  subscription ComputerThreadChunk($threadId: ID!) {
    onComputerThreadChunk(threadId: $threadId) {
      threadId
      chunk
      seq
      publishedAt
    }
  }
`;

const mutation = `
  mutation PublishComputerThreadChunk($threadId: ID!, $chunk: AWSJSON!, $seq: Int!) {
    publishComputerThreadChunk(threadId: $threadId, chunk: $chunk, seq: $seq) {
      threadId
      chunk
      seq
      publishedAt
    }
  }
`;

let socket;
try {
  const result = await subscribeAndPublish();
  const chunk = parseChunk(result.chunk);
  if (result.threadId !== THREAD_ID) {
    fail(`Received chunk for wrong thread: ${result.threadId}`);
  }
  if (result.seq !== 1) {
    fail(`Received wrong sequence: ${result.seq}`);
  }
  if (chunk.text !== CHUNK_TEXT) {
    fail(`Received wrong chunk text: ${chunk.text}`);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        threadId: THREAD_ID,
        seq: result.seq,
        text: chunk.text,
        publishedAt: result.publishedAt,
      },
      null,
      2,
    ),
  );
} finally {
  try {
    socket?.close();
  } catch {
    // best effort
  }
}

process.exit(0);

async function subscribeAndPublish() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      rejectOnce(new Error("Timed out waiting for AppSync chunk"));
    }, TIMEOUT_MS);

    function rejectOnce(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    }

    function resolveOnce(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }

    socket = new WebSocket(websocketUrl, ["graphql-ws"]);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "connection_init" }));
    });

    socket.addEventListener("message", async (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "connection_ack") {
        socket.send(
          JSON.stringify({
            id: "1",
            type: "start",
            payload: {
              data: JSON.stringify({
                query: subscription,
                variables: { threadId: THREAD_ID },
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
        await publishChunk().catch(rejectOnce);
        return;
      }

      if (message.type === "data") {
        const chunk = message.payload?.data?.onComputerThreadChunk;
        if (chunk) resolveOnce(chunk);
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

async function publishChunk() {
  // Give AppSync a short moment to register the subscription start before the
  // NONE-datasource mutation fans out.
  await delay(500);
  const response = await fetch(graphqlUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query: mutation,
      variables: {
        threadId: THREAD_ID,
        chunk: JSON.stringify({ text: CHUNK_TEXT }),
        seq: 1,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Publish HTTP ${response.status}: ${await response.text()}`,
    );
  }

  const body = await response.json();
  if (body.errors?.length) {
    throw new Error(`Publish GraphQL errors: ${JSON.stringify(body.errors)}`);
  }
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
  console.error(`FAIL:${message}`);
  process.exit(1);
}
