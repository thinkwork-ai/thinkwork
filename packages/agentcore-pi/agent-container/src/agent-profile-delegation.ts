import path from "node:path";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ExtensionFactory } from "@thinkwork/pi-extensions";
import { Type } from "typebox";
import {
  BUILTIN_TOOL_NAMES,
  runAgentLoop,
  type ActivityEmitEvent,
  type AgentProfileRunRecord,
  type PiExtensionRuntimeDescriptor,
  type RunAgentLoopArgs,
  type RunAgentLoopResult,
  type ToolInvocationRecord,
} from "@thinkwork/pi-runtime-core";

import {
  AgentProfileAdapterError,
  compileAgentProfileRunRequest,
  runCompiledAgentProfile,
  type AgentLoopPolicy,
  type AgentProfileConfig,
  type AgentProfileHandoffQuestion,
  type CompiledAgentProfileRunRequest,
  type ProfileChildRunResult,
  type ProfileChildRunner,
} from "./agent-profile-adapter.js";
import { getMcpAgentToolIdentity } from "./mcp.js";
import type { McpToolRegistry } from "./mcp-registry.js";
import type { WorkspaceSkill } from "./runtime/workspace-skills.js";
import type { ResumeDelegationContext } from "./user-question-context.js";

export interface AgentProfileSlashCommand {
  profileSlug: string;
  task: string;
}

