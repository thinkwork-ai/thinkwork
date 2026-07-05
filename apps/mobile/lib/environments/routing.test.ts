import { describe, expect, it } from "vitest";
import { shouldRouteToEnvironmentSetup } from "./routing";
import type { MobilePlatformConfig } from "../platform-config";

describe("environment first-run routing", () => {
  it("routes unauthenticated fresh installs with no build-time auth to setup", () => {
    expect(
      shouldRouteToEnvironmentSetup({
        isAuthenticated: false,
        hasStoredSession: false,
        isEnvironmentStoreHydrated: true,
        environmentCount: 0,
        hasActiveEnvironment: false,
        platformConfig: platformConfig({ cognitoClientId: "" }),
      }),
    ).toBe(true);
  });

  it("does not route authenticated, soft-authenticated, or build-configured users", () => {
    const config = platformConfig({ cognitoClientId: "client-id" });
    expect(
      shouldRouteToEnvironmentSetup({
        isAuthenticated: true,
        hasStoredSession: false,
        isEnvironmentStoreHydrated: true,
        environmentCount: 0,
        hasActiveEnvironment: false,
        platformConfig: platformConfig({ cognitoClientId: "" }),
      }),
    ).toBe(false);
    expect(
      shouldRouteToEnvironmentSetup({
        isAuthenticated: false,
        hasStoredSession: true,
        isEnvironmentStoreHydrated: true,
        environmentCount: 0,
        hasActiveEnvironment: false,
        platformConfig: platformConfig({ cognitoClientId: "" }),
      }),
    ).toBe(false);
    expect(
      shouldRouteToEnvironmentSetup({
        isAuthenticated: false,
        hasStoredSession: false,
        isEnvironmentStoreHydrated: true,
        environmentCount: 0,
        hasActiveEnvironment: false,
        platformConfig: config,
      }),
    ).toBe(false);
  });
});

function platformConfig(
  overrides: Partial<MobilePlatformConfig> = {},
): MobilePlatformConfig {
  return {
    stage: "dev",
    apiUrl: "",
    graphqlHttpUrl: "",
    graphqlUrl: "",
    graphqlWsUrl: "",
    graphqlApiKey: "",
    cognitoUserPoolId: "us-east-1_pool",
    cognitoClientId: "client-id",
    cognitoDomain: "https://auth.example.com",
    configured: true,
    missing: [],
    issues: [],
    deployment: {
      source: "env",
      deploymentId: null,
      displayName: "ThinkWork",
      stage: "dev",
      region: null,
      profileSha256: null,
      trustStatus: "unsigned",
      trustLabel: "Build-time fallback",
    },
    ...overrides,
  };
}
