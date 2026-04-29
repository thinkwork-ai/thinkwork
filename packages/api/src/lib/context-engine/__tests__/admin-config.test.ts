import { describe, expect, it } from "vitest";
import {
  applyTenantContextProviderSettings,
  memoryProviderConfig,
  normalizeMemoryProviderConfig,
} from "../admin-config.js";
import type { ContextProviderDescriptor } from "../types.js";

const provider: ContextProviderDescriptor = {
  id: "memory",
  family: "memory",
  displayName: "Hindsight Memory",
  defaultEnabled: false,
  query: async () => ({ hits: [] }),
};

describe("Context Engine admin config", () => {
  it("applies tenant eligibility and default flags to built-in providers", () => {
    const [configured] = applyTenantContextProviderSettings(
      [provider],
      [
        {
          providerId: "memory",
          family: "memory",
          enabled: true,
          defaultEnabled: true,
          config: { queryMode: "reflect" },
        },
      ],
    );

    expect(configured).toMatchObject({
      enabled: true,
      defaultEnabled: true,
      config: { queryMode: "reflect" },
    });
  });

  it("prevents disabled providers from remaining defaults", () => {
    const [configured] = applyTenantContextProviderSettings(
      [provider],
      [
        {
          providerId: "memory",
          family: "memory",
          enabled: false,
          defaultEnabled: true,
          config: {},
        },
      ],
    );

    expect(configured).toMatchObject({
      enabled: false,
      defaultEnabled: false,
    });
  });

  it("normalizes Hindsight operator controls", () => {
    expect(
      normalizeMemoryProviderConfig({
        queryMode: "reflect",
        timeoutMs: 120_000,
        includeLegacyBanks: true,
        unsupported: "ignored",
      }),
    ).toEqual({
      queryMode: "reflect",
      timeoutMs: 60_000,
      includeLegacyBanks: true,
    });
  });

  it("extracts memory provider options for runtime construction", () => {
    expect(
      memoryProviderConfig([
        {
          providerId: "memory",
          family: "memory",
          enabled: true,
          defaultEnabled: true,
          config: {
            queryMode: "recall",
            timeoutMs: 8_000,
            includeLegacyBanks: true,
          },
        },
      ]),
    ).toEqual({
      queryMode: "recall",
      timeoutMs: 8_000,
      includeLegacyBanks: true,
    });
  });
});
