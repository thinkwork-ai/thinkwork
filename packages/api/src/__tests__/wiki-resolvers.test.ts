/**
 * Unit tests for PR 4 — wiki resolver auth surface + lint/export handlers.
 *
 * The DB-heavy queries inside the resolvers are covered by PR 3's
 * integration verification; here we exercise the pieces that don't require
 * a live Postgres:
 *   - assertCanReadWikiScope / assertCanAdminWikiScope visibility matrix
 *   - compileWikiNow admin-path authz
 *   - wiki-export WIKI_EXPORT_BUCKET absence short-circuit
 *   - wiki-lint error-path fails gracefully (no DB)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock handles ────────────────────────────────────────────────────

const {
  mockDb,
  mockAgentsRow,
  mockAdminRows,
  mockResolveCaller,
  mockEnqueue,
  mockLambdaSend,
  mockListCompileJobs,
  InvokeCommandMock,
} = vi.hoisted(() => {
  const mockAgentsRow = vi.fn();
  const mockAdminRows = vi.fn();
  const mockResolveCaller = vi.fn();
  const mockEnqueue = vi.fn();
  const mockListCompileJobs = vi.fn();
  const mockLambdaSend = vi.fn().mockResolvedValue({});
  class InvokeCommandMock {
    public readonly input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  const chain = (rows: unknown[]) => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  });
  const mockDb = {
    select: vi.fn(() => chain(mockAgentsRow() as unknown[])),
    execute: vi
      .fn()
      .mockImplementation(() => Promise.resolve({ rows: mockAdminRows() })),
  };
  return {
    mockDb,
    mockAgentsRow,
    mockAdminRows,
    mockResolveCaller,
    mockEnqueue,
    mockLambdaSend,
    mockListCompileJobs,
    InvokeCommandMock,
  };
});

vi.mock("../graphql/utils.js", () => ({
  db: mockDb,
  eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
  agents: { id: "agents.id", tenant_id: "agents.tenant_id" },
  users: { id: "users.id", tenant_id: "users.tenant_id", email: "users.email" },
}));

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: vi.fn().mockResolvedValue(null),
  resolveCaller: mockResolveCaller,
  resolveCallerUserId: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/wiki/repository.js", async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import("../lib/wiki/repository.js");
  return {
    ...actual,
    enqueueCompileJob: mockEnqueue,
    listCompileJobsForScope: mockListCompileJobs,
  };
});

vi.mock("@thinkwork/database-pg/schema", () => ({
  agents: { id: "agents.id", tenant_id: "agents.tenant_id" },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("drizzle-orm");
  return {
    ...actual,
    eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
  };
});

vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: vi.fn().mockImplementation(() => ({ send: mockLambdaSend })),
  InvokeCommand: InvokeCommandMock,
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

import {
  assertCanReadWikiScope,
  assertCanAdminWikiScope,
  WikiAuthError,
} from "../graphql/resolvers/wiki/auth.js";
import { compileWikiNow } from "../graphql/resolvers/wiki/compileWikiNow.mutation.js";
import { wikiCompileJobs } from "../graphql/resolvers/wiki/wikiCompileJobs.query.js";
import type { GraphQLContext } from "../graphql/context.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveCaller.mockReset();
  mockResolveCaller.mockResolvedValue({ userId: "a1", tenantId: "t1" });
  mockAdminRows.mockReset();
  mockAdminRows.mockReturnValue([]);
  mockLambdaSend.mockResolvedValue({});
  delete process.env.WIKI_COMPILE_FN;
  delete process.env.STAGE;
});

function decodePayload(cmd: unknown): { jobId: string; modelId?: string } {
  const input = (cmd as { input: { Payload: Uint8Array } }).input;
  return JSON.parse(new TextDecoder().decode(input.Payload));
}

async function waitForLambdaSend(count = 1) {
  // The compileWikiNow resolver fires the Lambda invoke without await and
  // uses a dynamic import(). Poll until the mock is called before asserting.
  await vi.waitFor(() => {
    expect(mockLambdaSend).toHaveBeenCalledTimes(count);
  });
}

function makeCtx(auth: Partial<GraphQLContext["auth"]>): GraphQLContext {
  return {
    auth: {
      principalId: "user-1",
      tenantId: "t1",
      email: "a@b.c",
      authType: "cognito",
      ...auth,
    } as GraphQLContext["auth"],
  } as GraphQLContext;
}

// ─── assertCanReadWikiScope ──────────────────────────────────────────────────

describe("assertCanReadWikiScope", () => {
  it("allows when caller tenant and user match", async () => {
    mockAgentsRow.mockReturnValue([{ id: "a1", tenant_id: "t1" }]);
    await expect(
      assertCanReadWikiScope(makeCtx({}), {
        tenantId: "t1",
        userId: "a1",
      }),
    ).resolves.toEqual({ tenantId: "t1", userId: "a1" });
  });

  it("rejects when tenant context missing", async () => {
    mockAgentsRow.mockReturnValue([]);
    mockResolveCaller.mockResolvedValueOnce({ userId: "a1", tenantId: null });
    await expect(
      assertCanReadWikiScope(makeCtx({ tenantId: null }), {
        userId: "a1",
      }),
    ).rejects.toThrow(WikiAuthError);
  });

  it("rejects tenant mismatch before querying agents", async () => {
    mockResolveCaller.mockResolvedValueOnce({
      userId: "a1",
      tenantId: "t-other",
    });
    await expect(
      assertCanReadWikiScope(makeCtx({ tenantId: "t-other" }), {
        tenantId: "t1",
        userId: "a1",
      }),
    ).rejects.toThrow(/tenant mismatch/);
  });

  it("rejects caller/user mismatch", async () => {
    mockResolveCaller.mockResolvedValueOnce({ userId: "a1", tenantId: "t1" });
    await expect(
      assertCanReadWikiScope(makeCtx({}), {
        tenantId: "t1",
        userId: "a-missing",
      }),
    ).rejects.toThrow(/user mismatch/);
  });

  it("allows tenant admins to read another tenant member's wiki scope", async () => {
    mockResolveCaller.mockResolvedValueOnce({
      userId: "admin-user",
      tenantId: "t1",
    });
    mockAdminRows.mockReturnValueOnce([{ role: "admin" }]);
    await expect(
      assertCanReadWikiScope(makeCtx({}), {
        tenantId: "t1",
        userId: "a1",
      }),
    ).resolves.toEqual({ tenantId: "t1", userId: "a1" });
  });

  it("rejects missing caller user context", async () => {
    mockResolveCaller.mockResolvedValueOnce({ userId: null, tenantId: "t1" });
    await expect(
      assertCanReadWikiScope(makeCtx({}), {
        tenantId: "t1",
        userId: "a1",
      }),
    ).rejects.toThrow(/User context required/);
  });
});

// ─── assertCanAdminWikiScope ─────────────────────────────────────────────────

describe("assertCanAdminWikiScope", () => {
  it("allows api-key caller that passes read check", async () => {
    mockAgentsRow.mockReturnValue([{ id: "a1", tenant_id: "t1" }]);
    await expect(
      assertCanAdminWikiScope(makeCtx({ authType: "apikey" }), {
        tenantId: "t1",
        userId: "a1",
      }),
    ).resolves.toEqual({ tenantId: "t1", userId: "a1" });
  });

  it("rejects cognito (end-user) caller even when tenant matches", async () => {
    mockAgentsRow.mockReturnValue([{ id: "a1", tenant_id: "t1" }]);
    await expect(
      assertCanAdminWikiScope(makeCtx({ authType: "cognito" }), {
        tenantId: "t1",
        userId: "a1",
      }),
    ).rejects.toThrow(/Admin-only/);
  });
});

// ─── compileWikiNow ──────────────────────────────────────────────────────────

describe("compileWikiNow", () => {
  function makeJobRow(id: string) {
    return {
      id,
      tenant_id: "t1",
      owner_id: "a1",
      dedupe_key: "t1:a1:1",
      status: "pending",
      trigger: "admin",
      attempt: 0,
      claimed_at: null,
      started_at: null,
      finished_at: null,
      error: null,
      metrics: null,
      created_at: new Date("2026-04-18T00:00:00Z"),
    };
  }

  it("enqueues the compile job and fire-and-forget invokes wiki-compile when admin", async () => {
    process.env.WIKI_COMPILE_FN = "wiki-compile-test";
    mockAgentsRow.mockReturnValue([{ id: "a1", tenant_id: "t1" }]);
    mockEnqueue.mockResolvedValueOnce({
      inserted: true,
      job: makeJobRow("job-1"),
    });
    const out = await compileWikiNow(
      {},
      { tenantId: "t1", userId: "a1" },
      makeCtx({ authType: "apikey" }),
    );
    expect(out.id).toBe("job-1");
    expect(out.status).toBe("pending");
    expect(out.trigger).toBe("admin");
    expect(mockEnqueue).toHaveBeenCalledWith({
      tenantId: "t1",
      ownerId: "a1",
      trigger: "admin",
    });
    await waitForLambdaSend();
    const payload = decodePayload(mockLambdaSend.mock.calls[0][0]);
    expect(payload).toEqual({ jobId: "job-1" });
  });

  it("refuses a cognito (end-user) caller with admin-only error", async () => {
    mockAgentsRow.mockReturnValue([{ id: "a1", tenant_id: "t1" }]);
    await expect(
      compileWikiNow(
        {},
        { tenantId: "t1", userId: "a1" },
        makeCtx({ authType: "cognito" }),
      ),
    ).rejects.toThrow(/Admin-only/);
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });

  it("forwards modelId in the Lambda payload when supplied", async () => {
    process.env.WIKI_COMPILE_FN = "wiki-compile-test";
    mockAgentsRow.mockReturnValue([{ id: "a1", tenant_id: "t1" }]);
    mockEnqueue.mockResolvedValueOnce({
      inserted: true,
      job: makeJobRow("job-2"),
    });
    await compileWikiNow(
      {},
      {
        tenantId: "t1",
        userId: "a1",
        modelId: "anthropic.claude-sonnet-4-6-v1:0",
      },
      makeCtx({ authType: "apikey" }),
    );
    await waitForLambdaSend();
    const payload = decodePayload(mockLambdaSend.mock.calls[0][0]);
    expect(payload).toEqual({
      jobId: "job-2",
      modelId: "anthropic.claude-sonnet-4-6-v1:0",
    });
  });

  it("omits modelId from the Lambda payload when not supplied", async () => {
    process.env.WIKI_COMPILE_FN = "wiki-compile-test";
    mockAgentsRow.mockReturnValue([{ id: "a1", tenant_id: "t1" }]);
    mockEnqueue.mockResolvedValueOnce({
      inserted: true,
      job: makeJobRow("job-3"),
    });
    await compileWikiNow(
      {},
      { tenantId: "t1", userId: "a1" },
      makeCtx({ authType: "apikey" }),
    );
    await waitForLambdaSend();
    const payload = decodePayload(mockLambdaSend.mock.calls[0][0]);
    expect(payload).toEqual({ jobId: "job-3" });
  });

  it("treats empty-string modelId as not provided", async () => {
    process.env.WIKI_COMPILE_FN = "wiki-compile-test";
    mockAgentsRow.mockReturnValue([{ id: "a1", tenant_id: "t1" }]);
    mockEnqueue.mockResolvedValueOnce({
      inserted: true,
      job: makeJobRow("job-4"),
    });
    await compileWikiNow(
      {},
      { tenantId: "t1", userId: "a1", modelId: "" },
      makeCtx({ authType: "apikey" }),
    );
    await waitForLambdaSend();
    const payload = decodePayload(mockLambdaSend.mock.calls[0][0]);
    expect(payload).toEqual({ jobId: "job-4" });
  });

  it("returns the job row even when the Lambda invoke fails (fire-and-forget)", async () => {
    process.env.WIKI_COMPILE_FN = "wiki-compile-test";
    mockLambdaSend.mockRejectedValueOnce(new Error("Lambda throttled"));
    mockAgentsRow.mockReturnValue([{ id: "a1", tenant_id: "t1" }]);
    mockEnqueue.mockResolvedValueOnce({
      inserted: true,
      job: makeJobRow("job-5"),
    });
    const out = await compileWikiNow(
      {},
      { tenantId: "t1", userId: "a1" },
      makeCtx({ authType: "apikey" }),
    );
    expect(out.id).toBe("job-5");
    // The dedupe job row is the idempotency guarantee — the worker can pick
    // it up via claimNextCompileJob if the Event-invoke fails.
    await waitForLambdaSend();
    expect(mockLambdaSend).toHaveBeenCalledTimes(1);
  });

  it("skips the Lambda invoke when WIKI_COMPILE_FN and STAGE are both unset", async () => {
    mockAgentsRow.mockReturnValue([{ id: "a1", tenant_id: "t1" }]);
    mockEnqueue.mockResolvedValueOnce({
      inserted: true,
      job: makeJobRow("job-6"),
    });
    const out = await compileWikiNow(
      {},
      { tenantId: "t1", userId: "a1" },
      makeCtx({ authType: "apikey" }),
    );
    expect(out.id).toBe("job-6");
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });
});

// ─── wikiCompileJobs ─────────────────────────────────────────────────────────

describe("wikiCompileJobs", () => {
  function makeJobRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: "job-x",
      tenant_id: "t1",
      owner_id: "a1",
      dedupe_key: "t1:a1:1",
      status: "succeeded",
      trigger: "admin",
      attempt: 1,
      claimed_at: new Date("2026-04-18T00:00:00Z"),
      started_at: new Date("2026-04-18T00:00:01Z"),
      finished_at: new Date("2026-04-18T00:00:30Z"),
      error: null,
      metrics: { records_read: 5 },
      created_at: new Date("2026-04-18T00:00:00Z"),
      ...overrides,
    };
  }

  it("returns mapped job rows for agent-scoped admin caller", async () => {
    mockAgentsRow.mockReturnValue([{ id: "a1", tenant_id: "t1" }]);
    mockListCompileJobs.mockResolvedValueOnce([
      makeJobRow({ id: "job-a" }),
      makeJobRow({ id: "job-b", status: "running", finished_at: null }),
    ]);
    const out = await wikiCompileJobs(
      {},
      { tenantId: "t1", userId: "a1", limit: 5 },
      makeCtx({ authType: "apikey" }),
    );
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe("job-a");
    expect(out[0].status).toBe("succeeded");
    expect(out[0].finishedAt).toBe("2026-04-18T00:00:30.000Z");
    expect(out[1].id).toBe("job-b");
    expect(out[1].finishedAt).toBeNull();
    expect(mockListCompileJobs).toHaveBeenCalledWith({
      tenantId: "t1",
      ownerId: "a1",
      limit: 5,
    });
  });

  it("returns tenant-wide jobs when userId is absent (api-key caller)", async () => {
    mockListCompileJobs.mockResolvedValueOnce([makeJobRow({ owner_id: "a1" })]);
    const out = await wikiCompileJobs(
      {},
      { tenantId: "t1" },
      makeCtx({ authType: "apikey" }),
    );
    expect(out).toHaveLength(1);
    // Agent-scoped auth path should NOT have been taken — tenant-wide path
    // skips the agents-table check.
    expect(mockAgentsRow).not.toHaveBeenCalled();
    expect(mockListCompileJobs).toHaveBeenCalledWith({
      tenantId: "t1",
      ownerId: null,
      limit: 10,
    });
  });

  it("returns empty array when repository yields no rows", async () => {
    mockAgentsRow.mockReturnValue([{ id: "a1", tenant_id: "t1" }]);
    mockListCompileJobs.mockResolvedValueOnce([]);
    const out = await wikiCompileJobs(
      {},
      { tenantId: "t1", userId: "a1" },
      makeCtx({ authType: "apikey" }),
    );
    expect(out).toEqual([]);
  });

  it("rejects cognito (end-user) caller for agent-scoped query", async () => {
    mockAgentsRow.mockReturnValue([{ id: "a1", tenant_id: "t1" }]);
    await expect(
      wikiCompileJobs(
        {},
        { tenantId: "t1", userId: "a1" },
        makeCtx({ authType: "cognito" }),
      ),
    ).rejects.toThrow(/Admin-only/);
    expect(mockListCompileJobs).not.toHaveBeenCalled();
  });

  it("rejects cognito caller for tenant-wide query", async () => {
    await expect(
      wikiCompileJobs({}, { tenantId: "t1" }, makeCtx({ authType: "cognito" })),
    ).rejects.toThrow(/Admin-only/);
    expect(mockListCompileJobs).not.toHaveBeenCalled();
  });

  it("rejects tenant mismatch for tenant-wide query", async () => {
    await expect(
      wikiCompileJobs(
        {},
        { tenantId: "t1" },
        makeCtx({ authType: "apikey", tenantId: "t-other" }),
      ),
    ).rejects.toThrow(/tenant mismatch/);
    expect(mockListCompileJobs).not.toHaveBeenCalled();
  });
});
