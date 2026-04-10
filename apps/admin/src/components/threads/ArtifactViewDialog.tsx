import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/StatusBadge";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { relativeTime } from "@/lib/utils";

const TYPE_LABELS: Record<string, string> = {
  DATA_VIEW: "Data View",
  NOTE: "Note",
  REPORT: "Report",
  PLAN: "Plan",
  DRAFT: "Draft",
  DIGEST: "Digest",
};

interface ArtifactViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifact: {
    id: string;
    title: string;
    type: string;
    status: string;
    content?: string | null;
    summary?: string | null;
    createdAt: string;
  } | null;
}

export function ArtifactViewDialog({ open, onOpenChange, artifact }: ArtifactViewDialogProps) {
  if (!artifact) return null;

  const typeLabel = TYPE_LABELS[artifact.type] ?? artifact.type;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[75vw] sm:max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <DialogTitle className="text-lg">{artifact.title}</DialogTitle>
            <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
              {typeLabel}
            </Badge>
            <StatusBadge status={artifact.status} size="sm" />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Created {relativeTime(artifact.createdAt)}
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto mt-4 prose prose-sm dark:prose-invert max-w-none">
          {artifact.content ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {artifact.content}
            </ReactMarkdown>
          ) : artifact.summary ? (
            <p className="text-muted-foreground">{artifact.summary}</p>
          ) : (
            <p className="text-muted-foreground italic">No content available.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
