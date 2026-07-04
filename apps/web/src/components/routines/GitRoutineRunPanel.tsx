/**
 * Run detail for git-backed deterministic routines (plan 2026-07-03-004
 * U9, R8). git_python executions have no Step Functions graph — every run
 * answers "what exactly ran?" with a commit SHA instead: run summary
 * (status, trigger, commit SHA, cache-served annotation), output/error
 * payloads, the visible repair log (R12), and — when the repair budget
 * disabled the routine — a banner with an operator-only re-enable action
 * (R13).
 */

import { useQuery, useMutation } from "urql";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@thinkwork/ui";
import { AlertTriangle, GitCommitHorizontal, RefreshCw } from "lucide-react";
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

function prettyJson(raw?: string | null): string | null {
  if (!raw) return null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
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
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      {disabled ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
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
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <GitCommitHorizontal className="size-4" />
            What exactly ran
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <Row label="Status">
            <StatusBadge status={execution.status.toLowerCase()} />
          </Row>
          <Row label="Commit SHA">
            <code className="font-mono text-xs">
              {shortSha(execution.commitSha)}
            </code>
            {execution.cacheServed ? (
              <Badge variant="outline" className="ml-2">
                cache-served
              </Badge>
            ) : null}
          </Row>
          <Row label="Validated SHA at run">
            <code className="font-mono text-xs">
              {shortSha(execution.validatedSha)}
            </code>
            {execution.commitSha &&
            execution.validatedSha &&
            execution.commitSha !== execution.validatedSha ? (
              <Badge variant="outline" className="ml-2">
                ran newly promoted code
              </Badge>
            ) : null}
          </Row>
          <Row label="Trigger">{execution.triggerSource}</Row>
          {execution.errorCode ? (
            <Row label="Error">
              <span className="text-destructive">
                {execution.errorCode}
                {execution.errorMessage ? ` — ${execution.errorMessage}` : ""}
              </span>
            </Row>
          ) : null}
        </CardContent>
      </Card>

      {input ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Input</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-48 overflow-auto rounded-md bg-muted/40 p-3 text-xs">
              {input}
            </pre>
          </CardContent>
        </Card>
      ) : null}

      {output ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Output</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-64 overflow-auto rounded-md bg-muted/40 p-3 text-xs">
              {output}
            </pre>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Repair log</CardTitle>
        </CardHeader>
        <CardContent>
          {repairEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No repairs — this routine has run clean.
            </p>
          ) : (
            <ul className="grid gap-2">
              {repairEvents.map((event) => (
                <li
                  key={event.id}
                  className="rounded-md border border-border/70 p-3 text-sm"
                >
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
                      >
                        fixtures {event.gateResult}
                      </Badge>
                    ) : null}
                    {event.envelopeVerdict === "out_of_envelope" ? (
                      <Badge variant="outline">needs approval</Badge>
                    ) : null}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {new Date(event.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {event.fromSha || event.toSha ? (
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {shortSha(event.fromSha)} → {shortSha(event.toSha)}
                    </p>
                  ) : null}
                  {typeof event.budgetSnapshot === "number" ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {event.budgetSnapshot} repair attempt
                      {event.budgetSnapshot === 1 ? "" : "s"} left today
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[10rem_minmax(0,1fr)] items-center gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center">{children}</span>
    </div>
  );
}
