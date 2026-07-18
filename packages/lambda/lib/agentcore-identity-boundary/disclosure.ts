export interface IdentityBoundaryRawResult {
  owner_alias: string;
  harmless_value: string;
  private_note?: string;
  secret_sentinel?: string;
  [key: string]: unknown;
}

export interface IdentityBoundaryProjection {
  ownerAlias: string;
  harmlessValue: string;
}

export interface IdentityBoundaryMixedProjection {
  ownerAlias: string;
  taskField: string;
  disclosure: {
    decisionId: string;
    status: "confirmation_required";
    reasonCode: "unrelated_sensitive_fields_withheld";
  };
}

/**
 * The proof target intentionally models a mixed-sensitivity provider result.
 * Only these two explicitly public fields can cross back through Gateway.
 */
export function projectIdentityBoundaryResult(
  raw: IdentityBoundaryRawResult,
  expectedOwnerAlias: string,
): IdentityBoundaryProjection {
  const ownerAlias = requiredSafeString(raw.owner_alias, "owner_alias");
  const harmlessValue = requiredSafeString(
    raw.harmless_value,
    "harmless_value",
  );
  if (ownerAlias !== requiredSafeString(expectedOwnerAlias, "expected owner")) {
    throw new Error("credential owner does not match the authorized subject");
  }
  return { ownerAlias, harmlessValue };
}

export function projectMixedIdentityBoundaryResult(
  raw: IdentityBoundaryRawResult & { task_field?: unknown },
  expectedOwnerAlias: string,
  decisionId: string,
): IdentityBoundaryMixedProjection {
  const ownerAlias = requiredSafeString(raw.owner_alias, "owner_alias");
  if (ownerAlias !== requiredSafeString(expectedOwnerAlias, "expected owner")) {
    throw new Error("credential owner does not match the authorized subject");
  }
  const taskField = requiredSafeString(raw.task_field, "task_field");
  const safeDecisionId = requiredSafeString(decisionId, "decision_id");
  return {
    ownerAlias,
    taskField,
    disclosure: {
      decisionId: safeDecisionId,
      status: "confirmation_required",
      reasonCode: "unrelated_sensitive_fields_withheld",
    },
  };
}

function requiredSafeString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > 128 || /[\r\n\0]/.test(normalized)) {
    throw new Error(`${field} is not disclosure-safe`);
  }
  return normalized;
}
