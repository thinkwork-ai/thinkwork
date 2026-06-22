import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ClipboardCheck,
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
  onCancel,
}: {
  mode: "create" | "edit";
  tenantId: string;
  initialLoop?: AgentLoopRow | null;
  workerOptions: AgentLoopWorkerOption[];
  onSubmit: (input: SaveAgentLoopPayload) => Promise<void>;
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
      await onSubmit(
        draftToPayload({
          draft,
          tenantId,
          id: initialLoop?.id,
          workerOptions,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <SettingsPageTitle
        title={mode === "edit" ? "Edit AgentLoop" : "New AgentLoop"}
        description="Define how the loop starts, what done means, which worker runs it, and how judgments are recorded."
      />

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
            aria-label="AgentLoop name"
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
            aria-label="AgentLoop description"
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
            aria-label="AgentLoop active"
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
              ? "Save AgentLoop"
              : "Create AgentLoop"}
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
