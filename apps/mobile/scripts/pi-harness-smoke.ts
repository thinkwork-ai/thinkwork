#!/usr/bin/env tsx
import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createSkillsExtension,
  formatWorkspaceSkills,
} from "../../../packages/pi-extensions/src/skills";
import { BedrockModelProvider } from "../lib/agent/providers/bedrock";
import { runThreadHarnessTurn } from "../lib/agent/thread-turn";
import {
  MemoryBashSnapshotStorage,
  localBashExtension,
} from "../lib/agent/extensions/local-bash-extension";
import { mcpToolsExtension } from "../lib/agent/extensions/mcp-tools-extension";
import {
  mobileNativeExtensions,
  type PickedMobileFile,
} from "../lib/agent/extensions/mobile-native";
import { workspaceContextExtension } from "../lib/agent/extensions/workspace-context-extension";
import { workspaceToolsExtension } from "../lib/agent/extensions/workspace-tools-extension";
import { webSearchExtension } from "../lib/agent/extensions/web-search-extension";
import { defineExtension } from "../lib/agent/extensions/define-extension";
import { loadExtensions } from "../lib/agent/extensions/load-extensions";
import { adaptThinkworkExtension } from "../lib/agent/extensions/thinkwork-extension-adapter";
import type { ExtensionFactory } from "../lib/agent/extensions/types";
import { recordTurn } from "../lib/agent/persist-turn";
import { createAgentSession } from "../lib/agent/session";
import {
  MemoryWorkspaceCacheStorage,
  WorkspaceCache,
  createWorkspaceCachePartition,
  workspaceTargetsForContext,
} from "../lib/agent/workspace-cache";
import type { MobileNativeEvidence } from "../lib/agent/extensions/mobile-native";
import type {
  AgentEvent,
  ImagePart,
  Message,
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../lib/agent/types";
import type { WorkspaceFileMeta, WorkspaceTarget } from "../lib/workspace-api";

export type Capability =
  | "plain"
  | "workspace"
  | "workspace_tools"
  | "web_search"
  | "mcp"
  | "mcp_auth_failure"
  | "execute_code"
  | "bash"
  | "skill"
  | "image"
  | "file"
  | "agentcore_pi"
  | "abort";

export const LOCAL_ALL_CAPABILITIES = [
  "plain",
  "workspace",
  "workspace_tools",
  "web_search",
  "mcp",
  "mcp_auth_failure",
  "bash",
  "skill",
  "image",
  "file",
  "abort",
] as const satisfies readonly Capability[];

export const FULL_ALL_CAPABILITIES = [
  ...LOCAL_ALL_CAPABILITIES.slice(0, -1),
  "agentcore_pi",
  "abort",
] as const satisfies readonly Capability[];

interface Args {
  tenantId: string;
  agentId: string;
  userId: string;
  spaceId?: string;
  agentName?: string;
  graphqlUrl: string;
  apiKey: string;
  idToken: string;
  apiBase: string;
  capabilities: Capability[];
  timeoutMs: number;
  imagePath?: string;
  filePath?: string;
  json: boolean;
  dryRun: boolean;
}

interface Thread {
  id: string;
  identifier?: string | null;
  title: string;
}

interface SmokeResult {
  capability: Capability;
  status: "PASS" | "FAIL" | "SKIP";
  reason: string;
  threadId?: string;
  threadIdentifier?: string | null;
  assistantText?: string;
  events?: AgentEvent[];
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
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx < 0) continue;
    values[line.slice(0, idx)] = line.slice(idx + 1).replace(/^"|"$/g, "");
  }
  return values;
}

