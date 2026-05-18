import {
  runRequesterIdleMemoryLearning,
  type LearningCandidateSummary,
} from "../lib/requester-memory/learner.js";
import type { ChangedRequesterMemoryFile } from "../lib/requester-memory/storage.js";

type ThreadIdleMemoryLearningEvent = {
  runId?: string;
  tenantId?: string;
  threadId?: string;
  computerId?: string;
  requesterUserId?: string;
  scheduledJobId?: string;
  activitySequence?: number;
  scheduledFor?: string;
  lastActivityAt?: string;
};

type ThreadIdleMemoryLearningResult = {
  ok: boolean;
  status: "changed" | "no_change" | "failed";
  changedFiles: ChangedRequesterMemoryFile[];
  candidateSummary?: LearningCandidateSummary;
  reportS3Key?: string | null;
  error?: string;
  budget?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export async function handler(
  event: ThreadIdleMemoryLearningEvent,
): Promise<ThreadIdleMemoryLearningResult> {
  const missing = [
    "runId",
    "tenantId",
    "threadId",
    "computerId",
    "requesterUserId",
    "scheduledJobId",
    "scheduledFor",
    "lastActivityAt",
  ].filter((key) => !event[key as keyof ThreadIdleMemoryLearningEvent]);

  if (typeof event.activitySequence !== "number") {
    missing.push("activitySequence");
  }

  if (missing.length > 0) {
    return {
      ok: false,
      status: "failed",
      changedFiles: [],
      error: `missing required fields: ${missing.join(", ")}`,
    };
  }

  return runRequesterIdleMemoryLearning({
    runId: event.runId!,
    tenantId: event.tenantId!,
    threadId: event.threadId!,
    computerId: event.computerId!,
    requesterUserId: event.requesterUserId!,
    scheduledJobId: event.scheduledJobId!,
    activitySequence: event.activitySequence!,
    scheduledFor: event.scheduledFor!,
    lastActivityAt: event.lastActivityAt!,
  });
}
