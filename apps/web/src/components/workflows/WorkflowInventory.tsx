import { useCallback, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useQuery } from "urql";
import {
  Badge,
  Button,
  cn,
  DataTable,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@thinkwork/ui";
import { Search } from "lucide-react";
import { useTenant } from "@/context/TenantContext";
import { SettingsWorkflowsQuery } from "@/lib/graphql-queries";
import {
  SettingsDeploymentStatusQuery,
  SettingsPluginCatalogQuery,
} from "@/lib/settings-queries";
import { SettingsTablePane } from "@/components/settings/SettingsContent";
import { N8nPluginWorkflows } from "@/components/settings/plugins/n8n/N8nPluginWorkflows";
import {
  primaryBinding,
  sourceLabel,
  SourceBadge,
  titleize,
  type WorkflowBinding,
  WorkflowReadinessBadge,
} from "./workflow-ui";

type WorkflowRow = {
  id: string;
  name: string;
  description?: string | null;
  lifecycleStatus: string;
  primaryTriggerFamily: string;
  currentVersionNumber?: number | null;
  readinessState: string;
  readinessReasons?: unknown;
  bindings: WorkflowBinding[];
  triggers: Array<{
    id: string;
    triggerFamily: string;
    sourceSystem?: string | null;
    triggerConfig?: unknown;
    enabled: boolean;
    readinessState: string;
  }>;
  updatedAt?: string | null;
};

type WorkflowsData = {
  workflows: WorkflowRow[];
};

const ALL = "all";
const N8N_WORKFLOWS_PATH = "/settings/plugins/n8n/workflows";

function bindingFilterValue(row: WorkflowRow): string {
  return primaryBinding(row.bindings)?.bindingType ?? "unknown";
}

function rowMatchesSearch(row: WorkflowRow, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [
    row.name,
    row.description ?? "",
    row.primaryTriggerFamily,
    workflowTriggerLabel(row),
    sourceLabel(primaryBinding(row.bindings)),
    row.lifecycleStatus,
    row.readinessState,
  ]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function uniqueOptions(
  rows: WorkflowRow[],
  getValue: (row: WorkflowRow) => string,
) {
  return Array.from(new Set(rows.map(getValue).filter(Boolean))).sort();
}

export function WorkflowInventory() {
  const { tenantId } = useTenant();
  const [search, setSearch] = useState("");
  const [binding, setBinding] = useState(ALL);
  const [trigger, setTrigger] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const ignoreDiscoveryState = useCallback(() => {}, []);

  const [result] = useQuery<WorkflowsData>({
    query: SettingsWorkflowsQuery,
    variables: { tenantId: tenantId ?? "", limit: 100 },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [catalogResult] = useQuery({
    query: SettingsPluginCatalogQuery,
    requestPolicy: "cache-and-network",
  });
  const [deploymentResult] = useQuery({
    query: SettingsDeploymentStatusQuery,
    requestPolicy: "cache-and-network",
  });

  const rows = useMemo(
    () => result.data?.workflows ?? [],
    [result.data?.workflows],
  );
  const n8nCatalogEntry =
    (catalogResult.data?.pluginCatalog ?? []).find(
      (candidate) => candidate.pluginKey === "n8n",
    ) ?? null;
  const n8nInstall = n8nCatalogEntry?.install ?? null;
  const n8nRuntime =
    deploymentResult.data?.deploymentStatus.managedApplications.find(
      (candidate) => candidate.key === "n8n",
    );
  const n8nLaunchUrl = n8nRuntime?.url ?? n8nCatalogEntry?.launchUrl ?? null;
  const canDiscoverN8n = Boolean(n8nInstall);
  const filteredRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          rowMatchesSearch(row, search) &&
          (binding === ALL || bindingFilterValue(row) === binding) &&
          (trigger === ALL || workflowTriggerLabel(row) === trigger) &&
          (status === ALL || row.readinessState === status),
      ),
    [binding, rows, search, status, trigger],
  );

  const columns = useMemo<ColumnDef<WorkflowRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Workflow",
        meta: {
          headClassName: "w-full min-w-[200px]",
          cellClassName: "w-full min-w-[200px] max-w-0",
        },
        cell: ({ row }) => (
          <Link
            to="/settings/workflows/$workflowId"
            params={{ workflowId: row.original.id }}
            className="block truncate font-medium text-foreground transition-colors hover:text-primary"
            title={row.original.name}
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: "status",
        header: "Status",
        meta: {
          headClassName: "w-px whitespace-nowrap",
          cellClassName: "w-px whitespace-nowrap",
        },
        cell: ({ row }) => (
          <WorkflowReadinessBadge
            state={row.original.readinessState}
            reasons={row.original.readinessReasons}
          />
        ),
      },
      {
        id: "source",
        header: "Source",
        meta: {
          headClassName: "w-px whitespace-nowrap text-center",
          cellClassName: "w-px whitespace-nowrap text-center",
        },
        cell: ({ row }) => {
          const binding = primaryBinding(row.original.bindings);
          const sourceLink = sourceLinkForBinding(n8nLaunchUrl, binding);
          const badge = <SourceBadge binding={binding} />;
          return sourceLink ? (
            <a
              href={sourceLink.href}
              target={sourceLink.external ? "_blank" : undefined}
              rel={sourceLink.external ? "noreferrer" : undefined}
              className="inline-flex transition-opacity hover:opacity-80"
              title={sourceLink.title}
            >
              {badge}
            </a>
          ) : (
            badge
          );
        },
      },
      {
        accessorKey: "primaryTriggerFamily",
        header: "Trigger",
        meta: {
          headClassName: "w-px whitespace-nowrap text-center",
          cellClassName: "w-px whitespace-nowrap text-center",
        },
        cell: ({ row }) => (
          <Badge variant="outline" className="text-xs">
            {workflowTriggerLabel(row.original)}
          </Badge>
        ),
      },
    ],
    [n8nLaunchUrl],
  );

  const loading = result.fetching && !result.data;
  const hasFilters =
    search.trim() !== "" ||
    binding !== ALL ||
    trigger !== ALL ||
    status !== ALL;

  return (
    <SettingsTablePane
      title="Workflows"
      description="Monitor workflows imported from routines, plugins, connected apps, and native ThinkWork sources."
      loading={loading}
      headerActions={
        canDiscoverN8n ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Discover n8n workflows"
            title="Discover n8n workflows"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setDiscoveryOpen(true)}
          >
            <Search className="size-4" />
          </Button>
        ) : null
      }
      headerActionKey={`workflow-discovery:${n8nInstall?.id ?? "missing"}`}
      toolbar={
        <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto pb-1">
          <Input
            placeholder="Search workflows..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-9 w-56 shrink-0"
          />
          <FilterSelect
            label="Status"
            value={status}
            values={uniqueOptions(rows, (row) => row.readinessState)}
            onChange={setStatus}
          />
          <FilterSelect
            label="Source"
            value={binding}
            values={uniqueOptions(rows, bindingFilterValue)}
            labelFor={(value) => sourceLabel({ id: value, bindingType: value })}
            onChange={setBinding}
          />
          <FilterSelect
            label="Trigger"
            value={trigger}
            values={uniqueOptions(rows, workflowTriggerLabel)}
            onChange={setTrigger}
          />
        </div>
      }
    >
      {result.error ? (
        <div className="rounded-md border border-destructive/30 p-4 text-sm text-destructive">
          {result.error.message}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={filteredRows}
          filterValue=""
          filterColumn="name"
          scrollable
          allowHorizontalScroll={false}
          pageSize={25}
          tableClassName="w-full table-auto"
          emptyState={
            <div className="py-10 text-center text-sm text-muted-foreground">
              {rows.length === 0
                ? "No workflows have been imported yet."
                : hasFilters
                  ? "No workflows match the current filters."
                  : "No workflows to show."}
            </div>
          }
        />
      )}
      <Sheet open={discoveryOpen} onOpenChange={setDiscoveryOpen}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto data-[side=right]:w-[min(900px,calc(100vw-2rem))] data-[side=right]:sm:max-w-none">
          <SheetHeader className="border-b border-border px-6 py-5">
            <SheetTitle>Discover n8n workflows</SheetTitle>
            <SheetDescription>
              Search available n8n workflows and connect them to ThinkWork.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 p-6">
            <N8nPluginWorkflows
              installId={n8nInstall?.id ?? null}
              launchUrl={n8nLaunchUrl}
              refreshNonce={0}
              onDiscoveryStateChange={ignoreDiscoveryState}
            />
          </div>
        </SheetContent>
      </Sheet>
    </SettingsTablePane>
  );
}