function usage(exitCode = 2): never {
  console.error(`Usage:
  pnpm --filter @thinkwork/mobile smoke:pi-harness -- \\
    --tenant-id <tenant-id> --agent-id <agent-id> \\
    --id-token <cognito-id-token> \\
    [--space-id <space-id>] [--capabilities plain,workspace,workspace_tools,web_search,mcp,mcp_auth_failure,execute_code,bash,skill,image,file,agentcore_pi,abort] \\
    [--image-path ./fixtures/card.png] [--file-path ./fixtures/note.txt] [--timeout 90000] [--json]

  pnpm --filter @thinkwork/mobile smoke:pi-harness -- --dry-run --capabilities all --json
  pnpm --filter @thinkwork/mobile smoke:pi-harness -- --dry-run --capabilities full --json

Environment fallbacks:
  MOBILE_PI_SMOKE_ID_TOKEN / THINKWORK_ID_TOKEN
  MOBILE_PI_SMOKE_IMAGE_PATH, MOBILE_PI_SMOKE_FILE_PATH
  THINKWORK_TENANT_ID, THINKWORK_AGENT_ID, THINKWORK_USER_ID, THINKWORK_SPACE_ID
  THINKWORK_GRAPHQL_URL / VITE_GRAPHQL_HTTP_URL
  THINKWORK_GRAPHQL_API_KEY / VITE_GRAPHQL_API_KEY / EXPO_PUBLIC_GRAPHQL_API_KEY
  apps/admin/.env and apps/mobile/.env are read when present

User id is resolved from the Cognito token when possible; THINKWORK_USER_ID is a fallback.
Use --dry-run to validate the smoke matrix shape without deployed credentials.
Use --capabilities all for the local/mobile matrix, or full to include managed AgentCore Pi.`);
  process.exit(exitCode);
}

function parseArgs(): Args {
  const root = repoRoot();
  const adminEnv = readDotEnv(resolve(root, "apps/admin/.env"));
  const mobileEnv = readDotEnv(resolve(root, "apps/mobile/.env"));
  const argv = process.argv.slice(2).filter((arg) => arg !== "--");
  let tenantId = process.env.THINKWORK_TENANT_ID ?? "";
  let agentId = process.env.THINKWORK_AGENT_ID ?? "";
  let userId = process.env.THINKWORK_USER_ID ?? "";
  let spaceId = process.env.THINKWORK_SPACE_ID ?? "";
  let agentName = process.env.THINKWORK_AGENT_NAME ?? "Mobile Pi";
  let idToken =
    process.env.MOBILE_PI_SMOKE_ID_TOKEN ??
    process.env.THINKWORK_ID_TOKEN ??
    "";
  let graphqlUrl =
    process.env.THINKWORK_GRAPHQL_URL ??
    process.env.VITE_GRAPHQL_HTTP_URL ??
    mobileEnv.EXPO_PUBLIC_GRAPHQL_URL ??
    adminEnv.VITE_GRAPHQL_HTTP_URL ??
    "";
  let apiKey =
    process.env.THINKWORK_GRAPHQL_API_KEY ??
    process.env.VITE_GRAPHQL_API_KEY ??
    mobileEnv.EXPO_PUBLIC_GRAPHQL_API_KEY ??
    adminEnv.VITE_GRAPHQL_API_KEY ??
    "";
  let capabilityValue = process.env.MOBILE_PI_SMOKE_CAPABILITIES ?? "plain";
  let timeoutMs = Number(process.env.MOBILE_PI_SMOKE_TIMEOUT_MS ?? 90_000);
  let imagePath = process.env.MOBILE_PI_SMOKE_IMAGE_PATH;
  let filePath = process.env.MOBILE_PI_SMOKE_FILE_PATH;
  let json = false;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--tenant-id") tenantId = argv[++i] ?? "";
    else if (arg === "--agent-id") agentId = argv[++i] ?? "";
    else if (arg === "--user-id") userId = argv[++i] ?? "";
    else if (arg === "--space-id") spaceId = argv[++i] ?? "";
    else if (arg === "--agent-name") agentName = argv[++i] ?? "";
    else if (arg === "--id-token") idToken = argv[++i] ?? "";
    else if (arg === "--graphql-url") graphqlUrl = argv[++i] ?? "";
    else if (arg === "--api-key") apiKey = argv[++i] ?? "";
    else if (arg === "--capability" || arg === "--capabilities")
      capabilityValue = argv[++i] ?? "";
    else if (arg === "--timeout") timeoutMs = Number(argv[++i] ?? timeoutMs);
    else if (arg === "--image-path") imagePath = argv[++i];
    else if (arg === "--file-path") filePath = argv[++i];
    else if (arg === "--json") json = true;
    else if (arg === "--dry-run") dryRun = true;
    else usage();
  }

  const all: Capability[] = [...LOCAL_ALL_CAPABILITIES];
  const full: Capability[] = [...FULL_ALL_CAPABILITIES];
  const capabilities =
    capabilityValue === "all"
      ? all
      : capabilityValue === "full"
        ? full
        : capabilityValue === "local"
          ? all
          : capabilityValue
              .split(",")
              .map((capability) => capability.trim())
              .filter(Boolean);
  const known = new Set<Capability>([...all, ...full, "execute_code"]);
  for (const capability of capabilities) {
    if (!known.has(capability as Capability)) {
      console.error(`Unknown capability: ${capability}`);
      usage();
    }
  }

  if (!dryRun && (!tenantId || !agentId || !graphqlUrl || !apiKey || !idToken))
    usage();
  return {
    tenantId,
    agentId,
    userId,
    spaceId: spaceId || undefined,
    agentName,
    graphqlUrl,
    apiKey,
    idToken,
    apiBase: graphqlUrl.replace(/\/graphql$/, ""),
    capabilities: capabilities as Capability[],
    timeoutMs,
    imagePath,
    filePath,
    json,
    dryRun,
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
      ...(args.idToken
        ? { Authorization: args.idToken }
        : { "x-api-key": args.apiKey }),
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (!response.ok || body.errors?.length || !body.data) {
    throw new Error(
      `GraphQL ${response.status}: ${JSON.stringify(body.errors ?? body)}`,
    );
  }
  return body.data;
}

