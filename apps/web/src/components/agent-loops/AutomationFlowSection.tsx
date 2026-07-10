import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "urql";
import { X } from "lucide-react";
import { Button, Input, SelectItem, Textarea } from "@thinkwork/ui";
import { RoutineFlowCanvas } from "@/components/routines/RoutineFlowCanvas";
import { BoundDocumentCardQuery } from "@/lib/graphql-queries";
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
  deliveryRecipientsError,
  draftFromVersion,
  draftToPayload,
  schedulePatch,
  spaceFieldError,
  validateDraft,
} from "./agent-loop-utils";
import {
  AUTOMATION_NODE_IDS,
  buildAutomationFlowGraph,
  type AutomationNodeId,
} from "./automationFlowGraph";

const NO_SPACE = "__none__";

/**
 * THINK-247: the Automation definition IS the workflow canvas. The automation
 * renders as Trigger → Agent work → Maintains document → Email delivery in
 * the same visual language as the Workflows surface, and clicking a node
 * opens a typed, editable inspector in the right rail (replacing both the
 * old form sheet and any read-only JSON). Edits accumulate in a draft —
 * mirrored live onto the canvas — and Save writes through `saveAgentLoop`,
 * which reconverges the linked workflow server-side.
 */
export function AutomationFlowSection({
  tenantId,
  loop,
  workerOptions,
  spaceOptions,
  routineOptions,
  workflowOptions,
  memberOptions,
  defaultSpaceId,
  currentUserId,
  statusRail,
  boundDocumentPanel,
  onSave,
}: {
  tenantId: string;
  loop: AgentLoopRow;
  workerOptions: AgentLoopWorkerOption[];
  spaceOptions: AgentLoopSpaceOption[];
  routineOptions: AgentLoopRoutineOption[];
  workflowOptions: AgentLoopRoutineOption[];
  memberOptions: AgentLoopMemberOption[];
  defaultSpaceId?: string | null;
  currentUserId?: string | null;
  /** Shown in the right rail when no node is selected. */
  statusRail: ReactNode;
  /** Bound-document summary card (version, share link) for the document
   * inspector; owned by the caller so this component stays query-light. */
  boundDocumentPanel?: ReactNode;
  onSave: (payload: SaveAgentLoopPayload) => Promise<void>;
}) {
  const seededDraft = useMemo(
    () =>
      draftFromVersion(
        loop,
        workerOptions,
        spaceOptions,
        defaultSpaceId,
        currentUserId ?? "",
      ),
    [currentUserId, defaultSpaceId, loop, spaceOptions, workerOptions],
  );
  const [draft, setDraft] = useState<AgentLoopDraft>(seededDraft);
  const [selectedNode, setSelectedNode] = useState<AutomationNodeId | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(seededDraft);
    setError(null);
  }, [seededDraft]);

  const targetLabel = useMemo(() => {
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

  // Title of the bound document for the canvas node subtitle. The captured
  // id (locked in by the first run) wins over the draft's explicit pick.
  const boundArtifactId =
    draft.bindingCapturedArtifactId.trim() || draft.bindingArtifactId.trim();
  const [boundDocResult] = useQuery<{
    artifact?: { id: string; title: string } | null;
  }>({
    query: BoundDocumentCardQuery,
    variables: { id: boundArtifactId },
    pause: !boundArtifactId || draft.bindingMode === "off",
  });
  const boundDocumentTitle = boundDocResult.data?.artifact?.title ?? null;

  const graph = useMemo(
    () =>
      buildAutomationFlowGraph({
        draft,
        targetLabel,
        boundDocumentTitle,
      }),
    [draft, targetLabel, boundDocumentTitle],
  );

  // Switching the target away from agent_thread removes the document/deliver
  // nodes; drop a selection that no longer exists on the canvas.
  useEffect(() => {
    if (selectedNode && !graph.nodes.some((node) => node.id === selectedNode)) {
      setSelectedNode(null);
    }
  }, [graph, selectedNode]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(seededDraft),
    [draft, seededDraft],
  );

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
        id: loop.id,
        workerOptions,
        routineLabel: targetLabel,
      });
      await onSave(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      data-testid="automation-flow-section"
      className="flex min-h-0 flex-1 flex-col gap-4"
    >
      {dirty || error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-2.5">
          <p className="text-sm">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : (
              <span className="text-muted-foreground">
                Unsaved changes — saving updates the automation and its workflow
                together.
              </span>
            )}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving || !dirty}
              onClick={() => {
                setDraft(seededDraft);
                setError(null);
              }}
            >
              Discard
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saving || !dirty}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-6 @min-[650px]:grid-cols-[minmax(0,1fr)_340px]">
        <RoutineFlowCanvas
          mode="execution"
          aslJson={null}
          graph={graph}
          selectedNodeId={selectedNode}
          onSelectNode={(nodeId) =>
            setSelectedNode((nodeId as AutomationNodeId | null) ?? null)
          }
          className="h-full min-h-[380px]"
          emptyLabel="This automation has no steps to draw."
        />

        <div className="min-h-0 min-w-0 overflow-y-auto">
          {selectedNode ? (
            <NodeInspector
              nodeId={selectedNode}
              tenantId={tenantId}
              loop={loop}
              draft={draft}
              patch={patch}
              onClose={() => setSelectedNode(null)}
              onSelectNode={setSelectedNode}
              workerOptions={workerOptions}
              spaceOptions={spaceOptions}
              routineOptions={routineOptions}
              workflowOptions={workflowOptions}
              memberOptions={memberOptions}
              currentUserId={currentUserId}
              boundDocumentPanel={boundDocumentPanel}
            />
          ) : (
            statusRail
          )}
        </div>
      </div>
    </section>
  );
}

