/**
 * Composer — the capability-configuration home (capability-mapping plan
 * U4 + U8; renamed from "Capabilities" in Composer plan U3, KTD-6 — the
 * route path stays /settings/capabilities).
 *
 * Composer v1.1 (product-owner feedback) reshapes the surface into a normal
 * editor:
 *
 *   1. the main area is the rendered-workspace EDITOR SHELL
 *      (`ComposerWorkspaceEditor`): a full-height file tree beside a real
 *      CodeMirror pane, backed by the read-only `createComposerPreviewClient`
 *      adapter over `workspacePreview` / `workspacePreviewFile`. File CONTENTS
 *      stay read-only/derived; the U7 generated-file split view is preserved;
 *   2. the capability LIST (class tabs + rows + attach/detach) moves into a
 *      right Side Sheet opened from the toolbar. Jump-to-cause from a tree node
 *      opens the Sheet scrolled/focused to the row (with the State/Search
 *      tokens reset and the tab switched);
 *   3. the tree and the list tell one story: skill folders are decorated with
 *      their inspector state (active vs gated + verbatim reason), and the class
 *      tab counts read active/total;
 *   4. the tree offers direct manipulation via a context menu — "Detach skill…"
 *      on a `skills/<slug>/` folder and "Add skill…" on the `skills/` folder —
 *      both routed through the SAME grant/detach + confirm + sync-pending
 *      machinery the Sheet rows use.
 *
 * Point-in-time semantics are unchanged: results carry `computedAt` and refresh
 * only on selection changes or the explicit refresh action; every write ends on
 * the touched item's FRESH inspector state (R12), including the sync-pending
 * phase that polls until the S3 materialization is visible.
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
  Info,
  ListChecks,
  Puzzle,
  RefreshCw,
  ScanSearch,
  Search,
  SlidersHorizontal,
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
} from "@thinkwork/ui";
import { Link } from "@tanstack/react-router";
import {
  desktopToolbarButtonClassName,
  desktopToolbarGapClassName,
} from "@/lib/desktop-chrome";
import { useTenant } from "@/context/TenantContext";
import { AgentConfigSheet } from "@/components/settings/AgentConfigSheet";
import { useFragment } from "@/gql/fragment-masking";
import { SettingsAgentExtensions } from "@/components/settings/SettingsAgentExtensions";
import {
  CapabilityGrantClass,
  CapabilityGrantScope,
  PiExtensionAssignmentTargetType,
  PiExtensionVersionStatus,
} from "@/gql/graphql";
import {
  SettingsAgentProfilesQuery,
  SettingsCapabilityInspectorQuery,
  SettingsComposerPiExtensionsQuery,
  SettingsDetachCapabilityMutation,
  SettingsGrantCapabilityMutation,
  SettingsPiExtensionFieldsFragment,
  SettingsPiExtensionsQuery,
  SettingsSpacesListQuery,
  SettingsTenantMembersQuery,
} from "@/lib/settings-queries";
import {
  SettingsHeader,
  SettingsSection,
} from "@/components/settings/SettingsContent";
import {
  ComposerWorkspaceEditor,
  type SkillNodeState,
} from "@/components/settings/ComposerWorkspaceEditor";
import { CapabilityInspectorView } from "@/components/settings/CapabilityInspectorView";
import { AgentProfilesSheet } from "@/components/settings/AgentProfilesSheet";

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

const FILTER_COLUMNS = {
  search: "filterSearch",
  space: "filterSpace",
  profile: "filterProfile",
  user: "filterUser",
} as const;

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

type DivergenceDelta = {
  capabilityClass: string;
  capabilityId: string;
  kind: string;
};

type Confirmation = {
  rowKey: string;
  label: string;
  action: "attach" | "detach";
  outcome: string;
  item: InspectorItem | null;
  syncPending: boolean;
};

type ExtensionAssignment = {
  id: string;
  versionId: string;
  targetType: PiExtensionAssignmentTargetType;
  agentProfileId?: string | null;
  enabled: boolean;
};

type ExtensionRow = {
  id: string;
  sourceId: string;
  displayName?: string | null;
  repositoryName?: string | null;
  repositoryOwner?: string | null;
  sourceRef: string;
  status: PiExtensionVersionStatus;
  permissionClasses: readonly string[];
  createdAt: string;
  updatedAt: string;
  assignments: readonly ExtensionAssignment[];
};

type ExtensionGroup = {
  sourceId: string;
  name: string;
  versions: ExtensionRow[];
};

function extensionGroupName(version: ExtensionRow): string {
  return (
    version.displayName?.trim() ||
    version.repositoryName?.trim() ||
    version.sourceId
  );
}

/** Short label for a specific extension version in the picker. */
function extensionVersionLabel(version: ExtensionRow): string {
  return `${version.sourceRef} · ${version.id.slice(0, 8)}`;
}

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
    | DataTableTokenFilterValue
    | undefined;
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
  { id: FILTER_COLUMNS.space, accessorFn: () => "", filterFn: () => true },
  { id: FILTER_COLUMNS.profile, accessorFn: () => "", filterFn: () => true },
  { id: FILTER_COLUMNS.user, accessorFn: () => "", filterFn: () => true },
];

