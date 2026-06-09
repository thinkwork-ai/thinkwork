import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSpacesDeploymentProfileSnapshot } from "./deployment-profile";
import { setRuntimeConfigForTest } from "./runtime-config";

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

describe("getSpacesDeploymentProfileSnapshot", () => {
  it("uses a stable unsigned fallback fingerprint when Terraform has not written an issued timestamp", () => {
    vi.stubEnv("VITE_DEPLOYMENT_PROFILE_ISSUED_AT", "");

    const first = getSpacesDeploymentProfileSnapshot();
    const second = getSpacesDeploymentProfileSnapshot();

    expect(first.profileSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(second.profileSha256).toBe(first.profileSha256);
    expect(first.profile?.issuedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("changes fingerprint when the active deployment profile endpoints change", () => {
    const first = getSpacesDeploymentProfileSnapshot();
    setRuntimeConfigForTest({
      VITE_API_URL: "https://tei-api.example.com",
      VITE_GRAPHQL_HTTP_URL: "https://tei-api.example.com/graphql",
      VITE_GRAPHQL_URL: "https://tei-appsync.example.com/graphql",
      VITE_GRAPHQL_WS_URL: "wss://tei-appsync.example.com/graphql",
      VITE_COGNITO_USER_POOL_ID: "us-east-1_TeiPool",
      VITE_COGNITO_CLIENT_ID: "tei-client-id",
      VITE_COGNITO_DOMAIN: "thinkwork-tei",
      VITE_DEPLOYMENT_ID: "thinkwork-tei-e2e",
      VITE_DEPLOYMENT_DISPLAY_NAME: "TEI ThinkWork",
      VITE_STAGE: "tei-e2e",
      VITE_AWS_REGION: "us-east-1",
    });

    expect(getSpacesDeploymentProfileSnapshot().profileSha256).not.toBe(
      first.profileSha256,
    );
  });
});
