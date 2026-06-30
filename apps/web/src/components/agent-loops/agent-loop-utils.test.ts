import { describe, expect, it } from "vitest";
import {
  defaultAgentLoopDraft,
  draftToPayload,
  validateDraft,
} from "./agent-loop-utils";
import type {
  AgentLoopSpaceOption,
  AgentLoopWorkerOption,
} from "./agent-loop-types";

const workers: AgentLoopWorkerOption[] = [
  { id: "agent-1", type: "agent", label: "ThinkWork Agent" },
];
const spaces: AgentLoopSpaceOption[] = [
  { id: "space-1", name: "Customer", slug: "customer" },
];

describe("agent-loop-utils", () => {
  it("keeps advanced drafts strict about explicit completion criteria", () => {
    const draft = {
      ...defaultAgentLoopDraft(workers, spaces, "space-1"),
      creationMode: "advanced" as const,
      name: "Advanced loop",
      objective: "Review escalations",
      completionCriteriaText: "",
    };

    expect(validateDraft(draft)).toBe(
      "At least one completion criterion is required.",
    );
  });

  it("allows builder prompt-only drafts and marks goal inference", () => {
    const draft = {
      ...defaultAgentLoopDraft(workers, spaces, "space-1"),
      creationMode: "builder" as const,
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
      spaceId: "space-1",
      name: "Escalation review",
      goalSpec: {
        objective: "Review support escalations every morning.",
        completionCriteria: [],
      },
      workerSpec: { type: "agent", id: "" },
      judgeSpec: { mode: "self_check", criteria: [] },
      sourceMetadata: {
        createdFrom: "settings.automations.builder",
        creationMode: "builder",
        prompt: "Review support escalations every morning.",
        goalInference: "runtime_inferred",
      },
    });
  });

  it("derives an Automation name from prompt-first drafts without an explicit name", () => {
    const draft = {
      ...defaultAgentLoopDraft(workers, spaces, "space-1"),
      creationMode: "builder" as const,
      name: "",
      objective: "Route Linear issues to the right worker.",
    };

    expect(draft.creationMode).toBe("builder");

    expect(validateDraft(draft)).toBeNull();
    expect(
      draftToPayload({ draft, tenantId: "tenant-1", workerOptions: workers }),
    ).toMatchObject({
      name: "Route Linear issues to the right worker",
    });
  });
});
