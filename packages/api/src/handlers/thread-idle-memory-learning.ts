/**
 * Requester idle memory learning worker.
 *
 * Slice A intentionally stops short of writing requester memory. The scheduler
 * and stale-guard path can now run end-to-end, while the worker returns a
 * durable no-op result until the OpenClaw-inspired learner is implemented.
 */

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
  status: "no_change" | "failed";
  changedFiles: string[];
  candidateSummary?: Record<string, unknown>;
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

  return {
    ok: true,
    status: "no_change",
    changedFiles: [],
    candidateSummary: {
      reason: "worker_shell",
      note: "Idle-learning scheduling is wired; memory synthesis ships in the learner slice.",
    },
    budget: {
      mode: "inert",
      llmCalls: 0,
      memoryWrites: 0,
    },
    metadata: {
      runId: event.runId,
      scheduledJobId: event.scheduledJobId,
      activitySequence: event.activitySequence,
    },
  };
}
