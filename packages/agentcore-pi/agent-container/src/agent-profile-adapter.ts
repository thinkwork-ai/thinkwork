import { randomUUID } from "node:crypto";

import type { ToolInvocationRecord } from "@thinkwork/pi-runtime-core";
import type { McpToolRegistry } from "./mcp-registry.js";

export type AgentProfileRunStatus =
  | "completed"
  | "failed"
  | "timed_out"
  | "interrupted"
  | "resource_limit_exceeded";

export interface AgentProfileToolPolicy {
  defaultTools?: string[];
  builtInTools?: string[];
  disabledDefaultTools?: string[];
  skills?: string[];
  mcpServers?: AgentProfileMcpGrant[];
}

export interface AgentProfileMcpGrant {
  serverName: string;
  toolWhitelist?: string[];
}

export interface AgentProfileExecutionControls {
  thinking?: string;
  timeoutMs?: number;
  maxRuntimeMs?: number;
  maxExecutionTimeMs?: number;
  maxTokens?: number;
  costBudgetUsd?: number;
  reviewGate?: boolean;
  maxReviewLoops?: number;
}

export interface AgentProfileContextPolicy {
  systemPromptMode?: "replace" | "append";
  inheritProjectContext?: boolean;
  inheritSkills?: boolean;
  defaultContext?: "fresh" | "fork" | false;
}

export interface AgentProfileConfig {
  id: string;
  slug: string;
  name: string;
  enabled?: boolean;
  builtInKey?: string;
  modelId: string;
  fallbackModelIds?: string[];
  instructions: string;
  routingGuidance?: string;
  toolPolicy?: AgentProfileToolPolicy;
  executionControls?: AgentProfileExecutionControls;
  contextPolicy?: AgentProfileContextPolicy;
}

export interface CompileAgentProfileRunRequestArgs {
  profile: AgentProfileConfig;
  task: string;
  parentThreadTurnId: string;
  parentModelId: string;
  approvedModelIds: readonly string[];
  availableToolNames: readonly string[];
  availableSkillNames: readonly string[];
  mcpRegistry: McpToolRegistry;
  requestedOverrides?: Record<string, unknown>;
  now?: () => Date;
  idFactory?: () => string;
}

export interface CompiledMcpOperationGrant {
  serverName: string;
  toolName: string;
}

export interface CompiledAgentProfileRunRequest {
  profileRunId: string;
  parentThreadTurnId: string;
  profileId: string;
  profileSlug: string;
  profileName: string;
  builtInKey?: string;
  task: string;
  model: string;
  parentModel: string;
  fallbackModels: string[];
  instructions: string;
  routingGuidance?: string;
  thinking?: string;
  tools: string[];
  skills: string[];
  mcpOperations: CompiledMcpOperationGrant[];
  context: Required<AgentProfileContextPolicy>;
  execution: {
    foreground: true;
    clarify: false;
    maxSubagentDepth: 0;
    timeoutMs?: number;
    maxRuntimeMs?: number;
    maxExecutionTimeMs?: number;
    maxTokens?: number;
    costBudgetUsd?: number;
    reviewGate?: boolean;
    maxReviewLoops?: number;
  };
  telemetry: {
    source: "pi_agent_profile";
    laneKey: string;
    createdAt: string;
  };
}

export interface ProfileChildRunUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
  totalTokens?: number;
}

export interface ProfileChildRunResult {
  content?: string | null;
  status?: AgentProfileRunStatus | string;
  usage?: ProfileChildRunUsage;
  costUsd?: number;
  toolInvocations?: ToolInvocationRecord[];
  timedOut?: boolean;
  interrupted?: boolean;
  resourceLimitExceeded?: boolean;
  error?: string;
}

export interface AgentProfileRunEvidence {
  profileRunId: string;
  profileId: string;
  profileSlug: string;
  profileName: string;
  model: string;
  status: AgentProfileRunStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  parentThreadTurnId: string;
  handoffSummary: string | null;
  toolInvocations: ToolInvocationRecord[];
  laneKey: string;
  error?: string;
}

export interface ProfileChildRunner {
  runProfile(
    request: CompiledAgentProfileRunRequest,
  ): Promise<ProfileChildRunResult>;
}

export class AgentProfileAdapterError extends Error {
  constructor(
    public readonly code:
      | "PROFILE_DISABLED"
      | "EMPTY_TASK"
      | "MODEL_NOT_APPROVED"
      | "FALLBACK_MODEL_NOT_APPROVED"
      | "TOOL_NOT_AVAILABLE"
      | "SKILL_NOT_AVAILABLE"
      | "MCP_SERVER_NOT_AVAILABLE"
      | "MCP_TOOL_NOT_AVAILABLE"
      | "PROMPT_OVERRIDE_REJECTED",
    message: string,
  ) {
    super(message);
    this.name = "AgentProfileAdapterError";
  }
}

