/**
 * Plugin engine state-machine tests (plan 2026-06-12-001 U5).
 *
 * Runs the engine against the in-memory store fake + recording handler
 * fakes — no DB, no AWS. Covers: install happy path, infra rejection,
 * idempotent concurrency, staleness re-drive, partial failure + retry,
 * upgrade diff (add/remove/change), the scope/auth-domain re-auth rule,
 * uninstall teardown ordering, and read-time reconciliation.
 */

import { describe, expect, it, vi } from "vitest";
import { GraphQLError } from "graphql";
import type { PluginVersion } from "@thinkwork/plugin-catalog";
import {
  authDomainChanged,
  computeInstallStateFromComponents,
  installPlugin,
  reconcileInstallStatus,
  retryPluginComponent,
  STALE_INSTALLING_THRESHOLD_MS,
  uninstallPlugin,
  upgradePlugin,
  type PluginEngineDeps,
  type PluginVersionResolution,
} from "./engine.js";
import {
  createInMemoryPluginEngineStore,
  type InMemoryPluginEngineStore,
} from "./testing.js";

const TENANT = "tenant-1";
const ACTOR = { actorId: "user-1", actorType: "user" as const };

// ---------------------------------------------------------------------------
// Fixtures — a LastMile-shaped, no-infra manifest version
// ---------------------------------------------------------------------------

function lastmileVersion(
  overrides: Partial<PluginVersion> = {},
): PluginVersion {
  return {
    version: "0.1.0",
    requiredOauthScopes: ["openid", "offline_access"],
    components: [
      {
        type: "mcp-server",
        key: "crm",
        displayName: "CRM",
        endpointUrl: "https://crm.example.invalid/mcp",
        auth: {
          mode: "oauth",
          authDomain: "https://auth.example.invalid",
          resourceIndicator: "https://crm.example.invalid",
        },
      },
      {
        type: "mcp-server",
        key: "tasks",
        displayName: "Tasks",
        endpointUrl: "https://tasks.example.invalid/mcp",
        auth: {
          mode: "oauth",
          authDomain: "https://auth.example.invalid",
          resourceIndicator: "https://tasks.example.invalid",
        },
      },
      {
        type: "skills",
        key: "skills",
        skills: [{ slug: "lastmile--crm-basics", skillMd: "# skill" }],
      },
      {
        type: "ui-surface",
        key: "panel",
        displayName: "Panel",
        intendedMount: "sidebar",
      },
    ],
    ...overrides,
  };
}

function resolution(payload: PluginVersion): PluginVersionResolution {
  return {
    plugin: {
      pluginKey: "lastmile",
      displayName: "LastMile",
      description: "d",
    },
    versionEntry: {
      version: payload.version,
      payloadSha256: `sha-${payload.version}`,
      payload,
    },
  };
}

interface Harness {
  deps: PluginEngineDeps;
  store: InMemoryPluginEngineStore;
  calls: string[];
  deletedSecrets: string[][];
  failSkillsOnce: () => void;
}

function harness(versions: PluginVersion[] = [lastmileVersion()]): Harness {
  const store = createInMemoryPluginEngineStore();
  const calls: string[] = [];
  const deletedSecrets: string[][] = [];
  const byVersion = new Map(versions.map((v) => [v.version, v]));
  const latest = versions[versions.length - 1]!;
  let skillsFailures = 0;

  const deps: PluginEngineDeps = {
    store,
    resolveVersion: async (pluginKey, version) => {
      if (pluginKey !== "lastmile") return null;
      const payload = version ? byVersion.get(version) : latest;
      return payload ? resolution(payload) : null;
    },
    handlers: {
      provisionSkills: async ({ component }) => {
        calls.push(`provision:skills:${component.key}`);
        if (skillsFailures > 0) {
          skillsFailures -= 1;
          throw new Error("seed failed");
        }
        return {
          seededCatalogPrefixes: component.skills.map(
            (skill) => `tenants/t/skill-catalog/${skill.slug}/`,
          ),
          workspaceFolders: component.skills.map(
            (skill) => `skills/${skill.slug}/`,
          ),
          agentSlug: "agent-1",
        };
      },
      teardownSkills: async ({ handlerRef }) => {
        calls.push(`teardown:skills:${JSON.stringify(handlerRef.agentSlug)}`);
      },
      provisionMcp: async ({ component }) => {
        calls.push(`provision:mcp:${component.key}`);
        return { tenantMcpServerId: `server-${component.key}` };
      },
      teardownMcp: async ({ handlerRef }) => {
        calls.push(`teardown:mcp:${String(handlerRef.tenantMcpServerId)}`);
      },
    },
    deleteSecrets: async (refs) => {
      deletedSecrets.push(refs);
      calls.push(`deleteSecrets:${refs.join(",")}`);
    },
  };

  return {
    deps,
    store,
    calls,
    deletedSecrets,
    failSkillsOnce: () => {
      skillsFailures += 1;
    },
  };
}

