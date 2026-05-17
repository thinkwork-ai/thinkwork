import { Loader2, Trash2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
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
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@thinkwork/ui";
import {
  STRATEGY_COLORS,
  parseMemoryTopics,
  strategyLabel,
} from "@/lib/memory-strategy";

export type MemoryRow = {
  memoryRecordId: string;
  text: string;
  createdAt: string | null;
  updatedAt: string | null;
  namespace: string | null;
  strategy: string | null;
  factType: string | null;
  confidence: number | null;
  eventDate: string | null;
  occurredStart: string | null;
  occurredEnd: string | null;
  mentionedAt: string | null;
  tags: string[] | null;
  accessCount: number;
  proofCount: number | null;
  context: string | null;
  threadId: string | null;
};

interface MemoryDetailSheetProps {
  record: MemoryRow;
  deleting: boolean;
  onForget: () => Promise<void>;
}

function StrategyBadge({ strategy }: { strategy: string | null }) {
  if (!strategy) return null;
  const colors = STRATEGY_COLORS[strategy] || "bg-muted text-muted-foreground";
  return (
    <Badge className={`${colors} font-normal text-xs`}>
      {strategyLabel(strategy)}
    </Badge>
  );
}

function MemoryContent({ text }: { text: string }) {
  const sections = parseMemoryTopics(text);
  return (
    <div className="space-y-3">
      {sections.map((s, i) => (
        <div key={i}>
          {s.topic && (
            <p className="font-medium text-xs text-muted-foreground uppercase tracking-wider mb-1">
              {s.topic}
            </p>
          )}
          <p className="text-sm whitespace-pre-wrap leading-relaxed">
            {s.content}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * Read-only memory record detail sheet for apps/computer's Brain tab.
 * Unlike admin's version this drops the edit/save flow entirely — the
 * only write action is Forget (delete). See plan
 * docs/plans/2026-05-09-003-feat-computer-memory-ui-port-plan.md U5.
 */
export function MemoryDetailSheet({
  record,
  deleting,
  onForget,
}: MemoryDetailSheetProps) {
  return (
    <SheetContent className="sm:max-w-lg flex flex-col">
      <SheetHeader className="p-6 pb-0">
        <SheetTitle>Memory Detail</SheetTitle>
        <SheetDescription>
          {record.createdAt
            ? `Created ${new Date(record.createdAt).toLocaleDateString(
                "en-US",
                {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                },
              )}`
            : "Memory record"}
        </SheetDescription>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto px-6 pt-4">
        <div className="space-y-4">
          {record.factType && (
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                {record.factType}
              </p>
              <StrategyBadge strategy={record.strategy} />
            </div>
          )}
          <MemoryContent text={record.text} />

          {record.threadId && (
            <Link
              to="/threads/$id"
              params={{ id: record.threadId }}
              className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 hover:underline"
            >
              View source thread →
            </Link>
          )}

          <div className="border-t border-muted pt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3 text-xs">
              {record.confidence != null && (
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider font-medium">
                    Confidence
                  </p>
                  <p className="mt-0.5">
                    {(record.confidence * 100).toFixed(0)}%
                  </p>
                </div>
              )}
              {record.accessCount > 0 && (
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider font-medium">
                    Access Count
                  </p>
                  <p className="mt-0.5">{record.accessCount}</p>
                </div>
              )}
              {record.proofCount != null && (
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider font-medium">
                    Proof Count
                  </p>
                  <p className="mt-0.5">{record.proofCount}</p>
                </div>
              )}
              {record.context && (
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider font-medium">
                    Context
                  </p>
                  <p className="mt-0.5 truncate">{record.context}</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              {record.eventDate && (
                <DateField label="Event Date" iso={record.eventDate} />
              )}
              {record.mentionedAt && (
                <DateField label="Mentioned At" iso={record.mentionedAt} />
              )}
              {record.occurredStart && (
                <DateField label="Occurred Start" iso={record.occurredStart} />
              )}
              {record.occurredEnd && (
                <DateField label="Occurred End" iso={record.occurredEnd} />
              )}
            </div>

            {record.tags && record.tags.length > 0 && (
              <div className="text-xs">
                <p className="text-muted-foreground uppercase tracking-wider font-medium mb-1">
                  Tags
                </p>
                <div className="flex flex-wrap gap-1">
                  {record.tags.map((t) => (
                    <Badge
                      key={t}
                      variant="outline"
                      className="font-normal text-xs"
                    >
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-muted pt-4">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={deleting}>
                  {deleting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Forget
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Forget this memory?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This requester memory will no longer be recalled in future
                    threads. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onForget}>
                    Forget
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>
    </SheetContent>
  );
}

function DateField({ label, iso }: { label: string; iso: string }) {
  return (
    <div>
      <p className="text-muted-foreground uppercase tracking-wider font-medium">
        {label}
      </p>
      <p className="mt-0.5">
        {new Date(iso).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </p>
    </div>
  );
}
