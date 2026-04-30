import { Badge } from "@/components/ui/badge";
import type {
  ContextProviderStatus,
  ContextProviderSummary,
} from "@/lib/context-engine-api";

type Props = {
  providers: ContextProviderSummary[];
  statuses?: ContextProviderStatus[];
};

export function ContextEngineSubAgentPanel({
  providers,
  statuses = [],
}: Props) {
  const subAgents = providers.filter(
    (provider) => provider.family === "sub-agent",
  );
  if (subAgents.length === 0) return null;
  const liveCount = subAgents.filter(
    (provider) => provider.subAgent?.seamState === "live",
  ).length;
  const plannedCount = subAgents.length - liveCount;
  const statusById = new Map(
    statuses.map((status) => [status.providerId, status]),
  );

  return (
    <section className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Company Brain source agents</h2>
        <div className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className="bg-green-500/15 text-[11px] text-green-700 dark:text-green-400"
          >
            {liveCount} live
          </Badge>
          {plannedCount > 0 && (
            <Badge
              variant="secondary"
              className="bg-amber-500/15 text-[11px] text-amber-700 dark:text-amber-400"
            >
              {plannedCount} planned
            </Badge>
          )}
        </div>
      </div>
      <div className="divide-y rounded-md border">
        {subAgents.map((provider) => {
          const status = statusById.get(provider.id);
          const state = status?.state ?? provider.lastTestState ?? "not tested";
          const isLive = provider.subAgent?.seamState === "live";
          return (
            <div
              key={provider.id}
              className="grid gap-2 px-3 py-2 text-sm md:grid-cols-[minmax(0,1fr)_7rem_7rem_10rem]"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{provider.displayName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {status?.reason ||
                    status?.error ||
                    (isLive
                      ? "hybrid lexical page search"
                      : "connector and tools not wired yet")}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {status?.hitCount ?? 0} hits
              </span>
              <span className="text-xs text-muted-foreground">
                {status?.durationMs != null
                  ? `${status.durationMs.toLocaleString()} ms`
                  : "no recent query"}
              </span>
              <Badge
                variant="outline"
                className={`w-fit text-[11px] ${
                  isLive
                    ? "border-green-500/30 text-green-700 dark:text-green-400"
                    : "border-amber-500/30 text-amber-700 dark:text-amber-400"
                }`}
              >
                {isLive ? "live" : state === "ok" ? "live" : "planned"}
              </Badge>
            </div>
          );
        })}
      </div>
    </section>
  );
}
