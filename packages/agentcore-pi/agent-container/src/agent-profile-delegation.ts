import path from "node:path";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ExtensionFactory } from "@thinkwork/pi-extensions";
import { Type } from "typebox";
import {
  BUILTIN_TOOL_NAMES,
  runAgentLoop,
  type ActivityEmitEvent,
  type AgentProfileRunRecord,
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
  type CompiledAgentProfileRunRequest,
  type ProfileChildRunResult,
  type ProfileChildRunner,
} from "./agent-profile-adapter.js";
import { getMcpAgentToolIdentity } from "./mcp.js";
import type { McpToolRegistry } from "./mcp-registry.js";
import type { WorkspaceSkill } from "./runtime/workspace-skills.js";

export interface AgentProfileSlashCommand {
  profileSlug: string;
  task: string;
}

export interface ProfileDelegationToolOptions {
  profiles: AgentProfileConfig[];
  parentThreadTurnId: string;
  parentModelId: string;
  approvedModelIds: string[];
  tools: AgentTool<any>[];
  extensionFactories: ExtensionFactory[];
  extensionToolNames: string[];
  workspaceSkills: WorkspaceSkill[];
  mcpRegistry: McpToolRegistry;
  cwd: string;
  agentDir: string;
  threadId: string;
  gitSha: string;
  identity: unknown;
  parentHistory?: RunAgentLoopArgs["history"];
  runLoop?: typeof runAgentLoop;
  emitActivity?: (event: ActivityEmitEvent) => void;
  now?: () => Date;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
      "1. Discovery - identify the facts, files, tools, or context needed.",
      "2. Planning - choose a bounded approach before using tools.",
      "3. Execution - do the delegated work with only your configured capabilities.",
      "4. Self-review - check the work against the delegated task and cited evidence.",
      "5. Iteration - if weak and budget remains, fix the gap once before handoff.",
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
      "Verdict: pass | revise | fail",
      "Summary: one concise paragraph with the outcome.",
      "Evidence: short bullet list of sources, files, tool outputs, or checks.",
      "Confidence: low | medium | high",
      "Feedback: required only for revise or fail.",
    ].join("\n"),
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
        extensionToolNames: options.extensionToolNames,
      });
      try {
        const result = await runLoop(
          {
            message: request.task,
            history: options.parentHistory ?? [],
            systemPrompt: profileSystemPrompt(request),
            tools: childSurface.tools,
            extensionFactories: options.extensionFactories,
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
    approvedModelIds: input.options.approvedModelIds,
    availableToolNames: [
      ...BUILTIN_TOOL_NAMES,
      ...input.options.tools.map((tool) => tool.name),
      ...input.options.extensionToolNames,
    ],
    availableSkillNames: input.options.workspaceSkills.map(
      (skill) => skill.slug,
    ),
    mcpRegistry: input.options.mcpRegistry,
    requestedOverrides: input.requestedOverrides,
    now: input.options.now,
  });
  return runCompiledAgentProfile({
    request,
    runner: createProfileChildRunner(input.options),
    now: input.options.now,
  });
}

export function buildAgentProfileDelegationTool(
  options: ProfileDelegationToolOptions,
): AgentTool<any> | null {
  if (options.profiles.length === 0) return null;
  return {
    name: AGENT_PROFILE_TOOL_NAME,
    label: "Agent Profile",
    description:
      "Delegate a bounded subtask to an enabled ThinkWork Agent Profile such as Research, Coding, Analyst, or Reviewer. Use this for specialized subtasks that should run with the profile's configured model and capabilities.",
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
      const evidence = await executeAgentProfileDelegation({
        options,
        profileSlug,
        task,
        requestedOverrides:
          Object.keys(requestedOverrides).length > 0
            ? requestedOverrides
            : undefined,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              agent_profile_run: evidence,
              handoff_summary: evidence.handoffSummary,
            }),
          },
        ],
        details: {
          agentProfileRun: evidence,
        },
      };
    },
  };
}
