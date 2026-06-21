import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Array<Record<string, unknown>>>,
  whereCalls: [] as unknown[],
  requireAdminOrServiceCaller: vi.fn(),
  resolveCaller: vi.fn(),
}));

function queryChain() {
  const rows = () => Promise.resolve(mocks.rows.shift() ?? []);
  const chain = {
    from: () => chain,
    leftJoin: () => chain,
    where: (value: unknown) => {
      mocks.whereCalls.push(value);
      return chain;
    },
    groupBy: () => chain,
    orderBy: () => rows(),
    limit: () => rows(),
    then: (
      resolve: (value: Array<Record<string, unknown>>) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => rows().then(resolve, reject),
  };
  return chain;
}

vi.mock("../../utils.js", () => ({
  db: {
    select: () => queryChain(),
  },
  costEvents: {
    tenant_id: "cost_events.tenant_id",
    user_id: "cost_events.user_id",
    created_at: "cost_events.created_at",
    event_type: "cost_events.event_type",
    amount_usd: "cost_events.amount_usd",
    model: "cost_events.model",
    input_tokens: "cost_events.input_tokens",
    output_tokens: "cost_events.output_tokens",
  },
  users: {
    id: "users.id",
    tenant_id: "users.tenant_id",
  },
  modelCatalog: {
    model_id: "model_catalog.model_id",
    display_name: "model_catalog.display_name",
  },
  tenantModelCatalog: {
    tenant_id: "tenant_model_catalog.tenant_id",
    model_id: "tenant_model_catalog.model_id",
    display_name: "tenant_model_catalog.display_name",
  },
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (...args: unknown[]) => ({ _eq: args }),
  gte: (...args: unknown[]) => ({ _gte: args }),
  lte: (...args: unknown[]) => ({ _lte: args }),
  sql: (...args: unknown[]) => ({ _sql: args }),
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mocks.requireAdminOrServiceCaller,
}));
vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCaller: mocks.resolveCaller,
}));

// eslint-disable-next-line import/first
import { accountUsage } from "./accountUsage.query.js";

beforeEach(() => {
  mocks.rows = [];
  mocks.whereCalls = [];
  mocks.requireAdminOrServiceCaller.mockReset();
  mocks.resolveCaller.mockReset();
  mocks.requireAdminOrServiceCaller.mockResolvedValue(undefined);
  mocks.resolveCaller.mockResolvedValue({
    userId: "user-1",
    tenantId: "tenant-1",
  });
});

function cognitoCtx(): any {
  return { auth: { authType: "cognito" } };
}

function serviceCtx(): any {
  return { auth: { authType: "service" } };
}

