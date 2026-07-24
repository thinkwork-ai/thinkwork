import { beforeEach, describe, expect, it, vi } from "vitest";

const bulkRebuildTenantGraph = vi.fn();
const projectPendingIdentityEvents = vi.fn();

vi.mock("../lib/entity-identity/bulk-rebuild.js", () => ({
  bulkRebuildTenantGraph: (...args: unknown[]) =>
    bulkRebuildTenantGraph(...args),
}));
vi.mock("../lib/entity-identity/graph-projection.js", () => ({
  projectPendingIdentityEvents: (...args: unknown[]) =>
    projectPendingIdentityEvents(...args),
}));

import { handler } from "./identity-graph-projector.js";

const parse = (response: { statusCode: number; body: string }) => ({
  statusCode: response.statusCode,
  body: JSON.parse(response.body) as Record<string, unknown>,
});

beforeEach(() => {
  bulkRebuildTenantGraph.mockReset();
  projectPendingIdentityEvents.mockReset();
});

describe("identity-graph-projector handler", () => {
  it("400s without a tenantId", async () => {
    const { statusCode, body } = parse(await handler({}));
    expect(statusCode).toBe(400);
    expect(body.error).toContain("tenantId");
  });

  it('mode "rebuild" is retired: 400 with a pointer to bulk-rebuild', async () => {
    const { statusCode, body } = parse(
      await handler({ tenantId: "tenant-1", mode: "rebuild" } as never),
    );
    expect(statusCode).toBe(400);
    expect(body.error).toContain("bulk-rebuild");
    expect(bulkRebuildTenantGraph).not.toHaveBeenCalled();
    expect(projectPendingIdentityEvents).not.toHaveBeenCalled();
  });

  it("unknown modes 400", async () => {
    const { statusCode } = parse(
      await handler({ tenantId: "tenant-1", mode: "resync" } as never),
    );
    expect(statusCode).toBe(400);
  });

  it("bulk-rebuild dispatches to the orchestrator with clear/loadId and the Lambda deadline", async () => {
    bulkRebuildTenantGraph.mockResolvedValue({
      ok: true,
      status: "completed",
      tenantId: "tenant-1",
      loadId: "load-1",
      counts: { canonicals: 2 },
      cursor: "c#1",
    });
    const { statusCode, body } = parse(
      await handler(
        {
          tenantId: "tenant-1",
          mode: "bulk-rebuild",
          clear: true,
          loadId: "load-1",
        },
        { getRemainingTimeInMillis: () => 123_456 },
      ),
    );
    expect(statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      status: "completed",
      loadId: "load-1",
    });
    const call = bulkRebuildTenantGraph.mock.calls[0][0] as {
      tenantId: string;
      clear: boolean;
      loadId?: string;
      getRemainingTimeMs?: () => number;
    };
    expect(call).toMatchObject({
      tenantId: "tenant-1",
      clear: true,
      loadId: "load-1",
    });
    expect(call.getRemainingTimeMs!()).toBe(123_456);
  });

  it("bulk-rebuild in_progress rides a 200 (resume is a normal outcome)", async () => {
    bulkRebuildTenantGraph.mockResolvedValue({
      ok: false,
      status: "in_progress",
      tenantId: "tenant-1",
      loadId: "load-1",
    });
    const { statusCode, body } = parse(
      await handler({ tenantId: "tenant-1", mode: "bulk-rebuild" }),
    );
    expect(statusCode).toBe(200);
    expect(body).toMatchObject({ status: "in_progress", loadId: "load-1" });
  });

  it("bulk-rebuild failed maps to 500 and surfaces the error (R7)", async () => {
    bulkRebuildTenantGraph.mockResolvedValue({
      ok: false,
      status: "failed",
      tenantId: "tenant-1",
      error: "loader job load-1 ended LOAD_FAILED",
    });
    const { statusCode, body } = parse(
      await handler({ tenantId: "tenant-1", mode: "bulk-rebuild" }),
    );
    expect(statusCode).toBe(500);
    expect(body.error).toContain("LOAD_FAILED");
  });

  it("default (nudge) path drains in-process and reports totals — unchanged", async () => {
    projectPendingIdentityEvents
      .mockResolvedValueOnce({
        drained: false,
        processedEvents: 200,
        resyncedCanonicals: 40,
      })
      .mockResolvedValueOnce({
        drained: true,
        processedEvents: 3,
        resyncedCanonicals: 2,
      });
    const { statusCode, body } = parse(await handler({ tenantId: "tenant-1" }));
    expect(statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      passes: 2,
      processedEvents: 203,
      resyncedCanonicals: 42,
    });
    expect(bulkRebuildTenantGraph).not.toHaveBeenCalled();
  });
});