const PROMPT_OVERRIDE_KEYS = new Set([
  "model",
  "modelId",
  "fallbackModels",
  "tools",
  "skills",
  "mcp",
  "mcpServers",
  "extensions",
  "context",
  "inheritProjectContext",
  "inheritSkills",
  "defaultContext",
  "output",
  "outputPath",
  "timeoutMs",
  "maxRuntimeMs",
  "maxExecutionTimeMs",
  "maxTokens",
  "costBudgetUsd",
]);

const SECRET_KEY_PATTERN =
  /(?:authorization|bearer|token|secret|password|api[_-]?key|access[_-]?token|refresh[_-]?token)/i;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeToolNameForRuntime(
  value: string,
  availableToolNames: readonly string[],
): string {
  if (availableToolNames.includes(value)) return value;
  const underscored = value.replace(/-/g, "_");
  return availableToolNames.includes(underscored) ? underscored : value;
}

function normalizeToolNamesForRuntime(
  values: readonly string[],
  availableToolNames: readonly string[],
): string[] {
  return unique(values).map((value) =>
    normalizeToolNameForRuntime(value, availableToolNames),
  );
}

function assertApprovedModel(
  modelId: string,
  approvedModelIds: readonly string[],
  code: "MODEL_NOT_APPROVED" | "FALLBACK_MODEL_NOT_APPROVED",
): void {
  if (!approvedModelIds.includes(modelId)) {
    throw new AgentProfileAdapterError(
      code,
      `Agent profile model "${modelId}" is not approved for this invocation.`,
    );
  }
}

function rejectPromptSuppliedOverrides(
  overrides: Record<string, unknown> | undefined,
): void {
  if (!overrides) return;
  const rejected = Object.keys(overrides).filter((key) =>
    PROMPT_OVERRIDE_KEYS.has(key),
  );
  if (rejected.length === 0) return;
  throw new AgentProfileAdapterError(
    "PROMPT_OVERRIDE_REJECTED",
    `Prompt-supplied profile overrides are not allowed: ${rejected.join(", ")}.`,
  );
}

function assertKnownValues(input: {
  values: readonly string[];
  available: readonly string[];
  code: "TOOL_NOT_AVAILABLE" | "SKILL_NOT_AVAILABLE";
  noun: string;
}): void {
  const available = new Set(input.available);
  const missing = input.values.filter((value) => !available.has(value));
  if (missing.length > 0) {
    throw new AgentProfileAdapterError(
      input.code,
      `Agent profile references unavailable ${input.noun}: ${missing.join(", ")}.`,
    );
  }
}

function compileToolAllowlist(input: {
  policy: AgentProfileToolPolicy | undefined;
  availableToolNames: readonly string[];
}): string[] {
  const defaults = normalizeToolNamesForRuntime(
    input.policy?.defaultTools ?? [],
    input.availableToolNames,
  );
  const explicit = normalizeToolNamesForRuntime(
    input.policy?.builtInTools ?? [],
    input.availableToolNames,
  );
  const disabled = new Set(
    normalizeToolNamesForRuntime(
      input.policy?.disabledDefaultTools ?? [],
      input.availableToolNames,
    ),
  );
  const tools = unique([
    ...defaults.filter((tool) => !disabled.has(tool)),
    ...explicit,
  ]);
  assertKnownValues({
    values: tools,
    available: input.availableToolNames,
    code: "TOOL_NOT_AVAILABLE",
    noun: "tools",
  });
  return tools;
}

function compileSkills(input: {
  policy: AgentProfileToolPolicy | undefined;
  availableSkillNames: readonly string[];
}): string[] {
  const skills = unique(input.policy?.skills ?? []);
  assertKnownValues({
    values: skills,
    available: input.availableSkillNames,
    code: "SKILL_NOT_AVAILABLE",
    noun: "skills",
  });
  return skills;
}

