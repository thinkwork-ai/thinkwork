import { useState } from "react";
import { useQuery, useMutation } from "urql";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Loader2, Check, Zap } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  TemplateSyncDiffQuery,
  SyncTemplateToAgentMutation,
} from "@/lib/graphql-queries";

interface Props {
  templateId: string;
  agentId: string;
  agentName: string;
  agentSlug: string;
  onSynced?: () => void;
}

export function AgentSyncCard({
  templateId,
  agentId,
  agentName,
  agentSlug,
  onSynced,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [synced, setSynced] = useState(false);

  const [{ data, fetching }, refetch] = useQuery({
    query: TemplateSyncDiffQuery,
    variables: { templateId, agentId },
  });
  const [{ fetching: applying }, applySync] = useMutation(SyncTemplateToAgentMutation);

  const diff = data?.templateSyncDiff;
  const permissionsChanges = diff?.permissionsChanges ?? [];
  const hasPermissionsChanges = permissionsChanges.some(
    (p) => p.added.length > 0 || p.removed.length > 0,
  );
  const hasChanges =
    !!diff &&
    (diff.roleChange != null ||
      diff.skillsAdded.length > 0 ||
      diff.skillsRemoved.length > 0 ||
      diff.skillsChanged.length > 0 ||
      diff.kbsAdded.length > 0 ||
      diff.kbsRemoved.length > 0 ||
      diff.filesAdded.length > 0 ||
      diff.filesModified.length > 0 ||
      hasPermissionsChanges);

  const changeCount =
    (diff?.roleChange ? 1 : 0) +
    (diff?.skillsAdded?.length ?? 0) +
    (diff?.skillsRemoved?.length ?? 0) +
    (diff?.skillsChanged?.length ?? 0) +
    (diff?.kbsAdded?.length ?? 0) +
    (diff?.kbsRemoved?.length ?? 0) +
    (diff?.filesAdded?.length ?? 0) +
    (diff?.filesModified?.length ?? 0) +
    permissionsChanges.reduce(
      (n, p) => n + p.added.length + p.removed.length,
      0,
    );

  const handleApply = async () => {
    const res = await applySync({ templateId, agentId });
    if (res.error) {
      toast.error(`Sync failed: ${res.error.message}`);
      return;
    }
    toast.success(`Synced ${agentName}`);
    setSynced(true);
    refetch({ requestPolicy: "network-only" });
    onSynced?.();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <button
            className="flex items-center gap-2 text-left min-w-0 flex-1"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{agentName}</div>
              <div className="text-xs text-muted-foreground truncate">{agentSlug}</div>
            </div>
          </button>

          <div className="flex items-center gap-2 shrink-0">
            {fetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            {!fetching && !hasChanges && (
              <Badge variant="outline" className="gap-1">
                <Check className="h-3 w-3" />
                Up to date
              </Badge>
            )}
            {!fetching && hasChanges && (
              <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30">
                {changeCount} pending
              </Badge>
            )}
            {synced && (
              <Badge variant="outline" className="gap-1 text-green-600">
                <Check className="h-3 w-3" />
                Synced
              </Badge>
            )}
            {hasChanges && !synced && (
              <Button size="sm" onClick={handleApply} disabled={applying}>
                {applying ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Zap className="h-3 w-3" />
                )}
                Apply
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      {expanded && diff && (
        <CardContent className="pt-0 space-y-2 text-xs">
          {diff.roleChange && (
            <DiffSection title="Role">
              <div className="text-muted-foreground">
                <span className="line-through">{diff.roleChange.current || "(none)"}</span>
                {" → "}
                <span className="text-foreground">{diff.roleChange.target || "(none)"}</span>
              </div>
            </DiffSection>
          )}
          {diff.skillsAdded.length > 0 && (
            <DiffSection title="Skills added" tone="add">
              {diff.skillsAdded.join(", ")}
            </DiffSection>
          )}
          {diff.skillsRemoved.length > 0 && (
            <DiffSection title="Skills removed" tone="remove">
              {diff.skillsRemoved.join(", ")}
            </DiffSection>
          )}
          {diff.skillsChanged.length > 0 && (
            <DiffSection title="Skills config changed">
              {diff.skillsChanged.join(", ")}
            </DiffSection>
          )}
          {hasPermissionsChanges && (
            <DiffSection title="Permissions" tone="remove">
              <div className="space-y-1">
                {permissionsChanges.map((p) => {
                  if (p.added.length === 0 && p.removed.length === 0)
                    return null;
                  return (
                    <div key={p.skillId}>
                      <span className="font-medium text-foreground">
                        {p.skillId}
                      </span>
                      {p.removed.length > 0 && (
                        <>
                          {" — losing "}
                          <span className="text-red-600 dark:text-red-400">
                            {p.removed.join(", ")}
                          </span>
                        </>
                      )}
                      {p.added.length > 0 && (
                        <>
                          {p.removed.length > 0 ? "; gaining " : " — gaining "}
                          <span className="text-green-600 dark:text-green-400">
                            {p.added.join(", ")}
                          </span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </DiffSection>
          )}
          {diff.kbsAdded.length > 0 && (
            <DiffSection title="Knowledge bases added" tone="add">
              {diff.kbsAdded.length} KB{diff.kbsAdded.length === 1 ? "" : "s"}
            </DiffSection>
          )}
          {diff.kbsRemoved.length > 0 && (
            <DiffSection title="Knowledge bases removed" tone="remove">
              {diff.kbsRemoved.length} KB{diff.kbsRemoved.length === 1 ? "" : "s"}
            </DiffSection>
          )}
          {diff.filesAdded.length > 0 && (
            <DiffSection title="Workspace files (template has, agent doesn't)" tone="add">
              {diff.filesAdded.join(", ")}
            </DiffSection>
          )}
          {!hasChanges && (
            <div className="text-muted-foreground">No differences between this agent and the template.</div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function DiffSection({
  title,
  children,
  tone,
}: {
  title: string;
  children: React.ReactNode;
  tone?: "add" | "remove";
}) {
  const color =
    tone === "add"
      ? "text-green-600 dark:text-green-400"
      : tone === "remove"
        ? "text-red-600 dark:text-red-400"
        : "text-foreground";
  return (
    <div>
      <div className={`font-medium ${color}`}>{title}</div>
      <div className="text-muted-foreground pl-2">{children}</div>
    </div>
  );
}