export interface ProfileDelegationToolOptions {
  profiles: AgentProfileConfig[];
  parentThreadTurnId: string;
  parentModelId: string;
  tools: AgentTool<any>[];
  extensionFactories: ExtensionFactory[];
  extensionToolNames: string[];
  profileExtensionFactoriesById?: Map<string, ExtensionFactory[]>;
  profileExtensionToolNamesById?: Map<string, string[]>;
  workspaceSkills: WorkspaceSkill[];
  mcpRegistry: McpToolRegistry;
  cwd: string;
  agentDir: string;
  threadId: string;
  gitSha: string;
  identity: unknown;
  parentHistory?: RunAgentLoopArgs["history"];
  contextPreamble?: string;
  runLoop?: typeof runAgentLoop;
  emitActivity?: (event: ActivityEmitEvent) => void;
  now?: () => Date;
  /** R21 — eval mode has no ask_user_question tool: a needs_clarification
   *  handoff converts immediately to a best-judgment re-invoke. */
  evalMode?: boolean;
  /** R20 — delegation_context carried by this turn's pending-question
   *  resume payload (parsed in user-question-context.ts). A re-escalation
   *  for the same profile+task with escalationCount >= 1 converts to a
   *  best-judgment re-invoke instead of another ask. */
  resumeDelegationContext?: ResumeDelegationContext | null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function descriptorArray(value: unknown): PiExtensionRuntimeDescriptor[] {
  return Array.isArray(value)
    ? (value.filter(
        (entry) => entry && typeof entry === "object" && !Array.isArray(entry),
      ) as PiExtensionRuntimeDescriptor[])
    : [];
}

function normalizeProfileConfig(value: unknown): AgentProfileConfig | null {
  const record = recordValue(value);
  const slug = asString(record.slug);
  const id = asString(record.id);
  const name = asString(record.name);
  const modelId = asString(record.modelId ?? record.model_id);
  if (!slug || !id || !name || !modelId) return null;

  const execution = recordValue(
    record.executionControls ?? record.execution_controls,
  );
  const mcpServers = Array.isArray(record.mcpServers) ? record.mcpServers : [];
  const toolPolicy = recordValue(record.toolPolicy ?? record.tool_policy);
  return {
    id,
    slug,
    name,
    enabled: record.enabled !== false,
    builtInKey: asString(record.builtInKey ?? record.built_in_key) || undefined,
    modelId,
    instructions: asString(record.instructions),
    routingGuidance:
      asString(record.routingGuidance ?? record.routing_guidance) || undefined,
    toolPolicy: {
      defaultTools: [],
      builtInTools: stringArray(record.builtInTools ?? toolPolicy.builtInTools),
      disabledDefaultTools: stringArray(toolPolicy.disabledDefaultTools),
      skills: stringArray(record.skillSlugs ?? toolPolicy.skills),
      mcpServers: mcpServers.map((server) => {
        const serverRecord = recordValue(server);
        return {
          serverName: asString(serverRecord.name ?? serverRecord.slug),
          toolWhitelist: stringArray(
            serverRecord.allowedTools ?? serverRecord.availableTools,
          ),
        };
      }),
    },
    piExtensions: descriptorArray(record.piExtensions ?? record.pi_extensions),
    executionControls: {
      thinking: asString(execution.thinking) || undefined,
      maxRuntimeMs: numberValue(execution.maxRuntimeMs),
      maxExecutionTimeMs: numberValue(execution.maxExecutionTimeMs),
      maxTokens: numberValue(execution.maxTokens),
      costBudgetUsd: numberValue(execution.costBudgetUsd),
      reviewGate: booleanValue(execution.reviewGate),
      maxReviewLoops: numberValue(execution.maxReviewLoops),
      loopPolicy: normalizeLoopPolicy(
        execution.loopPolicy ?? execution.loop_policy,
      ),
    },
    contextPolicy: {
      systemPromptMode: "replace",
      inheritProjectContext: false,
      inheritSkills: false,
      defaultContext: "fresh",
    },
  };
}

export function normalizeAgentProfiles(value: unknown): AgentProfileConfig[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const profile = normalizeProfileConfig(item);
    return profile ? [profile] : [];
  });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const text = asString(item);
        return text ? [text] : [];
      })
    : [];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeLoopPolicy(value: unknown): AgentLoopPolicy | undefined {
  const record = recordValue(value);
  if (record.mode !== "closed") return undefined;
  const externalReviewerPolicy = asString(
    record.externalReviewerPolicy ?? record.external_reviewer_policy,
  );
  const failBehavior = asString(record.failBehavior ?? record.fail_behavior);
  if (
    !["never", "explicit", "profile_required", "always"].includes(
      externalReviewerPolicy,
    ) ||
    !["return_blocker", "best_effort_with_warning"].includes(failBehavior)
  ) {
    return undefined;
  }
  const maxIterations = numberValue(
    record.maxIterations ?? record.max_iterations,
  );
  const maxReviewLoops = numberValue(
    record.maxReviewLoops ?? record.max_review_loops,
  );
  if (!maxIterations || !maxReviewLoops) return undefined;
  const policy = {
    mode: "closed" as const,
    enabled: booleanValue(record.enabled) ?? true,
    maxIterations,
    maxReviewLoops,
    reviewGate: booleanValue(record.reviewGate ?? record.review_gate) ?? false,
    externalReviewerPolicy: externalReviewerPolicy as
      | "never"
      | "explicit"
      | "profile_required"
      | "always",
    failBehavior: failBehavior as "return_blocker" | "best_effort_with_warning",
    ...(numberValue(record.maxRuntimeMs ?? record.max_runtime_ms) !== undefined
      ? {
          maxRuntimeMs: numberValue(
            record.maxRuntimeMs ?? record.max_runtime_ms,
          ),
        }
      : {}),
    ...(numberValue(record.maxTokens ?? record.max_tokens) !== undefined
      ? { maxTokens: numberValue(record.maxTokens ?? record.max_tokens) }
      : {}),
    ...(numberValue(record.costBudgetUsd ?? record.cost_budget_usd) !==
    undefined
      ? {
          costBudgetUsd: numberValue(
            record.costBudgetUsd ?? record.cost_budget_usd,
          ),
        }
      : {}),
  };
  return policy;
}