function compileMcpOperations(input: {
  grants: readonly AgentProfileMcpGrant[];
  registry: McpToolRegistry;
}): CompiledMcpOperationGrant[] {
  const operations: CompiledMcpOperationGrant[] = [];
  for (const grant of input.grants) {
    const serverName = cleanString(grant.serverName);
    if (!serverName || !input.registry.hasServer(serverName)) {
      throw new AgentProfileAdapterError(
        "MCP_SERVER_NOT_AVAILABLE",
        `Agent profile references unavailable MCP server "${serverName}".`,
      );
    }
    const toolNames = unique(
      grant.toolWhitelist && grant.toolWhitelist.length > 0
        ? grant.toolWhitelist
        : input.registry.toolsForServer(serverName),
    );
    const missing = toolNames.filter(
      (toolName) => input.registry.get(serverName, toolName) === undefined,
    );
    if (missing.length > 0) {
      throw new AgentProfileAdapterError(
        "MCP_TOOL_NOT_AVAILABLE",
        `Agent profile references unavailable MCP tools on "${serverName}": ${missing.join(", ")}.`,
      );
    }
    operations.push(
      ...toolNames.map((toolName) => ({
        serverName,
        toolName,
      })),
    );
  }
  return operations.sort((a, b) =>
    a.serverName === b.serverName
      ? a.toolName.localeCompare(b.toolName)
      : a.serverName.localeCompare(b.serverName),
  );
}

function defaultContextPolicy(
  policy: AgentProfileContextPolicy | undefined,
): Required<AgentProfileContextPolicy> {
  return {
    systemPromptMode: policy?.systemPromptMode ?? "replace",
    inheritProjectContext: policy?.inheritProjectContext ?? false,
    inheritSkills: policy?.inheritSkills ?? false,
    defaultContext: policy?.defaultContext ?? "fresh",
  };
}

export function compileAgentProfileRunRequest(
  args: CompileAgentProfileRunRequestArgs,
): CompiledAgentProfileRunRequest {
  const task = cleanString(args.task);
  if (!task) {
    throw new AgentProfileAdapterError(
      "EMPTY_TASK",
      "Agent profile delegation requires a non-empty task.",
    );
  }
  if (args.profile.enabled === false) {
    throw new AgentProfileAdapterError(
      "PROFILE_DISABLED",
      `Agent profile "${args.profile.slug}" is disabled.`,
    );
  }
  rejectPromptSuppliedOverrides(args.requestedOverrides);

  const model = cleanString(args.profile.modelId);
  assertApprovedModel(model, args.approvedModelIds, "MODEL_NOT_APPROVED");
  const fallbackModels = unique(args.profile.fallbackModelIds ?? []);
  for (const fallbackModel of fallbackModels) {
    assertApprovedModel(
      fallbackModel,
      args.approvedModelIds,
      "FALLBACK_MODEL_NOT_APPROVED",
    );
  }

  const tools = compileToolAllowlist({
    policy: args.profile.toolPolicy,
    availableToolNames: args.availableToolNames,
  });
  const skills = compileSkills({
    policy: args.profile.toolPolicy,
    availableSkillNames: args.availableSkillNames,
  });
  const mcpOperations = compileMcpOperations({
    grants: args.profile.toolPolicy?.mcpServers ?? [],
    registry: args.mcpRegistry,
  });
  const now = args.now?.() ?? new Date();
  const execution = args.profile.executionControls ?? {};

  return {
    profileRunId: args.idFactory?.() ?? randomUUID(),
    parentThreadTurnId: args.parentThreadTurnId,
    profileId: args.profile.id,
    profileSlug: args.profile.slug,
    profileName: args.profile.name,
    ...(args.profile.builtInKey ? { builtInKey: args.profile.builtInKey } : {}),
    task,
    model,
    parentModel: args.parentModelId,
    fallbackModels,
    instructions: args.profile.instructions,
    ...(args.profile.routingGuidance
      ? { routingGuidance: args.profile.routingGuidance }
      : {}),
    ...(execution.thinking ? { thinking: execution.thinking } : {}),
    tools,
    skills,
    mcpOperations,
    context: defaultContextPolicy(args.profile.contextPolicy),
    execution: {
      foreground: true,
      clarify: false,
      maxSubagentDepth: 0,
      ...(execution.timeoutMs !== undefined
        ? { timeoutMs: execution.timeoutMs }
        : {}),
      ...(execution.maxRuntimeMs !== undefined
        ? { maxRuntimeMs: execution.maxRuntimeMs }
        : {}),
      ...(execution.maxExecutionTimeMs !== undefined
        ? { maxExecutionTimeMs: execution.maxExecutionTimeMs }
        : {}),
      ...(execution.maxTokens !== undefined
        ? { maxTokens: execution.maxTokens }
        : {}),
      ...(execution.costBudgetUsd !== undefined
        ? { costBudgetUsd: execution.costBudgetUsd }
        : {}),
      ...(execution.reviewGate === true ? { reviewGate: true } : {}),
      ...(execution.maxReviewLoops !== undefined
        ? { maxReviewLoops: execution.maxReviewLoops }
        : {}),
    },
    telemetry: {
      source: "pi_agent_profile",
      laneKey: `profile:${args.profile.slug}`,
      createdAt: now.toISOString(),
    },
  };
}

