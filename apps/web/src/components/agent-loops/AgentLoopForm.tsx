import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  Input,
  SelectItem,
  Textarea,
} from "@thinkwork/ui";
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
  DetailRow,
  ExistingDocumentPicker,
  GenrePicker,
  GhostSelect,
  SchedulePopover,
  TargetPicker,
  WebhookPanel,
} from "./agent-loop-fields";
import {
  defaultAgentLoopDraft,
  deliveryRecipientsError,
  draftFromVersion,
  draftToPayload,
  schedulePatch,
  spaceFieldError,
  validateDraft,
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

              <DocumentBindingSection
                tenantId={tenantId}
                draft={draft}
                patch={patch}
                spaceOptions={spaceOptions}
              />
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

/**
 * THINK-227 U7: "Maintains a document" + "Email delivery" configuration.
 * Binding modes: off (default) | create on first run (genre from the plate
 * registry, title, target Space) | an existing document (picker over the
 * tenant's document artifacts). Delivery renders only when a binding exists —
 * it emails the maintained document after each new edition.
 */
function DocumentBindingSection({
  tenantId,
  draft,
  patch,
  spaceOptions,
}: {
  tenantId: string;
  draft: AgentLoopDraft;
  patch: (next: Partial<AgentLoopDraft>) => void;
  spaceOptions: AgentLoopSpaceOption[];
}) {
  const bindingOn = draft.bindingMode !== "off";
  const deliveryError = draft.deliveryEnabled
    ? deliveryRecipientsError(draft.deliveryRecipients)
    : null;

  return (
    <>
      <DetailRow label="Maintains document">
        <GhostSelect
          ariaLabel="Maintains document"
          value={draft.bindingMode}
          onValueChange={(value) =>
            patch({
              bindingMode: value as AgentLoopDraft["bindingMode"],
              ...(value === "off" ? { deliveryEnabled: false } : {}),
            })
          }
          placeholder="Off"
        >
          <SelectItem value="off">Off</SelectItem>
          <SelectItem value="create">Create on first run</SelectItem>
          <SelectItem value="existing">An existing document</SelectItem>
        </GhostSelect>
      </DetailRow>

      {draft.bindingMode === "create" ? (
        <>
          <DetailRow label="Genre">
            <GenrePicker
              tenantId={tenantId}
              value={draft.bindingGenre}
              onChange={(value) => patch({ bindingGenre: value })}
            />
          </DetailRow>
          <DetailRow label="Document title">
            <input
              aria-label="Document title"
              value={draft.bindingTitle}
              onChange={(e) => patch({ bindingTitle: e.target.value })}
              placeholder="Weekly Pipeline Report"
              className="w-48 bg-transparent px-3 py-2 text-right text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
            />
          </DetailRow>
          <DetailRow label="Document space">
            <GhostSelect
              ariaLabel="Document space"
              value={draft.bindingSpaceId || draft.spaceId}
              onValueChange={(value) => patch({ bindingSpaceId: value })}
              placeholder="Same as automation"
            >
              {spaceOptions.map((space) => (
                <SelectItem key={space.id} value={space.id}>
                  {space.name}
                </SelectItem>
              ))}
            </GhostSelect>
          </DetailRow>
        </>
      ) : null}

      {draft.bindingMode === "existing" ? (
        <DetailRow label="Document">
          <ExistingDocumentPicker
            tenantId={tenantId}
            value={draft.bindingArtifactId}
            onChange={(value) => patch({ bindingArtifactId: value })}
          />
        </DetailRow>
      ) : null}

      {bindingOn ? (
        <>
          <DetailRow label="Email delivery">
            <GhostSelect
              ariaLabel="Email delivery"
              value={draft.deliveryEnabled ? "on" : "off"}
              onValueChange={(value) =>
                patch({ deliveryEnabled: value === "on" })
              }
              placeholder="Off"
            >
              <SelectItem value="off">Off</SelectItem>
              <SelectItem value="on">Email each new edition</SelectItem>
            </GhostSelect>
          </DetailRow>
          {draft.deliveryEnabled ? (
            <div className="space-y-2 py-1.5" data-testid="delivery-panel">
              <Input
                aria-label="Delivery recipients"
                value={draft.deliveryRecipients}
                onChange={(e) => patch({ deliveryRecipients: e.target.value })}
                placeholder="ops@company.com, ceo@company.com"
                className="text-sm"
              />
              {deliveryError && draft.deliveryRecipients.trim() ? (
                <p className="text-xs text-destructive">{deliveryError}</p>
              ) : null}
              <Input
                aria-label="Email subject"
                value={draft.deliverySubject}
                onChange={(e) => patch({ deliverySubject: e.target.value })}
                placeholder="Subject (optional — defaults to the document title)"
                className="text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Recipients get the report inline plus a link to the living
                document. Saving this list authorizes the standing sends.
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}
