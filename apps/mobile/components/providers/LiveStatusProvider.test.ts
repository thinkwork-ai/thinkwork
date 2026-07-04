import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
  Platform: { OS: "ios" },
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    user: { tenantId: "tenant-1" },
    getToken: vi.fn(async () => "token"),
  }),
}));

vi.mock("@/hooks/useAppSyncSubscription", () => ({
  useAppSyncSubscription: vi.fn(() => ({ data: null, error: null })),
}));

import {
  LIVE_STATUS_SUBSCRIPTION_QUERIES,
  shouldRefetchForEntity,
} from "./LiveStatusProvider";

describe("LiveStatusProvider helpers", () => {
  it("defines exactly one query for each root live-status subscription", () => {
    expect(Object.keys(LIVE_STATUS_SUBSCRIPTION_QUERIES).sort()).toEqual([
      "agentStatusChanged",
      "heartbeatActivity",
      "inboxItemStatusChanged",
      "threadTurnUpdated",
      "threadUpdated",
    ]);
    expect(
      Object.values(LIVE_STATUS_SUBSCRIPTION_QUERIES).filter((query) =>
        query.includes("subscription "),
      ),
    ).toHaveLength(5);
  });

  it("refetches known entities and unknown entities represented by an empty cache", () => {
    expect(shouldRefetchForEntity(new Set(["thread-1"]), "thread-1")).toBe(
      true,
    );
    expect(shouldRefetchForEntity(new Set(["thread-1"]), "thread-2")).toBe(
      false,
    );
    expect(shouldRefetchForEntity(new Set(), "thread-2")).toBe(true);
  });

  it("ignores events with no entity reference", () => {
    expect(shouldRefetchForEntity(new Set(["thread-1"]), null)).toBe(false);
  });
});
