export type AgentCorePhaseStatus =
  | "started"
  | "completed"
  | "failed"
  | "skipped";

export interface AgentCorePhaseLogInput {
  phase: string;
  status: AgentCorePhaseStatus;
  source:
    | "chat-agent-invoke"
    | "chat-agent-finalize"
    | "agentcore-runtime-dispatch"
    | "spaces-client"
    | "mobile-client";
  traceId?: string | null;
  tenantId?: string | null;
  agentId?: string | null;
  threadId?: string | null;
  threadTurnId?: string | null;
  runtimeType?: string | null;
  durationMs?: number;
  count?: number;
  detail?: string | null;
  errorType?: string | null;
  spanId?: string;
  timestamp?: string;
}

export type AgentCorePhaseLogRecord = ReturnType<typeof buildAgentCorePhaseLog>;

export function buildAgentCorePhaseLog(input: AgentCorePhaseLogInput) {
  const sessionId = input.threadTurnId ?? input.threadId ?? "unknown";
  return {
    name: "thinkwork.agentcore.phase",
    scope: { name: "thinkwork.agentcore.phase" },
    event: "agentcore_phase",
    spanId: input.spanId ?? phaseSpanId(input.source, input.phase, sessionId),
    sessionId,
    phase: input.phase,
    status: input.status,
    source: input.source,
    traceId: input.traceId ?? undefined,
    tenantId: input.tenantId ?? undefined,
    agentId: input.agentId ?? undefined,
    threadId: input.threadId ?? undefined,
    threadTurnId: input.threadTurnId ?? undefined,
    runtimeType: input.runtimeType ?? undefined,
    durationMs: input.durationMs,
    count: input.count,
    detail: input.detail ?? undefined,
    errorType: input.errorType ?? undefined,
    ts: input.timestamp ?? new Date().toISOString(),
  };
}

/**
 * Emit one phase line.
 *
 * THINK-915: written straight to stdout rather than through `console.log`.
 * The Lambda Node runtime prefixes every `console.*` line with
 * `<timestamp>\t<requestId>\tINFO\t…`, which makes the log event invalid JSON
 * — and CloudWatch **metric filters** only apply JSON filter patterns
 * (`{ $.event = "agentcore_phase" }`) to events that parse as JSON end to end.
 * Raw stdout writes reach CloudWatch unprefixed, so the same line feeds both
 * Logs Insights (which already tolerated the prefix) and the
 * `Thinkwork/Chat/<stage>` metric filters in
 * terraform/modules/app/lambda-api/chat-latency-observability.tf.
 *
 * This mirrors the Pi container emitter, which has always written phase lines
 * to `process.stdout` (packages/agentcore-pi/agent-container/src/handler-context.ts).
 */
export function logAgentCorePhase(
  input: AgentCorePhaseLogInput,
  out: NodeJS.WritableStream = process.stdout,
): void {
  out.write(`${JSON.stringify(buildAgentCorePhaseLog(input))}\n`);
}

function phaseSpanId(source: string, phase: string, sessionId: string): string {
  const safe = `${source}-${phase}-${sessionId}`
    .replace(/[^A-Za-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return `tw-${safe || "agentcore-phase"}`;
}
