import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  existingSession: null as Record<string, any> | null,
  createdSession: {
    id: "session-1",
    user_id: "user-1",
    tenant_id: "tenant-1",
    mode: "full",
    focus_layer: null,
    current_layer: "rhythms",
    layer_states: {},
    status: "in_progress",
    last_agent_message: "Ready.",
    created_at: new Date("2026-05-02T12:00:00Z"),
    updated_at: new Date("2026-05-02T12:00:00Z"),
    last_active_at: new Date("2026-05-02T12:00:00Z"),
    completed_at: null,
  } as Record<string, any>,
  insertValues: null as Record<string, any> | null,
  startSystemWorkflow: vi.fn(),
  invokeActivationRuntime: vi.fn(),
}));

vi.mock("../graphql/utils.js", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((...args: unknown[]) => args),
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () =>
            mocks.existingSession ? [mocks.existingSession] : [],
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, any>) => {
        mocks.insertValues = values;
        return {
          returning: async () => [mocks.createdSession],
        };
      },
    }),
  },
}));

vi.mock("../graphql/resolvers/activation/shared.js", () => ({
  activationSessions: {},
  activationSessionToGraphql: (row: Record<string, any>) => ({
    id: row.id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    mode: row.mode,
    focusLayer: row.focus_layer,
    currentLayer: row.current_layer,
    status: row.status,
  }),
  assertUserAccess: vi.fn(async (_ctx, userId: string) => ({
    userId,
    tenantId: "tenant-1",
  })),
  fallbackAgentMessage: vi.fn(() => "Fallback message."),
  invokeActivationRuntime: mocks.invokeActivationRuntime,
}));

vi.mock("../lib/system-workflows/start.js", () => ({
  startSystemWorkflow: mocks.startSystemWorkflow,
}));

import { startActivation } from "../graphql/resolvers/activation/startActivation.mutation.js";

const ctx = {
  auth: {
    principalId: "principal-1",
    authType: "cognito",
  },
} as any;

describe("startActivation System Workflow launch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.existingSession = null;
    mocks.insertValues = null;
    mocks.invokeActivationRuntime.mockResolvedValue({ message: "Runtime." });
    mocks.startSystemWorkflow.mockResolvedValue({
      started: true,
      deduped: false,
      run: { id: "sw-run-1" },
    });
  });

  it("starts tenant-agent-activation for newly created sessions", async () => {
    const result = await startActivation(
      null,
      { input: { userId: "user-1", mode: "full" } },
      ctx,
    );

    expect(result).toMatchObject({
      id: "session-1",
      userId: "user-1",
      tenantId: "tenant-1",
    });
    expect(mocks.startSystemWorkflow).toHaveBeenCalledWith({
      workflowId: "tenant-agent-activation",
      tenantId: "tenant-1",
      triggerSource: "graphql",
      actorId: "principal-1",
      actorType: "cognito",
      domainRef: { type: "activation_session", id: "session-1" },
      input: {
        activationSessionId: "session-1",
        userId: "user-1",
        mode: "full",
        focusLayer: null,
        currentLayer: "rhythms",
      },
    });
  });

  it("attaches existing in-progress sessions to the same workflow domain ref", async () => {
    mocks.existingSession = {
      ...mocks.createdSession,
      id: "existing-session",
      current_layer: "knowledge",
    };

    const result = await startActivation(
      null,
      { input: { userId: "user-1", mode: "full" } },
      ctx,
    );

    expect(result.id).toBe("existing-session");
    expect(mocks.invokeActivationRuntime).not.toHaveBeenCalled();
    expect(mocks.startSystemWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: "tenant-agent-activation",
        domainRef: {
          type: "activation_session",
          id: "existing-session",
        },
      }),
    );
  });

  it("falls back only when the System Workflow substrate is unconfigured", async () => {
    mocks.startSystemWorkflow.mockRejectedValueOnce(
      new Error(
        "System Workflow tenant-agent-activation has no configured state machine ARN",
      ),
    );

    await expect(
      startActivation(null, { input: { userId: "user-1" } }, ctx),
    ).resolves.toMatchObject({ id: "session-1" });
  });

  it("preserves refresh focusLayer validation", async () => {
    await expect(
      startActivation(
        null,
        { input: { userId: "user-1", mode: "refresh" } },
        ctx,
      ),
    ).rejects.toThrow("focusLayer is required for refresh activation");
  });
});
