import { beforeEach, describe, expect, it, vi } from "vitest";
import { resumeN8nAgentStepRun, sweepN8nAgentStepRuns } from "./resume.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const THREAD_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-06-20T12:00:00.000Z");
const SECRET_REF =
  "thinkwork/dev/n8n-agent-step-runs/acme/idempotency/resume-url";
const RESUME_URL = "https://n8n.example.test/webhook-waiting/resume/abc";

const BASE_RUN = {
  id: RUN_ID,
  tenant_id: TENANT_ID,
  thread_id: THREAD_ID,
  thread_turn_id: "44444444-4444-4444-8444-444444444444",
  status: "resume_pending",
  resume_status: "pending",
  correlation_id: "lead-123",
  resume_url_secret_ref: SECRET_REF,
  resume_attempt_count: 1,
  next_resume_attempt_at: null,
  last_resume_http_status: null,
  last_resume_error: null,
  result_payload: {
    status: "succeeded",
    runId: RUN_ID,
    threadId: THREAD_ID,
    correlationId: "lead-123",
    output: { recommendation: "Call today" },
    error: null,
    summary: "Lead is ready.",
    links: { thread: `https://app.example.test/threads/${THREAD_ID}` },
  },
  output_payload: { recommendation: "Call today" },
  error_payload: null,
  summary: "Lead is ready.",
  links: { thread: `https://app.example.test/threads/${THREAD_ID}` },
  expires_at: new Date("2026-06-20T13:00:00.000Z"),
  created_at: new Date("2026-06-20T11:00:00.000Z"),
  updated_at: new Date("2026-06-20T11:00:00.000Z"),
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("resumeN8nAgentStepRun", () => {
  it("claims and posts a pending bridge run to the stored n8n resume URL", async () => {
    const db = queuedDb({
      updateRows: [[BASE_RUN], []],
    });
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));

    const result = await resumeN8nAgentStepRun(
      { tenantId: TENANT_ID, runId: RUN_ID },
      fixedDeps(db, { fetch: fetchMock }),
    );

    expect(result).toEqual({
      runId: RUN_ID,
      action: "resumed",
      httpStatus: 204,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      RESUME_URL,
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: expect.any(AbortSignal),
      }),
    );
    const fetchCalls = fetchMock.mock.calls as unknown as Array<
      [string, RequestInit]
    >;
    expect(JSON.parse(String(fetchCalls[0]?.[1]?.body))).toMatchObject({
      status: "succeeded",
      runId: RUN_ID,
      output: { recommendation: "Call today" },
    });
    expect(db.updateSets[0]).toMatchObject({
      status: "resuming",
      resume_status: "resuming",
      last_resume_attempt_at: NOW,
    });
    expect(db.updateSets[1]).toMatchObject({
      status: "resumed",
      resume_status: "resumed",
      last_resume_http_status: 204,
      terminal_at: NOW,
    });
  });

  it("schedules retry metadata for retryable n8n failures", async () => {
    const db = queuedDb({
      updateRows: [[{ ...BASE_RUN, resume_attempt_count: 2 }], []],
    });
    const fetchMock = vi.fn(
      async () => new Response("gateway unavailable", { status: 503 }),
    );

    const result = await resumeN8nAgentStepRun(
      { tenantId: TENANT_ID, runId: RUN_ID },
      fixedDeps(db, { fetch: fetchMock }),
    );

    expect(result).toMatchObject({
      runId: RUN_ID,
      action: "retry_scheduled",
      httpStatus: 503,
      error: expect.stringContaining("gateway unavailable"),
    });
    expect(db.updateSets[1]).toMatchObject({
      status: "resume_pending",
      resume_status: "pending",
      last_resume_http_status: 503,
      last_resume_error: expect.stringContaining("gateway unavailable"),
    });
    expect(db.updateSets[1]?.next_resume_attempt_at).toEqual(
      new Date("2026-06-20T12:04:00.000Z"),
    );
  });

  it("marks non-retryable n8n HTTP failures as terminal resume failures", async () => {
    const db = queuedDb({
      updateRows: [[BASE_RUN], []],
    });
    const fetchMock = vi.fn(
      async () => new Response("wait node gone", { status: 410 }),
    );

    const result = await resumeN8nAgentStepRun(
      { tenantId: TENANT_ID, runId: RUN_ID },
      fixedDeps(db, { fetch: fetchMock }),
    );

    expect(result).toMatchObject({
      runId: RUN_ID,
      action: "resume_failed",
      httpStatus: 410,
      error: expect.stringContaining("wait node gone"),
    });
    expect(db.updateSets[1]).toMatchObject({
      status: "resume_failed",
      resume_status: "failed",
      last_resume_http_status: 410,
      terminal_at: NOW,
    });
  });

  it("fails loudly when the stored resume URL secret is missing", async () => {
    const db = queuedDb({
      updateRows: [[{ ...BASE_RUN, resume_url_secret_ref: "missing" }], []],
    });
    const fetchMock = vi.fn();

    const result = await resumeN8nAgentStepRun(
      { tenantId: TENANT_ID, runId: RUN_ID },
      fixedDeps(db, {
        fetch: fetchMock as never,
        secrets: { getSecret: vi.fn(async () => null) },
      }),
    );

    expect(result).toMatchObject({
      runId: RUN_ID,
      action: "resume_failed",
      httpStatus: null,
      error: "Bridge run resume URL secret was not found",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.updateSets[1]).toMatchObject({
      status: "resume_failed",
      resume_status: "failed",
      terminal_at: NOW,
    });
  });

  it("fails loudly when the stored resume URL secret is malformed", async () => {
    const db = queuedDb({
      updateRows: [[BASE_RUN], []],
    });
    const fetchMock = vi.fn();

    const result = await resumeN8nAgentStepRun(
      { tenantId: TENANT_ID, runId: RUN_ID },
      fixedDeps(db, {
        fetch: fetchMock as never,
        secrets: { getSecret: vi.fn(async () => "not-json") },
      }),
    );

    expect(result).toMatchObject({
      runId: RUN_ID,
      action: "resume_failed",
      httpStatus: null,
      error: "Bridge run resume URL secret is malformed",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.updateSets[1]).toMatchObject({
      status: "resume_failed",
      resume_status: "failed",
      terminal_at: NOW,
    });
  });

  it("does not post when another worker already claimed the run", async () => {
    const db = queuedDb({ updateRows: [[]] });
    const fetchMock = vi.fn();

    const result = await resumeN8nAgentStepRun(
      { tenantId: TENANT_ID, runId: RUN_ID },
      fixedDeps(db, { fetch: fetchMock as never }),
    );

    expect(result).toEqual({ runId: RUN_ID, action: "not_ready" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sweepN8nAgentStepRuns", () => {
  it("queues expired active runs and posts an expired payload once claimed", async () => {
    const expiredRun = {
      ...BASE_RUN,
      status: "waiting",
      resume_status: "not_ready",
      result_payload: null,
      output_payload: null,
      expires_at: new Date("2026-06-20T11:59:00.000Z"),
    };
    const queuedExpiredRun = {
      ...expiredRun,
      status: "resume_pending",
      resume_status: "pending",
      result_payload: {
        status: "expired",
        runId: RUN_ID,
        threadId: THREAD_ID,
        correlationId: "lead-123",
        output: null,
        error: {
          message: "ThinkWork agent step expired before completion.",
        },
        summary: "ThinkWork agent step expired before completion.",
        links: expiredRun.links,
      },
    };
    const db = queuedDb({
      selectRows: [[expiredRun], [queuedExpiredRun]],
      updateRows: [[{ id: RUN_ID }], [queuedExpiredRun], []],
    });
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));

    const result = await sweepN8nAgentStepRuns(
      { limit: 10 },
      fixedDeps(db, { fetch: fetchMock }),
    );

    expect(result).toEqual({
      resumeAttempted: 1,
      resumed: 1,
      retryScheduled: 0,
      resumeFailed: 0,
      expiredQueued: 1,
    });
    expect(db.updateSets[0]).toMatchObject({
      status: "resume_pending",
      resume_status: "pending",
      result_payload: expect.objectContaining({ status: "expired" }),
      next_resume_attempt_at: NOW,
    });
    const fetchCalls = fetchMock.mock.calls as unknown as Array<
      [string, RequestInit]
    >;
    expect(JSON.parse(String(fetchCalls[0]?.[1]?.body))).toMatchObject({
      status: "expired",
      runId: RUN_ID,
      error: { message: "ThinkWork agent step expired before completion." },
    });
  });
});

function fixedDeps(
  db: ReturnType<typeof queuedDb>,
  overrides: {
    fetch?: typeof fetch;
    secrets?: { getSecret: (ref: string) => Promise<string | null> };
  } = {},
) {
  return {
    db: db as never,
    now: () => NOW,
    callbackTimeoutMs: 50,
    secrets: (overrides.secrets ?? {
      getSecret: vi.fn(async () => JSON.stringify({ resumeUrl: RESUME_URL })),
    }) as never,
    fetch: overrides.fetch,
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
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(async () => selectRows.shift() ?? []),
          })),
          limit: vi.fn(async () => selectRows.shift() ?? []),
        })),
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
