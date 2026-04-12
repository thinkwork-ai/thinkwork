/**
 * Chat Agent Invoke Lambda
 *
 * Invoked asynchronously (fire-and-forget) by the graphql-resolver after a
 * user message is inserted. This Lambda:
 *
 * 1. Looks up the agent to determine runtime type + model
 * 2. Calls the AgentCore Invoke Lambda Function URL
 * 3. Inserts the assistant response into the messages table
 * 4. Calls the AppSync notifyNewMessage mutation to push to subscribers
 */

import { eq, and, ne, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { agents, agentTemplates, agentSkills, messages, threads, tenants, tenantSkills, users, agentKnowledgeBases, knowledgeBases, threadTurns, costEvents, guardrails, guardrailBlocks } from "@thinkwork/database-pg/schema";
import { randomBytes } from "crypto";
import {
  extractUsage,
  recordCostEvents,
  checkBudgetAndPause,
  notifyCostRecorded,
} from "../lib/cost-recording.js";
import { buildSkillEnvOverrides } from "../lib/oauth-token.js";
import { loadTenantBuiltinTools } from "./skills.js";
// PRD-22: Signal protocol removed — agents use tools for thread state transitions

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

const AGENTCORE_INVOKE_URL = process.env.AGENTCORE_INVOKE_URL || "";
const APPSYNC_ENDPOINT = process.env.APPSYNC_ENDPOINT || "";
const APPSYNC_API_KEY = process.env.APPSYNC_API_KEY || "";
const MANIFLOW_API_SECRET = process.env.MANIFLOW_API_SECRET || "";
const WORKSPACE_BUCKET = process.env.WORKSPACE_BUCKET || "";
// API URL used by skills for callbacks (thread-management, email-send, etc.)
// Reads MANIFLOW_API_URL first, falls back to legacy MCP_BASE_URL until infra is updated.
const MANIFLOW_API_URL = process.env.MANIFLOW_API_URL || process.env.MCP_BASE_URL || "";
const HINDSIGHT_ENDPOINT = process.env.HINDSIGHT_ENDPOINT || "";

const db = getDb();

/** Extract plain text from AgentCore response (handles ChatCompletion, raw text, etc.) */
function extractResponseText(data: unknown): string {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return String(data);

  const obj = data as Record<string, any>;

  // OpenAI ChatCompletion format: { choices: [{ message: { content: "..." } }] }
  if (Array.isArray(obj.choices) && obj.choices[0]?.message?.content) {
    return obj.choices[0].message.content;
  }

  // Direct content fields
  if (typeof obj.content === "string") return obj.content;
  if (typeof obj.response === "string") return obj.response;
  if (typeof obj.output === "string") return obj.output;
  if (typeof obj.text === "string") return obj.text;

  // Nested response object
  if (obj.response && typeof obj.response === "object") {
    return extractResponseText(obj.response);
  }

  return JSON.stringify(data);
}

interface InvokeEvent {
  threadId: string;
  tenantId: string;
  agentId: string;
  userMessage: string;
  messageId?: string;
}

export async function handler(event: InvokeEvent): Promise<void> {
  const { threadId, tenantId, agentId, userMessage } = event;
  const traceId = getTraceId();
  console.log(`[chat-agent-invoke] threadId=${threadId} agentId=${agentId} traceId=${traceId}`);

  let turnId: string | undefined;
  try {
    // 1. Look up agent + its template for runtime type, model, security posture
    const [agent] = await db
      .select({
        adapter_type: agents.adapter_type,
        name: agents.name,
        slug: agents.slug,
        human_pair_id: agents.human_pair_id,
        template_id: agents.template_id,
      })
      .from(agents)
      .where(eq(agents.id, agentId));

    if (!agent) {
      console.error(`[chat-agent-invoke] Agent not found: ${agentId}`);
      return;
    }

    // Look up the agent's template (model, guardrail, blocked tools)
    const [agentTemplate] = await db
      .select({
        model: agentTemplates.model,
        guardrail_id: agentTemplates.guardrail_id,
        blocked_tools: agentTemplates.blocked_tools,
      })
      .from(agentTemplates)
      .where(eq(agentTemplates.id, agent.template_id));

    if (!agentTemplate) {
      console.error(`[chat-agent-invoke] Agent template not found: ${agent.template_id}`);
      return;
    }

    const runtimeType = "strands"; // All agents use Strands (SDK deprecated)
    const agentModel = agentTemplate.model || null;

    // Look up tenant slug for workspace path
    const [tenant] = await db
      .select({ slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    const tenantSlug = tenant?.slug || "";
    const agentSlug = agent.slug || "";

    // Look up current user's email for skill context (PRD-40: "me" resolution)
    let currentUserEmail = "";
    if (event.messageId) {
      const [msg] = await db.select({ sender_id: messages.sender_id, sender_type: messages.sender_type }).from(messages).where(eq(messages.id, event.messageId));
      if (msg?.sender_type === "human" && msg.sender_id) {
        const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, msg.sender_id));
        currentUserEmail = u?.email || "";
      }
    }
    if (!currentUserEmail) {
      // Fallback: thread creator
      const [thread] = await db.select({ created_by_id: threads.created_by_id, created_by_type: threads.created_by_type }).from(threads).where(eq(threads.id, threadId));
      if (thread?.created_by_type === "user" && thread.created_by_id) {
        const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, thread.created_by_id));
        currentUserEmail = u?.email || "";
      }
    }
    if (!currentUserEmail && agent.human_pair_id) {
      // Fallback: agent's human pair (owner)
      const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, agent.human_pair_id));
      currentUserEmail = u?.email || "";
    }

    // Look up human pair name for personality file bootstrap
    let humanName = "";
    if (agent.human_pair_id) {
      const [human] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, agent.human_pair_id));
      humanName = human?.name || "";
    }

    // Resolve Bedrock guardrail: template-level → tenant default → none
    let guardrailPayload: { guardrailIdentifier: string; guardrailVersion: string } | undefined;
    let effectiveGuardrailId: string | null = agentTemplate.guardrail_id;

    if (effectiveGuardrailId) {
      const [gr] = await db
        .select({
          bedrock_guardrail_id: guardrails.bedrock_guardrail_id,
          bedrock_version: guardrails.bedrock_version,
        })
        .from(guardrails)
        .where(eq(guardrails.id, effectiveGuardrailId));
      if (gr?.bedrock_guardrail_id && gr?.bedrock_version) {
        guardrailPayload = {
          guardrailIdentifier: gr.bedrock_guardrail_id,
          guardrailVersion: gr.bedrock_version,
        };
      }
    } else {
      // Fall back to tenant default guardrail
      const [defaultGr] = await db
        .select({
          id: guardrails.id,
          bedrock_guardrail_id: guardrails.bedrock_guardrail_id,
          bedrock_version: guardrails.bedrock_version,
        })
        .from(guardrails)
        .where(and(eq(guardrails.tenant_id, tenantId), eq(guardrails.is_default, true)));
      if (defaultGr?.bedrock_guardrail_id && defaultGr?.bedrock_version) {
        effectiveGuardrailId = defaultGr.id;
        guardrailPayload = {
          guardrailIdentifier: defaultGr.bedrock_guardrail_id,
          guardrailVersion: defaultGr.bedrock_version,
        };
      }
    }

    if (guardrailPayload) {
      console.log(`[chat-agent-invoke] Guardrail resolved: id=${effectiveGuardrailId} bedrock=${guardrailPayload.guardrailIdentifier}`);
    }

    // Resolve blocked tools from agent template
    const blockedTools: string[] = (agentTemplate.blocked_tools as string[] | null) || [];

    // Look up agent's installed skills → build S3 keys for runtime
    // Join with tenant_skills to determine source (builtin/catalog → catalog prefix, tenant → agent prefix)
    const skillRows = await db
      .select({
        skill_id: agentSkills.skill_id,
        config: agentSkills.config,
        source: tenantSkills.source,
      })
      .from(agentSkills)
      .leftJoin(tenantSkills, and(
        eq(tenantSkills.tenant_id, tenantId),
        eq(tenantSkills.skill_id, agentSkills.skill_id),
      ))
      .where(eq(agentSkills.agent_id, agentId));

    let skillsConfig = await Promise.all(skillRows.map(async (s: { skill_id: string; config: unknown; source: string | null }) => {
      const config = (s.config as Record<string, unknown>) || {};
      const envOverrides = await buildSkillEnvOverrides(config, tenantId).catch((err) => {
        console.warn(`[chat-agent-invoke] envOverrides failed for skill ${s.skill_id}:`, err);
        return null;
      });
      // Builtin/catalog skills use the canonical catalog prefix; tenant-created skills use the agent prefix
      const isTenantCustom = s.source === "tenant";
      const s3Key = isTenantCustom
        ? `tenants/${tenantSlug}/skills/${s.skill_id}`
        : `skills/catalog/${s.skill_id}`;
      const merged = envOverrides ? { ...envOverrides } : {};
      return {
        skillId: s.skill_id,
        s3Key,
        secretRef: config.secretRef as string || undefined,
        envOverrides: Object.keys(merged).length > 0 ? merged : undefined,
      };
    }));

    // Default skill: agent-email-send — always available for all agents
    const hasEmailSendSkill = skillsConfig.some((s) => s.skillId === "agent-email-send");
    if (!hasEmailSendSkill) {
      skillsConfig.push({
        skillId: "agent-email-send",
        s3Key: "skills/catalog/agent-email-send",
        secretRef: undefined,
        envOverrides: {
          AGENT_EMAIL_ADDRESS: `${agentSlug}@agents.thinkwork.ai`,
          AGENT_ID: agentId,
          MANIFLOW_API_URL: MANIFLOW_API_URL,
          MANIFLOW_API_SECRET: MANIFLOW_API_SECRET,
          INBOUND_MESSAGE_ID: "",
          INBOUND_SUBJECT: "",
          INBOUND_FROM: "",
          INBOUND_BODY: "",
        },
      });
    }

    // Default skills: always available for all agents (Phase 4a/4b script skills).
    // web-search is NOT in this list — it's opt-in via tenant_builtin_tools below.
    const defaultSkills = [
      { skillId: "agent-thread-management", s3Key: "skills/catalog/agent-thread-management" },
      { skillId: "artifacts", s3Key: "skills/catalog/artifacts" },
      { skillId: "workspace-memory", s3Key: "skills/catalog/workspace-memory" },
    ];
    for (const ds of defaultSkills) {
      if (!skillsConfig.some((s) => s.skillId === ds.skillId)) {
        const env: Record<string, string> = {
          MANIFLOW_API_URL: MANIFLOW_API_URL,
          MANIFLOW_API_SECRET: MANIFLOW_API_SECRET,
          GRAPHQL_API_KEY: APPSYNC_API_KEY,
          AGENT_ID: agentId,
        };
        if (currentUserEmail) env.CURRENT_USER_EMAIL = currentUserEmail;
        skillsConfig.push({
          ...ds,
          secretRef: undefined,
          envOverrides: env,
        });
      }
    }

    // Tenant-configured built-in tools (web-search, …): only injected when a row
    // exists with enabled=true AND a usable API key in Secrets Manager.
    try {
      const builtinTools = await loadTenantBuiltinTools(tenantId);
      for (const bt of builtinTools) {
        if (skillsConfig.some((s) => s.skillId === bt.toolSlug)) continue;
        skillsConfig.push({
          skillId: bt.toolSlug,
          s3Key: `skills/catalog/${bt.toolSlug}`,
          secretRef: undefined,
          envOverrides: bt.envOverrides,
        });
        console.log(`[chat-agent-invoke] Injected built-in tool '${bt.toolSlug}' (provider=${bt.provider})`);
      }
    } catch (err) {
      console.warn(`[chat-agent-invoke] Failed to load tenant built-in tools:`, err);
    }

    // Apply class tool_access policy — remove blocked skills
    if (blockedTools.length > 0) {
      const before = skillsConfig.length;
      skillsConfig = skillsConfig.filter((s) => !blockedTools.includes(s.skillId));
      const removed = before - skillsConfig.length;
      if (removed > 0) {
        console.log(`[chat-agent-invoke] Class tool_access: removed ${removed} blocked skill(s)`);
      }
    }

    // Look up agent's assigned knowledge bases (PRD-13)
    const kbRows = await db
      .select({
        aws_kb_id: knowledgeBases.aws_kb_id,
        name: knowledgeBases.name,
        description: knowledgeBases.description,
        search_config: agentKnowledgeBases.search_config,
      })
      .from(agentKnowledgeBases)
      .innerJoin(knowledgeBases, eq(agentKnowledgeBases.knowledge_base_id, knowledgeBases.id))
      .where(and(
        eq(agentKnowledgeBases.agent_id, agentId),
        eq(agentKnowledgeBases.enabled, true),
      ))
      .then((rows) => rows.filter((r) => r.aws_kb_id));

    const knowledgeBasesConfig = kbRows.length > 0
      ? kbRows.map((kb) => ({
          awsKbId: kb.aws_kb_id,
          name: kb.name,
          description: kb.description,
          searchConfig: kb.search_config,
        }))
      : undefined;

    if (knowledgeBasesConfig) {
      console.log(`[chat-agent-invoke] Agent ${agentId} has ${knowledgeBasesConfig.length} KB(s): ${knowledgeBasesConfig.map((k: any) => k.name).join(", ")}`);
    }

    // PRD-38: Sub-agents are now skill-based (mode: agent in skill.yaml).
    // The runtime reads mode/model from skill.yaml at /app/skills/{id}/skill.yaml.
    // No sub_agents payload needed — removed DB-based sub-agent query.

    // 2a. Create a thread_turn record so the UI shows this invocation
    try {
      const [countRow] = await db.select({ count: sql<number>`COUNT(*)::int` }).from(threadTurns).where(eq(threadTurns.thread_id, threadId));
      const turnNumber = (countRow?.count || 0) + 1;

      const [turnRow] = await db
        .insert(threadTurns)
        .values({
          tenant_id: tenantId,
          agent_id: agentId,
          thread_id: threadId,
          invocation_source: "chat_message",
          status: "running",
          started_at: new Date(),
          last_activity_at: new Date(),
          turn_number: turnNumber,
        })
        .returning({ id: threadTurns.id });
      turnId = turnRow?.id;

      // Set wakeup_request_id = turn ID so cost lookup works
      if (turnId) {
        await db.update(threadTurns).set({ wakeup_request_id: turnId }).where(eq(threadTurns.id, turnId));
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
      console.error(`[chat-agent-invoke] Failed to create thread_turn:`, turnErr);
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
      .filter((m: { role: string | null; content: string | null }) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.length > 0,
      )
      .map((m: { role: string | null; content: string | null }) => ({
        role: m.role as "user" | "assistant",
        content: m.content as string,
      }));

    console.log(`[chat-agent-invoke] Loaded ${messagesHistory.length} prior messages for thread=${threadId}`);

    // 2d. Call AgentCore Invoke Lambda Function URL
    console.log(`[chat-agent-invoke] Invoking AgentCore runtime=${runtimeType} model=${agentModel} skills=${skillsConfig.length}`);

    const invokeStart = Date.now();
    const invokeResponse = await fetch(AGENTCORE_INVOKE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(MANIFLOW_API_SECRET ? { Authorization: `Bearer ${MANIFLOW_API_SECRET}` } : {}),
      },
      body: JSON.stringify({
        tenant_id: tenantId,
        assistant_id: agentId,
        thread_id: threadId,
        user_id: agent.human_pair_id || undefined,
        trace_id: traceId,
        message: userMessage,
        messages_history: messagesHistory,
        use_memory: true,
        tenant_slug: tenantSlug || undefined,
        instance_id: agentSlug || undefined,
        agent_name: agent.name,
        human_name: humanName || undefined,
        workspace_bucket: WORKSPACE_BUCKET || undefined,
        hindsight_endpoint: HINDSIGHT_ENDPOINT || undefined,
        runtime_type: runtimeType,
        model: agentModel,
        skills: skillsConfig.length > 0 ? skillsConfig : undefined,
        knowledge_bases: knowledgeBasesConfig,
        trigger_channel: "chat",
        guardrail_config: guardrailPayload || undefined,
      }),
    });

    if (!invokeResponse.ok) {
      const errText = await invokeResponse.text();
      console.error(`[chat-agent-invoke] AgentCore invoke failed: ${invokeResponse.status} ${errText}`);
      // Mark turn as failed
      if (turnId) {
        try {
          await db.update(threadTurns).set({ status: "failed", finished_at: new Date(), error: `AgentCore ${invokeResponse.status}: ${errText.slice(0, 500)}` }).where(eq(threadTurns.id, turnId));
          await notifyThreadTurnUpdate({ runId: turnId, tenantId, threadId, agentId, status: "failed", triggerName: "Chat" });
        } catch {}
      }
      // Insert error message so the user sees feedback
      const errMsg = await insertAssistantMessage(threadId, tenantId, agentId, `I'm sorry, I encountered an error processing your request. Please try again.`);
      if (errMsg) {
        await notifyNewMessage({ messageId: errMsg.id, threadId, tenantId, role: "assistant", content: "I'm sorry, I encountered an error processing your request. Please try again.", senderType: "agent", senderId: agentId });
      }
      return;
    }

    const durationMs = Date.now() - invokeStart;
    const invokeResult = await invokeResponse.json() as Record<string, any>;
    console.log(`[chat-agent-invoke] AgentCore response received in ${durationMs}ms`);

    // Extract response text from AgentCore result
    const responseData = invokeResult.response || invokeResult;
    let responseText = extractResponseText(responseData);

    // Check for guardrail block
    const guardrailBlock = invokeResult.guardrail_block ||
      (invokeResult.response as Record<string, unknown>)?.guardrail_block;

    if (guardrailBlock?.blocked) {
      console.log(`[chat-agent-invoke] Guardrail block detected: type=${guardrailBlock.type} action=${guardrailBlock.action}`);
      responseText = "This request was blocked by a content policy.";

      if (effectiveGuardrailId) {
        try {
          await db.insert(guardrailBlocks).values({
            tenant_id: tenantId,
            agent_id: agentId,
            guardrail_id: effectiveGuardrailId,
            thread_id: threadId || undefined,
            block_type: guardrailBlock.type || "INPUT",
            action: guardrailBlock.action || "BLOCKED",
            blocked_topics: guardrailBlock.topics || [],
            content_filters: guardrailBlock.filters || {},
            raw_response: guardrailBlock.raw || {},
            user_message: userMessage.slice(0, 1000),
          });
          console.log(`[chat-agent-invoke] Guardrail block recorded to DB`);
        } catch (blockErr) {
          console.error(`[chat-agent-invoke] Failed to record guardrail block:`, blockErr);
        }
      }
    }

    console.log(`[chat-agent-invoke] Extracted response (${responseText.length} chars): ${responseText.slice(0, 100)}`);

    // Record cost events (PRD-02)
    const usage = extractUsage(invokeResult);
    const bedrockRequestIds = (responseData as any)?.bedrock_request_ids as string[] | undefined;

    try {
      const costResult = await recordCostEvents({
        tenantId,
        agentId,
        requestId: turnId ?? `chat-${threadId}-${Date.now()}`,
        model: usage.model || agentModel || null,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedReadTokens: usage.cachedReadTokens,
        durationMs,
        inputText: userMessage,
        outputText: responseText,
        threadId,
        traceId,
        bedrockRequestIds,
      });
      await checkBudgetAndPause(tenantId, agentId);

      if (costResult.totalUsd > 0) {
        await notifyCostRecorded({
          tenantId,
          agentId,
          agentName: agent.name,
          eventType: "invocation",
          amountUsd: costResult.totalUsd,
          model: usage.model || agentModel || null,
        });
      }
    } catch (costErr) {
      console.error(`[chat-agent-invoke] Cost recording failed:`, costErr);
    }

    // PRD-41B Phase 7 item 2: drain Hindsight retain/reflect token usage
    // captured by the agent container's hindsight_usage_capture monkey-patch
    // and emit one cost_events row per call. Each entry is shaped:
    //   { phase: 'retain'|'reflect', model: string, input_tokens, output_tokens }
    const hindsightUsage = ((responseData as any)?.hindsight_usage
      || (invokeResult.hindsight_usage)
      || []) as Array<{
        phase: "retain" | "reflect";
        model: string;
        input_tokens: number;
        output_tokens: number;
      }>;
    if (hindsightUsage.length > 0) {
      try {
        const { recordHindsightCost } = await import("../lib/hindsight-cost.js");
        for (const entry of hindsightUsage) {
          await recordHindsightCost({
            tenantId,
            agentId,
            bankId: agentSlug,
            phase: entry.phase,
            model: entry.model,
            inputTokens: entry.input_tokens,
            outputTokens: entry.output_tokens,
            threadId,
            traceId,
            source: "agent_invoke",
          });
        }
        console.log(`[chat-agent-invoke] Recorded ${hindsightUsage.length} Hindsight cost event(s)`);
      } catch (hsCostErr) {
        console.error(`[chat-agent-invoke] Hindsight cost recording failed:`, hsCostErr);
      }
    }

    // 2b2. Record tool costs (Nova Act, browser sessions, etc.)
    const toolCosts = (invokeResult.tool_costs || (invokeResult.response as Record<string, unknown>)?.tool_costs || []) as Array<Record<string, unknown>>;
    if (toolCosts.length > 0) {
      try {
        for (const tc of toolCosts) {
          await db.insert(costEvents).values({
            tenant_id: tenantId,
            agent_id: agentId,
            thread_id: threadId || undefined,
            request_id: crypto.randomUUID(),
            event_type: String(tc.event_type || "tool_cost"),
            amount_usd: String(tc.amount_usd || "0.000000"),
            provider: String(tc.provider || "unknown"),
            duration_ms: (tc.duration_ms as number) || null,
            trace_id: traceId || undefined,
            metadata: tc.metadata || {},
          }).onConflictDoNothing();
        }
        console.log(`[chat-agent-invoke] Recorded ${toolCosts.length} tool cost(s)`);
      } catch (err) {
        console.error(`[chat-agent-invoke] Tool cost recording failed:`, err);
      }
    }

    // 2c. Update the thread_turn as succeeded
    if (turnId) {
      try {
        await db
          .update(threadTurns)
          .set({
            status: "succeeded",
            finished_at: new Date(),
            result_json: { response: responseText.slice(0, 10000) },
            usage_json: {
              duration_ms: durationMs,
              input_tokens: usage.inputTokens,
              output_tokens: usage.outputTokens,
              cached_read_tokens: usage.cachedReadTokens,
              tools_called: (invokeResult.tools_called || (invokeResult.response as Record<string, unknown>)?.tools_called || []) as string[],
              tool_costs: toolCosts.map((tc) => ({ event_type: tc.event_type, amount_usd: tc.amount_usd, provider: tc.provider })),
              tool_invocations: (invokeResult.tool_invocations || (invokeResult.response as Record<string, unknown>)?.tool_invocations || []) as any[],
            },
          })
          .where(eq(threadTurns.id, turnId));

        await notifyThreadTurnUpdate({
          runId: turnId,
          tenantId,
          threadId,
          agentId,
          status: "succeeded",
          triggerName: "Chat",
        });
      } catch (turnErr) {
        console.error(`[chat-agent-invoke] Failed to update thread_turn:`, turnErr);
      }
    }

    if (!responseText || responseText === "{}") {
      console.warn(`[chat-agent-invoke] Empty response from AgentCore`);
      return;
    }

    // PRD-22: Use response directly (signal protocol removed)
    const displayResponse = responseText;

    // Extract tool invocations for GenUI rendering
    const toolInvocations = (invokeResult.tool_invocations || (invokeResult.response as Record<string, unknown>)?.tool_invocations || []) as Array<Record<string, unknown>>;

    // 3. Insert assistant message into DB (with GenUI tool results if present)
    const assistantMsg = await insertAssistantMessage(threadId, tenantId, agentId, displayResponse, toolInvocations);

    // 3a. Link orphan artifacts created during this turn to the thread + message.
    // The Strands runtime doesn't forward thread_id to MCP tools, so artifacts
    // created via create_artifact lack thread_id and source_message_id.
    // Scope: only artifacts by this agent, in this tenant, created during this turn window.
    if (assistantMsg && turnId) {
      try {
        const { artifacts } = await import("@thinkwork/database-pg/schema");
        const { isNull, gte } = await import("drizzle-orm");
        const turnStart = new Date(Date.now() - (durationMs + 5000)); // turn duration + buffer
        await db.update(artifacts).set({
          thread_id: threadId,
          source_message_id: assistantMsg.id,
        }).where(and(
          eq(artifacts.agent_id, agentId),
          eq(artifacts.tenant_id, tenantId),
          isNull(artifacts.source_message_id),
          gte(artifacts.created_at, turnStart),
        ));
      } catch (err) {
        console.error(`[chat-agent-invoke] Failed to link orphan artifacts:`, err);
      }
    }

    // 3b. Bump thread timestamps — last_turn_completed_at drives inbox sorting
    try {
      const { threads } = await import("@thinkwork/database-pg/schema");
      await db.update(threads).set({
        updated_at: new Date(),
        last_turn_completed_at: new Date(),
        last_response_preview: displayResponse.replace(/[#*_`]/g, "").trim().slice(0, 200) || null,
      }).where(eq(threads.id, threadId));
    } catch (err) {
      console.error(`[chat-agent-invoke] Failed to update thread updated_at:`, err);
    }

    // PRD-22: Signal processing removed — agents use thread-management tools directly

    // 4. Notify subscribers via AppSync
    if (assistantMsg) {
      await notifyNewMessage({
        messageId: assistantMsg.id,
        threadId,
        tenantId,
        role: "assistant",
        content: responseText,
        senderType: "agent",
        senderId: agentId,
      });
    }

    // 4b. Notify thread update so the home screen list re-sorts
    try {
      const { notifyThreadUpdate } = await import("../graphql/notify.js");
      notifyThreadUpdate({ threadId, tenantId, status: "in_progress", title: "" }).catch(() => {});
    } catch {}

    // 4c. Send push notification to user devices
    try {
      const { sendTurnCompletedPush } = await import("../lib/push-notifications.js");
      await sendTurnCompletedPush({
        threadId,
        tenantId,
        agentId,
        title: agent.name || "Agent",
        body: responseText.replace(/[#*_`]/g, "").trim(),
      });
    } catch (err) {
      console.error("[chat-agent-invoke] Push notification failed:", err);
    }

  } catch (err) {
    console.error(`[chat-agent-invoke] Error:`, err);
    // Best-effort: mark turn as failed
    if (turnId) {
      try {
        await db
          .update(threadTurns)
          .set({
            status: "failed",
            finished_at: new Date(),
            error: err instanceof Error ? err.message : String(err),
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
        console.error(`[chat-agent-invoke] Failed to update thread_turn on error:`, turnErr);
      }
    }
    // Best-effort: insert an error message and notify
    try {
      const errMsg = await insertAssistantMessage(threadId, tenantId, agentId, `I'm sorry, something went wrong. Please try again.`);
      if (errMsg) {
        await notifyNewMessage({ messageId: errMsg.id, threadId, tenantId, role: "assistant", content: "I'm sorry, something went wrong. Please try again.", senderType: "agent", senderId: agentId });
      }
    } catch (innerErr) {
      console.error(`[chat-agent-invoke] Failed to insert error message:`, innerErr);
    }
  }
}

async function insertAssistantMessage(
  threadId: string,
  tenantId: string,
  agentId: string,
  content: string,
  toolInvocations?: Array<Record<string, unknown>>,
): Promise<{ id: string } | null> {
  try {
    // Extract GenUI data from tool invocations (typed JSON with _type field)
    // MCP tools return _type JSON directly (Places, CRM, Tasks)
    const genuiResults = (toolInvocations || [])
      .filter((inv) => inv.genui_data)
      .flatMap((inv) => Array.isArray(inv.genui_data) ? inv.genui_data : [inv.genui_data])
      .filter((item) => item && item._type);

    const [row] = await db
      .insert(messages)
      .values({
        thread_id: threadId,
        tenant_id: tenantId,
        role: "assistant",
        content,
        sender_type: "agent",
        sender_id: agentId,
        tool_results: genuiResults.length > 0 ? genuiResults : undefined,
        metadata: toolInvocations && toolInvocations.length > 0
          ? { tool_invocations: toolInvocations.map(({ genui_data, ...rest }) => rest) }
          : undefined,
      })
      .returning({ id: messages.id });

    console.log(`[chat-agent-invoke] Inserted assistant message: ${row.id}${genuiResults.length > 0 ? ` (${genuiResults.length} genui results)` : ""}`);
    return row;
  } catch (err) {
    console.error(`[chat-agent-invoke] Failed to insert assistant message:`, err);
    return null;
  }
}

async function notifyNewMessage(payload: {
  messageId: string;
  threadId: string;
  tenantId: string;
  role: string;
  content: string;
  senderType: string;
  senderId: string;
}): Promise<void> {
  if (!APPSYNC_ENDPOINT || !APPSYNC_API_KEY) {
    console.warn(`[chat-agent-invoke] AppSync not configured, skipping notification`);
    return;
  }

  const mutation = `
    mutation NotifyNewMessage(
      $messageId: ID!
      $threadId: ID!
      $tenantId: ID!
      $role: String!
      $content: String!
      $senderType: String
      $senderId: ID
    ) {
      notifyNewMessage(
        messageId: $messageId
        threadId: $threadId
        tenantId: $tenantId
        role: $role
        content: $content
        senderType: $senderType
        senderId: $senderId
      ) {
        messageId
        threadId
        tenantId
        role
        content
        senderType
        senderId
        createdAt
      }
    }
  `;

  try {
    const response = await fetch(APPSYNC_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": APPSYNC_API_KEY,
      },
      body: JSON.stringify({
        query: mutation,
        variables: payload,
      }),
    });

    const responseBody = await response.text();
    if (!response.ok) {
      console.error(`[chat-agent-invoke] AppSync notify failed: ${response.status} ${responseBody}`);
    } else {
      // Log GraphQL errors even on HTTP 200
      if (responseBody.includes('"errors"')) {
        console.error(`[chat-agent-invoke] AppSync notify GraphQL errors: ${responseBody}`);
      } else {
        console.log(`[chat-agent-invoke] AppSync notifyNewMessage sent for ${payload.messageId}`);
      }
    }
  } catch (err) {
    console.error(`[chat-agent-invoke] AppSync notify error:`, err);
  }
}

async function notifyThreadTurnUpdate(payload: {
  runId: string;
  tenantId: string;
  threadId: string;
  agentId: string;
  status: string;
  triggerName: string | null;
}): Promise<void> {
  if (!APPSYNC_ENDPOINT || !APPSYNC_API_KEY) return;

  const mutation = `
    mutation NotifyThreadTurnUpdate(
      $runId: ID!
      $tenantId: ID!
      $threadId: ID
      $agentId: ID
      $status: String!
      $triggerName: String
    ) {
      notifyThreadTurnUpdate(
        runId: $runId
        tenantId: $tenantId
        threadId: $threadId
        agentId: $agentId
        status: $status
        triggerName: $triggerName
      ) {
        runId
        tenantId
        threadId
        agentId
        status
        triggerName
        updatedAt
      }
    }
  `;

  try {
    await fetch(APPSYNC_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": APPSYNC_API_KEY,
      },
      body: JSON.stringify({ query: mutation, variables: payload }),
    });
  } catch (err) {
    console.error(`[chat-agent-invoke] notifyThreadTurnUpdate error:`, err);
  }
}

