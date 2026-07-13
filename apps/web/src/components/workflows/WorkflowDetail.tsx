import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { Info, Pencil, RefreshCw, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@thinkwork/ui";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { StatusBadge } from "@/components/StatusBadge";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  DeleteWorkflowMutation,
  SettingsAgentLoopQuery,
  SettingsAgentLoopsQuery,
  SettingsSaveAgentLoopMutation,
  SettingsWorkflowQuery,
  SettingsWorkflowSourceAutomationQuery,
} from "@/lib/graphql-queries";
import { AutomationFlowSection } from "@/components/agent-loops/AutomationFlowSection";
import { AutomationStatusRail } from "@/components/agent-loops/AutomationStatusRail";
import type {
  AgentLoopRow,
  SaveAgentLoopPayload,
} from "@/components/agent-loops/agent-loop-types";
import { useAutomationEditorData } from "@/components/agent-loops/useAutomationEditorData";
import { buildAutomationFlowGraphFromLoop } from "@/components/agent-loops/automationFlowGraph";
import { WorkflowDefinitionTab } from "./WorkflowDefinitionTab";
import { WorkflowExecutionsTab } from "./WorkflowExecutionsTab";
import { WorkflowFormDialog } from "./WorkflowFormDialog";
import {
  DefinitionList,
  formatDateTime,
  formatDuration,
  InfoCard,
  jsonRecord,
  JsonPreview,
  primaryBinding,
  readinessReasonText,
  sourceLabel,
  SourceBadge,
  titleize,
  type WorkflowBinding,
  type WorkflowRunSummary,
  WorkflowReadinessBadge,
} from "./workflow-ui";
import { buildWorkflowDefinitionGraph } from "./workflowDefinitionGraph";
import { mergeAutomationExecutions } from "./workflow-execution-model";

type WorkflowTrigger = {
  id: string;
  triggerFamily: string;
  sourceSystem?: string | null;
  enabled: boolean;
  idempotencyRequired: boolean;
  triggerConfig?: unknown;
  actorContract?: unknown;
  readinessState: string;
  readinessReasons?: unknown;
};

type WorkflowDetailData = {
  workflow?: {
    id: string;
    name: string;
    slug: string;
    description?: string | null;
    lifecycleStatus: string;
    visibility: string;
    ownerUserId?: string | null;
    ownerAgentId?: string | null;
    primaryTriggerFamily: string;
    currentVersionNumber?: number | null;
    capabilityFlags?: unknown;
    readinessState: string;
    readinessReasons?: unknown;
    currentVersion?: {
      id: string;
      versionNumber: number;
      versionStatus: string;
      sourceKind: string;
      sourceMetadata?: unknown;
      definitionSnapshot?: unknown;
      capabilitySnapshot?: unknown;
      routineAslVersionId?: string | null;
      publishedAt?: string | null;
      createdAt: string;
    } | null;
    triggers: WorkflowTrigger[];
    bindings: WorkflowBinding[];
    runs: WorkflowRunSummary[];
    sourceAutomation?: AgentLoopRow | null;
    createdAt: string;
    updatedAt: string;
  } | null;
};
type WorkflowSourceAutomationData = {
  workflow?: {
    id: string;
    sourceAutomation?: AgentLoopRow | null;
  } | null;
};

export type WorkflowDetailTab = "definition" | "executions";

