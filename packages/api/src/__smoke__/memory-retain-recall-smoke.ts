#!/usr/bin/env tsx
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Args {
  tenantId: string;
  agentId: string;
  senderId: string;
  graphqlUrl: string;
  apiKey: string;
  timeoutMs: number;
  json: boolean;
}

interface GraphQlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface Thread {
  id: string;
  identifier?: string | null;
}

interface Message {
  id: string;
  role: string;
  content: string | null;
}

interface ThreadTurn {
  id: string;
  status: string;
  error?: string | null;
  usageJson?: unknown;
  resultJson?: unknown;
}

interface MemoryRecord {
  memoryRecordId: string;
  content?: { text?: string | null } | null;
  ownerType?: string | null;
  ownerId?: string | null;
  threadId?: string | null;
}

interface MemoryRetainAttempt {
  id: string;
  status: string;
  attemptCount?: number | null;
  errorClass?: string | null;
  errorMessage?: string | null;
}

const RETAINED_STATUSES = new Set(["retained"]);
const TERMINAL_FAILURE_STATUSES = new Set(["dead_lettered"]);

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    dir = resolve(dir, "..");
  }
  return process.cwd();
}

function readDotEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const values: Record<string, string> = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    values[line.slice(0, idx)] = line.slice(idx + 1).replace(/^"|"$/g, "");
  }
  return values;
}

function usage(exitCode = 2): never {
  console.error(`Usage:
  pnpm --filter @thinkwork/api memory:retain-recall-smoke -- \\
    --tenant-id <tenant-id> --agent-id <agent-id> --sender-id <user-id> \\
    [--timeout 180000] [--json]

Environment:
  THINKWORK_GRAPHQL_URL / THINKWORK_GRAPHQL_API_KEY
  or SMOKE_GRAPHQL_HTTP_URL / GRAPHQL_API_KEY
  or apps/web/.env with VITE_GRAPHQL_HTTP_URL / VITE_GRAPHQL_API_KEY`);
  process.exit(exitCode);
}

function parseArgs(): Args {
  const env = readDotEnv(resolve(repoRoot(), "apps/web/.env"));
  const argv = process.argv.slice(2);
  let tenantId =
    process.env.THINKWORK_TENANT_ID || process.env.SMOKE_TENANT_ID || "";
  let agentId =
    process.env.THINKWORK_AGENT_ID || process.env.SMOKE_AGENT_ID || "";
  let senderId =
    process.env.THINKWORK_USER_ID ||
    process.env.PI_SMOKE_SENDER_ID ||
    process.env.SMOKE_USER_ID ||
    "";
  let timeoutMs = Number(process.env.MEMORY_SMOKE_TIMEOUT_MS || 180_000);
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--tenant-id") tenantId = argv[++i] || "";
    else if (arg === "--agent-id") agentId = argv[++i] || "";
    else if (arg === "--sender-id") senderId = argv[++i] || "";
    else if (arg === "--timeout") timeoutMs = Number(argv[++i] || timeoutMs);
    else if (arg === "--json") json = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      usage();
    }
  }

  const graphqlUrl =
    process.env.THINKWORK_GRAPHQL_URL ||
    process.env.SMOKE_GRAPHQL_HTTP_URL ||
    process.env.VITE_GRAPHQL_HTTP_URL ||
    env.VITE_GRAPHQL_HTTP_URL ||
    "";
  const apiKey =
    process.env.THINKWORK_GRAPHQL_API_KEY ||
    process.env.GRAPHQL_API_KEY ||
    process.env.VITE_GRAPHQL_API_KEY ||
    env.VITE_GRAPHQL_API_KEY ||
    "";

  if (!tenantId || !agentId || !senderId || !graphqlUrl || !apiKey) usage();
  return { tenantId, agentId, senderId, graphqlUrl, apiKey, timeoutMs, json };
}

