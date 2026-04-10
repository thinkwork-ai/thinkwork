import { useQuery } from "urql";
import { Link } from "@tanstack/react-router";
import { Bot, ExternalLink, Loader2 } from "lucide-react";
import { AgentDetailQuery } from "@/lib/graphql-queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

interface AgentDetailSheetProps {
  agentId: string | null;
  open: boolean;
  onClose: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500/20 text-emerald-400",
  inactive: "bg-zinc-500/20 text-zinc-400",
  error: "bg-red-500/20 text-red-400",
};

export function AgentDetailSheet({ agentId, open, onClose }: AgentDetailSheetProps) {
  const [result] = useQuery({
    query: AgentDetailQuery,
    variables: { id: agentId! },
    pause: !agentId,
  });

  const agent = (result.data as any)?.agent;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="sm:max-w-lg flex flex-col">
        <SheetHeader className="p-6 pb-0">
          <SheetTitle className="flex items-center gap-2">
            {agent?.avatarUrl ? (
              <img src={agent.avatarUrl} className="h-6 w-6 rounded-full" alt="" />
            ) : (
              <Bot className="h-5 w-5 text-muted-foreground" />
            )}
            {agent?.name ?? "Loading..."}
            {agent?.status && (
              <Badge className={`font-normal text-xs ${STATUS_COLORS[agent.status] ?? "bg-muted text-muted-foreground"}`}>
                {agent.status}
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            {agent?.role || "Agent"}
            {(agent as any)?.agentTemplate?.model && ` \u00b7 ${(agent as any).agentTemplate.model}`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 pt-4 space-y-5">
          {result.fetching && !agent ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : agent ? (
            <>
              {/* Info grid */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Slug</p>
                  <p className="font-mono text-xs">{agent.slug}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Type</p>
                  <p>{agent.type || "\u2014"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Adapter</p>
                  <p>{agent.adapterType || "\u2014"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Version</p>
                  <p>{agent.version ?? "\u2014"}</p>
                </div>
                {agent.humanPair && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground mb-0.5">Human Pair</p>
                    <p>{agent.humanPair.name} ({agent.humanPair.email})</p>
                  </div>
                )}
                {agent.budgetPolicy?.enabled && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground mb-0.5">Budget</p>
                    <p>${agent.budgetPolicy.limitUsd} \u00b7 {agent.budgetPolicy.actionOnExceed}</p>
                  </div>
                )}
              </div>

              {/* Skills */}
              {agent.skills?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Skills</p>
                  <div className="flex flex-wrap gap-1.5">
                    {agent.skills.filter((s: any) => s.enabled).map((s: any) => (
                      <Badge key={s.id} variant="outline" className="text-xs font-normal">
                        {s.skillId}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Sub-agents */}
              {agent.subAgents?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Sub-agents</p>
                  <div className="space-y-1.5">
                    {agent.subAgents.map((sa: any) => (
                      <div key={sa.id} className="flex items-center gap-2 text-sm rounded-md bg-muted/30 px-3 py-2">
                        <Badge variant="outline" className="text-[10px] shrink-0 border-violet-500/30 text-violet-400">Agent</Badge>
                        <span className="font-medium truncate">{sa.name}</span>
                        <span className="text-xs text-muted-foreground ml-auto">{sa.role}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Link to full detail */}
              <div className="pt-2">
                <Link to={`/agents/${agent.id}`} onClick={onClose}>
                  <Button variant="outline" size="sm" className="w-full">
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                    Open Agent Detail
                  </Button>
                </Link>
              </div>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
