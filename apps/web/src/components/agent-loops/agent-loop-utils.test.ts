import { describe, expect, it } from "vitest";
import {
  customSchedulePatch,
  defaultAgentLoopDraft,
  draftFromVersion,
  draftToPayload,
  parseScheduleFromDraft,
  readTargetSpec,
  schedulePatch,
  scheduleValueLabel,
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

describe("schedule popover helpers", () => {
  const draft = defaultAgentLoopDraft(workers, spaces, "space-1", "user-1");

  it("serializes each preset to the EventBridge config shape", () => {
    expect(schedulePatch({ preset: "manual" })).toEqual({
      triggerFamily: "manual",
      scheduleType: "",
      scheduleExpression: "",
    });
    expect(schedulePatch({ preset: "hourly" })).toMatchObject({
      triggerFamily: "schedule",
      scheduleType: "rate",
      scheduleExpression: "rate(1 hour)",
      timezone: "UTC",
    });
    expect(
      schedulePatch({ preset: "daily", minutesOfDay: 9 * 60 }),
    ).toMatchObject({
      scheduleType: "cron",
      scheduleExpression: "cron(0 9 * * ? *)",
    });
    expect(
      schedulePatch({ preset: "weekdays", minutesOfDay: 17 * 60 + 45 }),
    ).toMatchObject({
      scheduleExpression: "cron(45 17 ? * MON-FRI *)",
    });
    expect(
      schedulePatch({ preset: "weekly", minutesOfDay: 9 * 60, weekday: "THU" }),
    ).toMatchObject({
      scheduleExpression: "cron(0 9 ? * THU *)",
    });
  });

  it("passes custom expressions through raw with the type derived from the prefix", () => {
    expect(customSchedulePatch("rate(30 minutes)")).toEqual({
      triggerFamily: "schedule",
      scheduleType: "rate",
      scheduleExpression: "rate(30 minutes)",
    });
    expect(customSchedulePatch("cron(15 6 1 * ? *)")).toEqual({
      triggerFamily: "schedule",
      scheduleType: "cron",
      scheduleExpression: "cron(15 6 1 * ? *)",
    });
  });

  it("parses drafts back into the preset model (legacy rate(7 days) → Weekly)", () => {
    expect(parseScheduleFromDraft(draft).preset).toBe("weekly");
    expect(
      parseScheduleFromDraft({
        ...draft,
        scheduleExpression: "cron(30 14 ? * FRI *)",
      }),
    ).toMatchObject({
      preset: "weekly",
      minutesOfDay: 14 * 60 + 30,
      weekday: "FRI",
    });
    expect(
      parseScheduleFromDraft({ ...draft, scheduleExpression: "rate(1 hour)" })
        .preset,
    ).toBe("hourly");
    expect(
      parseScheduleFromDraft({
        ...draft,
        scheduleExpression: "rate(30 minutes)",
      }).preset,
    ).toBe("custom");
    expect(
      parseScheduleFromDraft({ ...draft, triggerFamily: "manual" as const })
        .preset,
    ).toBe("manual");
  });

  it("renders the closed Schedule row value text", () => {
    expect(scheduleValueLabel(draft)).toBe("Weekly");
    expect(
      scheduleValueLabel({
        ...draft,
        scheduleExpression: "cron(0 9 ? * MON-FRI *)",
      }),
    ).toBe("Weekdays at 9:00 AM");
    expect(
      scheduleValueLabel({
        ...draft,
        scheduleExpression: "cron(30 14 ? * FRI *)",
      }),
    ).toBe("Weekly on Friday at 2:30 PM");
    expect(
      scheduleValueLabel({ ...draft, scheduleExpression: "cron(0 9 * * ? *)" }),
    ).toBe("Daily at 9:00 AM");
    expect(
      scheduleValueLabel({ ...draft, scheduleExpression: "rate(1 hour)" }),
    ).toBe("Hourly");
    expect(
      scheduleValueLabel({
        ...draft,
        scheduleExpression: "rate(30 minutes)",
      }),
    ).toBe("Custom");
    expect(
      scheduleValueLabel({ ...draft, triggerFamily: "manual" as const }),
    ).toBe("Manual");
  });
});
