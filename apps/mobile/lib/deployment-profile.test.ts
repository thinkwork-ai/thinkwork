import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildDeploymentProfile,
  signDeploymentProfile,
  type DeploymentProfile,
} from "@thinkwork/deployment-profile";
import {
  extractProfileJson,
  hydrateDeploymentProfile,
  importDeploymentProfile,
  removeDeploymentProfile,
  resetDeploymentProfileForTests,
  setDeploymentProfileStorageForTests,
} from "./deployment-profile";
import { getPlatformConfig, hydratePlatformConfig } from "./platform-config";

const ORIGINAL_ENV = { ...process.env };

describe("mobile deployment profiles", () => {
  let storage = new Map<string, string>();

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: "test" };
    storage = new Map<string, string>();
    resetDeploymentProfileForTests();
    setDeploymentProfileStorageForTests({
      async getItem(key) {
        return storage.get(key) ?? null;
      },
      async setItem(key, value) {
        storage.set(key, value);
      },
      async removeItem(key) {
        storage.delete(key);
      },
    });
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    resetDeploymentProfileForTests();
  });

  it("uses build-time env when no deployment profile is active", async () => {
    process.env.EXPO_PUBLIC_GRAPHQL_URL =
      "https://env-appsync.appsync-api.us-east-1.amazonaws.com/graphql";
    process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID = "us-east-1_env";
    process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID = "env-client";
    process.env.EXPO_PUBLIC_COGNITO_DOMAIN =
      "env.auth.us-east-1.amazoncognito.com";

    await hydratePlatformConfig();

    expect(getPlatformConfig()).toMatchObject({
      configured: true,
      graphqlUrl:
        "https://env-appsync.appsync-api.us-east-1.amazonaws.com/graphql",
      cognitoClientId: "env-client",
      cognitoDomain: "https://env.auth.us-east-1.amazoncognito.com",
      deployment: {
        source: "env",
        displayName: "ThinkWork",
        trustLabel: "Build-time fallback",
      },
    });
  });

  it("imports a valid profile and resolves auth and GraphQL endpoints from it", async () => {
    const snapshot = await importDeploymentProfile(
      JSON.stringify(baseProfile()),
    );

    expect(snapshot.summary).toMatchObject({
      source: "profile",
      deploymentId: "deployment-1",
      displayName: "Customer One",
      trustStatus: "unsigned",
    });
    expect(getPlatformConfig()).toMatchObject({
      configured: true,
      graphqlUrl:
        "https://customer.appsync-api.us-east-1.amazonaws.com/graphql",
      graphqlWsUrl:
        "wss://customer.appsync-realtime-api.us-east-1.amazonaws.com/graphql",
      cognitoClientId: "profile-client",
      cognitoDomain: "https://customer.auth.us-east-1.amazoncognito.com",
      deployment: {
        source: "profile",
        displayName: "Customer One",
      },
    });
  });

  it("accepts profile links with base64url JSON payloads", () => {
    const json = JSON.stringify(baseProfile());
    const encoded = Buffer.from(json, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    expect(
      extractProfileJson(`thinkwork://deployment-profile?profile=${encoded}`),
    ).toBe(json);
  });

  it("preserves the previous profile when a replacement import fails", async () => {
    await importDeploymentProfile(JSON.stringify(baseProfile()));

    await expect(importDeploymentProfile("{nope")).rejects.toThrow(
      /malformed/i,
    );

    expect(getPlatformConfig().deployment).toMatchObject({
      source: "profile",
      deploymentId: "deployment-1",
    });
  });

  it("removes the active profile and falls back to env", async () => {
    process.env.EXPO_PUBLIC_GRAPHQL_URL =
      "https://env-appsync.appsync-api.us-east-1.amazonaws.com/graphql";
    process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID = "us-east-1_env";
    process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID = "env-client";
    process.env.EXPO_PUBLIC_COGNITO_DOMAIN = "env.example.com";
    await importDeploymentProfile(JSON.stringify(baseProfile()));

    await removeDeploymentProfile();

    expect(getPlatformConfig()).toMatchObject({
      configured: true,
      cognitoClientId: "env-client",
      deployment: { source: "env" },
    });
  });

  it("keeps sign-in disabled when required config is missing", async () => {
    await hydrateDeploymentProfile();

    expect(getPlatformConfig()).toMatchObject({
      configured: false,
      missing: [
        "GraphQL URL",
        "Cognito user pool",
        "Cognito client id",
        "Cognito domain",
      ],
    });
  });

  it("rejects unsigned production profiles", async () => {
    process.env.NODE_ENV = "production";

    await expect(
      importDeploymentProfile(JSON.stringify(baseProfile())),
    ).rejects.toThrow(/unsigned/i);
  });

  it("rejects signed production profiles when no trusted key is configured", async () => {
    process.env.NODE_ENV = "production";
    const signed = await signDeploymentProfile({
      profile: baseProfile(),
      keyId: "deployment-profile-2026",
      privateKeyPem: PRIVATE_KEY,
      issuer: "ThinkWork",
      expiresAt: "2026-12-31T00:00:00.000Z",
    });

    await expect(
      importDeploymentProfile(JSON.stringify(signed)),
    ).rejects.toThrow(/no trusted profile signing keys/i);
  });

  it("rejects non-TLS production endpoint URLs", async () => {
    process.env.NODE_ENV = "production";
    const profile = {
      ...baseProfile(),
      signature: null,
      appsyncHttpUrl: "http://customer.example.com/graphql",
    };

    await expect(
      importDeploymentProfile(JSON.stringify(profile)),
    ).rejects.toThrow(/must be an HTTPS URL/i);
  });
});

function baseProfile(): DeploymentProfile {
  return buildDeploymentProfile({
    deploymentId: "deployment-1",
    displayName: "Customer One",
    stage: "customer",
    region: "us-east-1",
    issuedAt: "2026-06-06T00:00:00.000Z",
    spacesUrl: "https://customer.thinkwork.example.com",
    apiUrl: "https://api.customer.thinkwork.example.com",
    graphqlHttpUrl: "https://api.customer.thinkwork.example.com/graphql",
    appsyncHttpUrl:
      "https://customer.appsync-api.us-east-1.amazonaws.com/graphql",
    appsyncWsUrl:
      "wss://customer.appsync-realtime-api.us-east-1.amazonaws.com/graphql",
    cognitoDomain: "customer.auth.us-east-1.amazoncognito.com",
    cognitoUserPoolId: "us-east-1_profile",
    cognitoClientId: "profile-client",
    signature: null,
  });
}

const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIJmukVHXtfdctELmxuvCSBKMaOwZU5e8EVWbFoFa3o82
-----END PRIVATE KEY-----`;
