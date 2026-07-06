/**
 * Run detail for git-backed deterministic routines (plan 2026-07-03-004
 * U9, R8). git_python executions have no Step Functions graph — every run
 * answers "what exactly ran?" with a commit SHA instead: run summary
 * (status, trigger, commit SHA, cache-served annotation), output/error
 * payloads, the visible repair log (R12), and — when the repair budget
 * disabled the routine — a banner with an operator-only re-enable action
 * (R13).
 */

import { useState } from "react";
import { useQuery, useMutation } from "urql";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@thinkwork/ui";
import { AlertTriangle, ChevronRight, RefreshCw } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import {
  RoutineRepairEventsQuery,
  UpdateRoutineStatusMutation,
} from "@/lib/routine-queries";
import { useTenant } from "@/context/TenantContext";

interface GitRoutineExecution {
  id: string;
  status: string;
  triggerSource: string;
  commitSha?: string | null;
  validatedSha?: string | null;
  cacheServed?: boolean | null;
  inputJson?: string | null;
  outputJson?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

interface GitRoutineInfo {
  id: string;
  name: string;
  status: string;
  validatedSha?: string | null;
  disabledReason?: string | null;
}

interface RepairEventRow {
  id: string;
  eventType: string;
  threadRef?: string | null;
  fromSha?: string | null;
  toSha?: string | null;
  gateResult?: string | null;
  envelopeVerdict?: string | null;
  budgetSnapshot?: number | null;
  detailJson?: string | null;
  createdAt: string;
}

function shortSha(sha?: string | null): string {
  return sha ? sha.slice(0, 12) : "—";
}

function formatDuration(start?: string | null, end?: string | null): string {
  if (!start || !end) return "";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (Number.isNaN(ms) || ms < 0) return "";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
}

function prettyJson(raw?: unknown): string | null {
  if (raw == null) return null;
  // AWSJSON fields can arrive already parsed (object) or as a JSON string at
  // runtime; never hand a non-string back to React — always yield a string so
  // it renders safely inside <pre>.
  if (typeof raw === "object") {
    try {
      return JSON.stringify(raw, null, 2);
    } catch {
      return String(raw);
    }
  }
  if (typeof raw !== "string") return String(raw);
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return raw;
  }
}

const REPAIR_EVENT_LABELS: Record<string, string> = {
  retry: "Mechanical retry",
  revert: "Reverted to last-validated code",
  repair_attempt: "Agent repair attempt",
  pending_commit: "Repair pending operator approval",
  disabled: "Disabled by repair budget",
  infra_failure: "Infrastructure failure",
};

