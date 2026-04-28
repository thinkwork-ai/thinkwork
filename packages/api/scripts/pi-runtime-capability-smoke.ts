#!/usr/bin/env tsx
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type Capability = "plain" | "web_search" | "execute_code" | "hindsight" | "mcp";

interface Args {
  tenantId: string;
  agentId: string;
  senderId?: string;
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

interface TenantMember {
  principalType: string;
  principalId: string;
  status: string;
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
    [--sender-id <human-user-id>] \\
    [--capability plain,web_search,execute_code,hindsight,mcp] \\
    [--timeout 90000] [--json]

Environment:
  THINKWORK_GRAPHQL_URL / THINKWORK_GRAPHQL_API_KEY
  THINKWORK_USER_ID or PI_SMOKE_SENDER_ID for sandbox-backed execute_code
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
  let senderId =
    process.env.PI_SMOKE_SENDER_ID || process.env.THINKWORK_USER_ID || "";
  let capabilityValue = process.env.PI_SMOKE_CAPABILITIES || "plain";
  let timeoutMs = Number(process.env.PI_SMOKE_TIMEOUT_MS || 90_000);
  let json = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--tenant-id") tenantId = args[++i] || "";
    else if (arg === "--agent-id") agentId = args[++i] || "";
    else if (arg === "--sender-id") senderId = args[++i] || "";
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
      : capabilityValue
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean);
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
    senderId: senderId || undefined,
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

async function createThread(
  args: Args,
  capability: Capability,
): Promise<Thread> {
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
        createdById: args.senderId,
      },
    },
  );
  return data.createThread;
}

