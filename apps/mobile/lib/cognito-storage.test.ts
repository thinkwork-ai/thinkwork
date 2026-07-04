import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSetItemAsync } = vi.hoisted(() => ({
  mockSetItemAsync: vi.fn(),
}));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK: "AFTER_FIRST_UNLOCK",
  setItemAsync: mockSetItemAsync,
  getItemAsync: vi.fn(async () => null),
  deleteItemAsync: vi.fn(async () => undefined),
}));

vi.mock("./platform-config", () => ({
  getPlatformConfig: () => ({ cognitoClientId: "client-1" }),
}));

describe("CognitoSecureStorage", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSetItemAsync.mockReset().mockResolvedValue(undefined);
  });

  it("writes Cognito token keys with AFTER_FIRST_UNLOCK accessibility", async () => {
    const { CognitoSecureStorage } = await import("./cognito-storage");

    CognitoSecureStorage.setItem(
      "CognitoIdentityServiceProvider.client-1.user-1.idToken",
      "id-token",
    );

    expect(mockSetItemAsync).toHaveBeenCalledWith(
      "CognitoIdentityServiceProvider.client-1.user-1.idToken",
      "id-token",
      { keychainAccessible: "AFTER_FIRST_UNLOCK" },
    );
  });
});
