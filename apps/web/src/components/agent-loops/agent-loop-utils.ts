import type {
  AgentLoopDraft,
  AgentLoopFormTriggerFamily,
  AgentLoopGoalSpec,
  AgentLoopSpaceOption,
  AgentLoopTargetKind,
  AgentLoopTargetSpec,
  AgentLoopThreadMode,
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

// ---------------------------------------------------------------------------
// Draft <-> payload (THINK-137 U3 — target_spec model)
// ---------------------------------------------------------------------------

export function defaultAgentLoopDraft(
  workerOptions: AgentLoopWorkerOption[],
  spaceOptions: AgentLoopSpaceOption[] = [],
  defaultSpaceId?: string | null,
  runAsUserId = "",
): AgentLoopDraft {
  const worker =
    workerOptions.find((candidate) => candidate.type === "agent") ??
    workerOptions[0];
  return {
    name: "",
    description: "",
    lifecycleStatus: "active",
    enabled: true,
    triggerFamily: "schedule",
    scheduleType: "rate",
    scheduleExpression: "rate(7 days)",
    timezone: "UTC",
    targetKind: "agent_thread",
    instructions: "",
    workerId: worker?.id ?? "",
    threadMode: "new_per_run",
    fixedThreadId: "",
    routineId: "",
    workflowId: "",
    runAsUserId,
    spaceId: selectDefaultSpaceId(spaceOptions, defaultSpaceId),
  };
}

/** Reads the authoritative target_spec from a version, falling back to the
 * legacy goal/worker/routineActions blobs for pre-U3 rows. Mirrors
 * packages/agent-loops-core `targetSpecFromLegacy` for the read path. */
export function readTargetSpec(
  version: AgentLoopVersionSummary | null | undefined,
): AgentLoopTargetSpec {
  const target = jsonRecord(version?.targetSpec);
  const kind = target.kind;
  if (kind === "agent_thread" || kind === "routine" || kind === "workflow") {
    return {
      kind,
      agentThread:
        kind === "agent_thread"
          ? normalizeAgentThreadRead(jsonRecord(target.agentThread))
          : undefined,
      routine:
        kind === "routine"
          ? { routineId: stringValue(jsonRecord(target.routine).routineId) }
          : undefined,
      workflow:
        kind === "workflow"
          ? { routineId: stringValue(jsonRecord(target.workflow).routineId) }
          : undefined,
    };
  }
  return targetSpecFromLegacyRead(version);
}

function normalizeAgentThreadRead(rec: Record<string, unknown>) {
  const threadMode: AgentLoopThreadMode =
    rec.threadMode === "fixed" ? "fixed" : "new_per_run";
  return {
    instructions: stringValue(rec.instructions),
    workerId: stringValue(rec.workerId) || undefined,
    workerType:
      rec.workerType === "agent_profile"
        ? ("agent_profile" as const)
        : rec.workerType === "agent"
          ? ("agent" as const)
          : undefined,
    threadMode,
    fixedThreadId: stringValue(rec.fixedThreadId) || undefined,
  };
}

/** Legacy read-fallback: routine-only versions map to routine kind; everything
 * else maps to agent_thread from goalSpec.objective + workerSpec. */
function targetSpecFromLegacyRead(
  version: AgentLoopVersionSummary | null | undefined,
): AgentLoopTargetSpec {
  const routineActions = jsonRecord(version?.routineActionsSpec);
  const actions = Array.isArray(routineActions.actions)
    ? (routineActions.actions as { routineId?: unknown }[])
    : [];
  const agentTurn = routineActions.agentTurn !== false;
  if (actions.length > 0 && !agentTurn) {
    const routineId = stringValue(actions[0]?.routineId);
    return { kind: "routine", routine: { routineId } };
  }
  const goal = jsonRecord(version?.goalSpec);
  const worker = jsonRecord(version?.workerSpec);
  return {
    kind: "agent_thread",
    agentThread: {
      instructions: stringValue(goal.objective),
      workerId: stringValue(worker.id) || undefined,
      workerType:
        worker.type === "agent_profile"
          ? "agent_profile"
          : worker.type === "agent"
            ? "agent"
            : undefined,
      threadMode: "new_per_run",
    },
  };
}

export function draftFromVersion(
  loop: {
    name: string;
    description?: string | null;
    lifecycleStatus: string;
    enabled: boolean;
    runAsUserId?: string | null;
    spaceId?: string | null;
    currentVersion?: AgentLoopVersionSummary | null;
  },
  workerOptions: AgentLoopWorkerOption[],
  spaceOptions: AgentLoopSpaceOption[] = [],
  defaultSpaceId?: string | null,
  runAsUserId = "",
): AgentLoopDraft {
  const fallback = defaultAgentLoopDraft(
    workerOptions,
    spaceOptions,
    defaultSpaceId,
    runAsUserId,
  );
  const version = loop.currentVersion;
  const trigger = jsonRecord(version?.triggerSpec);
  const triggerConfig = jsonRecord(trigger.config);
  const target = readTargetSpec(version);

  return {
    ...fallback,
    name: loop.name,
    description: loop.description ?? "",
    lifecycleStatus: normalizeLifecycle(loop.lifecycleStatus),
    enabled: loop.enabled,
    triggerFamily: normalizeFormTriggerFamily(trigger.family),
    scheduleType: stringValue(
      triggerConfig.scheduleType,
      fallback.scheduleType,
    ),
    scheduleExpression: stringValue(
      triggerConfig.scheduleExpression,
      fallback.scheduleExpression,
    ),
    timezone: stringValue(triggerConfig.timezone, fallback.timezone),
    targetKind: target.kind,
    instructions: stringValue(target.agentThread?.instructions),
    workerId: stringValue(target.agentThread?.workerId, fallback.workerId),
    threadMode: target.agentThread?.threadMode ?? "new_per_run",
    fixedThreadId: stringValue(target.agentThread?.fixedThreadId),
    routineId: stringValue(target.routine?.routineId),
    workflowId: stringValue(target.workflow?.routineId),
    runAsUserId: loop.runAsUserId ?? runAsUserId,
    spaceId: loop.spaceId ?? fallback.spaceId,
  };
}

export function targetSpecFromDraft(
  draft: AgentLoopDraft,
  workerOptions: AgentLoopWorkerOption[],
): AgentLoopTargetSpec {
  if (draft.targetKind === "routine") {
    return { kind: "routine", routine: { routineId: draft.routineId } };
  }
  if (draft.targetKind === "workflow") {
    return { kind: "workflow", workflow: { routineId: draft.workflowId } };
  }
  const worker = workerOptions.find(
    (candidate) => candidate.id === draft.workerId,
  );
  return {
    kind: "agent_thread",
    agentThread: {
      instructions: draft.instructions.trim(),
      workerId: draft.workerId || undefined,
      workerType: worker?.type,
      threadMode: draft.threadMode,
      fixedThreadId:
        draft.threadMode === "fixed" && draft.fixedThreadId.trim()
          ? draft.fixedThreadId.trim()
          : undefined,
    },
  };
}

export function draftToPayload(input: {
  draft: AgentLoopDraft;
  tenantId: string;
  id?: string;
  workerOptions: AgentLoopWorkerOption[];
  routineLabel?: string | null;
}): SaveAgentLoopPayload {
  const { draft } = input;
  const worker = input.workerOptions.find(
    (candidate) => candidate.id === draft.workerId,
  );
  const triggerSpec: AgentLoopTriggerSpec = {
    family: draft.triggerFamily,
    enabled: draft.enabled,
    source:
      draft.triggerFamily === "schedule"
        ? "settings"
        : draft.triggerFamily === "webhook"
          ? "webhook"
          : "manual",
    config:
      draft.triggerFamily === "schedule"
        ? {
            scheduleType: draft.scheduleType,
            scheduleExpression: draft.scheduleExpression,
            timezone: draft.timezone,
          }
        : {},
  };
  const targetSpec = targetSpecFromDraft(draft, input.workerOptions);
  // goalSpec/workerSpec are still required by SaveAgentLoopInput; derive them
  // from the target so the API contract is satisfied. targetSpec is
  // authoritative and wins for dispatch.
  const goalSpec: AgentLoopGoalSpec = {
    objective: deriveObjective(draft, input.routineLabel),
    completionCriteria: [],
  };
  const workerSpec: AgentLoopWorkerSpec = {
    type: worker?.type ?? "agent",
    id: draft.targetKind === "agent_thread" ? draft.workerId : "",
    label: worker?.label,
    toolHints: [],
    config: {},
  };
  return {
    id: input.id,
    tenantId: input.tenantId,
    name: displayNameFromDraft(draft, input.routineLabel),
    description: draft.description.trim() || null,
    lifecycleStatus: draft.lifecycleStatus,
    enabled: draft.enabled && draft.lifecycleStatus === "active",
    runAsUserId: draft.runAsUserId || null,
    spaceId: draft.spaceId || null,
    triggerSpec,
    goalSpec,
    workerSpec,
    targetSpec,
    sourceMetadata: {
      createdFrom: "settings.automations",
      targetKind: draft.targetKind,
      triggerFamily: draft.triggerFamily,
      phase: "phase_1",
    },
  };
}

export function validateDraft(draft: AgentLoopDraft): string | null {
  if (draft.targetKind === "agent_thread") {
    if (!draft.instructions.trim()) return "Instructions are required.";
    if (!draft.spaceId) return "Choose a Space.";
    if (draft.threadMode === "fixed" && !draft.fixedThreadId.trim()) {
      return "A fixed thread id is required.";
    }
  }
  if (draft.targetKind === "routine" && !draft.routineId) {
    return "Choose a routine.";
  }
  if (draft.targetKind === "workflow" && !draft.workflowId) {
    return "Choose a workflow.";
  }
  if (draft.triggerFamily === "schedule" && !draft.scheduleExpression.trim()) {
    return "Scheduled automations require a schedule.";
  }
  return null;
}

/** Space is required the moment agent_thread is selected; optional otherwise.
 * Surfaced inline on the field, not just at submit. */
export function spaceFieldError(draft: AgentLoopDraft): string | null {
  return draft.targetKind === "agent_thread" && !draft.spaceId
    ? "A Space is required for agent-thread automations."
    : null;
}

function deriveObjective(
  draft: AgentLoopDraft,
  routineLabel?: string | null,
): string {
  if (draft.targetKind === "agent_thread") {
    return draft.instructions.trim() || "Automation run";
  }
  const label = routineLabel?.trim();
  return label ? `Run ${label}` : "Run routine";
}

function displayNameFromDraft(
  draft: AgentLoopDraft,
  routineLabel?: string | null,
): string {
  const explicitName = draft.name.trim();
  if (explicitName) return explicitName;
  if (draft.targetKind !== "agent_thread") {
    return routineLabel?.trim() || "Untitled Automation";
  }
  const inferredName = draft.instructions
    .split(/\r?\n/)[0]
    ?.split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join(" ")
    .replace(/[.?!,:;]+$/g, "");
  return inferredName || "Untitled Automation";
}

function normalizeLifecycle(value: string): AgentLoopDraft["lifecycleStatus"] {
  return value === "draft" || value === "paused" || value === "archived"
    ? value
    : "active";
}

function normalizeFormTriggerFamily(
  value: unknown,
): AgentLoopFormTriggerFamily {
  return value === "webhook" ? "webhook" : "schedule";
}

// Re-exported so callers keep a single import surface for target kinds.
export const AGENT_LOOP_TARGET_KINDS: AgentLoopTargetKind[] = [
  "agent_thread",
  "routine",
  "workflow",
];

// ---------------------------------------------------------------------------
// Schedule presets (THINK-137 U7 — compact dialog "Schedule" row popover)
//
// The Schedule row opens a small popover: preset select
// (Manual | Hourly | Daily | Weekdays | Weekly | Custom), a 15-minute-increment
// time control for the timed presets, a day-of-week select for Weekly, and a
// raw-expression input for Custom. Everything serializes to the same
// `{ triggerFamily, scheduleType, scheduleExpression, timezone }` draft shape
// job-schedule-manager already consumes (EventBridge rate()/cron()
// expressions; draftToPayload wraps them into triggerSpec.config).
// ---------------------------------------------------------------------------

export type SchedulePresetId =
  | "manual"
  | "hourly"
  | "daily"
  | "weekdays"
  | "weekly"
  | "custom";

export const SCHEDULE_PRESET_OPTIONS: {
  id: SchedulePresetId;
  label: string;
}[] = [
  { id: "manual", label: "Manual" },
  { id: "hourly", label: "Hourly" },
  { id: "daily", label: "Daily" },
  { id: "weekdays", label: "Weekdays" },
  { id: "weekly", label: "Weekly" },
  { id: "custom", label: "Custom" },
];

export const WEEKDAY_OPTIONS: { id: string; label: string }[] = [
  { id: "MON", label: "Monday" },
  { id: "TUE", label: "Tuesday" },
  { id: "WED", label: "Wednesday" },
  { id: "THU", label: "Thursday" },
  { id: "FRI", label: "Friday" },
  { id: "SAT", label: "Saturday" },
  { id: "SUN", label: "Sunday" },
];

/** Minutes-of-day options in 15-minute increments (12:00 AM … 11:45 PM). */
export const TIME_OPTIONS_MINUTES: number[] = Array.from(
  { length: 96 },
  (_, index) => index * 15,
);

const DEFAULT_TIME_MINUTES = 9 * 60; // 9:00 AM

/** 540 → "9:00 AM". */
export function formatTimeOfDay(minutesOfDay: number): string {
  const hours24 = Math.floor(minutesOfDay / 60) % 24;
  const minutes = minutesOfDay % 60;
  const amPm = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(minutes).padStart(2, "0")} ${amPm}`;
}

export interface ParsedSchedule {
  preset: SchedulePresetId;
  /** Minutes since midnight for the timed presets (falls back to 9:00 AM). */
  minutesOfDay: number;
  /** EventBridge day-of-week token for the weekly preset (falls back to MON). */
  weekday: string;
  expression: string;
}

// cron(minutes hours day-of-month month day-of-week year)
const CRON_PATTERN =
  /^cron\((\d{1,2})\s+(\d{1,2})\s+(\S+)\s+\*\s+(\S+)\s+\*\)$/;

/** Reads the draft's trigger back into the popover's preset model. Legacy
 * `rate(7 days)` rows read as Weekly; unrecognized expressions read as
 * Custom. */
export function parseScheduleFromDraft(draft: AgentLoopDraft): ParsedSchedule {
  const expression = draft.scheduleExpression.trim();
  const fallback = {
    minutesOfDay: DEFAULT_TIME_MINUTES,
    weekday: "MON",
    expression,
  };
  if (draft.triggerFamily === "manual") {
    return { preset: "manual", ...fallback, expression: "" };
  }
  if (expression === "rate(1 hour)") return { preset: "hourly", ...fallback };
  if (expression === "rate(7 days)") return { preset: "weekly", ...fallback };
  const cron = CRON_PATTERN.exec(expression);
  if (cron) {
    const minutesOfDay = parseInt(cron[2], 10) * 60 + parseInt(cron[1], 10);
    const dayOfMonth = cron[3];
    const dayOfWeek = cron[4];
    if (dayOfMonth === "*" && dayOfWeek === "?") {
      return { ...fallback, preset: "daily", minutesOfDay };
    }
    if (dayOfMonth === "?" && dayOfWeek === "MON-FRI") {
      return { ...fallback, preset: "weekdays", minutesOfDay };
    }
    if (
      dayOfMonth === "?" &&
      WEEKDAY_OPTIONS.some((option) => option.id === dayOfWeek)
    ) {
      return { preset: "weekly", minutesOfDay, weekday: dayOfWeek, expression };
    }
  }
  return { preset: "custom", ...fallback };
}

/** The draft patch a non-custom preset selection (or time/day change)
 * applies. */
export function schedulePatch(input: {
  preset: Exclude<SchedulePresetId, "custom">;
  minutesOfDay?: number;
  weekday?: string;
  timezone?: string;
}): Partial<AgentLoopDraft> {
  if (input.preset === "manual") {
    return {
      triggerFamily: "manual",
      scheduleType: "",
      scheduleExpression: "",
    };
  }
  const timezone = input.timezone || "UTC";
  if (input.preset === "hourly") {
    return {
      triggerFamily: "schedule",
      scheduleType: "rate",
      scheduleExpression: "rate(1 hour)",
      timezone,
    };
  }
  const minutesOfDay = input.minutesOfDay ?? DEFAULT_TIME_MINUTES;
  const minutes = minutesOfDay % 60;
  const hours = Math.floor(minutesOfDay / 60) % 24;
  const dayField =
    input.preset === "daily"
      ? "* * ?"
      : input.preset === "weekdays"
        ? "? * MON-FRI"
        : `? * ${input.weekday ?? "MON"}`;
  return {
    triggerFamily: "schedule",
    scheduleType: "cron",
    scheduleExpression: `cron(${minutes} ${hours} ${dayField} *)`,
    timezone,
  };
}

/** Custom expressions pass through raw; the type is derived from the prefix
 * the same way the legacy SchedulePicker did. */
export function customSchedulePatch(
  expression: string,
): Partial<AgentLoopDraft> {
  const trimmed = expression.trim();
  return {
    triggerFamily: "schedule",
    scheduleType: trimmed.startsWith("rate(") ? "rate" : "cron",
    scheduleExpression: expression,
  };
}

/** The closed Schedule row's value text, e.g. "Weekdays at 9:00 AM". */
export function scheduleValueLabel(draft: AgentLoopDraft): string {
  const parsed = parseScheduleFromDraft(draft);
  switch (parsed.preset) {
    case "manual":
      return "Manual";
    case "hourly":
      return "Hourly";
    case "daily":
      return `Daily at ${formatTimeOfDay(parsed.minutesOfDay)}`;
    case "weekdays":
      return `Weekdays at ${formatTimeOfDay(parsed.minutesOfDay)}`;
    case "weekly": {
      if (parsed.expression === "rate(7 days)") return "Weekly";
      const day =
        WEEKDAY_OPTIONS.find((option) => option.id === parsed.weekday)?.label ??
        "Monday";
      return `Weekly on ${day} at ${formatTimeOfDay(parsed.minutesOfDay)}`;
    }
    default:
      return "Custom";
  }
}
