#!/usr/bin/env tsx
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type Capability = "plain" | "web_search" | "execute_code" | "hindsight" | "mcp";

interface Args {
  tenantId: string;
  agentId: string;
  capabilities: Capability[];
  timeoutMs: number;
  graphqlUrl: string;
  apiKey: string;
  json: boolean;
}

interface GraphQlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface Thread {
  id: string;
  identifier: string;
  title: string;
}

interface Message {
  id: string;
  role: string;
  content: string | null;
  createdAt: string;
}

interface ThreadTurn {
  id: string;
  status: string;
  threadId: string | null;
  resultJson?: { response?: string };
  usageJson?: {
    tools_called?: unknown;
    tool_invocations?: unknown;
    duration_ms?: number;
  };
  error?: string | null;
  createdAt: string;
}

interface SmokeResult {
  capability: Capability;
  status: "PASS" | "FAIL" | "SKIP";
  reason?: string;
  threadId?: string;
  threadIdentifier?: string;
  turnId?: string;
  assistantMessageId?: string;
  response?: string | null;
  evidence?: Record<string, unknown>;
}

const ALL_CAPABILITIES: Capability[] = [
  "plain",
  "web_search",
  "execute_code",
  "hindsight",
  "mcp",
];

function usage(exitCode = 2): never {
  console.error(`Usage:
  pnpm --filter @thinkwork/api pi:capability-smoke -- \\
    --tenant-id <tenant-id> \\
    --agent-id <agent-id> \\
    [--capability plain,web_search,execute_code,hindsight,mcp] \\
    [--timeout 90000] [--json]

Environment:
  THINKWORK_GRAPHQL_URL / THINKWORK_GRAPHQL_API_KEY
  or apps/admin/.env with VITE_GRAPHQL_HTTP_URL / VITE_GRAPHQL_API_KEY`);
  process.exit(exitCode);
}

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

function parseArgs(): Args {
  const env = readDotEnv(resolve(repoRoot(), "apps/admin/.env"));
  const args = process.argv.slice(2);
  let tenantId = process.env.THINKWORK_TENANT_ID || "";
  let agentId = process.env.THINKWORK_AGENT_ID || "";
  let capabilityValue = process.env.PI_SMOKE_CAPABILITIES || "plain";
  let timeoutMs = Number(process.env.PI_SMOKE_TIMEOUT_MS || 90_000);
  let json = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--tenant-id") tenantId = args[++i] || "";
    else if (arg === "--agent-id") agentId = args[++i] || "";
    else if (arg === "--capability" || arg === "--capabilities") {
      capabilityValue = args[++i] || "";
    } else if (arg === "--timeout") {
      timeoutMs = Number(args[++i] || timeoutMs);
    } else if (arg === "--json") {
      json = true;
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage();
    }
  }

  const capabilities =
    capabilityValue === "all"
      ? ALL_CAPABILITIES
      : capabilityValue.split(",").map((c) => c.trim()).filter(Boolean);
  for (const capability of capabilities) {
    if (!ALL_CAPABILITIES.includes(capability as Capability)) {
      console.error(`Unknown capability: ${capability}`);
      usage();
    }
  }

  const graphqlUrl =
    process.env.THINKWORK_GRAPHQL_URL ||
    process.env.VITE_GRAPHQL_HTTP_URL ||
    env.VITE_GRAPHQL_HTTP_URL ||
    "";
  const apiKey =
    process.env.THINKWORK_GRAPHQL_API_KEY ||
    process.env.VITE_GRAPHQL_API_KEY ||
    env.VITE_GRAPHQL_API_KEY ||
    "";

  if (!tenantId || !agentId || !graphqlUrl || !apiKey) usage();
  return {
    tenantId,
    agentId,
    capabilities: capabilities as Capability[],
    timeoutMs,
    graphqlUrl,
    apiKey,
    json,
  };
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

