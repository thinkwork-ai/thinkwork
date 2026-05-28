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