export type ComposerSheetId =
  | "config"
  | "profiles"
  | "extensions"
  | "inspector";

export function SettingsCapabilities({
  urlSheet = null,
  urlProfileId = null,
  urlFocus = null,
  initialTreeFile = null,
  onUrlSheetChange,
}: {
  /** URL-driven sheet state (Agent page merge U7, KTD-1). Null = closed. */
  urlSheet?: ComposerSheetId | null;
  urlProfileId?: string | null;
  urlFocus?: string | null;
  /** Legacy `?view=workspace&file=…` deep links: select this tree file. */
  initialTreeFile?: string | null;
  /**
   * When provided, the URL owns sheet state: open/close requests route
   * through this callback and local state derives from `urlSheet`. Absent
   * (tests, transitional hosts), sheets stay locally controlled.
   */
  onUrlSheetChange?: (
    sheet: ComposerSheetId | null,
    target?: { profileId?: string | null; focus?: string | null },
  ) => void;
} = {}) {
  const { tenantId } = useTenant();
  // No default filters (Agent page merge U12): the empty selection IS the
  // default agent in the default space, and every row state is visible.
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [activeClass, setActiveClass] = useState<string>("skill");
  const [pendingRow, setPendingRow] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const syncPollCount = useRef(0);
  const [previewRefreshToken, setPreviewRefreshToken] = useState(0);
  const [focusedRowKey, setFocusedRowKey] = useState<string | null>(null);
  // Capability Side Sheet (v1.1 item 2): the list lives here now.
  const [sheetOpen, setSheetOpen] = useState(false);
  // Config sheet (Agent page merge U1): Default Agent settings on this surface.
  const [configOpen, setConfigOpen] = useState(false);
  // Extensions sheet (Agent page merge U3): the trust/import registry
  // relocated from the Agents page, mounted with its own fragment-shaped
  // query so the component contract is untouched.
  const [extensionsSheetOpen, setExtensionsSheetOpen] = useState(false);
  // Inspector view (Agent page merge U8): read-only diagnostics for every
  // class — survives the capability list's retirement (U9).
  const [inspectorOpen, setInspectorOpen] = useState(false);
  // Profiles sheet (Agent page merge U2): list → detail editing; the tree's
  // "Configure Agent Profile" deep-links straight to a profile's detail.
  const [profilesSheet, setProfilesSheet] = useState<{
    open: boolean;
    profileId: string | null;
  }>({ open: false, profileId: null });
  // KTD-1 (U7): when a URL bridge is wired, the search params are the sheet
  // state's source of truth — local state just mirrors them.
  const urlDriven = onUrlSheetChange !== undefined;
  useEffect(() => {
    if (!urlDriven) return;
    setConfigOpen(urlSheet === "config");
    setExtensionsSheetOpen(urlSheet === "extensions");
    setInspectorOpen(urlSheet === "inspector");
    setProfilesSheet({
      open: urlSheet === "profiles",
      profileId: urlSheet === "profiles" ? (urlProfileId ?? null) : null,
    });
  }, [urlDriven, urlSheet, urlProfileId]);

  function requestSheet(
    sheet: ComposerSheetId | null,
    target?: { profileId?: string | null; focus?: string | null },
  ) {
    if (onUrlSheetChange) {
      onUrlSheetChange(sheet, target);
      return;
    }
    setConfigOpen(sheet === "config");
    setExtensionsSheetOpen(sheet === "extensions");
    setInspectorOpen(sheet === "inspector");
    setProfilesSheet({
      open: sheet === "profiles",
      profileId: sheet === "profiles" ? (target?.profileId ?? null) : null,
    });
  }
  // Tree context-menu targets (v1.1 item 4).
  const [addSkillOpen, setAddSkillOpen] = useState(false);
  const [addMcpOpen, setAddMcpOpen] = useState(false);
  const [addExtensionOpen, setAddExtensionOpen] = useState(false);
  // Per-extension-group version choice for the Add dialog (sourceId → versionId).
  const [extensionVersionChoice, setExtensionVersionChoice] = useState<
    Record<string, string>
  >({});
  const [detachTarget, setDetachTarget] = useState<InspectorItem | null>(null);
  const [removingSkillSlug, setRemovingSkillSlug] = useState<string | null>(
    null,
  );
  const [removingMcpSlug, setRemovingMcpSlug] = useState<string | null>(null);

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
  // Pi-extension registry read (plan U8): version identity + current
  // assignments for the pi_extension controls that folded in from the retired
  // Agents → Extensions assignment surface. Version identity lives here, not in
  // the inspector rows (KTD-5) — no schema change.
  const [extensionsResult, refetchExtensions] = useQuery({
    query: SettingsComposerPiExtensionsQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  // Registry-shaped read for the relocated Extensions sheet (Agent page
  // merge U3) — fragment-masked rows for SettingsAgentExtensions.
  const [registryExtensionsResult, refetchRegistryExtensions] = useQuery({
    query: SettingsPiExtensionsQuery,
    variables: { tenantId: tenantId ?? "" },
    pause: !tenantId,
  });
  const registryExtensions = useFragment(
    SettingsPiExtensionFieldsFragment,
    registryExtensionsResult.data?.piExtensions ?? [],
  );

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

  const divergence = result?.divergence ?? null;
  const deltas = useMemo(
    () => (divergence?.deltas ?? []) as DivergenceDelta[],
    [divergence?.deltas],
  );
  const deltaByRowKey = useMemo(
    () =>
      new Map(
        deltas
          .filter((delta) => delta.kind === "missing_in_observed")
          .map((delta) => [rowKeyOf(delta), delta.kind]),
      ),
    [deltas],
  );
  const extraInObserved = useMemo(
    () => deltas.filter((delta) => delta.kind === "extra_in_observed"),
    [deltas],
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

  // Grant/detach exist only at agent and agent-profile scope (R11): a
  // space or perspective-user selection is a read lens.
  const writeScope = !result?.spaceId && !result?.perspectiveUserId;
  const grantScope = agentProfileId
    ? CapabilityGrantScope.AgentProfile
    : CapabilityGrantScope.Agent;
  // Profile overlay (Agent page merge U6): the selected profile's name scopes
  // the tree's attach/detach labels so profile-scoped writes read as such.
  const selectedProfileName = agentProfileId
    ? ((profilesResult.data?.agentProfiles ?? []).find(
        (profile) => profile.id === agentProfileId,
      )?.name ?? null)
    : null;

  // Skill-node decoration for the tree (v1.1 item 3): capability state keyed
  // by slug (capabilityId), from the FULL inspector item set (filter-independent).
  const skillStateBySlug = useMemo(() => {
    const map = new Map<string, SkillNodeState>();
    for (const item of items) {
      if (item.capabilityClass !== "skill") continue;
      map.set(item.capabilityId, {
        active: item.active,
        reason: item.reason ?? null,
      });
    }
    return map;
  }, [items]);

  // The Add-skill pool (v1.1 item 4): every skill the inspector knows about
  // that is not currently active-installed — not_installed catalog entries and
  // gated-but-detachable entries, each with its state shown.
  const addSkillPool = useMemo(
    () =>
      items.filter((item) => item.capabilityClass === "skill" && !item.active),
    [items],
  );

  // MCP mirror (U9c): decoration state per server slug, and the Add picker
  // pool — ALL registered mcp_server rows (state shown verbatim; Add is
  // disabled on already-active rows).
  const mcpStateBySlug = useMemo(() => {
    const map = new Map<string, SkillNodeState>();
    for (const item of items) {
      if (item.capabilityClass !== "mcp_server") continue;
      map.set(item.capabilityId, {
        active: item.active,
        reason: item.reason ?? null,
      });
    }
    return map;
  }, [items]);

  const addMcpPool = useMemo(
    () => items.filter((item) => item.capabilityClass === "mcp_server"),
    [items],
  );

  // ── Pi-extension controls (plan U8) ──────────────────────────────────────
  const extensionRows = useMemo<ExtensionRow[]>(
    () => (extensionsResult.data?.piExtensions ?? []) as ExtensionRow[],
    [extensionsResult.data?.piExtensions],
  );

  // Inspector pi_extension rows are keyed by assignmentId; the registry data
  // maps that back to the version identity the grant/detach mutations need.
  const versionIdByAssignmentId = useMemo(() => {
    const map = new Map<string, string>();
    for (const version of extensionRows) {
      for (const assignment of version.assignments) {
        map.set(assignment.id, assignment.versionId);
      }
    }
    return map;
  }, [extensionRows]);

  // True when an assignment targets the CURRENT Composer scope (agent baseline
  // vs the selected profile) and is enabled.
  const assignmentMatchesScope = useMemo(
    () =>
      (assignment: ExtensionAssignment): boolean => {
        if (!assignment.enabled) return false;
        if (agentProfileId) {
          return (
            assignment.targetType ===
              PiExtensionAssignmentTargetType.AgentProfile &&
            assignment.agentProfileId === agentProfileId
          );
        }
        return (
          assignment.targetType === PiExtensionAssignmentTargetType.DefaultAgent
        );
      },
    [agentProfileId],
  );

  // Approved versions grouped by extension identity (sourceId), latest first.
  const extensionGroups = useMemo<ExtensionGroup[]>(() => {
    const groups = new Map<string, ExtensionGroup>();
    for (const version of extensionRows) {
      if (version.status !== PiExtensionVersionStatus.Approved) continue;
      const group = groups.get(version.sourceId) ?? {
        sourceId: version.sourceId,
        name: extensionGroupName(version),
        versions: [],
      };
      group.versions.push(version);
      groups.set(version.sourceId, group);
    }
    for (const group of groups.values()) {
      group.versions.sort(
        (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
      );
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [extensionRows]);

  // Groups with no enabled assignment at the current scope — the Add pool.
  const attachableExtensionGroups = useMemo(
    () =>
      extensionGroups.filter(
        (group) =>
          !group.versions.some((version) =>
            version.assignments.some(assignmentMatchesScope),
          ),
      ),
    [extensionGroups, assignmentMatchesScope],
  );

  // Sync-pending resolution: keep polling until the touched row reads active.
  useEffect(() => {
    if (!confirmation?.syncPending) return;
    const row = items.find((item) => rowKeyOf(item) === confirmation.rowKey);
    if (row?.active) {
      setConfirmation({ ...confirmation, item: row, syncPending: false });
      setPreviewRefreshToken((token) => token + 1);
      return;
    }
    if (syncPollCount.current >= SYNC_POLL_ATTEMPTS) {
      setConfirmation({
        ...confirmation,
        item: row ?? confirmation.item,
        syncPending: false,
      });
      setPreviewRefreshToken((token) => token + 1);
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
    if (!syncPending) {
      setPreviewRefreshToken((token) => token + 1);
    }
    refetchInspection({ requestPolicy: "network-only" });
  }

  /**
   * Pi-extension grant/detach (plan U8). Keyed by VERSION id (from the registry
   * data), not the inspector's assignmentId — the version picker chooses which
   * approved version to grant; detach targets the assigned version. Shares the
   * unified grant/detach write path + scope with skills and MCP servers.
   */
  async function runExtensionMutation(input: {
    action: "attach" | "detach";
    versionId: string;
    label: string;
    grantedPermissions?: readonly string[];
  }) {
    if (!tenantId) return;
    const rowKey = `pi_extension_version:${input.versionId}`;
    setPendingRow(rowKey);
    let errorMessage: string | undefined;
    if (input.action === "attach") {
      const response = await grantCapability({
        input: {
          tenantId,
          capabilityClass: CapabilityGrantClass.PiExtension,
          scope: grantScope,
          agentId: null,
          agentProfileId,
          capabilityRef: input.versionId,
          grantedPermissions: [...(input.grantedPermissions ?? [])],
        },
      });
      errorMessage = response.error?.message;
    } else {
      const response = await detachCapability({
        input: {
          tenantId,
          capabilityClass: CapabilityGrantClass.PiExtension,
          scope: grantScope,
          agentId: null,
          agentProfileId,
          capabilityRef: input.versionId,
        },
      });
      errorMessage = response.error?.message;
    }
    setPendingRow(null);
    if (errorMessage) {
      toast.error(
        input.action === "attach"
          ? "Couldn't assign extension"
          : "Couldn't detach extension",
        { description: errorMessage },
      );
      return;
    }
    toast.success(
      input.action === "attach"
        ? `Assigned ${input.label}`
        : `Detached ${input.label}`,
    );
    setPreviewRefreshToken((token) => token + 1);
    refetchInspection({ requestPolicy: "network-only" });
    refetchExtensions({ requestPolicy: "network-only" });
  }

  async function pickExtensionToAdd(group: ExtensionGroup) {
    const versionId =
      extensionVersionChoice[group.sourceId] ?? group.versions[0]?.id;
    const version = group.versions.find(
      (candidate) => candidate.id === versionId,
    );
    if (!version) return;
    setAddExtensionOpen(false);
    await runExtensionMutation({
      action: "attach",
      versionId: version.id,
      label: group.name,
      grantedPermissions: version.permissionClasses,
    });
  }

  /**
   * In-page jump-to-cause landing (U2, KTD-5; v1.1 item 2): open the Side
   * Sheet, reset the State/Search filter tokens (keeping the Space/Profile/User
   * SELECTION tokens — they drive the query), switch to the target's class tab,
   * and focus the row. The page defaults to Active-only rows on one tab, and
   * the diagnose flow targets exactly the rows those defaults hide.
   */
  function focusCapabilityRow(capabilityClass: string, capabilityId: string) {
    setColumnFilters((current) =>
      current.filter((filter) => filter.id !== FILTER_COLUMNS.search),
    );
    setActiveClass(capabilityClass);
    setFocusedRowKey(`${capabilityClass}:${capabilityId}`);
    setSheetOpen(true);
  }

  useEffect(() => {
    if (!focusedRowKey || !sheetOpen) return;
    const row = document.querySelector(
      '[data-testid="capability-row-focused"]',
    );
    row?.scrollIntoView?.({ block: "center" });
  }, [focusedRowKey, activeClass, columnFilters, sheetOpen]);

  // Tree context-menu detach (v1.1 item 4): reuse the destructive confirm +
  // the SAME detach mutation, showing a "removing…" ghost on the folder.
  function requestDetachSkill(slug: string) {
    const item = items.find(
      (candidate) =>
        candidate.capabilityClass === "skill" &&
        candidate.capabilityId === slug,
    );
    if (item) setDetachTarget(item);
  }

  // MCP mirror (U9c): same confirm dialog + detach mutation, second class.
  function requestDetachMcp(slug: string) {
    const item = items.find(
      (candidate) =>
        candidate.capabilityClass === "mcp_server" &&
        candidate.capabilityId === slug,
    );
    if (item) setDetachTarget(item);
  }

  async function confirmDetachFromTree() {
    if (!detachTarget) return;
    const item = detachTarget;
    setDetachTarget(null);
    const setRemoving =
      item.capabilityClass === "mcp_server"
        ? setRemovingMcpSlug
        : setRemovingSkillSlug;
    setRemoving(item.capabilityId);
    await runMutation("detach", item);
    setRemoving(null);
  }

  async function pickSkillToAdd(item: InspectorItem) {
    setAddSkillOpen(false);
    await runMutation("attach", item);
  }

  async function pickMcpToAdd(item: InspectorItem) {
    setAddMcpOpen(false);
    await runMutation("attach", item);
  }

  function rowActions(item: InspectorItem) {
    if (!writeScope) return null;
    const rowKey = rowKeyOf(item);
    const busy = pendingRow !== null;

    // Pi-extension detach (plan U8). Inspector rows are keyed by assignmentId;
    // the registry data resolves the version identity the mutation needs. When
    // a granted version has left the registry, the control is disabled/error
    // (there is no version to target) rather than silently absent.
    if (item.capabilityClass === "pi_extension") {
      if (!item.active) return null;
      const versionId = versionIdByAssignmentId.get(item.capabilityId);
      if (!versionId) {
        return (
          <Button
            variant="outline"
            size="sm"
            disabled
            title="This extension version is no longer in the registry."
            data-testid={`detach-pi_extension-missing:${item.capabilityId}`}
          >
            Detach
          </Button>
        );
      }
      return (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              data-testid={`detach-pi_extension:${item.capabilityId}`}
            >
              {pendingRow === `pi_extension_version:${versionId}`
                ? "Detaching…"
                : "Detach"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Detach {item.displayName || item.capabilityId}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {agentProfileId
                  ? "Removes this Pi extension from the selected agent profile."
                  : "Removes this Pi extension from the Agent."}{" "}
                The post-detach state is shown before you leave.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={busy}
                onClick={() =>
                  void runExtensionMutation({
                    action: "detach",
                    versionId,
                    label: item.displayName || item.capabilityId,
                  })
                }
                data-testid={`detach-confirm-pi_extension:${item.capabilityId}`}
              >
                Detach
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      );
    }

    if (!GRANT_CLASS[item.capabilityClass]) return null;
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

  // Class grouping for tabs + rows. Tab COUNTS read active/total from the FULL
  // item set (v1.1 item 3) so they're independent of the State filter; the
  // visible rows come from the FILTERED set.
  const allByClass = useMemo(() => {
    const map = new Map<string, InspectorItem[]>();
    for (const item of items) {
      const list = map.get(item.capabilityClass) ?? [];
      list.push(item);
      map.set(item.capabilityClass, list);
    }
    return map;
  }, [items]);

  const filteredByClass = useMemo(() => {
    const map = new Map<string, InspectorItem[]>();
    for (const item of filteredItems) {
      const list = map.get(item.capabilityClass) ?? [];
      list.push(item);
      map.set(item.capabilityClass, list);
    }
    return map;
  }, [filteredItems]);

  const tabClasses = useMemo(() => {
    const present = [...allByClass.keys()];
    const ordered = CLASS_ORDER.filter(
      (capabilityClass) =>
        present.includes(capabilityClass) ||
        capabilityClass === "skill" ||
        capabilityClass === "mcp_server" ||
        capabilityClass === "pi_extension",
    );
    for (const capabilityClass of present) {
      if (!ordered.includes(capabilityClass)) ordered.push(capabilityClass);
    }
    return ordered;
  }, [allByClass]);

  const activeTab = tabClasses.includes(activeClass)
    ? activeClass
    : (tabClasses[0] ?? "skill");
  const visibleItems = filteredByClass.get(activeTab) ?? [];

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

  function divergenceChip() {
    if (!divergence) return null;
    if (divergence.state === "in_sync") {
      return (
        <Badge
          variant="outline"
          className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          data-testid="divergence-chip"
        >
          runtime in sync
        </Badge>
      );
    }
    if (divergence.state === "divergent") {
      return (
        <Badge variant="destructive" data-testid="divergence-chip">
          divergent — {deltas.length} {deltas.length === 1 ? "delta" : "deltas"}
        </Badge>
      );
    }
    if (divergence.state === "config_changed_since_turn") {
      return (
        <Badge
          variant="outline"
          className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
          data-testid="divergence-chip"
        >
          config changed since last turn
        </Badge>
      );
    }
    return (
      <Badge
        variant="outline"
        className="text-muted-foreground"
        data-testid="divergence-chip"
      >
        no turn observed yet
      </Badge>
    );
  }

  // Post-attach sync window (U2): surface the affected capability folder in the
  // tree as an explicit pending node instead of a frozen view.
  const pendingSkillSlug =
    confirmation?.syncPending && confirmation.rowKey.startsWith("skill:")
      ? confirmation.rowKey.slice("skill:".length)
      : null;
  const pendingMcpSlug =
    confirmation?.syncPending && confirmation.rowKey.startsWith("mcp_server:")
      ? confirmation.rowKey.slice("mcp_server:".length)
      : null;


  // Agent page merge U12: page actions live in the header bar as muted icons
  // (Evaluations pattern) — the in-body row keeps only search + filters.
  const composerHeaderActions = (
    <div className={cn("flex items-center", desktopToolbarGapClassName)}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title="Agent configuration"
        aria-label="Agent configuration"
        className={desktopToolbarButtonClassName}
        onClick={() => requestSheet("config")}
        data-testid="open-config-sheet"
      >
        <SlidersHorizontal className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title="Agent Profiles"
        aria-label="Agent Profiles"
        className={desktopToolbarButtonClassName}
        onClick={() => requestSheet("profiles")}
        data-testid="open-profiles-sheet"
      >
        <Bot className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title="Extensions"
        aria-label="Extensions"
        className={desktopToolbarButtonClassName}
        onClick={() => requestSheet("extensions")}
        data-testid="open-extensions-sheet"
      >
        <Puzzle className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title="Capability list"
        aria-label="Capability list"
        className={desktopToolbarButtonClassName}
        onClick={() => setSheetOpen(true)}
        data-testid="open-capability-sheet"
      >
        <ListChecks className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title="Inspector — read-only capability diagnostics"
        aria-label="Inspector"
        className={desktopToolbarButtonClassName}
        onClick={() => requestSheet("inspector")}
        data-testid="open-inspector-view"
      >
        <ScanSearch className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        title="Refresh"
        aria-label="Refresh"
        className={desktopToolbarButtonClassName}
        onClick={() => refetchInspection({ requestPolicy: "network-only" })}
        disabled={loading}
      >
        <RefreshCw className={cn("size-4", loading && "animate-spin")} />
      </Button>
          <Dialog>
            <DialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title="What am I looking at?"
                aria-label="What am I looking at?"
                className={desktopToolbarButtonClassName}
                data-testid="view-info-trigger"
              >
                <Info className="size-4" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>What this view shows</DialogTitle>
                <DialogDescription>
                  The rendered workspace the platform agent would mount for the
                  current selection, computed through the same resolver the
                  runtime uses. Open the capability list for the full effective
                  set and its gate reasons.
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
                  <span className="font-medium">Filters:</span> all states
                  {searchValue ? ` · search "${searchValue}"` : ""}
                </p>
                <p className="text-muted-foreground">
                  Skill folders in the tree carry their capability state —
                  active or the exact gate that dropped them (trust gate, eval
                  gate, OAuth, policy…). The capability list adds every other
                  class and the not-installed tenant pool you can attach.
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
  );

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col px-4 py-6">
      <div className="shrink-0">
        <SettingsHeader
          title="Composer"
          actions={composerHeaderActions}
          actionKey="composer-header-actions"
          description="What the platform agent will actually get for a selection — the rendered workspace as a normal editor, with every skill, tool, MCP server, extension, and plugin one click away in the capability list. Right-click a skill folder to attach or detach; every action ends on the item's live state."
        />
      </div>

      <div
        className="mb-4 flex shrink-0 flex-wrap items-center gap-2"
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
      </div>

      {/* No persistent confirmation banner — the live tree + sheet state (and,
          on failure, a toast) already show the result. The `confirmation` state
          is retained only to drive the post-attach sync-pending ghost + refetch
          (below), never a rendered row. */}

      {/* The Composer editor shell (v1.1 item 1): the rendered workspace as a
          normal left-tree + CodeMirror editor. Profile-invariant by design —
          the Profile token is deliberately NOT passed (R4). */}
      <div className="flex min-h-0 flex-1">
        <ComposerWorkspaceEditor
          tenantId={tenantId ?? ""}
          spaceId={spaceId}
          perspectiveUserId={perspectiveUserId}
          refreshToken={previewRefreshToken}
          pendingSkillSlug={pendingSkillSlug}
          removingSkillSlug={removingSkillSlug}
          onFocusCapabilityRow={focusCapabilityRow}
          skillStateBySlug={skillStateBySlug}
          canManageSkills={writeScope}
          profileScopeName={selectedProfileName}
          onAddSkill={() => setAddSkillOpen(true)}
          onDetachSkill={requestDetachSkill}
          mcpStateBySlug={mcpStateBySlug}
          pendingMcpSlug={pendingMcpSlug}
          removingMcpSlug={removingMcpSlug}
          onAddMcpServer={() => setAddMcpOpen(true)}
          onDetachMcpServer={requestDetachMcp}
          initialSelectedPath={initialTreeFile}
          onConfigureAgentProfile={(slug) => {
            const match = (profilesResult.data?.agentProfiles ?? []).find(
              (profile) => profile.slug === slug,
            );
            requestSheet("profiles", { profileId: match?.id ?? null });
          }}
        />
      </div>

      <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {predicted ? (
          <span>
            Computed {new Date(predicted.computedAt).toLocaleString()} ·
            fingerprint{" "}
            <span className="font-mono">
              {predicted.configFingerprint.slice(0, 12)}
            </span>
          </span>
        ) : null}
        {divergenceChip()}
        {extraInObserved.length > 0 ? (
          <span data-testid="extra-in-observed">
            +{extraInObserved.length} loaded at runtime only:{" "}
            {extraInObserved.map((delta) => delta.capabilityId).join(", ")}
          </span>
        ) : null}
      </div>

      <AgentProfilesSheet
        open={profilesSheet.open}
        onOpenChange={(open) =>
          requestSheet(
            open ? "profiles" : null,
            open ? { profileId: profilesSheet.profileId } : undefined,
          )
        }
        initialProfileId={profilesSheet.profileId}
      />

      {/* Capability Side Sheet (v1.1 item 2): the class tabs + rows + attach/
          detach controls, opened from the toolbar or via tree jump-to-cause. */}
      <AgentConfigSheet
        open={configOpen}
        onOpenChange={(open) => requestSheet(open ? "config" : null)}
        spaces={(spacesResult.data?.spaces ?? []).map((space) => ({
          id: space.id,
          name: space.name,
        }))}
      />
      <Sheet
        open={extensionsSheetOpen}
        onOpenChange={(open) => requestSheet(open ? "extensions" : null)}
      >
        <SheetContent
          className="flex w-full flex-col gap-0 overflow-y-auto data-[side=right]:w-[min(680px,calc(100vw-2rem))] data-[side=right]:sm:max-w-none"
          data-testid="agent-extensions-sheet"
        >
          <SheetHeader className="px-6">
            <SheetTitle>Extensions</SheetTitle>
            <SheetDescription>
              Import, review, and assign Pi extensions — the trust registry
              for code that runs inside the agent.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-3 pb-8">
            <SettingsAgentExtensions
              tenantId={tenantId ?? ""}
              extensions={registryExtensions}
              profiles={(profilesResult.data?.agentProfiles ?? []).map(
                (profile) => ({
                  id: profile.id,
                  name: profile.name,
                  slug: profile.slug,
                }),
              )}
              fetching={registryExtensionsResult.fetching}
              errorMessage={registryExtensionsResult.error?.message}
              onChanged={() => {
                refetchRegistryExtensions({ requestPolicy: "network-only" });
                refetchExtensions({ requestPolicy: "network-only" });
                refetchInspection({ requestPolicy: "network-only" });
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={inspectorOpen}
        onOpenChange={(open) => requestSheet(open ? "inspector" : null)}
      >
        <SheetContent
          className="flex w-full flex-col gap-0 overflow-y-auto data-[side=right]:w-[min(680px,calc(100vw-2rem))] data-[side=right]:sm:max-w-none"
          data-testid="inspector-sheet"
        >
          <SheetHeader className="px-6">
            <SheetTitle>Inspector</SheetTitle>
            <SheetDescription>
              Read-only view of the effective capability set for the current
              selection — gate reasons and runtime divergence, no writes.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-3 pb-8">
            <CapabilityInspectorView
              items={items}
              deltas={deltas}
              loading={loading}
              focusRowKey={urlFocus}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
          data-testid="capability-sheet"
        >
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle>Capabilities</SheetTitle>
            <SheetDescription>
              The effective set for this selection — every class, with the exact
              gate on inactive rows. Attach from the tenant pool or detach
              directly.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {loading ? (
              <div className="space-y-3" data-testid="capability-loading">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : inspection.error ? (
              <p className="text-sm text-destructive">
                Couldn&apos;t load the capability set:{" "}
                {inspection.error.message}
              </p>
            ) : result?.state === "invalid_selection" ? (
              <p
                className="text-sm text-destructive"
                data-testid="invalid-selection"
              >
                Invalid selection: {result.stateDetail}
              </p>
            ) : result?.state === "resolution_fault" ? (
              <p
                className="text-sm text-destructive"
                data-testid="resolution-fault"
              >
                Resolution fault — this selection could not be composed:{" "}
                {result.stateDetail}
              </p>
            ) : predicted ? (
              <>
                <Tabs value={activeTab} onValueChange={setActiveClass}>
                  <TabsList className="mb-3 flex-wrap">
                    {tabClasses.map((capabilityClass) => {
                      const classItems = allByClass.get(capabilityClass) ?? [];
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
                          {/* Active/total (v1.1 item 3): "Skills 2/27". */}
                          <span className="ml-1.5 text-xs font-semibold text-primary">
                            {activeCount}/{classItems.length}
                          </span>
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                </Tabs>

                {/* Pi-extension assignment folded in from the retired Agents →
                    Extensions surface (plan U8): the version-picker + attach
                    live in the Add dialog; per-row detach is in rowActions. */}
                {activeTab === "pi_extension" && writeScope ? (
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {agentProfileId
                        ? "Assign an approved Pi extension to this agent profile."
                        : "Assign an approved Pi extension to the Agent."}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAddExtensionOpen(true)}
                      data-testid="open-add-extension"
                    >
                      Add extension
                    </Button>
                  </div>
                ) : null}

                <SettingsSection>
                  {visibleItems.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-muted-foreground">
                      {activeTab === "pi_extension"
                        ? "No Pi extensions assigned for this selection."
                        : "Nothing in this category for the current selection."}
                    </p>
                  ) : (
                    visibleItems.map((item) => (
                      <div
                        key={rowKeyOf(item)}
                        className={cn(
                          "flex flex-col gap-1 border-b border-border px-4 py-3 last:border-b-0",
                          focusedRowKey === rowKeyOf(item) &&
                            "bg-primary/5 ring-1 ring-inset ring-primary/40",
                        )}
                        data-testid={
                          focusedRowKey === rowKeyOf(item)
                            ? "capability-row-focused"
                            : "capability-row"
                        }
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
                            {deltaByRowKey.has(rowKeyOf(item)) ? (
                              <Badge
                                variant="destructive"
                                data-testid={`delta-${rowKeyOf(item)}`}
                              >
                                not loaded last turn
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
              </>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      {/* Add-skill picker (v1.1 item 4): the not-installed / gated tenant pool. */}
      <Dialog open={addSkillOpen} onOpenChange={setAddSkillOpen}>
        <DialogContent data-testid="add-skill-dialog">
          <DialogHeader>
            <DialogTitle>Add a skill</DialogTitle>
            <DialogDescription>
              Skills in the tenant pool that aren&apos;t installed on this
              agent. Attaching ends on the skill&apos;s live state — an honest
              gate reason shows if it&apos;s held.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto">
            {addSkillPool.length === 0 ? (
              <p className="px-1 py-6 text-sm text-muted-foreground">
                Every catalog skill is already installed for this selection.
              </p>
            ) : (
              addSkillPool.map((item) => (
                <div
                  key={rowKeyOf(item)}
                  className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0"
                  data-testid={`add-skill-row-${item.capabilityId}`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {item.displayName || item.capabilityId}
                    </p>
                    {item.detail ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {item.detail}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {stateChip(item)}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pendingRow !== null}
                      onClick={() => void pickSkillToAdd(item)}
                      data-testid={`add-skill-pick-${item.capabilityId}`}
                    >
                      Add
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAddSkillOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add-MCP-server picker (U9c): the tenant's registered MCP servers from
          the inspector's mcp_server rows — state shown verbatim (incl. token
          status); Add is disabled on already-attached rows. */}
      <Dialog open={addMcpOpen} onOpenChange={setAddMcpOpen}>
        <DialogContent data-testid="add-mcp-dialog">
          <DialogHeader>
            <DialogTitle>Add an MCP server</DialogTitle>
            <DialogDescription>
              MCP servers registered for this tenant. Attaching ends on the
              server&apos;s live state — an honest gate reason (OAuth,
              activation…) shows if it&apos;s held.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto">
            {addMcpPool.length === 0 ? (
              <p className="px-1 py-6 text-sm text-muted-foreground">
                No MCP servers are registered for this tenant.{" "}
                <Link
                  to="/settings/mcp-servers"
                  className="text-foreground underline underline-offset-2"
                  data-testid="add-mcp-empty-registry-link"
                >
                  Register one in MCP Servers
                </Link>
                .
              </p>
            ) : (
              addMcpPool.map((item) => (
                <div
                  key={rowKeyOf(item)}
                  className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0"
                  data-testid={`add-mcp-row-${item.capabilityId}`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {item.displayName || item.capabilityId}
                    </p>
                    {item.detail ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {item.detail}
                      </p>
                    ) : null}
                  </div>
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
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pendingRow !== null || item.active}
                      onClick={() => void pickMcpToAdd(item)}
                      data-testid={`add-mcp-pick-${item.capabilityId}`}
                    >
                      {item.active ? "Attached" : "Add"}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAddMcpOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add-Pi-extension picker (plan U8): approved extensions not yet assigned
          at the current scope, each with a version picker (default latest) —
          the version identity comes from the registry data, not the schema. */}
      <Dialog open={addExtensionOpen} onOpenChange={setAddExtensionOpen}>
        <DialogContent data-testid="add-extension-dialog">
          <DialogHeader>
            <DialogTitle>Add a Pi extension</DialogTitle>
            <DialogDescription>
              Approved Pi extensions in this tenant. Pick the version to assign
              — the latest approved version is selected by default.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto">
            {attachableExtensionGroups.length === 0 ? (
              <p className="px-1 py-6 text-sm text-muted-foreground">
                {extensionGroups.length === 0
                  ? "No approved Pi extensions. Import and approve one in the Skill Library → Extensions registry."
                  : "Every approved Pi extension is already assigned for this selection."}
              </p>
            ) : (
              attachableExtensionGroups.map((group) => {
                const selectedVersionId =
                  extensionVersionChoice[group.sourceId] ??
                  group.versions[0]?.id ??
                  "";
                return (
                  <div
                    key={group.sourceId}
                    className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0"
                    data-testid={`add-extension-row-${group.sourceId}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {group.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {group.versions.length}{" "}
                        {group.versions.length === 1 ? "version" : "versions"}{" "}
                        approved
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Select
                        value={selectedVersionId}
                        onValueChange={(value) =>
                          setExtensionVersionChoice((current) => ({
                            ...current,
                            [group.sourceId]: value,
                          }))
                        }
                      >
                        <SelectTrigger
                          className="h-8 w-44"
                          data-testid={`add-extension-version-${group.sourceId}`}
                        >
                          <SelectValue placeholder="Version" />
                        </SelectTrigger>
                        <SelectContent>
                          {group.versions.map((version) => (
                            <SelectItem key={version.id} value={version.id}>
                              {extensionVersionLabel(version)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pendingRow !== null}
                        onClick={() => void pickExtensionToAdd(group)}
                        data-testid={`add-extension-pick-${group.sourceId}`}
                      >
                        Add
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAddExtensionOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tree context-menu detach confirm (v1.1 item 4; U9c adds mcp): the SAME
          destructive gate the Sheet rows use, driving the SAME detach mutation. */}
      <AlertDialog
        open={detachTarget !== null}
        onOpenChange={(open) => !open && setDetachTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Detach {detachTarget?.displayName || detachTarget?.capabilityId}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {detachTarget?.capabilityClass === "mcp_server"
                ? "Removes this server's assignment from the agent (its mcp/ folder disappears from the workspace)."
                : "Removes the installed skill folder from the agent workspace and strips its CONTEXT.md wiring."}{" "}
              The post-detach state is shown before you leave.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendingRow !== null}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={pendingRow !== null}
              onClick={() => void confirmDetachFromTree()}
              data-testid="tree-detach-confirm"
            >
              Detach
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
