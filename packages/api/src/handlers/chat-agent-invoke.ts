/**
 * Chat Agent Invoke Lambda — SETUP phase only.
 *
 * After the direct-callback finalize refactor (plan 2026-05-22-006), this
 * Lambda does:
 *
 *   1. Looks up the agent + resolves runtime config (skills, MCP, KBs,
 *      sandbox preflight, guardrail, workspace tuple).
 *   2. Builds the AgentCore invoke payload with finalize-callback fields
 *      (URL + bearer secret + thread_turn_id).
 *   3. Dispatches the AgentCore adapter Lambda in Event mode (no wait).
 *   4. Returns in ~5 seconds end-to-end.
 *
 * The Strands runtime POSTs its end-of-turn result to
 * /api/threads/{threadId}/finalize. The chat-agent-finalize Lambda runs
 * the post-AgentCore bookkeeping (cost, guardrail-block, message insert,
 * AppSync notify, computer-task completion, memory retain) out-of-band.
 * This decouples Lambda lifetime from agent-turn duration, so 8h-capable
 * AgentCore runs no longer hit the 5-min Lambda timeout / auto-retry
 * cascade.
 */

import { eq, and, ne, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agents,
  messages,
  spaces,
  threads,
  users,
  threadTurns,
} from "@thinkwork/database-pg/schema";
import { randomBytes } from "crypto";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import {
  applySandboxPayloadFields,
  checkSandboxPreflight,
  type SandboxPreflightResult,
} from "../lib/sandbox-preflight.js";
import {
  AgentNotFoundError,
  resolveAgentRuntimeConfig,
} from "../lib/resolve-agent-runtime-config.js";
import {
  resolveRuntimeFunctionName,
  type AgentRuntimeType,
} from "../lib/resolve-runtime-function-name.js";
import type { EffectiveWorkspacePolicy } from "../lib/workspace-renderer/index.js";
// Post-AgentCore helpers — previously inline in this file; lifted into
// the shared chat-finalize lib so chat-agent-finalize (the new HTTP
// handler) and chat-agent-invoke (this file, for pre-dispatch error
// paths only) share a single source of truth.
import {
  GENERIC_AGENT_ERROR_MESSAGE,
  insertAssistantMessage,
  markComputerTaskFailedFromFinalize,
  notifyNewMessage,
  notifyThreadTurnUpdate,
} from "../lib/chat-finalize/notify.js";

/**
 * Extract or generate a trace ID for correlating CloudWatch/X-Ray traces.
 * Prefers the Lambda X-Ray trace ID if active, otherwise generates a
 * W3C-compatible 32-hex-char trace ID.
 */
function getTraceId(): string {
  const xrayTraceId = process.env._X_AMZN_TRACE_ID;
  if (xrayTraceId) {
    // Format: Root=1-xxxx-yyyyyyyy;Parent=zzzz;Sampled=1
    const rootMatch = xrayTraceId.match(/Root=([^;]+)/);
    if (rootMatch) return rootMatch[1];
  }
  // Fallback: generate W3C-compatible trace ID (32 hex chars)
  return randomBytes(16).toString("hex");
}

const APPSYNC_ENDPOINT = process.env.APPSYNC_ENDPOINT || "";
const APPSYNC_API_KEY = process.env.APPSYNC_API_KEY || "";
const THINKWORK_API_SECRET = process.env.THINKWORK_API_SECRET || "";
const WORKSPACE_BUCKET = process.env.WORKSPACE_BUCKET || "";
// API URL used by skills for callbacks (thread-management, email-send, etc.)
// Reads THINKWORK_API_URL first, falls back to legacy MCP_BASE_URL until infra is updated.
const THINKWORK_API_URL =
  process.env.THINKWORK_API_URL || process.env.MCP_BASE_URL || "";
const HINDSIGHT_ENDPOINT = process.env.HINDSIGHT_ENDPOINT || "";
const WORKSPACE_RENDERER_FUNCTION_NAME =
  process.env.WORKSPACE_RENDERER_FUNCTION_NAME || "";
// Used by sandbox-preflight to namespace Secrets Manager paths per stage.
// STACK_NAME is the legacy env var every other handler reads; mirror that.
const STAGE = process.env.STAGE || process.env.STACK_NAME || "dev";

const db = getDb();
const lambdaClient = new LambdaClient({});

