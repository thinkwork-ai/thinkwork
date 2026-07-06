import { describe, expect, it, vi } from "vitest";
import {
  defaultSpaceIdFromRuntimeConfig,
  resolveCurrentCapabilitiesManifest,
} from "./current-manifest.js";
import type { CapabilitiesManifest } from "./manifest-compile.js";

const MANIFEST = {
  version: 1,
  agent: { tenant_id: "t1", agent_slug: "ops" },
  active: [],
  withheld: [],
} as unknown as CapabilitiesManifest;

describe("defaultSpaceIdFromRuntimeConfig", () => {
  it("reads a trimmed string defaultSpaceId and rejects everything else", () => {
    expect(defaultSpaceIdFromRuntimeConfig({ defaultSpaceId: "s1" })).toBe(
      "s1",
    );
    expect(defaultSpaceIdFromRuntimeConfig({ defaultSpaceId: "  " })).toBe(
      null,
    );
    expect(defaultSpaceIdFromRuntimeConfig({ defaultSpaceId: 3 })).toBe(null);
    expect(defaultSpaceIdFromRuntimeConfig(null)).toBe(null);
    expect(defaultSpaceIdFromRuntimeConfig([])).toBe(null);
  });
});

describe("resolveCurrentCapabilitiesManifest", () => {
  it("returns undefined for flag-off agents without rendering", async () => {
    const renderTuple = vi.fn();
    const result = await resolveCurrentCapabilitiesManifest({
      tenantId: "t1",
      agentId: "a1",
      logPrefix: "[test]",
      deps: {
        loadAgent: async () => ({
          capability_folder_dispatch: false,
          runtime_config: { defaultSpaceId: "s1" },
        }),
        renderTuple,
      },
    });
    expect(result).toBeUndefined();
    expect(renderTuple).not.toHaveBeenCalled();
  });

  it("renders read-only in the default Space and returns the manifest", async () => {
    const renderTuple = vi.fn(async () => ({
      capabilities: { manifest: MANIFEST },
    }));
    const result = await resolveCurrentCapabilitiesManifest({
      tenantId: "t1",
      agentId: "a1",
      userId: "u1",
      logPrefix: "[test]",
      deps: {
        loadAgent: async () => ({
          capability_folder_dispatch: true,
          runtime_config: { defaultSpaceId: "s1" },
        }),
        renderTuple,
      },
    });
    expect(result).toBe(MANIFEST);
    expect(renderTuple).toHaveBeenCalledWith({
      tenantId: "t1",
      agentId: "a1",
      spaceId: "s1",
      userId: "u1",
    });
  });

  it("returns null (folder-aware, NOT undefined) when the render has no manifest", async () => {
    const result = await resolveCurrentCapabilitiesManifest({
      tenantId: "t1",
      agentId: "a1",
      logPrefix: "[test]",
      deps: {
        loadAgent: async () => ({
          capability_folder_dispatch: true,
          runtime_config: { defaultSpaceId: "s1" },
        }),
        renderTuple: async () => ({}),
      },
    });
    expect(result).toBeNull();
  });

  it("throws loudly for a flag-on agent with no default Space (R20)", async () => {
    await expect(
      resolveCurrentCapabilitiesManifest({
        tenantId: "t1",
        agentId: "a1",
        logPrefix: "[test]",
        deps: {
          loadAgent: async () => ({
            capability_folder_dispatch: true,
            runtime_config: {},
          }),
          renderTuple: async () => ({}),
        },
      }),
    ).rejects.toThrow(/no default Space/);
  });
});
