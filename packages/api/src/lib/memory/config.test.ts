import { describe, expect, it } from "vitest";

import { loadMemoryConfig, MemoryConfigError } from "./config.js";

describe("loadMemoryConfig", () => {
  it("resolves AgentCore as the memory engine", () => {
    const config = loadMemoryConfig({
      MEMORY_ENGINE: "agentcore",
      AGENTCORE_MEMORY_ID: "memory-123",
    });

    expect(config).toEqual(
      expect.objectContaining({
        enabled: true,
        engine: "agentcore",
        sessionSource: "thread_db",
        retain: expect.objectContaining({
          autoRetainTurns: true,
          explicitRememberEnabled: true,
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

  it("defaults to AgentCore when MEMORY_ENGINE is unset", () => {
    expect(loadMemoryConfig({ AGENTCORE_MEMORY_ID: "memory-123" }).engine).toBe(
      "agentcore",
    );
  });

  // THINK-406: Terraform still ships `memory_engine`/`enable_hindsight` until
  // the infrastructure teardown lands, so customer stages can boot this code
  // with a stale value. Normalizing beats crashing the Lambda.
  it.each(["hindsight", "Hindsight", "managed", "retired_graph", "other"])(
    "normalizes the retired MEMORY_ENGINE value %s to agentcore",
    (value) => {
      expect(
        loadMemoryConfig({
          MEMORY_ENGINE: value,
          AGENTCORE_MEMORY_ID: "memory-123",
        }).engine,
      ).toBe("agentcore");
    },
  );

  it("throws when memory is enabled without an AgentCore memory id", () => {
    expect(() => loadMemoryConfig({ MEMORY_ENGINE: "agentcore" })).toThrow(
      MemoryConfigError,
    );
  });

  it("does not require a memory id when memory is disabled", () => {
    expect(loadMemoryConfig({ MEMORY_ENABLED: "false" })).toEqual(
      expect.objectContaining({ enabled: false, engine: "agentcore" }),
    );
  });
});
