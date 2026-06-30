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

export interface AgentLoopPolicy {
  mode: "closed";
  enabled: boolean;
  maxIterations: number;
  maxReviewLoops: number;
  reviewGate: boolean;
  externalReviewerPolicy: "never" | "explicit" | "profile_required" | "always";
  failBehavior: "return_blocker" | "best_effort_with_warning";
  maxRuntimeMs?: number;
  maxTokens?: number;
  costBudgetUsd?: number;
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
  loopPolicy?: AgentLoopPolicy;
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
  piExtensions?: unknown[];
  executionControls?: AgentProfileExecutionControls;
  contextPolicy?: AgentProfileContextPolicy;
}

export interface CompileAgentProfileRunRequestArgs {
  profile: AgentProfileConfig;
  task: string;
  parentThreadTurnId: string;
  parentModelId: string;
  availableToolNames: readonly string[];
  availableSkillNames: readonly string[];
  mcpRegistry: McpToolRegistry;
  dynamicExtensionToolNames?: readonly string[];
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
    loopPolicy: AgentLoopPolicy;
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
  handoff?: AgentProfileHandoffEvidence;
  toolInvocations?: ToolInvocationRecord[];
  timedOut?: boolean;
  interrupted?: boolean;
  resourceLimitExceeded?: boolean;
  error?: string;
}

export type AgentProfileLoopPhase =
  | "discovery"
  | "planning"
  | "execution"
  | "verification"
  | "self_review"
  | "iteration"
  | "handoff";

export type AgentProfileLoopPhaseStatus =
  | "completed"
  | "revision_requested"
  | "clarification_requested"
  | "failed"
  | "skipped";

/** Mirrors the ask_user_question tool's option contract (plan 2026-06-09-005 U6). */
export interface AgentProfileHandoffQuestionOption {
  label: string;
  description?: string;
}

/** Mirrors the ask_user_question tool's question contract (plan 2026-06-09-005 U6). */
export interface AgentProfileHandoffQuestion {
  question: string;
  header?: string;
  options?: AgentProfileHandoffQuestionOption[];
  multiSelect?: boolean;
}

export interface AgentProfileHandoffEvidence {
  verdict: AgentProfileLoopCompletionVerdict;
  summary: string;
  confidence?: "low" | "medium" | "high";
  evidence?: string[];
  feedback?: string;
  /** Present only with verdict needs_clarification (max 4 questions). */
  questions?: AgentProfileHandoffQuestion[];
}

export interface AgentProfileLoopPhaseEvidence {
  phase: AgentProfileLoopPhase;
  status: AgentProfileLoopPhaseStatus;
  summary?: string;
  feedback?: string;
}

export interface AgentProfileLoopEvidence {
  source: "thinkwork_agent_profile_loop";
  loopId: string;
  profileRunId: string;
  owner: {
    type: "profile";
    profileId: string;
    profileSlug: string;
    profileName: string;
  };
  policy: AgentLoopPolicy;
  phases: AgentProfileLoopPhaseEvidence[];
  goalState: AgentProfileLoopGoalState;
  handoff?: AgentProfileHandoffEvidence;
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
  handoff?: AgentProfileHandoffEvidence;
  loopEvidence: AgentProfileLoopEvidence;
  toolInvocations: ToolInvocationRecord[];
  laneKey: string;
  error?: string;
}

export type AgentProfileLoopGoalStatus =
  | "active"
  | "passed"
  | "revision_requested"
  | "clarification_requested"
  | "failed"
  | "budget_limited";

export type AgentProfileLoopCompletionVerdict =
  | "pass"
  | "revise"
  | "fail"
  | "needs_clarification";