async function createThread(
  args: Args,
  capability: Capability,
  firstMessage?: string,
): Promise<Thread> {
  const data = await gql<{ createThread: Thread }>(
    args,
    `mutation($input: CreateThreadInput!) {
      createThread(input: $input) { id identifier title }
    }`,
    {
      input: {
        tenantId: args.tenantId,
        agentId: args.agentId,
        ...(args.spaceId ? { spaceId: args.spaceId } : {}),
        title: `Mobile Pi ${capability} smoke ${new Date().toISOString()}`,
        channel: "CHAT",
        createdByType: "user",
        createdById: args.userId,
        ...(firstMessage ? { firstMessage } : {}),
      },
    },
  );
  return data.createThread;
}

async function resolveCurrentUserId(args: Args): Promise<string | null> {
  const data = await gql<{ me: { id: string } | null }>(
    args,
    `query {
      me { id }
    }`,
    {},
  );
  return data.me?.id ?? null;
}

async function getWorkspaceFile(
  args: Args,
  target: WorkspaceTarget,
  path: string,
): Promise<{ content: string | null; source: string; sha256: string }> {
  const token = args.idToken;
  const response = await fetch(`${args.apiBase}/api/workspaces/files`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ target, path, includeContent: true }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    content?: string | null;
    source?: string;
    sha256?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(
      `workspace file ${response.status}: ${body.error ?? "failed"}`,
    );
  }
  return {
    content: body.content ?? null,
    source: body.source ?? "unknown",
    sha256: body.sha256 ?? "",
  };
}

