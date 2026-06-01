export type WorkspacePathOwner =
  | "agent"
  | "space"
  | "user"
  | "thread_notes"
  | "thread_goal"
  | "status"
  | "scratch"
  | "unowned";

export type WorkspaceContractWriteLane =
  | "agent_source"
  | "space_source"
  | "user_source"
  | "thread_notes"
  | "thread_goal"
  | "generated_read_only"
  | "scratch"
  | "none";

export interface WorkspacePathContract {
  path: string;
  owner: WorkspacePathOwner;
  sourcePath: string;
  writeLane: WorkspaceContractWriteLane;
  readOnly: boolean;
  generated: boolean;
}

const GENERATED_WORKSPACE_PROJECTION_PATHS = new Set([
  "Spaces/INDEX.md",
  "Thread/THREAD.md",
  "Thread/GOAL.md",
  "Thread/PROGRESS.md",
  "Thread/TASKS.md",
]);

function isAgentSourcePath(path: string): boolean {
  return (
    path === "AGENTS.md" ||
    path === "CONTEXT.md" ||
    path === "GUARDRAILS.md" ||
    path === "MEMORY_GUIDE.md" ||
    path === "ROUTER.md" ||
    path === "TOOLS.md" ||
    path === "MCP.md" ||
    path.startsWith("memory/") ||
    path.startsWith("skills/") ||
    path.startsWith("workspaces/")
  );
}

function stripTopLevelWorkspaceFolder(path: string): {
  owner: "agent" | "space" | "user" | "thread" | null;
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
  if (clean === "Thread") return { owner: "thread", sourcePath: "" };
  if (clean.startsWith("Thread/")) {
    return { owner: "thread", sourcePath: clean.slice("Thread/".length) };
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

export function isGeneratedWorkspaceProjection(path: string): boolean {
  const clean = path.replace(/^\/+/, "");
  return GENERATED_WORKSPACE_PROJECTION_PATHS.has(clean);
}

export function workspacePathOwner(path: string): WorkspacePathOwner {
  const clean = path.replace(/^\/+/, "");
  if (!clean || clean.includes("..") || clean.includes("\\")) return "unowned";
  if (clean === "scratch" || clean.startsWith("scratch/")) return "scratch";
  if (isGeneratedWorkspaceProjection(clean)) return "status";
  const topLevel = stripTopLevelWorkspaceFolder(clean);
  const sourcePath = topLevel.sourcePath;
  if (!sourcePath && topLevel.owner) {
    return topLevel.owner === "thread" ? "unowned" : topLevel.owner;
  }
  if (topLevel.owner === "thread") {
    if (sourcePath.startsWith("notes/") && sourcePath !== "notes/") {
      return "thread_notes";
    }
    return "unowned";
  }
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
      sourcePath.startsWith("plans/") ||
      sourcePath.startsWith("artifacts/") ||
      sourcePath.startsWith("workflows/") ||
      sourcePath.startsWith("knowledge/"))
  ) {
    return "space";
  }
  if (
    topLevel.owner === "agent" &&
    (isAgentSourcePath(sourcePath) ||
      sourcePath === "IDENTITY.md" ||
      sourcePath === "CAPABILITIES.md")
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
  if (clean === "USER.md") return "user";
  if (
    clean === "SPACE.md" ||
    clean.startsWith("docs/") ||
    clean.startsWith("goals/") ||
    clean.startsWith("plans/") ||
    clean.startsWith("artifacts/") ||
    clean.startsWith("workflows/") ||
    clean.startsWith("knowledge/")
  ) {
    return "space";
  }
  if (
    isAgentSourcePath(clean) ||
    clean === "IDENTITY.md" ||
    clean === "CAPABILITIES.md"
  ) {
    return "agent";
  }
  return "unowned";
}

export function workspacePathContract(path: string): WorkspacePathContract {
  const clean = path.replace(/^\/+/, "");
  const owner = workspacePathOwner(clean);
  const sourcePath = workspaceSourcePath(clean);
  const generated = isGeneratedWorkspaceProjection(clean);

  if (generated || owner === "status") {
    return {
      path: clean,
      owner,
      sourcePath,
      writeLane: "generated_read_only",
      readOnly: true,
      generated: true,
    };
  }

  switch (owner) {
    case "agent":
      return {
        path: clean,
        owner,
        sourcePath,
        writeLane: "agent_source",
        readOnly: false,
        generated: false,
      };
    case "space":
      return {
        path: clean,
        owner,
        sourcePath,
        writeLane: "space_source",
        readOnly: false,
        generated: false,
      };
    case "user":
      return {
        path: clean,
        owner,
        sourcePath,
        writeLane: "user_source",
        readOnly: false,
        generated: false,
      };
    case "thread_notes":
      return {
        path: clean,
        owner,
        sourcePath,
        writeLane: "thread_notes",
        readOnly: false,
        generated: false,
      };
    case "thread_goal":
      return {
        path: clean,
        owner,
        sourcePath,
        writeLane: "thread_goal",
        readOnly: false,
        generated: false,
      };
    case "scratch":
      return {
        path: clean,
        owner,
        sourcePath,
        writeLane: "scratch",
        readOnly: false,
        generated: false,
      };
    case "unowned":
    default:
      return {
        path: clean,
        owner,
        sourcePath,
        writeLane: "none",
        readOnly: true,
        generated: false,
      };
  }
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
