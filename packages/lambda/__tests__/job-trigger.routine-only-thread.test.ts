/**
 * Routine-only Automations must not create an execution thread (plan
 * 2026-07-03-004 U5): they complete their token-free routine actions with
 * no agent turn, so a created thread would hang at "Working…" forever.
 * isRoutineOnlyVersion gates thread creation in both the scheduled
 * (job-trigger) and manual (triggerAgentLoopRun) paths.
 */

import { describe, expect, it } from "vitest";
import { isRoutineOnlyVersion } from "../job-trigger.js";

const ROUTINE_ID = "33333333-3333-4333-8333-333333333333";

describe("isRoutineOnlyVersion", () => {
  it("is true when routine actions run with no agent turn", () => {
    expect(
      isRoutineOnlyVersion({
        actions: [{ routineId: ROUTINE_ID }],
        agentTurn: false,
      }),
    ).toBe(true);
  });

  it("accepts the AWSJSON string form", () => {
    expect(
      isRoutineOnlyVersion(
        JSON.stringify({
          actions: [{ routineId: ROUTINE_ID }],
          agentTurn: false,
        }),
      ),
    ).toBe(true);
  });

  it("is false for a mixed Automation (agent turn runs)", () => {
    expect(
      isRoutineOnlyVersion({
        actions: [{ routineId: ROUTINE_ID }],
        agentTurn: true,
      }),
    ).toBe(false);
  });

  it("is false when there are no routine actions", () => {
    expect(isRoutineOnlyVersion({ actions: [], agentTurn: false })).toBe(false);
    expect(isRoutineOnlyVersion(null)).toBe(false);
    expect(isRoutineOnlyVersion(undefined)).toBe(false);
  });
});