const INSPECTOR_TITLES: Record<AutomationNodeId, string> = {
  trigger: "Trigger & settings",
  work: "Work step",
  document: "Maintained document",
  deliver: "Email delivery",
};

function NodeInspector({
  nodeId,
  tenantId,
  loop,
  draft,
  patch,
  onClose,
  onSelectNode,
  workerOptions,
  spaceOptions,
  routineOptions,
  workflowOptions,
  memberOptions,
  currentUserId,
  boundDocumentPanel,
}: {
  nodeId: AutomationNodeId;
  tenantId: string;
  loop: AgentLoopRow;
  draft: AgentLoopDraft;
  patch: (next: Partial<AgentLoopDraft>) => void;
  onClose: () => void;
  onSelectNode: (nodeId: AutomationNodeId) => void;
  workerOptions: AgentLoopWorkerOption[];
  spaceOptions: AgentLoopSpaceOption[];
  routineOptions: AgentLoopRoutineOption[];
  workflowOptions: AgentLoopRoutineOption[];
  memberOptions: AgentLoopMemberOption[];
  currentUserId?: string | null;
  boundDocumentPanel?: ReactNode;
}) {
  return (
    <aside
      data-testid={`automation-inspector-${nodeId}`}
      className="rounded-md border border-border/70 bg-muted/10 p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{INSPECTOR_TITLES[nodeId]}</h3>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close inspector"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>

      {nodeId === AUTOMATION_NODE_IDS.trigger ? (
        <TriggerInspector
          loop={loop}
          draft={draft}
          patch={patch}
          spaceOptions={spaceOptions}
          memberOptions={memberOptions}
          currentUserId={currentUserId}
        />
      ) : nodeId === AUTOMATION_NODE_IDS.work ? (
        <WorkInspector
          draft={draft}
          patch={patch}
          workerOptions={workerOptions}
          routineOptions={routineOptions}
          workflowOptions={workflowOptions}
        />
      ) : nodeId === AUTOMATION_NODE_IDS.document ? (
        <DocumentInspector
          tenantId={tenantId}
          draft={draft}
          patch={patch}
          spaceOptions={spaceOptions}
          boundDocumentPanel={boundDocumentPanel}
        />
      ) : (
        <DeliverInspector
          draft={draft}
          patch={patch}
          onSelectNode={onSelectNode}
        />
      )}
    </aside>
  );
}