async function createThread(args: Args, capability: Capability): Promise<Thread> {
  const stamp = new Date().toISOString();
  const data = await gql<{ createThread: Thread }>(
    args,
    `mutation($input: CreateThreadInput!) {
      createThread(input: $input) {
        id
        identifier
        title
      }
    }`,
    {
      input: {
        tenantId: args.tenantId,
        agentId: args.agentId,
        title: `Pi ${capability} smoke ${stamp}`,
        channel: "CHAT",
        createdByType: "user",
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
            createdAt
          }
        }
      }
      threadTurns(tenantId: $tenantId, threadId: $threadId, limit: 10) {
        id
        status
        threadId
        resultJson
        usageJson
        error
        createdAt
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
      return { assistant, turn, state: latest };
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  const turn = latest.threadTurns[0];
  throw new Error(
    `timeout waiting for assistant response; latest turn=${turn?.id ?? "none"} status=${turn?.status ?? "none"}`,
  );
}

function hasToolEvidence(turn: ThreadTurn, patterns: RegExp[]): boolean {
  const usage = turn.usageJson ?? {};
  const values: unknown[] = [];
  const toolsCalled = usage.tools_called;
  const invocations = usage.tool_invocations;

  if (Array.isArray(toolsCalled)) values.push(...toolsCalled);
  if (Array.isArray(invocations)) {
    for (const invocation of invocations) {
      if (invocation && typeof invocation === "object") {
        const record = invocation as Record<string, unknown>;
        values.push(
          record.name,
          record.tool,
          record.toolName,
          record.tool_name,
          record.server,
          record.serverName,
          record.server_name,
        );
      } else {
        values.push(invocation);
      }
    }
  }

  const text = values
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (!text) return false;
  return patterns.some((pattern) => pattern.test(text));
}

function promptFor(capability: Capability, token: string): string {
  switch (capability) {
    case "plain":
      return `Thread message smoke for Pi runtime. Reply exactly: ${token}`;
    case "web_search":
      return [
        "Use the web_search tool to search the web for the current OpenAI news page title.",
        `After using the tool, reply with ${token} and the title you found.`,
        "Do not answer from memory; use the tool.",
      ].join(" ");
    case "execute_code":
      return [
        "Use the code sandbox or execute_code tool to run Python that computes sum(i*i for i in range(1, 11)).",
        `After executing code, reply exactly: ${token} 385.`,
        "Do not calculate mentally; use the tool.",
      ].join(" ");
    case "hindsight":
      return [
        `Remember this durable Hindsight smoke fact: ${token}.`,
        "Use memory tooling if available, then reply with the token.",
      ].join(" ");
    case "mcp":
      return [
        "Use one configured MCP server/tool available to this agent for a safe read-only call.",
        `After the MCP tool returns, reply with ${token} and the tool name.`,
        "Do not invent a tool result.",
      ].join(" ");
  }
}

function evaluate(capability: Capability, token: string, turn: ThreadTurn, assistant: Message): SmokeResult {
  const base: SmokeResult = {
    capability,
    status: "FAIL",
    turnId: turn.id,
    threadId: turn.threadId ?? undefined,
    assistantMessageId: assistant.id,
    response: assistant.content,
    evidence: {
      usageJson: turn.usageJson ?? null,
      resultJson: turn.resultJson ?? null,
    },
  };

  if (turn.status !== "succeeded") {
    return { ...base, reason: `turn_status_${turn.status}`, evidence: { ...base.evidence, error: turn.error } };
  }

  if (!assistant.content?.includes(token)) {
    return { ...base, reason: "assistant_response_missing_expected_token" };
  }

  if (capability === "plain") {
    return { ...base, status: "PASS", reason: "assistant_message_persisted" };
  }

  const patterns: Record<Exclude<Capability, "plain">, RegExp[]> = {
    web_search: [/web[-_ ]?search/, /search/],
    execute_code: [/execute_code/, /sandbox/, /code/],
    hindsight: [/hindsight/, /memory/, /retain/, /reflect/, /recall/],
    mcp: [/mcp/, /server/],
  };

  if (!hasToolEvidence(turn, patterns[capability])) {
    return { ...base, reason: "no_tool_evidence_in_thread_turn_usage_json" };
  }

  return { ...base, status: "PASS", reason: "tool_evidence_present" };
}

async function runCapability(args: Args, capability: Capability): Promise<SmokeResult> {
  const thread = await createThread(args, capability);
  const token = `PI-${capability.toUpperCase().replace(/_/g, "-")}-SMOKE-${Date.now()}`;
  try {
    await sendMessage(args, thread.id, promptFor(capability, token));
    const { assistant, turn } = await waitForTurn(args, thread.id);
    const result = evaluate(capability, token, turn, assistant);
    return {
      ...result,
      threadId: thread.id,
      threadIdentifier: thread.identifier,
    };
  } catch (err) {
    return {
      capability,
      status: "FAIL",
      reason: err instanceof Error ? err.message : String(err),
      threadId: thread.id,
      threadIdentifier: thread.identifier,
    };
  }
}

async function main() {
  const args = parseArgs();
  const results: SmokeResult[] = [];
  for (const capability of args.capabilities) {
    const result = await runCapability(args, capability);
    results.push(result);
    const line = JSON.stringify(result);
    if (args.json) console.log(line);
    else {
      console.log(
        `${result.status}: ${capability} thread=${result.threadIdentifier ?? result.threadId} turn=${result.turnId ?? "n/a"} reason=${result.reason ?? ""}`,
      );
    }
  }

  const failed = results.filter((result) => result.status === "FAIL");
  if (!args.json) {
    console.log(
      `Pi capability smoke summary: ${results.length - failed.length}/${results.length} passed`,
    );
  }
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
