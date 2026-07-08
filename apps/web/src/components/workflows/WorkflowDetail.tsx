import { Link, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  DataTable,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@thinkwork/ui";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { SettingsPageTitle } from "@/components/settings/SettingsContent";
import { StatusBadge } from "@/components/StatusBadge";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  DeleteWorkflowMutation,
  SettingsWorkflowQuery,
} from "@/lib/graphql-queries";
import { WorkflowDefinitionTab } from "./WorkflowDefinitionTab";
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
    createdAt: string;
    updatedAt: string;
  } | null;
};

export function WorkflowDetail({ workflowId }: { workflowId: string }) {
  const navigate = useNavigate();
  const [result, refetch] = useQuery<WorkflowDetailData>({
    query: SettingsWorkflowQuery,
    variables: { id: workflowId, runLimit: 25 },
    requestPolicy: "cache-and-network",
  });
  const [deleteState, deleteWorkflowMutation] = useMutation(
    DeleteWorkflowMutation,
  );
  const [editOpen, setEditOpen] = useState(false);

  const workflow = result.data?.workflow ?? null;
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

  usePageHeaderActions({
    title: workflow?.name ?? "Workflow",
    breadcrumbs: [
      { label: "Workflows", href: "/settings/workflows" },
      { label: workflow?.name ?? "Workflow" },
    ],
    actionKey: `workflow:${workflowId}:${workflow?.updatedAt ?? "loading"}`,
  });

  const runColumns = useMemo<ColumnDef<WorkflowRunSummary>[]>(
    () => [
      {
        accessorKey: "status",
        header: "Status",
        size: 130,
        cell: ({ row }) => (
          <StatusBadge status={row.original.status.toLowerCase()} size="sm" />
        ),
      },
      {
        accessorKey: "triggerFamily",
        header: "Trigger",
        size: 120,
        cell: ({ row }) => (
          <Badge variant="outline" className="text-xs">
            {titleize(row.original.triggerFamily)}
          </Badge>
        ),
      },
      {
        accessorKey: "triggerSource",
        header: "Source",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.triggerSource ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "startedAt",
        header: "Started",
        size: 170,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {formatDateTime(row.original.startedAt)}
          </span>
        ),
      },
      {
        id: "duration",
        header: "Duration",
        size: 110,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {formatDuration(row.original.startedAt, row.original.finishedAt)}
          </span>
        ),
      },
    ],
    [],
  );

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
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden p-6">
      <SettingsPageTitle
        title={workflow.name}
        badge={<SourceBadge binding={binding} />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEditOpen(true)}
            >
              Edit
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={deleteState.fetching}
                >
                  Delete
                </Button>
              </AlertDialogTrigger>
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
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => refetch({ requestPolicy: "network-only" })}
            >
              Refresh
            </Button>
          </div>
        }
      />
      <Tabs
        defaultValue="overview"
        className="flex min-h-0 flex-1 flex-col gap-4"
      >
        <TabsList variant="line" className="w-full justify-start border-b">
          <TabsTrigger value="overview" className="flex-none px-3">
            Overview
          </TabsTrigger>
          <TabsTrigger value="runs" className="flex-none px-3">
            Runs
          </TabsTrigger>
          <TabsTrigger value="definition" className="flex-none px-3">
            Definition
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="overview"
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
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
                    ? [
                        {
                          label: "Readiness details",
                          value: readinessReason,
                        },
                      ]
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
            <InfoCard title="Triggers" className="xl:col-span-2">
              {workflow.triggers.length ? (
                <div className="grid gap-2 md:grid-cols-2">
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
        </TabsContent>

        <TabsContent value="runs" className="min-h-0 flex-1 overflow-y-auto">
          <DataTable
            columns={runColumns}
            data={workflow.runs}
            filterValue=""
            filterColumn="status"
            scrollable
            allowHorizontalScroll
            pageSize={25}
            tableClassName="table-fixed"
            onRowClick={(row) =>
              navigate({
                to: "/settings/workflows/$workflowId/runs/$runId",
                params: { workflowId: workflow.id, runId: row.id },
              })
            }
            emptyState={
              <div className="py-10 text-center text-sm text-muted-foreground">
                This workflow has not recorded any runs yet.
              </div>
            }
          />
        </TabsContent>

        <TabsContent value="definition" className="min-h-0 flex-1">
          <WorkflowDefinitionTab
            definition={workflow.currentVersion?.definitionSnapshot}
            version={workflow.currentVersion ?? null}
            capabilities={
              workflow.currentVersion?.capabilitySnapshot ??
              workflow.capabilityFlags
            }
          />
        </TabsContent>
      </Tabs>
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
          definition: workflow.currentVersion?.definitionSnapshot,
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
