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

  it("reports Hindsight only when it is the active engine", async () => {
    vi.stubEnv("MEMORY_ENABLED", "true");
    vi.stubEnv("MEMORY_ENGINE", "hindsight");
    vi.stubEnv("HINDSIGHT_ENDPOINT", "https://hindsight.active.example.com");
    resetMemory();

    await expect(memorySystemConfig()).resolves.toMatchObject({
      activeEngine: "hindsight",
      hindsightEnabled: true,
      cogneeMemoryEnabled: false,
      userMemoryEnabled: false,
      spaceMemoryEnabled: false,
      legacyHindsightAvailable: false,
    });
  });
});
