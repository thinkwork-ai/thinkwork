import { describe, expect, it } from "vitest";

import { loadMemoryConfig, MemoryConfigError } from "./config.js";

describe("loadMemoryConfig", () => {
  it("accepts Cognee as an explicit memory engine", () => {
    const config = loadMemoryConfig({
      MEMORY_ENGINE: "cognee",
      COGNEE_ENDPOINT: " https://cognee.example ",
    });

    expect(config).toEqual(
      expect.objectContaining({
        enabled: true,
        engine: "cognee",
        sessionSource: "thread_db",
        retain: expect.objectContaining({
          autoRetainTurns: true,
          explicitRememberEnabled: true,
        }),
        inspect: expect.objectContaining({
          graphEnabled: true,
        }),
        backends: expect.objectContaining({
          cogneeEndpoint: "https://cognee.example",
          hindsightEndpoint: null,
          agentcoreMemoryId: null,
        }),
      }),
    );
  });

  it("accepts the compact Cognee runtime-config status value", () => {
    const config = loadMemoryConfig({
      MEMORY_ENGINE: "cognee",
      COGNEE: "dogfood| https://cognee.example/mcp ",
    });

    expect(config.backends.cogneeEndpoint).toBe("https://cognee.example/mcp");
  });

  it("requires a Cognee endpoint when Cognee memory is enabled", () => {
    expect(() =>
      loadMemoryConfig({
        MEMORY_ENGINE: "cognee",
      }),
    ).toThrow(
      new MemoryConfigError(
        'MEMORY_ENGINE="cognee" requires COGNEE_ENDPOINT to be set',
      ),
    );
  });

  it("mentions Cognee in the valid memory engine list", () => {
    expect(() =>
      loadMemoryConfig({
        MEMORY_ENGINE: "other",
      }),
    ).toThrow('MEMORY_ENGINE must be "hindsight", "agentcore", or "cognee"');
  });
});