export interface AgentProfileLoopGoalUsage {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface AgentProfileLoopGoalState {
  source: "thinkwork_agent_profile_loop";
  goalId: string;
  profileRunId: string;
  parentThreadTurnId: string;
  objective: string;
  owner: {
    type: "profile";
    profileId: string;
    profileSlug: string;
    profileName: string;
  };
  status: AgentProfileLoopGoalStatus;
  policy: AgentLoopPolicy;
  budget: {
    maxIterations: number;
    maxReviewLoops: number;
    maxRuntimeMs?: number;
    maxTokens?: number;
    costBudgetUsd?: number;
  };
  usage: AgentProfileLoopGoalUsage;
  usageByModel: Record<string, AgentProfileLoopGoalUsage>;
  completion?: {
    verdict: AgentProfileLoopCompletionVerdict;
    feedback?: string;
    checkedAt: string;
  };
  continuation: {
    mode: "thinkwork_managed";
    hiddenContinuationAllowed: false;
  };
  startedAt: string;
  updatedAt: string;
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
const OPTIONAL_EPHEMERAL_TOOL_NAMES = new Set(["file_read"]);
const WORKSPACE_SKILL_TOOL_NAME = "workspace_skill";

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
  optionalUnavailable?: ReadonlySet<string>;
  code: "TOOL_NOT_AVAILABLE" | "SKILL_NOT_AVAILABLE";
  noun: string;
}): void {
  const available = new Set(input.available);
  const missing = input.values.filter(
    (value) => !available.has(value) && !input.optionalUnavailable?.has(value),
  );
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
    optionalUnavailable: OPTIONAL_EPHEMERAL_TOOL_NAMES,
    code: "TOOL_NOT_AVAILABLE",
    noun: "tools",
  });
  const available = new Set(input.availableToolNames);
  return tools.filter(
    (tool) => available.has(tool) || !OPTIONAL_EPHEMERAL_TOOL_NAMES.has(tool),
  );
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

function defaultLoopPolicyFromExecution(
  execution: AgentProfileExecutionControls,
): AgentLoopPolicy {
  return {
    mode: "closed",
    enabled: true,
    maxIterations: 1,
    maxReviewLoops: execution.maxReviewLoops ?? 1,
    reviewGate: execution.reviewGate ?? true,
    externalReviewerPolicy: "explicit",
    failBehavior: "return_blocker",
    ...(execution.maxRuntimeMs !== undefined
      ? { maxRuntimeMs: execution.maxRuntimeMs }
      : {}),
    ...(execution.maxTokens !== undefined
      ? { maxTokens: execution.maxTokens }
      : {}),
    ...(execution.costBudgetUsd !== undefined
      ? { costBudgetUsd: execution.costBudgetUsd }
      : {}),
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
  const fallbackModels = unique(args.profile.fallbackModelIds ?? []);

  const skills = compileSkills({
    policy: args.profile.toolPolicy,
    availableSkillNames: args.availableSkillNames,
  });
  const tools = unique([
    ...compileToolAllowlist({
      policy: args.profile.toolPolicy,
      availableToolNames: args.availableToolNames,
    }),
    ...(args.dynamicExtensionToolNames ?? []),
  ]);
  if (
    skills.length > 0 &&
    !tools.includes(WORKSPACE_SKILL_TOOL_NAME) &&
    args.availableToolNames.includes(WORKSPACE_SKILL_TOOL_NAME)
  ) {
    tools.push(WORKSPACE_SKILL_TOOL_NAME);
  }
  if (
    skills.length > 0 &&
    !args.availableToolNames.includes(WORKSPACE_SKILL_TOOL_NAME)
  ) {
    throw new AgentProfileAdapterError(
      "TOOL_NOT_AVAILABLE",
      `Agent profile references skills but ${WORKSPACE_SKILL_TOOL_NAME} is unavailable.`,
    );
  }
  const mcpOperations = compileMcpOperations({
    grants: args.profile.toolPolicy?.mcpServers ?? [],
    registry: args.mcpRegistry,
  });
  const now = args.now?.() ?? new Date();
  const execution = args.profile.executionControls ?? {};
  const loopPolicy =
    execution.loopPolicy ?? defaultLoopPolicyFromExecution(execution);

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
      loopPolicy,
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

function trimmedText(value: unknown, maxLength = 4_000): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function normalizedVerdict(
  value: unknown,
): AgentProfileLoopCompletionVerdict | undefined {
  const text = trimmedText(value, 32)?.toLowerCase();
  if (text === "pass" || text === "revise" || text === "fail") return text;
  if (text && text.replace(/[\s-]+/g, "_") === "needs_clarification") {
    return "needs_clarification";
  }
  return undefined;
}

function normalizedConfidence(
  value: unknown,
): AgentProfileHandoffEvidence["confidence"] | undefined {
  const text = trimmedText(value, 32)?.toLowerCase();
  if (text === "low" || text === "medium" || text === "high") return text;
  return undefined;
}

function evidenceItems(value: unknown): string[] | undefined {
  const items = Array.isArray(value)
    ? value.flatMap((item) => {
        const text = trimmedText(item, 600);
        return text ? [text] : [];
      })
    : (trimmedText(value, 2_000)
        ?.split(/\n|;|\s+\|\s+/)
        .map((item) => item.trim())
        .filter(Boolean) ?? []);
  return items.length > 0 ? items.slice(0, 8) : undefined;
}

function labeledContentField(
  content: string,
  label: string,
): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(
    new RegExp(`^\\s*${escaped}\\s*:\\s*(.+)$`, "im"),
  );
  return trimmedText(match?.[1], 2_000);
}

function handoffQuestionOption(
  value: unknown,
): AgentProfileHandoffQuestionOption | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const label = trimmedText(record.label, 200);
  if (!label) return undefined;
  const description = trimmedText(record.description, 600);
  return { label, ...(description ? { description } : {}) };
}

