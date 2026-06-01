import type { ResolvedWorkspaceRenderTuple } from "./types.js";
export {
  isGeneratedWorkspaceProjection,
  workspacePathContract,
  workspacePathOwner,
  workspaceSourcePath,
  type WorkspaceContractWriteLane,
  type WorkspacePathContract,
  type WorkspacePathOwner,
} from "../workspace-lanes.js";

function slugSegment(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

export function agentWorkspacePrefix(input: {
  tenantSlug: string;
  agentSlug: string;
}): string {
  return `tenants/${slugSegment(input.tenantSlug)}/agents/${slugSegment(
    input.agentSlug,
  )}/`;
}

export function spaceSourcePrefix(input: {
  tenantSlug: string;
  spaceSlug: string;
}): string {
  return `tenants/${slugSegment(input.tenantSlug)}/spaces/${slugSegment(
    input.spaceSlug,
  )}/`;
}

export function userWorkspacePrefix(input: {
  tenantSlug: string;
  userSlug: string;
}): string {
  return `tenants/${slugSegment(input.tenantSlug)}/users/${slugSegment(
    input.userSlug,
  )}/`;
}

export function threadRuntimePrefix(
  tuple: ResolvedWorkspaceRenderTuple,
): string {
  const threadSegment = tuple.threadSlug ?? tuple.threadId ?? "thread";
  return `tenants/${slugSegment(tuple.tenantSlug)}/threads/${slugSegment(
    threadSegment,
  )}/`;
}
