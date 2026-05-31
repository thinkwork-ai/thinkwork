export type WorkspacePathOwner =
  | "agent"
  | "space"
  | "user"
  | "thread_goal"
  | "status"
  | "scratch"
  | "unowned";

export function workspacePathOwner(path: string): WorkspacePathOwner {
  const clean = path.replace(/^\/+/, "");
  if (!clean || clean.includes("..") || clean.includes("\\")) return "unowned";
  if (clean === "scratch" || clean.startsWith("scratch/")) return "scratch";
  if (clean === "GOAL.md" || clean === "PROGRESS.md") return "status";
  if (
    clean === "DECISIONS.md" ||
    clean === "ARTIFACTS.md" ||
    clean === "HANDOFFS.md" ||
    /^stages\/[^/]+\/(?:CONTEXT|OUTPUT)\.md$/.test(clean)
  ) {
    return "thread_goal";
  }
  if (clean === "USER.md" || clean.startsWith("memory/")) return "user";
  if (
    clean === "SPACE.md" ||
    clean === "CONTEXT.md" ||
    clean.startsWith("docs/") ||
    clean.startsWith("goals/") ||
    clean.startsWith("knowledge/")
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

export function isVisibleUserContextPath(path: string): boolean {
  const clean = path.replace(/^\/+/, "");
  if (clean === "USER.md") return true;
  if (!clean.startsWith("memory/")) return false;
  if (clean.startsWith("memory/.") || clean.includes("/.")) return false;
  if (clean.startsWith("memory/reports/")) return false;
  return true;
}

export function isProtectedOrchestrationWritePath(path: string): boolean {
  return (
    path.startsWith("work/inbox/") ||
    path.startsWith("review/") ||
    /^work\/runs\/[^/]+\/events\//.test(path) ||
    path.startsWith("events/intents/") ||
    path.startsWith("events/audit/")
  );
}

export function isSpaceCapabilityWritePath(path: string): boolean {
  return (
    path === "skills" ||
    path.startsWith("skills/") ||
    path === "TOOLS.md" ||
    path === "MCP.md"
  );
}
