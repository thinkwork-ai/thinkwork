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

export type WorkspacePathOwner =
  | "agent"
  | "space"
  | "user"
  | "scratch"
  | "unowned";

export function workspacePathOwner(path: string): WorkspacePathOwner {
  const clean = path.replace(/^\/+/, "");
  if (!clean || clean.includes("..") || clean.includes("\\")) return "unowned";
  if (clean === "scratch" || clean.startsWith("scratch/")) return "scratch";
  if (clean === "USER.md" || clean.startsWith("memory/")) return "user";
  if (
    clean === "SPACE.md" ||
    clean === "CONTEXT.md" ||
    clean.startsWith("docs/") ||
    clean.startsWith("goals/")
  ) {
    return "space";
  }
  if (
    clean === "AGENTS.md" ||
    clean === "IDENTITY.md" ||
    clean === "CAPABILITIES.md" ||
    clean.startsWith("skills/")
  ) {
    return "agent";
  }
  return "unowned";
}
