import { useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
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
import {
  SettingsCanonicalEntitiesQuery,
  SettingsRevokeEntitySourceMappingMutation,
} from "@/lib/settings-queries";
import { useTenant } from "@/context/TenantContext";
import { AuthorMappingDialog } from "./AuthorMappingDialog";
import { MergeDialog } from "./MergeDialog";
import { SplitDialog } from "./SplitDialog";
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
 * Identity sub-view of the Model tab (THINK-193 U4 + THINK-321 U8):
 * canonical entity instances with their exact source mappings, plus the full
 * stewardship verb set — merge repair, crosswalk link authoring, per-mapping
 * revoke (two-click confirm), and guarded split. User-confirmed links render
 * visually distinct with their source turn (R11) so operators can triage
 * agent-era mappings; the audit trail is the review surface — no viewed
 * state. Content only — the title row is owned by KnowledgeModelTab.
 */
export function IdentityList() {
  const { tenantId } = useTenant();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [authorEntity, setAuthorEntity] = useState<CanonicalEntityRow | null>(
    null,
  );
  const [splitEntity, setSplitEntity] = useState<CanonicalEntityRow | null>(
    null,
  );
  const [revokeArmId, setRevokeArmId] = useState<string | null>(null);
  const [revokeBusyId, setRevokeBusyId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

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

  const refetch = () => reexecute({ requestPolicy: "network-only" });

  const [, revokeMapping] = useMutation(
    SettingsRevokeEntitySourceMappingMutation,
  );

  // Two-click confirm: the first click arms the button, the second revokes.
  const handleRevoke = async (mappingId: string) => {
    if (revokeArmId !== mappingId) {
      setRevokeArmId(mappingId);
      setRevokeError(null);
      return;
    }
    setRevokeBusyId(mappingId);
    setRevokeError(null);
    try {
      const revoked = await revokeMapping({
        tenantId,
        mappingId,
        reason: null,
      });
      if (revoked.error) {
        setRevokeError(revoked.error.message);
        return;
      }
      const payload = revoked.data?.revokeEntitySourceMapping;
      if (payload?.status !== "revoked") {
        setRevokeError(`Revoke refused: ${payload?.reason ?? "unknown"}`);
        return;
      }
      refetch();
    } finally {
      setRevokeBusyId(null);
      setRevokeArmId(null);
    }
  };

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
                          {entity.sourceMappings.map((mapping) => {
                            const armed = revokeArmId === mapping.id;
                            const busy = revokeBusyId === mapping.id;
                            const userConfirmed = mapping.createdBy === "user";
                            return (
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
                                {userConfirmed ? (
                                  // User-confirmed links are visually
                                  // distinct with their source turn (R11) —
                                  // these are the agent-era mappings an
                                  // operator most wants to triage.
                                  <Badge
                                    variant="outline"
                                    className="border-sky-500/40 text-xs text-sky-600 dark:text-sky-400"
                                  >
                                    user-confirmed
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground">
                                    by {mapping.createdBy}
                                  </span>
                                )}
                                {userConfirmed && mapping.createdThreadRef ? (
                                  <span className="text-muted-foreground">
                                    turn {mapping.createdThreadRef}
                                  </span>
                                ) : null}
                                <Button
                                  variant={armed ? "destructive" : "ghost"}
                                  size="sm"
                                  className="h-6 px-2 text-xs"
                                  disabled={busy || !tenantId}
                                  aria-label={
                                    armed
                                      ? `Confirm revoke of ${mapping.sourceSystem} ${mapping.externalId}`
                                      : `Revoke mapping ${mapping.sourceSystem} ${mapping.externalId}`
                                  }
                                  onClick={() => void handleRevoke(mapping.id)}
                                >
                                  {busy ? (
                                    <Loader2
                                      className="size-3 animate-spin"
                                      aria-hidden
                                    />
                                  ) : armed ? (
                                    "Confirm revoke"
                                  ) : (
                                    "Revoke"
                                  )}
                                </Button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {revokeError ? (
                        <p className="text-destructive text-xs" role="alert">
                          {revokeError}
                        </p>
                      ) : null}
                      <div className="flex gap-2 pt-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={!tenantId || entity.status !== "active"}
                          onClick={() => setAuthorEntity(entity)}
                        >
                          Add mapping
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={
                            !tenantId ||
                            entity.status !== "active" ||
                            entity.sourceMappings.length < 2
                          }
                          onClick={() => setSplitEntity(entity)}
                        >
                          Split
                        </Button>
                      </div>
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
        onMerged={refetch}
      />
      <AuthorMappingDialog
        open={authorEntity !== null}
        onOpenChange={(open) => {
          if (!open) setAuthorEntity(null);
        }}
        tenantId={tenantId}
        entity={authorEntity}
        onAuthored={refetch}
      />
      <SplitDialog
        open={splitEntity !== null}
        onOpenChange={(open) => {
          if (!open) setSplitEntity(null);
        }}
        tenantId={tenantId}
        entity={splitEntity}
        onSplit={refetch}
      />
    </div>
  );
}