describe("accountUsage", () => {
  it("returns self usage summary, sparse days, and LLM model rows scoped to one tenant user", async () => {
    mocks.rows = [
      [{ id: "user-1" }],
      [
        {
          totalUsd: 10.5,
          llmUsd: 8,
          computeUsd: 1.5,
          toolsUsd: 1,
          inputTokens: 1200,
          outputTokens: 500,
          eventCount: 4,
        },
      ],
      [
        {
          day: "2026-06-19",
          totalUsd: 4.5,
          llmUsd: 3.5,
          computeUsd: 1,
          toolsUsd: 0,
          inputTokens: 700,
          outputTokens: 200,
          eventCount: 2,
        },
        {
          day: "2026-06-20",
          totalUsd: 6,
          llmUsd: 4.5,
          computeUsd: 0.5,
          toolsUsd: 1,
          inputTokens: 500,
          outputTokens: 300,
          eventCount: 2,
        },
      ],
      [
        {
          model: "anthropic.claude-sonnet-4",
          tenantDisplayName: "Team Sonnet",
          catalogDisplayName: "Claude Sonnet 4",
          totalUsd: 6,
          inputTokens: 700,
          outputTokens: 300,
        },
        {
          model: "openai.gpt-5.4",
          tenantDisplayName: null,
          catalogDisplayName: "GPT-5.4",
          totalUsd: 2,
          inputTokens: 500,
          outputTokens: 200,
        },
      ],
    ];

    await expect(
      accountUsage(
        null,
        { tenantId: "tenant-1", userId: "user-1", days: 90 },
        cognitoCtx(),
      ),
    ).resolves.toMatchObject({
      summary: {
        totalUsd: 10.5,
        llmUsd: 8,
        computeUsd: 1.5,
        toolsUsd: 1,
        inputTokens: 1200,
        outputTokens: 500,
        eventCount: 4,
      },
      daily: [
        {
          day: "2026-06-19",
          totalUsd: 4.5,
          inputTokens: 700,
          outputTokens: 200,
          eventCount: 2,
        },
        {
          day: "2026-06-20",
          totalUsd: 6,
          inputTokens: 500,
          outputTokens: 300,
          eventCount: 2,
        },
      ],
      models: [
        {
          model: "anthropic.claude-sonnet-4",
          displayName: "Team Sonnet",
          totalUsd: 6,
          inputTokens: 700,
          outputTokens: 300,
          usageShare: 0.75,
        },
        {
          model: "openai.gpt-5.4",
          displayName: "GPT-5.4",
          totalUsd: 2,
          inputTokens: 500,
          outputTokens: 200,
          usageShare: 0.25,
        },
      ],
    });

    expect(mocks.requireAdminOrServiceCaller).not.toHaveBeenCalled();
    expect(mocks.whereCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _and: expect.arrayContaining([
            { _eq: ["users.id", "user-1"] },
            { _eq: ["users.tenant_id", "tenant-1"] },
          ]),
        }),
      ]),
    );
  });

  it("requires the admin/service gate before another user's cost rows are read", async () => {
    mocks.resolveCaller.mockResolvedValue({
      userId: "user-1",
      tenantId: "tenant-1",
    });
    mocks.rows = [[{ id: "user-2" }], [], [], []];

    await expect(
      accountUsage(
        null,
        { tenantId: "tenant-1", userId: "user-2", days: 90 },
        cognitoCtx(),
      ),
    ).resolves.toMatchObject({
      summary: { totalUsd: 0, eventCount: 0 },
      daily: [],
      models: [],
    });

    expect(mocks.requireAdminOrServiceCaller).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
      "account_usage:read",
    );
  });

  it("rejects another user's usage when the admin gate rejects without reading cost rows", async () => {
    mocks.resolveCaller.mockResolvedValue({
      userId: "user-1",
      tenantId: "tenant-1",
    });
    mocks.requireAdminOrServiceCaller.mockRejectedValue(
      Object.assign(new Error("Tenant admin role required"), {
        extensions: { code: "FORBIDDEN" },
      }),
    );

    await expect(
      accountUsage(
        null,
        { tenantId: "tenant-1", userId: "user-2", days: 90 },
        cognitoCtx(),
      ),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });

    expect(mocks.rows).toEqual([]);
  });

  it("rejects the caller's own user id when the requested tenant does not contain that user", async () => {
    mocks.rows = [[]];

    await expect(
      accountUsage(
        null,
        { tenantId: "tenant-2", userId: "user-1", days: 90 },
        cognitoCtx(),
      ),
    ).rejects.toThrow("User not found in tenant");

    expect(mocks.requireAdminOrServiceCaller).not.toHaveBeenCalled();
  });

  it("allows service callers through the admin/service gate", async () => {
    mocks.rows = [[{ id: "user-1" }], [], [], []];

    await expect(
      accountUsage(
        null,
        { tenantId: "tenant-1", userId: "user-1", days: 90 },
        serviceCtx(),
      ),
    ).resolves.toMatchObject({
      summary: { totalUsd: 0, eventCount: 0 },
      daily: [],
      models: [],
    });

    expect(mocks.requireAdminOrServiceCaller).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
      "account_usage:read",
    );
  });

  it("bounds days to a maximum of 365 while still returning the requested user's usage", async () => {
    mocks.rows = [[{ id: "user-1" }], [], [], []];

    const result = await accountUsage(
      null,
      { tenantId: "tenant-1", userId: "user-1", days: 999 },
      cognitoCtx(),
    );

    const periodStart = new Date(result.periodStart).getTime();
    const periodEnd = new Date(result.periodEnd).getTime();
    expect(periodEnd - periodStart).toBeLessThanOrEqual(
      365 * 24 * 60 * 60 * 1000,
    );
  });
});
