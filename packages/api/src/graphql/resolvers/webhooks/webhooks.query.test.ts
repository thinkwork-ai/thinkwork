import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  rows: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => mocks.rows(),
          }),
        }),
      }),
    }),
  },
  webhooks: {
    tenant_id: "webhooks.tenant_id",
    target_type: "webhooks.target_type",
    space_id: "webhooks.space_id",
    enabled: "webhooks.enabled",
    created_at: "webhooks.created_at",
  },
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  desc: vi.fn((column: unknown) => ({ op: "desc", column })),
  eq: mocks.eq,
  snakeToCamel: vi.fn((row: unknown) => row),
}));

import { webhooks_ } from "./webhooks.query.js";

beforeEach(() => {
  mocks.eq.mockClear();
  mocks.rows.mockResolvedValue([]);
});

describe("webhooks query", () => {
  it("filters by Space when spaceId is provided", async () => {
    await webhooks_(
      null,
      { tenantId: "tenant-1", spaceId: "space-1", limit: 10 },
      {} as any,
    );

    expect(mocks.eq).toHaveBeenCalledWith("webhooks.tenant_id", "tenant-1");
    expect(mocks.eq).toHaveBeenCalledWith("webhooks.space_id", "space-1");
  });
});
