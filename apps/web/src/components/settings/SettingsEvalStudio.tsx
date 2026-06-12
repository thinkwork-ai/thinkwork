import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { Database, Download, Loader2, Plus, Trash2 } from "lucide-react";
import { type ColumnDef } from "@tanstack/react-table";
import { Badge, Button, DataTable, Input } from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import {
  DeleteEvalTestCaseMutation,
  EvalTestCasesQuery,
  SeedEvalTestCasesMutation,
} from "@/lib/evaluation-queries";
import { cn, relativeTime } from "@/lib/utils";
import {
  desktopToolbarButtonClassName,
  desktopToolbarGapClassName,
} from "@/lib/desktop-chrome";

export interface EvalStudioTestCaseRow {
  id: string;
  name: string;
  category: string | null;
  agentcoreEvaluatorIds?: string[] | null;
  assertions?: string | null;
  enabled?: boolean | null;
  updatedAt: string;
}

function normalizedCategory(category: string | null | undefined) {
  const value = category?.trim();
  return value && value.length > 0 ? value : null;
}

export function evalStudioCategories(items: EvalStudioTestCaseRow[]) {
  return Array.from(
    new Set(
      items
        .map((item) => normalizedCategory(item.category))
        .filter((category): category is string => Boolean(category)),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

export function filterEvalStudioItems(
  items: EvalStudioTestCaseRow[],
  category: string | null,
) {
  if (!category) return items;
  return items.filter((item) => normalizedCategory(item.category) === category);
}

export function assertionCount(assertions: string | null | undefined) {
  if (!assertions) return 0;
  try {
    const parsed = JSON.parse(assertions);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export function SettingsEvalStudio() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const [cases, refetch] = useQuery({
    query: EvalTestCasesQuery,
    variables: { tenantId: tenantId ?? "", search: search || null },
    pause: !tenantId,
  });
  const [, deleteCase] = useMutation(DeleteEvalTestCaseMutation);
  const [seedState, seedCases] = useMutation(SeedEvalTestCasesMutation);

  const items = (cases.data?.evalTestCases ??
    []) as unknown as EvalStudioTestCaseRow[];
  const categories = useMemo(() => evalStudioCategories(items), [items]);
  const filteredItems = useMemo(
    () => filterEvalStudioItems(items, categoryFilter),
    [items, categoryFilter],
  );

  const columns = useMemo<ColumnDef<EvalStudioTestCaseRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <Link
            to="/settings/evaluations/studio/$testCaseId"
            params={{ testCaseId: row.original.id }}
            className="block truncate text-sm font-medium hover:underline"
            title={row.original.name}
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "category",
        header: "Category",
        size: 220,
        cell: ({ row }) =>
          row.original.category ? (
            <Badge variant="outline" className="max-w-full truncate text-xs">
              {row.original.category}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "agentcoreEvaluatorIds",
        header: "Evaluators",
        size: 100,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground tabular-nums">
            {row.original.agentcoreEvaluatorIds?.length ?? 0}
          </span>
        ),
      },
      {
        accessorKey: "assertions",
        header: "Assertions",
        size: 100,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground tabular-nums">
            {assertionCount(row.original.assertions)}
          </span>
        ),
      },
      {
        accessorKey: "enabled",
        header: "Enabled",
        size: 90,
        cell: ({ row }) => (
          <Badge variant={row.original.enabled ? "default" : "secondary"}>
            {row.original.enabled ? "on" : "off"}
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
        size: 52,
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={async (event) => {
              event.stopPropagation();
              if (!confirm(`Delete "${row.original.name}"?`)) return;
              await deleteCase({ id: row.original.id });
              refetch({ requestPolicy: "network-only" });
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ),
      },
    ],
    [deleteCase, refetch],
  );

  usePageHeaderActions({
    title: "Evaluation Studio",
    breadcrumbs: [
      { label: "Evaluations", href: "/settings/evaluations" },
      { label: "Studio" },
    ],
    action: tenantId ? (
      <div className={cn("flex items-center", desktopToolbarGapClassName)}>
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          title="Datasets"
          aria-label="Datasets"
          className={desktopToolbarButtonClassName}
        >
          <Link to="/settings/evaluations/datasets">
            <Database className="size-4" />
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Import starter pack"
          aria-label="Import starter pack"
          className={desktopToolbarButtonClassName}
          disabled={seedState.fetching}
          onClick={async () => {
            if (
              !confirm(
                "Import the Thinkwork RedTeam starter pack? 189 test cases across 4 categories. Re-runs are safe (skips already-imported names).",
              )
            )
              return;
            const res = await seedCases({ tenantId });
            refetch({ requestPolicy: "network-only" });
            if (res.error) {
              alert(
                `Import failed: ${res.error.message}\n\nThis usually means the seedEvalTestCases mutation hasn't been deployed yet — check the latest deploy on main.`,
              );
            } else if (res.data?.seedEvalTestCases === undefined) {
              alert(
                "Import returned no data — the deployed graphql-http likely doesn't expose seedEvalTestCases yet. Wait for the next deploy.",
              );
            } else {
              alert(`Imported ${res.data.seedEvalTestCases} new test case(s).`);
            }
          }}
        >
          {seedState.fetching ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
        </Button>
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          title="New test case"
          aria-label="New test case"
          className={desktopToolbarButtonClassName}
        >
          <Link to="/settings/evaluations/studio/new">
            <Plus className="size-4" />
          </Link>
        </Button>
      </div>
    ) : undefined,
    actionKey: `eval-studio:${tenantId ?? ""}:${seedState.fetching}`,
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
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge
            variant={categoryFilter === null ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setCategoryFilter(null)}
          >
            All {items.length}
          </Badge>
          {categories.map((category) => {
            const count = items.filter(
              (item) => normalizedCategory(item.category) === category,
            ).length;
            return (
              <Badge
                key={category}
                variant={categoryFilter === category ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() =>
                  setCategoryFilter((current) =>
                    current === category ? null : category,
                  )
                }
              >
                {category} {count}
              </Badge>
            );
          })}
        </div>
        <Input
          placeholder="Search by name…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setCategoryFilter(null);
          }}
          className="h-9 w-full max-w-sm md:ml-auto"
        />
      </div>
      <div className="min-h-0 flex-1">
        {cases.fetching && !cases.data ? (
          <div className="flex h-full items-center justify-center">
            <LoadingShimmer />
          </div>
        ) : (
          <DataTable
            key={`${search}:${categoryFilter ?? "all"}`}
            columns={columns}
            data={filteredItems}
            pageSize={25}
            tableClassName="table-fixed"
            scrollable
          />
        )}
      </div>
    </div>
  );
}
