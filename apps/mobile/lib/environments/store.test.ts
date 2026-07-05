import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildDeploymentProfile,
  type DeploymentProfile,
} from "@thinkwork/deployment-profile";
import {
  resetDeploymentProfileForTests,
  setDeploymentProfileStorageForTests,
} from "../deployment-profile";
import {
  addOrUpdateEnvironment,
  getActiveEnvironmentEntry,
  getEnvironmentEntries,
  hydrateEnvironmentStore,
  removeEnvironment,
  renameEnvironment,
  resetEnvironmentStoreForTests,
  setActiveEnvironment,
  setEnvironmentStoreStorageForTests,
} from "./store";
import type { EnvironmentRuntimeConfig } from "./runtime-config-fetch";

const PROFILE_STORAGE_KEY = "thinkwork.deploymentProfile.v1";
const ORIGINAL_ENV = { ...process.env };

describe("mobile environment store", () => {
  let storage = new Map<string, string>();

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: "test" };
    storage = new Map<string, string>();
    resetDeploymentProfileForTests();
    resetEnvironmentStoreForTests();
    const adapter = {
      async getItem(key: string) {
        return storage.get(key) ?? null;
      },
      async setItem(key: string, value: string) {
        storage.set(key, value);
      },
      async removeItem(key: string) {
        storage.delete(key);
      },
    };
    setDeploymentProfileStorageForTests(adapter);
    setEnvironmentStoreStorageForTests(adapter);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    resetDeploymentProfileForTests();
    resetEnvironmentStoreForTests();
  });

  it("dedupes by normalized host and updates in place", async () => {
    const first = await addOrUpdateEnvironment({
      host: "Customer.ThinkWork.AI/settings",
      config: runtimeConfig({ displayName: "Customer One" }),
      now: "2026-07-01T00:00:00.000Z",
    });
    const second = await addOrUpdateEnvironment({
      host: "https://customer.thinkwork.ai",
      config: runtimeConfig({
        displayName: "Customer One Updated",
        stage: "prod",
      }),
      now: "2026-07-02T00:00:00.000Z",
    });

    expect(getEnvironmentEntries()).toHaveLength(1);
    expect(second).toMatchObject({
      id: first.id,
      displayName: "Customer One Updated",
      stage: "prod",
      createdAt: "2026-07-01T00:00:00.000Z",
    });
    expect(
      getEnvironmentEntries().filter(
        (entry) => entry.config.cognitoClientId === "client-id",
      ),
    ).toHaveLength(1);
  });

  it("adds separate entries for different hosts", async () => {
    await addOrUpdateEnvironment({
      host: "one.thinkwork.ai",
      config: runtimeConfig({ displayName: "One" }),
    });
    await addOrUpdateEnvironment({
      host: "two.thinkwork.ai",
      config: runtimeConfig({ displayName: "Two" }),
    });

    expect(getEnvironmentEntries().map((entry) => entry.host)).toEqual([
      "https://one.thinkwork.ai",
      "https://two.thinkwork.ai",
    ]);
  });

  it("sets and returns the active environment", async () => {
    const first = await addOrUpdateEnvironment({
      host: "one.thinkwork.ai",
      config: runtimeConfig({ displayName: "One" }),
    });
    const second = await addOrUpdateEnvironment({
      host: "two.thinkwork.ai",
      config: runtimeConfig({ displayName: "Two" }),
    });

    await setActiveEnvironment(first.id);

    expect(second.id).not.toBe(first.id);
    expect(getActiveEnvironmentEntry()).toMatchObject({
      id: first.id,
      displayName: "One",
    });
  });

  it("clears active environment when removing the active entry", async () => {
    const entry = await addOrUpdateEnvironment({
      host: "active.thinkwork.ai",
      config: runtimeConfig({ displayName: "Active" }),
    });

    const snapshot = await removeEnvironment(entry.id);

    expect(snapshot.activeEntry).toBeNull();
    expect(snapshot.activeEnvironmentId).toBeNull();
    expect(getEnvironmentEntries()).toEqual([]);
  });

  it("renames displayName only", async () => {
    const entry = await addOrUpdateEnvironment({
      host: "rename.thinkwork.ai",
      config: runtimeConfig({ displayName: "Original", stage: "dev" }),
    });

    await renameEnvironment(entry.id, "Manual Name");

    expect(getActiveEnvironmentEntry()).toMatchObject({
      displayName: "Manual Name",
      stage: "dev",
      config: {
        displayName: "Original",
      },
    });
  });

  it("migrates a legacy deployment profile into the first active environment", async () => {
    storage.set(PROFILE_STORAGE_KEY, JSON.stringify(baseProfile()));

    const snapshot = await hydrateEnvironmentStore();

    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.activeEntry).toMatchObject({
      displayName: "Legacy Customer",
      host: "https://legacy.thinkwork.ai",
      config: {
        graphqlApiKey: "legacy-api-key",
        cognitoClientId: "legacy-client",
      },
    });
  });

  it("stays empty when there are no stored environments or legacy profile", async () => {
    const snapshot = await hydrateEnvironmentStore();

    expect(snapshot.entries).toEqual([]);
    expect(snapshot.activeEntry).toBeNull();
  });
});

function runtimeConfig(
  overrides: Partial<EnvironmentRuntimeConfig> = {},
): EnvironmentRuntimeConfig {
  return {
    apiUrl: "https://api.example.com",
    graphqlHttpUrl: "https://api.example.com/graphql",
    graphqlUrl: "https://appsync.example.com/graphql",
    graphqlWsUrl: "wss://appsync.example.com/graphql",
    graphqlApiKey: "runtime-key",
    cognitoDomain: "auth.example.com",
    cognitoUserPoolId: "us-east-1_pool",
    cognitoClientId: "client-id",
    deploymentId: "deployment-1",
    displayName: "Customer",
    stage: "dev",
    region: "us-east-1",
    ...overrides,
  };
}

function baseProfile(): DeploymentProfile {
  return buildDeploymentProfile({
    deploymentId: "legacy-deployment",
    displayName: "Legacy Customer",
    stage: "legacy",
    region: "us-east-1",
    issuedAt: "2026-06-06T00:00:00.000Z",
    spacesUrl: "https://legacy.thinkwork.ai",
    apiUrl: "https://legacy-api.example.com",
    graphqlHttpUrl: "https://legacy-api.example.com/graphql",
    appsyncHttpUrl: "https://legacy-appsync.example.com/graphql",
    appsyncWsUrl: "wss://legacy-appsync.example.com/graphql",
    graphqlApiKey: "legacy-api-key",
    cognitoDomain: "legacy-auth.example.com",
    cognitoUserPoolId: "us-east-1_legacy",
    cognitoClientId: "legacy-client",
    signature: null,
  });
}