// GENERIC_AGENT_ERROR_MESSAGE + extractResponseText now live in
// packages/api/src/lib/chat-finalize/notify.ts. The import at the top of
// this file pulls GENERIC_AGENT_ERROR_MESSAGE for the pre-dispatch error
// paths; extractResponseText is only used by the finalize handler.

interface InvokeAttachment {
  attachmentId: string;
  s3Key: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

interface InvokeEvent {
  threadId: string;
  tenantId: string;
  agentId: string;
  userMessage: string;
  messageId?: string;
  computerId?: string;
  computerTaskId?: string;
  /**
   * U3 of the finance pilot — the dispatch caller (thread-cutover.ts)
   * resolves `messages.metadata.attachments` against `thread_attachments`
   * with a tenant pin and passes the full record set here. Empty when
   * the turn has no attachments. Forwarded to the AgentCore Lambda
   * invoke payload as `message_attachments` (snake_case for Python).
   */
  messageAttachments?: InvokeAttachment[];
}

export interface RenderWorkspaceTupleForInvokeInput {
  tenantId: string;
  agentId: string;
  spaceId: string;
  userId?: string | null;
  agentBlockedTools?: unknown;
  agentAllowedTools?: unknown;
}

export interface RenderWorkspaceTupleForInvokeResult {
  rendered: boolean;
  renderedPrefix?: string;
  cacheStatus?: "hit" | "miss";
  activeSpace?: {
    id: string;
    slug: string;
    name: string;
    isDefault: boolean;
  };
  effectivePolicy?: EffectiveWorkspacePolicy;
  errorCode?: string;
  statusCode?: number;
  reason?: string;
}

interface RenderWorkspaceTupleForInvokeDeps {
  lambda?: Pick<LambdaClient, "send">;
  functionName?: string;
}

export async function renderWorkspaceTupleForInvoke(
  input: RenderWorkspaceTupleForInvokeInput,
  deps: RenderWorkspaceTupleForInvokeDeps = {},
): Promise<RenderWorkspaceTupleForInvokeResult> {
  const functionName =
    deps.functionName ?? WORKSPACE_RENDERER_FUNCTION_NAME ?? "";
  if (!functionName) {
    return { rendered: false, reason: "workspace_renderer_unconfigured" };
  }

  const client = deps.lambda ?? lambdaClient;
  const response = await client.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "RequestResponse",
      Payload: new TextEncoder().encode(
        JSON.stringify({
          tenantId: input.tenantId,
          agentId: input.agentId,
          spaceId: input.spaceId,
          userId: input.userId ?? null,
          agentBlockedTools: input.agentBlockedTools,
          agentAllowedTools: input.agentAllowedTools,
        }),
      ),
    }),
  );

  const rawPayload = response.Payload
    ? new TextDecoder().decode(response.Payload)
    : "{}";
  if (response.FunctionError) {
    return {
      rendered: false,
      reason: `workspace_renderer_function_error:${response.FunctionError}`,
    };
  }

  const parsed = JSON.parse(rawPayload) as Record<string, unknown>;
  if (parsed.ok !== true || typeof parsed.renderedPrefix !== "string") {
    const errorPayload =
      typeof parsed.error === "object" && parsed.error
        ? (parsed.error as Record<string, unknown>)
        : null;
    return {
      rendered: false,
      errorCode:
        typeof errorPayload?.code === "string" ? errorPayload.code : undefined,
      statusCode:
        typeof parsed.statusCode === "number" ? parsed.statusCode : undefined,
      reason: errorPayload
        ? JSON.stringify(errorPayload)
        : "workspace_renderer_failed",
    };
  }

  return {
    rendered: true,
    renderedPrefix: parsed.renderedPrefix,
    activeSpace: isActiveSpacePayload(parsed.activeSpace)
      ? parsed.activeSpace
      : undefined,
    effectivePolicy: isEffectiveWorkspacePolicy(parsed.effectivePolicy)
      ? parsed.effectivePolicy
      : undefined,
    cacheStatus:
      parsed.cacheStatus === "hit" || parsed.cacheStatus === "miss"
        ? parsed.cacheStatus
        : undefined,
  };
}

