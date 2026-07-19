import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deniedCognitoClientIds,
  handler,
} from "./cognito-pre-token-client-deny.js";

function event(clientId: string, triggerSource: string) {
  return {
    triggerSource,
    callerContext: { clientId },
    response: {},
  };
}

afterEach(() => {
  delete process.env.COGNITO_DENIED_APP_CLIENT_IDS;
  vi.restoreAllMocks();
});

describe("Cognito pre-token client cutoff", () => {
  it("blocks hosted authentication and refresh-token issuance for denied clients", async () => {
    process.env.COGNITO_DENIED_APP_CLIENT_IDS = "legacy-web, legacy-mobile";
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      handler(event("legacy-web", "TokenGeneration_HostedAuth")),
    ).rejects.toThrow("Authentication client is disabled");
    await expect(
      handler(event("legacy-mobile", "TokenGeneration_RefreshTokens")),
    ).rejects.toThrow("Authentication client is disabled");
  });

  it("leaves every non-denied native client unchanged", async () => {
    process.env.COGNITO_DENIED_APP_CLIENT_IDS = "legacy-web";
    const input = event("native-google-web", "TokenGeneration_RefreshTokens");
    await expect(handler(input)).resolves.toBe(input);
  });

  it("normalizes the configured deny set without accepting empty values", () => {
    expect([...deniedCognitoClientIds(" one, ,two,one ")]).toEqual([
      "one",
      "two",
    ]);
  });
});
