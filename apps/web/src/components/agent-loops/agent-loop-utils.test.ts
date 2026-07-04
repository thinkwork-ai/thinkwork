import { describe, expect, it } from "vitest";
import {
  defaultAgentLoopDraft,
  draftFromVersion,
  draftToPayload,
  readTargetSpec,
  spaceFieldError,
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
const ROUTINE_ID = "33333333-3333-4333-8333-333333333333";

describe("agent-loop-utils", () => {
  it("defaults new Automation drafts to a schedule trigger + agent_thread target", () => {
    expect(
      defaultAgentLoopDraft(workers, spaces, "space-1", "user-1"),
    ).toMatchObject({
      triggerFamily: "schedule",
      scheduleExpression: "rate(7 days)",
      targetKind: "agent_thread",
      threadMode: "new_per_run",
      workerId: "agent-1",
      runAsUserId: "user-1",
      spaceId: "space-1",
    });
  });

  it("writes an agent_thread targetSpec from instructions (no Space required error surface)", () => {
    const draft = {
      ...defaultAgentLoopDraft(workers, spaces, "space-1", "user-1"),
      instructions: "Route Linear issues to the right worker.",
    };
    expect(validateDraft(draft)).toBeNull();
    const payload = draftToPayload({
      draft,
      tenantId: "tenant-1",
      workerOptions: workers,
    });
    expect(payload).toMatchObject({
      tenantId: "tenant-1",
      name: "Route Linear issues to the right worker",
      runAsUserId: "user-1",
      spaceId: "space-1",
      triggerSpec: {
        family: "schedule",
        config: { scheduleExpression: "rate(7 days)" },
      },
      targetSpec: {
        kind: "agent_thread",
        agentThread: {
          instructions: "Route Linear issues to the right worker.",
          workerId: "agent-1",
          workerType: "agent",
          threadMode: "new_per_run",
        },
      },
    });
    // Legacy inputs are still derived so the API contract is satisfied.
    expect(payload.goalSpec.objective).toBe(
      "Route Linear issues to the right worker.",
    );
    expect(payload.workerSpec).toMatchObject({ type: "agent", id: "agent-1" });
  });

  it("writes a routine targetSpec and needs no Space", () => {
    const draft = {
      ...defaultAgentLoopDraft(workers, [], null, "user-1"),
      targetKind: "routine" as const,
      routineId: ROUTINE_ID,
    };
    expect(validateDraft(draft)).toBeNull();
    expect(spaceFieldError(draft)).toBeNull();
    const payload = draftToPayload({
      draft,
      tenantId: "tenant-1",
      workerOptions: workers,
      routineLabel: "Nightly digest",
    });
    expect(payload.targetSpec).toEqual({
      kind: "routine",
      routine: { routineId: ROUTINE_ID },
    });
    expect(payload.name).toBe("Nightly digest");
    expect(payload.spaceId).toBeNull();
  });

  it("requires a Space the moment agent_thread is selected (inline)", () => {
    const draft = {
      ...defaultAgentLoopDraft(workers, [], null, "user-1"),
      targetKind: "agent_thread" as const,
      instructions: "Do the thing.",
      spaceId: "",
    };
    expect(spaceFieldError(draft)).toBe(
      "A Space is required for agent-thread automations.",
    );
    expect(validateDraft(draft)).toBe("Choose a Space.");
  });

  it("round-trips R1 fields from a saved version via targetSpec", () => {
    const draft = draftFromVersion(
      {
        name: "Linear dispatcher",
        description: "Route Linear work",
        lifecycleStatus: "active",
        enabled: true,
        runAsUserId: "user-9",
        spaceId: "space-1",
        currentVersion: {
          id: "v1",
          versionNumber: 1,
          triggerSpec: {
            family: "webhook",
            enabled: true,
            config: {},
          },
          goalSpec: {},
          workerSpec: {},
          judgeSpec: {},
          loopPolicy: {},
          evidencePolicy: {},
          targetSpec: {
            kind: "agent_thread",
            agentThread: {
              instructions: "Dispatch issues",
              workerId: "agent-1",
              workerType: "agent",
              threadMode: "fixed",
              fixedThreadId: "thread-77",
            },
          },
        },
      },
      workers,
      spaces,
      "space-1",
      "user-1",
    );
    expect(draft).toMatchObject({
      name: "Linear dispatcher",
      triggerFamily: "webhook",
      targetKind: "agent_thread",
      instructions: "Dispatch issues",
      threadMode: "fixed",
      fixedThreadId: "thread-77",
      runAsUserId: "user-9",
      spaceId: "space-1",
    });
  });

  it("falls back to legacy goal/worker blobs when targetSpec is absent", () => {
    const target = readTargetSpec({
      id: "v0",
      versionNumber: 1,
      triggerSpec: {},
      goalSpec: { objective: "Legacy objective" },
      workerSpec: { type: "agent", id: "agent-1" },
      judgeSpec: {},
      loopPolicy: {},
      evidencePolicy: {},
    });
    expect(target).toMatchObject({
      kind: "agent_thread",
      agentThread: { instructions: "Legacy objective", workerId: "agent-1" },
    });
  });

  it("falls back to routine kind for a legacy routine-only version", () => {
    const target = readTargetSpec({
      id: "v0",
      versionNumber: 1,
      triggerSpec: {},
      goalSpec: {},
      workerSpec: {},
      judgeSpec: {},
      loopPolicy: {},
      evidencePolicy: {},
      routineActionsSpec: {
        actions: [{ routineId: ROUTINE_ID }],
        agentTurn: false,
      },
    });
    expect(target).toEqual({
      kind: "routine",
      routine: { routineId: ROUTINE_ID },
    });
  });
});