function numberField(
  record: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

export function parseAgentProfileSlashCommand(
  message: string,
): AgentProfileSlashCommand | null {
  const trimmed = message.trim();
  const match = trimmed.match(
    /^\/agent(?:\s+([a-z0-9][a-z0-9_-]*))?(?:\s+([\s\S]*))?$/i,
  );
  if (!match) return null;
  const profileSlug = asString(match[1]).toLowerCase();
  const task = asString(match[2]);
  if (!profileSlug || !task) {
    throw new AgentProfileAdapterError(
      "EMPTY_TASK",
      "/agent requires a profile slug and a non-empty task.",
    );
  }
  return { profileSlug, task };
}

function profileSystemPrompt(request: CompiledAgentProfileRunRequest): string {
  const policy = request.execution.loopPolicy;
  return [
    `You are the ${request.profileName} ThinkWork Agent Profile.`,
    request.routingGuidance
      ? `Routing guidance: ${request.routingGuidance}`
      : "",
    request.instructions,
    [
      "Run a closed specialist loop for only the delegated task:",
      "1. Discovery - identify the facts, files, tools, or context needed. If the request is ambiguous on a decision that changes the outcome, hand off with Verdict: needs_clarification instead of assuming; surface ALL clarification needs in that one handoff (max 4 questions) - you get one escalation per delegation.",
      "2. Planning - choose a bounded approach before using tools.",
      "3. Execution - do the delegated work with only your configured capabilities.",
      "4. Verification - act as the internal Verifier/Reviewer for this profile run. Check the work against the delegated task, evidence, constraints, and user-visible quality bar.",
      "5. Iteration - if the verifier verdict is revise or fail and budget remains, fix the gap once before handoff.",
      "6. Handoff - return concise evidence to the parent Agent.",
    ].join("\n"),
    [
      "Closed-loop policy:",
      `- Enabled: ${policy.enabled ? "yes" : "no"}`,
      `- Max iterations: ${policy.maxIterations}`,
      `- Max review loops: ${policy.maxReviewLoops}`,
      `- Review gate: ${policy.reviewGate ? "required" : "optional"}`,
      `- External reviewer policy: ${policy.externalReviewerPolicy}`,
      `- Fail behavior: ${policy.failBehavior}`,
      policy.maxRuntimeMs !== undefined
        ? `- Runtime budget: ${policy.maxRuntimeMs}ms`
        : "",
      policy.maxTokens !== undefined
        ? `- Token budget: ${policy.maxTokens}`
        : "",
      policy.costBudgetUsd !== undefined
        ? `- Cost budget: $${policy.costBudgetUsd}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    [
      "Handoff contract for the parent Agent:",
      "Verdict: pass | revise | fail | needs_clarification",
      "Summary: one concise paragraph with the outcome.",
      "Evidence: short bullet list of sources, files, tool outputs, or checks.",
      "Confidence: low | medium | high",
      "Feedback: required only for revise or fail.",
      "Questions: required only for needs_clarification - a single-line JSON array of 1-4 questions, each " +
        '{"question":"...","header":"...","options":[{"label":"...","description":"..."}],"multiSelect":false}. ' +
        'Header max 12 chars; 2-4 options per question; append " (Recommended)" to exactly one option label ' +
        "per question when you have a preferred answer. Example:",
      'Questions: [{"question":"Which environment should this target?","header":"Env","options":[{"label":"Staging (Recommended)","description":"Safe default."},{"label":"Production","description":"Live traffic."}],"multiSelect":false}]',
    ].join("\n"),
    "A verifier verdict is required for every Agent Profile run, even when no external Reviewer profile is requested. The external Reviewer profile is an additional gate, not the only verification step.",
    "The parent Agent owns the final user-facing response. Do not answer the user directly unless the delegated task explicitly asks for final-response copy.",
    "Do not reveal private reasoning or chain-of-thought. Report only phase outcomes, evidence, and concise feedback.",
    "Do not delegate to other agents. Do not request model, tool, skill, MCP, output path, timeout, or token-limit changes.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function allowedMcpTool(
  request: CompiledAgentProfileRunRequest,
  tool: AgentTool<any>,
): boolean {
  const identity = getMcpAgentToolIdentity(tool);
  if (!identity) return false;
  return request.mcpOperations.some(
    (operation) =>
      operation.serverName === identity.serverName &&
      operation.toolName === identity.toolName,
  );
}

function childToolSurface(input: {
  request: CompiledAgentProfileRunRequest;
  tools: AgentTool<any>[];
  extensionToolNames: string[];
}): {
  builtinToolNames: string[];
  tools: AgentTool<any>[];
  extensionToolNames: string[];
} {
  const allowed = new Set(input.request.tools);
  const builtinToolNames = BUILTIN_TOOL_NAMES.filter((toolName) =>
    allowed.has(toolName),
  );
  const extensionToolNames = input.extensionToolNames.filter((toolName) =>
    allowed.has(toolName),
  );
  const tools = input.tools.filter((tool) => {
    if (tool.name === AGENT_PROFILE_TOOL_NAME) return false;
    if (allowed.has(tool.name)) return true;
    return allowedMcpTool(input.request, tool);
  });
  return { builtinToolNames, tools, extensionToolNames };
}

export const AGENT_PROFILE_TOOL_NAME = "delegate_to_agent_profile";

const MEMORY_RETRIEVAL_TASK_PATTERN =
  /\b(user memory|space memory|long[- ]term memory|memory recall|recall .*memor|search .*memor|retrieve .*memor|query .*memor|memory facts?|memory verification|passphrase|launch codename)\b/i;

function isExplicitMemoryRetrievalTask(task: string): boolean {
  return MEMORY_RETRIEVAL_TASK_PATTERN.test(task);
}

function profileHasMemoryRetrievalTool(
  request: CompiledAgentProfileRunRequest,
): boolean {
  const tools = new Set(request.tools);
  return tools.has("recall") || tools.has("reflect");
}

export function createProfileChildRunner(
  options: ProfileDelegationToolOptions,
): ProfileChildRunner {
  const runLoop = options.runLoop ?? runAgentLoop;
  return {
    async runProfile(
      request: CompiledAgentProfileRunRequest,
    ): Promise<ProfileChildRunResult> {
      options.emitActivity?.({
        eventType: "agent_profile_run_started",
        message: request.profileName,
        stream: "step",
        payload: agentProfileActivityPayload(request, {
          status: "running",
          task: request.task,
        }),
      });
      const childSurface = childToolSurface({
        request,
        tools: options.tools,
        extensionToolNames: [
          ...options.extensionToolNames,
          ...(options.profileExtensionToolNamesById?.get(request.profileId) ??
            []),
        ],
      });
      const profileExtensionFactories =
        options.profileExtensionFactoriesById?.get(request.profileId) ?? [];
      try {
        const systemPrompt = [
          profileSystemPrompt(request),
          options.contextPreamble
            ? [
                "Inherited parent turn context:",
                options.contextPreamble,
                "Use the inherited file paths and tools when the delegated task depends on uploaded files.",
              ].join("\n")
            : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        const result = await runLoop(
          {
            message: request.task,
            history: options.parentHistory ?? [],
            systemPrompt,
            tools: childSurface.tools,
            extensionFactories: [
              ...options.extensionFactories,
              ...profileExtensionFactories,
            ],
            extensionToolNames: childSurface.extensionToolNames,
            builtinToolNames: childSurface.builtinToolNames,
            modelId: request.model,
            threadId: `${options.threadId}:profile:${request.profileRunId}`,
            gitSha: options.gitSha,
            identity: options.identity,
            cwd: options.cwd,
            agentDir: path.join(
              options.agentDir,
              "profiles",
              request.profileRunId,
            ),
          },
          {
            emitActivity: profileActivityEmitter(options, request),
          },
        );
        options.emitActivity?.({
          eventType: "agent_profile_run_completed",
          message: request.profileName,
          stream: "step",
          payload: agentProfileActivityPayload(request, {
            status: "completed",
            task: request.task,
          }),
        });
        return childResultFromRunLoop(result);
      } catch (error) {
        options.emitActivity?.({
          eventType: "agent_profile_run_failed",
          message: request.profileName,
          stream: "step",
          payload: agentProfileActivityPayload(request, {
            status: "failed",
            task: request.task,
            error: error instanceof Error ? error.message : String(error),
          }),
        });
        throw error;
      }
    },
  };
}

function profileActivityEmitter(
  options: ProfileDelegationToolOptions,
  request: CompiledAgentProfileRunRequest,
) {
  return (event: ActivityEmitEvent) => {
    options.emitActivity?.({
      ...event,
      message: `${request.profileName}: ${event.message}`,
      payload: agentProfileActivityPayload(request, {
        child_event_type: event.eventType,
        child_message: event.message,
        ...(event.payload ?? {}),
      }),
    });
  };
}

function agentProfileActivityPayload(
  request: CompiledAgentProfileRunRequest,
  payload: Record<string, unknown>,
) {
  return {
    profile_run_id: request.profileRunId,
    profile_id: request.profileId,
    profile_slug: request.profileSlug,
    profile_name: request.profileName,
    model: request.model,
    lane_key: request.telemetry.laneKey,
    source: request.telemetry.source,
    ...payload,
  };
}

function childResultFromRunLoop(
  result: RunAgentLoopResult,
): ProfileChildRunResult {
  const usage = recordValue(result.usage);
  return {
    content: result.content,
    status: "completed",
    usage: result.usage
      ? {
          inputTokens: numberField(
            usage,
            "input_tokens",
            "inputTokens",
            "input",
          ),
          outputTokens: numberField(
            usage,
            "output_tokens",
            "outputTokens",
            "output",
          ),
          cachedReadTokens: numberField(
            usage,
            "cached_read_tokens",
            "cachedReadTokens",
            "cacheReadInputTokens",
            "cacheRead",
          ),
          cachedWriteTokens: numberField(
            usage,
            "cached_write_tokens",
            "cachedWriteTokens",
            "cacheWriteInputTokens",
            "cacheWrite",
          ),
          totalTokens: numberField(usage, "total_tokens", "totalTokens"),
        }
      : undefined,
    toolInvocations: result.toolInvocations,
  };
}

export async function executeAgentProfileDelegation(input: {
  options: ProfileDelegationToolOptions;
  profileSlug: string;
  task: string;
  requestedOverrides?: Record<string, unknown>;
}): Promise<AgentProfileRunRecord> {
  const profile = input.options.profiles.find(
    (candidate) => candidate.slug === input.profileSlug,
  );
  if (!profile) {
    throw new Error(`Agent profile "${input.profileSlug}" is not available.`);
  }
  const request = compileAgentProfileRunRequest({
    profile,
    task: input.task,
    parentThreadTurnId: input.options.parentThreadTurnId,
    parentModelId: input.options.parentModelId,
    availableToolNames: [
      ...BUILTIN_TOOL_NAMES,
      ...input.options.tools.map((tool) => tool.name),
      ...input.options.extensionToolNames,
      ...(input.options.profileExtensionToolNamesById?.get(profile.id) ?? []),
    ],
    availableSkillNames: input.options.workspaceSkills.map(
      (skill) => skill.slug,
    ),
    mcpRegistry: input.options.mcpRegistry,
    requestedOverrides: input.requestedOverrides,
    now: input.options.now,
  });
  if (
    isExplicitMemoryRetrievalTask(input.task) &&
    !profileHasMemoryRetrievalTool(request)
  ) {
    throw new Error(
      `Agent profile "${profile.name}" cannot perform explicit user or Space memory retrieval because its tool policy does not include recall or reflect. Use the parent agent memory tools directly.`,
    );
  }
  return runCompiledAgentProfile({
    request,
    runner: createProfileChildRunner(input.options),
    now: input.options.now,
  });
}

/** An unconverted needs_clarification escalation the PARENT must handle
 *  (answer from context and re-delegate, or ask_user_question). */
export interface PendingClarificationEscalation {
  profileSlug: string;
  profileName: string;
  /** The delegated task to record as delegation context (chain paths pass
   *  the unwrapped base task; tool paths pass the tool's task argument). */
  task: string;
  questions: AgentProfileHandoffQuestion[];
  /** The escalation count the parent must pass to ask_user_question. */
  escalationCount: number;
}

export interface AgentProfileDelegationOutcome {
  /** Evidence for the FINAL run (the best-judgment re-invoke when a
   *  conversion happened). */
  evidence: AgentProfileRunRecord;
  /** Every run executed for this delegation, in order (1, or 2 after a
   *  conversion re-invoke). */
  runs: AgentProfileRunRecord[];
  /** Present only when a needs_clarification handoff was NOT converted —
   *  the chain must unwind and the parent must handle it. */
  clarification?: PendingClarificationEscalation;
  /** Why a needs_clarification handoff was converted to a best-judgment
   *  re-invoke (R20 budget / R21 eval mode). */
  clarificationConversion?: "eval_mode" | "escalation_budget";
  /** True when the re-invoke ALSO handed off needs_clarification. Documented
   *  choice: treated as a best-effort completion — the second run's evidence
   *  is returned as the final handoff (goal status clarification_requested,
   *  never failed) and no further re-invokes or asks happen. */
  clarificationBestEffort?: boolean;
}

function normalizedTaskForMatch(task: string): string {
  return task.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Same-delegation match for the R20 budget. The re-delegated task embeds
 *  the original task plus the user's answers, so equality is too strict:
 *  profile slugs must match and one normalized task must contain the other. */
function matchesResumeDelegation(input: {
  resume: ResumeDelegationContext;
  profileSlug: string;
  task: string;
}): boolean {
  if (
    input.resume.profileSlug.toLowerCase() !== input.profileSlug.toLowerCase()
  ) {
    return false;
  }
  const original = normalizedTaskForMatch(input.resume.originalTask);
  const current = normalizedTaskForMatch(input.task);
  if (!original || !current) return false;
  return (
    original === current ||
    current.includes(original) ||
    original.includes(current)
  );
}

function clarificationConversionReason(input: {
  options: ProfileDelegationToolOptions;
  profileSlug: string;
  task: string;
}): "eval_mode" | "escalation_budget" | undefined {
  if (input.options.evalMode === true) return "eval_mode";
  const resume = input.options.resumeDelegationContext;
  if (
    resume &&
    resume.escalationCount >= 1 &&
    matchesResumeDelegation({
      resume,
      profileSlug: input.profileSlug,
      task: input.task,
    })
  ) {
    return "escalation_budget";
  }
  return undefined;
}

function renderClarificationQuestionList(
  questions: readonly AgentProfileHandoffQuestion[],
): string {
  return questions
    .map((question, index) => `${index + 1}. ${question.question}`)
    .join("\n");
}

/** Best-judgment re-invoke task (mirrors the retrySpecialistTask injected-text
 *  pattern in server.ts). Used for R20 budget exhaustion and R21 eval mode. */
export function bestJudgmentClarificationTask(input: {
  baseTask: string;
  specialist: Pick<AgentProfileConfig, "name">;
  questions: readonly AgentProfileHandoffQuestion[];
}): string {
  return [
    `Original user request:\n${input.baseTask}`,
    `You handed off needs_clarification with these questions:\n${renderClarificationQuestionList(input.questions)}`,
    `User clarification is not available for this run. Your task as ${input.specialist.name}: proceed on your best judgment - choose the most reasonable interpretation for each open question (prefer any option you marked Recommended), state the assumptions you made in your handoff Summary, and complete the delegated work. Do not hand off needs_clarification again.`,
  ].join("\n\n");
}

/** Parent-facing instruction surfaced with an unconverted escalation, via the
 *  delegation tool result (tool path) or the orchestration's parent message
 *  (chain path). The delegationContext keys (profileSlug / originalTask /
 *  escalationCount) are EXACTLY what the U4 resume renderer reads back. */
export function clarificationEscalationInstruction(
  clarification: PendingClarificationEscalation,
): string {
  const delegationContext = JSON.stringify({
    profileSlug: clarification.profileSlug,
    originalTask: clarification.task,
    escalationCount: clarification.escalationCount,
  });
  return [
    `The '${clarification.profileSlug}' Agent Profile stopped with Verdict: needs_clarification and the delegation chain was terminated.`,
    `Delegated task: ${clarification.task}`,
    `Specialist questions (JSON):\n${JSON.stringify(clarification.questions)}`,
    "First, answer any of these questions you can from the conversation, workspace, or memory. If ALL are answerable, do NOT ask the user - re-delegate to the same profile now with the answers included in the task.",
    `Otherwise, call ask_user_question with the remaining questions (consolidate them with any open questions of your own; max 4 total) and pass delegationContext exactly as: ${delegationContext}. After the user answers, re-delegate to '${clarification.profileSlug}' with the answers. You get one clarification cycle for this delegation.`,
  ].join("\n");
}

const BEST_EFFORT_CLARIFICATION_NOTE =
  "The specialist asked for clarification again after a proceed-on-best-" +
  "judgment instruction; treat its handoff as best-effort output and proceed.";

/**
 * Clarification-aware delegation (plan 005 U6). Runs the profile once; on a
 * needs_clarification handoff either surfaces the escalation to the caller
 * (interactive first escalation) or converts it to ONE best-judgment
 * re-invoke (R20 re-escalation budget / R21 eval mode). Clarification cycles
 * never consume the reviewLoops budget — the conversion re-invoke happens
 * here, outside the orchestration's review-loop counter.
 */
export async function runAgentProfileDelegationWithClarification(input: {
  options: ProfileDelegationToolOptions;
  profileSlug: string;
  task: string;
  /** Task recorded in the surfaced delegation context; chain orchestration
   *  passes the unwrapped base task. Defaults to `task`. */
  delegationTaskForContext?: string;
  requestedOverrides?: Record<string, unknown>;
}): Promise<AgentProfileDelegationOutcome> {
  const first = await executeAgentProfileDelegation({
    options: input.options,
    profileSlug: input.profileSlug,
    task: input.task,
    requestedOverrides: input.requestedOverrides,
  });
  if (first.handoff?.verdict !== "needs_clarification") {
    return { evidence: first, runs: [first] };
  }
  const questions = first.handoff.questions ?? [];
  const contextTask = input.delegationTaskForContext ?? input.task;
  const conversion = clarificationConversionReason({
    options: input.options,
    profileSlug: input.profileSlug,
    task: contextTask,
  });
  if (!conversion) {
    const resume = input.options.resumeDelegationContext;
    const priorCount =
      resume &&
      matchesResumeDelegation({
        resume,
        profileSlug: input.profileSlug,
        task: contextTask,
      })
        ? resume.escalationCount
        : 0;
    return {
      evidence: first,
      runs: [first],
      clarification: {
        profileSlug: input.profileSlug,
        profileName: first.profileName,
        task: contextTask,
        questions,
        escalationCount: priorCount + 1,
      },
    };
  }

  // Converted: one best-judgment re-invoke, outside any review-loop budget.
  const second = await executeAgentProfileDelegation({
    options: input.options,
    profileSlug: input.profileSlug,
    task: bestJudgmentClarificationTask({
      baseTask: input.task,
      specialist: { name: first.profileName },
      questions,
    }),
    requestedOverrides: input.requestedOverrides,
  });
  return {
    evidence: second,
    runs: [first, second],
    clarificationConversion: conversion,
    ...(second.handoff?.verdict === "needs_clarification"
      ? { clarificationBestEffort: true }
      : {}),
  };
}

export function buildAgentProfileDelegationTool(
  options: ProfileDelegationToolOptions,
): AgentTool<any> | null {
  if (options.profiles.length === 0) return null;
  return {
    name: AGENT_PROFILE_TOOL_NAME,
    label: "Agent Profile",
    description:
      "Delegate a bounded subtask to an enabled ThinkWork Agent Profile such as Research, Coding, Analyst, or Reviewer. Use this for specialized subtasks that should run with the profile's configured model and capabilities. Do not use this for explicit user memory, Space memory, or long-term memory retrieval unless the selected profile is configured with memory tools.",
    parameters: Type.Object({
      profileSlug: Type.String({
        description: "Slug of the available Agent Profile to run.",
      }),
      task: Type.String({
        description: "Concrete task for the Agent Profile to complete.",
      }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const typed = recordValue(params);
      const profileSlug = asString(typed.profileSlug).toLowerCase();
      const task = asString(typed.task);
      const requestedOverrides = Object.fromEntries(
        Object.entries(typed).filter(
          ([key]) => key !== "profileSlug" && key !== "task",
        ),
      );
      const outcome = await runAgentProfileDelegationWithClarification({
        options,
        profileSlug,
        task,
        requestedOverrides:
          Object.keys(requestedOverrides).length > 0
            ? requestedOverrides
            : undefined,
      });
      const evidence = outcome.evidence;
      const body: Record<string, unknown> = {
        agent_profile_run: evidence,
        handoff_summary: evidence.handoffSummary,
      };
      if (outcome.clarification) {
        body.needs_clarification = {
          questions: outcome.clarification.questions,
          delegation_context: {
            profileSlug: outcome.clarification.profileSlug,
            originalTask: outcome.clarification.task,
            escalationCount: outcome.clarification.escalationCount,
          },
          instruction: clarificationEscalationInstruction(
            outcome.clarification,
          ),
        };
      }
      if (outcome.clarificationConversion) {
        body.clarification_conversion = outcome.clarificationConversion;
      }
      if (outcome.clarificationBestEffort) {
        body.clarification_note = BEST_EFFORT_CLARIFICATION_NOTE;
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(body),
          },
        ],
        details: {
          agentProfileRun: evidence,
        },
      };
    },
  };
}