function isActiveSpacePayload(value: unknown): value is {
  id: string;
  slug: string;
  name: string;
  isDefault: boolean;
} {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.slug === "string" &&
    typeof obj.name === "string" &&
    typeof obj.isDefault === "boolean"
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isNullableStringArray(value: unknown): value is string[] | null {
  return value === null || isStringArray(value);
}

function isEffectiveWorkspacePolicy(
  value: unknown,
): value is EffectiveWorkspacePolicy {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    isStringArray(obj.blockedTools) &&
    isNullableStringArray(obj.allowedTools) &&
    isNullableStringArray(obj.mcpAllowedServers) &&
    isStringArray(obj.mcpBlockedServers) &&
    isStringArray(obj.diagnostics)
  );
}

type ChatInvokeIdentitySource =
  | "message_sender"
  | "thread_creator"
  | "computer_agent_human_pair"
  | "none";

export interface ChatInvokeIdentity {
  currentUserId: string;
  currentUserEmail: string;
  source: ChatInvokeIdentitySource;
}

interface MessageSenderRow {
  sender_id: string | null;
  sender_type: string | null;
}

interface ThreadCreatorRow {
  created_by_id: string | null;
  created_by_type: string | null;
}

export interface ChatInvokeIdentityDeps {
  loadMessageSender(messageId: string): Promise<MessageSenderRow | null>;
  loadThreadCreator(threadId: string): Promise<ThreadCreatorRow | null>;
  loadAgentHumanPair(args: {
    agentId: string;
    tenantId: string;
  }): Promise<string | null>;
  loadUserEmail(userId: string): Promise<string>;
}

export function createDrizzleChatInvokeIdentityDeps(
  dbClient = db,
): ChatInvokeIdentityDeps {
  return {
    async loadMessageSender(messageId) {
      const [msg] = await dbClient
        .select({
          sender_id: messages.sender_id,
          sender_type: messages.sender_type,
        })
        .from(messages)
        .where(eq(messages.id, messageId));
      return msg ?? null;
    },
    async loadThreadCreator(threadId) {
      const [thread] = await dbClient
        .select({
          created_by_id: threads.created_by_id,
          created_by_type: threads.created_by_type,
        })
        .from(threads)
        .where(eq(threads.id, threadId));
      return thread ?? null;
    },
    async loadAgentHumanPair({ agentId, tenantId }) {
      const [agent] = await dbClient
        .select({ human_pair_id: agents.human_pair_id })
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.tenant_id, tenantId)));
      return agent?.human_pair_id ?? null;
    },
    async loadUserEmail(userId) {
      const [u] = await dbClient
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId));
      return u?.email || "";
    },
  };
}

export function resolveChatInvocationRuntimeType(args: {
  configuredRuntimeType: AgentRuntimeType;
  computerId?: string | null;
  computerTaskId?: string | null;
}): AgentRuntimeType {
  return args.configuredRuntimeType;
}

export async function resolveChatInvokeIdentity(
  args: {
    threadId: string;
    tenantId: string;
    agentId: string;
    messageId?: string;
  },
  deps: ChatInvokeIdentityDeps = createDrizzleChatInvokeIdentityDeps(),
): Promise<ChatInvokeIdentity> {
  if (args.messageId) {
    const msg = await deps.loadMessageSender(args.messageId);
    if (
      (msg?.sender_type === "human" || msg?.sender_type === "user") &&
      msg.sender_id
    ) {
      return {
        currentUserId: msg.sender_id,
        currentUserEmail: await deps.loadUserEmail(msg.sender_id),
        source: "message_sender",
      };
    }
  }

  const thread = await deps.loadThreadCreator(args.threadId);
  if (thread?.created_by_type === "user" && thread.created_by_id) {
    return {
      currentUserId: thread.created_by_id,
      currentUserEmail: await deps.loadUserEmail(thread.created_by_id),
      source: "thread_creator",
    };
  }

  if (thread?.created_by_type === "computer") {
    const humanPairId = await deps.loadAgentHumanPair({
      agentId: args.agentId,
      tenantId: args.tenantId,
    });
    if (humanPairId) {
      return {
        currentUserId: humanPairId,
        currentUserEmail: await deps.loadUserEmail(humanPairId),
        source: "computer_agent_human_pair",
      };
    }
  }

  return {
    currentUserId: "",
    currentUserEmail: "",
    source: "none",
  };
}

