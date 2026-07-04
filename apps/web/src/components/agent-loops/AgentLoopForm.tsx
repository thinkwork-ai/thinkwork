import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@thinkwork/ui";
import { cn } from "@/lib/utils";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { SchedulePicker } from "@/components/schedule-picker/SchedulePicker";
import type {
  AgentLoopDraft,
  AgentLoopMemberOption,
  AgentLoopRoutineOption,
  AgentLoopRow,
  AgentLoopSpaceOption,
  AgentLoopTargetKind,
  AgentLoopWorkerOption,
  SaveAgentLoopPayload,
} from "./agent-loop-types";
import {
  defaultAgentLoopDraft,
  draftFromVersion,
  draftToPayload,
  spaceFieldError,
  validateDraft,
} from "./agent-loop-utils";

const TARGET_KINDS: { id: AgentLoopTargetKind; label: string }[] = [
  { id: "agent_thread", label: "Agent thread" },
  { id: "routine", label: "Routine" },
  { id: "workflow", label: "Workflow" },
];

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
  automationsHref = "/settings/automations",
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
  automationsHref?: string;
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
  const title = mode === "edit" ? "Edit Automation" : "New Automation";

  useEffect(() => {
    setDraft(seededDraft);
    setError(null);
  }, [seededDraft]);

  usePageHeaderActions({
    title,
    breadcrumbs: [
      { label: "Automations", href: automationsHref },
      { label: title },
    ],
  });

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
    <div className="mx-auto w-full max-w-3xl space-y-8 pb-10">
      {/* Name + description */}
      <section className="space-y-4">
        <Field label="Name" htmlFor="automation-name">
          <Input
            id="automation-name"
            aria-label="Automation name"
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Auto-derived from the target when left blank"
          />
        </Field>
        <Field label="Description" htmlFor="automation-description" optional>
          <Textarea
            id="automation-description"
            aria-label="Automation description"
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
            placeholder="Optional summary of what this automation does"
            className="min-h-16"
          />
        </Field>
      </section>

      {/* Trigger */}
      <section className="space-y-4">
        <SectionHeading
          title="Trigger"
          description="How this automation starts a run"
        />
        <ToggleRow
          ariaGroup="Trigger family"
          value={draft.triggerFamily}
          options={[
            { id: "schedule", label: "Schedule" },
            { id: "webhook", label: "Webhook" },
          ]}
          onChange={(id) =>
            patch({ triggerFamily: id as "schedule" | "webhook" })
          }
        />
        {draft.triggerFamily === "schedule" ? (
          <SchedulePicker
            value={{
              scheduleType: draft.scheduleType,
              scheduleExpression: draft.scheduleExpression,
              timezone: draft.timezone,
            }}
            onChange={(value) =>
              patch({
                scheduleType: value.scheduleType,
                scheduleExpression: value.scheduleExpression,
                timezone: value.timezone,
              })
            }
          />
        ) : (
          <WebhookPanel automationExists={mode === "edit"} />
        )}
      </section>

      {/* Target */}
      <section className="space-y-4">
        <SectionHeading title="Target" description="What a run does" />
        <ToggleRow
          ariaGroup="Target kind"
          value={draft.targetKind}
          options={TARGET_KINDS}
          onChange={(id) => patch({ targetKind: id as AgentLoopTargetKind })}
        />

        {draft.targetKind === "agent_thread" ? (
          <div className="space-y-4">
            <Field label="Instructions" htmlFor="automation-instructions">
              <Textarea
                id="automation-instructions"
                aria-label="Automation instruction"
                value={draft.instructions}
                onChange={(e) => patch({ instructions: e.target.value })}
                placeholder="What should the agent do each run?"
                className="min-h-28"
              />
            </Field>
            <Field label="Worker" htmlFor="automation-worker">
              <Select
                value={draft.workerId}
                onValueChange={(value) => patch({ workerId: value })}
              >
                <SelectTrigger id="automation-worker" aria-label="Worker">
                  <SelectValue placeholder="Choose a worker" />
                </SelectTrigger>
                <SelectContent>
                  {workerOptions.map((worker) => (
                    <SelectItem key={worker.id} value={worker.id}>
                      {worker.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Thread" htmlFor="automation-thread-mode">
              <Select
                value={draft.threadMode}
                onValueChange={(value) =>
                  patch({ threadMode: value as AgentLoopDraft["threadMode"] })
                }
              >
                <SelectTrigger
                  id="automation-thread-mode"
                  aria-label="Thread mode"
                >
                  <SelectValue placeholder="New thread per run" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new_per_run">
                    New thread per run
                  </SelectItem>
                  <SelectItem value="fixed">Reuse a fixed thread</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {draft.threadMode === "fixed" ? (
              <Field label="Fixed thread id" htmlFor="automation-fixed-thread">
                <Input
                  id="automation-fixed-thread"
                  aria-label="Fixed thread id"
                  value={draft.fixedThreadId}
                  onChange={(e) => patch({ fixedThreadId: e.target.value })}
                  placeholder="thread id"
                />
              </Field>
            ) : null}
          </div>
        ) : null}

        {draft.targetKind === "routine" ? (
          <Field label="Routine" htmlFor="automation-routine">
            <RoutineSelect
              id="automation-routine"
              ariaLabel="Routine"
              options={routineOptions}
              value={draft.routineId}
              onChange={(value) => patch({ routineId: value })}
              emptyLabel="No routines available yet."
            />
          </Field>
        ) : null}

        {draft.targetKind === "workflow" ? (
          <Field label="Workflow" htmlFor="automation-workflow">
            <RoutineSelect
              id="automation-workflow"
              ariaLabel="Workflow"
              options={workflowOptions}
              value={draft.workflowId}
              onChange={(value) => patch({ workflowId: value })}
              emptyLabel="No workflows available yet."
            />
          </Field>
        ) : null}
      </section>

      {/* Run identity + Space */}
      <section className="space-y-4">
        <SectionHeading
          title="Run as & Space"
          description="Which identity a run acts as, and where it runs"
        />
        <Field label="Run as" htmlFor="automation-run-as">
          <Select
            value={draft.runAsUserId}
            onValueChange={(value) => patch({ runAsUserId: value })}
          >
            <SelectTrigger id="automation-run-as" aria-label="Run as user">
              <SelectValue placeholder="You (default)" />
            </SelectTrigger>
            <SelectContent>
              {memberOptions.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {member.label}
                  {member.id === currentUserId ? " (you)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          label="Space"
          htmlFor="automation-space"
          optional={draft.targetKind !== "agent_thread"}
          error={inlineSpaceError}
        >
          <Select
            value={draft.spaceId}
            onValueChange={(value) => patch({ spaceId: value })}
          >
            <SelectTrigger id="automation-space" aria-label="Space">
              <SelectValue placeholder="Choose a Space" />
            </SelectTrigger>
            <SelectContent>
              {spaceOptions.map((space) => (
                <SelectItem key={space.id} value={space.id}>
                  {space.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </section>

      {/* Active toggle */}
      <section className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-4 py-3">
        <div>
          <p className="text-sm font-medium">Active</p>
          <p className="text-xs text-muted-foreground">
            Paused automations keep their config but stop firing.
          </p>
        </div>
        <Switch
          aria-label="Active"
          checked={draft.enabled && draft.lifecycleStatus === "active"}
          onCheckedChange={(checked) =>
            patch({
              enabled: checked,
              lifecycleStatus: checked ? "active" : "paused",
            })
          }
        />
      </section>

      <div className="flex items-center gap-3 pt-2">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="ml-auto flex items-center gap-3">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving
              ? "Saving..."
              : mode === "edit"
                ? "Save Automation"
                : "Create automation"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function WebhookPanel({ automationExists }: { automationExists: boolean }) {
  // TODO(THINK-137 U6): once the webhook mint wiring lands, render the live
  // token + URL that the saved automation row exposes here (read from the
  // automation's webhook binding). Until then, and until the automation is
  // saved, keep the disabled placeholder — nothing exposes a webhook yet.
  return (
    <div
      data-testid="webhook-panel"
      className="rounded-md border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground"
    >
      <p className="font-medium text-foreground">Webhook</p>
      <p className="mt-1">
        {automationExists
          ? "URL and token will appear here once webhook delivery is enabled."
          : "URL and token generate after you save."}
      </p>
    </div>
  );
}

function RoutineSelect({
  id,
  ariaLabel,
  options,
  value,
  onChange,
  emptyLabel,
}: {
  id: string;
  ariaLabel: string;
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
      <SelectTrigger id={id} aria-label={ariaLabel}>
        <SelectValue placeholder="Choose one" />
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

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  optional,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  optional?: boolean;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
        {optional ? (
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            (optional)
          </span>
        ) : null}
      </label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function ToggleRow<T extends string>({
  ariaGroup,
  value,
  options,
  onChange,
}: {
  ariaGroup: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (id: T) => void;
}) {
  return (
    <div role="group" aria-label={ariaGroup} className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Button
          key={option.id}
          type="button"
          variant={value === option.id ? "default" : "outline"}
          size="sm"
          aria-pressed={value === option.id}
          className={cn(value === option.id && "pointer-events-none")}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
