import {
  runRequesterMemoryDreaming,
  type RequesterMemoryDreamingInput,
  type RequesterMemoryDreamingResult,
} from "../lib/requester-memory/dreaming.js";

type RequesterMemoryDreamingEvent = RequesterMemoryDreamingInput & {
  manual?: boolean;
};

export async function handler(
  event: RequesterMemoryDreamingEvent = {},
): Promise<RequesterMemoryDreamingResult> {
  if (
    process.env.REQUESTER_MEMORY_DREAMING_ENABLED !== "true" &&
    !event.manual
  ) {
    return {
      ok: true,
      runId: event.runId ?? "disabled",
      status: "no_change",
      users: [],
      budget: {
        usersConsidered: 0,
        usersProcessed: 0,
        llmCalls: 0,
        memoryWrites: 0,
        dryRun: Boolean(event.dryRun),
      },
    };
  }

  return runRequesterMemoryDreaming(event);
}
