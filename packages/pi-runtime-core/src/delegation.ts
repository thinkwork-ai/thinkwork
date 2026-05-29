/**
 * DelegationProvider — the host-supplied seam for handing a sub-task to a
 * managed worker agent. One of the four provider interfaces (Model / Workspace /
 * Memory / Delegation); this one predates the others and already follows the
 * shape they share: typed request/response interfaces plus a single-method
 * provider the host implements.
 *
 * Credential discipline: implementations that reach AWS to dispatch a delegation
 * must use credentials/identity snapshotted at loop entry, never re-read from
 * `process.env` mid-turn (see feedback_completion_callback_snapshot_pattern).
 */

export type ManagedDelegationVisibility = "hidden" | "visible";

export interface ManagedDelegationRequest {
  parentThreadTurnId?: string;
  task: string;
  visibility?: ManagedDelegationVisibility;
  reason?: string;
  timeoutMs?: number;
}

export type ManagedDelegationStatus = "accepted" | "completed" | "failed";

export interface ManagedDelegationResponse {
  ok: boolean;
  delegationId: string;
  parentThreadTurnId: string;
  childThreadTurnId: string | null;
  requestedVisibility: ManagedDelegationVisibility;
  effectiveVisibility: ManagedDelegationVisibility;
  status: ManagedDelegationStatus;
  result?: {
    content: string | null;
    runtime?: string | null;
    usage?: unknown;
    toolInvocations?: unknown;
    toolCosts?: unknown;
  };
  error?: string;
}

export interface DelegationProvider {
  delegate(
    request: ManagedDelegationRequest,
  ): Promise<ManagedDelegationResponse>;
}
