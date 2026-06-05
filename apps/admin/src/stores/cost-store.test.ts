import { afterEach, describe, expect, it } from "vitest";
import { useCostStore } from "./cost-store";

const initialState = useCostStore.getState();

afterEach(() => {
  useCostStore.setState({
    summary: null,
    byUser: [],
    byModel: [],
    timeSeries: [],
    budgets: [],
    loaded: false,
  });
});

describe("cost store user chargeback", () => {
  it("hydrates user cost rows without agent chargeback state", () => {
    initialState.setByUser([
      {
        userId: "user-1",
        userName: "Ada Lovelace",
        userEmail: "ada@example.com",
        totalUsd: 42,
        eventCount: 12,
        isSystem: false,
      },
      {
        userId: null,
        userName: "System / unattributed",
        userEmail: null,
        totalUsd: 7,
        eventCount: 3,
        isSystem: true,
      },
    ]);

    expect(useCostStore.getState().byUser).toEqual([
      expect.objectContaining({
        userId: "user-1",
        userName: "Ada Lovelace",
        userEmail: "ada@example.com",
        totalUsd: 42,
      }),
      expect.objectContaining({
        userId: null,
        userName: "System / unattributed",
        userEmail: null,
        isSystem: true,
      }),
    ]);
    expect("byAgent" in useCostStore.getState()).toBe(false);
  });

  it("increments tenant and matching user budgets but leaves other users alone", () => {
    initialState.setSummary({
      totalUsd: 10,
      llmUsd: 10,
      computeUsd: 0,
      toolsUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      eventCount: 1,
    });
    initialState.setByUser([
      {
        userId: "user-1",
        userName: "Ada Lovelace",
        userEmail: "ada@example.com",
        totalUsd: 10,
        eventCount: 1,
        isSystem: false,
      },
    ]);
    initialState.setBudgets([
      {
        policy: {
          id: "tenant-budget",
          agentId: null,
          userId: null,
          scope: "tenant",
          limitUsd: 100,
          actionOnExceed: "pause",
        },
        spentUsd: 10,
        remainingUsd: 90,
        percentUsed: 10,
        status: "normal",
      },
      {
        policy: {
          id: "user-budget",
          agentId: null,
          userId: "user-1",
          scope: "user",
          limitUsd: 20,
          actionOnExceed: "pause",
        },
        spentUsd: 10,
        remainingUsd: 10,
        percentUsed: 50,
        status: "normal",
      },
      {
        policy: {
          id: "other-user-budget",
          agentId: null,
          userId: "user-2",
          scope: "user",
          limitUsd: 20,
          actionOnExceed: "pause",
        },
        spentUsd: 5,
        remainingUsd: 15,
        percentUsed: 25,
        status: "normal",
      },
    ]);

    initialState.applyEvent({
      tenantId: "tenant-1",
      agentId: "agent-1",
      agentName: "ThinkWork",
      userId: "user-1",
      userName: "Ada Lovelace",
      userEmail: "ada@example.com",
      eventType: "llm",
      amountUsd: 5,
      model: "model-1",
      updatedAt: "2026-06-05T00:00:00.000Z",
    });

    expect(useCostStore.getState().byUser).toEqual([
      expect.objectContaining({
        userId: "user-1",
        totalUsd: 15,
        eventCount: 2,
      }),
    ]);
    expect(useCostStore.getState().budgets).toEqual([
      expect.objectContaining({ spentUsd: 15, remainingUsd: 85 }),
      expect.objectContaining({ spentUsd: 15, remainingUsd: 5 }),
      expect.objectContaining({ spentUsd: 5, remainingUsd: 15 }),
    ]);
  });
});