export function assertProfileMcpOperationAllowed(
  request: CompiledAgentProfileRunRequest,
  serverName: string,
  toolName: string,
): void {
  const allowed = request.mcpOperations.some(
    (operation) =>
      operation.serverName === serverName && operation.toolName === toolName,
  );
  if (!allowed) {
    throw new AgentProfileAdapterError(
      "MCP_TOOL_NOT_AVAILABLE",
      `MCP operation "${serverName}/${toolName}" is not allowed for profile "${request.profileSlug}".`,
    );
  }
}

function normalizeStatus(result: ProfileChildRunResult): AgentProfileRunStatus {
  if (result.resourceLimitExceeded) return "resource_limit_exceeded";
  if (result.timedOut) return "timed_out";
  if (result.interrupted) return "interrupted";
  if (result.status === "completed") return "completed";
  if (result.status === "timed_out") return "timed_out";
  if (result.status === "interrupted") return "interrupted";
  if (result.status === "resource_limit_exceeded") {
    return "resource_limit_exceeded";
  }
  return result.error || result.status === "failed" ? "failed" : "completed";
}

function redactedString(value: string): string {
  return value.replace(BEARER_PATTERN, "Bearer [REDACTED]");
}

function redactedPreview(value: string): string {
  try {
    return JSON.stringify(redactSecrets(JSON.parse(value)));
  } catch {
    return redactedString(value);
  }
}

function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") return redactedString(value);
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactSecrets);

  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactSecrets(raw);
  }
  return out;
}

export function sanitizeProfileToolInvocations(
  invocations: readonly ToolInvocationRecord[] = [],
): ToolInvocationRecord[] {
  return invocations.map((invocation) => ({
    ...invocation,
    args: redactSecrets(invocation.args),
    result: redactSecrets(invocation.result),
    input_preview:
      typeof invocation.input_preview === "string"
        ? redactedPreview(invocation.input_preview)
        : invocation.input_preview,
    output_preview:
      typeof invocation.output_preview === "string"
        ? redactedString(invocation.output_preview)
        : invocation.output_preview,
  }));
}

export function buildAgentProfileRunEvidence(input: {
  request: CompiledAgentProfileRunRequest;
  result: ProfileChildRunResult;
  startedAt: Date;
  finishedAt: Date;
}): AgentProfileRunEvidence {
  const usage = input.result.usage ?? {};
  return {
    profileRunId: input.request.profileRunId,
    profileId: input.request.profileId,
    profileSlug: input.request.profileSlug,
    profileName: input.request.profileName,
    model: input.request.model,
    status: normalizeStatus(input.result),
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    durationMs: Math.max(
      0,
      input.finishedAt.getTime() - input.startedAt.getTime(),
    ),
    ...(usage.inputTokens !== undefined
      ? { inputTokens: usage.inputTokens }
      : {}),
    ...(usage.outputTokens !== undefined
      ? { outputTokens: usage.outputTokens }
      : {}),
    ...(usage.cachedReadTokens !== undefined
      ? { cachedReadTokens: usage.cachedReadTokens }
      : {}),
    ...(usage.cachedWriteTokens !== undefined
      ? { cachedWriteTokens: usage.cachedWriteTokens }
      : {}),
    ...(usage.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
    ...(input.result.costUsd !== undefined ? { costUsd: input.result.costUsd } : {}),
    parentThreadTurnId: input.request.parentThreadTurnId,
    handoffSummary: input.result.content ?? null,
    toolInvocations: sanitizeProfileToolInvocations(
      input.result.toolInvocations,
    ),
    laneKey: input.request.telemetry.laneKey,
    ...(input.result.error ? { error: input.result.error } : {}),
  };
}

export async function runCompiledAgentProfile(input: {
  request: CompiledAgentProfileRunRequest;
  runner: ProfileChildRunner;
  now?: () => Date;
}): Promise<AgentProfileRunEvidence> {
  const startedAt = input.now?.() ?? new Date();
  const result = await input.runner.runProfile(input.request);
  const finishedAt = input.now?.() ?? new Date();
  return buildAgentProfileRunEvidence({
    request: input.request,
    result,
    startedAt,
    finishedAt,
  });
}
