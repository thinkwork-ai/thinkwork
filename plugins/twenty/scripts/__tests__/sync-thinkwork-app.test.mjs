import { describe, expect, it } from "vitest";

import { buildTwentyRemoteConfig } from "../sync-thinkwork-app.mjs";

describe("sync-thinkwork-app", () => {
  it("builds a Twenty remote config from an empty config file", () => {
    const config = buildTwentyRemoteConfig(
      {},
      {
        remoteName: "thinkwork-crm",
        url: "https://crm.thinkwork.ai",
        apiKey: "test-key",
      },
    );

    expect(config).toEqual({
      version: 1,
      defaultRemote: "thinkwork-crm",
      remotes: {
        "thinkwork-crm": {
          apiUrl: "https://crm.thinkwork.ai",
          apiKey: "test-key",
        },
      },
    });
  });

  it("preserves existing Twenty remotes while selecting the ThinkWork remote", () => {
    const config = buildTwentyRemoteConfig(
      {
        version: 1,
        defaultRemote: "local",
        remotes: {
          local: {
            apiUrl: "http://localhost:2020",
          },
        },
      },
      {
        remoteName: "thinkwork-crm",
        url: "https://crm.thinkwork.ai",
        apiKey: "test-key",
      },
    );

    expect(config.defaultRemote).toBe("thinkwork-crm");
    expect(config.remotes.local).toEqual({
      apiUrl: "http://localhost:2020",
    });
    expect(config.remotes["thinkwork-crm"]).toEqual({
      apiUrl: "https://crm.thinkwork.ai",
      apiKey: "test-key",
    });
  });
});
