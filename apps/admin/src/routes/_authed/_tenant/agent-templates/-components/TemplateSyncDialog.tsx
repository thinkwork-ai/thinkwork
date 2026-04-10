import { useMutation } from "urql";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, Users, Eye, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SyncTemplateToAllAgentsMutation } from "@/lib/graphql-queries";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  templateName: string;
  linkedAgentCount: number;
}

/**
 * Shown after a template save when N agents are linked to the template.
 * Lets the admin push changes to all linked agents, review per-agent,
 * or skip for now.
 *
 * Note: `model`, `guardrail`, and `blocked_tools` propagate live via FK lookup
 * regardless of this choice — only skills/KBs/workspace/role need syncing.
 */
export function TemplateSyncDialog({
  open,
  onOpenChange,
  templateId,
  templateName,
  linkedAgentCount,
}: Props) {
  const navigate = useNavigate();
  const [{ fetching }, syncAll] = useMutation(SyncTemplateToAllAgentsMutation);

  const handlePushAll = async () => {
    const res = await syncAll({ templateId });
    if (res.error) {
      toast.error(`Sync failed: ${res.error.message}`);
      return;
    }
    const summary = res.data?.syncTemplateToAllAgents;
    if (!summary) {
      toast.error("Sync returned no result");
      return;
    }
    if (summary.agentsFailed > 0) {
      toast.warning(
        `Synced ${summary.agentsSynced}/${linkedAgentCount} agents. ${summary.agentsFailed} failed.`,
        { description: summary.errors.slice(0, 3).join("\n") },
      );
    } else {
      toast.success(`Synced ${summary.agentsSynced} agent${summary.agentsSynced === 1 ? "" : "s"}`);
    }
    onOpenChange(false);
  };

  const handleReviewEach = () => {
    onOpenChange(false);
    navigate({
      to: "/agent-templates/$templateId/sync",
      params: { templateId },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Propagate changes to linked agents?
          </DialogTitle>
          <DialogDescription>
            <strong>{linkedAgentCount}</strong> agent{linkedAgentCount === 1 ? "" : "s"}{" "}
            inherit from <strong>{templateName}</strong>. Skills, knowledge bases,
            workspace files, and role are copied at creation time, so template edits
            don't reach them automatically.
            <br />
            <br />
            <span className="text-xs text-muted-foreground">
              Note: model, guardrail, and blocked tools propagate live — those are
              already applied to all linked agents.
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 pt-2">
          <Button onClick={handlePushAll} disabled={fetching} className="justify-start">
            {fetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Users className="h-4 w-4" />
            )}
            Push to all {linkedAgentCount}
            <span className="ml-auto text-xs text-muted-foreground">
              Snapshots each agent first (rollback-safe)
            </span>
          </Button>

          <Button
            onClick={handleReviewEach}
            variant="outline"
            disabled={fetching}
            className="justify-start"
          >
            <Eye className="h-4 w-4" />
            Review each agent
            <span className="ml-auto text-xs text-muted-foreground">
              See diff before applying
            </span>
          </Button>

          <Button
            onClick={() => onOpenChange(false)}
            variant="ghost"
            disabled={fetching}
            className="justify-start"
          >
            <X className="h-4 w-4" />
            Skip for now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
