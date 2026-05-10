import { describe, expect, it } from "vitest";
import { runbookRegistry } from "@thinkwork/runbooks";
import {
  buildRunbookAmbiguityMessage,
  buildRunbookConfirmationMessage,
  buildRunbookQueueMessage,
} from "./confirmation-message.js";

const runbook = runbookRegistry.require("map-artifact");
const run = {
  id: "run-1",
  status: "AWAITING_CONFIRMATION",
  runbookSlug: "map-artifact",
  runbookVersion: "0.1.0",
  tasks: [
    {
      id: "task-1",
      phaseId: "discover",
      phaseTitle: "Discover map data",
      taskKey: "discover:1",
      title: "Identify location-bearing entities",
      status: "PENDING",
      dependsOn: [],
      sortOrder: 1,
    },
  ],
};

describe("runbook assistant messages", () => {
  it("builds a confirmation data part with approval copy", () => {
    const message = buildRunbookConfirmationMessage({
      run,
      runbook,
      sourceMessageId: "message-1",
      confidence: 0.8,
      matchedKeywords: ["map", "supplier"],
    });

    expect(message.parts).toContainEqual(
      expect.objectContaining({
        type: "data-runbook-confirmation",
        data: expect.objectContaining({
          mode: "approval",
          runbookRunId: "run-1",
          runbookSlug: "map-artifact",
          expectedOutputs: runbook.approval.expectedOutputs,
          phaseSummary: runbook.approval.phaseSummary,
        }),
      }),
    );
  });

  it("builds a queue data part grouped by declared phase", () => {
    const message = buildRunbookQueueMessage({
      run: { ...run, status: "QUEUED" },
      runbook,
      sourceMessageId: "message-1",
    });

    const queue = message.parts.find(
      (part) => part.type === "data-runbook-queue",
    );
    expect(queue?.data).toEqual(
      expect.objectContaining({
        runbookRunId: "run-1",
        status: "QUEUED",
        phases: expect.arrayContaining([
          expect.objectContaining({
            id: "discover",
            tasks: [expect.objectContaining({ key: "discover:1" })],
          }),
        ]),
      }),
    );
  });

  it("builds an ambiguity choice part without a run id", () => {
    const message = buildRunbookAmbiguityMessage({
      candidates: [
        { runbook, confidence: 0.7 },
        {
          runbook: runbookRegistry.require("research-dashboard"),
          confidence: 0.68,
        },
      ],
    });

    expect(message.parts).toContainEqual(
      expect.objectContaining({
        type: "data-runbook-confirmation",
        data: expect.objectContaining({ mode: "choice" }),
      }),
    );
  });
});
