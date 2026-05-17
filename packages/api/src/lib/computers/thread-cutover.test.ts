import { describe, expect, it } from "vitest";
import {
  buildRunbookConfirmationDecisionMessage,
  buildRunbookExecuteTaskInput,
} from "./thread-cutover.js";

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
      requesterUserId: "user-1",
      contextClass: "user",
    });
  });

  it("replaces a runbook confirmation part with a plain decision summary", () => {
    const result = buildRunbookConfirmationDecisionMessage({
      runbookRunId: "run-1",
      decision: "confirmed",
      parts: [
        {
          type: "text",
          id: "intro",
          text: "Please confirm before I start.",
        },
        {
          type: "data-runbook-confirmation",
          id: "runbook-confirmation:run-1",
          data: {
            runbookRunId: "run-1",
            displayName: "CRM Dashboard",
          },
        },
      ],
    });

    expect(result.summary).toBe(
      "User approved the CRM Dashboard runbook workflow.",
    );
    expect(result.parts).toEqual([
      {
        type: "text",
        id: "runbook-confirmation-decision:run-1",
        text: "User approved the CRM Dashboard runbook workflow.",
      },
    ]);
  });
});
