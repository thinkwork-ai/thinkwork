import { describe, expect, it } from "vitest";
import {
  DEFAULT_SELF_CHECK_JUDGE_CRITERIA,
  RUNTIME_INFERRED_COMPLETION_CRITERION,
  normalizeAutomationDraft,
  promptFirstDraftNeedsDefaultWorker,
} from "./automation-draft.js";

describe("normalizeAutomationDraft", () => {
  it("infers goal, judge, and default worker settings for builder drafts", () => {
    const normalized = normalizeAutomationDraft({
      goalSpec: {
        objective: "Check customer escalations",
        completionCriteria: [],
      },
      workerSpec: { type: "agent", id: "", toolHints: [], config: {} },
      judgeSpec: { mode: "self_check", criteria: [], config: {} },
      sourceMetadata: {
        createdFrom: "settings.automations.builder",
        creationMode: "builder",
      },
      defaultWorker: {
        type: "agent",
        id: "agent-1",
        label: "ThinkWork Agent",
      },
    });

    expect(normalized.goalSpec).toMatchObject({
      objective: "Check customer escalations",
      completionCriteria: [RUNTIME_INFERRED_COMPLETION_CRITERION],
    });
    expect(normalized.workerSpec).toMatchObject({
      type: "agent",
      id: "agent-1",
      label: "ThinkWork Agent",
    });
    expect(normalized.judgeSpec).toMatchObject({
      mode: "self_check",
      criteria: DEFAULT_SELF_CHECK_JUDGE_CRITERIA,
    });
    expect(normalized.sourceMetadata).toMatchObject({
      prompt: "Check customer escalations",
      goalInference: "runtime_inferred",
      judgeInference: "default_self_check",
      workerInference: "tenant_default_agent",
    });
  });

  it("preserves explicit completion criteria for prompt-first drafts", () => {
    const normalized = normalizeAutomationDraft({
      goalSpec: {
        objective: "Review new Linear issues",
        completionCriteria: ["A routing decision is posted."],
      },
      workerSpec: {
        type: "agent",
        id: "agent-1",
        toolHints: [],
        config: {},
      },
      judgeSpec: {
        mode: "self_check",
        criteria: ["Decision is clear."],
        config: {},
      },
      sourceMetadata: { creationMode: "chat" },
    });

    expect(normalized.goalSpec.completionCriteria).toEqual([
      "A routing decision is posted.",
    ]);
    expect(normalized.sourceMetadata.goalInference).toBe("explicit");
    expect(normalized.sourceMetadata.judgeInference).toBeUndefined();
    expect(normalized.sourceMetadata.workerInference).toBeUndefined();
  });

  it("does not normalize advanced drafts implicitly", () => {
    const input = {
      goalSpec: { objective: "Advanced loop", completionCriteria: [] },
      workerSpec: { type: "agent", id: "", toolHints: [], config: {} },
      judgeSpec: { mode: "self_check", criteria: [], config: {} },
      sourceMetadata: { createdFrom: "settings.automations.advanced" },
    };

    expect(normalizeAutomationDraft(input)).toEqual(input);
    expect(promptFirstDraftNeedsDefaultWorker(input)).toBe(false);
  });
});
