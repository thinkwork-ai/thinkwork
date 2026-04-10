/**
 * Rollback button for the agent detail header.
 *
 * Shows a dropdown of recent version snapshots (created when a class sync
 * was applied, or a manual rollback happened). Clicking one confirms and
 * restores the agent's skills, knowledge bases, workspace files, and role
 * from that snapshot.
 *
 * Hidden when the agent has no snapshots.
 */

import { useState } from "react";
import { useQuery, useMutation } from "urql";
import { toast } from "sonner";
import { History, Loader2, RotateCcw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  AgentVersionsQuery,
  RollbackAgentVersionMutation,
} from "@/lib/graphql-queries";

interface Props {
  agentId: string;
  onRollback?: () => void;
}

export function AgentRollbackButton({ agentId, onRollback }: Props) {
  const [{ data }, refetch] = useQuery({
    query: AgentVersionsQuery,
    variables: { agentId, limit: 10 },
  });
  const [{ fetching: rolling }, rollback] = useMutation(RollbackAgentVersionMutation);

  const [confirmVersion, setConfirmVersion] = useState<any | null>(null);

  const versions = data?.agentVersions ?? [];
  if (versions.length === 0) return null;

  const handleConfirm = async () => {
    if (!confirmVersion) return;
    const res = await rollback({ agentId, versionId: confirmVersion.id });
    if (res.error) {
      toast.error(`Rollback failed: ${res.error.message}`);
      return;
    }
    toast.success(`Rolled back to v${confirmVersion.versionNumber}`);
    setConfirmVersion(null);
    refetch({ requestPolicy: "network-only" });
    onRollback?.();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Badge variant="outline" className="gap-1 cursor-pointer hover:bg-accent">
            <History className="h-3 w-3" />
            {versions.length} version{versions.length === 1 ? "" : "s"}
          </Badge>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>Recent snapshots</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {versions.map((v: any) => (
            <DropdownMenuItem
              key={v.id}
              onClick={() => setConfirmVersion(v)}
              className="flex flex-col items-start gap-0.5"
            >
              <div className="flex items-center gap-2 w-full">
                <RotateCcw className="h-3 w-3" />
                <span className="font-medium">v{v.versionNumber}</span>
                {v.label && (
                  <span className="text-xs text-muted-foreground truncate">
                    {v.label}
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground pl-5">
                {new Date(v.createdAt).toLocaleString()}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={!!confirmVersion}
        onOpenChange={(o) => !o && setConfirmVersion(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Roll back to v{confirmVersion?.versionNumber}?</DialogTitle>
            <DialogDescription>
              This restores the agent's role, skills, knowledge bases, and
              workspace files from this snapshot. The current state will be
              snapshotted first so you can roll forward again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmVersion(null)}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={rolling}>
              {rolling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              Roll back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
