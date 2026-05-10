import { describe, expect, it } from "vitest";
import { buildRunbookExecuteTaskInput } from "./thread-cutover.js";

describe("thread cutover runbook helpers", () => {
  it("builds normalized runbook_execute task input", () => {
    expect(
      buildRunbookExecuteTaskInput({
        runbookRunId: "run-1",
        threadId: "thread-1",
        messageId: "message-1",
        actorType: "user",
        actorId: "user-1",
      }),
    ).toEqual({
      runbookRunId: "run-1",
      threadId: "thread-1",
      messageId: "message-1",
      actorType: "user",
      actorId: "user-1",
    });
  });
});
