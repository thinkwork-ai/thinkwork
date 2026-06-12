// Eval datasets list (Trust Core U11 — surfaces over the U4 substrate).
// Datasets are versioned per-tenant S3 artifacts; this lists the derived
// index: baseline (seeded red-team suite) vs custom (operator-curated,
// incl. flagged threads), version, case counts, archived state.

import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { type ColumnDef } from "@tanstack/react-table";
import { Archive, Loader2, Pencil, Play, Plus } from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import {
  ArchiveEvalDatasetMutation,
  CreateEvalDatasetMutation,
  EvalDatasetCaseIndexQuery,
  EvalDatasetsQuery,
  StartEvalRunMutation,
  UpdateEvalDatasetMutation,
} from "@/lib/evaluation-queries";
import { cn, relativeTime } from "@/lib/utils";
import {
  desktopToolbarButtonClassName,
  desktopToolbarGapClassName,
} from "@/lib/desktop-chrome";

export interface EvalDatasetRow {
  id: string;
  slug: string;
  name: string | null;
  kind: string;
  version: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors the server's slug rule (^[a-z][a-z0-9-]{0,63}$). */
export const EVAL_DATASET_SLUG_RE = /^[a-z][a-z0-9-]{0,63}$/;

export function isValidEvalDatasetSlug(slug: string): boolean {
  return EVAL_DATASET_SLUG_RE.test(slug);
}

/** Client-side slug suggestion from a human dataset name. */
export function suggestEvalDatasetSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  if (!base) return "";
  return /^[a-z]/.test(base) ? base : `ds-${base}`;
}

/**
 * Case counts per dataset from one index read (no N+1): total index
 * rows and enabled rows. Tombstoned (removed) cases stay as disabled
 * index rows, so `enabled` is the live-case signal.
 */
export function evalDatasetCaseCounts(
  rows: Array<{ datasetId?: string | null; enabled?: boolean | null }>,
): Map<string, { total: number; enabled: number }> {
  const counts = new Map<string, { total: number; enabled: number }>();
  for (const row of rows) {
    if (!row.datasetId) continue;
    const current = counts.get(row.datasetId) ?? { total: 0, enabled: 0 };
    current.total += 1;
    if (row.enabled) current.enabled += 1;
    counts.set(row.datasetId, current);
  }
  return counts;
}

export function evalDatasetKindBadgeVariant(
  kind: string,
): "secondary" | "outline" {
  return kind === "baseline" ? "secondary" : "outline";
}

