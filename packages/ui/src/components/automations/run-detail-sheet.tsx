import type { ReactNode } from "react";
import { Badge } from "../ui/badge.js";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet.js";
import { RUN_STATUS_COLORS, type ScheduledJobRunRow } from "./types.js";
import {
  formatAbsoluteTime,
  formatRunDuration,
  runDurationMs,
  runResponseText,
} from "./helpers.js";

export interface RunDetailSheetProps {
  run: ScheduledJobRunRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Markdown renderer for the run's response text. Admin passes
   * react-markdown; computer passes streamdown's Response component. If
   * omitted, the response is rendered as plain pre-wrapped text.
   */
  renderResponse?: (text: string) => ReactNode;
}

/**
 * Side sheet that mirrors Memory Detail's layout — status badge in the
 * header, an Error pre when the run failed, the response markdown, and a
 * compact metadata grid (Source / Duration / Started / Finished + token
 * counts when present). A raw `usage_json` disclosure is appended when
 * non-empty for operator debugging.
 */
export function RunDetailSheet({
  run,
  open,
  onOpenChange,
  renderResponse,
}: RunDetailSheetProps) {
  const responseText = run ? runResponseText(run) : undefined;
  const durationMs = run ? runDurationMs(run) : null;
  const usageTokens = run?.usage_json?.tokens as
    | { input?: number; output?: number; total?: number }
    | undefined;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg flex flex-col">
        <SheetHeader className="p-6 pb-0">
          <div className="flex items-center justify-between gap-3">
            <div>
              <SheetTitle>Run Detail</SheetTitle>
              <SheetDescription>
                {run?.started_at ? `Started ${formatAbsoluteTime(run.started_at)}` : "Run record"}
              </SheetDescription>
            </div>
            {run && (
              <Badge
                variant="secondary"
                className={`text-xs capitalize ${RUN_STATUS_COLORS[run.status] || ""}`}
              >
                {run.status}
              </Badge>
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 pt-4 pb-6 space-y-4">
          {run && (
            <>
              {run.error && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">
                    Error
                  </p>
                  <pre className="text-sm whitespace-pre-wrap text-destructive bg-destructive/5 rounded-md p-3 border border-destructive/20">
                    {run.error}
                  </pre>
                </div>
              )}

              {responseText && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">
                    Response
                  </p>
                  {renderResponse ? (
                    <div className="text-sm bg-muted/50 rounded-md p-3 prose prose-sm dark:prose-invert max-w-none">
                      {renderResponse(responseText)}
                    </div>
                  ) : (
                    <pre className="text-sm whitespace-pre-wrap bg-muted/50 rounded-md p-3">
                      {responseText}
                    </pre>
                  )}
                </div>
              )}

              <div className="border-t border-muted pt-4 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider font-medium">Source</p>
                  <p className="mt-0.5 capitalize">{run.invocation_source.replace(/_/g, " ")}</p>
                </div>
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider font-medium">Duration</p>
                  <p className="mt-0.5 tabular-nums">{formatRunDuration(durationMs)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider font-medium">Started</p>
                  <p className="mt-0.5">{formatAbsoluteTime(run.started_at)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider font-medium">Finished</p>
                  <p className="mt-0.5">{formatAbsoluteTime(run.finished_at)}</p>
                </div>
                {usageTokens && (usageTokens.input != null || usageTokens.output != null || usageTokens.total != null) && (
                  <div className="col-span-2">
                    <p className="text-muted-foreground uppercase tracking-wider font-medium">Tokens</p>
                    <p className="mt-0.5 tabular-nums">
                      {usageTokens.input ?? 0} in · {usageTokens.output ?? 0} out
                      {usageTokens.total != null ? ` · ${usageTokens.total} total` : ""}
                    </p>
                  </div>
                )}
              </div>

              {run.usage_json && Object.keys(run.usage_json).length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                    Raw usage JSON
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap bg-muted/50 rounded-md p-3 font-mono text-xs">
                    {JSON.stringify(run.usage_json, null, 2)}
                  </pre>
                </details>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
