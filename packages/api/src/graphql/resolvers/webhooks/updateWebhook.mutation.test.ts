import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updatedValues: undefined as Record<string, unknown> | undefined,
  webhookSelect: vi.fn(),
  returning: vi.fn(),
  resolveCallerFromAuth: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => mocks.webhookSelect(),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        mocks.updatedValues = values;
        return {
          where: () => ({
            returning: () => mocks.returning(),
          }),
        };
      },
    }),
  },
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  spaces: {},
  webhooks: {
    id: "webhooks.id",
    tenant_id: "webhooks.tenant_id",
    created_by_id: "webhooks.created_by_id",
  },
  snakeToCamel: vi.fn((row: unknown) => row),
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerFromAuth: mocks.resolveCallerFromAuth,
}));

import { updateWebhook } from "./updateWebhook.mutation.js";

beforeEach(() => {
  mocks.updatedValues = undefined;
  mocks.webhookSelect.mockReset();
  mocks.returning.mockReset();
  mocks.resolveCallerFromAuth.mockReset();
  mocks.webhookSelect.mockResolvedValue([
    { tenant_id: "tenant-1", created_by_id: "user-existing" },
  ]);
  mocks.resolveCallerFromAuth.mockResolvedValue({
    tenantId: "tenant-1",
    userId: "user-1",
  });
});

describe("updateWebhook", () => {
  it("stores targetType lowercase", async () => {
    mocks.returning.mockResolvedValue([{ id: "wh-1", target_type: "routine" }]);

    await updateWebhook(
      null,
      { id: "wh-1", input: { targetType: "ROUTINE" } },
      {} as any,
    );

    expect(mocks.updatedValues).toMatchObject({
      target_type: "routine",
    });
  });

  it("backfills createdById when an existing webhook is missing an owner", async () => {
    mocks.webhookSelect.mockResolvedValue([
      { tenant_id: "tenant-1", created_by_id: null },
    ]);
    mocks.returning.mockResolvedValue([{ id: "wh-1", target_type: "agent" }]);

    await updateWebhook(
      null,
      { id: "wh-1", input: { name: "Twenty Customer Stage" } },
      { auth: {} } as any,
    );

    expect(mocks.updatedValues).toMatchObject({
      name: "Twenty Customer Stage",
      created_by_type: "user",
      created_by_id: "user-1",
    });
  });
});