export function SettingsEvalDatasets() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [renaming, setRenaming] = useState<EvalDatasetRow | null>(null);
  const [archiving, setArchiving] = useState<EvalDatasetRow | null>(null);

  const [datasetsResult, refetchDatasets] = useQuery({
    query: EvalDatasetsQuery,
    variables: { tenantId: tenantId ?? "", includeArchived: true },
    pause: !tenantId,
  });
  const [caseIndexResult, refetchCaseIndex] = useQuery({
    query: EvalDatasetCaseIndexQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });

  const [, archiveDataset] = useMutation(ArchiveEvalDatasetMutation);
  const [{ fetching: starting }, startEvalRun] =
    useMutation(StartEvalRunMutation);

  // urql's document cache doesn't invalidate across operations —
  // refetch explicitly after every mutation.
  const refetchAll = () => {
    refetchDatasets({ requestPolicy: "network-only" });
    refetchCaseIndex({ requestPolicy: "network-only" });
  };

  const datasets = (datasetsResult.data?.evalDatasets ??
    []) as EvalDatasetRow[];
  const caseCounts = useMemo(
    () => evalDatasetCaseCounts(caseIndexResult.data?.evalTestCases ?? []),
    [caseIndexResult.data],
  );

  const handleRunDataset = async (dataset: EvalDatasetRow) => {
    const res = await startEvalRun({
      tenantId: tenantId ?? "",
      input: { datasetSlug: dataset.slug },
    });
    if (res.error) {
      toast.error(`Run failed: ${res.error.message}`);
      return;
    }
    toast.success(`Evaluation started for ${dataset.name ?? dataset.slug}.`);
    navigate({ to: "/settings/evaluations" });
  };

  const handleArchive = async () => {
    if (!archiving) return;
    const res = await archiveDataset({
      tenantId: tenantId ?? "",
      slug: archiving.slug,
    });
    if (res.error) {
      toast.error(`Archive failed: ${res.error.message}`);
    } else {
      toast.success(`Archived ${archiving.name ?? archiving.slug}.`);
      refetchAll();
    }
    setArchiving(null);
  };

  const columns = useMemo<ColumnDef<EvalDatasetRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <Link
            to="/settings/evaluations/datasets/$slug"
            params={{ slug: row.original.slug }}
            className="block truncate text-sm font-medium hover:underline"
            title={row.original.name ?? row.original.slug}
          >
            {row.original.name ?? row.original.slug}
          </Link>
        ),
      },
      {
        accessorKey: "slug",
        header: "Slug",
        size: 200,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground font-mono truncate block">
            {row.original.slug}
          </span>
        ),
      },
      {
        accessorKey: "kind",
        header: "Kind",
        size: 100,
        cell: ({ row }) => (
          <Badge
            variant={evalDatasetKindBadgeVariant(row.original.kind)}
            className="text-xs"
          >
            {row.original.kind}
          </Badge>
        ),
      },
      {
        accessorKey: "version",
        header: "Version",
        size: 80,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground tabular-nums">
            v{row.original.version}
          </span>
        ),
      },
      {
        id: "cases",
        header: "Cases",
        size: 110,
        cell: ({ row }) => {
          const counts = caseCounts.get(row.original.id);
          if (!counts)
            return <span className="text-xs text-muted-foreground">—</span>;
          return (
            <span className="text-xs text-muted-foreground tabular-nums">
              {counts.enabled}
              {counts.enabled !== counts.total && (
                <span className="opacity-70"> of {counts.total}</span>
              )}
            </span>
          );
        },
      },
      {
        accessorKey: "archivedAt",
        header: "State",
        size: 90,
        cell: ({ row }) =>
          row.original.archivedAt ? (
            <Badge variant="outline" className="text-muted-foreground text-xs">
              archived
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-xs">
              active
            </Badge>
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
        size: 130,
        cell: ({ row }) => (
          <div
            className="flex items-center justify-end gap-1"
            onClick={(event) => event.stopPropagation()}
          >
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              title="Run this dataset"
              aria-label={`Run dataset ${row.original.slug}`}
              disabled={starting || Boolean(row.original.archivedAt)}
              onClick={() => void handleRunDataset(row.original)}
            >
              <Play className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              title="Rename dataset"
              aria-label={`Rename dataset ${row.original.slug}`}
              onClick={() => setRenaming(row.original)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            {!row.original.archivedAt && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                title="Archive dataset"
                aria-label={`Archive dataset ${row.original.slug}`}
                onClick={() => setArchiving(row.original)}
              >
                <Archive className="h-4 w-4" />
              </Button>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [caseCounts, starting, tenantId],
  );

  usePageHeaderActions({
    title: "Eval Datasets",
    breadcrumbs: [
      { label: "Evaluations", href: "/settings/evaluations" },
      { label: "Datasets" },
    ],
    action: tenantId ? (
      <div className={cn("flex items-center", desktopToolbarGapClassName)}>
        <Button
          variant="ghost"
          size="icon-sm"
          title="New dataset"
          aria-label="New dataset"
          className={desktopToolbarButtonClassName}
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="size-4" />
        </Button>
      </div>
    ) : undefined,
    actionKey: `eval-datasets:${tenantId ?? ""}`,
  });

  if (!tenantId) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingShimmer />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <div className="min-h-0 flex-1">
        {datasetsResult.fetching && !datasetsResult.data ? (
          <div className="flex h-full items-center justify-center">
            <LoadingShimmer />
          </div>
        ) : datasets.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No datasets yet. The baseline red-team suite is seeded on first
            Studio visit; flag a thread or create a dataset to curate your own.
          </p>
        ) : (
          <DataTable
            columns={columns}
            data={datasets}
            pageSize={25}
            tableClassName="table-fixed"
            scrollable
            onRowClick={(dataset) =>
              navigate({
                to: "/settings/evaluations/datasets/$slug",
                params: { slug: dataset.slug },
              })
            }
          />
        )}
      </div>

      <CreateEvalDatasetDialog
        tenantId={tenantId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(slug) => {
          refetchAll();
          navigate({
            to: "/settings/evaluations/datasets/$slug",
            params: { slug },
          });
        }}
      />

      <RenameEvalDatasetDialog
        tenantId={tenantId}
        dataset={renaming}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        onRenamed={refetchAll}
      />

      <AlertDialog
        open={!!archiving}
        onOpenChange={(open) => {
          if (!open) setArchiving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive dataset</AlertDialogTitle>
            <AlertDialogDescription>
              Archive &quot;{archiving?.name ?? archiving?.slug}&quot;? The
              dataset hides from default listings and can no longer launch runs;
              its cases and historical run results stay intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleArchive}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreateEvalDatasetDialog({
  tenantId,
  open,
  onOpenChange,
  onCreated,
}: {
  tenantId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (slug: string) => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [{ fetching: creating }, createDataset] = useMutation(
    CreateEvalDatasetMutation,
  );

  const effectiveSlug = slugTouched ? slug : suggestEvalDatasetSlug(name);
  const slugValid = isValidEvalDatasetSlug(effectiveSlug);

  const reset = () => {
    setName("");
    setSlug("");
    setSlugTouched(false);
  };

  const handleCreate = async () => {
    if (!slugValid) return;
    const res = await createDataset({
      tenantId,
      input: {
        slug: effectiveSlug,
        name: name.trim() || null,
        kind: "custom",
      },
    });
    if (res.error) {
      toast.error(`Create failed: ${res.error.message}`);
      return;
    }
    toast.success(`Created dataset ${name.trim() || effectiveSlug}.`);
    onOpenChange(false);
    reset();
    onCreated(effectiveSlug);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New dataset</DialogTitle>
          <DialogDescription>
            A custom dataset is a versioned S3 artifact you curate — add cases
            by hand or flag bad threads into it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="eval-dataset-name">Name</Label>
            <Input
              id="eval-dataset-name"
              value={name}
              placeholder="Billing regressions"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="eval-dataset-slug">Slug</Label>
            <Input
              id="eval-dataset-slug"
              value={effectiveSlug}
              placeholder="billing-regressions"
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(event.target.value);
              }}
            />
            {effectiveSlug && !slugValid && (
              <p className="text-xs text-destructive">
                Lowercase letters, digits and hyphens; must start with a letter
                (max 64 chars).
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={creating || !slugValid}>
            {creating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Create dataset"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameEvalDatasetDialog({
  tenantId,
  dataset,
  onOpenChange,
  onRenamed,
}: {
  tenantId: string;
  dataset: EvalDatasetRow | null;
  onOpenChange: (open: boolean) => void;
  onRenamed: () => void;
}) {
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [{ fetching: saving }, updateDataset] = useMutation(
    UpdateEvalDatasetMutation,
  );

  // Seed the input when a (different) dataset opens.
  if (dataset && editingId !== dataset.id) {
    setEditingId(dataset.id);
    setName(dataset.name ?? dataset.slug);
  }

  const handleSave = async () => {
    if (!dataset || !name.trim()) return;
    const res = await updateDataset({
      tenantId,
      slug: dataset.slug,
      input: { name: name.trim() },
    });
    if (res.error) {
      toast.error(`Rename failed: ${res.error.message}`);
      return;
    }
    toast.success("Dataset renamed.");
    onOpenChange(false);
    setEditingId(null);
    onRenamed();
  };

  return (
    <Dialog
      open={!!dataset}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setEditingId(null);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rename dataset</DialogTitle>
          <DialogDescription>
            The slug ({dataset?.slug}) is the dataset&apos;s S3 identity and
            does not change.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="eval-dataset-rename">Name</Label>
          <Input
            id="eval-dataset-rename"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
