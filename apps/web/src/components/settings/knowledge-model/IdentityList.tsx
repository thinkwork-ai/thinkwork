import { useMemo, useState } from "react";
import { useQuery } from "urql";
import { ChevronDown, ChevronRight, Loader2, Search } from "lucide-react";
import {
  Badge,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@thinkwork/ui";
import type { SettingsCanonicalEntitiesQuery as SettingsCanonicalEntitiesData } from "@/gql/graphql";
import { SettingsCanonicalEntitiesQuery } from "@/lib/settings-queries";
import { useTenant } from "@/context/TenantContext";
import { MergeDialog } from "./MergeDialog";
import { relativeAge } from "./knowledge-model-utils";

export type CanonicalEntityRow =
  SettingsCanonicalEntitiesData["canonicalEntities"][number];

type StatusFilter = "all" | "active" | "merged" | "archived";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "merged", label: "Merged" },
  { value: "archived", label: "Archived" },
];

function statusBadgeClass(status: string): string {
  switch (status) {
    case "active":
      return "border-emerald-500/40 text-emerald-600 dark:text-emerald-400";
    case "merged":
      return "border-amber-500/40 text-amber-600 dark:text-amber-400";
    case "archived":
      return "border-muted-foreground/40 text-muted-foreground";
    default:
      return "border-muted-foreground/40 text-muted-foreground";
  }
}

/**
 * Identity sub-view of the Model tab: canonical entity instances with their
 * exact source mappings, plus the merge-repair entry point. Content only —
 * the title row is owned by KnowledgeModelTab.
 */
export function IdentityList() {
  const { tenantId } = useTenant();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);

  const [result, reexecute] = useQuery({
    query: SettingsCanonicalEntitiesQuery,
    variables: {
      tenantId,
      entityTypeSlug: null,
      search: search.trim() || null,
      status: status === "all" ? null : status,
      limit: 200,
    },
    pause: !tenantId,
  });

  const entities = useMemo(
    () => result.data?.canonicalEntities ?? [],
    [result.data],
  );
  const loading = result.fetching && !result.data;

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search canonical entities..."
            aria-label="Search canonical entities"
            className="h-8 w-64 pl-8 text-sm"
          />
        </div>
        <Select
          value={status}
          onValueChange={(value) => setStatus(value as StatusFilter)}
        >
          <SelectTrigger
            className="h-8 w-40 text-sm"
            aria-label="Filter by status"
          >
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMergeOpen(true)}
            disabled={!tenantId}
          >
            Repair merge
          </Button>
        </div>
      </div>

      {result.error ? (
        <p className="text-destructive mb-3 text-sm" role="alert">
          Failed to load canonical entities: {result.error.message}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
        {loading ? (
          <div className="text-muted-foreground flex items-center gap-2 p-6 text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading canonical entities...
          </div>
        ) : entities.length === 0 ? (
          <div className="text-muted-foreground p-6 text-sm">
            {search.trim() || status !== "all"
              ? "No canonical entities match the current filters."
              : "No canonical entities yet. Entities appear here once identity resolution links or creates them."}
          </div>
        ) : (
          <ul className="divide-y">
            {entities.map((entity) => {
              const expanded = expandedId === entity.id;
              return (
                <li key={entity.id}>
                  <button
                    type="button"
                    className="hover:bg-muted/50 focus-visible:ring-ring flex w-full items-center gap-2 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2"
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : entity.id)}
                  >
                    {expanded ? (
                      <ChevronDown className="text-muted-foreground size-4 shrink-0" />
                    ) : (
                      <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {entity.displayName}
                    </span>
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {entity.entityTypeSlug}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={`shrink-0 text-xs ${statusBadgeClass(
                        entity.status,
                      )}`}
                    >
                      {entity.status}
                    </Badge>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {entity.sourceMappings.length} mapping
                      {entity.sourceMappings.length === 1 ? "" : "s"}
                    </span>
                    <span className="text-muted-foreground w-16 shrink-0 text-right text-xs">
                      {relativeAge(entity.updatedAt)}
                    </span>
                  </button>
                  {expanded ? (
                    <div className="bg-muted/30 space-y-2 px-9 py-3 text-sm">
                      <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        <span>Normalized: {entity.normalizedName}</span>
                        <span>Version: {entity.version}</span>
                        {entity.mergedIntoId ? (
                          <span>Merged into: {entity.mergedIntoId}</span>
                        ) : null}
                      </div>
                      {entity.sourceMappings.length === 0 ? (
                        <p className="text-muted-foreground text-xs">
                          No exact source mappings.
                        </p>
                      ) : (
                        <ul className="space-y-1">
                          {entity.sourceMappings.map((mapping) => (
                            <li
                              key={mapping.id}
                              className="flex flex-wrap items-center gap-2 text-xs"
                            >
                              <Badge variant="outline" className="text-xs">
                                {mapping.sourceSystem}
                              </Badge>
                              <span className="text-muted-foreground">
                                {mapping.namespace} / {mapping.externalId}
                              </span>
                              <span className="text-muted-foreground">
                                visibility: {mapping.visibility}
                              </span>
                              <span className="text-muted-foreground">
                                by {mapping.createdBy}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <MergeDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        tenantId={tenantId}
        entities={entities}
        onMerged={() => reexecute({ requestPolicy: "network-only" })}
      />
    </div>
  );
}
