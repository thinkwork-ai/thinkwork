import { describe, expect, it } from "vitest";

import { loadMemoryConfig, MemoryConfigError } from "./config.js";

describe("loadMemoryConfig", () => {
  it("accepts Hindsight as the default memory engine", () => {
    const config = loadMemoryConfig({
      HINDSIGHT_ENDPOINT: " https://hindsight.example ",
    });

    expect(config).toEqual(
      expect.objectContaining({
        enabled: true,
        engine: "hindsight",
        sessionSource: "thread_db",
        retain: expect.objectContaining({
          autoRetainTurns: false,
          explicitRememberEnabled: true,
        }),
        inspect: expect.objectContaining({
          graphEnabled: true,
        }),
        backends: expect.objectContaining({
          hindsightEndpoint: "https://hindsight.example",
          agentcoreMemoryId: null,
        }),
      }),
    );
  });

  it("accepts AgentCore as an explicit memory engine", () => {
    const config = loadMemoryConfig({
      MEMORY_ENGINE: "agentcore",
      AGENTCORE_MEMORY_ID: "memory-123",
    });

    expect(config).toEqual(
      expect.objectContaining({
        engine: "agentcore",
        retain: expect.objectContaining({
          autoRetainTurns: true,
        }),
        inspect: expect.objectContaining({
          graphEnabled: false,
        }),
        backends: expect.objectContaining({
          agentcoreMemoryId: "memory-123",
        }),
      }),
    );
  });

  it("rejects the retired memory engine value", () => {
    expect(() =>
      loadMemoryConfig({
        MEMORY_ENGINE: "cognee",
      }),
    ).toThrow('MEMORY_ENGINE must be "hindsight" or "agentcore"');
  });

  it("mentions only current engines in the valid memory engine list", () => {
    expect(() =>
      loadMemoryConfig({
        MEMORY_ENGINE: "other",
      }),
    ).toThrow('MEMORY_ENGINE must be "hindsight" or "agentcore"');
  });
});
