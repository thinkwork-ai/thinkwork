import type {
  AgentLoopDraft,
  AgentLoopEvidencePolicy,
  AgentLoopGoalSpec,
  AgentLoopJudgeSpec,
  AgentLoopPolicy,
  AgentLoopSpaceOption,
  AgentLoopTriggerFamily,
  AgentLoopTriggerSpec,
  AgentLoopVersionSummary,
  AgentLoopWorkerOption,
  AgentLoopWorkerSpec,
  SaveAgentLoopPayload,
} from "./agent-loop-types";

export function titleize(value: string | null | undefined): string {
  if (!value) return "-";
  return value
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function jsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return jsonRecord(parsed);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function numberValue(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : "";
}

export function boolValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function formatDateTime(value: unknown): string {
  if (!value) return "-";
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

export function formatDuration(start?: string | null, end?: string | null) {
  if (!start || !end) return "-";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (Number.isNaN(ms) || ms < 0) return "-";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
}

export function formatCost(cents?: number | null): string {
  if (typeof cents !== "number") return "-";
  return `$${(cents / 100).toFixed(2)}`;
}

export function criteriaFromText(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter(Boolean);
}

export function criteriaToText(value: unknown): string {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string").join("\n")
    : "";
}

export function defaultAgentLoopDraft(
  workerOptions: AgentLoopWorkerOption[],
  spaceOptions: AgentLoopSpaceOption[] = [],
  defaultSpaceId?: string | null,
): AgentLoopDraft {
  const worker =
    workerOptions.find((candidate) => candidate.type === "agent") ??
    workerOptions[0];
  return {
    creationMode: "builder",
    name: "",
    description: "",
    lifecycleStatus: "active",
    enabled: true,
    triggerFamily: "manual",
    scheduleType: "rate",
    scheduleExpression: "rate(7 days)",
    timezone: "UTC",
    spaceId: selectDefaultSpaceId(spaceOptions, defaultSpaceId),
    objective: "",
    completionCriteriaText: "The agent produced a concise status summary.",
    workerId: worker?.id ?? "",
    judgeMode: "self_check",
    judgeCriteriaText:
      "The answer addresses the objective.\nEvidence or uncertainty is visible.\nA follow-up action is clear when needed.",
    maxIterations: "1",
    maxRuntimeMinutes: "30",
    maxTokens: "100000",
    costBudgetUsd: "",
    retryBackoffMinutes: "5",
    failBehavior: "return_blocker",
    escalateOnFailure: false,
    redactionState: "summary_only",
    retainRawEvidence: false,
    retentionDays: "30",
    suitabilityGoalStable: false,
    suitabilityEvidenceAvailable: false,
    suitabilityBudgeted: false,
  };
}

export function draftFromVersion(
  loop: {
    name: string;
    description?: string | null;
    lifecycleStatus: string;
    enabled: boolean;
    spaceId?: string | null;
    currentVersion?: AgentLoopVersionSummary | null;
  },
  workerOptions: AgentLoopWorkerOption[],
  spaceOptions: AgentLoopSpaceOption[] = [],
  defaultSpaceId?: string | null,
): AgentLoopDraft {
  const fallback = defaultAgentLoopDraft(
    workerOptions,
    spaceOptions,
    defaultSpaceId,
  );
  const version = loop.currentVersion;
  const trigger = jsonRecord(version?.triggerSpec);
  const triggerConfig = jsonRecord(trigger.config);
  const goal = jsonRecord(version?.goalSpec);
  const worker = jsonRecord(version?.workerSpec);
  const judge = jsonRecord(version?.judgeSpec);
  const policy = jsonRecord(version?.loopPolicy);
  const evidence = jsonRecord(version?.evidencePolicy);

  return {
    ...fallback,
    creationMode: "advanced",
    name: loop.name,
    description: loop.description ?? "",
    lifecycleStatus: normalizeLifecycle(loop.lifecycleStatus),
    enabled: loop.enabled,
    triggerFamily: normalizeTriggerFamily(trigger.family),
    scheduleType: stringValue(
      triggerConfig.scheduleType,
      fallback.scheduleType,
    ),
    scheduleExpression: stringValue(
      triggerConfig.scheduleExpression,
      fallback.scheduleExpression,
    ),
    timezone: stringValue(triggerConfig.timezone, fallback.timezone),
    spaceId: loop.spaceId ?? fallback.spaceId,
    objective: stringValue(goal.objective),
    completionCriteriaText: criteriaToText(goal.completionCriteria),
    workerId: stringValue(worker.id, fallback.workerId),
    judgeMode:
      judge.mode === "human_approval" ? "human_approval" : "self_check",
    judgeCriteriaText: criteriaToText(judge.criteria),
    maxIterations: numberValue(policy.maxIterations) || fallback.maxIterations,
    maxRuntimeMinutes:
      minutesString(policy.maxRuntimeMs) || fallback.maxRuntimeMinutes,
    maxTokens: numberValue(policy.maxTokens) || fallback.maxTokens,
    costBudgetUsd: numberValue(policy.costBudgetUsd),
    retryBackoffMinutes:
      minutesString(policy.retryBackoffMs) || fallback.retryBackoffMinutes,
    failBehavior:
      policy.failBehavior === "best_effort_with_warning" ||
      policy.failBehavior === "escalate"
        ? policy.failBehavior
        : "return_blocker",
    escalateOnFailure: boolValue(policy.escalateOnFailure),
    redactionState: normalizeRedaction(evidence.redactionState),
    retainRawEvidence: boolValue(evidence.retainRawEvidence),
    retentionDays:
      numberValue(evidence.retentionDays) || fallback.retentionDays,
    suitabilityGoalStable: boolValue(
      jsonRecord(version?.sourceMetadata).suitabilityGoalStable,
    ),
    suitabilityEvidenceAvailable: boolValue(
      jsonRecord(version?.sourceMetadata).suitabilityEvidenceAvailable,
    ),
    suitabilityBudgeted: boolValue(
      jsonRecord(version?.sourceMetadata).suitabilityBudgeted,
    ),
  };
}

export function draftToPayload(input: {
  draft: AgentLoopDraft;
  tenantId: string;
  id?: string;
  workerOptions: AgentLoopWorkerOption[];
}): SaveAgentLoopPayload {
  const worker = input.workerOptions.find(
    (candidate) => candidate.id === input.draft.workerId,
  );
  const triggerSpec: AgentLoopTriggerSpec = {
    family: input.draft.triggerFamily,
    enabled: input.draft.enabled,
    source: input.draft.triggerFamily === "schedule" ? "settings" : "manual",
    config:
      input.draft.triggerFamily === "schedule"
        ? {
            scheduleType: input.draft.scheduleType,
            scheduleExpression: input.draft.scheduleExpression,
            timezone: input.draft.timezone,
          }
        : {},
  };
  const goalSpec: AgentLoopGoalSpec = {
    objective: input.draft.objective.trim(),
    completionCriteria: criteriaFromText(input.draft.completionCriteriaText),
  };
  const workerSpec: AgentLoopWorkerSpec = {
    type: worker?.type ?? "agent",
    id: input.draft.workerId,
    label: worker?.label,
    toolHints: [],
    config: {},
  };
  const judgeSpec: AgentLoopJudgeSpec = {
    mode: input.draft.judgeMode,
    criteria: criteriaFromText(input.draft.judgeCriteriaText),
    config:
      input.draft.judgeMode === "human_approval"
        ? { escalation: "human_approval_required" }
        : {},
  };
  const loopPolicy: AgentLoopPolicy = {
    maxIterations: positiveInt(input.draft.maxIterations, 1),
    maxRuntimeMs: optionalMinutesMs(input.draft.maxRuntimeMinutes),
    maxTokens: optionalPositiveInt(input.draft.maxTokens),
    costBudgetUsd: optionalPositiveNumber(input.draft.costBudgetUsd),
    retryBackoffMs: optionalMinutesMs(input.draft.retryBackoffMinutes),
    failBehavior: input.draft.failBehavior,
    escalateOnFailure: input.draft.escalateOnFailure,
  };
  const evidencePolicy: AgentLoopEvidencePolicy = {
    redactionState: input.draft.redactionState,
    retainRawEvidence: input.draft.retainRawEvidence,
    retentionDays: optionalPositiveInt(input.draft.retentionDays),
  };
  return {
    id: input.id,
    tenantId: input.tenantId,
    name: displayNameFromDraft(input.draft),
    description: input.draft.description.trim() || null,
    lifecycleStatus: input.draft.lifecycleStatus,
    enabled: input.draft.enabled && input.draft.lifecycleStatus === "active",
    spaceId: input.draft.spaceId || null,
    triggerSpec,
    goalSpec,
    workerSpec,
    judgeSpec,
    loopPolicy,
    evidencePolicy,
    sourceMetadata: {
      createdFrom:
        input.draft.creationMode === "advanced"
          ? "settings.automations.advanced"
          : `settings.automations.${input.draft.creationMode}`,
      creationMode: input.draft.creationMode,
      phase: "phase_1",
      prompt: input.draft.objective.trim(),
      goalInference:
        criteriaFromText(input.draft.completionCriteriaText).length === 0
          ? "runtime_inferred"
          : "explicit",
      suitabilityGoalStable: input.draft.suitabilityGoalStable,
      suitabilityEvidenceAvailable: input.draft.suitabilityEvidenceAvailable,
      suitabilityBudgeted: input.draft.suitabilityBudgeted,
      ...(input.draft.builderThreadId
        ? { builderThreadId: input.draft.builderThreadId }
        : {}),
      ...(input.draft.builderSetupPrompt
        ? { builderSetupPrompt: input.draft.builderSetupPrompt }
        : {}),
    },
  };
}

export function validateDraft(draft: AgentLoopDraft): string | null {
  if (
    draft.creationMode === "advanced" &&
    !draft.name.trim() &&
    !draft.objective.trim()
  ) {
    return "Name is required.";
  }
  if (!draft.objective.trim()) return "Instruction is required.";
  if (
    draft.creationMode === "advanced" &&
    criteriaFromText(draft.completionCriteriaText).length === 0
  ) {
    return "At least one completion criterion is required.";
  }
  if (!draft.spaceId) return "Choose a Space.";
  if (draft.creationMode === "advanced" && !draft.workerId) {
    return "Choose a worker.";
  }
  if (draft.triggerFamily === "schedule" && !draft.scheduleExpression.trim()) {
    return "Scheduled loops require a schedule expression.";
  }
  if (!isPositiveInt(draft.maxIterations)) {
    return "Max iterations must be a positive whole number.";
  }
  for (const [label, value] of [
    ["Max runtime", draft.maxRuntimeMinutes],
    ["Max tokens", draft.maxTokens],
    ["Retry backoff", draft.retryBackoffMinutes],
    ["Retention days", draft.retentionDays],
  ] as const) {
    if (value.trim() && !isPositiveInt(value)) {
      return `${label} must be a positive whole number.`;
    }
  }
  if (
    draft.costBudgetUsd.trim() &&
    optionalPositiveNumber(draft.costBudgetUsd) == null
  ) {
    return "Cost budget must be a positive number.";
  }
  return null;
}

export function defaultSpaceIdFromAgentRuntimeConfig(
  value: unknown,
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const defaultSpaceId = (value as { defaultSpaceId?: unknown }).defaultSpaceId;
  return typeof defaultSpaceId === "string" && defaultSpaceId.trim()
    ? defaultSpaceId
    : null;
}

export function selectDefaultSpaceId(
  spaceOptions: AgentLoopSpaceOption[],
  defaultSpaceId?: string | null,
): string {
  if (
    defaultSpaceId &&
    spaceOptions.some((candidate) => candidate.id === defaultSpaceId)
  ) {
    return defaultSpaceId;
  }
  return spaceOptions[0]?.id ?? "";
}

function normalizeLifecycle(value: string): AgentLoopDraft["lifecycleStatus"] {
  return value === "draft" || value === "paused" || value === "archived"
    ? value
    : "active";
}

function normalizeTriggerFamily(value: unknown): AgentLoopTriggerFamily {
  return value === "schedule" ? "schedule" : "manual";
}

function normalizeRedaction(
  value: unknown,
): AgentLoopEvidencePolicy["redactionState"] {
  return value === "redacted" ||
    value === "offloaded" ||
    value === "raw_allowed"
    ? value
    : "summary_only";
}

function minutesString(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? String(Math.max(1, Math.round(value / 60_000)))
    : "";
}

function positiveInt(value: string, fallback: number): number {
  return optionalPositiveInt(value) ?? fallback;
}

function optionalPositiveInt(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function optionalPositiveNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function optionalMinutesMs(value: string): number | undefined {
  const parsed = optionalPositiveInt(value);
  return parsed == null ? undefined : parsed * 60_000;
}

function isPositiveInt(value: string): boolean {
  return optionalPositiveInt(value) != null;
}

function displayNameFromDraft(draft: AgentLoopDraft): string {
  const explicitName = draft.name.trim();
  if (explicitName) return explicitName;
  const inferredName = draft.objective
    .split(/\r?\n/)[0]
    ?.split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join(" ")
    .replace(/[.?!,:;]+$/g, "");
  return inferredName || "Untitled Automation";
}