function sourceLinkForBinding(
  launchUrl: string | null,
  binding: WorkflowBinding | null,
): { href: string; external: boolean; title: string } | null {
  if (!isN8nBinding(binding)) {
    return null;
  }

  if (launchUrl && binding.externalWorkflowId) {
    try {
      return {
        href: new URL(
          `/workflow/${encodeURIComponent(binding.externalWorkflowId)}`,
          new URL(launchUrl).origin,
        ).toString(),
        external: true,
        title: "Open n8n workflow",
      };
    } catch {
      // Fall through to the in-app n8n workflow inventory.
    }
  }

  return {
    href: N8N_WORKFLOWS_PATH,
    external: false,
    title: "Open n8n workflows",
  };
}

function isN8nBinding(
  binding: WorkflowBinding | null,
): binding is WorkflowBinding {
  return (
    binding?.bindingType === "n8n_bridge" ||
    binding?.bindingType === "n8n_import"
  );
}

function workflowTriggerLabel(row: WorkflowRow): string {
  const bindingType = primaryBinding(row.bindings)?.bindingType;
  if (bindingType === "n8n_bridge" || bindingType === "n8n_import") {
    const triggerTypes = row.triggers.flatMap((trigger) =>
      stringArrayFromUnknown(
        recordFromUnknown(trigger.triggerConfig).triggerTypes,
      ),
    );
    if (triggerTypes.length) {
      return Array.from(new Set(triggerTypes.map(titleize))).join(", ");
    }
  }
  return titleize(row.primaryTriggerFamily);
}

function stringArrayFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function FilterSelect({
  label,
  value,
  values,
  labelFor = titleize,
  onChange,
  className,
}: {
  label: string;
  value: string;
  values: string[];
  labelFor?: (value: string) => string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        className={cn("h-9 w-auto min-w-24 shrink-0 gap-2 px-3", className)}
      >
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}</SelectItem>
        {values.map((item) => (
          <SelectItem key={item} value={item}>
            {labelFor(item)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