function installArgs(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT,
    pluginKey: "lastmile",
    idempotencyKey: "idem-1",
    actor: ACTOR,
    ...overrides,
  };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    expect.fail(`expected GraphQLError with code ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(GraphQLError);
    expect((error as GraphQLError).extensions?.code).toBe(code);
  }
}

// ---------------------------------------------------------------------------
// installPlugin
// ---------------------------------------------------------------------------

describe("installPlugin", () => {
  it("installs a no-infra manifest end to end: skills before MCP, ui-surface no-op, state installed", async () => {
    const h = harness();
    const install = await installPlugin(installArgs(), h.deps);

    expect(install.state).toBe("installed");
    expect(install.pinned_version).toBe("0.1.0");
    expect(install.pinned_payload_sha256).toBe("sha-0.1.0");

    // skills runs before any mcp handler
    expect(h.calls).toEqual([
      "provision:skills:skills",
      "provision:mcp:crm",
      "provision:mcp:tasks",
    ]);

    const components = await h.deps.store.listComponents(install.id);
    expect(components).toHaveLength(4);
    expect(components.every((c) => c.state === "provisioned")).toBe(true);
    const mcp = components.find((c) => c.component_key === "crm")!;
    expect(mcp.handler_ref).toEqual({ tenantMcpServerId: "server-crm" });
    const skills = components.find((c) => c.component_key === "skills")!;
    expect(skills.handler_ref).toMatchObject({
      workspaceFolders: ["skills/lastmile--crm-basics/"],
      agentSlug: "agent-1",
    });
    const ui = components.find((c) => c.component_key === "panel")!;
    expect(ui.state).toBe("provisioned");
    expect(ui.handler_ref).toEqual({});

    // plugin.installed emitted transactionally with the transition
    expect(h.store.audits).toHaveLength(1);
    expect(h.store.audits[0]).toMatchObject({
      eventType: "plugin.installed",
      tenantId: TENANT,
      actorId: "user-1",
      payload: {
        pluginKey: "lastmile",
        version: "0.1.0",
        payloadSha256: "sha-0.1.0",
        componentCount: 4,
      },
    });
  });

  it("rejects manifests containing infrastructure components before any component runs", async () => {
    const infraVersion = lastmileVersion({
      components: [
        ...lastmileVersion().components,
        {
          type: "infrastructure",
          key: "infra",
          managedAppKey: "twenty",
          terraformInputs: {},
        },
      ],
    });
    const h = harness([infraVersion]);
    await expectCode(
      installPlugin(installArgs(), h.deps),
      "PLUGIN_INFRASTRUCTURE_UNSUPPORTED",
    );
    expect(h.calls).toEqual([]);
    expect(h.store.installs.size).toBe(0);
  });

  it("throws a structured ALREADY_INSTALLED error for an installed plugin", async () => {
    const h = harness();
    await installPlugin(installArgs(), h.deps);
    await expectCode(installPlugin(installArgs(), h.deps), "ALREADY_INSTALLED");
  });

  it("returns the in-flight install for a concurrent call without re-running handlers", async () => {
    const h = harness();
    const inflight = h.store.seedInstall({
      tenant_id: TENANT,
      plugin_key: "lastmile",
      pinned_version: "0.1.0",
      pinned_payload_sha256: "sha-0.1.0",
      state: "installing",
      last_transition_at: new Date(), // fresh — under the staleness threshold
    });
    const result = await installPlugin(installArgs(), h.deps);
    expect(result.id).toBe(inflight.id);
    expect(h.calls).toEqual([]);
  });

  it("unknown plugin / version produce structured errors", async () => {
    const h = harness();
    await expectCode(
      installPlugin(installArgs({ pluginKey: "nope" }), h.deps),
      "PLUGIN_NOT_FOUND",
    );
    await expectCode(
      installPlugin(installArgs({ version: "9.9.9" }), h.deps),
      "PLUGIN_VERSION_NOT_FOUND",
    );
  });

  it("staleness re-drive: a wedged install (crash after MCP rows written) converges idempotently", async () => {
    const h = harness();
    const stale = new Date(Date.now() - STALE_INSTALLING_THRESHOLD_MS - 1000);
    const wedged = h.store.seedInstall({
      tenant_id: TENANT,
      plugin_key: "lastmile",
      pinned_version: "0.1.0",
      pinned_payload_sha256: "sha-0.1.0",
      state: "installing",
      last_transition_at: stale,
    });
    // Simulated crash: skills + crm got provisioned, tasks + panel never ran.
    h.store.seedComponent({
      plugin_install_id: wedged.id,
      component_key: "skills",
      component_type: "skills",
      state: "provisioned",
      handler_ref: { agentSlug: "agent-1", workspaceFolders: [] },
    });
    h.store.seedComponent({
      plugin_install_id: wedged.id,
      component_key: "crm",
      component_type: "mcp-server",
      state: "provisioned",
      handler_ref: { tenantMcpServerId: "server-crm" },
    });

    const result = await installPlugin(installArgs(), h.deps);
    expect(result.id).toBe(wedged.id);
    expect(result.state).toBe("installed");
    // Only the never-run components were driven — provisioned ones skipped.
    expect(h.calls).toEqual(["provision:mcp:tasks"]);
    const components = await h.deps.store.listComponents(wedged.id);
    expect(components).toHaveLength(4); // missing rows were created
    expect(components.every((c) => c.state === "provisioned")).toBe(true);
    expect(h.store.audits.map((a) => a.eventType)).toEqual([
      "plugin.installed",
    ]);
  });

  it("re-drive fails closed when the catalog digest no longer matches the pin", async () => {
    const h = harness();
    const stale = new Date(Date.now() - STALE_INSTALLING_THRESHOLD_MS - 1000);
    h.store.seedInstall({
      tenant_id: TENANT,
      plugin_key: "lastmile",
      pinned_version: "0.1.0",
      pinned_payload_sha256: "sha-TAMPERED",
      state: "installing",
      last_transition_at: stale,
    });
    await expectCode(
      installPlugin(installArgs(), h.deps),
      "PLUGIN_VERSION_DIGEST_MISMATCH",
    );
    expect(h.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Partial failure + retry
// ---------------------------------------------------------------------------

describe("partial failure and retryPluginComponent", () => {
  it("skills failure leaves MCP components pending, install partially_installed; retry completes", async () => {
    const h = harness();
    h.failSkillsOnce();

    const install = await installPlugin(installArgs(), h.deps);
    expect(install.state).toBe("partially_installed");
    const components = await h.deps.store.listComponents(install.id);
    const skills = components.find((c) => c.component_key === "skills")!;
    expect(skills.state).toBe("failed");
    expect(skills.last_error).toContain("seed failed");
    // Sequence aborted: MCP components never ran.
    expect(components.find((c) => c.component_key === "crm")!.state).toBe(
      "pending",
    );
    expect(h.store.audits).toHaveLength(0);

    // Retry re-drives the failed component AND the still-pending remainder.
    const retried = await retryPluginComponent(
      {
        tenantId: TENANT,
        installId: install.id,
        componentKey: "skills",
        actor: ACTOR,
      },
      h.deps,
    );
    expect(retried.state).toBe("installed");
    const after = await h.deps.store.listComponents(install.id);
    expect(after.every((c) => c.state === "provisioned")).toBe(true);
    expect(h.store.audits.map((a) => a.eventType)).toEqual([
      "plugin.installed",
    ]);
  });

  it("retry of a non-failed component is rejected", async () => {
    const h = harness();
    const install = await installPlugin(installArgs(), h.deps);
    await expectCode(
      retryPluginComponent(
        {
          tenantId: TENANT,
          installId: install.id,
          componentKey: "crm",
          actor: ACTOR,
        },
        h.deps,
      ),
      "FAILED_PRECONDITION",
    );
  });

  it("retry of an unknown component is rejected", async () => {
    const h = harness();
    const install = await installPlugin(installArgs(), h.deps);
    await expectCode(
      retryPluginComponent(
        {
          tenantId: TENANT,
          installId: install.id,
          componentKey: "nope",
          actor: ACTOR,
        },
        h.deps,
      ),
      "COMPONENT_NOT_FOUND",
    );
  });
});

// ---------------------------------------------------------------------------
// upgradePlugin
// ---------------------------------------------------------------------------

function v020(extra: Partial<PluginVersion> = {}): PluginVersion {
  const base = lastmileVersion();
  return {
    ...base,
    version: "0.2.0",
    components: [
      ...base.components,
      {
        type: "skills",
        key: "routing-skills",
        skills: [{ slug: "lastmile--routing-basics", skillMd: "# r" }],
      },
    ],
    ...extra,
  };
}

describe("upgradePlugin", () => {
  it("adds the new skill component, leaves unchanged components untouched, keeps activations active when scopes are unchanged", async () => {
    const h = harness([lastmileVersion(), v020()]);
    const install = await installPlugin(
      installArgs({ version: "0.1.0" }),
      h.deps,
    );
    const activation = h.store.seedActivation({
      user_id: "user-2",
      plugin_install_id: install.id,
      granted_scopes: ["openid", "offline_access"],
    });
    h.calls.length = 0;

    const upgraded = await upgradePlugin(
      {
        tenantId: TENANT,
        installId: install.id,
        toVersion: "0.2.0",
        actor: ACTOR,
      },
      h.deps,
    );

    expect(upgraded.state).toBe("installed");
    expect(upgraded.pinned_version).toBe("0.2.0");
    expect(upgraded.pinned_payload_sha256).toBe("sha-0.2.0");
    // Only the ADDED component's handler ran.
    expect(h.calls).toEqual(["provision:skills:routing-skills"]);
    const components = await h.deps.store.listComponents(install.id);
    expect(components).toHaveLength(5);
    expect(h.store.activations.get(activation.id)!.status).toBe("active");
  });

  it("scope broadening flips active activations to needs_reauth without dropping the install", async () => {
    const broadened = v020({
      requiredOauthScopes: ["openid", "offline_access", "crm.write"],
    });
    const h = harness([lastmileVersion(), broadened]);
    const install = await installPlugin(
      installArgs({ version: "0.1.0" }),
      h.deps,
    );
    const active = h.store.seedActivation({
      user_id: "user-2",
      plugin_install_id: install.id,
      granted_scopes: ["openid", "offline_access"],
    });
    const alreadyBroad = h.store.seedActivation({
      user_id: "user-3",
      plugin_install_id: install.id,
      granted_scopes: ["openid", "offline_access", "crm.write"],
    });
    const revoked = h.store.seedActivation({
      user_id: "user-4",
      plugin_install_id: install.id,
      status: "revoked",
      granted_scopes: [],
    });

    const upgraded = await upgradePlugin(
      {
        tenantId: TENANT,
        installId: install.id,
        toVersion: "0.2.0",
        actor: ACTOR,
      },
      h.deps,
    );

    expect(upgraded.state).toBe("installed");
    expect(h.store.activations.get(active.id)!.status).toBe("needs_reauth");
    // Granted scopes already cover the new set — stays active.
    expect(h.store.activations.get(alreadyBroad.id)!.status).toBe("active");
    // Revoked activations are not resurrected or re-flagged.
    expect(h.store.activations.get(revoked.id)!.status).toBe("revoked");
  });

  it("auth-domain change flips activations to needs_reauth even when scopes are covered", async () => {
    const base = lastmileVersion();
    const domainChangedVersion: PluginVersion = {
      ...base,
      version: "0.2.0",
      components: base.components.map((component) =>
        component.type === "mcp-server" && component.key === "crm"
          ? {
              ...component,
              auth: {
                mode: "oauth",
                authDomain: "https://auth2.example.invalid",
                resourceIndicator: "https://crm.example.invalid",
              },
            }
          : component,
      ),
    };
    const h = harness([base, domainChangedVersion]);
    const install = await installPlugin(
      installArgs({ version: "0.1.0" }),
      h.deps,
    );
    const activation = h.store.seedActivation({
      user_id: "user-2",
      plugin_install_id: install.id,
      granted_scopes: ["openid", "offline_access"],
    });

    await upgradePlugin(
      {
        tenantId: TENANT,
        installId: install.id,
        toVersion: "0.2.0",
        actor: ACTOR,
      },
      h.deps,
    );
    expect(h.store.activations.get(activation.id)!.status).toBe("needs_reauth");
  });

  it("removed components are torn down and their rows deleted", async () => {
    const base = lastmileVersion();
    const removedTasks: PluginVersion = {
      ...base,
      version: "0.2.0",
      components: base.components.filter(
        (component) => component.key !== "tasks",
      ),
    };
    const h = harness([base, removedTasks]);
    const install = await installPlugin(
      installArgs({ version: "0.1.0" }),
      h.deps,
    );
    h.calls.length = 0;

    const upgraded = await upgradePlugin(
      {
        tenantId: TENANT,
        installId: install.id,
        toVersion: "0.2.0",
        actor: ACTOR,
      },
      h.deps,
    );

    expect(upgraded.state).toBe("installed");
    expect(h.calls).toContain("teardown:mcp:server-tasks");
    const components = await h.deps.store.listComponents(install.id);
    expect(components.map((c) => c.component_key).sort()).toEqual([
      "crm",
      "panel",
      "skills",
    ]);
  });

  it("only installed/partially_installed installs can upgrade; same-version upgrade rejected", async () => {
    const h = harness([lastmileVersion(), v020()]);
    const wedged = h.store.seedInstall({
      tenant_id: TENANT,
      plugin_key: "lastmile",
      state: "installing",
    });
    await expectCode(
      upgradePlugin(
        {
          tenantId: TENANT,
          installId: wedged.id,
          toVersion: "0.2.0",
          actor: ACTOR,
        },
        h.deps,
      ),
      "FAILED_PRECONDITION",
    );

    const installed = h.store.seedInstall({
      tenant_id: TENANT,
      plugin_key: "lastmile-2",
      pinned_version: "0.2.0",
      state: "installed",
    });
    await expectCode(
      upgradePlugin(
        {
          tenantId: TENANT,
          installId: installed.id,
          toVersion: "0.2.0",
          actor: ACTOR,
        },
        h.deps,
      ),
      "FAILED_PRECONDITION",
    );
  });
});

// ---------------------------------------------------------------------------
// uninstallPlugin
// ---------------------------------------------------------------------------

describe("uninstallPlugin", () => {
  it("tears everything down in order: secrets+tokens → skills → MCP rows → install row, emits plugin.uninstalled", async () => {
    const h = harness();
    const install = await installPlugin(installArgs(), h.deps);
    const activation = h.store.seedActivation({
      user_id: "user-2",
      plugin_install_id: install.id,
    });
    h.store.seedToken({
      activation_id: activation.id,
      resource_indicator: "https://crm.example.invalid",
      secret_ref: "secret/crm",
    });
    h.store.seedToken({
      activation_id: activation.id,
      resource_indicator: "https://tasks.example.invalid",
      secret_ref: "secret/tasks",
    });
    h.calls.length = 0;

    const result = await uninstallPlugin(
      {
        tenantId: TENANT,
        installId: install.id,
        destructiveConfirmation: "lastmile",
        actor: ACTOR,
      },
      h.deps,
    );

    expect(result.state).toBe("uninstalling");
    // Ordering: secrets first, then skills teardown, then MCP teardowns.
    expect(h.calls[0]).toContain("deleteSecrets:");
    expect(h.calls[0]).toContain("secret/crm");
    expect(h.calls[0]).toContain("secret/tasks");
    const skillsIdx = h.calls.findIndex((c) => c.startsWith("teardown:skills"));
    const mcpIdx = h.calls.findIndex((c) => c.startsWith("teardown:mcp"));
    expect(skillsIdx).toBeGreaterThan(-1);
    expect(mcpIdx).toBeGreaterThan(skillsIdx);

    // Nothing orphaned.
    expect(h.store.installs.size).toBe(0);
    expect(h.store.components.size).toBe(0);
    expect(h.store.activations.size).toBe(0);
    expect(h.store.tokens.size).toBe(0);
    expect(h.store.audits.map((a) => a.eventType)).toEqual([
      "plugin.installed",
      "plugin.uninstalled",
    ]);
    expect(h.store.audits[1]).toMatchObject({
      payload: { pluginKey: "lastmile", version: "0.1.0" },
    });
  });

  it("rejects a destructiveConfirmation that does not match the plugin key", async () => {
    const h = harness();
    const install = await installPlugin(installArgs(), h.deps);
    h.calls.length = 0;
    await expectCode(
      uninstallPlugin(
        {
          tenantId: TENANT,
          installId: install.id,
          destructiveConfirmation: "wrong",
          actor: ACTOR,
        },
        h.deps,
      ),
      "DESTRUCTIVE_CONFIRMATION_MISMATCH",
    );
    expect(h.calls).toEqual([]);
    expect(h.store.installs.size).toBe(1);
  });

  it("holds at uninstalling when a teardown fails; re-running the uninstall re-drives", async () => {
    const h = harness();
    const install = await installPlugin(installArgs(), h.deps);
    h.calls.length = 0;

    const teardownMcp = h.deps.handlers.teardownMcp;
    let failures = 1;
    h.deps.handlers.teardownMcp = vi.fn(async (args) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("mcp teardown boom");
      }
      return teardownMcp(args);
    });

    const held = await uninstallPlugin(
      {
        tenantId: TENANT,
        installId: install.id,
        destructiveConfirmation: "lastmile",
        actor: ACTOR,
      },
      h.deps,
    );
    expect(held.state).toBe("uninstalling");
    expect(h.store.installs.size).toBe(1);
    expect(h.store.installs.get(install.id)!.last_error).toContain(
      "mcp teardown boom",
    );
    expect(
      h.store.audits.filter((a) => a.eventType === "plugin.uninstalled"),
    ).toHaveLength(0);

    // Re-drive completes.
    const done = await uninstallPlugin(
      {
        tenantId: TENANT,
        installId: install.id,
        destructiveConfirmation: "lastmile",
        actor: ACTOR,
      },
      h.deps,
    );
    expect(done.state).toBe("uninstalling");
    expect(h.store.installs.size).toBe(0);
    expect(h.store.components.size).toBe(0);
    expect(
      h.store.audits.filter((a) => a.eventType === "plugin.uninstalled"),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Read-time reconciliation + pure helpers
// ---------------------------------------------------------------------------

describe("reconcileInstallStatus", () => {
  it("recomputes the install state from component states (v1 seam)", async () => {
    const h = harness();
    const install = h.store.seedInstall({
      tenant_id: TENANT,
      plugin_key: "lastmile",
      state: "installing",
    });
    h.store.seedComponent({
      plugin_install_id: install.id,
      component_key: "crm",
      component_type: "mcp-server",
      state: "provisioned",
    });
    h.store.seedComponent({
      plugin_install_id: install.id,
      component_key: "skills",
      component_type: "skills",
      state: "provisioned",
    });

    const reconciled = await reconcileInstallStatus(install, h.deps);
    expect(reconciled.state).toBe("installed");
    // Read-time reconciliation never emits compliance events.
    expect(h.store.audits).toHaveLength(0);
  });

  it("leaves uninstalling installs untouched", async () => {
    const h = harness();
    const install = h.store.seedInstall({
      tenant_id: TENANT,
      plugin_key: "lastmile",
      state: "uninstalling",
    });
    const reconciled = await reconcileInstallStatus(install, h.deps);
    expect(reconciled.state).toBe("uninstalling");
  });
});

describe("pure helpers", () => {
  it("computeInstallStateFromComponents prioritizes failed over pending", () => {
    expect(
      computeInstallStateFromComponents([
        { state: "failed" },
        { state: "pending" },
      ]),
    ).toBe("partially_installed");
    expect(
      computeInstallStateFromComponents([
        { state: "pending" },
        { state: "provisioned" },
      ]),
    ).toBe("installing");
    expect(computeInstallStateFromComponents([{ state: "provisioned" }])).toBe(
      "installed",
    );
  });

  it("authDomainChanged detects new domains and tolerates pruned old payloads", () => {
    const base = lastmileVersion();
    expect(authDomainChanged(base, base)).toBe(false);
    expect(authDomainChanged(null, base)).toBe(false);
    const changed: PluginVersion = {
      ...base,
      components: base.components.map((component) =>
        component.type === "mcp-server"
          ? {
              ...component,
              auth: {
                mode: "oauth",
                authDomain: "https://other.example.invalid",
                resourceIndicator: "https://x.example.invalid",
              },
            }
          : component,
      ),
    };
    expect(authDomainChanged(base, changed)).toBe(true);
  });
});
