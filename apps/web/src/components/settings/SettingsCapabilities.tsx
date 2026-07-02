/**
 * Capabilities area (capability-mapping plan U4 + U8).
 *
 * One operator door: the effective merged capability set for a selection —
 * space, agent profile, perspective user — one tab per capability class,
 * with a per-row state chip (active / inactive+reason / degraded) and
 * provenance line. Point-in-time semantics: results carry `computedAt` and
 * are only refreshed by selection changes or the explicit refresh action.
 *
 * The toolbar reuses the Work Items token-filter pattern: Space / Agent
 * profile / Perspective user are single-select tokens that drive the
 * inspector QUERY (clearing them returns to the tenant-wide no-user
 * baseline), while Search and State tokens filter the returned rows
 * client-side.
 *
 * Because the inspector already renders the tenant pool (catalog skills and
 * registered MCP servers appear as `not_installed` rows), inventory + grant
 * + confirmation live on the same view (U8, R10): attach on not-installed
 * rows, detach behind a destructive confirm on granted rows, and every
 * write ends on the touched item's FRESH inspector state returned by the
 * mutation (R12) — including an explicit "sync pending" phase that polls
 * until the S3 materialization is visible, never a false "not installed".
 *
 * Grant actions render only for the agent/agent-profile write scopes: a
 * space or perspective-user selection is a read lens, not a grant target
 * (R11). Pi-extension assignment (which needs version identity the
 * inspector rows don't carry) stays on the Agents → Extensions surface,
 * which calls the same grant/detach mutations.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Bot,
  Boxes,
  CircleDotDashed,
  Info,
  RefreshCw,
  Search,
  UserRound,
} from "lucide-react";
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
  DataTableTokenFilter,
  dataTableTokenFilterFns,
  type DataTableTokenFilterColumn,
  type DataTableTokenFilterValue,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
} from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import { CapabilityGrantClass, CapabilityGrantScope } from "@/gql/graphql";
import {
  SettingsAgentProfilesQuery,
  SettingsCapabilityInspectorQuery,
  SettingsDetachCapabilityMutation,
  SettingsGrantCapabilityMutation,
  SettingsSpacesListQuery,
  SettingsTenantMembersQuery,
} from "@/lib/settings-queries";
import {
  SettingsHeader,
  SettingsSection,
} from "@/components/settings/SettingsContent";

const CLASS_LABELS: Record<string, string> = {
  skill: "Skills",
  builtin_tool: "Built-in tools",
  mcp_server: "MCP servers",
  pi_extension: "Pi extensions",
  plugin: "Plugins",
  agent_profile: "Agent profiles",
  context: "Context",
};

const CLASS_ORDER = [
  "skill",
  "builtin_tool",
  "mcp_server",
  "pi_extension",
  "plugin",
  "agent_profile",
  "context",
];

const GRANT_CLASS: Record<string, CapabilityGrantClass> = {
  skill: CapabilityGrantClass.Skill,
  mcp_server: CapabilityGrantClass.McpServer,
};

// Hidden filter-table columns (Work Items token-filter pattern). The
// search/state columns filter rows client-side; the space/profile/user
// columns are SELECTION tokens — they drive the inspector query, so their
// row predicate always matches.
const FILTER_COLUMNS = {
  search: "filterSearch",
  state: "filterState",
  space: "filterSpace",
  profile: "filterProfile",
  user: "filterUser",
} as const;

// Post-attach S3 materialization race: poll the inspector briefly and show
// "sync pending" until the workspace read confirms — never a false
// "not installed" (plan U8).
const SYNC_POLL_ATTEMPTS = 4;
const SYNC_POLL_INTERVAL_MS = 1500;

type InspectorItem = {
  capabilityClass: string;
  capabilityId: string;
  displayName?: string | null;
  active: boolean;
  provenance?: string | null;
  reason?: string | null;
  detail?: string | null;
  tokenStatus?: string | null;
};

type Confirmation = {
  rowKey: string;
  label: string;
  action: "attach" | "detach";
  outcome: string;
  item: InspectorItem | null;
  syncPending: boolean;
};

function rowKeyOf(
  item: Pick<InspectorItem, "capabilityClass" | "capabilityId">,
) {
  return `${item.capabilityClass}:${item.capabilityId}`;
}

function stateChip(item: InspectorItem) {
  if (item.active && item.detail && !item.reason) {
    return (
      <Badge
        variant="outline"
        className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
      >
        active — degraded
      </Badge>
    );
  }
  if (item.active) {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      >
        active
      </Badge>
    );
  }
  if (item.reason === "resolution_fault") {
    return <Badge variant="destructive">fault</Badge>;
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {/* Reason strings render verbatim from the backend taxonomy (R6). */}
      {item.reason ?? "inactive"}
    </Badge>
  );
}