export function GitRoutineRunPanel({
  execution,
  routine,
  onRoutineChanged,
}: {
  execution: GitRoutineExecution;
  routine: GitRoutineInfo;
  onRoutineChanged?: () => void;
}) {
  const { isOperator } = useTenant();
  const [selectedRepair, setSelectedRepair] = useState<RepairEventRow | null>(
    null,
  );
  const [repairResult] = useQuery({
    query: RoutineRepairEventsQuery,
    variables: { routineId: routine.id, limit: 25 },
    requestPolicy: "cache-and-network",
  });
  const [reEnableState, updateRoutine] = useMutation(
    UpdateRoutineStatusMutation,
  );

  const repairEvents: RepairEventRow[] =
    (repairResult.data as { routineRepairEvents?: RepairEventRow[] })
      ?.routineRepairEvents ?? [];
  const disabled = routine.status !== "active";
  const output = prettyJson(execution.outputJson);
  const input = prettyJson(execution.inputJson);
  const duration = formatDuration(execution.startedAt, execution.finishedAt);
  const timing = execution.startedAt
    ? `${new Date(execution.startedAt).toLocaleString()}${
        duration ? ` · ${duration}` : ""
      }`
    : null;

  async function handleReEnable() {
    const result = await updateRoutine({
      id: routine.id,
      input: { status: "active" },
    });
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    toast.success(`${routine.name} re-enabled`);
    onRoutineChanged?.();
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      {disabled ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <AlertTriangle className="size-4 shrink-0 text-amber-500" />
            <span>
              This routine is disabled
              {routine.disabledReason ? `: ${routine.disabledReason}` : "."}
            </span>
          </span>
          {isOperator ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={reEnableState.fetching}
              onClick={handleReEnable}
            >
              <RefreshCw className="size-3.5" />
              Re-enable
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              An operator can re-enable it after review.
            </span>
          )}
        </div>
      ) : null}

      {/* Run summary — a single legible strip, matching the run-detail idiom
          elsewhere, instead of a boxed label/value grid. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b pb-4 text-sm">
        <StatusBadge status={execution.status.toLowerCase()} />
        <span className="flex items-center gap-1.5 text-muted-foreground">
          Ran
          <code className="font-mono text-xs text-foreground">
            {shortSha(execution.commitSha)}
          </code>
          {execution.cacheServed ? (
            <Badge variant="outline" className="font-normal">
              cache-served
            </Badge>
          ) : null}
          {execution.commitSha &&
          execution.validatedSha &&
          execution.commitSha !== execution.validatedSha ? (
            <Badge
              variant="outline"
              className="font-normal"
              title="Ran a commit newer than the validated SHA"
            >
              newly promoted
            </Badge>
          ) : null}
        </span>
        <span className="text-muted-foreground">
          Trigger{" "}
          <span className="capitalize text-foreground">
            {execution.triggerSource.replace(/_/g, " ")}
          </span>
        </span>
        {timing ? (
          <span className="tabular-nums text-muted-foreground">{timing}</span>
        ) : null}
        {execution.errorCode ? (
          <span className="text-destructive">
            {execution.errorCode}
            {execution.errorMessage ? ` — ${execution.errorMessage}` : ""}
          </span>
        ) : null}
      </div>

      {input || output ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {input ? <CodePanel label="Input" body={input} /> : null}
          {output ? <CodePanel label="Output" body={output} /> : null}
        </div>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Repair log</h2>
        {repairEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No repairs — this routine has run clean.
          </p>
        ) : (
          <div className="divide-y divide-border/60 overflow-hidden rounded-md border">
            {repairEvents.map((event) => (
              <button
                key={event.id}
                type="button"
                onClick={() => setSelectedRepair(event)}
                className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {REPAIR_EVENT_LABELS[event.eventType] ?? event.eventType}
                    </span>
                    {event.gateResult ? (
                      <Badge
                        variant={
                          event.gateResult === "green"
                            ? "default"
                            : "destructive"
                        }
                        className="font-normal"
                      >
                        fixtures {event.gateResult}
                      </Badge>
                    ) : null}
                    {event.envelopeVerdict === "out_of_envelope" ? (
                      <Badge variant="outline" className="font-normal">
                        needs approval
                      </Badge>
                    ) : null}
                  </div>
                  {event.fromSha || event.toSha ? (
                    <p className="font-mono text-xs text-muted-foreground">
                      {shortSha(event.fromSha)} → {shortSha(event.toSha)}
                    </p>
                  ) : null}
                  {typeof event.budgetSnapshot === "number" ? (
                    <p className="text-xs text-muted-foreground">
                      {event.budgetSnapshot} repair attempt
                      {event.budgetSnapshot === 1 ? "" : "s"} left today
                    </p>
                  ) : null}
                </div>
                <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
                  {new Date(event.createdAt).toLocaleString()}
                  <ChevronRight className="size-3.5" />
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <Sheet
        open={!!selectedRepair}
        onOpenChange={(open) => {
          if (!open) setSelectedRepair(null);
        }}
      >
        <SheetContent className="gap-0 overflow-y-auto data-[side=right]:w-[min(560px,calc(100vw-2rem))]">
          <SheetHeader>
            <SheetTitle>
              {selectedRepair
                ? (REPAIR_EVENT_LABELS[selectedRepair.eventType] ??
                  selectedRepair.eventType)
                : "Repair event"}
            </SheetTitle>
            <SheetDescription>
              {selectedRepair
                ? new Date(selectedRepair.createdAt).toLocaleString()
                : null}
            </SheetDescription>
          </SheetHeader>
          {selectedRepair ? <RepairEventDetail event={selectedRepair} /> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function RepairEventDetail({ event }: { event: RepairEventRow }) {
  const detail = prettyJson(event.detailJson);
  return (
    <div className="flex flex-col gap-4 px-4 pb-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {event.gateResult ? (
          <Badge
            variant={event.gateResult === "green" ? "default" : "destructive"}
            className="font-normal"
          >
            fixtures {event.gateResult}
          </Badge>
        ) : null}
        {event.envelopeVerdict ? (
          <Badge variant="outline" className="font-normal">
            {event.envelopeVerdict === "out_of_envelope"
              ? "needs approval"
              : event.envelopeVerdict.replace(/_/g, " ")}
          </Badge>
        ) : null}
      </div>

      <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-2">
        {event.fromSha || event.toSha ? (
          <>
            <dt className="text-muted-foreground">Commit</dt>
            <dd className="font-mono text-xs">
              {shortSha(event.fromSha)} → {shortSha(event.toSha)}
            </dd>
          </>
        ) : null}
        {typeof event.budgetSnapshot === "number" ? (
          <>
            <dt className="text-muted-foreground">Budget</dt>
            <dd>
              {event.budgetSnapshot} repair attempt
              {event.budgetSnapshot === 1 ? "" : "s"} left today
            </dd>
          </>
        ) : null}
        {event.threadRef ? (
          <>
            <dt className="text-muted-foreground">Repair thread</dt>
            <dd className="min-w-0 truncate font-mono text-xs">
              {event.threadRef}
            </dd>
          </>
        ) : null}
      </dl>

      {detail ? <CodePanel label="Detail" body={detail} /> : null}
    </div>
  );
}

function CodePanel({ label, body }: { label: string; body: string }) {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-md border">
      <div className="flex h-9 shrink-0 items-center border-b bg-muted/50 px-3 text-xs font-medium text-muted-foreground">
        {label}
      </div>
      <pre className="max-h-72 overflow-auto p-3 font-mono text-xs leading-relaxed">
        {body}
      </pre>
    </div>
  );
}
