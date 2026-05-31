export type WorkspacePathOwner =
  | "agent"
  | "space"
  | "user"
  | "thread_goal"
  | "status"
  | "scratch"
  | "unowned";

function stripTopLevelWorkspaceFolder(path: string): {
  owner: "agent" | "space" | "user" | null;
  sourcePath: string;
} {
  const clean = path.replace(/^\/+/, "");
  if (clean === "Agent") return { owner: "agent", sourcePath: "" };
  if (clean.startsWith("Agent/")) {
    return { owner: "agent", sourcePath: clean.slice("Agent/".length) };
  }
  if (clean === "User") return { owner: "user", sourcePath: "" };
  if (clean.startsWith("User/")) {
    return { owner: "user", sourcePath: clean.slice("User/".length) };
  }
  if (clean === "Spaces") return { owner: "space", sourcePath: "" };
  if (clean.startsWith("Spaces/")) {
    const [, _spaceFolder, ...rest] = clean.split("/");
    return { owner: "space", sourcePath: rest.join("/") };
  }
  if (clean === "Space") return { owner: "space", sourcePath: "" };
  if (clean.startsWith("Space/")) {
    return { owner: "space", sourcePath: clean.slice("Space/".length) };
  }
  return { owner: null, sourcePath: clean };
}

export function workspaceSourcePath(path: string): string {
  return stripTopLevelWorkspaceFolder(path).sourcePath;
}

export function workspacePathOwner(path: string): WorkspacePathOwner {
  const clean = path.replace(/^\/+/, "");
  if (!clean || clean.includes("..") || clean.includes("\\")) return "unowned";
  if (clean === "scratch" || clean.startsWith("scratch/")) return "scratch";
  const topLevel = stripTopLevelWorkspaceFolder(clean);
  const sourcePath = topLevel.sourcePath;
  if (!sourcePath && topLevel.owner) return topLevel.owner;
  if (sourcePath === "GOAL.md" || sourcePath === "PROGRESS.md") {
    return "status";
  }
  if (
    sourcePath === "DECISIONS.md" ||
    sourcePath === "ARTIFACTS.md" ||
    sourcePath === "HANDOFFS.md" ||
    /^stages\/[^/]+\/(?:CONTEXT|OUTPUT)\.md$/.test(sourcePath)
  ) {
    return "thread_goal";
  }
  if (topLevel.owner === "user") {
    return sourcePath === "USER.md" || sourcePath.startsWith("memory/")
      ? "user"
      : "unowned";
  }
  if (
    topLevel.owner === "space" &&
    (sourcePath === "SPACE.md" ||
      sourcePath === "CONTEXT.md" ||
      sourcePath.startsWith("docs/") ||
      sourcePath.startsWith("goals/") ||
      sourcePath.startsWith("knowledge/"))
  ) {
    return "space";
  }
  if (
    topLevel.owner === "agent" &&
    (sourcePath === "AGENTS.md" ||
      sourcePath === "IDENTITY.md" ||
      sourcePath === "CAPABILITIES.md" ||
      sourcePath.startsWith("skills/"))
  ) {
    return "agent";
  }
  if (topLevel.owner) return "unowned";
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
  const clean = workspaceSourcePath(path).replace(/^\/+/, "");
  if (clean === "USER.md") return true;
  if (!clean.startsWith("memory/")) return false;
  if (clean.startsWith("memory/.") || clean.includes("/.")) return false;
  if (clean.startsWith("memory/reports/")) return false;
  return true;
}

export function isProtectedOrchestrationWritePath(path: string): boolean {
  const clean = workspaceSourcePath(path);
  return (
    clean.startsWith("work/inbox/") ||
    clean.startsWith("review/") ||
    /^work\/runs\/[^/]+\/events\//.test(clean) ||
    clean.startsWith("events/intents/") ||
    clean.startsWith("events/audit/")
  );
}

export function isSpaceCapabilityWritePath(path: string): boolean {
  const clean = workspaceSourcePath(path);
  return (
    clean === "skills" ||
    clean.startsWith("skills/") ||
    clean === "TOOLS.md" ||
    clean === "MCP.md"
  );
}
