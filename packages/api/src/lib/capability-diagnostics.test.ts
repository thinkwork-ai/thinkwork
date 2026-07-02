/**
 * Capability diagnostics taxonomy + plugin-gate exposure (capability-mapping
 * plan U1). The resolver-side emission tests live in
 * `__tests__/resolve-agent-runtime-config.test.ts`; this file covers the
 * shared module and the plugin activation gate's diagnostic projection.
 */

import { describe, expect, it } from "vitest";
import {
  CAPABILITY_DROP_REASONS,
  createCapabilityDiagnostics,
  pluginGateCapabilityDiagnostics,
} from "./capability-diagnostics.js";
import {
  EMPTY_PLUGIN_GATE,
  FAIL_CLOSED_PLUGIN_GATE,
  resolvePluginGate,
  type PluginGateStore,
} from "./plugins/gating.js";

describe("capability diagnostics taxonomy", () => {
  it("enumerates every reason exactly once", () => {
    expect(new Set(CAPABILITY_DROP_REASONS).size).toBe(
      CAPABILITY_DROP_REASONS.length,
    );
    // The R6 taxonomy anchors — renames here break the inspector contract.
    for (const reason of [
      "not_installed",
      "trust_gate",
      "oauth_missing",
      "plugin_activation_missing",
      "blocked_by_policy",
      "allowlist_miss",
      "extension_runner_disabled",
      "resolution_fault",
    ]) {
      expect(CAPABILITY_DROP_REASONS).toContain(reason);
    }
  });

  it("collector accumulates rows in order", () => {
    const collector = createCapabilityDiagnostics();
    collector.add({
      capabilityClass: "skill",
      capabilityId: "a",
      reason: "trust_gate",
    });
    collector.add({
      capabilityClass: "agent_profile",
      capabilityId: "b",
      reason: "profile_disabled",
    });
    expect(collector.drops.map((d) => d.capabilityId)).toEqual(["a", "b"]);
  });
});

describe("pluginGateCapabilityDiagnostics", () => {
  const install = {
    id: "install-1",
    plugin_key: "lastmile",
  } as unknown as Awaited<ReturnType<PluginGateStore["listInstalls"]>>[number];

  function store(overrides?: Partial<PluginGateStore>): PluginGateStore {
    return {
      listInstalls: async () => [install],
      listComponents: async () =>
        [
          {
            component_type: "skills",
            handler_ref: { workspaceFolders: ["skills/lastmile--crm-basics/"] },
          },
        ] as unknown as Awaited<ReturnType<PluginGateStore["listComponents"]>>,
      listActivationsForUser: async () => [],
      ...overrides,
    };
  }

  it("no requester → fail-closed exclusion rows for each blocked plugin skill folder", async () => {
    const gate = await resolvePluginGate(
      { tenantId: "tenant-1", requesterUserId: null },
      { store: store() },
    );
    const rows = pluginGateCapabilityDiagnostics(gate);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.reason === "plugin_activation_missing")).toBe(
      true,
    );
    expect(rows.map((r) => r.capabilityId)).toContain(
      "skills/lastmile--crm-basics/",
    );
  });

  it("gate resolution fault → one plugin_gate_fail_closed row", async () => {
    const gate = await resolvePluginGate(
      { tenantId: "tenant-1", requesterUserId: "user-1" },
      {
        store: store({
          listInstalls: async () => {
            throw new Error("db unavailable");
          },
        }),
      },
    );
    expect(gate).toEqual(FAIL_CLOSED_PLUGIN_GATE);
    const rows = pluginGateCapabilityDiagnostics(gate);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      capabilityClass: "plugin",
      capabilityId: "*",
      reason: "plugin_gate_fail_closed",
    });
  });

  it("active requester with all activations → no rows", async () => {
    const gate = await resolvePluginGate(
      { tenantId: "tenant-1", requesterUserId: "user-1" },
      {
        store: store({
          listActivationsForUser: async () =>
            [
              { plugin_install_id: "install-1", status: "active" },
            ] as unknown as Awaited<
              ReturnType<PluginGateStore["listActivationsForUser"]>
            >,
        }),
      },
    );
    expect(pluginGateCapabilityDiagnostics(gate)).toEqual([]);
  });

  it("empty gate (no installs) → no rows", () => {
    expect(pluginGateCapabilityDiagnostics(EMPTY_PLUGIN_GATE)).toEqual([]);
  });
});
