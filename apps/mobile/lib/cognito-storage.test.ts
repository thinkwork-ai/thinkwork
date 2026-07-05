import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSetItemAsync, mockDeleteItemAsync } = vi.hoisted(() => ({
  mockSetItemAsync: vi.fn(),
  mockDeleteItemAsync: vi.fn(),
}));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK: "AFTER_FIRST_UNLOCK",
  setItemAsync: mockSetItemAsync,
  getItemAsync: vi.fn(async () => null),
  deleteItemAsync: mockDeleteItemAsync,
}));

vi.mock("./platform-config", () => ({
  getPlatformConfig: () => ({ cognitoClientId: "client-1" }),
}));

describe("CognitoSecureStorage", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSetItemAsync.mockReset().mockResolvedValue(undefined);
    mockDeleteItemAsync.mockReset().mockResolvedValue(undefined);
    vi.useRealTimers();
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

  it("encodes SecureStore-illegal characters in keys (email usernames)", async () => {
    const { CognitoSecureStorage, secureStoreKeyFor } = await import(
      "./cognito-storage"
    );

    const rawKey =
      "CognitoIdentityServiceProvider.client-1.user@example.com.idToken";
    CognitoSecureStorage.setItem(rawKey, "id-token");

    const [persistedKey] = mockSetItemAsync.mock.calls[0];
    expect(persistedKey).toBe(secureStoreKeyFor(rawKey));
    expect(persistedKey).not.toBe(rawKey);
    expect(persistedKey).toMatch(/^[A-Za-z0-9._-]+$/);
    // Raw key stays visible to the Cognito SDK via the memory cache.
    expect(CognitoSecureStorage.getItem(rawKey)).toBe("id-token");

    CognitoSecureStorage.removeItem(rawKey);
    expect(mockDeleteItemAsync).toHaveBeenCalledWith(
      secureStoreKeyFor(rawKey),
    );
  });

  it("leaves SecureStore-safe keys unchanged for existing sessions", async () => {
    const { secureStoreKeyFor } = await import("./cognito-storage");
    const safeKey = "CognitoIdentityServiceProvider.client-1.user-1.idToken";
    expect(secureStoreKeyFor(safeKey)).toBe(safeKey);
  });

  it("writes a client-scoped manifest", async () => {
    vi.useFakeTimers();
    const { CognitoSecureStorage } = await import("./cognito-storage");

    CognitoSecureStorage.setItem(
      "CognitoIdentityServiceProvider.client-1.user-1.idToken",
      "id-token",
    );
    vi.advanceTimersByTime(120);

    expect(mockSetItemAsync).toHaveBeenCalledWith(
      "CognitoIdentityServiceProvider.client-1.__manifest__",
      JSON.stringify([
        "CognitoIdentityServiceProvider.client-1.user-1.idToken",
      ]),
      { keychainAccessible: "AFTER_FIRST_UNLOCK" },
    );
  });

  it("clears only keys for the requested client id", async () => {
    const { CognitoSecureStorage, clearCognitoStorageForClientId } =
      await import("./cognito-storage");
    CognitoSecureStorage.setItem(
      "CognitoIdentityServiceProvider.client-1.user-1.idToken",
      "id-token-1",
    );
    CognitoSecureStorage.setItem(
      "CognitoIdentityServiceProvider.client-2.user-2.idToken",
      "id-token-2",
    );

    await clearCognitoStorageForClientId("client-1");

    expect(
      CognitoSecureStorage.getItem(
        "CognitoIdentityServiceProvider.client-1.user-1.idToken",
      ),
    ).toBeNull();
    expect(
      CognitoSecureStorage.getItem(
        "CognitoIdentityServiceProvider.client-2.user-2.idToken",
      ),
    ).toBe("id-token-2");
    expect(mockDeleteItemAsync).toHaveBeenCalledWith(
      "CognitoIdentityServiceProvider.client-1.user-1.idToken",
    );
    expect(mockDeleteItemAsync).toHaveBeenCalledWith(
      "CognitoIdentityServiceProvider.client-1.__manifest__",
    );
  });
});
