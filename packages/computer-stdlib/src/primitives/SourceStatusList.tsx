import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Badge } from "@thinkwork/ui";
import { formatDateTime } from "../formatters/date.js";

export type SourceStatus = "success" | "partial" | "failed";

export interface SourceStatusItem {
  id: string;
  label: string;
  status: SourceStatus;
  recordCount?: number;
  asOf?: string | Date;
  error?: string;
}

export interface SourceStatusListProps {
  title?: string;
  description?: string;
  sources: SourceStatusItem[];
  emptyState?: string;
}

export function SourceStatusList({
  title = "Source coverage",
  description = "Missing or partial inputs stay visible so the applet does not look more complete than it is.",
  sources,
  emptyState = "No source status reported yet.",
}: SourceStatusListProps) {
  return (
    <section className="rounded-lg border border-border/70 bg-background p-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      {sources.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
          {emptyState}
        </div>
      ) : (
        <div className="grid gap-2">
          {sources.map((source) => {
            const isSuccess = source.status === "success";
            return (
              <article
                key={source.id}
                className="rounded-md border border-border/60 p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {isSuccess ? (
                      <CheckCircle2 className="size-4 text-emerald-500" />
                    ) : (
                      <AlertCircle className="size-4 text-amber-500" />
                    )}
                    <h4 className="text-sm font-medium">{source.label}</h4>
                  </div>
                  <Badge
                    variant={isSuccess ? "secondary" : "outline"}
                    className="rounded-md"
                  >
                    {source.status}
                  </Badge>
                </div>
                {source.recordCount != null || source.asOf ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {source.recordCount ?? 0} records
                    {source.asOf ? ` as of ${formatDateTime(source.asOf)}` : ""}
                  </p>
                ) : null}
                {source.error ? (
                  <p className="mt-2 text-xs leading-5 text-amber-500">
                    {source.error}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