function handoffQuestion(
  value: unknown,
): AgentProfileHandoffQuestion | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const question = trimmedText(record.question, 600);
  if (!question) return undefined;
  const header = trimmedText(record.header, 40);
  const options = Array.isArray(record.options)
    ? record.options
        .flatMap((option) => {
          const parsed = handoffQuestionOption(option);
          return parsed ? [parsed] : [];
        })
        .slice(0, 4)
    : [];
  return {
    question,
    ...(header ? { header } : {}),
    ...(options.length > 0 ? { options } : {}),
    ...(record.multiSelect === true ? { multiSelect: true } : {}),
  };
}

/** Parse a needs_clarification questions payload (same shape as the
 *  ask_user_question tool contract). Tolerant of partial records; caps at
 *  4 questions (R18). */
function handoffQuestions(
  value: unknown,
): AgentProfileHandoffQuestion[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const questions = value
    .flatMap((item) => {
      const parsed = handoffQuestion(item);
      return parsed ? [parsed] : [];
    })
    .slice(0, 4);
  return questions.length > 0 ? questions : undefined;
}

/** Extract the balanced JSON array that starts at `startIndex` (must point
 *  at a `[`), string-aware so brackets inside quoted text don't unbalance. */
function balancedJsonArraySlice(
  text: string,
  startIndex: number,
): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIndex; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(startIndex, i + 1);
    }
  }
  return undefined;
}

/** Parse the labeled-text `Questions:` block. The dictated contract is a
 *  single-line JSON array after `Questions:`; the parser additionally
 *  tolerates the array spanning lines. */
function questionsFromContent(
  content: string,
): AgentProfileHandoffQuestion[] | undefined {
  const labelMatch = /^\s*Questions\s*:\s*/im.exec(content);
  if (!labelMatch) return undefined;
  const afterLabel = labelMatch.index + labelMatch[0].length;
  const arrayStart = content.indexOf("[", afterLabel);
  if (arrayStart === -1) return undefined;
  // Only whitespace may sit between the label and the array.
  if (content.slice(afterLabel, arrayStart).trim() !== "") return undefined;
  const slice = balancedJsonArraySlice(content, arrayStart);
  if (!slice) return undefined;
  try {
    return handoffQuestions(JSON.parse(slice));
  } catch {
    return undefined;
  }
}

const DEFAULT_CLARIFICATION_SUMMARY =
  "Specialist requested clarification before proceeding.";

function handoffFromRecord(
  value: unknown,
): AgentProfileHandoffEvidence | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const verdict = normalizedVerdict(record.verdict);
  if (!verdict) return undefined;
  const questions =
    verdict === "needs_clarification"
      ? handoffQuestions(record.questions)
      : undefined;
  const summary =
    trimmedText(record.summary) ??
    (verdict === "needs_clarification" && questions
      ? DEFAULT_CLARIFICATION_SUMMARY
      : undefined);
  if (!summary) return undefined;
  return {
    verdict,
    summary,
    ...(normalizedConfidence(record.confidence)
      ? { confidence: normalizedConfidence(record.confidence) }
      : {}),
    ...(evidenceItems(record.evidence)
      ? { evidence: evidenceItems(record.evidence) }
      : {}),
    ...(trimmedText(record.feedback)
      ? { feedback: trimmedText(record.feedback) }
      : {}),
    ...(questions ? { questions } : {}),
  };
}

