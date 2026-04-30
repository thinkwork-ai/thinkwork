import { Badge } from "@/components/ui/badge";
import type {
  ContextProviderStatus,
  ContextProviderSummary,
} from "@/lib/context-engine-api";

type Props = {
  providers: ContextProviderSummary[];
  statuses?: ContextProviderStatus[];
};

export function ContextEngineSubAgentPanel({ providers, statuses = [] }: Props) {
  const subAgents = providers.filter((provider) => provider.family === "sub-agent");
  if (subAgents.length === 0) return null;
  const statusById = new Map(statuses.map((status) => [status.providerId, status]));

  return (
    <section className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Sub-agent providers</h2>
        <Badge variant="secondary" className="text-[11px]">
          {subAgents.length} adapters
        </Badge>
      </div>
      <div className="divide-y rounded-md border">
        {subAgents.map((provider) => {
          const status = statusById.get(provider.id);
          const state = status?.state ?? provider.lastTestState ?? "not tested";
          return (
            <div
              key={provider.id}
              className="grid gap-2 px-3 py-2 text-sm md:grid-cols-[minmax(0,1fr)_7rem_7rem_10rem]"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{provider.displayName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {status?.reason || status?.error || "inert seam (v0)"}
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
              <Badge variant="outline" className="w-fit text-[11px]">
                {state}
              </Badge>
            </div>
          );
        })}
      </div>
    </section>
  );
}
