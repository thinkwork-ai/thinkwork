import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ClipboardCheck,
  MessageCircle,
  Pencil,
  Gauge,
  History,
  ShieldCheck,
  Timer,
} from "lucide-react";
import {
  Button,
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@thinkwork/ui";
import {
  SchedulePicker,
  type SchedulePickerValue,
} from "@/components/schedule-picker/SchedulePicker";
import {
  SettingsPageTitle,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";
import type {
  AgentLoopDraft,
  AgentLoopRow,
  AgentLoopWorkerOption,
  SaveAgentLoopPayload,
} from "./agent-loop-types";
import { AGENT_LOOP_PRESETS } from "./agent-loop-presets";
import {
  defaultAgentLoopDraft,
  draftFromVersion,
  draftToPayload,
  validateDraft,
} from "./agent-loop-utils";

export function AgentLoopForm({
  mode,
  tenantId,
  initialLoop,
  workerOptions,
  onSubmit,
  onStartBuilder,
  onConfirmBuilderDraft,
  onCancel,
}: {
  mode: "create" | "edit";
  tenantId: string;
  initialLoop?: AgentLoopRow | null;
  workerOptions: AgentLoopWorkerOption[];
  onSubmit: (input: SaveAgentLoopPayload) => Promise<void>;
  onStartBuilder?: (input: {
    tenantId: string;
    title?: string | null;
    prompt?: string | null;
    builderThreadId?: string | null;
  }) => Promise<{
    threadCreated: boolean;
    setupPrompt: string;
    draft: unknown;
    thread: { id: string; title?: string | null };
  }>;
  onConfirmBuilderDraft?: (
    input: SaveAgentLoopPayload,
    builderThreadId: string,
  ) => Promise<void>;
  onCancel: () => void;
}) {
  const seededDraft = useMemo(
    () =>
      initialLoop
        ? draftFromVersion(initialLoop, workerOptions)
        : defaultAgentLoopDraft(workerOptions),
    [initialLoop, workerOptions],
  );
  const [draft, setDraft] = useState<AgentLoopDraft>(seededDraft);
  const [saving, setSaving] = useState(false);
  const [builderStarting, setBuilderStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(seededDraft);
    setError(null);
  }, [seededDraft]);

  const validationError = validateDraft(draft);
  const scheduleValue: SchedulePickerValue = {
    scheduleType: draft.scheduleType,
    scheduleExpression: draft.scheduleExpression,
    timezone: draft.timezone,
  };

  async function save() {
    const invalid = validateDraft(draft);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = draftToPayload({
        draft,
        tenantId,
        id: initialLoop?.id,
        workerOptions,
      });
      if (
        draft.creationMode === "chat" &&
        draft.builderThreadId &&
        onConfirmBuilderDraft
      ) {
        await onConfirmBuilderDraft(payload, draft.builderThreadId);
      } else {
        await onSubmit(payload);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function startBuilder() {
    if (!onStartBuilder) return;
    setBuilderStarting(true);
    setError(null);
    try {
      const result = await onStartBuilder({
        tenantId,
        title: draft.name,
        prompt: draft.objective,
        builderThreadId: draft.builderThreadId,
      });
      const builderDraft = jsonDraft(result.draft);
      setDraft((current) => ({
        ...current,
        ...builderDraft,
        creationMode: "chat",
        builderThreadId: result.thread.id,
        builderThreadTitle: result.thread.title ?? "Automation setup",
        builderSetupPrompt: result.setupPrompt,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBuilderStarting(false);
    }
  }

  return (
    <div>
      <SettingsPageTitle
        title={mode === "edit" ? "Edit Automation" : "New Automation"}
        description="Define how the automation starts, what done means, which worker runs it, and how judgments are recorded."
      />

      {mode === "create" ? (
        <SettingsSection label="Create mode">
          <div className="flex flex-wrap gap-2 p-4">
            <ModeButton
              active={draft.creationMode === "chat"}
              icon={<MessageCircle className="size-4" />}
              label="Chat"
              onClick={() =>
                setDraft((current) => ({ ...current, creationMode: "chat" }))
              }
            />
            <ModeButton
              active={draft.creationMode === "easy"}
              icon={<Pencil className="size-4" />}
              label="Manual"
              onClick={() =>
                setDraft((current) => ({ ...current, creationMode: "easy" }))
              }
            />
            <ModeButton
              active={draft.creationMode === "advanced"}
              icon={<Gauge className="size-4" />}
              label="Advanced"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  creationMode: "advanced",
                }))
              }
            />
          </div>
        </SettingsSection>
      ) : null}

      {mode === "create" && draft.creationMode === "chat" ? (
        <SettingsSection label="Chat builder">
          <SettingsRow
            label="Prompt"
            description="Start with what you want automated. The builder thread asks follow-up questions and prepares a draft."
            layout="stacked"
          >
            <Textarea
              aria-label="Automation prompt"
              className="min-h-28 w-full"
              value={draft.objective}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  objective: event.target.value,
                  name: current.name || titleFromPrompt(event.target.value),
                }))
              }
              placeholder="Watch Linear for issues ready for implementation and create a short routing summary."
            />
          </SettingsRow>
          <SettingsRow label="Builder thread">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => void startBuilder()}
                disabled={builderStarting || !onStartBuilder}
              >
                <MessageCircle className="mr-2 size-4" />
                {builderStarting
                  ? "Starting..."
                  : draft.builderThreadId
                    ? "Resume chat builder"
                    : "Start chat builder"}
              </Button>
              {draft.builderThreadId ? (
                <a
                  className="text-sm text-primary hover:underline"
                  href={`/threads/${draft.builderThreadId}`}
                >
                  Open setup thread
                </a>
              ) : null}
            </div>
          </SettingsRow>
          {draft.builderThreadId ? (
            <SettingsRow
              label="Review draft"
              description="Confirming saves the Automation and keeps this setup thread linked as history."
              layout="stacked"
            >
              <div className="rounded-md border border-border/70 p-4 text-sm">
                <div className="font-medium">{draft.name || "Untitled"}</div>
                <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                  {draft.objective}
                </p>
                <p className="mt-3 text-muted-foreground">
                  Trigger:{" "}
                  {draft.triggerFamily === "schedule" ? "Schedule" : "Manual"}
                </p>
              </div>
            </SettingsRow>
          ) : null}
        </SettingsSection>
      ) : null}

      {mode === "create" ? (
        <SettingsSection label="Preset">
          <div className="divide-y divide-border">
            {AGENT_LOOP_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setDraft(preset.buildDraft(workerOptions))}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {preset.name}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {preset.description}
                  </span>
                </span>
                <ClipboardCheck className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </SettingsSection>
      ) : null}

      <SettingsSection label="Loop">
        <SettingsRow label="Name" description="Operator-facing display name.">
          <Input
            aria-label="Automation name"
            className="w-80"
            value={draft.name}
            onChange={(event) =>
              setDraft((current) => ({ ...current, name: event.target.value }))
            }
            placeholder="Weekly Agent Check-In"
          />
        </SettingsRow>
        <SettingsRow
          label="Description"
          description="Short note shown in the inventory and detail view."
        >
          <Textarea
            aria-label="Automation description"
            className="min-h-20 w-80"
            value={draft.description}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
            placeholder="Review open work and summarize next actions."
          />
        </SettingsRow>
        <SettingsRow
          label="Active"
          description="Paused or draft loops keep history but do not fire schedules."
        >
          <Switch
            aria-label="Automation active"
            checked={draft.lifecycleStatus === "active" && draft.enabled}
            onCheckedChange={(checked) =>
              setDraft((current) => ({
                ...current,
                lifecycleStatus: checked ? "active" : "paused",
                enabled: checked,
              }))
            }
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection label="Trigger">
        <SettingsRow
          label={
            <span className="inline-flex items-center gap-2">
              <Timer className="size-4" />
              Trigger
            </span>
          }
          description="Phase 1 supports manual starts and AWS-backed schedules."
        >
          <Select
            value={draft.triggerFamily}
            onValueChange={(value) =>
              setDraft((current) => ({
                ...current,
                triggerFamily: value === "schedule" ? "schedule" : "manual",
              }))
            }
          >
            <SelectTrigger className="w-64" aria-label="Trigger family">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="schedule">Schedule</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        {draft.triggerFamily === "schedule" ? (
          <>
            <div className="border-b border-border p-4">
              <SchedulePicker
                value={scheduleValue}
                onChange={(next) =>
                  setDraft((current) => ({
                    ...current,
                    scheduleType: next.scheduleType,
                    scheduleExpression: next.scheduleExpression,
                    timezone: next.timezone,
                  }))
                }
              />
            </div>
            <SettingsRow
              label="Suitability"
              description="A quick pre-flight for loops that will run without a person pressing start."
              layout="stacked"
            >
              <div className="grid gap-3 text-sm md:grid-cols-3">
                <ChecklistItem
                  label="Goal is stable"
                  checked={draft.suitabilityGoalStable}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({
                      ...current,
                      suitabilityGoalStable: checked,
                    }))
                  }
                />
                <ChecklistItem
                  label="Evidence is available"
                  checked={draft.suitabilityEvidenceAvailable}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({
                      ...current,
                      suitabilityEvidenceAvailable: checked,
                    }))
                  }
                />
                <ChecklistItem
                  label="Budget is bounded"
                  checked={draft.suitabilityBudgeted}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({
                      ...current,
                      suitabilityBudgeted: checked,
                    }))
                  }
                />
              </div>
            </SettingsRow>
          </>
        ) : null}
      </SettingsSection>

      <SettingsSection label="Goal">
        <SettingsRow
          label={
            <span className="inline-flex items-center gap-2">
              <CheckCircle2 className="size-4" />
              Intent
            </span>
          }
          description="The objective sent to the worker at the start of each iteration."
          layout="stacked"
        >
          <Textarea
            aria-label="Goal intent"
            className="min-h-28 w-full"
            value={draft.objective}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                objective: event.target.value,
              }))
            }
            placeholder="Review open work and produce a concise status update."
          />
        </SettingsRow>
        <SettingsRow
          label="Completion criteria"
          description="One criterion per line. The judge uses these to decide whether the loop is done."
          layout="stacked"
        >
          <Textarea
            aria-label="Completion criteria"
            className="min-h-28 w-full"
            value={draft.completionCriteriaText}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                completionCriteriaText: event.target.value,
              }))
            }
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection label="Worker and judge">
        <SettingsRow
          label={
            <span className="inline-flex items-center gap-2">
              <Bot className="size-4" />
              Worker
            </span>
          }
          description="The primary worker for Phase 1 loops."
        >
          <Select
            value={draft.workerId}
            onValueChange={(workerId) =>
              setDraft((current) => ({ ...current, workerId }))
            }
          >
            <SelectTrigger className="w-80" aria-label="Worker">
              <SelectValue placeholder="Choose worker" />
            </SelectTrigger>
            <SelectContent>
              {workerOptions.map((worker) => (
                <SelectItem key={worker.id} value={worker.id}>
                  {worker.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow
          label={
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="size-4" />
              Judge
            </span>
          }
          description="Shared JudgeSpec mode. Phase 1 exposes self-check and human approval escalation."
        >
          <Select
            value={draft.judgeMode}
            onValueChange={(value) =>
              setDraft((current) => ({
                ...current,
                judgeMode:
                  value === "human_approval" ? "human_approval" : "self_check",
              }))
            }
          >
            <SelectTrigger className="w-64" aria-label="Judge mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="self_check">Self-check</SelectItem>
              <SelectItem value="human_approval">Human approval</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow
          label="Judge criteria"
          description="One criterion per line for self-check or escalation review."
          layout="stacked"
        >
          <Textarea
            aria-label="Judge criteria"
            className="min-h-24 w-full"
            value={draft.judgeCriteriaText}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                judgeCriteriaText: event.target.value,
              }))
            }
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection label="Policy">
        <div className="grid gap-0 md:grid-cols-2">
          <CompactNumberRow
            icon={<History className="size-4" />}
            label="Max iterations"
            value={draft.maxIterations}
            onChange={(maxIterations) =>
              setDraft((current) => ({ ...current, maxIterations }))
            }
          />
          <CompactNumberRow
            icon={<Timer className="size-4" />}
            label="Max runtime minutes"
            value={draft.maxRuntimeMinutes}
            onChange={(maxRuntimeMinutes) =>
              setDraft((current) => ({ ...current, maxRuntimeMinutes }))
            }
          />
          <CompactNumberRow
            icon={<Gauge className="size-4" />}
            label="Max tokens"
            value={draft.maxTokens}
            onChange={(maxTokens) =>
              setDraft((current) => ({ ...current, maxTokens }))
            }
          />
          <CompactNumberRow
            label="Cost budget USD"
            value={draft.costBudgetUsd}
            onChange={(costBudgetUsd) =>
              setDraft((current) => ({ ...current, costBudgetUsd }))
            }
            placeholder="Optional"
          />
          <CompactNumberRow
            label="Retry backoff minutes"
            value={draft.retryBackoffMinutes}
            onChange={(retryBackoffMinutes) =>
              setDraft((current) => ({ ...current, retryBackoffMinutes }))
            }
          />
          <SettingsRow label="Escalate on failure">
            <Switch
              aria-label="Escalate on failure"
              checked={draft.escalateOnFailure}
              onCheckedChange={(escalateOnFailure) =>
                setDraft((current) => ({
                  ...current,
                  escalateOnFailure,
                }))
              }
            />
          </SettingsRow>
        </div>
      </SettingsSection>

      <SettingsSection label="Evidence">
        <SettingsRow
          label="Redaction"
          description="How evidence snapshots should be retained for inspection."
        >
          <Select
            value={draft.redactionState}
            onValueChange={(redactionState) =>
              setDraft((current) => ({
                ...current,
                redactionState:
                  redactionState === "redacted" ||
                  redactionState === "offloaded" ||
                  redactionState === "raw_allowed"
                    ? redactionState
                    : "summary_only",
              }))
            }
          >
            <SelectTrigger className="w-60" aria-label="Evidence redaction">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="summary_only">Summary only</SelectItem>
              <SelectItem value="redacted">Redacted</SelectItem>
              <SelectItem value="offloaded">Offloaded</SelectItem>
              <SelectItem value="raw_allowed">Raw allowed</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow label="Retain raw evidence">
          <Switch
            aria-label="Retain raw evidence"
            checked={draft.retainRawEvidence}
            onCheckedChange={(retainRawEvidence) =>
              setDraft((current) => ({ ...current, retainRawEvidence }))
            }
          />
        </SettingsRow>
        <CompactNumberRow
          label="Retention days"
          value={draft.retentionDays}
          onChange={(retentionDays) =>
            setDraft((current) => ({ ...current, retentionDays }))
          }
        />
      </SettingsSection>

      <div className="flex items-center justify-end gap-3 pb-8">
        {error || validationError ? (
          <p className="mr-auto text-sm text-destructive">
            {error ?? validationError}
          </p>
        ) : null}
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => void save()}
          disabled={saving || !!validationError}
        >
          {saving
            ? "Saving..."
            : mode === "edit"
              ? "Save Automation"
              : "Create Automation"}
        </Button>
      </div>
    </div>
  );
}

