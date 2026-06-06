import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertUserModelApproved,
  ensureDefaultModelApprovalsForUser,
  listApprovedModelCatalog,
  listUserModelCatalog,
  setUserModelApproval,
} from "./model-approvals.js";

const modelRows = [
  {
    id: "catalog-1",
    model_id: "us.anthropic.claude-haiku-4-5",
    provider: "bedrock",
    display_name: "Claude Haiku 4.5",
    input_cost_per_million: "1.0000",
    output_cost_per_million: "5.0000",
    context_window: 200000,
    max_output_tokens: 8192,
    supports_vision: true,
    supports_tools: true,
    is_available: true,
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
  },
  {
    id: "catalog-2",
    model_id: "us.anthropic.claude-sonnet-4-6",
    provider: "bedrock",
    display_name: "Claude Sonnet 4.6",
    input_cost_per_million: "3.0000",
    output_cost_per_million: "15.0000",
    context_window: 200000,
    max_output_tokens: 8192,
    supports_vision: true,
    supports_tools: true,
    is_available: true,
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
  },
];

function createMockDb(selectResults: unknown[][]) {
  const inserts: unknown[] = [];
  const deletes: unknown[] = [];

  const db = {
    select: vi.fn(() => {
      const chain: any = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(async () => selectResults.shift() ?? []),
        orderBy: vi.fn(async () => selectResults.shift() ?? []),
        then: (resolve: (value: unknown[]) => void) =>
          resolve(selectResults.shift() ?? []),
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: vi.fn((values: unknown) => {
        inserts.push(values);
        return {
          onConflictDoNothing: vi.fn(async () => []),
          onConflictDoUpdate: vi.fn(async () => []),
          then: (resolve: (value: unknown[]) => void) => resolve([]),
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async (where: unknown) => {
        deletes.push(where);
        return [];
      }),
    })),
  };

  return { db: db as any, inserts, deletes };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("model approvals", () => {
  it("lists all available models with per-user approval state", async () => {
    const { db } = createMockDb([
      [{ id: "user-1" }],
      modelRows,
      [{ modelId: "us.anthropic.claude-sonnet-4-6" }],
    ]);

    const result = await listUserModelCatalog(
      { tenantId: "tenant-1", userId: "user-1" },
      { db },
    );

    expect(result).toEqual([
      expect.objectContaining({
        modelId: "us.anthropic.claude-haiku-4-5",
        approved: false,
      }),
      expect.objectContaining({
        modelId: "us.anthropic.claude-sonnet-4-6",
        approved: true,
      }),
    ]);
  });

  it("returns only approved models for the caller composer", async () => {
    const { db } = createMockDb([
      [{ id: "user-1" }],
      [{ modelId: "us.anthropic.claude-haiku-4-5" }],
      [modelRows[0]],
    ]);

    const result = await listApprovedModelCatalog(
      { tenantId: "tenant-1", userId: "user-1" },
      { db },
    );

    expect(result).toEqual([
      expect.objectContaining({ modelId: "us.anthropic.claude-haiku-4-5" }),
    ]);
  });

  it("upserts or deletes the approval row when toggled", async () => {
    const approvalDb = createMockDb([
      [{ id: "user-1" }],
      [{ modelId: "us.anthropic.claude-haiku-4-5" }],
    ]);

    await setUserModelApproval(
      {
        tenantId: "tenant-1",
        userId: "user-1",
        modelId: "us.anthropic.claude-haiku-4-5",
        approved: true,
      },
      { db: approvalDb.db },
    );

    expect(approvalDb.inserts).toEqual([
      expect.objectContaining({
        tenant_id: "tenant-1",
        user_id: "user-1",
        model_id: "us.anthropic.claude-haiku-4-5",
      }),
    ]);

    const removalDb = createMockDb([
      [{ id: "user-1" }],
      [{ modelId: "us.anthropic.claude-haiku-4-5" }],
    ]);

    await setUserModelApproval(
      {
        tenantId: "tenant-1",
        userId: "user-1",
        modelId: "us.anthropic.claude-haiku-4-5",
        approved: false,
      },
      { db: removalDb.db },
    );

    expect(removalDb.deletes).toHaveLength(1);
  });

  it("fails closed when a selected model is not approved", async () => {
    const { db } = createMockDb([
      [{ modelId: "us.anthropic.claude-haiku-4-5" }],
      [],
    ]);

    await expect(
      assertUserModelApproved(
        {
          tenantId: "tenant-1",
          userId: "user-1",
          modelId: "us.anthropic.claude-haiku-4-5",
        },
        { db },
      ),
    ).rejects.toMatchObject({
      code: "MODEL_NOT_APPROVED",
    });
  });

  it("seeds available tenant defaults for new bootstrap users", async () => {
    const { db, inserts } = createMockDb([
      [{ id: "user-1" }],
      [{ modelId: "tenant-default" }],
      [{ modelId: "agent-default" }, { modelId: null }],
      [{ modelId: "template-default" }],
      [{ modelId: "agent-default" }, { modelId: "template-default" }],
    ]);

    const approved = await ensureDefaultModelApprovalsForUser(
      { tenantId: "tenant-1", userId: "user-1" },
      { db },
    );

    expect(approved).toEqual(["agent-default", "template-default"]);
    expect(inserts).toEqual([
      [
        expect.objectContaining({
          tenant_id: "tenant-1",
          user_id: "user-1",
          model_id: "agent-default",
        }),
        expect.objectContaining({
          tenant_id: "tenant-1",
          user_id: "user-1",
          model_id: "template-default",
        }),
      ],
    ]);
  });
});
