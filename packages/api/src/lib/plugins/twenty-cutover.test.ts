/**
 * U10 Twenty cutover tests — fake deps, no DB. Covers adoption, the
 * plugin-row-already-exists dedupe branch, token invalidation, the
 * missing-install precondition, and idempotent re-runs.
 */

import { describe, expect, it, vi } from "vitest";

import type { EmitAuditEventInput } from "../compliance/emit.js";
import {
  cutoverTwentyPluginForTenant,
  TWENTY_PLUGIN_MCP_SLUG,
  type TwentyCutoverDeps,
} from "./twenty-cutover.js";

interface FakeState {
  install: { id: string } | null;
  legacy: { id: string; url: string } | null;
  pluginRow: { id: string; url: string } | null;
  tokenCount: number;
}

function fakeDeps(state: FakeState) {
  const calls = {
    invalidatedServerIds: [] as string[],
    adopted: [] as Array<Record<string, unknown>>,
    removed: [] as Array<Record<string, unknown>>,
    audits: [] as EmitAuditEventInput[],
  };
  const deps: TwentyCutoverDeps = {
    getTwentyInstall: vi.fn(async () => state.install),
    getLegacyManagedRow: vi.fn(async () => state.legacy),
    getPluginRow: vi.fn(async () => state.pluginRow),
    invalidateUserTokens: vi.fn(async (serverId: string) => {
      calls.invalidatedServerIds.push(serverId);
      const count = state.tokenCount;
      state.tokenCount = 0;
      return count;
    }),
    adoptLegacyRow: vi.fn(async (args) => {
      calls.adopted.push(args as unknown as Record<string, unknown>);
      calls.audits.push(args.audit);
      // Adoption flips the legacy row into the plugin row.
      state.pluginRow = state.legacy;
      state.legacy = null;
    }),
    removeLegacyRow: vi.fn(async (args) => {
      calls.removed.push(args as unknown as Record<string, unknown>);
      calls.audits.push(args.audit);
      state.legacy = null;
    }),
  };
  return { deps, calls };
}

const actor = {
  tenantId: "tenant-1",
  actorId: "user-1",
  actorType: "user" as const,
};

describe("cutoverTwentyPluginForTenant", () => {
  it("requires the twenty plugin install to exist", async () => {
    const { deps } = fakeDeps({
      install: null,
      legacy: { id: "legacy-1", url: "https://crm.example.com/mcp" },
      pluginRow: null,
      tokenCount: 2,
    });
    await expect(cutoverTwentyPluginForTenant(actor, deps)).rejects.toThrow(
      /Install the twenty plugin/,
    );
  });

  it("adopts the legacy managed row: tokens invalidated, ownership + component pointer updated, audit emitted", async () => {
    const { deps, calls } = fakeDeps({
      install: { id: "install-1" },
      legacy: { id: "legacy-1", url: "https://crm.example.com/mcp" },
      pluginRow: null,
      tokenCount: 3,
    });

    const result = await cutoverTwentyPluginForTenant(actor, deps);

    expect(result).toMatchObject({
      adopted: true,
      mcpServerId: "legacy-1",
      invalidatedUserTokenCount: 3,
    });
    expect(calls.invalidatedServerIds).toEqual(["legacy-1"]);
    expect(calls.adopted).toHaveLength(1);
    expect(calls.adopted[0]).toMatchObject({
      tenantId: "tenant-1",
      installId: "install-1",
      serverId: "legacy-1",
      serverUrl: "https://crm.example.com/mcp",
    });
    expect(calls.removed).toHaveLength(0);
    expect(calls.audits[0]).toMatchObject({
      eventType: "plugin.cutover",
      actorId: "user-1",
      actorType: "user",
      resourceId: "install-1",
      payload: {
        pluginKey: "twenty",
        mcpServerId: "legacy-1",
        mode: "adopted",
        invalidatedUserTokenCount: 3,
      },
    });
  });

  it("removes the redundant legacy row when the plugin handler already provisioned its own", async () => {
    const { deps, calls } = fakeDeps({
      install: { id: "install-1" },
      legacy: { id: "legacy-1", url: "https://crm.example.com/mcp" },
      pluginRow: { id: "plugin-1", url: "https://crm.example.com/mcp" },
      tokenCount: 1,
    });

    const result = await cutoverTwentyPluginForTenant(actor, deps);

    expect(result).toMatchObject({
      adopted: true,
      mcpServerId: "plugin-1",
      invalidatedUserTokenCount: 1,
    });
    // Tokens invalidated on the LEGACY row (the one users connected to).
    expect(calls.invalidatedServerIds).toEqual(["legacy-1"]);
    expect(calls.adopted).toHaveLength(0);
    expect(calls.removed[0]).toMatchObject({ serverId: "legacy-1" });
    expect(calls.audits[0]).toMatchObject({
      payload: { mode: "legacy_row_removed", mcpServerId: "plugin-1" },
    });
  });

  it("is idempotent: a re-run after adoption reports a no-op and touches nothing", async () => {
    const state: FakeState = {
      install: { id: "install-1" },
      legacy: { id: "legacy-1", url: "https://crm.example.com/mcp" },
      pluginRow: null,
      tokenCount: 2,
    };
    const { deps, calls } = fakeDeps(state);

    const first = await cutoverTwentyPluginForTenant(actor, deps);
    expect(first.adopted).toBe(true);

    const second = await cutoverTwentyPluginForTenant(actor, deps);
    expect(second).toMatchObject({
      adopted: false,
      mcpServerId: "legacy-1",
      invalidatedUserTokenCount: 0,
    });
    expect(second.message).toMatch(/idempotent re-run/);
    // No second invalidation, adoption, removal, or audit.
    expect(calls.invalidatedServerIds).toEqual(["legacy-1"]);
    expect(calls.adopted).toHaveLength(1);
    expect(calls.removed).toHaveLength(0);
    expect(calls.audits).toHaveLength(1);
  });

  it("reports a no-op when no managed Twenty MCP row ever existed", async () => {
    const { deps, calls } = fakeDeps({
      install: { id: "install-1" },
      legacy: null,
      pluginRow: null,
      tokenCount: 0,
    });

    const result = await cutoverTwentyPluginForTenant(actor, deps);
    expect(result).toMatchObject({
      adopted: false,
      mcpServerId: null,
      invalidatedUserTokenCount: 0,
    });
    expect(calls.audits).toHaveLength(0);
  });

  it("adopts under the plugin handler's canonical slug so re-provision converges", () => {
    expect(TWENTY_PLUGIN_MCP_SLUG).toBe("twenty--crm");
  });
});
