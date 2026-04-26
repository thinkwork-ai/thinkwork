export const WORKSPACE_TURN_IN_FLIGHT_STATUSES = [
  "pending",
  "claimed",
  "processing",
] as const;

export function canSettleWorkspaceRunFromTurn(status: string): boolean {
  return WORKSPACE_TURN_IN_FLIGHT_STATUSES.includes(
    status as (typeof WORKSPACE_TURN_IN_FLIGHT_STATUSES)[number],
  );
}