async function listWorkspaceFiles(
  args: Args,
  target: WorkspaceTarget,
): Promise<{ files: WorkspaceFileMeta[] }> {
  const response = await fetch(`${args.apiBase}/api/workspaces/files`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${args.idToken}`,
    },
    body: JSON.stringify({ action: "list", ...target, includeContent: true }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    files?: WorkspaceFileMeta[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(
      `workspace list ${response.status}: ${body.error ?? "failed"}`,
    );
  }
  return { files: body.files ?? [] };
}

interface ThreadPollState {
  id: string;
  identifier?: string | null;
  lifecycleStatus?: string | null;
  lastRuntimeType?: string | null;
  lastResponsePreview?: string | null;
  messages: Array<{
    id: string;
    role: string;
    content?: string | null;
    senderType?: string | null;
    createdAt?: string | null;
  }>;
}

async function getThreadPollState(
  args: Args,
  threadId: string,
): Promise<ThreadPollState> {
  const data = await gql<{ thread: ThreadPollState | null }>(
    args,
    `query($id: ID!) {
      thread(id: $id) {
        id
        identifier
        lifecycleStatus
        lastRuntimeType
        lastResponsePreview
        messages(limit: 20) {
          edges {
            node {
              id
              role
              content
              senderType
              createdAt
            }
          }
        }
      }
    }`,
    { id: threadId },
  );
  if (!data.thread) throw new Error(`Thread not found: ${threadId}`);
  return {
    ...data.thread,
    messages:
      (
        data.thread as unknown as {
          messages?: {
            edges?: Array<{ node: ThreadPollState["messages"][0] }>;
          };
        }
      ).messages?.edges?.map((edge) => edge.node) ?? [],
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function promptFor(capability: Capability, token: string): string {
  switch (capability) {
    case "plain":
      return `Plain mobile Pi smoke. Reply exactly: ${token}`;
    case "workspace":
      return `Use USER.md workspace context to answer. Reply with ${token} and my name.`;
    case "workspace_tools":
      return `Use cached workspace tools read, grep, find, or ls to inspect USER.md or nearby workspace files. Reply with ${token} and the tool name you used.`;
    case "web_search":
      return `Use the direct web_search tool to search for the current OpenAI News page title. Reply with ${token} and the title you found.`;
    case "mcp":
      return `Use the mcp tool to list connected tools, then call one safe read-only tool through mcp({ call: ... }). Prefer CRM list/search/get tools if present. Reply with ${token} and the tool name you called.`;
    case "mcp_auth_failure":
      return `Exercise the bounded MCP gateway with invalid credentials. Reply with ${token} and the credential failure message.`;
    case "execute_code":
      return `Use execute_code or a code interpreter tool to compute sum(i*i for i in range(1, 11)). Reply exactly: ${token} 385. Do not calculate mentally.`;
    case "bash":
      return `Use bash or a shell tool to run: printf '${token} 385'. Reply exactly with the command output. Do not answer without the tool result.`;
    case "skill":
      return `Use the workspace_skill tool to read the mobile-smoke skill before answering. Reply with ${token} and the secret phrase from that skill.`;
    case "image":
      return `Inspect the attached image. Reply with ${token} and a short description.`;
    case "file":
      return `Use the mobile_file tool to inspect the attached file. Reply with ${token} and the attached filename.`;
    case "agentcore_pi":
      return `Managed AgentCore Pi smoke. Reply exactly: ${token}`;
    case "abort":
      return `Abort smoke. This turn should be canceled before assistant output: ${token}`;
  }
}

function imagePart(path: string | undefined): ImagePart | undefined {
  if (!path) return undefined;
  const resolved = resolveSmokePath(path);
  const bytes = readFileSync(resolved);
  const lower = path.toLowerCase();
  const format = lower.endsWith(".png")
    ? "png"
    : lower.endsWith(".gif")
      ? "gif"
      : lower.endsWith(".webp")
        ? "webp"
        : "jpeg";
  return { format, data: bytes.toString("base64") };
}

function fileEvidence(
  path: string | undefined,
): MobileNativeEvidence | undefined {
  if (!path) return undefined;
  const resolved = resolveSmokePath(path);
  const bytes = readFileSync(resolved);
  return {
    type: "mobile_native_capability",
    source: "file",
    name: basename(path),
    mimeType: "text/plain",
    sizeBytes: bytes.byteLength,
    textExtracted: true,
  };
}

function pickedFile(path: string | undefined): PickedMobileFile | null {
  if (!path) return null;
  const resolved = resolveSmokePath(path);
  const bytes = readFileSync(resolved);
  return {
    name: basename(path),
    mimeType: "text/plain",
    sizeBytes: bytes.byteLength,
    text: bytes.toString("utf8"),
  };
}

function resolveSmokePath(path: string): string {
  if (isAbsolute(path)) return path;
  const cwdPath = resolve(path);
  if (existsSync(cwdPath)) return cwdPath;
  return resolve(repoRoot(), path);
}

function fallbackAssistantText(
  stopReason: string,
  events: AgentEvent[],
): string {
  const error = events.find(
    (event): event is Extract<AgentEvent, { type: "error" }> =>
      event.type === "error",
  );
  if (error)
    return `Mobile Pi turn failed before assistant output: ${error.error}`;
  if (stopReason === "aborted") {
    return "Mobile Pi turn was aborted before assistant output.";
  }
  return `Mobile Pi turn ended with ${stopReason} before assistant output.`;
}

function createSmokeWorkspaceCache(args: Args): WorkspaceCache {
  return new WorkspaceCache(
    new MemoryWorkspaceCacheStorage(),
    {
      listFiles: (target) => listWorkspaceFiles(args, target),
    },
    { cacheTtlMs: 0 },
  );
}

function smokeWorkspaceSkills() {
  return [
    {
      slug: "mobile-smoke",
      name: "Mobile Smoke",
      description: "Deterministic mobile Pi skill smoke.",
      skillPath: "/workspace/skills/mobile-smoke/SKILL.md",
      content:
        "# Mobile Smoke\n\nWhen asked for the secret phrase, reply with `SKILL-SMOKE-OK`.",
    },
  ];
}

function workspaceSkillPromptExtension(): ExtensionFactory {
  const block = formatWorkspaceSkills(smokeWorkspaceSkills());
  return defineExtension({
    name: "workspace-skill-prompt",
    register(pi) {
      pi.on("before_agent_start", (event) => ({
        systemPrompt: `${event.systemPrompt}\n\n${block}`,
      }));
    },
  });
}

function smokeExtensions(
  args: Args,
  threadId: string,
): {
  extensions: ExtensionFactory[];
  workspaceCache: WorkspaceCache;
} {
  const workspaceCache = createSmokeWorkspaceCache(args);
  const partition = createWorkspaceCachePartition({
    stage: "dev",
    tenantId: args.tenantId,
    agentId: args.agentId,
    spaceId: args.spaceId,
    userId: args.userId,
  });
  const targets = workspaceTargetsForContext({
    agentId: args.agentId,
    spaceId: args.spaceId,
    userId: args.userId,
  });
  return {
    workspaceCache,
    extensions: [
      workspaceContextExtension({
        userId: args.userId,
        agentId: args.agentId,
        spaceId: args.spaceId,
        deps: {
          getWorkspaceFile: (target, path) =>
            getWorkspaceFile(args, target, path),
        },
      }),
      workspaceToolsExtension({
        cache: workspaceCache,
        partition,
        targets,
      }),
      localBashExtension({
        sessionId: threadId,
        workspace: { cache: workspaceCache, partition, targets },
        snapshotStorage: new MemoryBashSnapshotStorage(),
      }),
      ...mobileNativeExtensions({
        file: {
          pickFile: async () => pickedFile(args.filePath),
        },
        photo: {
          pickPhoto: async () => {
            const image = imagePart(args.imagePath);
            return image ? { image, mimeType: `image/${image.format}` } : null;
          },
        },
      }),
      webSearchExtension({
        agentId: args.agentId,
        deps: { apiBase: args.apiBase, getToken: async () => args.idToken },
      }),
      adaptThinkworkExtension(
        createSkillsExtension({ skills: smokeWorkspaceSkills() }),
      ),
      workspaceSkillPromptExtension(),
      mcpToolsExtension({
        agentId: args.agentId,
        deps: { apiBase: args.apiBase, getToken: async () => args.idToken },
      }),
    ],
  };
}

function toolCalls(events: AgentEvent[]): string[] {
  return events
    .filter(
      (event): event is Extract<AgentEvent, { type: "tool_call" }> =>
        event.type === "tool_call",
    )
    .map((event) => event.call.name);
}

function failedToolResults(events: AgentEvent[]): AgentEvent[] {
  return events.filter(
    (event) => event.type === "tool_result" && event.result.isError === true,
  );
}

function evaluate(
  capability: Capability,
  token: string,
  assistantText: string,
  events: AgentEvent[],
): Pick<SmokeResult, "status" | "reason"> {
  if (!assistantText.includes(token)) {
    return { status: "FAIL", reason: "assistant_missing_expected_token" };
  }
  const calls = toolCalls(events).map((name) => name.toLowerCase());
  if (
    capability === "plain" ||
    capability === "workspace" ||
    capability === "image" ||
    capability === "agentcore_pi"
  ) {
    return { status: "PASS", reason: "assistant_response_matched" };
  }
  if (capability === "web_search") {
    if (!calls.includes("web_search")) {
      return { status: "FAIL", reason: "expected_web_search_was_not_called" };
    }
    if (failedToolResults(events).length > 0) {
      return { status: "FAIL", reason: "tool_result_failed" };
    }
    return { status: "PASS", reason: "web_search_tool_observed" };
  }
  if (capability === "skill") {
    if (!calls.includes("workspace_skill")) {
      return {
        status: "FAIL",
        reason: "expected_workspace_skill_was_not_called",
      };
    }
    if (!assistantText.includes("SKILL-SMOKE-OK")) {
      return { status: "FAIL", reason: "assistant_missing_skill_phrase" };
    }
    if (failedToolResults(events).length > 0) {
      return { status: "FAIL", reason: "tool_result_failed" };
    }
    return { status: "PASS", reason: "workspace_skill_tool_observed" };
  }
  if (capability === "file") {
    if (!calls.includes("mobile_file")) {
      return { status: "FAIL", reason: "expected_mobile_file_was_not_called" };
    }
    if (failedToolResults(events).length > 0) {
      return { status: "FAIL", reason: "tool_result_failed" };
    }
    return { status: "PASS", reason: "mobile_file_tool_observed" };
  }
  if (capability === "workspace_tools") {
    const usedWorkspaceTool = calls.some((name) =>
      /^(read|grep|find|ls)$/.test(name),
    );
    if (!usedWorkspaceTool) {
      return {
        status: "FAIL",
        reason: "expected_workspace_tool_was_not_called",
      };
    }
    if (failedToolResults(events).length > 0) {
      return { status: "FAIL", reason: "tool_result_failed" };
    }
    return { status: "PASS", reason: "workspace_tool_observed" };
  }
  if (capability === "mcp") {
    const mcpDispatches = events.filter(
      (event): event is Extract<AgentEvent, { type: "tool_call" }> =>
        event.type === "tool_call" &&
        event.call.name.toLowerCase() === "mcp" &&
        typeof event.call.arguments.call === "object" &&
        event.call.arguments.call !== null,
    );
    if (!calls.includes("mcp")) {
      return { status: "FAIL", reason: "expected_tool_was_not_called" };
    }
    if (mcpDispatches.length === 0) {
      return {
        status: "FAIL",
        reason: "expected_mcp_call_was_not_dispatched",
      };
    }
    if (failedToolResults(events).length > 0) {
      return { status: "FAIL", reason: "tool_result_failed" };
    }
    return { status: "PASS", reason: "mcp_call_observed" };
  }

  const wants =
    capability === "execute_code"
      ? calls.some((name) => /execute_code|code_interpreter|python/.test(name))
      : calls.some((name) => /bash|shell/.test(name));
  if (!wants) return { status: "FAIL", reason: "expected_tool_was_not_called" };
  if (failedToolResults(events).length > 0) {
    return { status: "FAIL", reason: "tool_result_failed" };
  }
  return { status: "PASS", reason: "tool_call_observed" };
}

async function runMcpAuthFailure(
  args: Args,
  thread: Thread,
): Promise<SmokeResult> {
  const events: AgentEvent[] = [];
  const loaded = await loadExtensions([
    mcpToolsExtension({
      agentId: args.agentId,
      deps: {
        apiBase: args.apiBase,
        getToken: async () => "invalid-mobile-pi-smoke-token",
      },
    }),
  ]);
  const tool = loaded.tools.find((candidate) => candidate.name === "mcp");
  if (!tool) {
    return {
      capability: "mcp_auth_failure",
      status: "FAIL",
      reason: "mcp_tool_not_registered",
      threadId: thread.id,
      threadIdentifier: thread.identifier,
      events,
    };
  }
  const result = await tool.execute({ list: true }, { sessionId: thread.id });
  const isCredentialFailure =
    result.isError === true &&
    /auth|credential|token|reconnect|connection|401|403/i.test(result.content);
  return {
    capability: "mcp_auth_failure",
    status: isCredentialFailure ? "PASS" : "FAIL",
    reason: isCredentialFailure
      ? "mcp_auth_failure_observed"
      : "mcp_auth_failure_not_observed",
    threadId: thread.id,
    threadIdentifier: thread.identifier,
    assistantText: result.content,
    events,
  };
}

class AbortSmokeProvider implements ModelProvider {
  readonly id = "abort-smoke";

  generate(
    _request: ModelRequest,
    signal?: AbortSignal,
  ): Promise<ModelResponse> {
    return new Promise<ModelResponse>((_resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("AbortError"));
        return;
      }
      const abort = () => reject(new Error("AbortError"));
      signal?.addEventListener("abort", abort, { once: true });
      setTimeout(() => reject(new Error("abort smoke timed out")), 5_000);
    });
  }
}

async function runAbortCapability(
  args: Args,
  thread: Thread,
): Promise<SmokeResult> {
  const token = `MOBILE-PI-ABORT-${Date.now()}`;
  const events: AgentEvent[] = [];
  const session = createAgentSession({
    modelProvider: new AbortSmokeProvider(),
    sessionId: thread.id,
    messages: [] satisfies Message[],
  });
  const unsubscribe = session.subscribe((event) => events.push(event));
  try {
    const turn = session.prompt(promptFor("abort", token));
    setTimeout(() => session.abort(), 25);
    const result = await turn;
    const assistantText =
      result.finalText || fallbackAssistantText(result.stopReason, events);
    await recordTurn(
      {
        threadId: thread.id,
        userText: promptFor("abort", token),
        assistantText,
        toolResults: [
          {
            type: "mobile_session",
            stopReason: result.stopReason,
            transcript: result.messages,
            events,
          },
        ],
        usage: result.usage,
      },
      { apiBase: args.apiBase, getToken: async () => args.idToken },
    );
    return {
      capability: "abort",
      status: result.stopReason === "aborted" ? "PASS" : "FAIL",
      reason:
        result.stopReason === "aborted"
          ? "abort_stop_reason_observed"
          : `unexpected_stop_reason_${result.stopReason}`,
      threadId: thread.id,
      threadIdentifier: thread.identifier,
      assistantText,
      events,
    };
  } finally {
    unsubscribe();
  }
}

async function runManagedAgentCoreCapability(args: Args): Promise<SmokeResult> {
  const token = `MOBILE-PI-AGENTCORE-${Date.now()}`;
  const prompt = promptFor("agentcore_pi", token);
  const thread = await createThread(args, "agentcore_pi", prompt);
  const started = Date.now();
  let lastState: ThreadPollState | null = null;

  while (Date.now() - started < args.timeoutMs) {
    lastState = await getThreadPollState(args, thread.id);
    const assistant = lastState.messages.find(
      (message) =>
        message.role.toLowerCase() === "assistant" &&
        typeof message.content === "string" &&
        message.content.length > 0,
    );
    if (assistant?.content) {
      const runtime = (lastState.lastRuntimeType ?? "").toLowerCase();
      if (runtime !== "pi") {
        return {
          capability: "agentcore_pi",
          status: "FAIL",
          reason: `managed_turn_runtime_was_${lastState.lastRuntimeType ?? "missing"}`,
          threadId: thread.id,
          threadIdentifier: thread.identifier,
          assistantText: assistant.content,
        };
      }
      const verdict = evaluate("agentcore_pi", token, assistant.content, []);
      return {
        capability: "agentcore_pi",
        ...verdict,
        reason:
          verdict.status === "PASS"
            ? "managed_agentcore_pi_turn_completed"
            : verdict.reason,
        threadId: thread.id,
        threadIdentifier: thread.identifier,
        assistantText: assistant.content,
      };
    }
    if (lastState.lifecycleStatus === "FAILED") {
      return {
        capability: "agentcore_pi",
        status: "FAIL",
        reason: "managed_turn_failed",
        threadId: thread.id,
        threadIdentifier: thread.identifier,
        assistantText: lastState.lastResponsePreview ?? undefined,
      };
    }
    await sleep(2_000);
  }

  return {
    capability: "agentcore_pi",
    status: "FAIL",
    reason: `managed_turn_timeout lifecycle=${lastState?.lifecycleStatus ?? "unknown"} runtime=${lastState?.lastRuntimeType ?? "unknown"}`,
    threadId: thread.id,
    threadIdentifier: thread.identifier,
    assistantText: lastState?.lastResponsePreview ?? undefined,
  };
}

async function runCapability(
  args: Args,
  capability: Capability,
): Promise<SmokeResult> {
  if (capability === "image" && !args.imagePath) {
    return { capability, status: "SKIP", reason: "image-path not provided" };
  }
  if (capability === "file" && !args.filePath) {
    return { capability, status: "SKIP", reason: "file-path not provided" };
  }
  if (capability === "agentcore_pi") {
    return runManagedAgentCoreCapability(args);
  }
  const thread = await createThread(args, capability);
  if (capability === "mcp_auth_failure") {
    return runMcpAuthFailure(args, thread);
  }
  if (capability === "abort") {
    return runAbortCapability(args, thread);
  }
  const token = `MOBILE-PI-${capability.toUpperCase().replace(/_/g, "-")}-${Date.now()}`;
  const events: AgentEvent[] = [];
  try {
    const provider = new BedrockModelProvider({
      apiBase: args.apiBase,
      getToken: async () => args.idToken,
    });
    const smoke = smokeExtensions(args, thread.id);
    const result = await runThreadHarnessTurn(
      {
        threadId: thread.id,
        userText: promptFor(capability, token),
        priorMessages: [],
        agentId: args.agentId,
        userId: args.userId,
        tenantId: args.tenantId,
        stage: "dev",
        spaceId: args.spaceId,
        agentName: args.agentName,
        images:
          capability === "image" ? [imagePart(args.imagePath)!] : undefined,
        nativeAttachments:
          capability === "file" ? [fileEvidence(args.filePath)!] : undefined,
      },
      {
        modelProvider: provider,
        extensions: smoke.extensions,
        workspaceCache: smoke.workspaceCache,
        recordTurnFn: (input) =>
          recordTurn(input, {
            apiBase: args.apiBase,
            getToken: async () => args.idToken,
          }),
        onEvent: (event) => {
          events.push(event);
        },
      },
    );
    const verdict = evaluate(capability, token, result.assistantText, events);
    return {
      capability,
      ...verdict,
      threadId: thread.id,
      threadIdentifier: thread.identifier,
      assistantText: result.assistantText,
      events,
    };
  } catch (err) {
    return {
      capability,
      status: "FAIL",
      reason: err instanceof Error ? err.message : String(err),
      threadId: thread.id,
      threadIdentifier: thread.identifier,
      events,
    };
  }
}

export function dryRunResults(args: Pick<Args, "capabilities">): SmokeResult[] {
  return args.capabilities.map((capability, index) => ({
    capability,
    status: "SKIP",
    reason: "dry_run_matrix_only",
    threadId: `dry-run-thread-${index + 1}`,
    threadIdentifier: `DRY-${String(index + 1).padStart(3, "0")}`,
  }));
}

function printResult(result: SmokeResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result));
    return;
  }
  console.log(
    `${result.status}: ${result.capability} thread=${
      result.threadIdentifier ?? result.threadId ?? "n/a"
    } reason=${result.reason}`,
  );
}

export async function main() {
  const args = parseArgs();
  if (args.dryRun) {
    const results = dryRunResults(args);
    for (const result of results) printResult(result, args.json);
    if (!args.json) {
      console.log(
        `Mobile Pi harness dry run: ${results.length} capability rows covered`,
      );
    }
    return;
  }
  const currentUserId = await resolveCurrentUserId(args).catch(() => null);
  if (currentUserId) {
    args.userId = currentUserId;
  }
  if (!args.userId) {
    throw new Error(
      "Unable to resolve current user id. Provide THINKWORK_USER_ID or --user-id.",
    );
  }
  const results: SmokeResult[] = [];
  for (const capability of args.capabilities) {
    const timeout = new Promise<SmokeResult>((resolve) => {
      setTimeout(
        () => resolve({ capability, status: "FAIL", reason: "timeout" }),
        args.timeoutMs,
      );
    });
    const result = await Promise.race([
      runCapability(args, capability),
      timeout,
    ]);
    results.push(result);
    printResult(result, args.json);
  }
  const failed = results.filter((result) => result.status === "FAIL");
  if (!args.json) {
    console.log(
      `Mobile Pi harness smoke summary: ${results.length - failed.length}/${results.length} passed`,
    );
  }
  if (failed.length) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
