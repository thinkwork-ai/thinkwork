import type { ResolvedWorkspaceRenderTuple } from "./types.js";

function slugSegment(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

export function agentWorkspacePrefix(input: {
  tenantSlug: string;
  agentSlug: string;
}): string {
  return `tenants/${slugSegment(input.tenantSlug)}/agents/${slugSegment(
    input.agentSlug,
  )}/workspace/`;
}

export function spaceSourcePrefix(input: {
  tenantSlug: string;
  spaceSlug: string;
}): string {
  return `tenants/${slugSegment(input.tenantSlug)}/spaces/${slugSegment(
    input.spaceSlug,
  )}/source/`;
}

export function userWorkspacePrefix(input: {
  tenantId: string;
  userId: string;
}): string {
  return `tenants/${slugSegment(input.tenantId)}/users/${slugSegment(
    input.userId,
  )}/`;
}

export function renderedWorkspacePrefix(
  tuple: ResolvedWorkspaceRenderTuple,
): string {
  const userSegment = tuple.userSlug ?? tuple.userId ?? "anon";
  return `tenants/${slugSegment(tuple.tenantSlug)}/rendered/${slugSegment(
    tuple.agentSlug,
  )}/${slugSegment(tuple.spaceSlug)}/${slugSegment(userSegment)}/`;
}