function ChecklistItem({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-2">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <span>{label}</span>
    </label>
  );
}

function ModeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      size="sm"
      onClick={onClick}
      aria-pressed={active}
    >
      {icon}
      <span className="ml-2">{label}</span>
    </Button>
  );
}

function CompactNumberRow({
  icon,
  label,
  value,
  onChange,
  placeholder,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <SettingsRow
      label={
        <span className="inline-flex items-center gap-2">
          {icon}
          {label}
        </span>
      }
    >
      <Input
        aria-label={label}
        type="number"
        inputMode="numeric"
        min={1}
        className="w-40"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </SettingsRow>
  );
}

function jsonDraft(value: unknown): Partial<AgentLoopDraft> {
  const source =
    typeof value === "string" && value.trim()
      ? safeRecord(parseJson(value))
      : safeRecord(value);
  const draft: Partial<AgentLoopDraft> = {
    creationMode: "chat",
  };
  setString(draft, "name", source.name);
  setString(draft, "description", source.description);
  setString(draft, "scheduleType", source.scheduleType);
  setString(draft, "scheduleExpression", source.scheduleExpression);
  setString(draft, "timezone", source.timezone);
  setString(draft, "objective", source.objective);
  setString(draft, "completionCriteriaText", source.completionCriteriaText);
  setString(draft, "workerId", source.workerId);
  setString(draft, "judgeCriteriaText", source.judgeCriteriaText);
  setString(draft, "maxIterations", source.maxIterations);
  setString(draft, "maxRuntimeMinutes", source.maxRuntimeMinutes);
  setString(draft, "maxTokens", source.maxTokens);
  setString(draft, "costBudgetUsd", source.costBudgetUsd);
  setString(draft, "retryBackoffMinutes", source.retryBackoffMinutes);
  setString(draft, "retentionDays", source.retentionDays);
  setString(draft, "builderThreadId", source.builderThreadId);

  if (source.lifecycleStatus === "paused") draft.lifecycleStatus = "paused";
  if (source.enabled === false) draft.enabled = false;
  if (source.triggerFamily === "schedule") draft.triggerFamily = "schedule";
  if (source.judgeMode === "human_approval") draft.judgeMode = "human_approval";
  if (
    source.failBehavior === "best_effort_with_warning" ||
    source.failBehavior === "escalate"
  ) {
    draft.failBehavior = source.failBehavior;
  }
  if (
    source.redactionState === "redacted" ||
    source.redactionState === "offloaded" ||
    source.redactionState === "raw_allowed"
  ) {
    draft.redactionState = source.redactionState;
  }
  if (source.escalateOnFailure === true) draft.escalateOnFailure = true;
  if (source.retainRawEvidence === true) draft.retainRawEvidence = true;
  if (source.suitabilityGoalStable === true) draft.suitabilityGoalStable = true;
  if (source.suitabilityEvidenceAvailable === true) {
    draft.suitabilityEvidenceAvailable = true;
  }
  if (source.suitabilityBudgeted === true) draft.suitabilityBudgeted = true;
  return draft;
}

function safeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function setString<T extends keyof AgentLoopDraft>(
  draft: Partial<AgentLoopDraft>,
  key: T,
  value: unknown,
) {
  if (typeof value === "string" && value.trim()) {
    (draft as Record<string, string>)[key] = value.trim();
  }
}

function titleFromPrompt(prompt: string): string {
  return (
    prompt
      .split(/\r?\n/)[0]
      ?.split(/\s+/)
      .filter(Boolean)
      .slice(0, 8)
      .join(" ")
      .replace(/[.?!,:;]+$/g, "") ?? ""
  );
}