function TriggerInspector({
  loop,
  draft,
  patch,
  spaceOptions,
  memberOptions,
  currentUserId,
}: {
  loop: AgentLoopRow;
  draft: AgentLoopDraft;
  patch: (next: Partial<AgentLoopDraft>) => void;
  spaceOptions: AgentLoopSpaceOption[];
  memberOptions: AgentLoopMemberOption[];
  currentUserId?: string | null;
}) {
  const triggerMode =
    draft.triggerFamily === "webhook" ? "webhook" : "schedule";
  return (
    <div className="space-y-1">
      <label
        htmlFor="automation-name"
        className="mb-1 block text-xs text-muted-foreground"
      >
        Automation name
      </label>
      <Input
        id="automation-name"
        aria-label="Automation name"
        value={draft.name}
        onChange={(e) => patch({ name: e.target.value })}
        placeholder="Automation name"
        className="mb-2 text-sm"
      />

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

      {triggerMode === "schedule" ? (
        <DetailRow label="Schedule">
          <SchedulePopover draft={draft} patch={patch} />
        </DetailRow>
      ) : (
        <div className="py-1.5">
          <WebhookPanel endpoint={loop.webhookEndpoint} />
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

      <DetailRow label="Space" error={spaceFieldError(draft)}>
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
    </div>
  );
}

function WorkInspector({
  draft,
  patch,
  workerOptions,
  routineOptions,
  workflowOptions,
}: {
  draft: AgentLoopDraft;
  patch: (next: Partial<AgentLoopDraft>) => void;
  workerOptions: AgentLoopWorkerOption[];
  routineOptions: AgentLoopRoutineOption[];
  workflowOptions: AgentLoopRoutineOption[];
}) {
  return (
    <div className="space-y-1">
      <DetailRow label="Target">
        <GhostSelect
          ariaLabel="Target"
          value={draft.targetKind}
          onValueChange={(value) =>
            patch({ targetKind: value as AgentLoopTargetKind })
          }
          placeholder="Agent thread"
        >
          <SelectItem value="agent_thread">Agent thread</SelectItem>
          <SelectItem value="routine">Routine</SelectItem>
          <SelectItem value="workflow">Workflow</SelectItem>
        </GhostSelect>
      </DetailRow>

      {draft.targetKind === "agent_thread" ? (
        <>
          <label
            htmlFor="automation-instructions"
            className="mb-1 mt-2 block text-xs text-muted-foreground"
          >
            Agent instructions
          </label>
          <Textarea
            id="automation-instructions"
            aria-label="Agent instructions"
            value={draft.instructions}
            onChange={(e) => patch({ instructions: e.target.value })}
            placeholder="What should the agent do each run?"
            className="min-h-44 text-sm"
          />

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
                patch({ threadMode: value as AgentLoopDraft["threadMode"] })
              }
              placeholder="New thread per run"
            >
              <SelectItem value="new_per_run">New thread per run</SelectItem>
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
      ) : draft.targetKind === "routine" ? (
        <div className="pt-2">
          <TargetPicker
            ariaLabel="Routine"
            placeholder="Choose a routine…"
            options={routineOptions}
            value={draft.routineId}
            onChange={(value) => patch({ routineId: value })}
            emptyLabel="No routines available yet."
          />
        </div>
      ) : (
        <div className="pt-2">
          <TargetPicker
            ariaLabel="Workflow"
            placeholder="Choose a workflow…"
            options={workflowOptions}
            value={draft.workflowId}
            onChange={(value) => patch({ workflowId: value })}
            emptyLabel="No workflows available yet."
          />
        </div>
      )}
    </div>
  );
}

function DocumentInspector({
  tenantId,
  draft,
  patch,
  spaceOptions,
  boundDocumentPanel,
}: {
  tenantId: string;
  draft: AgentLoopDraft;
  patch: (next: Partial<AgentLoopDraft>) => void;
  spaceOptions: AgentLoopSpaceOption[];
  boundDocumentPanel?: ReactNode;
}) {
  return (
    <div className="space-y-1">
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
              className="w-44 bg-transparent px-3 py-2 text-right text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
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

      {draft.bindingMode === "off" ? (
        <p className="pt-1 text-xs text-muted-foreground">
          Bind a living document and each run refreshes it into a new edition —
          the prerequisite for email delivery.
        </p>
      ) : (
        boundDocumentPanel
      )}
    </div>
  );
}

function DeliverInspector({
  draft,
  patch,
  onSelectNode,
}: {
  draft: AgentLoopDraft;
  patch: (next: Partial<AgentLoopDraft>) => void;
  onSelectNode: (nodeId: AutomationNodeId) => void;
}) {
  if (draft.bindingMode === "off") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Email delivery sends the maintained document after each new edition —
          configure the document first.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onSelectNode(AUTOMATION_NODE_IDS.document)}
        >
          Set up the document
        </Button>
      </div>
    );
  }

  const recipientsError = draft.deliveryEnabled
    ? deliveryRecipientsError(draft.deliveryRecipients)
    : null;

  return (
    <div className="space-y-1">
      <DetailRow label="Email delivery">
        <GhostSelect
          ariaLabel="Email delivery"
          value={draft.deliveryEnabled ? "on" : "off"}
          onValueChange={(value) => patch({ deliveryEnabled: value === "on" })}
          placeholder="Off"
        >
          <SelectItem value="off">Off</SelectItem>
          <SelectItem value="on">Email each new edition</SelectItem>
        </GhostSelect>
      </DetailRow>

      {draft.deliveryEnabled ? (
        <div className="space-y-2 pt-1" data-testid="delivery-panel">
          <label
            htmlFor="delivery-recipients"
            className="block text-xs text-muted-foreground"
          >
            Recipients
          </label>
          <Input
            id="delivery-recipients"
            aria-label="Delivery recipients"
            value={draft.deliveryRecipients}
            onChange={(e) => patch({ deliveryRecipients: e.target.value })}
            placeholder="ops@company.com, ceo@company.com"
            className="text-sm"
          />
          {recipientsError && draft.deliveryRecipients.trim() ? (
            <p className="text-xs text-destructive">{recipientsError}</p>
          ) : null}
          <label
            htmlFor="delivery-subject"
            className="block text-xs text-muted-foreground"
          >
            Subject
          </label>
          <Input
            id="delivery-subject"
            aria-label="Email subject"
            value={draft.deliverySubject}
            onChange={(e) => patch({ deliverySubject: e.target.value })}
            placeholder="Optional — defaults to the document title"
            className="text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Recipients get the report inline plus a link to the living document.
            Saving this list authorizes the standing sends.
          </p>
        </div>
      ) : null}
    </div>
  );
}