export async function handler(event: InvokeEvent): Promise<unknown | void> {
  const { threadId, tenantId, agentId, userMessage } = event;
  const traceId = getTraceId();
  console.log(
    `[chat-agent-invoke] threadId=${threadId} agentId=${agentId} traceId=${traceId}`,
  );

  let turnId: string | undefined;
  try {
    // 1. Resolve per-invoker identity. This is the PER-TURN piece that the
    //    shared `resolveAgentRuntimeConfig` helper does NOT own — it's specific
    //    to the triggering chat event. Human/user messages and user-created
    //    threads keep their direct actor. Connector-created threads use the
    //    target agent's paired human as the trusted user context so Pi receives
    //    the required user_id without giving generic wakeups a fake invoker.
    const identity = await resolveChatInvokeIdentity({
      threadId,
      tenantId,
      agentId,
      messageId: event.messageId,
    });
    const currentUserEmail = identity.currentUserEmail;
    const currentUserId = identity.currentUserId;
    if (identity.source !== "none") {
      console.log(
        `[chat-agent-invoke] resolved current user via ${identity.source}`,
      );
    }

    const spaceContext = await resolveThreadSpaceContext({
      tenantId,
      threadId,
    });
    const spaceId = spaceContext?.spaceId ?? null;
    const spaceSlug = spaceContext?.spaceSlug ?? null;

    // 2. Resolve agent runtime config (agent + template + tenant + skills +
    //    KBs + MCP + guardrail + sandbox template). Shared with the
    //    skill-run dispatcher's `/api/agents/runtime-config` endpoint.
    let runtimeConfig;
    try {
      runtimeConfig = await resolveAgentRuntimeConfig({
        tenantId,
        agentId,
        spaceId,
        currentUserId: currentUserId || undefined,
        currentUserEmail: currentUserEmail || undefined,
        // Email-only fallback to the agent's human pair (R15: only for
        // personalizing "you" in email copy — never used as currentUserId).
        allowHumanPairEmailFallback: true,
        logPrefix: "[chat-agent-invoke]",
        thinkworkApiUrl: THINKWORK_API_URL,
        thinkworkApiSecret: THINKWORK_API_SECRET,
        appsyncApiKey: APPSYNC_API_KEY,
      });
    } catch (err) {
      if (err instanceof AgentNotFoundError) {
        console.error(`[chat-agent-invoke] ${err.message}`);
        return;
      }
      throw err;
    }

    const runtimeType = resolveChatInvocationRuntimeType({
      configuredRuntimeType: runtimeConfig.runtimeType,
      computerId: event.computerId,
      computerTaskId: event.computerTaskId,
    });
    const agentModel = runtimeConfig.templateModel;
    const tenantSlug = runtimeConfig.tenantSlug;
    const agentSlug = runtimeConfig.agentSlug;
    const humanName = runtimeConfig.humanName ?? "";
    const guardrailPayload = runtimeConfig.guardrailConfig;
    const skillsConfig = runtimeConfig.skillsConfig;
    const knowledgeBasesConfig = runtimeConfig.knowledgeBasesConfig;
    const agent = {
      name: runtimeConfig.agentName,
      slug: runtimeConfig.agentSlug,
      human_pair_id: runtimeConfig.humanPairId,
    };

    if (guardrailPayload) {
      console.log(
        `[chat-agent-invoke] Guardrail resolved: bedrock=${guardrailPayload.guardrailIdentifier}`,
      );
    }

    if (knowledgeBasesConfig) {
      console.log(
        `[chat-agent-invoke] Agent ${agentId} has ${knowledgeBasesConfig.length} KB(s): ${knowledgeBasesConfig.map((k: any) => k.name).join(", ")}`,
      );
    }

    // PRD-38: Sub-agents are now skill-based (mode: agent in SKILL.md
    // frontmatter). The runtime reads mode/model from SKILL.md
    // frontmatter at /app/skills/{id}/SKILL.md (plan 2026-04-24-009 §U3
    // retired the parallel skill.yaml). No sub_agents payload needed —
    // removed DB-based sub-agent query.

    // 2a. Create a thread_turn record so the UI shows normal chat invocations.
    {
      try {
        const [countRow] = await db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(threadTurns)
          .where(eq(threadTurns.thread_id, threadId));
        const turnNumber = (countRow?.count || 0) + 1;

        const [turnRow] = await db
          .insert(threadTurns)
          .values({
            tenant_id: tenantId,
            agent_id: agentId,
            thread_id: threadId,
            invocation_source: "chat_message",
            runtime_type: runtimeType,
            status: "running",
            started_at: new Date(),
            last_activity_at: new Date(),
            turn_number: turnNumber,
            context_snapshot: {
              runtime_type: runtimeType,
              model: agentModel,
              agent_slug: agentSlug || undefined,
              space_id: spaceId || undefined,
              dispatcher: "chat-agent-invoke",
            },
          })
          .returning({ id: threadTurns.id });
        turnId = turnRow?.id;

        // Set wakeup_request_id = turn ID so cost lookup works
        if (turnId) {
          await db
            .update(threadTurns)
            .set({ wakeup_request_id: turnId })
            .where(eq(threadTurns.id, turnId));
        }

        // Notify subscribers that a turn started
        await notifyThreadTurnUpdate({
          runId: turnId!,
          tenantId,
          threadId,
          agentId,
          status: "running",
          triggerName: "Chat",
        });
      } catch (turnErr) {
        console.error(
          `[chat-agent-invoke] Failed to create thread_turn:`,
          turnErr,
        );
      }
    }

    // 2c. Load prior conversation history for this thread from Aurora.
    // The runtime container no longer has a working source of session memory
    // (AgentCore Memory was retired in PRD-41B Phase 3 — store_turn became a
    // no-op, so list_events returns nothing). The `messages` table is now
    // the source of truth, and we ship history inline in the invoke payload.
    // Cap at 30 turns: long enough for real conversation memory, short enough
    // to keep payloads reasonable.
    const HISTORY_LIMIT = 30;
    const historyConditions = [eq(messages.thread_id, threadId)];
    if (event.messageId) {
      // ne() generates a properly-typed uuid comparison; raw sql interpolation
      // would bind the messageId as `text`, which Postgres rejects against the
      // uuid column with `operator does not exist: uuid <> text`.
      historyConditions.push(ne(messages.id, event.messageId));
    }
    const priorMessageRows = await db
      .select({
        role: messages.role,
        content: messages.content,
      })
      .from(messages)
      .where(and(...historyConditions))
      .orderBy(sql`${messages.created_at} desc`)
      .limit(HISTORY_LIMIT);

    const messagesHistory = priorMessageRows
      .reverse()
      .filter(
        (m: { role: string | null; content: string | null }) =>
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.length > 0,
      )
      .map((m: { role: string | null; content: string | null }) => ({
        role: m.role as "user" | "assistant",
        content: m.content as string,
      }));

    console.log(
      `[chat-agent-invoke] Loaded ${messagesHistory.length} prior messages for thread=${threadId}`,
    );

    // MCP configs already resolved by runtimeConfig.
    const mcpConfigs = runtimeConfig.mcpConfigs;
    let effectiveBlockedTools = runtimeConfig.blockedTools;
    let renderedWorkspace: RenderWorkspaceTupleForInvokeResult = {
      rendered: false,
      reason: "not_attempted",
    };
    let renderedWorkspacePrefix: string | undefined;
    if (spaceId) {
      try {
        renderedWorkspace = await renderWorkspaceTupleForInvoke({
          tenantId,
          agentId,
          spaceId,
          userId: currentUserId || null,
          agentBlockedTools: runtimeConfig.blockedTools,
        });
        if (renderedWorkspace.rendered) {
          renderedWorkspacePrefix = renderedWorkspace.renderedPrefix;
          effectiveBlockedTools =
            renderedWorkspace.effectivePolicy?.blockedTools ??
            runtimeConfig.blockedTools;
          console.log(
            `[chat-agent-invoke] rendered workspace tuple space=${renderedWorkspace.activeSpace?.slug ?? spaceId} prefix=${renderedWorkspacePrefix} cache=${renderedWorkspace.cacheStatus ?? "unknown"}`,
          );
        } else {
          console.log(
            `[chat-agent-invoke] rendered workspace tuple skipped: ${renderedWorkspace.reason}`,
          );
          if (renderedWorkspace.errorCode === "SpaceAccessDenied") {
            throw new Error(
              `workspace_renderer_access_denied:${renderedWorkspace.reason ?? "SpaceAccessDenied"}`,
            );
          }
        }
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.startsWith("workspace_renderer_access_denied:")
        ) {
          console.error(
            `[chat-agent-invoke] rendered workspace tuple denied; aborting turn:`,
            err,
          );
          if (turnId) {
            try {
              await db
                .update(threadTurns)
                .set({
                  status: "failed",
                  finished_at: new Date(),
                  error: err.message,
                })
                .where(eq(threadTurns.id, turnId));
              await notifyThreadTurnUpdate({
                runId: turnId,
                tenantId,
                threadId,
                agentId,
                status: "failed",
                triggerName: "Chat",
              });
            } catch (turnErr) {
              console.error(
                `[chat-agent-invoke] Failed to mark denied render turn as failed:`,
                turnErr,
              );
            }
          }
          return;
        }
        console.error(
          `[chat-agent-invoke] rendered workspace tuple failed; falling back to legacy workspace sync:`,
          err,
        );
      }
    }

    const isEffectivelyBlocked = (toolName: string): boolean =>
      effectiveBlockedTools.includes(toolName);
    const isAnyEffectivelyBlocked = (...toolNames: string[]): boolean =>
      toolNames.some((toolName) => isEffectivelyBlocked(toolName));
    const effectiveSkillsConfig =
      effectiveBlockedTools.length > 0
        ? skillsConfig.filter(
            (skill: { skillId: string }) =>
              !effectiveBlockedTools.includes(skill.skillId),
          )
        : skillsConfig;
    const effectiveMcpPolicy = renderedWorkspace.rendered
      ? (renderedWorkspace.effectivePolicy ?? null)
      : null;
    const effectiveMcpConfigs = mcpConfigs.filter(
      (config: { name: string }) => {
        if (effectiveMcpPolicy?.mcpBlockedServers.includes(config.name)) {
          return false;
        }
        if (
          effectiveMcpPolicy?.mcpAllowedServers &&
          !effectiveMcpPolicy.mcpAllowedServers.includes(config.name)
        ) {
          return false;
        }
        return true;
      },
    );

    // 2d. Call AgentCore Lambda directly via the SDK (no Function URL).
    console.log(
      `[chat-agent-invoke] Invoking AgentCore runtime=${runtimeType} model=${agentModel} skills=${effectiveSkillsConfig.length} mcp=${effectiveMcpConfigs.length}`,
    );

    const agentcoreFunctionName = resolveRuntimeFunctionName(runtimeType);

    let workflowSkill: unknown = undefined;

    // Sandbox pre-flight (plan Unit 9). Decides whether to register the
    // execute_code tool for this turn. R15-consistent: we use the actual
    // invoker (currentUserId), not agent.human_pair_id — a wakeup-style
    // fallback would hand every webhook-triggered run the agent owner's
    // sandbox tokens.
    let sandboxPreflight: SandboxPreflightResult | null = null;
    if (currentUserId && runtimeConfig.sandboxTemplate) {
      try {
        sandboxPreflight = await checkSandboxPreflight({
          stage: STAGE,
          tenantId,
          agentId,
          userId: currentUserId,
          templateSandbox: runtimeConfig.sandboxTemplate,
        });
        console.log(
          `[chat-agent-invoke] sandbox pre-flight: ${sandboxPreflight.status}`,
        );
      } catch (err) {
        console.error(`[chat-agent-invoke] sandbox pre-flight failed:`, err);
        sandboxPreflight = null;
      }
    }

    const invokeStart = Date.now();
    const invokePayload = {
      tenant_id: tenantId,
      // Unit 7 tightened `_ensure_workspace_ready` to early-return when
      // `workspace_tenant_id` is empty. chat-agent-invoke was never updated
      // to send it — so the container skipped the composer fetch entirely,
      // `/tmp/workspace` stayed empty, AGENTS.md/USER.md never loaded, and
      // the agent answered from stale default workspace content + a hallucinated identity.
      // Matches agentcore-invoke.ts:237 and eval-runner.ts:276.
      workspace_tenant_id: tenantId,
      assistant_id: agentId,
      thread_id: threadId,
      // R15: only the actual human invoker (message sender / thread creator).
      // Connector-created threads are the narrow exception: they run as the
      // target agent's paired human so Pi receives a user_id for memory/tools.
      // Generic wakeup-style runs still do not fall back to human_pair_id.
      user_id: currentUserId || undefined,
      current_user_email: currentUserEmail || undefined,
      trace_id: traceId,
      message: userMessage,
      messages_history: messagesHistory,
      use_memory: true,
      tenant_slug: tenantSlug || undefined,
      instance_id: agentSlug || undefined,
      agent_name: agent.name,
      system_prompt: runtimeConfig.agentSystemPrompt || undefined,
      human_name: humanName || undefined,
      workspace_bucket: WORKSPACE_BUCKET || undefined,
      rendered_workspace_prefix: renderedWorkspacePrefix,
      // Unit 7: container calls /api/workspaces/files at bootstrap via
      // x-api-key auth. Plumb the API URL + service secret so the
      // container can set them on os.environ and use them for the
      // composer fetch.
      thinkwork_api_url: THINKWORK_API_URL || undefined,
      thinkwork_api_secret: THINKWORK_API_SECRET || undefined,
      appsync_endpoint: APPSYNC_ENDPOINT || undefined,
      appsync_api_key: APPSYNC_API_KEY || undefined,
      computer_id: event.computerId || undefined,
      computer_task_id: event.computerTaskId || undefined,
      computer_response_mode: "thread_turn",
      hindsight_endpoint: HINDSIGHT_ENDPOINT || undefined,
      web_search_config: !isAnyEffectivelyBlocked("web-search", "web_search")
        ? runtimeConfig.webSearchConfig
        : undefined,
      send_email_config:
        runtimeConfig.sendEmailConfig && !isEffectivelyBlocked("send_email")
          ? { ...runtimeConfig.sendEmailConfig, threadId }
          : undefined,
      context_engine_enabled:
        runtimeConfig.contextEngineEnabled &&
        !isAnyEffectivelyBlocked("query_context", "context_engine")
          ? true
          : undefined,
      context_engine_config: !isAnyEffectivelyBlocked(
        "query_context",
        "context_engine",
      )
        ? runtimeConfig.contextEngineConfig
        : undefined,
      runtime_type: runtimeType,
      model: agentModel,
      budget_monthly_cents: runtimeConfig.budgetMonthlyCents,
      budget_paused: runtimeConfig.budgetPaused,
      skills:
        effectiveSkillsConfig.length > 0 ? effectiveSkillsConfig : undefined,
      knowledge_bases: knowledgeBasesConfig,
      trigger_channel: "chat",
      guardrail_config: guardrailPayload || undefined,
      mcp_configs:
        effectiveMcpConfigs.length > 0 ? effectiveMcpConfigs : undefined,
      workflow_skill: workflowSkill,
      blocked_tools:
        effectiveBlockedTools.length > 0 ? effectiveBlockedTools : undefined,
      browser_automation_enabled:
        runtimeConfig.browserAutomationEnabled &&
        !isAnyEffectivelyBlocked("browser_automation", "browser")
          ? true
          : undefined,
      turn_context: spaceId
        ? {
            spaceId: renderedWorkspace.activeSpace?.id ?? spaceId,
            tenantSlug: tenantSlug || undefined,
            spaceSlug: renderedWorkspace.activeSpace?.slug ?? spaceSlug,
            renderedWorkspacePrefix,
          }
        : undefined,
      // U3 of the finance pilot — Strands' _execute_agent_turn reads
      // payload["message_attachments"] directly off this dict (no
      // apply_invocation_env indirection; that helper is an os.environ
      // setter for scalar strings, not an array-of-records carrier).
      // Convert camelCase → snake_case at the field-shape boundary so
      // the Python side sees the conventional Python casing.
      message_attachments:
        event.messageAttachments && event.messageAttachments.length > 0
          ? event.messageAttachments.map((att) => ({
              attachment_id: att.attachmentId,
              s3_key: att.s3Key,
              name: att.name,
              mime_type: att.mimeType,
              size_bytes: att.sizeBytes,
            }))
          : undefined,
      // Finalize-callback opt-in (plan 2026-05-22-006 U3). The Strands
      // runtime POSTs its end-of-turn result to this URL with the bearer
      // secret, so chat-agent-invoke can dispatch Event-mode without
      // waiting for the AgentCore Lambda response. eval-runner /
      // agentcore-direct do NOT supply these fields and keep their
      // synchronous response path.
      finalize_callback_url:
        THINKWORK_API_URL && turnId
          ? `${THINKWORK_API_URL.replace(/\/$/, "")}/api/threads/${threadId}/finalize`
          : undefined,
      finalize_callback_secret:
        THINKWORK_API_SECRET && turnId ? THINKWORK_API_SECRET : undefined,
      thread_turn_id: turnId || undefined,
    } as Record<string, unknown>;

    if (sandboxPreflight && currentUserId) {
      invokePayload.sandbox_status = sandboxPreflight.status;
      invokePayload.sandbox_reason =
        "reason" in sandboxPreflight ? sandboxPreflight.reason : undefined;
      applySandboxPayloadFields(invokePayload, sandboxPreflight);
      if (sandboxPreflight.status !== "ready") {
        console.log(
          `[chat-agent-invoke] sandbox not registered for this turn: ${sandboxPreflight.status}`,
          sandboxPreflight.status === "provisioning"
            ? { environment: sandboxPreflight.environment }
            : {},
        );
      }
    }

    // The agentcore container runs an HTTP server behind Lambda Web Adapter;
    // POSTs must be wrapped in an API Gateway v2-style event targeting /invocations.
    const lambdaEventPayload = JSON.stringify({
      requestContext: { http: { method: "POST", path: "/invocations" } },
      rawPath: "/invocations",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(invokePayload),
      isBase64Encoded: false,
    });

    // Event-mode dispatch (plan 2026-05-22-006 U3). The Strands runtime
    // owns the post-AgentCore bookkeeping via the finalize-callback POST
    // wired in U2; chat-agent-invoke just sets up the payload, fires
    // AgentCore Event-mode, and returns. The SDK call resolves once AWS
    // has queued the event (~tens of ms) — there is no per-turn wait
    // anymore, so the 5-min Lambda timeout / auto-retry cascade is gone.
    //
    // Any synchronous failure here (throttling, IAM, function-not-found)
    // throws from `lambdaClient.send` — the outer catch handles it. AWS
    // does NOT route Event-mode FunctionErrors back; those land in the
    // DLQ wired in handlers.tf.
    try {
      await lambdaClient.send(
        new InvokeCommand({
          FunctionName: agentcoreFunctionName,
          InvocationType: "Event",
          Payload: new TextEncoder().encode(lambdaEventPayload),
        }),
      );
      console.log(
        `[chat-agent-invoke] AgentCore Event-mode dispatch accepted in ${Date.now() - invokeStart}ms`,
      );
      return;
    } catch (dispatchErr) {
      const errMsgText = `AgentCore dispatch failed: ${dispatchErr instanceof Error ? dispatchErr.message : String(dispatchErr)}`;
      console.error(`[chat-agent-invoke] ${errMsgText}`);
      await markComputerTaskFailedFromFinalize({
        tenantId,
        computerId: event.computerId,
        taskId: event.computerTaskId,
        threadId,
        messageId: event.messageId,
        message: errMsgText,
        code: "agentcore_dispatch_failed",
      });
      if (turnId) {
        try {
          await db
            .update(threadTurns)
            .set({
              status: "failed",
              finished_at: new Date(),
              error: errMsgText,
            })
            .where(eq(threadTurns.id, turnId));
        } catch {}
      }
      const errMsg = await insertAssistantMessage(
        threadId,
        tenantId,
        agentId,
        GENERIC_AGENT_ERROR_MESSAGE,
      );
      if (errMsg) {
        await notifyNewMessage({
          messageId: errMsg.id,
          threadId,
          tenantId,
          role: "assistant",
          content: GENERIC_AGENT_ERROR_MESSAGE,
          senderType: "agent",
          senderId: agentId,
        });
      }
      return;
    }
  } catch (err) {
    // Outer setup error path. The original handler had a very large
    // try/catch wrapping the entire flow; with the post-AgentCore body
    // gone, the only paths that reach here are pre-dispatch setup
    // failures (agent lookup, runtime config resolve, etc.).
    console.error(`[chat-agent-invoke] Setup error:`, err);
    return;
  }
}

async function resolveThreadSpaceContext(input: {
  tenantId: string;
  threadId: string;
}): Promise<{ spaceId: string; spaceSlug: string | null } | null> {
  const [thread] = await db
    .select({ spaceId: threads.space_id })
    .from(threads)
    .where(
      and(
        eq(threads.id, input.threadId),
        eq(threads.tenant_id, input.tenantId),
      ),
    )
    .limit(1);
  if (!thread?.spaceId) return null;

  const [space] = await db
    .select({ slug: spaces.slug })
    .from(spaces)
    .where(
      and(eq(spaces.tenant_id, input.tenantId), eq(spaces.id, thread.spaceId)),
    )
    .limit(1);
  return { spaceId: thread.spaceId, spaceSlug: space?.slug ?? null };
}
