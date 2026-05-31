export type TimelineTurnLike = {
  invocationSource?: string | null;
  status?: string | null;
  resultJson?: unknown;
};

export type TimelineEventLike = {
  eventType?: string | null;
  message?: string | null;
};

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function isMobilePiTurn(turn: TimelineTurnLike): boolean {
  if ((turn.invocationSource || "").toLowerCase() === "mobile_pi") return true;
  const result = parseJsonRecord(turn.resultJson);
  return result?.source === "mobile_pi";
}

export function shouldShowTurnInTimeline(
  turn: TimelineTurnLike,
  isAdmin?: boolean,
): boolean {
  return Boolean(isAdmin) || isMobilePiTurn(turn);
}

export function shouldShowThreadWorkingIndicator(input: {
  isLocalThreadActive: boolean;
  isOptimisticStartRunning: boolean;
  hasRunningTurn: boolean;
}): boolean {
  return (
    input.isLocalThreadActive ||
    input.isOptimisticStartRunning ||
    input.hasRunningTurn
  );
}

export function shouldShowMobileTurnActivityEvent(
  event: TimelineEventLike,
): boolean {
  return (
    typeof event.eventType === "string" &&
    event.eventType.startsWith("mobile_pi_") &&
    typeof event.message === "string" &&
    event.message.trim().length > 0
  );
}

export function mobileTurnActivityLabel(event: TimelineEventLike): string {
  const message = event.message?.trim();
  if (message) return message;
  return String(event.eventType || "mobile Pi activity").replace(/_/g, " ");
}
