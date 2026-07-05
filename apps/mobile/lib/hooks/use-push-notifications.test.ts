import { describe, expect, it, vi } from "vitest";

vi.mock("expo-notifications", () => ({
  setNotificationHandler: vi.fn(),
  DEFAULT_ACTION_IDENTIFIER: "default",
}));

vi.mock("expo-device", () => ({ default: {}, isDevice: false }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("urql", () => ({ useMutation: vi.fn(() => [null, vi.fn()]) }));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ user: { tenantId: "tenant-1" } }),
}));
vi.mock("@/lib/graphql-queries", () => ({
  RegisterPushTokenMutation: {},
  UnregisterPushTokenMutation: {},
}));
vi.mock("@/lib/notification-actions", () => ({
  handleComputerApprovalActionResponse: vi.fn(),
  isComputerApprovalAction: vi.fn(() => false),
  registerComputerApprovalActions: vi.fn(async () => undefined),
}));

import { resolvePresentationForTier } from "./use-push-notifications";

describe("resolvePresentationForTier", () => {
  it("makes chart-tier pushes badge-only and silent", () => {
    expect(resolvePresentationForTier("chart")).toEqual({
      shouldShowAlert: false,
      shouldPlaySound: false,
      shouldSetBadge: true,
    });
  });

  it("keeps code, page, and legacy pushes visible with sound", () => {
    const visible = {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    };
    expect(resolvePresentationForTier("code")).toEqual(visible);
    expect(resolvePresentationForTier("page")).toEqual(visible);
    expect(resolvePresentationForTier(undefined)).toEqual(visible);
  });
});
