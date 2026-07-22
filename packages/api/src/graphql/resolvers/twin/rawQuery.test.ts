import { beforeEach, describe, expect, it, vi } from "vitest";

const executeTwinQuery = vi.fn(
  async (_args: unknown): Promise<unknown> => ({
    ok: true,
    results: [{ count: 1 }],
    redactedCount: 0,
    unfenced: true,
    truncated: false,
  }),
);
const requireAdminOrServiceCaller = vi.fn(async () => {});
const emitAuditEvent = vi.fn(async (_input: unknown) => ({
  eventId: "e",
  outboxId: "o",
}));

vi.mock("../knowledge-graph/search-auth.js", () => ({
  resolveKnowledgeGraphSearchScope: vi.fn(async () => ({
    tenantId: "tenant-1",
  })),
}));
vi.mock("../../../lib/twin/client.js", () => ({
  executeTwinQuery: (args: unknown) => executeTwinQuery(args),
}));
vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: (...args: unknown[]) =>
    requireAdminOrServiceCaller(...(args as [])),
}));
vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: vi.fn(async () => "user-1"),
}));
vi.mock("../../utils.js", () => ({ db: { mock: true } }));
vi.mock("../../../lib/compliance/emit.js", () => ({
  emitAuditEvent: (_db: unknown, input: unknown) => emitAuditEvent(input),
}));

import { twinRawQuery } from "./index.js";

const ctx = {} as never;

describe("twinRawQuery resolver", () => {
  beforeEach(() => {
    executeTwinQuery.mockClear();
    requireAdminOrServiceCaller.mockClear();
    emitAuditEvent.mockClear();
  });

  it("forwards the raw kind with the caller-scoped tenant and returns the envelope", async () => {
    const result = await twinRawQuery(
      undefined,
      { query: "MATCH (n) RETURN count(n)" },
      ctx,
    );
    expect(requireAdminOrServiceCaller).toHaveBeenCalledWith(
      ctx,
      "tenant-1",
      "twin_raw_query",
    );
    expect(executeTwinQuery).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      request: { kind: "raw", query: "MATCH (n) RETURN count(n)" },
    });
    expect(result).toMatchObject({ ok: true, unfenced: true });
  });

  it("denies non-operator callers before executing anything", async () => {
    requireAdminOrServiceCaller.mockRejectedValueOnce(new Error("forbidden"));
    await expect(
      twinRawQuery(undefined, { query: "MATCH (n) RETURN n" }, ctx),
    ).rejects.toThrow("forbidden");
    expect(executeTwinQuery).not.toHaveBeenCalled();
    expect(emitAuditEvent).not.toHaveBeenCalled();
  });

  it("writes a data.query_executed audit event per invocation", async () => {
    await twinRawQuery(undefined, { query: "MATCH (n) RETURN n" }, ctx);
    expect(emitAuditEvent).toHaveBeenCalledTimes(1);
    expect(emitAuditEvent.mock.calls[0]![0]).toMatchObject({
      tenantId: "tenant-1",
      actorId: "user-1",
      eventType: "data.query_executed",
      action: "twin_raw_query",
      outcome: "success",
      payload: expect.objectContaining({
        sql: "MATCH (n) RETURN n",
        data_source: "neptune_twin",
        rows_returned: 1,
      }),
    });
  });

  it("audits rejections too, with the rejected outcome", async () => {
    executeTwinQuery.mockResolvedValueOnce({
      ok: false,
      reason: "invalid_request",
      detail: "write/procedure clause not allowed: DELETE",
    });
    await twinRawQuery(undefined, { query: "MATCH (n) DELETE n" }, ctx);
    expect(emitAuditEvent.mock.calls[0]![0]).toMatchObject({
      outcome: "rejected",
      payload: expect.objectContaining({
        error: "write/procedure clause not allowed: DELETE",
      }),
    });
  });
});
