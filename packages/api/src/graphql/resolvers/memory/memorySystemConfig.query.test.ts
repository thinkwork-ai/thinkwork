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
  it("reports Cognee as active user and space memory without enabling Hindsight", async () => {
    vi.stubEnv("MEMORY_ENABLED", "true");
    vi.stubEnv("MEMORY_ENGINE", "cognee");
    vi.stubEnv("COGNEE_ENDPOINT", "https://cognee.internal.example.com");
    vi.stubEnv("HINDSIGHT_ENDPOINT", "https://hindsight.legacy.example.com");
    resetMemory();

    await expect(memorySystemConfig()).resolves.toMatchObject({
      activeEngine: "cognee",
      managedMemoryEnabled: true,
      hindsightEnabled: false,
      cogneeMemoryEnabled: true,
      userMemoryEnabled: true,
      spaceMemoryEnabled: true,
      legacyHindsightAvailable: true,
      companyDistillationEnabled: false,
      wikiProjectionEnabled: false,
    });
  });

  it("reports Hindsight as active user and Space memory when it is the active engine", async () => {
    vi.stubEnv("MEMORY_ENABLED", "true");
    vi.stubEnv("MEMORY_ENGINE", "hindsight");
    vi.stubEnv("HINDSIGHT_ENDPOINT", "https://hindsight.active.example.com");
    resetMemory();

    await expect(memorySystemConfig()).resolves.toMatchObject({
      activeEngine: "hindsight",
      hindsightEnabled: true,
      cogneeMemoryEnabled: false,
      userMemoryEnabled: true,
      spaceMemoryEnabled: true,
      legacyHindsightAvailable: false,
    });
  });

  it("reports AgentCore user memory without Space memory support", async () => {
    vi.stubEnv("MEMORY_ENABLED", "true");
    vi.stubEnv("MEMORY_ENGINE", "agentcore");
    vi.stubEnv("AGENTCORE_MEMORY_ID", "mem-123");
    resetMemory();

    await expect(memorySystemConfig()).resolves.toMatchObject({
      activeEngine: "agentcore",
      hindsightEnabled: false,
      cogneeMemoryEnabled: false,
      userMemoryEnabled: true,
      spaceMemoryEnabled: false,
      legacyHindsightAvailable: false,
    });
  });
});