async function verifySender(args: Args, capability: Capability): Promise<void> {
  if (capability !== "execute_code" && capability !== "hindsight") return;
  if (!args.senderId) {
    throw new Error(
      `${capability} smoke requires --sender-id for user-scoped sandbox/memory`,
    );
  }
  const data = await gql<{ tenantMembers: TenantMember[] }>(
    args,
    `query($tenantId: ID!) {
      tenantMembers(tenantId: $tenantId) {
        principalType
        principalId
        status
      }
    }`,
    { tenantId: args.tenantId },
  );
  const matched = data.tenantMembers.some(
    (member) =>
      member.principalType.toLowerCase() === "user" &&
      member.principalId === args.senderId &&
      member.status === "active",
  );
  if (!matched) {
    throw new Error(
      `sender ${args.senderId} is not an active user member of tenant ${args.tenantId}`,
    );
  }
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
        senderType: args.senderId ? "human" : "user",
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

function invocationRecords(turn: ThreadTurn): Array<Record<string, unknown>> {
  const invocations = turn.usageJson?.tool_invocations;
  if (!Array.isArray(invocations)) return [];
  return invocations.filter(
    (invocation): invocation is Record<string, unknown> =>
      Boolean(invocation) && typeof invocation === "object",
  );
}

function invocationName(invocation: Record<string, unknown>): string {
  return String(
    invocation.name ??
      invocation.tool ??
      invocation.toolName ??
      invocation.tool_name ??
      invocation.server ??
      invocation.serverName ??
      invocation.server_name ??
      "",
  ).toLowerCase();
}

function invocationBlob(invocation: Record<string, unknown>): string {
  return JSON.stringify(invocation).toLowerCase();
}

function matchingSuccessfulInvocations(
  turn: ThreadTurn,
  patterns: RegExp[],
): Array<Record<string, unknown>> {
  return invocationRecords(turn).filter((invocation) => {
    const text = `${invocationName(invocation)} ${invocationBlob(invocation)}`;
    return (
      invocation.is_error !== true &&
      patterns.some((pattern) => pattern.test(text))
    );
  });
}

function hasWebSearchResult(invocation: Record<string, unknown>): boolean {
  const blob = invocationBlob(invocation);
  if (
    /"result_count"\s*:\s*[1-9]/.test(blob) ||
    /"results"\s*:\s*\[\s*\{/.test(blob)
  ) {
    return true;
  }

  for (const key of ["output", "output_preview", "result", "result_preview"]) {
    const value = invocation[key];
    if (typeof value !== "string") continue;
    try {
      const parsed = JSON.parse(value) as {
        result_count?: unknown;
        results?: unknown;
      };
      if (
        typeof parsed.result_count === "number" &&
        parsed.result_count > 0
      ) {
        return true;
      }
      if (Array.isArray(parsed.results) && parsed.results.length > 0) {
        return true;
      }
    } catch {
      if (
        /"result_count"\s*:\s*[1-9]/.test(value) ||
        /"results"\s*:\s*\[\s*\{/.test(value)
      ) {
        return true;
      }
    }
  }
  return false;
}

function hasExecuteCodeResult(invocation: Record<string, unknown>): boolean {
  const blob = invocationBlob(invocation);
  return (
    /"ok"\s*:\s*true/.test(blob) &&
    (blob.includes("385") || /"exit_code"\s*:\s*0/.test(blob))
  );
}

function hasHindsightResult(
  invocation: Record<string, unknown>,
): boolean {
  const blob = invocationBlob(invocation);
  return /(hindsight_recall|hindsight_reflect)/.test(blob);
}

function hasMcpResult(invocation: Record<string, unknown>): boolean {
  const blob = invocationBlob(invocation);
  return (
    blob.includes("mcp_") ||
    blob.includes('"mcp_server"') ||
    blob.includes('"mcp_tool_name"')
  );
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
        "Use hindsight_recall and hindsight_reflect to answer from long-term memory.",
        "Search for recent Pi runtime smoke tests or Codex managed recall smoke.",
        `After using Hindsight tools, reply with ${token} and a short summary of what memory returned.`,
      ].join(" ");
    case "mcp":
      return [
        "Use one configured MCP server/tool available to this agent for a safe read-only call.",
        `After the MCP tool returns, reply with ${token} and the tool name.`,
        "Do not invent a tool result.",
      ].join(" ");
  }
}

function evaluate(
  capability: Capability,
  token: string,
  turn: ThreadTurn,
  assistant: Message,
  opts: { requireTokenInAssistant?: boolean } = {},
): SmokeResult {
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
    return {
      ...base,
      reason: `turn_status_${turn.status}`,
      evidence: { ...base.evidence, error: turn.error },
    };
  }

  if (
    opts.requireTokenInAssistant !== false &&
    !assistant.content?.includes(token)
  ) {
    return { ...base, reason: "assistant_response_missing_expected_token" };
  }

  if (capability === "plain") {
    return { ...base, status: "PASS", reason: "assistant_message_persisted" };
  }

  const patterns: Record<Exclude<Capability, "plain">, RegExp[]> = {
    web_search: [/web[-_ ]?search/, /search/],
    execute_code: [/execute_code/, /sandbox/, /code/],
    hindsight: [/hindsight/, /memory/, /reflect/, /recall/],
    mcp: [/mcp/, /server/],
  };

  const invocations = matchingSuccessfulInvocations(turn, patterns[capability]);
  if (invocations.length === 0) {
    const failedTool = invocationRecords(turn).find((invocation) =>
      patterns[capability].some((pattern) =>
        pattern.test(
          `${invocationName(invocation)} ${invocationBlob(invocation)}`,
        ),
      ),
    );
    return {
      ...base,
      reason: failedTool
        ? "matching_tool_invocation_failed"
        : "no_successful_tool_evidence_in_thread_turn_usage_json",
      evidence: { ...base.evidence, failedTool },
    };
  }

  const evidenceOk =
    capability === "web_search"
      ? invocations.some(hasWebSearchResult)
      : capability === "execute_code"
        ? invocations.some(hasExecuteCodeResult)
        : capability === "hindsight"
          ? invocations.some(hasHindsightResult)
          : capability === "mcp"
            ? invocations.some(hasMcpResult)
            : false;

  if (!evidenceOk) {
    return { ...base, reason: `${capability}_result_evidence_missing` };
  }

  return {
    ...base,
    status: "PASS",
    reason: "successful_tool_result_evidence_present",
  };
}

async function runCapability(
  args: Args,
  capability: Capability,
): Promise<SmokeResult> {
  await verifySender(args, capability);
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
  const skipped = results.filter((result) => result.status === "SKIP");
  if (!args.json) {
    console.log(
      `Pi capability smoke summary: ${results.length - failed.length - skipped.length}/${results.length} passed, ${failed.length} failed, ${skipped.length} skipped`,
    );
  }
  if (failed.length > 0 || skipped.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
