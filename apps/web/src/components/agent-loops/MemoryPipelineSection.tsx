/**
 * Definition tab for the built-in memory Automation (THINK-264).
 *
 * Renders the real pipeline — the same stage list the interpreter runs — and
 * lets the user switch the optional stages off. The spine (acquire → project →
 * resolve → retain) is shown as required: turning any of it off would starve
 * every stage after it, so the server rejects that and we don't offer it.
 */

import { useMemo, useState } from "react";
import { useMutation } from "urql";

import { Badge, Button, Input, Switch } from "@thinkwork/ui";
import { RoutineFlowCanvas } from "@/components/routines/RoutineFlowCanvas";
import { WorkflowCanvasWorkspace } from "@/components/workflows/WorkflowCanvasWorkspace";
import {
  SetMemoryPipelineStageEnabledMutation,
  SetPersonalMemoryAutomationScheduleMutation,
} from "@/lib/graphql-queries";
import {
  buildMemoryPipelineFlowGraph,
  MEMORY_TRIGGER_NODE_ID,
  type MemoryPipelineView,
} from "./memoryPipelineFlowGraph";

interface ReadinessReason {
  code: string;
  message: string;
}

function readinessReasons(pipeline: MemoryPipelineView): ReadinessReason[] {
  const raw = (pipeline as unknown as { readinessReasons?: unknown })
    .readinessReasons;
  const parsed = typeof raw === "string" ? safeParse(raw) : raw;
  return Array.isArray(parsed) ? (parsed as ReadinessReason[]) : [];
}

