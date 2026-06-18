import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updatedValues: undefined as Record<string, unknown> | undefined,
  returning: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
  db: {
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
  },
  snakeToCamel: vi.fn((row: unknown) => row),
}));

import { updateWebhook } from "./updateWebhook.mutation.js";

beforeEach(() => {
  mocks.updatedValues = undefined;
  mocks.returning.mockReset();
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
});
