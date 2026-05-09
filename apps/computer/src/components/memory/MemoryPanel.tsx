import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@thinkwork/ui";

export interface ComputerMemoryRecord {
  memoryRecordId: string;
  content?: { text?: string | null } | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  namespace?: string | null;
  factType?: string | null;
  confidence?: number | null;
  tags?: string[] | null;
  context?: string | null;
  threadId?: string | null;
}

interface MemoryPanelProps {
  records: ComputerMemoryRecord[];
  isLoading?: boolean;
  error?: string | null;
  deletingId?: string | null;
  onForget?: (recordId: string) => Promise<void> | void;
}

export function MemoryPanel({
  records,
  isLoading = false,
  error,
  deletingId,
  onForget,
}: MemoryPanelProps) {
  const grouped = groupRecords(records);

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-8">
        <header className="grid gap-1">
          <h1 className="text-2xl font-medium tracking-normal">Memory</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Things your Computer can carry across threads.
          </p>
        </header>

        {error ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading memory...</p>
        ) : records.length === 0 ? (
          <div className="rounded-lg border border-border/70 bg-card px-5 py-6 text-sm text-muted-foreground">
            Your Computer has not remembered anything yet.
          </div>
        ) : (
          <div className="grid gap-6">
            {grouped.map((group) => (
              <section key={group.label} className="grid gap-3">
                <h2 className="text-sm font-medium text-muted-foreground">
                  {group.label}
                </h2>
                <div className="grid gap-2">
                  {group.records.map((record) => (
                    <MemoryItemCard
                      key={record.memoryRecordId}
                      record={record}
                      isDeleting={deletingId === record.memoryRecordId}
                      onForget={onForget}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function MemoryItemCard({
  record,
  isDeleting,
  onForget,
}: {
  record: ComputerMemoryRecord;
  isDeleting?: boolean;
  onForget?: (recordId: string) => Promise<void> | void;
}) {
  const [confirming, setConfirming] = useState(false);
  const text = record.content?.text?.trim() || "Untitled memory";

  return (
    <article className="grid gap-3 rounded-lg border border-border/70 bg-card px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-2">
          <p className="text-sm leading-6 text-foreground">{text}</p>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {record.factType ? <span>{record.factType}</span> : null}
            {record.context ? <span>{record.context}</span> : null}
            {record.updatedAt || record.createdAt ? (
              <span>{formatDate(record.updatedAt ?? record.createdAt)}</span>
            ) : null}
            {typeof record.confidence === "number" ? (
              <span>{Math.round(record.confidence * 100)}% confidence</span>
            ) : null}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Forget memory: ${text}`}
          disabled={!onForget || isDeleting}
          onClick={() => setConfirming(true)}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      {record.tags?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {record.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      {confirming ? (
        <div className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2 text-sm">
          <span>Forget this memory?</span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isDeleting}
              onClick={async () => {
                await onForget?.(record.memoryRecordId);
                setConfirming(false);
              }}
            >
              {isDeleting ? "Forgetting" : "Forget"}
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function groupRecords(records: ComputerMemoryRecord[]) {
  const groups = new Map<string, ComputerMemoryRecord[]>();
  for (const record of records) {
    const label = labelForFactType(record.factType);
    groups.set(label, [...(groups.get(label) ?? []), record]);
  }
  return Array.from(groups.entries()).map(([label, groupRecords]) => ({
    label,
    records: groupRecords,
  }));
}

function labelForFactType(factType?: string | null) {
  const normalized = factType?.toLowerCase();
  if (normalized === "experience") return "Experiences";
  if (normalized === "opinion" || normalized === "preference") {
    return "Preferences";
  }
  if (normalized === "observation") return "Observations";
  return "Facts";
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
