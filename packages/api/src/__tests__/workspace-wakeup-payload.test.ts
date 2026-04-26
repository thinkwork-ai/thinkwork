import { describe, expect, it } from "vitest";
import { normalizeWorkspaceWakeupPayload } from "../lib/workspace-events/wakeup-payload.js";

describe("workspace wakeup payload normalization", () => {
  it("prefers canonical workspace payload keys", () => {
    expect(
      normalizeWorkspaceWakeupPayload({
        workspaceRunId: "run-1",
        workspaceEventId: 42,
        workspaceTargetPath: "smoke-test",
        workspaceSourceObjectKey: "source.md",
        workspaceRequestObjectKey: "request.md",
        targetPath: "legacy-target",
        sourceObjectKey: "legacy-source.md",
        causeType: "review.responded",
        depth: 2,
        workspaceResumeReason: "review_accepted",
      }),
    ).toEqual({
      workspaceRunId: "run-1",
      workspaceEventId: 42,
      targetPath: "smoke-test",
      sourceObjectKey: "source.md",
      requestObjectKey: "request.md",
      causeEventId: undefined,
      causeType: "review.responded",
      depth: 2,
      resumeReason: "review_accepted",
    });
  });

  it("falls back to legacy payload keys for already queued wakeups", () => {
    expect(
      normalizeWorkspaceWakeupPayload({
        workspaceRunId: "run-1",
        workspaceEventId: 42,
        targetPath: "legacy-target",
        sourceObjectKey: "legacy-source.md",
      }),
    ).toMatchObject({
      workspaceRunId: "run-1",
      targetPath: "legacy-target",
      sourceObjectKey: "legacy-source.md",
      requestObjectKey: "legacy-source.md",
      causeType: "workspace_event",
    });
  });
});
