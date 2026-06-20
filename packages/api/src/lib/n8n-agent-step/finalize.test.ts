import { describe, expect, it, vi } from "vitest";
import { finalizeN8nAgentStepRun } from "./finalize.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const THREAD_ID = "22222222-2222-4222-8222-222222222222";
const TURN_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "44444444-4444-4444-8444-444444444444";

const BASE_RUN = {
  id: RUN_ID,
  tenant_id: TENANT_ID,
  thread_id: THREAD_ID,
  thread_turn_id: TURN_ID,
  status: "waiting",
  resume_status: "not_ready",
  correlation_id: "lead-123",
  created_at: new Date("2026-06-20T12:00:00.000Z"),
};

describe("finalizeN8nAgentStepRun", () => {
  it("holds bridge runs while ThinkWork is waiting on human input", async () => {
    const db = queuedDb({
      selectRows: [
        [BASE_RUN],
        [{ status: "in_progress", last_response_preview: null }],
        [{ id: "question-1" }],
        [],
        [{ status: "succeeded", error: null, result: { response: "Done" } }],
      ],
      updateRows: [[{ id: RUN_ID, status: "awaiting_human" }]],
    });

    const result = await finalizeN8nAgentStepRun(
      {
        tenantId: TENANT_ID,
        threadId: THREAD_ID,
        threadTurnId: TURN_ID,
        resolution: "turn_completed",
        summary: "Done",
      },
      fixedDeps(db),
    );

    expect(result).toEqual({
      action: "awaiting_human",
      runId: RUN_ID,
      status: "awaiting_human",
    });
    expect(db.updateSets[0]).toMatchObject({
      status: "awaiting_human",
      resume_status: "not_ready",
      summary: "ThinkWork is waiting for human input.",
    });
  });

  it("moves an answered human hold back to waiting for the resumed agent turn", async () => {
    const db = queuedDb({
      selectRows: [
        [{ ...BASE_RUN, status: "awaiting_human" }],
        [{ status: "in_progress", last_response_preview: null }],
        [],
        [],
      ],
      updateRows: [[{ id: RUN_ID, status: "waiting" }]],
    });

    const result = await finalizeN8nAgentStepRun(
      {
        tenantId: TENANT_ID,
        threadId: THREAD_ID,
        resolution: "human_input_resolved",
      },
      fixedDeps(db),
    );

    expect(result.action).toBe("waiting");
    expect(db.updateSets[0]).toMatchObject({
      status: "waiting",
      resume_status: "not_ready",
      summary: "Human input resolved; waiting for the resumed agent turn.",
    });
  });

  it("records a successful turn as resume_pending with structured output", async () => {
    const db = queuedDb({
      selectRows: [
        [BASE_RUN],
        [{ status: "in_progress", last_response_preview: "Classified" }],
        [],
        [],
        [
          {
            status: "succeeded",
            error: null,
            result: { response: "Lead classified as enterprise." },
          },
        ],
      ],
      updateRows: [[{ id: RUN_ID, status: "resume_pending" }]],
    });

    const result = await finalizeN8nAgentStepRun(
      {
        tenantId: TENANT_ID,
        threadId: THREAD_ID,
        threadTurnId: TURN_ID,
        resolution: "turn_completed",
      },
      fixedDeps(db),
    );

    expect(result.action).toBe("resume_pending");
    expect(db.updateSets[0]).toMatchObject({
      status: "resume_pending",
      resume_status: "pending",
      output_payload: { response: "Lead classified as enterprise." },
      result_payload: expect.objectContaining({
        status: "succeeded",
        runId: RUN_ID,
        threadId: THREAD_ID,
        correlationId: "lead-123",
        output: { response: "Lead classified as enterprise." },
        error: null,
        links: {
          thread: `https://app.example.test/threads/${THREAD_ID}`,
          trace: `https://app.example.test/threads/${THREAD_ID}?turn=${TURN_ID}`,
        },
      }),
    });
  });

  it("keeps a completed asking turn waiting when a question-answer wakeup is queued", async () => {
    const db = queuedDb({
      selectRows: [
        [BASE_RUN],
        [{ status: "in_progress", last_response_preview: "Thanks" }],
        [],
        [{ id: "wakeup-1" }],
        [{ status: "succeeded", error: null, result: { response: "Thanks" } }],
      ],
      updateRows: [[{ id: RUN_ID, status: "waiting" }]],
    });

    const result = await finalizeN8nAgentStepRun(
      {
        tenantId: TENANT_ID,
        threadId: THREAD_ID,
        threadTurnId: TURN_ID,
        resolution: "turn_completed",
      },
      fixedDeps(db),
    );

    expect(result.action).toBe("waiting");
    expect(db.updateSets[0]).toMatchObject({
      status: "waiting",
      resume_status: "not_ready",
      summary: "Human input resolved; waiting for the resumed agent turn.",
    });
  });

  it("records failed turns as resume_pending failure payloads", async () => {
    const db = queuedDb({
      selectRows: [
        [BASE_RUN],
        [{ status: "in_progress", last_response_preview: null }],
        [],
        [],
        [{ status: "failed", error: "model unavailable", result: null }],
      ],
      updateRows: [[{ id: RUN_ID, status: "resume_pending" }]],
    });

    const result = await finalizeN8nAgentStepRun(
      {
        tenantId: TENANT_ID,
        threadId: THREAD_ID,
        threadTurnId: TURN_ID,
        resolution: "turn_failed",
      },
      fixedDeps(db),
    );

    expect(result.action).toBe("resume_pending");
    expect(db.updateSets[0]).toMatchObject({
      status: "resume_pending",
      resume_status: "pending",
      output_payload: null,
      error_payload: { message: "model unavailable" },
      result_payload: expect.objectContaining({
        status: "failed",
        error: { message: "model unavailable" },
      }),
    });
  });

  it("does not rewrite runs already awaiting resume delivery", async () => {
    const db = queuedDb({
      selectRows: [[{ ...BASE_RUN, status: "resume_pending" }]],
    });

    const result = await finalizeN8nAgentStepRun(
      {
        tenantId: TENANT_ID,
        threadId: THREAD_ID,
        threadTurnId: TURN_ID,
        resolution: "turn_completed",
      },
      fixedDeps(db),
    );

    expect(result).toEqual({
      action: "noop",
      runId: RUN_ID,
      status: "resume_pending",
    });
    expect(db.updateSets).toHaveLength(0);
  });
});

function fixedDeps(db: ReturnType<typeof queuedDb>) {
  return {
    db: db as never,
    now: () => new Date("2026-06-20T12:00:00.000Z"),
    appUrl: "https://app.example.test",
  };
}

function queuedDb(input: {
  selectRows?: unknown[][];
  updateRows?: unknown[][];
}) {
  const selectRows = [...(input.selectRows ?? [])];
  const updateRows = [...(input.updateRows ?? [])];
  const updateSets: Record<string, unknown>[] = [];
  return {
    updateSets,
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          const query = {
            orderBy: vi.fn(() => ({
              limit: vi.fn(async () => selectRows.shift() ?? []),
            })),
            limit: vi.fn(async () => selectRows.shift() ?? []),
          };
          return query;
        }),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updateSets.push(values);
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => updateRows.shift() ?? []),
          })),
        };
      }),
    })),
  };
}
