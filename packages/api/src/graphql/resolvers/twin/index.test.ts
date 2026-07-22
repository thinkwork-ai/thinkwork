import { beforeEach, describe, expect, it, vi } from "vitest";

const executeTwinQuery = vi.fn(async () => ({ ok: true }));

vi.mock("../knowledge-graph/search-auth.js", () => ({
  resolveKnowledgeGraphSearchScope: vi.fn(async () => ({
    tenantId: "tenant-1",
  })),
}));
vi.mock("../../../lib/twin/client.js", () => ({
  executeTwinQuery: (...args: unknown[]) => executeTwinQuery(...args),
}));

import { twinCohort } from "./index.js";

const ctx = {} as never;

describe("twinCohort resolver — filter passthrough", () => {
  beforeEach(() => {
    executeTwinQuery.mockClear();
  });

  it("passes nameContains from the filter JSON through to the typed request", async () => {
    await twinCohort(
      undefined,
      {
        entityType: "customer",
        filter: JSON.stringify({
          nameContains: "formosa",
          predicates: [
            { facet: "aging", attribute: "daysPastDue", op: "gt", value: 90 },
          ],
        }),
      },
      ctx,
    );
    expect(executeTwinQuery).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      request: {
        kind: "cohort",
        entityType: "customer",
        predicates: [
          { facet: "aging", attribute: "daysPastDue", op: "gt", value: 90 },
        ],
        nameContains: "formosa",
        path: undefined,
        limit: undefined,
      },
    });
  });

  it("drops a non-string nameContains instead of forwarding it", async () => {
    await twinCohort(
      undefined,
      {
        entityType: "customer",
        filter: JSON.stringify({ nameContains: 42, predicates: [] }),
      },
      ctx,
    );
    const request = executeTwinQuery.mock.calls[0]?.[0] as {
      request: { nameContains?: string };
    };
    expect(request.request.nameContains).toBeUndefined();
  });
});