function handoffFromContent(
  content: string | null | undefined,
): AgentProfileHandoffEvidence | undefined {
  const text = trimmedText(content);
  if (!text) return undefined;
  const verdict = normalizedVerdict(labeledContentField(text, "Verdict"));
  if (!verdict) return undefined;
  const questions =
    verdict === "needs_clarification" ? questionsFromContent(text) : undefined;
  const summary =
    labeledContentField(text, "Summary") ??
    labeledContentField(text, "Handoff") ??
    (verdict === "needs_clarification" && questions
      ? DEFAULT_CLARIFICATION_SUMMARY
      : undefined);
  if (!summary) return undefined;
  return {
    verdict,
    summary,
    ...(normalizedConfidence(labeledContentField(text, "Confidence"))
      ? {
          confidence: normalizedConfidence(
            labeledContentField(text, "Confidence"),
          ),
        }
      : {}),
    ...(evidenceItems(labeledContentField(text, "Evidence"))
      ? { evidence: evidenceItems(labeledContentField(text, "Evidence")) }
      : {}),
    ...(trimmedText(labeledContentField(text, "Feedback"))
      ? { feedback: trimmedText(labeledContentField(text, "Feedback")) }
      : {}),
    ...(questions ? { questions } : {}),
  };
}

function profileHandoffEvidence(
  result: ProfileChildRunResult,
): AgentProfileHandoffEvidence | undefined {
  return (
    handoffFromRecord(result.handoff) ?? handoffFromContent(result.content)
  );
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
  const handoff = profileHandoffEvidence(input.result);
  const evidence: Omit<AgentProfileRunEvidence, "loopEvidence"> = {
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
    ...(usage.totalTokens !== undefined
      ? { totalTokens: usage.totalTokens }
      : {}),
    ...(input.result.costUsd !== undefined
      ? { costUsd: input.result.costUsd }
      : {}),
    parentThreadTurnId: input.request.parentThreadTurnId,
    handoffSummary: input.result.content ?? null,
    toolInvocations: sanitizeProfileToolInvocations(
      input.result.toolInvocations,
    ),
    laneKey: input.request.telemetry.laneKey,
    ...(input.result.error ? { error: input.result.error } : {}),
  };
  const loopEvidence = buildAgentProfileLoopEvidence({
    request: input.request,
    evidence,
    handoff,
    checkedAt: input.finishedAt,
  });
  return {
    ...evidence,
    ...(handoff ? { handoff } : {}),
    loopEvidence,
  };
}

function zeroGoalUsage(): AgentProfileLoopGoalUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  };
}

function usageFromEvidence(
  evidence:
    | Pick<
        AgentProfileRunEvidence,
        | "inputTokens"
        | "outputTokens"
        | "cachedReadTokens"
        | "cachedWriteTokens"
        | "totalTokens"
        | "costUsd"
      >
    | undefined,
): AgentProfileLoopGoalUsage {
  if (!evidence) return zeroGoalUsage();
  return {
    inputTokens: evidence.inputTokens ?? 0,
    outputTokens: evidence.outputTokens ?? 0,
    cachedReadTokens: evidence.cachedReadTokens ?? 0,
    cachedWriteTokens: evidence.cachedWriteTokens ?? 0,
    totalTokens: evidence.totalTokens ?? 0,
    costUsd: evidence.costUsd ?? 0,
  };
}

function loopGoalStatus(input: {
  evidence?: Pick<AgentProfileRunEvidence, "status">;
  verdict?: AgentProfileLoopCompletionVerdict;
}): AgentProfileLoopGoalStatus {
  if (!input.evidence) return "active";
  if (
    input.evidence.status === "timed_out" ||
    input.evidence.status === "resource_limit_exceeded"
  ) {
    return "budget_limited";
  }
  if (input.evidence.status !== "completed") return "failed";
  if (input.verdict === "revise") return "revision_requested";
  // needs_clarification is an escalation, NOT a failure — the parent
  // either re-delegates with answers or asks the user (plan 005 U6).
  if (input.verdict === "needs_clarification") return "clarification_requested";
  if (input.verdict === "fail") return "failed";
  return "passed";
}

