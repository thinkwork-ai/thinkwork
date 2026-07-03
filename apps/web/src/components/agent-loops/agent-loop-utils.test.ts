import { describe, expect, it } from "vitest";
import {
  defaultAgentLoopDraft,
  draftFromVersion,
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
  it("defaults new Automation drafts to a schedule trigger", () => {
    expect(defaultAgentLoopDraft(workers, spaces, "space-1")).toMatchObject({
      triggerFamily: "schedule",
      scheduleType: "rate",
      scheduleExpression: "rate(7 days)",
      timezone: "UTC",
    });
  });

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

  it("emits routineActionsSpec only when routines are attached (U5)", () => {
    const spaces: never[] = [];
    const base = defaultAgentLoopDraft(workers, spaces, null);
    const without = draftToPayload({
      draft: base,
      tenantId: "tenant-1",
      workerOptions: workers,
    });
    expect(without.routineActionsSpec).toBeNull();

    const withRoutines = draftToPayload({
      draft: {
        ...base,
        routineActionRoutineIds: ["33333333-3333-4333-8333-333333333333"],
        routineAgentTurn: false,
      },
      tenantId: "tenant-1",
      workerOptions: workers,
    });
    expect(withRoutines.routineActionsSpec).toEqual({
      actions: [{ routineId: "33333333-3333-4333-8333-333333333333" }],
      agentTurn: false,
    });
  });

  it("seeds routine actions back into the draft from a saved version (U5)", () => {
    const draft = draftFromVersion(
      {
        name: "LastMile check",
        lifecycleStatus: "active",
        enabled: true,
        currentVersion: {
          id: "v1",
          versionNumber: 1,
          triggerSpec: { family: "schedule", enabled: true, config: {} },
          goalSpec: { objective: "check", completionCriteria: [] },
          workerSpec: { type: "agent", id: "agent-1" },
          judgeSpec: { mode: "self_check", criteria: [] },
          loopPolicy: { maxIterations: 1 },
          evidencePolicy: { redactionState: "summary_only" },
          routineActionsSpec: {
            actions: [{ routineId: "33333333-3333-4333-8333-333333333333" }],
            agentTurn: false,
          },
        },
      },
      workers,
    );
    expect(draft.routineActionRoutineIds).toEqual([
      "33333333-3333-4333-8333-333333333333",
    ]);
    expect(draft.routineAgentTurn).toBe(false);
  });
});
