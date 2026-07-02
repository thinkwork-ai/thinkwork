/**
 * Capabilities area (capability-mapping plan U4 + U8).
 *
 * One operator door: the effective merged capability set for a selection —
 * space, agent profile, perspective user — grouped by capability class,
 * with a per-row state chip (active / inactive+reason / degraded) and
 * provenance line. Point-in-time semantics: results carry `computedAt` and
 * are only refreshed by selector changes or the explicit refresh action.
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
import { RefreshCw } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
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

const ANY_VALUE = "__any__";

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

export function SettingsCapabilities() {
  const { tenantId } = useTenant();
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [agentProfileId, setAgentProfileId] = useState<string | null>(null);
  const [perspectiveUserId, setPerspectiveUserId] = useState<string | null>(
    null,
  );
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
    const row = (predicted?.items ?? []).find(
      (item) => rowKeyOf(item) === confirmation.rowKey,
    );
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
  }, [confirmation, predicted?.items, refetchInspection]);

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

  const grouped = useMemo(() => {
    const byClass = new Map<string, InspectorItem[]>();
    for (const item of predicted?.items ?? []) {
      const list = byClass.get(item.capabilityClass) ?? [];
      list.push(item);
      byClass.set(item.capabilityClass, list);
    }
    const orderOf = (capabilityClass: string) => {
      const index = CLASS_ORDER.indexOf(capabilityClass);
      return index === -1 ? CLASS_ORDER.length : index;
    };
    return [...byClass.entries()].sort(([a], [b]) => orderOf(a) - orderOf(b));
  }, [predicted?.items]);

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

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <SettingsHeader
        title="Capabilities"
        description="What the platform agent will actually get for a selection — every skill, tool, MCP server, extension, and plugin with its provenance and, when inactive, the exact gate that dropped it. Attach from the tenant pool or detach directly; every action ends on the item's live state."
      />

      <div
        className="mb-6 flex flex-wrap items-end gap-3"
        data-testid="capability-selectors"
      >
        <div className="min-w-44">
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Space
          </p>
          <Select
            value={spaceId ?? ANY_VALUE}
            onValueChange={(value) =>
              setSpaceId(value === ANY_VALUE ? null : value)
            }
            disabled={loading}
          >
            <SelectTrigger aria-label="Space">
              <SelectValue placeholder="No space (agent baseline)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_VALUE}>No space</SelectItem>
              {(spacesResult.data?.spaces ?? []).map((space) => (
                <SelectItem key={space.id} value={space.id}>
                  {space.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-44">
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Agent profile
          </p>
          <Select
            value={agentProfileId ?? ANY_VALUE}
            onValueChange={(value) =>
              setAgentProfileId(value === ANY_VALUE ? null : value)
            }
            disabled={loading}
          >
            <SelectTrigger aria-label="Agent profile">
              <SelectValue placeholder="Default agent" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_VALUE}>Default agent</SelectItem>
              {(profilesResult.data?.agentProfiles ?? []).map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-44">
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Perspective user
          </p>
          <Select
            value={perspectiveUserId ?? ANY_VALUE}
            onValueChange={(value) =>
              setPerspectiveUserId(value === ANY_VALUE ? null : value)
            }
            disabled={loading}
          >
            <SelectTrigger aria-label="Perspective user">
              <SelectValue placeholder="No user (scheduled-turn baseline)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_VALUE}>
                No user (scheduled-turn baseline)
              </SelectItem>
              {members.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {member.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetchInspection({ requestPolicy: "network-only" })}
          disabled={loading}
        >
          <RefreshCw
            className={cn("mr-1.5 size-3.5", loading && "animate-spin")}
          />
          Refresh
        </Button>
      </div>

      {result?.noUserBaseline && !loading ? (
        <p
          className="mb-4 text-sm text-muted-foreground"
          data-testid="baseline-note"
        >
          Showing the no-user baseline — exactly what a scheduled or wakeup turn
          gets: plugin per-user servers excluded, direct OAuth via the
          agent&apos;s human pair.
        </p>
      ) : null}

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
          {grouped.map(([capabilityClass, items]) => (
            <SettingsSection
              key={capabilityClass}
              label={CLASS_LABELS[capabilityClass] ?? capabilityClass}
            >
              {items.map((item) => (
                <div
                  key={`${item.capabilityClass}:${item.capabilityId}`}
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
              ))}
            </SettingsSection>
          ))}
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