export function WorkflowDetail({
  workflowId,
  tab = "definition",
}: {
  workflowId: string;
  tab?: WorkflowDetailTab;
}) {
  const navigate = useNavigate();
  const editor = useAutomationEditorData();
  const [result, refetch] = useQuery<WorkflowDetailData>({
    query: SettingsWorkflowQuery,
    variables: { id: workflowId, runLimit: 25 },
    requestPolicy: "cache-and-network",
  });
  const [sourceAutomationResult, refetchSourceAutomation] =
    useQuery<WorkflowSourceAutomationData>({
      query: SettingsWorkflowSourceAutomationQuery,
      variables: { id: workflowId, runLimit: 25 },
      requestPolicy: "cache-and-network",
    });
  const baseWorkflow = result.data?.workflow ?? null;
  const legacyAutomationPrefix = useMemo(() => {
    if (!sourceAutomationResult.error) return null;
    const match = /^automation-([0-9a-f]{8})$/i.exec(baseWorkflow?.slug ?? "");
    return match?.[1]?.toLowerCase() ?? null;
  }, [baseWorkflow?.slug, sourceAutomationResult.error]);
  const [legacyInventoryResult] = useQuery<{ agentLoops?: AgentLoopRow[] }>({
    query: SettingsAgentLoopsQuery,
    variables: {
      tenantId: editor.tenantId ?? "",
      limit: 100,
      scope: "OPERATOR",
    },
    pause: !editor.tenantId || !legacyAutomationPrefix,
    requestPolicy: "cache-and-network",
  });
  const legacySourceId = useMemo(() => {
    if (!legacyAutomationPrefix) return null;
    const matches = (legacyInventoryResult.data?.agentLoops ?? []).filter(
      (loop) => loop.id.toLowerCase().startsWith(legacyAutomationPrefix),
    );
    return matches.length === 1 ? matches[0].id : null;
  }, [legacyAutomationPrefix, legacyInventoryResult.data?.agentLoops]);
  const [legacySourceResult] = useQuery<{ agentLoop?: AgentLoopRow | null }>({
    query: SettingsAgentLoopQuery,
    variables: {
      id: legacySourceId ?? "",
      runLimit: 25,
      scope: "OPERATOR",
    },
    pause: !legacySourceId,
    requestPolicy: "cache-and-network",
  });
  const [deleteState, deleteWorkflowMutation] = useMutation(
    DeleteWorkflowMutation,
  );
  const [, saveSourceAutomationMutation] = useMutation(
    SettingsSaveAgentLoopMutation,
  );
  const [editOpen, setEditOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const workflow = useMemo(
    () =>
      baseWorkflow
        ? {
            ...baseWorkflow,
            sourceAutomation:
              sourceAutomationResult.data?.workflow?.sourceAutomation ??
              legacySourceResult.data?.agentLoop ??
              null,
          }
        : null,
    [
      baseWorkflow,
      legacySourceResult.data?.agentLoop,
      sourceAutomationResult.data?.workflow?.sourceAutomation,
    ],
  );
  const binding = primaryBinding(workflow?.bindings);
  const readinessReason = readinessReasonText(workflow?.readinessReasons);
  const routineId =
    binding?.bindingType === "step_functions_routine"
      ? binding.routineId
      : null;
  const primaryTrigger = workflow?.triggers.find(
    (trigger) => trigger.triggerFamily === workflow.primaryTriggerFamily,
  );
  const triggerConfig = jsonRecord(primaryTrigger?.triggerConfig);
  const executionGraph = useMemo(
    () =>
      workflow?.sourceAutomation
        ? buildAutomationFlowGraphFromLoop({
            loop: workflow.sourceAutomation,
            workerOptions: editor.workerOptions,
            spaceOptions: editor.spaceOptions,
            defaultSpaceId: editor.defaultSpaceId,
            currentUserId: editor.userId,
          })
        : buildWorkflowDefinitionGraph(
            workflow?.currentVersion?.definitionSnapshot,
          ),
    [
      editor.defaultSpaceId,
      editor.spaceOptions,
      editor.userId,
      editor.workerOptions,
      workflow?.currentVersion?.definitionSnapshot,
      workflow?.sourceAutomation,
    ],
  );
  const executions = useMemo(
    () =>
      mergeAutomationExecutions(
        workflow?.runs ?? [],
        workflow?.sourceAutomation?.runs ?? [],
      ),
    [workflow?.runs, workflow?.sourceAutomation?.runs],
  );

  async function deleteWorkflow() {
    if (!workflow) return;
    const response = await deleteWorkflowMutation({ id: workflow.id });
    if (response.error) {
      toast.error(`Could not delete workflow: ${response.error.message}`);
      return;
    }
    toast.success("Workflow deleted.");
    void navigate({ to: "/settings/workflows" });
  }

  async function saveSourceAutomation(payload: SaveAgentLoopPayload) {
    const response = await saveSourceAutomationMutation({
      input: payload,
      scope: "OPERATOR",
    });
    if (response.error) throw response.error;
    refetch({ requestPolicy: "network-only" });
    refetchSourceAutomation({ requestPolicy: "network-only" });
    toast.success("Automation saved");
  }

  const headerIcon =
    "text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary";
  const headerTooltip = {
    side: "bottom" as const,
    className:
      "border border-border bg-popover text-popover-foreground shadow-md",
    arrowClassName: "bg-popover fill-popover border-b border-r border-border",
  };

  usePageHeaderActions({
    title: workflow?.name ?? "Workflow",
    breadcrumbs: [
      { label: "Workflows", href: "/settings/workflows" },
      { label: workflow?.name ?? "Workflow" },
    ],
    tabs: [
      {
        to: `/settings/workflows/${workflowId}`,
        label: "Definition",
        search: {},
        active: tab === "definition",
      },
      {
        to: `/settings/workflows/${workflowId}`,
        label: "Executions",
        search: { tab: "executions" },
        active: tab === "executions",
      },
    ],
    action: workflow ? (
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={headerIcon}
              aria-label="Workflow information"
              onClick={() => setInfoOpen(true)}
            >
              <Info className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent {...headerTooltip}>
            Workflow information
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={headerIcon}
              aria-label="Edit workflow"
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent {...headerTooltip}>Edit workflow</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              aria-label="Delete workflow"
              disabled={deleteState.fetching}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent {...headerTooltip}>Delete workflow</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={headerIcon}
              aria-label="Refresh workflow"
              onClick={() => refetch({ requestPolicy: "network-only" })}
            >
              <RefreshCw className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent {...headerTooltip}>Refresh</TooltipContent>
        </Tooltip>
      </div>
    ) : null,
    actionKey: `workflow:${workflowId}:${workflow?.updatedAt ?? "loading"}:${tab}:${deleteState.fetching ? "deleting" : "idle"}`,
  });

  if (result.fetching && !workflow) {
    return (
      <div className="flex items-center justify-center py-24">
        <LoadingShimmer />
      </div>
    );
  }

  if (result.error || !workflow) {
    return (
      <div className="w-full max-w-[750px] px-6 pb-10 pt-6">
        <InfoCard title="Workflow not found">
          <p className="text-sm text-muted-foreground">
            {result.error?.message ??
              "This workflow could not be loaded or no longer exists."}
          </p>
        </InfoCard>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden p-4">
      {tab === "executions" ? (
        <WorkflowExecutionsTab executions={executions} graph={executionGraph} />
      ) : workflow.sourceAutomation && editor.tenantId ? (
        <AutomationFlowSection
          tenantId={editor.tenantId}
          loop={workflow.sourceAutomation}
          workerOptions={editor.workerOptions}
          spaceOptions={editor.spaceOptions}
          routineOptions={editor.routineOptions}
          workflowOptions={editor.workflowOptions}
          memberOptions={editor.memberOptions}
          defaultSpaceId={editor.defaultSpaceId}
          currentUserId={editor.userId}
          statusRail={
            <AutomationStatusRail
              loop={workflow.sourceAutomation}
              pendingAction={null}
              spaceOptions={editor.spaceOptions}
              memberOptions={editor.memberOptions}
              variant="card"
              showActions={false}
              onRun={() => undefined}
              onToggle={() => undefined}
            />
          }
          onSave={saveSourceAutomation}
        />
      ) : (
        <WorkflowDefinitionTab
          definition={workflow.currentVersion?.definitionSnapshot}
          version={workflow.currentVersion ?? null}
        />
      )}

      {/* Workflow information (was the Overview tab) — behind the header
          info icon. */}
      <Sheet open={infoOpen} onOpenChange={setInfoOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <span className="min-w-0 truncate">{workflow.name}</span>
              <SourceBadge binding={binding} />
            </SheetTitle>
            <SheetDescription>
              Identity, source, and triggers for this workflow.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-6">
            <InfoCard title="Identity">
              <DefinitionList
                items={[
                  {
                    label: "Lifecycle",
                    value: titleize(workflow.lifecycleStatus),
                  },
                  {
                    label: "Readiness",
                    value: (
                      <WorkflowReadinessBadge
                        state={workflow.readinessState}
                        reasons={workflow.readinessReasons}
                        showReason={false}
                      />
                    ),
                  },
                  ...(readinessReason
                    ? [{ label: "Readiness details", value: readinessReason }]
                    : []),
                  {
                    label: "Trigger",
                    value: titleize(workflow.primaryTriggerFamily),
                  },
                  {
                    label: "Version",
                    value: workflow.currentVersionNumber ?? "—",
                  },
                  { label: "Visibility", value: titleize(workflow.visibility) },
                  {
                    label: "Updated",
                    value: formatDateTime(workflow.updatedAt),
                  },
                ]}
              />
            </InfoCard>
            <InfoCard title="Source">
              <DefinitionList
                items={[
                  { label: "Engine", value: sourceLabel(binding) },
                  { label: "Binding", value: titleize(binding?.bindingType) },
                  { label: "Status", value: titleize(binding?.bindingStatus) },
                  {
                    label: "External",
                    value:
                      binding?.externalWorkflowName ??
                      binding?.externalWorkflowId ??
                      "—",
                  },
                ]}
              />
              <SourceLinks binding={binding} />
            </InfoCard>
            <InfoCard title="Triggers">
              {workflow.triggers.length ? (
                <div className="grid gap-2">
                  {workflow.triggers.map((trigger) => (
                    <div
                      key={trigger.id}
                      className="rounded-md border border-border/70 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="outline" className="text-xs">
                          {titleize(trigger.triggerFamily)}
                        </Badge>
                        <StatusBadge
                          status={trigger.enabled ? "active" : "archived"}
                          size="sm"
                        />
                      </div>
                      <p className="mt-2 truncate text-xs text-muted-foreground">
                        {trigger.sourceSystem ?? "ThinkWork"}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No triggers have been attached yet.
                </p>
              )}
            </InfoCard>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this workflow?</AlertDialogTitle>
            <AlertDialogDescription>
              {workflow.name} and its ThinkWork workflow records will be
              permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteState.fetching}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteState.fetching}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void deleteWorkflow();
              }}
            >
              Delete workflow
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <WorkflowFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initialWorkflow={{
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          trigger: {
            family: workflow.primaryTriggerFamily,
            scheduleExpression:
              typeof triggerConfig.scheduleExpression === "string"
                ? triggerConfig.scheduleExpression
                : null,
            timezone:
              typeof triggerConfig.timezone === "string"
                ? triggerConfig.timezone
                : null,
          },
        }}
        onSaved={(_workflow, webhookToken) => {
          refetch({ requestPolicy: "network-only" });
          if (!webhookToken) setEditOpen(false);
        }}
      />
    </div>
  );
}

function SourceLinks({ binding }: { binding: WorkflowBinding | null }) {
  if (!binding) return null;
  if (
    binding.bindingType === "n8n_bridge" ||
    binding.bindingType === "n8n_import"
  ) {
    return (
      <Link
        to="/settings/plugins/n8n/workflows"
        className="text-sm text-primary hover:underline"
      >
        Open n8n discovery
      </Link>
    );
  }
  if (binding.bindingType === "twenty_crm") {
    return (
      <Link to="/settings/crm" className="text-sm text-primary hover:underline">
        Open CRM readiness
      </Link>
    );
  }
  return null;
}
