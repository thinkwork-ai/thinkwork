import { describe, expect, it } from "vitest";
import {
  normalizeWorkflowTriggerContract,
  workflowRunTriggerColumns,
} from "./trigger-contract.js";

describe("normalizeWorkflowTriggerContract", () => {
  it("normalizes manual, schedule, agent, API, and webhook trigger examples", () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    const manual = normalizeWorkflowTriggerContract({
      family: "manual",
      source: "settings.workflow.run",
      actor: { type: "user", id: userId, displayName: "Operator" },
      nonIdempotent: true,
      payload: { button: "run" },
    });
    expect(manual).toMatchObject({
      triggerFamily: "manual",
      triggerSource: "settings.workflow.run",
      actorType: "user",
      actorId: userId,
      idempotencyKey: null,
      idempotencyRequired: false,
    });

    const schedule = normalizeWorkflowTriggerContract({
      family: "schedule",
      source: "aws.scheduler",
      actor: { type: "schedule", externalId: "daily-summary" },
      idempotencyKey: "scheduler:job-1:2026-06-20T16:00:00Z",
      payload: { scheduleName: "daily-summary" },
    });
    const agent = normalizeWorkflowTriggerContract({
      family: "agent",
      source: "pi.workflow.invoke",
      actor: { type: "agent", id: "22222222-2222-4222-8222-222222222222" },
      idempotencyKey: "agent:run-1:workflow-1",
    });
    const api = normalizeWorkflowTriggerContract({
      family: "api",
      source: "public.graphql.startWorkflow",
      actor: { type: "api_key", externalId: "api-key-hash" },
      idempotencyKey: "api:idempotency-key-1",
    });
    const webhook = normalizeWorkflowTriggerContract({
      family: "webhook",
      source: "task-event",
      actor: { type: "connected_app", externalId: "twenty" },
      idempotencyKey: "webhook:delivery-1",
      correlationId: "delivery-1",
    });

    expect(schedule.idempotencyRequired).toBe(true);
    expect(agent.actorId).toBe("22222222-2222-4222-8222-222222222222");
    expect(api.actorExternalId).toBe("api-key-hash");
    expect(webhook.correlationId).toBe("delivery-1");
    expect(workflowRunTriggerColumns(schedule)).toEqual(
      expect.objectContaining({
        trigger_family: "schedule",
        trigger_source: "aws.scheduler",
        actor_type: "schedule",
        idempotency_key: "scheduler:job-1:2026-06-20T16:00:00Z",
      }),
    );
  });

  it("rejects missing actor and source identity", () => {
    expect(() =>
      normalizeWorkflowTriggerContract({
        family: "manual",
        source: " ",
        actor: { type: "user" },
      }),
    ).toThrow(/source is required/);

    expect(() =>
      normalizeWorkflowTriggerContract({
        family: "manual",
        source: "settings",
        actor: undefined as never,
      }),
    ).toThrow(/actor is required/);
  });

  it("rejects external triggers without a stable idempotency key", () => {
    expect(() =>
      normalizeWorkflowTriggerContract({
        family: "webhook",
        source: "task-event",
        actor: { type: "connected_app", externalId: "twenty" },
      }),
    ).toThrow(/webhook workflow triggers require a stable idempotency key/);

    expect(() =>
      normalizeWorkflowTriggerContract({
        family: "schedule",
        source: "aws.scheduler",
        actor: { type: "schedule", externalId: "daily" },
        nonIdempotent: true,
      }),
    ).toThrow(/only manual workflow triggers/);
  });
});