async function gql<T>(
  args: Args,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(args.graphqlUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": args.apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await response.json()) as GraphQlResponse<T>;
  if (!response.ok || body.errors?.length) {
    throw new Error(
      `GraphQL failed: ${response.status} ${JSON.stringify(body.errors ?? body)}`,
    );
  }
  return body.data as T;
}

async function createThread(args: Args, title: string): Promise<Thread> {
  const data = await gql<{ createThread: Thread }>(
    args,
    `mutation($input: CreateThreadInput!) {
      createThread(input: $input) {
        id
        identifier
      }
    }`,
    {
      input: {
        tenantId: args.tenantId,
        agentId: args.agentId,
        title,
        channel: "CHAT",
        createdByType: "user",
        createdById: args.senderId,
      },
    },
  );
  return data.createThread;
}

async function sendMessage(args: Args, threadId: string, content: string) {
  await gql<{ sendMessage: { id: string } }>(
    args,
    `mutation($input: SendMessageInput!) {
      sendMessage(input: $input) {
        id
      }
    }`,
    {
      input: {
        threadId,
        role: "USER",
        content,
        senderType: "user",
        senderId: args.senderId,
      },
    },
  );
}

async function readThreadState(args: Args, threadId: string) {
  return gql<{
    messages: { edges: Array<{ node: Message }> };
    threadTurns: ThreadTurn[];
  }>(
    args,
    `query($tenantId: ID!, $threadId: ID!) {
      messages(threadId: $threadId, limit: 20) {
        edges {
          node {
            id
            role
            content
          }
        }
      }
      threadTurns(tenantId: $tenantId, threadId: $threadId, limit: 10) {
        id
        status
        error
        usageJson
        resultJson
      }
    }`,
    { tenantId: args.tenantId, threadId },
  );
}

async function waitForTurn(args: Args, threadId: string) {
  const deadline = Date.now() + args.timeoutMs;
  let latest = await readThreadState(args, threadId);
  while (Date.now() < deadline) {
    latest = await readThreadState(args, threadId);
    const assistant = latest.messages.edges.find(
      ({ node }) => node.role === "ASSISTANT",
    )?.node;
    const turn = latest.threadTurns[0];
    if (
      assistant &&
      turn &&
      turn.status !== "running" &&
      turn.status !== "queued"
    ) {
      if (turn.status !== "succeeded") {
        throw new Error(
          `turn ${turn.id} finished with status=${turn.status} error=${turn.error ?? ""}`,
        );
      }
      return { assistant, turn };
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error(
    `timeout waiting for assistant response on thread ${threadId}`,
  );
}

async function memoryRecords(
  args: Args,
  query: string,
): Promise<MemoryRecord[]> {
  const data = await gql<{ memoryRecords: MemoryRecord[] }>(
    args,
    `query($tenantId: ID!, $query: String) {
      memoryRecords(
        tenantId: $tenantId
        namespace: "requester"
        scope: OPERATOR
        query: $query
        limit: 50
      ) {
        memoryRecordId
        content { text }
        ownerType
        ownerId
        threadId
      }
    }`,
    { tenantId: args.tenantId, query },
  );
  return data.memoryRecords ?? [];
}

async function retainAttempts(
  args: Args,
  threadId: string,
): Promise<MemoryRetainAttempt[]> {
  const data = await gql<{ memoryRetainAttempts: MemoryRetainAttempt[] }>(
    args,
    `query($tenantId: ID!, $threadId: ID!) {
      memoryRetainAttempts(tenantId: $tenantId, threadId: $threadId, limit: 10) {
        id
        status
        attemptCount
        errorClass
        errorMessage
      }
    }`,
    { tenantId: args.tenantId, threadId },
  );
  return data.memoryRetainAttempts ?? [];
}

async function waitForRetainedMemory(
  args: Args,
  threadId: string,
  token: string,
) {
  const deadline = Date.now() + args.timeoutMs;
  let latestAttempts: MemoryRetainAttempt[] = [];
  let latestRecords: MemoryRecord[] = [];

  while (Date.now() < deadline) {
    latestAttempts = await retainAttempts(args, threadId);
    latestRecords = await memoryRecords(args, token);
    const record = latestRecords.find((candidate) =>
      candidate.content?.text?.toLowerCase().includes(token.toLowerCase()),
    );
    const retained = latestAttempts.some((attempt) =>
      RETAINED_STATUSES.has(attempt.status),
    );
    if (retained && record) return { attempt: latestAttempts[0], record };
    const failed = latestAttempts.find((attempt) =>
      TERMINAL_FAILURE_STATUSES.has(attempt.status),
    );
    if (failed) {
      throw new Error(
        `retain attempt dead-lettered: ${failed.errorClass ?? ""} ${failed.errorMessage ?? ""}`.trim(),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  throw new Error(
    `timeout waiting for retained memory token=${token}; attempts=${JSON.stringify(
      latestAttempts,
    )}; records=${latestRecords.length}`,
  );
}

function makeToken(): { petName: string; toyName: string } {
  const suffix = Date.now().toString().slice(-8);
  return {
    petName: `Nori${suffix}`,
    toyName: `Lumen${suffix}`,
  };
}

async function main() {
  const args = parseArgs();
  const { petName, toyName } = makeToken();
  const retainThread = await createThread(
    args,
    `Memory retain smoke ${toyName}`,
  );
  const retainPrompt = `Memory verification: We brought home a poodle named ${petName}. ${petName}'s favorite blue rope toy is named ${toyName}.`;
  await sendMessage(args, retainThread.id, retainPrompt);
  await waitForTurn(args, retainThread.id);
  const retained = await waitForRetainedMemory(args, retainThread.id, toyName);

  const recallThread = await createThread(
    args,
    `Memory recall smoke ${toyName}`,
  );
  await sendMessage(
    args,
    recallThread.id,
    `What is my poodle ${petName}'s favorite blue rope toy named? Answer with just the toy name if memory has it.`,
  );
  const recalled = await waitForTurn(args, recallThread.id);
  const answer = recalled.assistant.content ?? "";
  if (!answer.toLowerCase().includes(toyName.toLowerCase())) {
    throw new Error(
      `recall answer did not include ${toyName}; answer=${JSON.stringify(answer)}`,
    );
  }

  const result = {
    status: "PASS",
    petName,
    toyName,
    retainThreadId: retainThread.id,
    recallThreadId: recallThread.id,
    retainAttemptId: retained.attempt.id,
    memoryRecordId: retained.record.memoryRecordId,
    recallTurnId: recalled.turn.id,
    answer,
  };
  if (args.json) console.log(JSON.stringify(result));
  else {
    console.log(
      `PASS: retained ${toyName} in thread=${retainThread.identifier ?? retainThread.id}; recalled in thread=${recallThread.identifier ?? recallThread.id}`,
    );
  }
}

main().catch((err) => {
  console.error("[memory-retain-recall-smoke] FAIL", err);
  process.exit(1);
});
