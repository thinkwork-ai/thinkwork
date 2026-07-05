import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildDeploymentProfile,
  type DeploymentProfile,
} from "@thinkwork/deployment-profile";
import {
  importDeploymentProfile,
  resetDeploymentProfileForTests,
  setDeploymentProfileStorageForTests,
} from "./deployment-profile";
import {
  addOrUpdateEnvironment,
  resetEnvironmentStoreForTests,
  setActiveEnvironment,
  setEnvironmentStoreStorageForTests,
} from "./environments/store";
import type { EnvironmentRuntimeConfig } from "./environments/runtime-config-fetch";
import {
  getPlatformConfig,
  hydratePlatformConfig,
  subscribePlatformConfig,
} from "./platform-config";

const ORIGINAL_ENV = { ...process.env };

describe("mobile platform config", () => {
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

  it("prefers an active environment over legacy profile and build-time env", async () => {
    seedEnvConfig("env-key");
    await importDeploymentProfile(JSON.stringify(baseProfile()));
    await addOrUpdateEnvironment({
      host: "environment.thinkwork.ai",
      config: environmentConfig({
        graphqlApiKey: "environment-key",
        cognitoClientId: "environment-client",
      }),
    });

    expect(getPlatformConfig()).toMatchObject({
      graphqlApiKey: "environment-key",
      cognitoClientId: "environment-client",
      deployment: {
        source: "environment",
        displayName: "Environment Customer",
      },
    });
  });

  it("prefers profile GraphQL API key over build-time env", async () => {
    seedEnvConfig("env-key");
    await importDeploymentProfile(JSON.stringify(baseProfile()));

    expect(getPlatformConfig()).toMatchObject({
      graphqlApiKey: "profile-key",
      cognitoClientId: "profile-client",
      deployment: { source: "profile" },
    });
  });

  it("falls back to build-time GraphQL API key when the active profile has none", async () => {
    seedEnvConfig("env-key");
    const { graphqlApiKey: _graphqlApiKey, ...profile } = baseProfile();
    await importDeploymentProfile(JSON.stringify(profile));

    expect(getPlatformConfig()).toMatchObject({
      graphqlApiKey: "env-key",
      cognitoClientId: "profile-client",
      deployment: { source: "profile" },
    });
  });

  it("uses build-time env when no environment or profile is active", async () => {
    seedEnvConfig("env-key");

    await hydratePlatformConfig();

    expect(getPlatformConfig()).toMatchObject({
      graphqlApiKey: "env-key",
      cognitoClientId: "env-client",
      deployment: { source: "env" },
    });
  });

  it("notifies platform-config subscribers with the new active environment config", async () => {
    const first = await addOrUpdateEnvironment({
      host: "one.thinkwork.ai",
      config: environmentConfig({
        displayName: "One",
        cognitoClientId: "client-one",
      }),
    });
    await addOrUpdateEnvironment({
      host: "two.thinkwork.ai",
      config: environmentConfig({
        displayName: "Two",
        cognitoClientId: "client-two",
      }),
    });
    const seen: string[] = [];
    const unsubscribe = subscribePlatformConfig((config) => {
      seen.push(config.cognitoClientId);
    });

    await setActiveEnvironment(first.id);
    unsubscribe();

    expect(seen).toContain("client-one");
  });
});

function seedEnvConfig(graphqlApiKey: string) {
  process.env.EXPO_PUBLIC_STAGE = "env";
  process.env.EXPO_PUBLIC_API_URL = "https://env-api.example.com";
  process.env.EXPO_PUBLIC_GRAPHQL_HTTP_URL =
    "https://env-api.example.com/graphql";
  process.env.EXPO_PUBLIC_GRAPHQL_URL = "https://env-appsync.example.com/graphql";
  process.env.EXPO_PUBLIC_GRAPHQL_WS_URL =
    "wss://env-appsync.example.com/graphql";
  process.env.EXPO_PUBLIC_GRAPHQL_API_KEY = graphqlApiKey;
  process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID = "us-east-1_env";
  process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID = "env-client";
  process.env.EXPO_PUBLIC_COGNITO_DOMAIN = "env-auth.example.com";
}

function environmentConfig(
  overrides: Partial<EnvironmentRuntimeConfig> = {},
): EnvironmentRuntimeConfig {
  return {
    apiUrl: "https://environment-api.example.com",
    graphqlHttpUrl: "https://environment-api.example.com/graphql",
    graphqlUrl: "https://environment-appsync.example.com/graphql",
    graphqlWsUrl: "wss://environment-appsync.example.com/graphql",
    graphqlApiKey: "environment-key",
    cognitoDomain: "environment-auth.example.com",
    cognitoUserPoolId: "us-east-1_environment",
    cognitoClientId: "environment-client",
    deploymentId: "environment-deployment",
    displayName: "Environment Customer",
    stage: "environment",
    region: "us-east-1",
    ...overrides,
  };
}

function baseProfile(): DeploymentProfile {
  return buildDeploymentProfile({
    deploymentId: "profile-deployment",
    displayName: "Profile Customer",
    stage: "profile",
    region: "us-east-1",
    issuedAt: "2026-06-06T00:00:00.000Z",
    spacesUrl: "https://profile.thinkwork.ai",
    apiUrl: "https://profile-api.example.com",
    graphqlHttpUrl: "https://profile-api.example.com/graphql",
    appsyncHttpUrl: "https://profile-appsync.example.com/graphql",
    appsyncWsUrl: "wss://profile-appsync.example.com/graphql",
    graphqlApiKey: "profile-key",
    cognitoDomain: "profile-auth.example.com",
    cognitoUserPoolId: "us-east-1_profile",
    cognitoClientId: "profile-client",
    signature: null,
  });
}
