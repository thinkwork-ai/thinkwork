import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Clock, Copy } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@thinkwork/ui";
import { cn } from "@/lib/utils";
import type {
  AgentLoopDraft,
  AgentLoopMemberOption,
  AgentLoopRoutineOption,
  AgentLoopRow,
  AgentLoopSpaceOption,
  AgentLoopTargetKind,
  AgentLoopWebhookEndpoint,
  AgentLoopWorkerOption,
  SaveAgentLoopPayload,
} from "./agent-loop-types";
import {
  customSchedulePatch,
  defaultAgentLoopDraft,
  draftFromVersion,
  draftToPayload,
  formatTimeOfDay,
  parseScheduleFromDraft,
  SCHEDULE_PRESET_OPTIONS,
  schedulePatch,
  scheduleValueLabel,
  spaceFieldError,
  TIME_OPTIONS_MINUTES,
  validateDraft,
  WEEKDAY_OPTIONS,
  type SchedulePresetId,
} from "./agent-loop-utils";

const TARGET_KINDS: { id: AgentLoopTargetKind; label: string }[] = [
  { id: "agent_thread", label: "Agent thread" },
  { id: "routine", label: "Routine" },
  { id: "workflow", label: "Workflow" },
];

const NO_SPACE = "__none__";

export function AgentLoopForm({
  mode,
  tenantId,
  initialLoop,
  workerOptions,
  spaceOptions,
  routineOptions,
  workflowOptions,
  memberOptions,
  defaultSpaceId,
  currentUserId,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  tenantId: string;
  initialLoop?: AgentLoopRow | null;
  workerOptions: AgentLoopWorkerOption[];
  spaceOptions: AgentLoopSpaceOption[];
  routineOptions: AgentLoopRoutineOption[];
  workflowOptions: AgentLoopRoutineOption[];
  memberOptions: AgentLoopMemberOption[];
  defaultSpaceId?: string | null;
  currentUserId?: string | null;
  onSubmit: (input: SaveAgentLoopPayload) => Promise<void>;
  onCancel: () => void;
}) {
  const seededDraft = useMemo(
    () =>
      initialLoop
        ? draftFromVersion(
            initialLoop,
            workerOptions,
            spaceOptions,
            defaultSpaceId,
            currentUserId ?? "",
          )
        : defaultAgentLoopDraft(
            workerOptions,
            spaceOptions,
            defaultSpaceId,
            currentUserId ?? "",
          ),
    [currentUserId, defaultSpaceId, initialLoop, spaceOptions, workerOptions],
  );
  const [draft, setDraft] = useState<AgentLoopDraft>(seededDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(seededDraft);
    setError(null);
  }, [seededDraft]);

  const routineLabel = useMemo(() => {
    if (draft.targetKind === "routine") {
      return routineOptions.find((r) => r.id === draft.routineId)?.name ?? null;
    }
    if (draft.targetKind === "workflow") {
      return (
        workflowOptions.find((w) => w.id === draft.workflowId)?.name ?? null
      );
    }
    return null;
  }, [
    draft.targetKind,
    draft.routineId,
    draft.workflowId,
    routineOptions,
    workflowOptions,
  ]);

  const inlineSpaceError = spaceFieldError(draft);
  // The Trigger row is Schedule | Webhook. "Manual" lives inside the Schedule
  // row (it maps to the manual trigger family), so schedule + manual both read
  // as the "schedule" trigger mode here.
  const triggerMode =
    draft.triggerFamily === "webhook" ? "webhook" : "schedule";

  function patch(next: Partial<AgentLoopDraft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

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
        routineLabel,
      });
      await onSubmit(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent
        className="sm:max-w-lg"
        // Radix's mount auto-focus runs focusFirst(..., { select: true }) on the
        // first focusable node — the borderless title input — which selects the
        // whole automation name on open. Suppress it so editing an automation
        // doesn't land with the title pre-selected.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogTitle className="sr-only">
          {mode === "edit" ? "Edit automation" : "New automation"}
        </DialogTitle>

        {/* Borderless title */}
        <input
          aria-label="Automation name"
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="Automation name"
          className="w-full bg-transparent text-lg font-medium text-foreground outline-none placeholder:text-muted-foreground/60"
        />

        {/* Trigger + Target sit above the target-shaped body */}
        <div>
          <DetailRow label="Trigger">
            <GhostSelect
              ariaLabel="Trigger"
              value={triggerMode}
              onValueChange={(value) => {
                if (value === "webhook") {
                  patch({ triggerFamily: "webhook" });
                } else if (draft.triggerFamily === "webhook") {
                  patch(
                    draft.scheduleExpression.trim()
                      ? { triggerFamily: "schedule" }
                      : schedulePatch({
                          preset: "daily",
                          timezone: draft.timezone,
                        }),
                  );
                }
              }}
              placeholder="Schedule"
            >
              <SelectItem value="schedule">Schedule</SelectItem>
              <SelectItem value="webhook">Webhook</SelectItem>
            </GhostSelect>
          </DetailRow>

          <DetailRow label="Target">
            <GhostSelect
              ariaLabel="Target"
              value={draft.targetKind}
              onValueChange={(value) =>
                patch({ targetKind: value as AgentLoopTargetKind })
              }
              placeholder="Agent thread"
            >
              {TARGET_KINDS.map((kind) => (
                <SelectItem key={kind.id} value={kind.id}>
                  {kind.label}
                </SelectItem>
              ))}
            </GhostSelect>
          </DetailRow>
        </div>

        {/* Target-shaped body */}
        {draft.targetKind === "agent_thread" ? (
          <div>
            <label
              htmlFor="automation-instructions"
              className="mb-2 block text-sm text-muted-foreground"
            >
              Agent instructions
            </label>
            <Textarea
              id="automation-instructions"
              value={draft.instructions}
              onChange={(e) => patch({ instructions: e.target.value })}
              placeholder="What should the agent do? e.g. Review my open Linear issues every morning…"
              className="min-h-28"
            />
          </div>
        ) : draft.targetKind === "routine" ? (
          <TargetPicker
            ariaLabel="Routine"
            placeholder="Choose a routine…"
            options={routineOptions}
            value={draft.routineId}
            onChange={(value) => patch({ routineId: value })}
            emptyLabel="No routines available yet."
          />
        ) : (
          <TargetPicker
            ariaLabel="Workflow"
            placeholder="Choose a workflow…"
            options={workflowOptions}
            value={draft.workflowId}
            onChange={(value) => patch({ workflowId: value })}
            emptyLabel="No workflows available yet."
          />
        )}

        {/* Remaining details */}
        <div>
          {triggerMode === "schedule" ? (
            <DetailRow label="Schedule">
              <SchedulePopover draft={draft} patch={patch} />
            </DetailRow>
          ) : (
            <div className="py-1.5">
              <WebhookPanel endpoint={initialLoop?.webhookEndpoint} />
            </div>
          )}

          <DetailRow label="Run as">
            <GhostSelect
              ariaLabel="Run as user"
              value={draft.runAsUserId}
              onValueChange={(value) => patch({ runAsUserId: value })}
              placeholder="You"
            >
              {memberOptions.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {member.label}
                  {member.id === currentUserId ? " (you)" : ""}
                </SelectItem>
              ))}
            </GhostSelect>
          </DetailRow>

          <DetailRow label="Space" error={inlineSpaceError}>
            <GhostSelect
              ariaLabel="Space"
              value={draft.spaceId || NO_SPACE}
              onValueChange={(value) =>
                patch({ spaceId: value === NO_SPACE ? "" : value })
              }
              placeholder="None"
            >
              <SelectItem value={NO_SPACE}>None</SelectItem>
              {spaceOptions.map((space) => (
                <SelectItem key={space.id} value={space.id}>
                  {space.name}
                </SelectItem>
              ))}
            </GhostSelect>
          </DetailRow>

          {draft.targetKind === "agent_thread" ? (
            <>
              <DetailRow label="Worker">
                <GhostSelect
                  ariaLabel="Worker"
                  value={draft.workerId}
                  onValueChange={(value) => patch({ workerId: value })}
                  placeholder="Choose a worker"
                >
                  {workerOptions.map((worker) => (
                    <SelectItem key={worker.id} value={worker.id}>
                      {worker.label}
                    </SelectItem>
                  ))}
                </GhostSelect>
              </DetailRow>

              <DetailRow label="Thread">
                <GhostSelect
                  ariaLabel="Thread mode"
                  value={draft.threadMode}
                  onValueChange={(value) =>
                    patch({
                      threadMode: value as AgentLoopDraft["threadMode"],
                    })
                  }
                  placeholder="New thread per run"
                >
                  <SelectItem value="new_per_run">
                    New thread per run
                  </SelectItem>
                  <SelectItem value="fixed">Reuse a fixed thread</SelectItem>
                </GhostSelect>
              </DetailRow>

              {draft.threadMode === "fixed" ? (
                <DetailRow label="Fixed thread id">
                  <input
                    aria-label="Fixed thread id"
                    value={draft.fixedThreadId}
                    onChange={(e) => patch({ fixedThreadId: e.target.value })}
                    placeholder="thread id"
                    className="w-40 bg-transparent px-3 py-2 text-right text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
                  />
                </DetailRow>
              ) : null}
            </>
          ) : null}
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving
              ? "Saving…"
              : mode === "edit"
                ? "Save changes"
                : "Create automation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The Schedule row's value control: a popover with a preset select, a
 * 15-minute-increment time control for the timed presets, a day-of-week select
 * for Weekly, and a raw EventBridge expression input for Custom. */
