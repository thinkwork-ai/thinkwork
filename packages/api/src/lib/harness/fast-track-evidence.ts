const TURN_SESSION_PATTERN = /session\.id=tw-harness-turn-([0-9a-f-]{36})/i;

export interface GatewayPolicyDecisionEvidence {
  decisionId: string;
  requestId: string;
  traceId: string;
  decision: "ALLOW" | "DENY";
  policyEngineArn: string;
  determiningPolicies: string[];
  principalType: string;
  principalId: string;
  latencyMs: number | null;
  eventTimestamp: number;
}

interface GatewayApplicationLogRecord {
  event_timestamp?: unknown;
  request_id?: unknown;
  trace_id?: unknown;
  body?: unknown;
  attributes?: unknown;
}

interface GatewayPolicyBody {
  log?: unknown;
  id?: unknown;
  requestBody?: unknown;
  policy?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Gateway evidence is missing ${field}`);
  }
  return value;
}

/** Parse one CloudWatch V2 delivery record without accepting malformed evidence. */
export function parseGatewayApplicationLog(
  message: string,
): GatewayApplicationLogRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    throw new Error("Gateway application log is not valid JSON");
  }
  if (!isRecord(parsed)) {
    throw new Error("Gateway application log is not an object");
  }
  return parsed;
}

function turnIdFromRecord(record: GatewayApplicationLogRecord): string | null {
  if (!isRecord(record.body)) return null;
  const requestBody = record.body.requestBody;
  if (typeof requestBody !== "string") return null;
  return requestBody.match(TURN_SESSION_PATTERN)?.[1]?.toLowerCase() ?? null;
}

function traceIdFromRecord(record: GatewayApplicationLogRecord): string | null {
  const value = record.trace_id;
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Correlate managed Gateway/Cedar decisions to one canonical ThinkWork turn.
 *
 * The policy record does not repeat the Harness session id. AgentCore emits it
 * on another record in the same trace, so correlation is intentionally two
 * step: session id -> trace id -> policy decision. No target-controlled field
 * is accepted as a substitute for the service-owned CloudWatch record.
 */
export function collectGatewayPolicyDecisionsForTurn(
  records: GatewayApplicationLogRecord[],
  turnId: string,
): GatewayPolicyDecisionEvidence[] {
  const normalizedTurnId = turnId.toLowerCase();
  const correlatedTraceIds = new Set(
    records
      .filter((record) => turnIdFromRecord(record) === normalizedTurnId)
      .map(traceIdFromRecord)
      .filter((value): value is string => Boolean(value)),
  );
  if (correlatedTraceIds.size === 0) return [];

  return records.flatMap((record) => {
    const traceId = traceIdFromRecord(record);
    if (!traceId || !correlatedTraceIds.has(traceId) || !isRecord(record.body)) {
      return [];
    }
    const body = record.body as GatewayPolicyBody;
    if (body.log !== "Policy evaluation completed" || !isRecord(body.policy)) {
      return [];
    }
    const policy = body.policy;
    const decision = requiredString(policy.decision, "policy.decision");
    if (decision !== "ALLOW" && decision !== "DENY") {
      throw new Error(`Gateway evidence has unknown policy decision ${decision}`);
    }
    const principal = isRecord(policy.principal) ? policy.principal : {};
    const requestId = requiredString(record.request_id, "request_id");
    const decisionId =
      typeof body.id === "string" && body.id.trim() ? body.id : requestId;
    const determiningPolicies = Array.isArray(policy.determiningPolicies)
      ? policy.determiningPolicies.map((value) =>
          requiredString(value, "policy.determiningPolicies[]"),
        )
      : [];
    const eventTimestamp = Number(record.event_timestamp);
    if (!Number.isFinite(eventTimestamp)) {
      throw new Error("Gateway evidence is missing event_timestamp");
    }
    const latencyMs =
      typeof policy.latencyMs === "number" &&
      Number.isFinite(policy.latencyMs) &&
      policy.latencyMs >= 0
        ? policy.latencyMs
        : null;
    return [
      {
        decisionId,
        requestId,
        traceId,
        decision,
        policyEngineArn: requiredString(
          policy.policyEngineArn,
          "policy.policyEngineArn",
        ),
        determiningPolicies,
        principalType: requiredString(
          principal.entityType,
          "policy.principal.entityType",
        ),
        principalId: requiredString(
          principal.entityId,
          "policy.principal.entityId",
        ),
        latencyMs,
        eventTimestamp,
      },
    ];
  });
}

export function assertAllowedGatewayPolicyEvidence(input: {
  records: GatewayApplicationLogRecord[];
  turnId: string;
  expectedPolicyArnOrId?: string;
}): GatewayPolicyDecisionEvidence[] {
  const decisions = collectGatewayPolicyDecisionsForTurn(
    input.records,
    input.turnId,
  );
  if (decisions.length === 0) {
    throw new Error(
      `No service-owned Gateway policy decision correlated to turn ${input.turnId}`,
    );
  }
  const denied = decisions.find((decision) => decision.decision !== "ALLOW");
  if (denied) {
    throw new Error(
      `Gateway policy denied request ${denied.requestId} for turn ${input.turnId}`,
    );
  }
  if (
    input.expectedPolicyArnOrId &&
    !decisions.every((decision) =>
      decision.determiningPolicies.some(
        (policy) =>
          policy === input.expectedPolicyArnOrId ||
          policy.endsWith(`/${input.expectedPolicyArnOrId}`),
      ),
    )
  ) {
    throw new Error(
      `Gateway policy evidence did not name ${input.expectedPolicyArnOrId}`,
    );
  }
  return decisions;
}
