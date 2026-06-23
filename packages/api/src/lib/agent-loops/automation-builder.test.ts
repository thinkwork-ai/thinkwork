import { describe, expect, it } from "vitest";
import {
  AUTOMATION_LOOP_DESIGNER_SKILL_SLUG,
  buildAutomationBuilderDraft,
  buildAutomationBuilderOpeningMessage,
} from "./automation-builder.js";

describe("automation builder", () => {
  it("builds a prompt-first chat draft linked to the setup thread", () => {
    const draft = buildAutomationBuilderDraft({
      builderThreadId: "thread-1",
      title: "Linear dispatcher",
      prompt: "Route Linear issues to the right implementation worker.",
    });

    expect(draft).toMatchObject({
      creationMode: "chat",
      name: "Linear dispatcher",
      objective: "Route Linear issues to the right implementation worker.",
      workerId: "",
      judgeMode: "self_check",
      builderThreadId: "thread-1",
    });
    expect(draft.sourceMetadata).toMatchObject({
      createdFrom: "settings.automations.chat",
      goalInference: "runtime_inferred",
      designerSkill: AUTOMATION_LOOP_DESIGNER_SKILL_SLUG,
      designerSourceLicense: "MIT",
    });
  });

  it("seeds builder threads with loop-design coaching questions", () => {
    const message = buildAutomationBuilderOpeningMessage({
      prompt: "Watch failed deploys.",
    });

    expect(message).toContain("Automation Loop Designer skill");
    expect(message).toContain("Starting prompt:");
    expect(message).toContain("Watch failed deploys.");
    expect(message).toContain("What should the Automation accomplish");
    expect(message).toContain("What evidence or final response");
  });
});
