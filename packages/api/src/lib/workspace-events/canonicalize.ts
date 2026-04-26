import { createHash } from "node:crypto";
import type { ParsedWorkspaceEventKey } from "./key-parser.js";

export type CanonicalWorkspaceEventType =
  | "work.requested"
  | "run.started"
  | "run.blocked"
  | "run.completed"
  | "run.failed"
  | "review.requested"
  | "review.responded"
  | "memory.changed"
  | "event.rejected";

export interface CanonicalWorkspaceEventDraft {
  eventType: CanonicalWorkspaceEventType;
  idempotencyKey: string;
  runId?: string;
  reason?: string;
  payload: Record<string, unknown>;
}

export function workspaceEventIdempotencyKey(
  canonicalObjectKey: string,
  sequencer: string,
): string {
  return createHash("sha256")
    .update(`${canonicalObjectKey}:${sequencer}`)
    .digest("hex");
}

export function canonicalizeWorkspaceEvent(
  parsed: ParsedWorkspaceEventKey,
  sourceObjectKey: string,
  sequencer: string,
): CanonicalWorkspaceEventDraft {
  const idempotencyKey = workspaceEventIdempotencyKey(
    sourceObjectKey,
    sequencer,
  );
  const basePayload = {
    targetPath: parsed.targetPath,
    workspaceRelativePath: parsed.workspaceRelativePath,
    fileName: parsed.fileName,
  };

  switch (parsed.eventfulKind) {
    case "work_inbox":
      return {
        eventType: "work.requested",
        idempotencyKey,
        payload: basePayload,
      };
    case "memory":
      return {
        eventType: "memory.changed",
        idempotencyKey,
        payload: basePayload,
      };
    case "review":
      return {
        eventType: "review.requested",
        idempotencyKey,
        runId: parseRunIdFromReviewFile(parsed.fileName),
        payload: basePayload,
      };
    case "errors":
      return {
        eventType: "run.failed",
        idempotencyKey,
        payload: basePayload,
        reason: "error_file_written",
      };
    case "work_outbox":
      return {
        eventType: "run.completed",
        idempotencyKey,
        payload: basePayload,
      };
    case "run_event":
      return {
        eventType: inferRunEventType(parsed.fileName),
        idempotencyKey,
        runId: parsed.runId,
        payload: basePayload,
      };
    case "audit":
    case "intent":
      return {
        eventType: "event.rejected",
        idempotencyKey,
        payload: basePayload,
        reason: `${parsed.eventfulKind}_requires_orchestration_writer`,
      };
  }
}

function inferRunEventType(fileName: string): CanonicalWorkspaceEventType {
  const lower = fileName.toLowerCase();
  if (lower.includes("started")) return "run.started";
  if (lower.includes("blocked")) return "run.blocked";
  if (lower.includes("completed")) return "run.completed";
  if (lower.includes("failed")) return "run.failed";
  if (lower.includes("review")) return "review.requested";
  return "event.rejected";
}

function parseRunIdFromReviewFile(fileName: string): string | undefined {
  const match = /^(run_[^.]+|[0-9a-f-]{36})/.exec(fileName);
  return match?.[1];
}
