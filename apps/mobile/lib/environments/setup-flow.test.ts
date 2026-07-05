import { describe, expect, it, vi } from "vitest";
import {
  environmentSetupErrorMessage,
  setupEnvironmentFromDeploymentProfileLink,
  setupEnvironmentFromUrl,
} from "./setup-flow";
import type { EnvironmentRuntimeConfig } from "./runtime-config-fetch";

describe("environment setup flow", () => {
  it("renders distinct copy for each setup error kind", () => {
    expect(
      environmentSetupErrorMessage({
        kind: "invalid-url",
        message: "invalid",
      }),
    ).toBe("That doesn't look like a valid ThinkWork URL.");
    expect(
      environmentSetupErrorMessage(
        { kind: "unreachable", message: "offline" },
        "mcpherson.thinkwork.ai",
      ),
    ).toBe(
      "Couldn't reach mcpherson.thinkwork.ai. Check the URL and your connection.",
    );
    expect(
      environmentSetupErrorMessage({
        kind: "no-config-published",
        message: "This environment hasn't published mobile config.",
      }),
    ).toBe("This environment hasn't published mobile config.");
    expect(
      environmentSetupErrorMessage({ kind: "malformed", message: "bad" }),
    ).toBe("This environment's config looks incomplete. Contact your admin.");
  });

  it("saves a fetched runtime config as an environment", async () => {
    const saveEnvironment = vi.fn(async (input) => ({
      id: "env-1",
      displayName: input.displayName ?? "Customer",
      host: input.host,
      stage: input.config.stage,
      region: input.config.region,
      config: input.config,
      createdAt: "2026-07-04T00:00:00.000Z",
    }));

    const result = await setupEnvironmentFromUrl("customer.thinkwork.ai", {
      fetchConfig: async () => ({
        ok: true,
        host: "https://customer.thinkwork.ai",
        config: runtimeConfig(),
      }),
      saveEnvironment,
    });

    expect(result).toMatchObject({
      ok: true,
      entry: {
        displayName: "Customer",
        host: "https://customer.thinkwork.ai",
      },
    });
    expect(saveEnvironment).toHaveBeenCalledWith({
      host: "https://customer.thinkwork.ai",
      config: runtimeConfig(),
      displayName: "Customer",
    });
  });

  it("treats a scanned deployment-profile link as a host pointer (server-authoritative config)", async () => {
    // Unsigned profile, as the web card mints them — must still work in
    // production because only spacesUrl is read; endpoints come from the
    // host's published runtime config, never the QR payload.
    const profile = {
      schemaVersion: 1,
      spacesUrl: "https://customer.thinkwork.ai",
      graphqlHttpUrl: "https://attacker.example.com/graphql",
      signature: null,
    };
    const encoded = Buffer.from(JSON.stringify(profile))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const link = `thinkwork://deployment-profile?profile=${encoded}`;

    const fetchConfig = vi.fn(async () => ({
      ok: true as const,
      host: "https://customer.thinkwork.ai",
      config: runtimeConfig(),
    }));
    const saveEnvironment = vi.fn(async (input) => ({
      id: "env-1",
      displayName: input.displayName ?? "Customer",
      host: input.host,
      stage: input.config.stage,
      region: input.config.region,
      config: input.config,
      createdAt: "2026-07-04T00:00:00.000Z",
    }));

    const entry = await setupEnvironmentFromDeploymentProfileLink(link, {
      fetchConfig,
      saveEnvironment,
    });

    expect(fetchConfig).toHaveBeenCalledWith("https://customer.thinkwork.ai");
    // The QR's embedded endpoints are ignored — config is the fetched one.
    expect(entry.config).toEqual(runtimeConfig());
  });

  it("rejects setup links without an environment URL", async () => {
    await expect(
      setupEnvironmentFromDeploymentProfileLink("not-a-profile"),
    ).rejects.toThrow(/isn't a ThinkWork deployment profile/);
  });
});

function runtimeConfig(): EnvironmentRuntimeConfig {
  return {
    apiUrl: "https://api.example.com",
    graphqlHttpUrl: "https://api.example.com/graphql",
    graphqlUrl: "https://appsync.example.com/graphql",
    graphqlWsUrl: "wss://appsync.example.com/graphql",
    graphqlApiKey: "key",
    cognitoDomain: "auth.example.com",
    cognitoUserPoolId: "us-east-1_pool",
    cognitoClientId: "client-id",
    deploymentId: "deployment-1",
    displayName: "Customer",
    stage: "prod",
    region: "us-east-1",
  };
}
