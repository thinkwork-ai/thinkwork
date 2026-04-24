/**
 * PRD-20: Trace events for a thread.
 * Shows a compact table of all traced invocations with token counts,
 * latency, cost, and a link to CloudWatch trace view.
 */

import { useQuery } from "urql";
import { ExternalLink } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ThreadTracesQuery } from "@/lib/graphql-queries";
import { formatUsd, relativeTime } from "@/lib/utils";

// NOTE: region is hardcoded to us-east-1. Pre-existing; a regional-constants
// sweep will replace this with a stage-aware value.
export const CW_CONSOLE_BASE = "https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1";

export function xrayTraceUrl(traceId: string): string {
  return `${CW_CONSOLE_BASE}#xray:traces/${traceId}`;
}

function formatDuration(ms: number | null): string {
  if (!ms) return "--";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatTokens(n: number | null): string {
  if (!n) return "--";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Shorten model ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0" → "claude-haiku-4-5" */
function shortenModel(model: string | null): string {
  if (!model) return "--";
  return model
    .replace(/^us\.anthropic\./, "")
    .replace(/-\d{8,}-v\d+:\d+$/, "")
    .replace(/-v\d+:\d+$/, "");
}

interface ThreadTracesProps {
  threadId: string;
  tenantId: string;
}

export function ThreadTraces({ threadId, tenantId }: ThreadTracesProps) {
  const [result] = useQuery({
    query: ThreadTracesQuery,
    variables: { threadId: threadId, tenantId },
    pause: !threadId || !tenantId,
  });

  const traces = (result.data as any)?.threadTraces ?? [];

  if (traces.length === 0 && !result.fetching) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No trace data for this thread yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table className="table-fixed w-full">
        <TableHeader>
          <TableRow>
            <TableHead className="w-20">Time</TableHead>
            <TableHead className="w-20">Agent</TableHead>
            <TableHead className="w-36">Model</TableHead>
            <TableHead className="w-20 text-right">In</TableHead>
            <TableHead className="w-20 text-right">Out</TableHead>
            <TableHead className="w-16 text-right">Latency</TableHead>
            <TableHead className="w-16 text-right">Cost</TableHead>
            <TableHead className="w-10 text-right">Trace</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {traces.map((trace: any, idx: number) => (
            <TableRow key={`${trace.traceId}-${idx}`}>
              <TableCell className="text-xs text-muted-foreground truncate">
                {relativeTime(trace.createdAt)}
              </TableCell>
              <TableCell className="text-xs font-medium truncate">
                {trace.agentName || "--"}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground truncate" title={trace.model || ""}>
                {shortenModel(trace.model)}
                {trace.estimated && (
                  <Badge variant="outline" className="ml-1 text-[10px] px-1">est</Badge>
                )}
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums">{formatTokens(trace.inputTokens)}</TableCell>
              <TableCell className="text-right text-xs tabular-nums">{formatTokens(trace.outputTokens)}</TableCell>
              <TableCell className="text-right text-xs tabular-nums">{formatDuration(trace.durationMs)}</TableCell>
              <TableCell className="text-right text-xs tabular-nums">{formatUsd(trace.costUsd)}</TableCell>
              <TableCell className="text-right">
                {trace.traceId ? (
                  <a
                    href={xrayTraceUrl(trace.traceId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3.5 w-3.5 inline" />
                  </a>
                ) : "--"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
