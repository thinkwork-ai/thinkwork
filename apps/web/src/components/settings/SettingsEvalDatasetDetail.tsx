// Eval dataset detail (Trust Core U11): the case list of one dataset
// from the derived index (evalTestCases datasetId filter), with
// per-case enable/disable, removal (S3 payload deletion), flagged-thread
// provenance, and a run-this-dataset launcher.

import { useNavigate, useParams } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { Flag, Loader2, Play, Trash2 } from "lucide-react";
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
  Badge,
  Button,
  DataTable,
  Switch,
} from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import {
  EvalDatasetCasesQuery,
  EvalDatasetQuery,
  RemoveEvalDatasetCaseMutation,
  StartEvalRunMutation,
  UpdateEvalDatasetCaseMutation,
} from "@/lib/evaluation-queries";
import { relativeTime } from "@/lib/utils";
import { evalDatasetKindBadgeVariant } from "@/components/settings/SettingsEvalDatasets";

export interface EvalDatasetCaseRow {
  id: string;
  name: string;
  category: string;
  tags: string[];
  enabled: boolean;
  source: string;
  datasetId: string | null;
  datasetCaseId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const FLAGGED_THREAD_CATEGORY = "flagged-thread";

export function isFlaggedThreadCase(
  row: Pick<EvalDatasetCaseRow, "category">,
): boolean {
  return row.category === FLAGGED_THREAD_CATEGORY;
}

/** The flag dialog tags flagged cases with their outcome kind. */
export function flaggedCaseOutcomeKind(
  row: Pick<EvalDatasetCaseRow, "tags">,
): string | null {
  if (row.tags.includes("security")) return "security";
  if (row.tags.includes("quality")) return "quality";
  return null;
}

export function SettingsEvalDatasetDetail() {
  const { slug } = useParams({
    from: "/_authed/settings/evaluations/datasets/$slug",
  });
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [removing, setRemoving] = useState<EvalDatasetCaseRow | null>(null);

  const [datasetResult, refetchDataset] = useQuery({
    query: EvalDatasetQuery,
    variables: { tenantId: tenantId ?? "", slug },
    pause: !tenantId,
  });
  const dataset = datasetResult.data?.evalDataset;

  const [casesResult, refetchCases] = useQuery({
    query: EvalDatasetCasesQuery,
    variables: { tenantId: tenantId ?? "", datasetId: dataset?.id ?? "" },
    pause: !tenantId || !dataset?.id,
  });

  const [, updateCase] = useMutation(UpdateEvalDatasetCaseMutation);
  const [, removeCase] = useMutation(RemoveEvalDatasetCaseMutation);
  const [{ fetching: starting }, startEvalRun] =
    useMutation(StartEvalRunMutation);

  // urql doc cache: refetch explicitly after mutations.
  const refetchAll = () => {
    refetchDataset({ requestPolicy: "network-only" });
    refetchCases({ requestPolicy: "network-only" });
  };

  const cases = (casesResult.data?.evalTestCases ?? []) as EvalDatasetCaseRow[];

  const handleToggleEnabled = async (row: EvalDatasetCaseRow) => {
    if (!row.datasetCaseId) return;
    const res = await updateCase({
      tenantId: tenantId ?? "",
      datasetSlug: slug,
      caseId: row.datasetCaseId,
      input: { enabled: !row.enabled },
    });
    if (res.error) {
      toast.error(`Update failed: ${res.error.message}`);
    } else {
      refetchAll();
    }
  };

  const handleRemove = async () => {
    if (!removing?.datasetCaseId) return;
    const res = await removeCase({
      tenantId: tenantId ?? "",
      datasetSlug: slug,
      caseId: removing.datasetCaseId,
    });
    if (res.error) {
      toast.error(`Remove failed: ${res.error.message}`);
    } else {
      toast.success(`Removed ${removing.name}.`);
      refetchAll();
    }
    setRemoving(null);
  };

  const handleRun = async () => {
    const res = await startEvalRun({
      tenantId: tenantId ?? "",
      input: { datasetSlug: slug },
    });
    if (res.error) {
      toast.error(`Run failed: ${res.error.message}`);
      return;
    }
    toast.success(`Evaluation started for ${dataset?.name ?? slug}.`);
    navigate({ to: "/settings/evaluations" });
  };

  const columns = useMemo<ColumnDef<EvalDatasetCaseRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Case",
        cell: ({ row }) => (
          <p className="truncate text-sm font-medium" title={row.original.name}>
            {row.original.name}
          </p>
        ),
      },
      {
        accessorKey: "category",
        header: "Category",
        size: 180,
        cell: ({ row }) => (
          <Badge variant="outline" className="max-w-full truncate text-xs">
            {row.original.category}
          </Badge>
        ),
      },
      {
        id: "provenance",
        header: "Provenance",
        size: 160,
        cell: ({ row }) => {
          if (!isFlaggedThreadCase(row.original)) {
            return (
              <span className="text-xs text-muted-foreground">authored</span>
            );
          }
          const outcome = flaggedCaseOutcomeKind(row.original);
          return (
            <Badge
              variant="secondary"
              className="gap-1 bg-purple-500/15 text-purple-600 dark:text-purple-400 text-xs"
              title="Created by flagging a production thread; replays the recorded conversation against the current agent."
            >
              <Flag className="h-3 w-3" />
              flagged thread{outcome ? ` · ${outcome}` : ""}
            </Badge>
          );
        },
      },
      {
        accessorKey: "enabled",
        header: "Enabled",
        size: 90,
        cell: ({ row }) => (
          <div onClick={(event) => event.stopPropagation()}>
            <Switch
              checked={row.original.enabled}
              disabled={!row.original.datasetCaseId}
              aria-label={`Toggle ${row.original.name}`}
              onCheckedChange={() => void handleToggleEnabled(row.original)}
            />
          </div>
        ),
      },
      {
        accessorKey: "updatedAt",
        header: "Updated",
        size: 100,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {relativeTime(row.original.updatedAt)}
          </span>
        ),
      },
      {
        id: "actions",
        size: 52,
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            title="Remove case"
            aria-label={`Remove case ${row.original.name}`}
            disabled={!row.original.datasetCaseId}
            onClick={(event) => {
              event.stopPropagation();
              setRemoving(row.original);
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tenantId, slug],
  );

  usePageHeaderActions({
    title: dataset?.name ?? slug,
    breadcrumbs: [
      { label: "Evaluations", href: "/settings/evaluations" },
      { label: "Datasets", href: "/settings/evaluations/datasets" },
      { label: dataset?.name ?? slug },
    ],
    subtitle: dataset
      ? `${dataset.kind} · v${dataset.version} · ${cases.length} case${cases.length === 1 ? "" : "s"}`
      : undefined,
    action: dataset ? (
      <div className="flex items-center gap-2">
        <Badge
          variant={evalDatasetKindBadgeVariant(dataset.kind)}
          className="text-xs"
        >
          {dataset.kind}
        </Badge>
        {dataset.archivedAt && (
          <Badge variant="outline" className="text-muted-foreground text-xs">
            archived
          </Badge>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          title="Run this dataset"
          aria-label="Run this dataset"
          disabled={starting || Boolean(dataset.archivedAt)}
          onClick={() => void handleRun()}
        >
          {starting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
      </div>
    ) : undefined,
    actionKey: `eval-dataset:${slug}:${dataset?.version ?? ""}:${starting}`,
  });

  if (!tenantId || (datasetResult.fetching && !dataset)) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingShimmer />
      </div>
    );
  }
  if (!dataset) {
    return (
      <div className="w-full max-w-[750px] px-6 pb-10 pt-6">
        <p className="text-sm text-muted-foreground">Dataset not found.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <div className="min-h-0 flex-1">
        {casesResult.fetching && !casesResult.data ? (
          <div className="flex h-full items-center justify-center">
            <LoadingShimmer />
          </div>
        ) : cases.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No cases yet. Flag a thread into this dataset from a conversation,
            or author cases in the Studio.
          </p>
        ) : (
          <DataTable
            columns={columns}
            data={cases}
            pageSize={25}
            tableClassName="table-fixed"
            scrollable
          />
        )}
      </div>

      <AlertDialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove case</AlertDialogTitle>
            <AlertDialogDescription>
              Remove &quot;{removing?.name}&quot; from this dataset? The
              case&apos;s S3 payload (including any flagged-thread conversation
              snapshot) is permanently deleted. Historical run results that
              reference the case stay intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove case
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