/** First selected option value of a single-select selection token. */
function selectedOptionValue(
  filters: ColumnFiltersState,
  columnId: string,
): string | null {
  const raw = filters.find((filter) => filter.id === columnId)?.value as
    DataTableTokenFilterValue | undefined;
  if (!raw || raw.operator === "is_not" || raw.operator === "is_none_of") {
    return null;
  }
  const value = Array.isArray(raw.value) ? raw.value[0] : raw.value;
  return typeof value === "string" && value ? value : null;
}

const FILTER_COLUMN_DEFS: Array<ColumnDef<InspectorItem, unknown>> = [
  {
    id: FILTER_COLUMNS.search,
    accessorFn: (item) =>
      [
        item.displayName,
        item.capabilityId,
        item.provenance,
        item.reason,
        item.detail,
      ]
        .filter(Boolean)
        .join(" "),
    filterFn: dataTableTokenFilterFns.text,
  },
  {
    id: FILTER_COLUMNS.state,
    accessorFn: (item) => (item.active ? "active" : "inactive"),
    filterFn: dataTableTokenFilterFns.option,
  },
  // Selection tokens: never filter rows — they change the query.
  { id: FILTER_COLUMNS.space, accessorFn: () => "", filterFn: () => true },
  { id: FILTER_COLUMNS.profile, accessorFn: () => "", filterFn: () => true },
  { id: FILTER_COLUMNS.user, accessorFn: () => "", filterFn: () => true },
];

