import { describe, expect, it } from "vitest";
import { normalizeTargetSpec } from "./contracts";
import { resolveDispatchableVersion } from "./run-ledger";

/**
 * THINK-137 U8 (R8): the webhook→Automation fold migration
 * (0212_fold_webhooks_into_automations.sql) writes agent_loop_versions rows in
 * pure SQL. These tests pin the exact JSON shapes that SQL emits and prove they
 * round-trip through the SAME dispatch resolver the inbound webhook handler uses
 * (resolveDispatchableVersion), so a migrated token dispatches identically to a
 * UI-created Automation. If the migration's emitted spec drifts from what the
 * resolver accepts, these fail.
 */

const WORKER_ID = "11111111-1111-4111-8111-111111111111";
const ROUTINE_ID = "22222222-2222-4222-8222-222222222222";

// The agent-target version row exactly as the migration DO-block builds it.
function agentTargetVersionRow() {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    version_status: "active",
    trigger_spec: { family: "webhook", enabled: true, config: {} },
    goal_spec: {
      objective: "Handle the incoming webhook payload and complete the work.",
      completionCriteria: [],
    },
    worker_spec: {
      type: "agent",
      id: WORKER_ID,
      toolHints: [],
      config: {},
    },
    loop_policy: {
      maxIterations: 1,
      failBehavior: "return_blocker",
      escalateOnFailure: false,
    },
    routine_actions_spec: null,
    target_spec: {
      kind: "agent_thread",
      agentThread: {
        instructions:
          "Handle the incoming webhook payload and complete the work.",
        workerId: WORKER_ID,
        workerType: "agent",
        threadMode: "new_per_run",
      },
    },
  };
}

// The routine-target version row exactly as the migration DO-block builds it.
function routineTargetVersionRow() {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    version_status: "active",
    trigger_spec: { family: "webhook", enabled: true, config: {} },
    goal_spec: { objective: "Webhook routine", completionCriteria: [] },
    worker_spec: {
      type: "agent",
      id: WORKER_ID,
      toolHints: [],
      config: {},
    },
    loop_policy: {
      maxIterations: 1,
      failBehavior: "return_blocker",
      escalateOnFailure: false,
    },
    routine_actions_spec: null,
    target_spec: {
      kind: "routine",
      routine: { routineId: ROUTINE_ID },
    },
  };
}

describe("webhook→Automation fold migration spec shape", () => {
  it("agent target_spec normalizes to an agent_thread with the webhook's agent", () => {
    const spec = normalizeTargetSpec(agentTargetVersionRow().target_spec);
    expect(spec.kind).toBe("agent_thread");
    expect(spec.agentThread?.workerId).toBe(WORKER_ID);
    expect(spec.agentThread?.workerType).toBe("agent");
    expect(spec.agentThread?.threadMode).toBe("new_per_run");
  });

  it("routine target_spec normalizes to a routine with the webhook's routine", () => {
    const spec = normalizeTargetSpec(routineTargetVersionRow().target_spec);
    expect(spec.kind).toBe("routine");
    expect(spec.routine?.routineId).toBe(ROUTINE_ID);
  });

  it("agent row resolves to an agent_thread dispatch (worker preserved)", () => {
    const resolved = resolveDispatchableVersion(agentTargetVersionRow());
    expect(resolved.targetKind).toBe("agent_thread");
    expect(resolved.workerSpec.id).toBe(WORKER_ID);
    // agent_thread → no token-free routine actions.
    expect(resolved.routineActionsSpec).toBeNull();
  });

  it("routine row resolves to a routine dispatch (single token-free action)", () => {
    const resolved = resolveDispatchableVersion(routineTargetVersionRow());
    expect(resolved.targetKind).toBe("routine");
    expect(resolved.routineActionsSpec?.agentTurn).toBe(false);
    expect(resolved.routineActionsSpec?.actions).toHaveLength(1);
    expect(resolved.routineActionsSpec?.actions[0]?.routineId).toBe(ROUTINE_ID);
  });
});
