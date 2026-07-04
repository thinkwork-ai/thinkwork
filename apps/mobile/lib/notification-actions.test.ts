import { beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "graphql";

const { mockGetIdToken, mockGetPlatformConfig, mockScheduleNotification } =
  vi.hoisted(() => ({
    mockGetIdToken: vi.fn(),
    mockGetPlatformConfig: vi.fn(),
    mockScheduleNotification: vi.fn(),
  }));

vi.mock("expo-notifications", () => ({
  scheduleNotificationAsync: mockScheduleNotification,
  setNotificationCategoryAsync: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getIdToken: mockGetIdToken,
}));

vi.mock("@/lib/platform-config", () => ({
  getPlatformConfig: mockGetPlatformConfig,
}));

vi.mock("@/lib/graphql-queries", () => ({
  ApproveComputerApprovalMutation: parse(`
    mutation ApproveComputerApproval($id: ID!, $input: ApproveInboxItemInput) {
      approveInboxItem(id: $id, input: $input) {
        id
      }
    }
  `),
  RejectComputerApprovalMutation: parse(`
    mutation RejectComputerApproval($id: ID!, $input: RejectInboxItemInput) {
      rejectInboxItem(id: $id, input: $input) {
        id
      }
    }
  `),
}));

import {
  APPROVE_NOTIFICATION_ACTION,
  handleComputerApprovalActionResponse,
  resetHandledNotificationActionsForTests,
} from "./notification-actions";

function response(requestId: string, actionIdentifier = APPROVE_NOTIFICATION_ACTION) {
  return {
    actionIdentifier,
    notification: {
      request: {
        identifier: requestId,
        content: {
          data: { approvalId: "approval-1" },
        },
      },
    },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetHandledNotificationActionsForTests();
  mockGetIdToken.mockResolvedValue("id-token");
  mockGetPlatformConfig.mockReturnValue({ graphqlUrl: "https://api.test/graphql" });
});

describe("handleComputerApprovalActionResponse", () => {
  it("calls approve exactly once for a duplicate action response", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { approveInboxItem: { id: "approval-1" } } }),
    })) as any;
    const routeToApproval = vi.fn();
    const actionResponse = response("notification-1");

    await handleComputerApprovalActionResponse(actionResponse, {
      fetchImpl,
      routeToApproval,
    });
    await handleComputerApprovalActionResponse(actionResponse, {
      fetchImpl,
      routeToApproval,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(routeToApproval).not.toHaveBeenCalled();
  });

  it("routes to the approval screen when token refresh fails", async () => {
    mockGetIdToken.mockResolvedValue(null);
    const fetchImpl = vi.fn();
    const routeToApproval = vi.fn();

    await handleComputerApprovalActionResponse(response("notification-1"), {
      fetchImpl: fetchImpl as any,
      routeToApproval,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(routeToApproval).toHaveBeenCalledWith("approval-1");
  });

  it("shows a local confirmation when the approval was already resolved", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        errors: [
          { message: "Invalid inbox item transition: approved -> rejected" },
        ],
      }),
    })) as any;

    await expect(
      handleComputerApprovalActionResponse(response("notification-1"), {
        fetchImpl,
        routeToApproval: vi.fn(),
      }),
    ).resolves.toBeUndefined();

    expect(mockScheduleNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          title: "Approval already resolved",
        }),
      }),
    );
  });
});