export function SettingsCapabilities() {
  const { tenantId } = useTenant();
  // Default view: active capabilities only — remove or edit the State
  // token (or Clear) to see the inactive pool and gate reasons.
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([
    {
      id: FILTER_COLUMNS.state,
      value: {
        operator: "is_any_of",
        value: ["active"],
      } satisfies DataTableTokenFilterValue,
    },
  ]);
  const [activeClass, setActiveClass] = useState<string>("skill");
  const [pendingRow, setPendingRow] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const syncPollCount = useRef(0);

  const [spacesResult] = useQuery({
    query: SettingsSpacesListQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [profilesResult] = useQuery({
    query: SettingsAgentProfilesQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const [membersResult] = useQuery({
    query: SettingsTenantMembersQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });

  // Selection tokens drive the QUERY; Clear resets to the tenant-wide
  // no-user baseline.
  const spaceId = selectedOptionValue(columnFilters, FILTER_COLUMNS.space);
  const agentProfileId = selectedOptionValue(
    columnFilters,
    FILTER_COLUMNS.profile,
  );
  const perspectiveUserId = selectedOptionValue(
    columnFilters,
    FILTER_COLUMNS.user,
  );

  const [inspection, refetchInspection] = useQuery({
    query: SettingsCapabilityInspectorQuery,
    variables: {
      tenantId: tenantId ?? "",
      agentId: null,
      spaceId,
      agentProfileId,
      perspectiveUserId,
    },
    pause: !tenantId,
    requestPolicy: "network-only",
  });
  const [, grantCapability] = useMutation(SettingsGrantCapabilityMutation);
  const [, detachCapability] = useMutation(SettingsDetachCapabilityMutation);

  const loading = inspection.fetching;
  const result = inspection.data?.capabilityInspector;
  const predicted = result?.predicted ?? null;
  const items = useMemo(
    () => (predicted?.items ?? []) as InspectorItem[],
    [predicted?.items],
  );

  const members = useMemo(
    () =>
      (membersResult.data?.tenantMembers ?? [])
        .filter(
          (member) =>
            member.principalType.toUpperCase() === "USER" && member.user?.id,
        )
        .map((member) => ({
          id: member.user!.id,
          name: member.user!.name ?? member.user!.email ?? member.principalId,
        })),
    [membersResult.data?.tenantMembers],
  );

  const filterTable = useReactTable({
    data: items,
    columns: FILTER_COLUMN_DEFS,
    state: { columnFilters },
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  const filteredItems = filterTable
    .getFilteredRowModel()
    .rows.map((row) => row.original);

  const tokenFilterColumns = useMemo<DataTableTokenFilterColumn[]>(
    () => [
      {
        id: FILTER_COLUMNS.state,
        label: "State",
        type: "option",
        icon: <CircleDotDashed className="size-4" />,
        options: [
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ],
      },
      {
        id: FILTER_COLUMNS.space,
        label: "Space",
        type: "option",
        singleSelect: true,
        icon: <Boxes className="size-4" />,
        options: (spacesResult.data?.spaces ?? []).map((space) => ({
          value: space.id,
          label: space.name,
        })),
        emptyMessage: "No spaces",
      },
      {
        id: FILTER_COLUMNS.profile,
        label: "Agent profile",
        type: "option",
        singleSelect: true,
        icon: <Bot className="size-4" />,
        options: (profilesResult.data?.agentProfiles ?? []).map((profile) => ({
          value: profile.id,
          label: profile.name,
        })),
        emptyMessage: "No agent profiles",
      },
      {
        id: FILTER_COLUMNS.user,
        label: "Perspective user",
        type: "option",
        singleSelect: true,
        icon: <UserRound className="size-4" />,
        options: members.map((member) => ({
          value: member.id,
          label: member.name,
        })),
        emptyMessage: "No members",
      },
    ],
    [members, profilesResult.data?.agentProfiles, spacesResult.data?.spaces],
  );

  const spaceName = (spacesResult.data?.spaces ?? []).find(
    (space) => space.id === spaceId,
  )?.name;
  const profileName = (profilesResult.data?.agentProfiles ?? []).find(
    (profile) => profile.id === agentProfileId,
  )?.name;
  const memberName = members.find(
    (member) => member.id === perspectiveUserId,
  )?.name;
  const stateToken = columnFilters.find(
    (filter) => filter.id === FILTER_COLUMNS.state,
  )?.value as DataTableTokenFilterValue | undefined;
  const stateFilterValues = stateToken
    ? (Array.isArray(stateToken.value)
        ? stateToken.value
        : [stateToken.value]
      ).filter((value): value is string => typeof value === "string")
    : [];

  // Grant/detach exist only at agent and agent-profile scope (R11): a
  // space or perspective-user selection is a read lens. Derived from the
  // response's echoed selection so actions always match the rows shown.
  const writeScope = !result?.spaceId && !result?.perspectiveUserId;
  const grantScope = agentProfileId
    ? CapabilityGrantScope.AgentProfile
    : CapabilityGrantScope.Agent;

  // Sync-pending resolution: keep polling until the touched row reads
  // active (or attempts run out — then show the true current state).
  useEffect(() => {
    if (!confirmation?.syncPending) return;
    const row = items.find((item) => rowKeyOf(item) === confirmation.rowKey);
    if (row?.active) {
      setConfirmation({ ...confirmation, item: row, syncPending: false });
      return;
    }
    if (syncPollCount.current >= SYNC_POLL_ATTEMPTS) {
      setConfirmation({
        ...confirmation,
        item: row ?? confirmation.item,
        syncPending: false,
      });
      return;
    }
    const timer = setTimeout(() => {
      syncPollCount.current += 1;
      refetchInspection({ requestPolicy: "network-only" });
    }, SYNC_POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [confirmation, items, refetchInspection]);

  async function runMutation(action: "attach" | "detach", item: InspectorItem) {
    if (!tenantId) return;
    const grantClass = GRANT_CLASS[item.capabilityClass];
    if (!grantClass) return;
    const rowKey = rowKeyOf(item);
    const label = item.displayName || item.capabilityId;
    setPendingRow(rowKey);
    const variables = {
      input: {
        tenantId,
        capabilityClass: grantClass,
        scope: grantScope,
        agentId: null,
        agentProfileId,
        capabilityRef: item.capabilityId,
      },
    };
    let payload:
      | {
          outcome: string;
          inspectionState: string;
          item?: InspectorItem | null;
        }
      | null
      | undefined;
    let errorMessage: string | undefined;
    if (action === "attach") {
      const response = await grantCapability(variables);
      errorMessage = response.error?.message;
      payload = response.data?.grantCapability;
    } else {
      const response = await detachCapability(variables);
      errorMessage = response.error?.message;
      payload = response.data?.detachCapability;
    }
    setPendingRow(null);
    if (errorMessage) {
      toast.error(action === "attach" ? "Couldn't attach" : "Couldn't detach", {
        description: errorMessage,
      });
      return;
    }
    const fresh = (payload?.item as InspectorItem | null | undefined) ?? null;
    // Applied grant whose fresh state still reads not_installed = the S3
    // materialization race; anything else resolves immediately.
    const syncPending =
      action === "attach" &&
      payload?.outcome === "applied" &&
      (!fresh || (!fresh.active && fresh.reason === "not_installed"));
    syncPollCount.current = 0;
    setConfirmation({
      rowKey,
      label,
      action,
      outcome: payload?.outcome ?? "applied",
      item: fresh,
      syncPending,
    });
    refetchInspection({ requestPolicy: "network-only" });
  }

  function rowActions(item: InspectorItem) {
    if (!writeScope || !GRANT_CLASS[item.capabilityClass]) return null;
    const rowKey = rowKeyOf(item);
    const busy = pendingRow !== null;
    // Attach targets the not-installed tenant pool the inspector already
    // lists; the pool renders on the default-agent view only (a profile
    // view lists just the profile's granted subset).
    if (!item.active && item.reason === "not_installed" && !agentProfileId) {
      return (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void runMutation("attach", item)}
          data-testid={`attach-${rowKey}`}
        >
          {pendingRow === rowKey ? "Attaching…" : "Attach"}
        </Button>
      );
    }
    if (item.active) {
      return (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              data-testid={`detach-${rowKey}`}
            >
              {pendingRow === rowKey ? "Detaching…" : "Detach"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Detach {item.displayName || item.capabilityId}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {agentProfileId
                  ? "Removes this capability from the selected agent profile's policy."
                  : item.capabilityClass === "skill"
                    ? "Removes the installed skill folder from the agent workspace and strips its CONTEXT.md wiring."
                    : "Removes this server's assignment from the agent."}{" "}
                The post-detach state is shown before you leave.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={busy}
                onClick={() => void runMutation("detach", item)}
                data-testid={`detach-confirm-${rowKey}`}
              >
                Detach
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      );
    }
    return null;
  }

  // One tab per capability class, in fixed order, with active counts.
  const byClass = useMemo(() => {
    const map = new Map<string, InspectorItem[]>();
    for (const item of filteredItems) {
      const list = map.get(item.capabilityClass) ?? [];
      list.push(item);
      map.set(item.capabilityClass, list);
    }
    return map;
  }, [filteredItems]);

  const tabClasses = useMemo(() => {
    const present = [...byClass.keys()];
    const ordered = CLASS_ORDER.filter(
      (capabilityClass) =>
        present.includes(capabilityClass) ||
        capabilityClass === "skill" ||
        capabilityClass === "mcp_server",
    );
    for (const capabilityClass of present) {
      if (!ordered.includes(capabilityClass)) ordered.push(capabilityClass);
    }
    return ordered;
  }, [byClass]);

  const activeTab = tabClasses.includes(activeClass)
    ? activeClass
    : (tabClasses[0] ?? "skill");
  const visibleItems = byClass.get(activeTab) ?? [];

  const searchToken = columnFilters.find(
    (filter) => filter.id === FILTER_COLUMNS.search,
  )?.value as DataTableTokenFilterValue | undefined;
  const searchValue =
    searchToken && typeof searchToken.value === "string"
      ? searchToken.value
      : "";

  function setSearch(value: string) {
    setColumnFilters((current) => {
      const rest = current.filter(
        (filter) => filter.id !== FILTER_COLUMNS.search,
      );
      if (!value) return rest;
      return [
        ...rest,
        {
          id: FILTER_COLUMNS.search,
          value: { operator: "contains", value } as DataTableTokenFilterValue,
        },
      ];
    });
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <SettingsHeader
        title="Capabilities"
        description="What the platform agent will actually get for a selection — every skill, tool, MCP server, extension, and plugin with its provenance and, when inactive, the exact gate that dropped it. Attach from the tenant pool or detach directly; every action ends on the item's live state."
      />

      <div
        className="mb-4 flex flex-wrap items-center gap-2"
        data-testid="capability-toolbar"
      >
        <CapabilityToolbarSearch value={searchValue} onChange={setSearch} />
        <DataTableTokenFilter
          table={filterTable}
          columns={tokenFilterColumns}
          addLabel="Filter"
          showAddLabel={false}
          clearLabel="Clear"
          flattenToolbar
          className="max-w-full [&_[data-token-filter-token]]:shrink-0"
          popoverClassName="w-[min(16rem,calc(100vw-2rem))]"
        />
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="outline"
            size="icon-sm"
            className="h-8 w-8 rounded-md"
            aria-label="Refresh"
            onClick={() => refetchInspection({ requestPolicy: "network-only" })}
            disabled={loading}
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                className="h-8 w-8 rounded-md"
                aria-label="What am I looking at?"
                data-testid="view-info-trigger"
              >
                <Info className="size-4" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>What this view shows</DialogTitle>
                <DialogDescription>
                  The effective capability set the platform agent would get for
                  the current selection, computed through the same resolver the
                  runtime uses.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-sm" data-testid="view-info-body">
                <p>
                  <span className="font-medium">Selection:</span>{" "}
                  {spaceId
                    ? `Space ${spaceName ?? spaceId}`
                    : "no Space (agent baseline)"}
                  {" · "}
                  {agentProfileId
                    ? `agent profile ${profileName ?? agentProfileId}`
                    : "default agent"}
                  {" · "}
                  {perspectiveUserId
                    ? `as ${memberName ?? perspectiveUserId}`
                    : "no perspective user"}
                </p>
                {result?.noUserBaseline ? (
                  <p data-testid="baseline-note">
                    No perspective user means the no-user baseline — exactly
                    what a scheduled or wakeup turn gets: plugin per-user
                    servers excluded, direct OAuth via the agent&apos;s human
                    pair.
                  </p>
                ) : null}
                <p>
                  <span className="font-medium">Filters:</span>{" "}
                  {stateFilterValues.length > 0
                    ? `state ${stateFilterValues.join(", ")}`
                    : "all states"}
                  {searchValue ? ` · search "${searchValue}"` : ""}
                </p>
                <p className="text-muted-foreground">
                  Inactive rows carry the exact gate that dropped them (trust
                  gate, eval gate, OAuth, plugin activation, policy…) and the
                  tenant pool appears as not_installed rows you can attach.
                  Every attach/detach ends on the item&apos;s fresh post-write
                  state.
                </p>
                {predicted ? (
                  <p className="text-muted-foreground">
                    Computed {new Date(predicted.computedAt).toLocaleString()} ·
                    fingerprint{" "}
                    <span className="font-mono">
                      {predicted.configFingerprint.slice(0, 12)}
                    </span>
                  </p>
                ) : null}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {confirmation ? (
        <div
          className="mb-4 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
          data-testid="mutation-confirmation"
        >
          <span className="font-medium">{confirmation.label}</span>
          <span className="text-muted-foreground">
            {confirmation.action === "attach" ? "attach" : "detach"}
            {confirmation.outcome === "noop" ? " (no change)" : ""} —
          </span>
          {confirmation.syncPending ? (
            <Badge
              variant="outline"
              className="border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400"
              data-testid="sync-pending"
            >
              sync pending…
            </Badge>
          ) : confirmation.item ? (
            stateChip(confirmation.item)
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              removed
            </Badge>
          )}
          {!confirmation.syncPending && confirmation.item?.detail ? (
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {confirmation.item.detail}
            </span>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3" data-testid="capability-loading">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : inspection.error ? (
        <p className="text-sm text-destructive">
          Couldn&apos;t load the capability set: {inspection.error.message}
        </p>
      ) : result?.state === "invalid_selection" ? (
        <p className="text-sm text-destructive" data-testid="invalid-selection">
          Invalid selection: {result.stateDetail}
        </p>
      ) : result?.state === "resolution_fault" ? (
        <p className="text-sm text-destructive" data-testid="resolution-fault">
          Resolution fault — this selection could not be composed:{" "}
          {result.stateDetail}
        </p>
      ) : predicted ? (
        <>
          <Tabs value={activeTab} onValueChange={setActiveClass}>
            <TabsList className="mb-3 flex-wrap">
              {tabClasses.map((capabilityClass) => {
                const classItems = byClass.get(capabilityClass) ?? [];
                const activeCount = classItems.filter(
                  (item) => item.active,
                ).length;
                return (
                  <TabsTrigger
                    key={capabilityClass}
                    value={capabilityClass}
                    data-testid={`capability-tab-${capabilityClass}`}
                  >
                    {CLASS_LABELS[capabilityClass] ?? capabilityClass}
                    <span className="ml-1.5 text-xs font-semibold text-primary">
                      {activeCount}
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>

          <SettingsSection>
            {visibleItems.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Nothing in this category for the current selection.
              </p>
            ) : (
              visibleItems.map((item) => (
                <div
                  key={rowKeyOf(item)}
                  className="flex flex-col gap-1 border-b border-border px-4 py-3 last:border-b-0"
                  data-testid="capability-row"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-medium text-foreground">
                      {item.displayName || item.capabilityId}
                    </p>
                    <div className="flex shrink-0 items-center gap-2">
                      {item.tokenStatus ? (
                        <Badge
                          variant="outline"
                          className="text-muted-foreground"
                        >
                          token: {item.tokenStatus}
                        </Badge>
                      ) : null}
                      {stateChip(item)}
                      {rowActions(item)}
                    </div>
                  </div>
                  {item.provenance ? (
                    <p className="text-xs text-muted-foreground">
                      {item.provenance}
                    </p>
                  ) : null}
                  {item.detail ? (
                    <p className="text-xs text-muted-foreground">
                      {item.detail}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </SettingsSection>
          <p className="mt-2 text-xs text-muted-foreground">
            Computed {new Date(predicted.computedAt).toLocaleString()} ·
            fingerprint{" "}
            <span className="font-mono">
              {predicted.configFingerprint.slice(0, 12)}
            </span>
          </p>
        </>
      ) : null}
    </div>
  );
}

function CapabilityToolbarSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const isOpen = expanded || value.length > 0;

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  if (!isOpen) {
    return (
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className="h-8 w-8 rounded-md"
        aria-label="Search capabilities"
        data-testid="capability-search-toggle"
        onClick={() => setExpanded(true)}
      >
        <Search className="size-4" aria-hidden="true" />
      </Button>
    );
  }

  return (
    <div className="relative flex h-8 w-[min(16rem,calc(100vw-2rem))] items-center rounded-md border border-input">
      <Search className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" />
      <Input
        ref={inputRef}
        aria-label="Search capabilities"
        data-testid="capability-search"
        placeholder="Search capabilities..."
        className="h-8 rounded-md border-transparent bg-transparent pl-8 shadow-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        value={value}
        onBlur={() => {
          if (!value) setExpanded(false);
        }}
        onChange={(event) => onChange(event.target.value.trimStart())}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onChange("");
            setExpanded(false);
          }
        }}
      />
    </div>
  );
}
