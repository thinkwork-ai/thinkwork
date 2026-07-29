import { afterEach, describe, expect, it, vi } from "vitest";

import { resetMemoryConfigCache } from "../../../lib/memory/config.js";
import { resetMemoryServicesCache } from "../../../lib/memory/index.js";
import { memorySystemConfig } from "./memorySystemConfig.query.js";

function resetMemory() {
  resetMemoryServicesCache();
  resetMemoryConfigCache();
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetMemory();
});

describe("memorySystemConfig", () => {
  it("reports unavailable when no AgentCore memory id is configured", async () => {
    vi.stubEnv("MEMORY_ENABLED", "true");
    vi.stubEnv("MEMORY_ENGINE", "agentcore");
    resetMemory();

    await expect(memorySystemConfig()).resolves.toMatchObject({
      activeEngine: "unavailable",
      managedMemoryEnabled: false,
      userMemoryEnabled: false,
      spaceMemoryEnabled: false,
      companyDistillationEnabled: false,
    });
  });

  it("normalizes a retired MEMORY_ENGINE value to agentcore", async () => {
    vi.stubEnv("MEMORY_ENABLED", "true");
    vi.stubEnv("MEMORY_ENGINE", "hindsight");
    vi.stubEnv("AGENTCORE_MEMORY_ID", "mem-123");
    resetMemory();

    await expect(memorySystemConfig()).resolves.toMatchObject({
      activeEngine: "agentcore",
      userMemoryEnabled: true,
    });
  });

  it("reports AgentCore user memory without Space memory support", async () => {
    vi.stubEnv("MEMORY_ENABLED", "true");
    vi.stubEnv("MEMORY_ENGINE", "agentcore");
    vi.stubEnv("AGENTCORE_MEMORY_ID", "mem-123");
    resetMemory();

    await expect(memorySystemConfig()).resolves.toMatchObject({
      activeEngine: "agentcore",
      userMemoryEnabled: true,
      spaceMemoryEnabled: false,
    });
  });
});