export function buildAgentProfileLoopGoalState(input: {
  request: CompiledAgentProfileRunRequest;
  evidence?: Pick<
    AgentProfileRunEvidence,
    | "startedAt"
    | "finishedAt"
    | "model"
    | "status"
    | "inputTokens"
    | "outputTokens"
    | "cachedReadTokens"
    | "cachedWriteTokens"
    | "totalTokens"
    | "costUsd"
  >;
  completion?: {
    verdict: AgentProfileLoopCompletionVerdict;
    feedback?: string;
    checkedAt?: Date;
  };
  now?: () => Date;
}): AgentProfileLoopGoalState {
  const policy = input.request.execution.loopPolicy;
  const usage = usageFromEvidence(input.evidence);
  const startedAt =
    input.evidence?.startedAt ?? input.request.telemetry.createdAt;
  const updatedAt =
    input.evidence?.finishedAt ?? (input.now?.() ?? new Date()).toISOString();
  const status = loopGoalStatus({
    evidence: input.evidence,
    verdict: input.completion?.verdict,
  });

  return {
    source: "thinkwork_agent_profile_loop",
    goalId: `profile-loop:${input.request.profileRunId}`,
    profileRunId: input.request.profileRunId,
    parentThreadTurnId: input.request.parentThreadTurnId,
    objective: input.request.task,
    owner: {
      type: "profile",
      profileId: input.request.profileId,
      profileSlug: input.request.profileSlug,
      profileName: input.request.profileName,
    },
    status,
    policy,
    budget: {
      maxIterations: policy.maxIterations,
      maxReviewLoops: policy.maxReviewLoops,
      ...(policy.maxRuntimeMs !== undefined
        ? { maxRuntimeMs: policy.maxRuntimeMs }
        : {}),
      ...(policy.maxTokens !== undefined
        ? { maxTokens: policy.maxTokens }
        : {}),
      ...(policy.costBudgetUsd !== undefined
        ? { costBudgetUsd: policy.costBudgetUsd }
        : {}),
    },
    usage,
    usageByModel: input.evidence ? { [input.evidence.model]: usage } : {},
    ...(input.completion
      ? {
          completion: {
            verdict: input.completion.verdict,
            ...(input.completion.feedback
              ? { feedback: input.completion.feedback }
              : {}),
            checkedAt: (
              input.completion.checkedAt ??
              input.now?.() ??
              new Date()
            ).toISOString(),
          },
        }
      : {}),
    continuation: {
      mode: "thinkwork_managed",
      hiddenContinuationAllowed: false,
    },
    startedAt,
    updatedAt,
  };
}

function phaseStatusForHandoff(
  handoff: AgentProfileHandoffEvidence | undefined,
): AgentProfileLoopPhaseStatus {
  if (!handoff) return "completed";
  if (handoff.verdict === "revise") return "revision_requested";
  if (handoff.verdict === "needs_clarification") {
    return "clarification_requested";
  }
  if (handoff.verdict === "fail") return "failed";
  return "completed";
}

function buildAgentProfileLoopEvidence(input: {
  request: CompiledAgentProfileRunRequest;
  evidence: Omit<AgentProfileRunEvidence, "loopEvidence">;
  handoff?: AgentProfileHandoffEvidence;
  checkedAt: Date;
}): AgentProfileLoopEvidence {
  const goalState = buildAgentProfileLoopGoalState({
    request: input.request,
    evidence: input.evidence,
    ...(input.handoff
      ? {
          completion: {
            verdict: input.handoff.verdict,
            ...(input.handoff.feedback
              ? { feedback: input.handoff.feedback }
              : {}),
            checkedAt: input.checkedAt,
          },
        }
      : {}),
  });
  const selfReviewStatus = phaseStatusForHandoff(input.handoff);

  return {
    source: "thinkwork_agent_profile_loop",
    loopId: goalState.goalId,
    profileRunId: input.request.profileRunId,
    owner: goalState.owner,
    policy: goalState.policy,
    phases: [
      {
        phase: "discovery",
        status: "completed",
        summary: "Gathered the task inputs and available context.",
      },
      {
        phase: "planning",
        status: "completed",
        summary: "Selected a bounded execution path for the delegated task.",
      },
      {
        phase: "execution",
        status: input.evidence.status === "completed" ? "completed" : "failed",
        summary: "Produced delegated work within the profile capability set.",
      },
      {
        phase: "verification",
        status: selfReviewStatus,
        ...(input.handoff?.feedback
          ? { feedback: input.handoff.feedback }
          : {}),
        summary: input.handoff
          ? `Self-review verdict: ${input.handoff.verdict}.`
          : "Self-review completed without structured handoff metadata.",
      },
      {
        phase: "iteration",
        status:
          input.handoff?.verdict === "revise"
            ? "revision_requested"
            : "skipped",
        ...(input.handoff?.feedback
          ? { feedback: input.handoff.feedback }
          : {}),
        summary:
          input.handoff?.verdict === "revise"
            ? "Revision is required before the parent Agent should finalize."
            : "No additional profile iteration was requested.",
      },
      {
        phase: "handoff",
        status: input.handoff?.verdict === "fail" ? "failed" : "completed",
        summary:
          input.handoff?.summary ??
          input.evidence.handoffSummary ??
          "Returned profile output to the parent Agent.",
      },
    ],
    goalState,
    ...(input.handoff ? { handoff: input.handoff } : {}),
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
