import type {
  OntologyChangeItemKind,
  OntologyChangeSetItemStatus,
  OntologyChangeSetStatus,
  OntologyExcludedItemDisposition,
  OntologyLifecycleStatus,
} from "../../../lib/ontology/repository.js";

export function changeSetStatusFromGraphQL(
  status?: string | null,
): OntologyChangeSetStatus | null {
  if (!status) return null;
  const value = status.toLowerCase();
  if (value === "deferred") {
    throw new Error("Deferred applies to change-set items, not change sets");
  }
  return value as OntologyChangeSetStatus;
}

export function changeItemTypeFromGraphQL(
  itemType: string,
): OntologyChangeItemKind {
  return itemType.toLowerCase() as OntologyChangeItemKind;
}

export function excludedDispositionFromGraphQL(
  disposition?: string | null,
): OntologyExcludedItemDisposition | null {
  if (!disposition) return null;
  return disposition.toLowerCase() as OntologyExcludedItemDisposition;
}

/**
 * AWSJSON inputs arrive as parsed objects from literals but may arrive as
 * JSON strings from variables (the scalar's parseValue passes through).
 */
export function jsonValueFromGraphQL(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function itemStatusFromGraphQL(
  status?: string | null,
): OntologyChangeSetItemStatus | null {
  if (!status) return null;
  const value = status.toLowerCase();
  if (value === "draft") {
    throw new Error("Draft is not a valid ontology change-set item status");
  }
  return value as OntologyChangeSetItemStatus;
}

export function lifecycleStatusFromGraphQL(
  status?: string | null,
): OntologyLifecycleStatus | null {
  if (!status) return null;
  return status.toLowerCase() as OntologyLifecycleStatus;
}