/** "rate(24 hours)" -> 24. Null for cron or unset schedules. */
function hoursFromRate(expression?: string | null): number | null {
  if (!expression) return null;
  const match = /^rate\((\d+)\s+hours?\)$/.exec(expression.trim());
  return match ? Number.parseInt(match[1], 10) : null;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

export function MemoryPipelineSection({
  agentLoopId,
  pipeline,
  triggerFamily,
  scheduleLabel,
}: {
  agentLoopId: string;
  pipeline: MemoryPipelineView;
  triggerFamily: string;
  scheduleLabel?: string | null;
}) {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setStageEnabled] = useMutation(
    SetMemoryPipelineStageEnabledMutation,
  );
  const [, setSchedule] = useMutation(
    SetPersonalMemoryAutomationScheduleMutation,
  );
  const [pendingStage, setPendingStage] = useState<string | null>(null);
  const [savingSchedule, setSavingSchedule] = useState(false);

  const scheduleOn = pipeline.scheduleEnabled ?? false;
  const [hours, setHours] = useState(() =>
    String(hoursFromRate(pipeline.scheduleExpression) ?? 24),
  );

  const saveSchedule = async (enabled: boolean, hoursValue: string) => {
    const parsed = Number.parseInt(hoursValue, 10);
    if (enabled && (!Number.isFinite(parsed) || parsed < 1)) {
      setError("Enter a whole number of hours (1 or more).");
      return;
    }
    setSavingSchedule(true);
    setError(null);
    const result = await setSchedule({
      enabled,
      scheduleExpression: enabled
        ? `rate(${parsed} ${parsed === 1 ? "hour" : "hours"})`
        : null,
      timezone: null,
    });
    setSavingSchedule(false);
    if (result.error) {
      setError(result.error.graphQLErrors[0]?.message ?? result.error.message);
    }
  };

  const graph = useMemo(
    () =>
      buildMemoryPipelineFlowGraph({
        pipeline,
        triggerFamily,
        scheduleLabel,
      }),
    [pipeline, triggerFamily, scheduleLabel],
  );

  const reasons = readinessReasons(pipeline);
  const selectedStage =
    selectedNode && selectedNode !== MEMORY_TRIGGER_NODE_ID
      ? (pipeline.stages.find((s) => s.id === selectedNode) ?? null)
      : null;

  const toggle = async (stage: string, enabled: boolean) => {
    setPendingStage(stage);
    setError(null);
    const result = await setStageEnabled({ agentLoopId, stage, enabled });
    setPendingStage(null);
    if (result.error) {
      setError(result.error.graphQLErrors[0]?.message ?? result.error.message);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {reasons.length > 0 ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
          <p className="font-medium text-amber-600 dark:text-amber-400">
            This automation can&apos;t run yet
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
            {reasons.map((reason) => (
              <li key={reason.code}>{reason.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <WorkflowCanvasWorkspace
        inspectorKey={selectedNode}
        onInspectorClose={() => setSelectedNode(null)}
        canvas={
          <RoutineFlowCanvas
            mode="execution"
            aslJson={null}
            graph={graph}
            selectedNodeId={selectedNode}
            onSelectNode={(nodeId) => setSelectedNode(nodeId ?? null)}
            className="h-full min-h-[380px]"
            emptyLabel="This automation has no steps to draw."
          />
        }
        inspector={
          selectedStage ? (
            <div className="flex flex-col gap-4 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">
                    {selectedStage.label}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedStage.description}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedNode(null)}
                >
                  Close
                </Button>
              </div>

              <div className="rounded-md border p-3">
                {selectedStage.toggleable ? (
                  <label className="flex items-center justify-between gap-3">
                    <span className="text-sm">
                      <span className="font-medium">Run this step</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        Optional — the pipeline still writes memory without it.
                      </span>
                    </span>
                    <Switch
                      checked={selectedStage.enabled}
                      disabled={pendingStage === selectedStage.stage}
                      onCheckedChange={(next) =>
                        void toggle(selectedStage.stage, next)
                      }
                    />
                  </label>
                ) : (
                  <div className="text-sm">
                    <span className="font-medium">Required step</span>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Acquire, project, resolve, and retain feed each other.
                      Turning one off would leave the automation running while
                      quietly writing nothing to memory, so they can&apos;t be
                      disabled.
                    </p>
                  </div>
                )}
              </div>

              {selectedStage.lastResult ? (
                <div className="text-xs text-muted-foreground">
                  Last run:{" "}
                  <Badge variant="outline">{selectedStage.lastResult}</Badge>
                </div>
              ) : null}
            </div>
          ) : selectedNode === MEMORY_TRIGGER_NODE_ID ? (
            <div className="flex flex-col gap-3 p-4">
              <h3 className="text-sm font-semibold">Trigger</h3>
              <p className="text-sm text-muted-foreground">
                {scheduleOn
                  ? "Runs automatically on this cadence. Scheduled runs skip plan review."
                  : "Runs when you start it. Manual runs pause at plan review so you can narrow the plan first."}
              </p>

              <div className="rounded-md border p-3">
                <label className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">Run on a schedule</span>
                  <Switch
                    checked={scheduleOn}
                    disabled={savingSchedule}
                    onCheckedChange={(next) => void saveSchedule(next, hours)}
                  />
                </label>
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Every</span>
                  <Input
                    type="number"
                    min={1}
                    max={168}
                    value={hours}
                    disabled={savingSchedule}
                    className="h-8 w-20"
                    onChange={(event) => setHours(event.target.value)}
                    onBlur={() => {
                      if (scheduleOn) void saveSchedule(true, hours);
                    }}
                  />
                  <span className="text-xs text-muted-foreground">hours</span>
                </div>
              </div>

              <div className="rounded-md border p-3">
                <p className="text-xs font-medium">Sources</p>
                {pipeline.sources.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    No sources configured yet.
                  </p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {pipeline.sources.map((source) => (
                      <li
                        key={source.id}
                        className="flex items-center justify-between text-xs"
                      >
                        <span>{source.sourceFamily}</span>
                        <Badge
                          variant={source.enabled ? "secondary" : "outline"}
                        >
                          {source.enabled ? "enabled" : "off"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null
        }
      />
    </div>
  );
}
