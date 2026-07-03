// Inspector view (Agent page merge, THINK-132 U8): read-only diagnostics over
// the capability inspector result — every class, verbatim gate reasons, and
// runtime-divergence badges. This view carries NO write affordances by
// contract (R14): attach/detach live on the tree and the sheets. It is
// deliberately self-contained rather than a refactor of the capability list,
// which retires separately (U9).
import { useMemo, useState } from "react";
import { Badge, Skeleton, Tabs, TabsList, TabsTrigger, cn } from "@thinkwork/ui";

export type InspectorViewItem = {
  capabilityClass: string;
  capabilityId: string;
  displayName?: string | null;
  active: boolean;
  provenance?: string | null;
  reason?: string | null;
  detail?: string | null;
  tokenStatus?: string | null;
};

export type InspectorViewDelta = {
  capabilityClass: string;
  capabilityId: string;
  kind: string;
};

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

export function inspectorRowKey(item: {
  capabilityClass: string;
  capabilityId: string;
}): string {
  return `${item.capabilityClass}:${item.capabilityId}`;
}

export function CapabilityInspectorView({
  items,
  deltas,
  loading,
  focusRowKey,
}: {
  items: InspectorViewItem[];
  deltas: InspectorViewDelta[];
  loading: boolean;
  /** Row to highlight on open (gate-badge click / jump-to-cause target). */
  focusRowKey?: string | null;
}) {
  const focusClass = focusRowKey ? focusRowKey.split(":")[0] : null;
  const [activeClass, setActiveClass] = useState<string>(
    focusClass && CLASS_ORDER.includes(focusClass) ? focusClass : "skill",
  );

  const missingInObserved = useMemo(
    () =>
      new Set(
        deltas
          .filter((delta) => delta.kind === "missing_in_observed")
          .map((delta) => inspectorRowKey(delta)),
      ),
    [deltas],
  );

  const byClass = useMemo(() => {
    const map = new Map<string, InspectorViewItem[]>();
    for (const item of items) {
      const list = map.get(item.capabilityClass) ?? [];
      list.push(item);
      map.set(item.capabilityClass, list);
    }
    return map;
  }, [items]);

  const rows = byClass.get(activeClass) ?? [];

  if (loading) {
    return (
      <div className="space-y-2 py-2" data-testid="inspector-view-loading">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-2/3" />
      </div>
    );
  }

  return (
    <div data-testid="capability-inspector-view">
      <Tabs value={activeClass} onValueChange={setActiveClass}>
        <TabsList className="h-auto flex-wrap">
          {CLASS_ORDER.map((capabilityClass) => {
            const classRows = byClass.get(capabilityClass) ?? [];
            const activeCount = classRows.filter((row) => row.active).length;
            return (
              <TabsTrigger
                key={capabilityClass}
                value={capabilityClass}
                data-testid={`inspector-tab-${capabilityClass}`}
              >
                {CLASS_LABELS[capabilityClass] ?? capabilityClass}
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {activeCount}/{classRows.length}
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      <div className="mt-3 divide-y divide-border">
        {rows.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            Nothing in this class for the current selection.
          </p>
        ) : (
          rows.map((item) => {
            const rowKey = inspectorRowKey(item);
            const divergent = missingInObserved.has(rowKey);
            return (
              <div
                key={rowKey}
                data-testid={`inspector-row-${rowKey}`}
                className={cn(
                  "flex flex-wrap items-center gap-2 py-2.5",
                  focusRowKey === rowKey && "rounded-md bg-accent/40 px-2",
                )}
              >
                <span className="text-sm font-medium">
                  {item.displayName || item.capabilityId}
                </span>
                <Badge variant={item.active ? "default" : "outline"}>
                  {item.active ? "Active" : "Inactive"}
                </Badge>
                {item.provenance ? (
                  <span className="text-xs text-muted-foreground">
                    {item.provenance}
                  </span>
                ) : null}
                {divergent ? (
                  <Badge
                    variant="destructive"
                    data-testid={`inspector-divergent-${rowKey}`}
                  >
                    Not loaded last turn
                  </Badge>
                ) : null}
                {item.tokenStatus ? (
                  <Badge variant="outline">{item.tokenStatus}</Badge>
                ) : null}
                {item.reason ? (
                  <span
                    className="basis-full text-xs text-muted-foreground"
                    data-testid={`inspector-reason-${rowKey}`}
                  >
                    {item.reason}
                    {item.detail ? ` — ${item.detail}` : ""}
                  </span>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
