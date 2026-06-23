import { describe, expect, it } from "vitest";
import {
  defaultAgentLoopDraft,
  draftToPayload,
  validateDraft,
} from "./agent-loop-utils";
import type { AgentLoopWorkerOption } from "./agent-loop-types";

const workers: AgentLoopWorkerOption[] = [
  { id: "agent-1", type: "agent", label: "ThinkWork Agent" },
];

describe("agent-loop-utils", () => {
  it("keeps advanced drafts strict about explicit completion criteria", () => {
    const draft = {
      ...defaultAgentLoopDraft(workers),
      name: "Advanced loop",
      objective: "Review escalations",
      completionCriteriaText: "",
    };

    expect(validateDraft(draft)).toBe(
      "At least one completion criterion is required.",
    );
  });

  it("allows easy prompt-only drafts and marks goal inference", () => {
    const draft = {
      ...defaultAgentLoopDraft(workers),
      creationMode: "easy" as const,
      name: "Escalation review",
      objective: "Review support escalations every morning.",
      completionCriteriaText: "",
      workerId: "",
      judgeCriteriaText: "",
    };

    expect(validateDraft(draft)).toBeNull();
    expect(
      draftToPayload({ draft, tenantId: "tenant-1", workerOptions: workers }),
    ).toMatchObject({
      tenantId: "tenant-1",
      name: "Escalation review",
      goalSpec: {
        objective: "Review support escalations every morning.",
        completionCriteria: [],
      },
      workerSpec: { type: "agent", id: "" },
      judgeSpec: { mode: "self_check", criteria: [] },
      sourceMetadata: {
        createdFrom: "settings.automations.easy",
        creationMode: "easy",
        prompt: "Review support escalations every morning.",
        goalInference: "runtime_inferred",
      },
    });
  });
});
