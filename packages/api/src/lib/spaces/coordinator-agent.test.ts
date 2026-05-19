import { describe, expect, it } from "vitest";

import {
  type CoordinatorAgentRepository,
  type CoordinatorAssignment,
  createCoordinatorAgentService,
} from "./coordinator-agent.js";

const assignment: CoordinatorAssignment = {
  assignmentId: "assignment-1",
  tenantId: "tenant-1",
  spaceId: "space-1",
  agentId: "agent-coordinator",
  agentName: "Coordinator",
  agentSlug: "coordinator",
  localRole: "coordinator",
  localInstructions: "Track owners and blockers for onboarding.",
  allowedCapabilities: ["thread_management"],
  allowedTools: ["thread-management"],
  spaceName: "Customer Onboarding",
  spacePrompt: "Keep onboarding moving without surprising the customer.",
};

describe("createCoordinatorAgentService", () => {
  it("resolves the active Space coordinator assignment", async () => {
    const repository = makeRepository({ assignment });
    const service = createCoordinatorAgentService({ repository });

    await expect(
      service.resolveAssignment({ tenantId: "tenant-1", spaceId: "space-1" }),
    ).resolves.toEqual(assignment);
  });

  it("enqueues a kickoff wakeup with Space-local instructions", async () => {
    const repository = makeRepository({ assignment });
    const service = createCoordinatorAgentService({ repository });

    const result = await service.enqueueWakeup({
      tenantId: "tenant-1",
      spaceId: "space-1",
      threadId: "thread-1",
      reason: "kickoff_triage",
      requestedBy: { type: "system" },
    });

    expect(result).toMatchObject({
      ok: true,
      enqueued: true,
      wakeupRequestId: "wakeup-1",
      agentId: "agent-coordinator",
      assignmentId: "assignment-1",
    });
    expect(repository.wakeups[0]).toMatchObject({
      tenantId: "tenant-1",
      agentId: "agent-coordinator",
      source: "automation",
      reason: "Customer onboarding kickoff triage",
      triggerDetail: "space:space-1:thread:thread-1",
      idempotencyKey: "space-coordinator:tenant-1:thread-1:kickoff_triage",
      requestedByActorType: "system",
    });
    expect(repository.wakeups[0]?.payload).toMatchObject({
      threadId: "thread-1",
      spaceId: "space-1",
      coordinatorAssignmentId: "assignment-1",
      wakeupReason: "kickoff_triage",
      spaceContext: {
        spacePrompt: "Keep onboarding moving without surprising the customer.",
        localInstructions: "Track owners and blockers for onboarding.",
      },
    });
    expect(String(repository.wakeups[0]?.payload.message)).toContain(
      "Review the kickoff context",
    );
  });

  it("does not duplicate a wakeup for the same reason and Thread", async () => {
    const repository = makeRepository({
      assignment,
      existingWakeupId: "existing-wakeup",
    });
    const service = createCoordinatorAgentService({ repository });

    await expect(
      service.enqueueWakeup({
        tenantId: "tenant-1",
        spaceId: "space-1",
        threadId: "thread-1",
        reason: "completion_summary",
      }),
    ).resolves.toMatchObject({
      ok: true,
      enqueued: false,
      reason: "already_enqueued",
      wakeupRequestId: "existing-wakeup",
    });
    expect(repository.wakeups).toEqual([]);
  });

  it("fails closed when no coordinator assignment exists", async () => {
    const repository = makeRepository({ assignment: null });
    const service = createCoordinatorAgentService({ repository });

    await expect(
      service.enqueueWakeup({
        tenantId: "tenant-1",
        spaceId: "space-1",
        threadId: "thread-1",
        reason: "kickoff_triage",
      }),
    ).resolves.toEqual({
      ok: true,
      enqueued: false,
      reason: "coordinator_assignment_not_found",
    });
    expect(repository.wakeups).toEqual([]);
  });
});

function makeRepository(options: {
  assignment: CoordinatorAssignment | null;
  existingWakeupId?: string;
}) {
  const repository = {
    wakeups: [] as Parameters<CoordinatorAgentRepository["createWakeup"]>[0][],
    async findCoordinatorAssignment(input) {
      if (
        options.assignment?.tenantId === input.tenantId &&
        options.assignment.spaceId === input.spaceId
      ) {
        return options.assignment;
      }
      return null;
    },
    async findExistingWakeup() {
      return options.existingWakeupId ? { id: options.existingWakeupId } : null;
    },
    async createWakeup(input) {
      repository.wakeups.push(input);
      return { id: "wakeup-1" };
    },
  } satisfies CoordinatorAgentRepository & {
    wakeups: Parameters<CoordinatorAgentRepository["createWakeup"]>[0][];
  };
  return repository;
}
