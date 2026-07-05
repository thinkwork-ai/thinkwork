import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractProfileJson } from "../../../../mobile/lib/deployment-profile";
import { SetUpMobileCard } from "./SetUpMobileCard";
import { getSpacesDeploymentProfileSnapshot } from "@/lib/deployment-profile";
import {
  buildMobileDeploymentProfileLink,
  encodeDeploymentProfileForMobile,
} from "@/lib/mobile-setup-link";
import { setRuntimeConfigForTest } from "@/lib/runtime-config";

beforeEach(() => {
  stubCompleteProfileEnv();
});

afterEach(() => {
  cleanup();
  setRuntimeConfigForTest({});
  vi.unstubAllEnvs();
});

describe("SetUpMobileCard", () => {
  it("encodes a mobile setup link that the real mobile parser decodes byte-for-byte", () => {
    const snapshot = getSpacesDeploymentProfileSnapshot({
      ...completeProfileEnv(),
      VITE_DEPLOYMENT_DISPLAY_NAME: "Café ThinkWork 🚀",
    } as unknown as Parameters<typeof getSpacesDeploymentProfileSnapshot>[0]);
    expect(snapshot.profile).not.toBeNull();

    const encoded = encodeDeploymentProfileForMobile(snapshot.profile!);
    const decoded = extractProfileJson(
      `thinkwork://deployment-profile?profile=${encoded}`,
    );

    expect(decoded).toBe(JSON.stringify(snapshot.profile));
  });

  it("includes the GraphQL API key in the mobile setup payload", () => {
    vi.stubEnv("VITE_GRAPHQL_API_KEY", "web-api-key");
    const snapshot = getSpacesDeploymentProfileSnapshot();
    expect(snapshot.profile).not.toBeNull();

    const decoded = JSON.parse(
      extractProfileJson(buildMobileDeploymentProfileLink(snapshot.profile!)),
    );

    expect(decoded.graphqlApiKey).toBe("web-api-key");
  });

  it("renders a QR code and copy fields when deployment config is usable", () => {
    render(<SetUpMobileCard />);

    expect(
      screen.getByRole("img", { name: /mobile setup for thinkwork dev/i }),
    ).toBeTruthy();
    expect(screen.getByTestId("mobile-setup-qr")).toBeTruthy();
    expect(screen.getByText(/thinkwork:\/\/deployment-profile/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy Mobile setup link" }),
    ).toBeTruthy();
  });

  it("renders an unavailable state without attempting to encode a null profile", () => {
    vi.stubEnv("VITE_API_URL", "");

    render(<SetUpMobileCard />);

    expect(screen.getByText("Configuration incomplete")).toBeTruthy();
    expect(screen.queryByTestId("mobile-setup-qr")).toBeNull();
    expect(screen.queryByText(/thinkwork:\/\/deployment-profile/)).toBeNull();
  });
});

function stubCompleteProfileEnv() {
  for (const [key, value] of Object.entries(completeProfileEnv())) {
    vi.stubEnv(key, value);
  }
}

function completeProfileEnv(): Record<string, string> {
  return {
    VITE_API_URL: "https://api.example.com",
    VITE_GRAPHQL_HTTP_URL: "https://api.example.com/graphql",
    VITE_GRAPHQL_URL: "https://appsync.example.com/graphql",
    VITE_GRAPHQL_WS_URL: "wss://appsync.example.com/graphql",
    VITE_GRAPHQL_API_KEY: "web-api-key",
    VITE_COGNITO_USER_POOL_ID: "us-east-1_TestPool",
    VITE_COGNITO_CLIENT_ID: "test-client-id",
    VITE_COGNITO_DOMAIN: "thinkwork-test",
    VITE_DEPLOYMENT_ID: "thinkwork-dev",
    VITE_DEPLOYMENT_DISPLAY_NAME: "ThinkWork Dev",
    VITE_STAGE: "dev",
    VITE_AWS_REGION: "us-east-1",
    VITE_SPACES_URL: "https://app.example.com",
  };
}
