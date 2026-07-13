/**
 * Shared projection for the Routine promotion proposal GraphQL surface
 * (THINK-280 U6). Row → GraphQL is EXPLICIT field-by-field construction
 * (never a spread) so no secret-adjacent column can leak by accident;
 * AWSJSON columns are JSON.stringify'd per the repo convention.
 */

import type { CapabilityRoutineProposalRow } from "../../../lib/capabilities/routine-proposal.js";

function awsJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function iso(value: Date | string | null | undefined): string | null {
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
}

export function routineProposalToGql(
  row: CapabilityRoutineProposalRow,
): Record<string, unknown> {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    routineId: row.routine_id ?? null,
    payload: awsJson(row.payload_json),
    payloadFingerprint: row.payload_fingerprint,
    evidenceRefs: awsJson(row.evidence_refs_json),
    status: row.status,
    approvalMode: row.approval_mode ?? null,
    approvalEvidence: awsJson(row.approval_evidence_json),
    inboxItemId: row.inbox_item_id ?? null,
    createdByActorType: row.created_by_actor_type ?? null,
    createdByActorId: row.created_by_actor_id ?? null,
    decidedAt: iso(row.decided_at),
    decidedByUserId: row.decided_by_user_id ?? null,
    promotedCommitSha: row.promoted_commit_sha ?? null,
    createdAt: iso(row.created_at),
  };
}
