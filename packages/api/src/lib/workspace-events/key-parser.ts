export type WorkspaceEventfulKind =
  | "work_inbox"
  | "run_event"
  | "work_outbox"
  | "memory"
  | "review"
  | "errors"
  | "intent";

export interface ParsedWorkspaceEventKey {
  tenantSlug: string;
  agentSlug: string;
  workspaceRelativePath: string;
  targetPath: string;
  eventfulKind: WorkspaceEventfulKind;
  runId?: string;
  fileName: string;
}

const EVENTFUL_ROOTS = new Set(["work", "memory", "review", "errors", "events"]);

export function parseWorkspaceEventKey(
  objectKey: string,
): ParsedWorkspaceEventKey | null {
  const segments = objectKey.split("/").filter(Boolean);
  if (
    segments.length < 6 ||
    segments[0] !== "tenants" ||
    segments[2] !== "agents" ||
    segments[4] !== "workspace"
  ) {
    return null;
  }

  const tenantSlug = segments[1];
  const agentSlug = segments[3];
  const workspaceSegments = segments.slice(5);
  const eventfulIndex = workspaceSegments.findIndex((segment) =>
    EVENTFUL_ROOTS.has(segment),
  );
  if (eventfulIndex < 0) return null;

  const targetPath = workspaceSegments.slice(0, eventfulIndex).join("/");
  const eventful = workspaceSegments.slice(eventfulIndex);
  const workspaceRelativePath = workspaceSegments.join("/");
  const fileName = eventful[eventful.length - 1] ?? "";

  if (eventful[0] === "work" && eventful[1] === "inbox" && fileName) {
    return {
      tenantSlug,
      agentSlug,
      workspaceRelativePath,
      targetPath,
      eventfulKind: "work_inbox",
      fileName,
    };
  }

  if (
    eventful[0] === "work" &&
    eventful[1] === "runs" &&
    eventful[2] &&
    eventful[3] === "events" &&
    fileName
  ) {
    return {
      tenantSlug,
      agentSlug,
      workspaceRelativePath,
      targetPath,
      eventfulKind: "run_event",
      runId: eventful[2],
      fileName,
    };
  }

  if (eventful[0] === "work" && eventful[1] === "outbox" && fileName) {
    return {
      tenantSlug,
      agentSlug,
      workspaceRelativePath,
      targetPath,
      eventfulKind: "work_outbox",
      fileName,
    };
  }

  if (eventful[0] === "memory" && fileName) {
    return {
      tenantSlug,
      agentSlug,
      workspaceRelativePath,
      targetPath,
      eventfulKind: "memory",
      fileName,
    };
  }

  if (eventful[0] === "review" && fileName) {
    return {
      tenantSlug,
      agentSlug,
      workspaceRelativePath,
      targetPath,
      eventfulKind: "review",
      fileName,
    };
  }

  if (eventful[0] === "errors" && fileName) {
    return {
      tenantSlug,
      agentSlug,
      workspaceRelativePath,
      targetPath,
      eventfulKind: "errors",
      fileName,
    };
  }

  if (eventful[0] === "events" && eventful[1] === "intents" && fileName) {
    return {
      tenantSlug,
      agentSlug,
      workspaceRelativePath,
      targetPath,
      eventfulKind: "intent",
      fileName,
    };
  }

  return null;
}
