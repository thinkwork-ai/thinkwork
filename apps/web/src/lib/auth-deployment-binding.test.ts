import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_DEPLOYMENT_PROFILE_SHA_STORAGE_KEY,
  currentDeploymentProfileSha,
  ensureAuthStorageMatchesDeploymentProfile,
  markAuthStorageDeploymentProfile,
} from "./auth-deployment-binding";
import { setRuntimeConfigForTest } from "./runtime-config";
import type { TokenStorage } from "./token-storage";

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "https://api.example.com");
  vi.stubEnv("VITE_GRAPHQL_HTTP_URL", "https://api.example.com/graphql");
  vi.stubEnv("VITE_GRAPHQL_URL", "https://appsync.example.com/graphql");
  vi.stubEnv("VITE_GRAPHQL_WS_URL", "wss://appsync.example.com/graphql");
  vi.stubEnv("VITE_COGNITO_USER_POOL_ID", "us-east-1_TestPool");
  vi.stubEnv("VITE_COGNITO_CLIENT_ID", "test-client-id");
  vi.stubEnv("VITE_COGNITO_DOMAIN", "thinkwork-test");
  vi.stubEnv("VITE_DEPLOYMENT_ID", "thinkwork-dev");
  vi.stubEnv("VITE_DEPLOYMENT_DISPLAY_NAME", "ThinkWork Dev");
  vi.stubEnv("VITE_STAGE", "dev");
  vi.stubEnv("VITE_AWS_REGION", "us-east-1");
});

afterEach(() => {
  setRuntimeConfigForTest({});
  vi.unstubAllEnvs();
});

describe("auth deployment profile binding", () => {
  it("marks auth storage with the active deployment profile fingerprint", () => {
    const storage = new MemoryTokenStorage();

    markAuthStorageDeploymentProfile(storage);

    expect(storage.getItem(AUTH_DEPLOYMENT_PROFILE_SHA_STORAGE_KEY)).toBe(
      currentDeploymentProfileSha(),
    );
  });

  it("refuses cached auth when the stored deployment fingerprint differs", () => {
    const storage = new MemoryTokenStorage({
      [AUTH_DEPLOYMENT_PROFILE_SHA_STORAGE_KEY]: "0".repeat(64),
      idToken: "stale-token",
    });

    expect(ensureAuthStorageMatchesDeploymentProfile(storage)).toBe(false);
    expect(storage.getItem(AUTH_DEPLOYMENT_PROFILE_SHA_STORAGE_KEY)).toBeNull();
    expect(storage.getItem("idToken")).toBe("stale-token");
  });

  it("refuses auth restore when the active deployment profile is incomplete", () => {
    vi.stubEnv("VITE_COGNITO_CLIENT_ID", "");
    const storage = new MemoryTokenStorage({
      [AUTH_DEPLOYMENT_PROFILE_SHA_STORAGE_KEY]:
        currentDeploymentProfileSha() ?? "",
    });

    expect(ensureAuthStorageMatchesDeploymentProfile(storage)).toBe(false);
  });
});

class MemoryTokenStorage implements TokenStorage {
  private items = new Map<string, string>();
  private readonly listeners = new Set<() => void>();

  constructor(items: Record<string, string> = {}) {
    this.items = new Map(Object.entries(items));
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  clear(): void {
    this.items.clear();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
