import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insertedValues: undefined as Record<string, unknown> | undefined,
  returning: vi.fn(),
}));

vi.mock("node:crypto", () => ({
  randomBytes: () => ({ toString: () => "webhook-token" }),
}));

vi.mock("../../utils.js", () => ({
  db: {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        mocks.insertedValues = values;
        return { returning: () => mocks.returning() };
      },
    }),
  },
  eq: vi.fn(),
  spaces: {},
  webhooks: {},
  snakeToCamel: vi.fn((row: unknown) => row),
}));

import { createWebhook } from "./createWebhook.mutation.js";

beforeEach(() => {
  mocks.insertedValues = undefined;
  mocks.returning.mockReset();
});

describe("createWebhook", () => {
  it("stores targetType lowercase", async () => {
    mocks.returning.mockResolvedValue([{ id: "wh-1", target_type: "agent" }]);

    await createWebhook(
      null,
      {
        input: {
          tenantId: "tenant-1",
          name: "Twenty Opportunity Closed Won",
          targetType: "AGENT",
          agentId: "agent-1",
        },
      },
      {} as any,
    );

    expect(mocks.insertedValues).toMatchObject({
      target_type: "agent",
      agent_id: "agent-1",
    });
  });
});