function SchedulePopover({
  draft,
  patch,
}: {
  draft: AgentLoopDraft;
  patch: (next: Partial<AgentLoopDraft>) => void;
}) {
  const parsed = parseScheduleFromDraft(draft);
  const [open, setOpen] = useState(false);
  // Local preset state so choosing "Custom" sticks while the user types an
  // expression that would otherwise parse back to a named preset.
  const [preset, setPreset] = useState<SchedulePresetId>(parsed.preset);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) setPreset(parseScheduleFromDraft(draft).preset);
  }

  function handlePreset(value: string) {
    const next = value as SchedulePresetId;
    setPreset(next);
    if (next === "custom") {
      patch(customSchedulePatch(draft.scheduleExpression));
      return;
    }
    patch(
      schedulePatch({
        preset: next,
        minutesOfDay: parsed.minutesOfDay,
        weekday: parsed.weekday,
        timezone: draft.timezone,
      }),
    );
  }

  const timedPreset =
    preset === "daily" || preset === "weekdays" || preset === "weekly";

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {/* Mirrors exactly what GhostSelect's SelectTrigger renders as (base
            trigger pill + the ghost overrides) so this row's value chip is
            indistinguishable from the other detail rows. */}
        <button
          type="button"
          aria-label="Schedule"
          className="flex h-8 w-fit select-none items-center justify-end gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted/50 dark:bg-input/30 dark:hover:bg-input/50"
        >
          {scheduleValueLabel(draft)}
          <ChevronDown className="pointer-events-none size-4 shrink-0 text-muted-foreground opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-3 p-3">
        <p className="text-xs font-medium text-muted-foreground">Schedule</p>
        <Select value={preset} onValueChange={handlePreset}>
          <SelectTrigger aria-label="Schedule preset" className="w-full">
            <SelectValue placeholder="Manual" />
          </SelectTrigger>
          <SelectContent>
            {SCHEDULE_PRESET_OPTIONS.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {timedPreset ? (
          <Select
            value={String(parsed.minutesOfDay)}
            onValueChange={(value) =>
              patch(
                schedulePatch({
                  preset: preset as "daily" | "weekdays" | "weekly",
                  minutesOfDay: Number(value),
                  weekday: parsed.weekday,
                  timezone: draft.timezone,
                }),
              )
            }
          >
            <SelectTrigger aria-label="Time" className="w-full">
              <Clock className="size-4 text-muted-foreground" />
              <SelectValue placeholder="9:00 AM">
                {formatTimeOfDay(parsed.minutesOfDay)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {TIME_OPTIONS_MINUTES.map((minutes) => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {formatTimeOfDay(minutes)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {preset === "weekly" ? (
          <Select
            value={parsed.weekday}
            onValueChange={(value) =>
              patch(
                schedulePatch({
                  preset: "weekly",
                  minutesOfDay: parsed.minutesOfDay,
                  weekday: value,
                  timezone: draft.timezone,
                }),
              )
            }
          >
            <SelectTrigger aria-label="Day of week" className="w-full">
              <SelectValue placeholder="Monday" />
            </SelectTrigger>
            <SelectContent>
              {WEEKDAY_OPTIONS.map((day) => (
                <SelectItem key={day.id} value={day.id}>
                  {day.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {preset === "custom" ? (
          <Input
            aria-label="Custom schedule expression"
            value={draft.scheduleExpression}
            onChange={(event) => patch(customSchedulePatch(event.target.value))}
            placeholder="cron(0 9 ? * MON-FRI *)"
            className="font-mono text-xs"
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function WebhookPanel({
  endpoint,
}: {
  endpoint?: AgentLoopWebhookEndpoint | null;
}) {
  if (!endpoint) {
    // Pre-save (create) or a saved automation whose webhook row is not yet
    // minted: nothing to show until the endpoint exists.
    return (
      <div
        data-testid="webhook-panel"
        className="rounded-md border border-dashed border-border/70 bg-muted/20 p-3 text-xs text-muted-foreground"
      >
        URL and token generate after you save.
      </div>
    );
  }
  return (
    <div
      data-testid="webhook-panel"
      className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-3 text-xs"
    >
      <CopyField label="URL" value={endpoint.path} />
      <CopyField label="Token" value={endpoint.token} secret />
    </div>
  );
}

function CopyField({
  label,
  value,
  secret,
}: {
  label: string;
  value: string;
  secret?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-foreground">
        {secret ? "•".repeat(Math.min(value.length, 24)) : value}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Copy ${label.toLowerCase()}`}
        onClick={() => void navigator.clipboard?.writeText(value)}
      >
        <Copy className="size-3.5" />
      </Button>
    </div>
  );
}

function TargetPicker({
  ariaLabel,
  placeholder,
  options,
  value,
  onChange,
  emptyLabel,
}: {
  ariaLabel: string;
  placeholder: string;
  options: AgentLoopRoutineOption[];
  value: string;
  onChange: (value: string) => void;
  emptyLabel: string;
}) {
  if (options.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={ariaLabel} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={option.id}
            value={option.id}
            disabled={Boolean(option.disabledReason)}
          >
            {option.name}
            {option.disabledReason ? ` — ${option.disabledReason}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DetailRow({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center gap-3 py-0.5">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="ml-auto flex min-w-0 flex-col items-end gap-0.5">
        {children}
        {error ? (
          <span className="pr-3 text-xs text-destructive">{error}</span>
        ) : null}
      </div>
    </div>
  );
}

function GhostSelect({
  ariaLabel,
  value,
  onValueChange,
  placeholder,
  children,
}: {
  ariaLabel: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  children: React.ReactNode;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          "h-auto min-h-0 w-auto justify-end gap-1.5 rounded-md border-0 bg-transparent px-3 py-2",
          "text-sm font-medium text-foreground shadow-none hover:bg-muted/50",
          "focus:ring-0 focus-visible:ring-0 [&>svg]:opacity-60",
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}
