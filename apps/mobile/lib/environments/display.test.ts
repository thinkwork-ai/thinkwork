import { describe, expect, it } from "vitest";
import { environmentFooterLabel } from "./display";
import type { MobilePlatformConfig } from "../platform-config";

describe("environment display helpers", () => {
  it("formats the active environment footer label", () => {
    expect(
      environmentFooterLabel(
        {
          id: "env-1",
          displayName: "McPherson",
          host: "https://mcpherson.thinkwork.ai",
          stage: "prod",
          region: "us-east-1",
          createdAt: "2026-07-04T00:00:00.000Z",
          config: {} as any,
        },
        platformConfig(),
      ),
    ).toBe("McPherson · prod · us-east-1");
  });
});

function platformConfig(): MobilePlatformConfig {
  return {
    stage: "dev",
    apiUrl: "",
    graphqlHttpUrl: "",
    graphqlUrl: "",
    graphqlWsUrl: "",
    graphqlApiKey: "",
    cognitoUserPoolId: "",
    cognitoClientId: "",
    cognitoDomain: "",
    configured: false,
    missing: [],
    issues: [],
    deployment: {
      source: "env",
      deploymentId: null,
      displayName: "ThinkWork",
      stage: "dev",
      region: "us-west-2",
      profileSha256: null,
      trustStatus: "unsigned",
      trustLabel: "Build-time fallback",
    },
  };
}
