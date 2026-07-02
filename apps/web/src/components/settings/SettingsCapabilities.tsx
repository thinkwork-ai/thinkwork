/**
 * Capability inspector page (capability-mapping plan U4).
 *
 * Renders the effective merged capability set for a selection — space,
 * agent profile, perspective user — grouped by capability class, with a
 * per-row state chip (active / inactive+reason / degraded) and provenance
 * line. Point-in-time semantics: results carry `computedAt` and are only
 * refreshed by selector changes or the explicit refresh action; selector
 * changes show an in-flight state so a stale result is never readable as
 * current.
 */

import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useQuery } from "urql";
import {
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
import {
  SettingsAgentProfilesQuery,
  SettingsCapabilityInspectorQuery,
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

  const loading = inspection.fetching;
  const result = inspection.data?.capabilityInspector;
  const predicted = result?.predicted ?? null;

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
        description="What the platform agent will actually get for a selection — every skill, tool, MCP server, extension, and plugin with its provenance and, when inactive, the exact gate that dropped it."
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
