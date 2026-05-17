import type {
  OntologyChangeSetItemStatus,
  OntologyChangeSetStatus,
  OntologyLifecycleStatus,
} from "../../../lib/ontology/repository.js";

export function changeSetStatusFromGraphQL(
  status?: string | null,
): OntologyChangeSetStatus | null {
  if (!status) return null;
  return status.toLowerCase() as OntologyChangeSetStatus;
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
