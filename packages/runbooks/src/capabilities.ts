export const RUNBOOK_CAPABILITY_ROLES = [
  "research",
  "analysis",
  "artifact_build",
  "map_build",
  "validation",
] as const;

export type RunbookCapabilityRole = (typeof RUNBOOK_CAPABILITY_ROLES)[number];

const knownRoles = new Set<string>(RUNBOOK_CAPABILITY_ROLES);

export function isKnownCapabilityRole(
  value: string,
): value is RunbookCapabilityRole {
  return knownRoles.has(value);
}

export function isExperimentalCapabilityRole(value: string) {
  return value.startsWith("experimental:");
}

export function isAllowedCapabilityRole(value: string) {
  return isKnownCapabilityRole(value) || isExperimentalCapabilityRole(value);
}
