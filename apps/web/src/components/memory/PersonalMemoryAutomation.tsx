import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { Badge, Button, Input, Switch } from "@thinkwork/ui";
import { StatusBadge } from "@/components/StatusBadge";
import {
  PersonalMemoryAutomationQuery,
  SetPersonalMemoryAutomationScheduleMutation,
  TriggerWorkflowRunMutation,
} from "@/lib/graphql-queries";

/**
 * Personal Memory Processing card (THINK-193 U3, R4-R6) — the signed-in
 * user's OWNER-ONLY entry point on the Automations page. The server lazily
 * provisions the processor + blueprint workflow on first read; Run now
 * starts a manual run that pauses on plan review, and the schedule toggle
 * arms bounded scheduled runs that skip review inside the saved envelope.
 */

type PersonalMemoryAutomationData = {
  personalMemoryAutomation?: {
    processor: { id: string; enabled: boolean; status: string };
    workflow?: {
      id: string;
      name: string;
      primaryTriggerFamily: string;
      lastRunId?: string | null;
      lastRunAt?: string | null;
      lastRun?: { id: string; status: string } | null;
    } | null;
    sources: Array<{
      id: string;
      sourceFamily: string;
      sourceBindingKey: string;
      enabled: boolean;
      boundary?: unknown;
    }>;
    readiness: string;
    readinessReasons?: unknown;
  } | null;
};

/** Approved mailbox label ids from an email source's boundary. */
function emailLabelsFrom(boundary: unknown): string[] {
  const parsed = typeof boundary === "string" ? safeParse(boundary) : boundary;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const labels = (parsed as { labels?: unknown }).labels;
  if (!Array.isArray(labels)) return [];
  return labels.filter((label): label is string => typeof label === "string");
}

function readinessMessages(reasons: unknown): string[] {
  const parsed =
    typeof reasons === "string" ? safeParse(reasons) : (reasons ?? []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((entry) =>
      entry && typeof entry === "object" && "message" in entry
        ? String((entry as { message: unknown }).message)
        : null,
    )
    .filter((message): message is string => Boolean(message));
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

export function PersonalMemoryAutomation() {
  const navigate = useNavigate();
  const [result, refetch] = useQuery<PersonalMemoryAutomationData>({
    query: PersonalMemoryAutomationQuery,
    requestPolicy: "cache-and-network",
  });
  const [triggerState, triggerRun] = useMutation(TriggerWorkflowRunMutation);
  const [scheduleState, setSchedule] = useMutation(
    SetPersonalMemoryAutomationScheduleMutation,
  );
  const [rateHours, setRateHours] = useState("24");

  const automation = result.data?.personalMemoryAutomation ?? null;
  if (result.error) {
    // Non-user callers (or a failed provision) simply hide the card.
    return null;
  }
  if (!automation) {
    return (
      <section className="border-b border-border/60 px-6 py-4">
        <div className="h-16 animate-pulse rounded-md bg-muted/40" />
      </section>
    );
  }

  const workflow = automation.workflow ?? null;
  const scheduled = workflow?.primaryTriggerFamily === "schedule";
  const reasons = readinessMessages(automation.readinessReasons);
  const busy = triggerState.fetching || scheduleState.fetching;
  const emailSources = automation.sources.filter(
    (source) => source.sourceFamily === "email",
  );
  const emailConnectionBlocked = reasons.some((message) =>
    message.toLowerCase().includes("google connection"),
  );

  const runNow = async () => {
    if (!workflow) return;
    const res = await triggerRun({ input: { workflowId: workflow.id } });
    const run = res.data?.triggerWorkflowRun as
      | { id?: string; workflowId?: string }
      | undefined;
    if (res.error || !run?.id) {
      toast.error(res.error?.message ?? "The run could not be started.");
      return;
    }
    // Manual runs pause on plan review — land the owner on the run detail.
    void navigate({
      to: "/settings/workflows/$workflowId/runs/$runId",
      params: { workflowId: workflow.id, runId: run.id },
    });
  };

  const toggleSchedule = async (enabled: boolean) => {
    const hours = Math.max(1, Math.min(168, Number(rateHours) || 24));
    const res = await setSchedule({
      enabled,
      scheduleExpression: enabled
        ? `rate(${hours} ${hours === 1 ? "hour" : "hours"})`
        : null,
    });
    if (res.error) {
      toast.error(res.error.message);
      return;
    }
    toast.success(
      enabled
        ? `Scheduled every ${hours}h — scheduled runs skip plan review and stay inside your saved sources.`
        : "Schedule disabled — manual runs stay available.",
    );
    refetch({ requestPolicy: "network-only" });
  };

  return (
    <section
      className="border-b border-border/60 px-6 py-4"
      aria-label="Personal memory processing"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">
              Personal Memory Processing
            </h2>
            <Badge
              variant={
                automation.readiness === "ready" ? "secondary" : "outline"
              }
              className="text-[10px]"
            >
              {automation.readiness === "ready" ? "ready" : "needs setup"}
            </Badge>
            {workflow?.lastRun ? (
              <StatusBadge
                status={workflow.lastRun.status.toLowerCase()}
                size="sm"
              />
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {automation.sources.length === 0
              ? "No memory sources opted in yet — this automation processes only sources you explicitly add."
              : `${automation.sources.filter((source) => source.enabled).length} of ${automation.sources.length} sources enabled: ${automation.sources
                  .map((source) => source.sourceFamily)
                  .join(", ")}`}
          </p>
          {emailSources.map((source) => {
            const labels = emailLabelsFrom(source.boundary);
            return (
              <p
                key={source.id}
                className="mt-0.5 text-xs text-muted-foreground"
              >
                Email (Gmail){source.enabled ? "" : " — disabled"}:{" "}
                {emailConnectionBlocked ? (
                  <span className="text-destructive">
                    Google connection needs attention
                  </span>
                ) : (
                  "connected via your Google account"
                )}
                {" · "}
                {labels.length > 0
                  ? `approved labels: ${labels.join(", ")}`
                  : "no labels approved yet — an empty label set reads nothing"}
              </p>
            );
          })}
          {reasons.length > 0 ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {reasons.join(" ")}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Every</span>
            <Input
              type="number"
              min={1}
              max={168}
              value={rateHours}
              disabled={busy || scheduled}
              onChange={(event) => setRateHours(event.target.value)}
              className="h-8 w-16"
              aria-label="Schedule interval in hours"
            />
            <span>h</span>
            <Switch
              checked={scheduled}
              disabled={busy || !workflow}
              onCheckedChange={(checked) => void toggleSchedule(checked)}
              aria-label="Toggle scheduled runs"
            />
          </label>
          {workflow?.lastRunId ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                void navigate({
                  to: "/settings/workflows/$workflowId/runs/$runId",
                  params: {
                    workflowId: workflow.id,
                    runId: workflow.lastRunId!,
                  },
                })
              }
            >
              Last run
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={busy || !workflow}
            onClick={() => void runNow()}
          >
            Run now
          </Button>
        </div>
      </div>
    </section>
  );
}
