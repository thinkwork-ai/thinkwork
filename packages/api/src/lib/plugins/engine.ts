/**
 * Plugin engine — install / upgrade / uninstall orchestration
 * (plan 2026-06-12-001 U5).
 *
 * The engine owns orchestration state ONLY (plugin_installs /
 * plugin_components / user_plugin_activations); component handlers
 * reconcile the real runtime rows (tenant_mcp_servers, seeded skill
 * catalog prefixes + workspace folders). v1 supports `mcp-server`,
 * `skills`, and `ui-surface` (recorded no-op) components — manifests
 * containing `infrastructure` components are rejected with a structured
 * error until U11 wires the deployment-job handler.
 *
 * State machine (v1, no infra):
 *
 *   installing → installed            all components provisioned
 *   installing → partially_installed  a component handler failed
 *   installing → installing           staleness re-drive (idempotent)
 *   partially_installed → installing  retryPluginComponent
 *   installed → installing            upgradePlugin (component diff)
 *   * → uninstalling → (row deleted)  uninstallPlugin (sync in v1)
 *
 * Handlers run skills → mcp-server → ui-surface and MUST be idempotent
 * (create-or-repair) so a crash mid-sequence converges on re-drive. A
 * component failure aborts the sequence: later components stay `pending`,
 * the failed one records `last_error`, and the install holds at
 * `partially_installed` with per-component retry — no rollback-all.
 *
 * Read-time reconciliation: `reconcileInstallStatus` recomputes the
 * install state from component states (v1). U11 extends this hook with
 * deployment-job joins for async infrastructure completion.
 *
 * Compliance: `plugin.installed` is emitted transactionally with the
 * transition into `installed`; `plugin.uninstalled` transactionally with
 * the install-row delete (both via the store's audit-coupled writes).
 * Read-time reconciliation never emits.
 */

import { GraphQLError } from "graphql";
import { createHash } from "node:crypto";
import type {
  McpServerComponent,
  PluginComponent,
  PluginVersion,
  SkillsComponent,
} from "@thinkwork/plugin-catalog";
import type { EmitAuditEventInput } from "../compliance/emit.js";
import { getPluginVersion } from "./catalog-source.js";
import {
  provisionPluginMcpComponent,
  teardownPluginMcpComponent,
} from "./handlers/mcp.js";
import {
  provisionPluginSkillsComponent,
  teardownPluginSkillsComponent,
} from "./handlers/skills.js";
import {
  createDrizzlePluginEngineStore,
  type PluginComponentRow,
  type PluginEngineStore,
  type PluginInstallRow,
} from "./store.js";

// ---------------------------------------------------------------------------
// Deps / ports
// ---------------------------------------------------------------------------

/**
 * An install sitting in 'installing' longer than this with no progress is
 * considered wedged (crashed mid-sequence); the install mutation re-enters
 * the handler sequence idempotently instead of returning the stuck row.
 */
export const STALE_INSTALLING_THRESHOLD_MS = 10 * 60 * 1000;

export interface PluginEngineActor {
  /** Canonical caller user id, or "system" for non-user callers. */
  actorId: string;
  actorType: "user" | "system";
}

/**
 * Token-secret deletion port. U6 (app-level OAuth activation) owns the
 * Secrets Manager wiring; the engine deletes the DB rows itself and hands
 * the secret refs to this port. The default implementation only logs —
 * there are no plugin token secrets until U6 mints them.
 */
export type DeleteSecretsPort = (secretRefs: string[]) => Promise<void>;

export const logOnlyDeleteSecrets: DeleteSecretsPort = async (secretRefs) => {
  if (secretRefs.length > 0) {
    console.warn(
      `[plugin-engine] ${secretRefs.length} activation token secret ref(s) ` +
        "scheduled for deletion; Secrets Manager deletion is wired by the " +
        "activation flow (plan U6) — DB rows are removed now.",
    );
  }
};

export interface PluginVersionResolution {
  plugin: { pluginKey: string; displayName: string; description: string };
  versionEntry: {
    version: string;
    payloadSha256: string;
    payload: PluginVersion;
  };
}

export interface PluginEngineDeps {
  store: PluginEngineStore;
  /** Catalog access point — defaults to the verified catalog source. */
  resolveVersion: (
    pluginKey: string,
    version?: string | null,
  ) => Promise<PluginVersionResolution | null>;
  handlers: {
    provisionMcp: (args: {
      tenantId: string;
      pluginInstallId: string;
      pluginKey: string;
      component: McpServerComponent;
    }) => Promise<Record<string, unknown>>;
    teardownMcp: (args: {
      tenantId: string;
      handlerRef: Record<string, unknown>;
    }) => Promise<void>;
    provisionSkills: (args: {
      tenantId: string;
      component: SkillsComponent;
    }) => Promise<Record<string, unknown>>;
    teardownSkills: (args: {
      tenantId: string;
      component: SkillsComponent | null;
      handlerRef: Record<string, unknown>;
    }) => Promise<void>;
  };
  deleteSecrets: DeleteSecretsPort;
  now?: () => Date;
}

export function createDefaultPluginEngineDeps(): PluginEngineDeps {
  return {
    store: createDrizzlePluginEngineStore(),
    resolveVersion: (pluginKey, version) =>
      getPluginVersion(pluginKey, version),
    handlers: {
      provisionMcp: (args) => provisionPluginMcpComponent(args),
      teardownMcp: (args) => teardownPluginMcpComponent(args),
      provisionSkills: (args) => provisionPluginSkillsComponent(args),
      teardownSkills: (args) => teardownPluginSkillsComponent(args),
    },
    deleteSecrets: logOnlyDeleteSecrets,
  };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export function pluginEngineError(code: string, message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code } });
}

// ---------------------------------------------------------------------------
// Manifest helpers
// ---------------------------------------------------------------------------

/** Provision order. Teardown runs the same order (skills before MCP rows). */
const COMPONENT_RUN_ORDER: Record<string, number> = {
  skills: 0,
  "mcp-server": 1,
  "ui-surface": 2,
  infrastructure: 3,
};

function runOrder(componentType: string): number {
  return COMPONENT_RUN_ORDER[componentType] ?? 99;
}

export function assertNoInfrastructureComponents(
  pluginKey: string,
  payload: PluginVersion,
): void {
  const infra = payload.components.filter(
    (component) => component.type === "infrastructure",
  );
  if (infra.length > 0) {
    throw pluginEngineError(
      "PLUGIN_INFRASTRUCTURE_UNSUPPORTED",
      `Plugin ${pluginKey}@${payload.version} declares infrastructure ` +
        `component(s) ${infra.map((c) => c.key).join(", ")}; infrastructure ` +
        "components are not supported until the deployment handler ships (plan U11).",
    );
  }
}

/** Stable content hash of one manifest component (upgrade diff input). */
export function componentContentHash(component: PluginComponent): string {
  return createHash("sha256").update(stableStringify(component)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function findManifestComponent(
  payload: PluginVersion,
  componentKey: string,
): PluginComponent | null {
  return (
    payload.components.find((component) => component.key === componentKey) ??
    null
  );
}

function oauthAuthDomains(payload: PluginVersion): Set<string> {
  const domains = new Set<string>();
  for (const component of payload.components) {
    if (component.type === "mcp-server" && component.auth.mode === "oauth") {
      domains.add(component.auth.authDomain);
    }
  }
  return domains;
}

/**
 * True when the new version's OAuth auth-domain set is not covered by the
 * old version's — an existing app-level grant cannot cover a new domain.
 * Unknowable old payloads (version pruned from the catalog) are treated
 * as unchanged; the scope-subset rule still applies independently.
 */
export function authDomainChanged(
  oldPayload: PluginVersion | null,
  newPayload: PluginVersion,
): boolean {
  if (!oldPayload) return false;
  const oldDomains = oauthAuthDomains(oldPayload);
  for (const domain of oauthAuthDomains(newPayload)) {
    if (!oldDomains.has(domain)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// State computation
// ---------------------------------------------------------------------------

export function computeInstallStateFromComponents(
  components: Pick<PluginComponentRow, "state">[],
): "installed" | "partially_installed" | "installing" {
  if (components.some((component) => component.state === "failed")) {
    return "partially_installed";
  }
  if (components.some((component) => component.state === "pending")) {
    return "installing";
  }
  return "installed";
}

/**
 * Read-time reconciliation seam. v1 recomputes the install state from
 * component states; U11 extends this with deployment-job event joins for
 * async infrastructure completion. Never emits compliance events — those
 * belong to the mutation-driven transitions.
 */
export async function reconcileInstallStatus(
  install: PluginInstallRow,
  deps: PluginEngineDeps = createDefaultPluginEngineDeps(),
): Promise<PluginInstallRow> {
  if (
    install.state !== "installing" &&
    install.state !== "partially_installed" &&
    install.state !== "installed"
  ) {
    return install;
  }
  const components = await deps.store.listComponents(install.id);
  if (components.length === 0) return install;
  const computed = computeInstallStateFromComponents(components);
  if (computed === install.state) return install;
  const updated = await deps.store.updateInstall(install.id, {
    state: computed,
    touchTransition: true,
  });
  return updated ?? install;
}

// ---------------------------------------------------------------------------
// Component handler dispatch
// ---------------------------------------------------------------------------

async function provisionComponent(
  install: PluginInstallRow,
  component: PluginComponent,
  deps: PluginEngineDeps,
): Promise<Record<string, unknown>> {
  switch (component.type) {
    case "skills":
      return deps.handlers.provisionSkills({
        tenantId: install.tenant_id,
        component,
      });
    case "mcp-server":
      return deps.handlers.provisionMcp({
        tenantId: install.tenant_id,
        pluginInstallId: install.id,
        pluginKey: install.plugin_key,
        component,
      });
    case "ui-surface":
      // Declared-only in v1: recorded as a provisioned no-op.
      return {};
    default:
      throw pluginEngineError(
        "PLUGIN_COMPONENT_UNSUPPORTED",
        `Component type ${component.type} has no v1 handler`,
      );
  }
}

async function teardownComponent(
  install: PluginInstallRow,
  row: PluginComponentRow,
  manifestComponent: PluginComponent | null,
  deps: PluginEngineDeps,
): Promise<void> {
  switch (row.component_type) {
    case "skills":
      await deps.handlers.teardownSkills({
        tenantId: install.tenant_id,
        component:
          manifestComponent?.type === "skills" ? manifestComponent : null,
        handlerRef: row.handler_ref ?? {},
      });
      return;
    case "mcp-server":
      await deps.handlers.teardownMcp({
        tenantId: install.tenant_id,
        handlerRef: row.handler_ref ?? {},
      });
      return;
    default:
      return; // ui-surface (and unknown legacy rows): nothing provisioned
  }
}

/**
 * Run handlers over every non-provisioned component row, in order. Aborts
 * on the first failure (later components stay `pending`); the failure is
 * recorded on the component row, never thrown.
 */
async function runComponentSequence(
  install: PluginInstallRow,
  payload: PluginVersion,
  deps: PluginEngineDeps,
): Promise<void> {
  const rows = await deps.store.listComponents(install.id);
  const ordered = [...rows].sort(
    (a, b) => runOrder(a.component_type) - runOrder(b.component_type),
  );
  for (const row of ordered) {
    if (row.state === "provisioned") continue;
    const manifestComponent = findManifestComponent(payload, row.component_key);
    if (!manifestComponent) {
      await deps.store.updateComponent(row.id, {
        state: "failed",
        lastError: `Component ${row.component_key} is not declared by the pinned manifest version ${install.pinned_version}`,
      });
      break;
    }
    try {
      const handlerRef = await provisionComponent(
        install,
        manifestComponent,
        deps,
      );
      await deps.store.updateComponent(row.id, {
        state: "provisioned",
        handlerRef,
        lastError: null,
      });
    } catch (error) {
      await deps.store.updateComponent(row.id, {
        state: "failed",
        lastError: error instanceof Error ? error.message : String(error),
      });
      break;
    }
  }
}

async function ensureComponentRows(
  install: PluginInstallRow,
  payload: PluginVersion,
  deps: PluginEngineDeps,
): Promise<void> {
  const existing = await deps.store.listComponents(install.id);
  const existingKeys = new Set(existing.map((row) => row.component_key));
  for (const component of payload.components) {
    if (existingKeys.has(component.key)) continue;
    await deps.store.createComponent({
      pluginInstallId: install.id,
      componentKey: component.key,
      componentType: component.type,
    });
  }
}

// ---------------------------------------------------------------------------
// Audit payloads
// ---------------------------------------------------------------------------

function installedAudit(
  install: PluginInstallRow,
  actor: PluginEngineActor,
  componentCount: number,
): EmitAuditEventInput {
  return {
    tenantId: install.tenant_id,
    actorId: actor.actorId,
    actorType: actor.actorType,
    eventType: "plugin.installed",
    source: "graphql",
    payload: {
      pluginInstallId: install.id,
      pluginKey: install.plugin_key,
      version: install.pinned_version,
      payloadSha256: install.pinned_payload_sha256,
      componentCount,
    },
    resourceType: "plugin_install",
    resourceId: install.id,
    action: "install",
    outcome: "success",
  };
}

function uninstalledAudit(
  install: PluginInstallRow,
  actor: PluginEngineActor,
): EmitAuditEventInput {
  return {
    tenantId: install.tenant_id,
    actorId: actor.actorId,
    actorType: actor.actorType,
    eventType: "plugin.uninstalled",
    source: "graphql",
    payload: {
      pluginInstallId: install.id,
      pluginKey: install.plugin_key,
      version: install.pinned_version,
    },
    resourceType: "plugin_install",
    resourceId: install.id,
    action: "uninstall",
    outcome: "success",
  };
}

/**
 * Recompute the install state from components and persist the transition.
 * Emits `plugin.installed` transactionally when (and only when) the
 * install transitions INTO `installed`.
 */
async function finalizeInstallState(
  install: PluginInstallRow,
  actor: PluginEngineActor,
  deps: PluginEngineDeps,
): Promise<PluginInstallRow> {
  const components = await deps.store.listComponents(install.id);
  const next = computeInstallStateFromComponents(components);
  if (next === install.state) return install;
  const audit =
    next === "installed"
      ? installedAudit(install, actor, components.length)
      : undefined;
  const updated = await deps.store.updateInstall(
    install.id,
    {
      state: next,
      touchTransition: true,
      ...(next === "installed" ? { lastError: null } : {}),
    },
    audit,
  );
  return updated ?? install;
}

// ---------------------------------------------------------------------------
// Version resolution helpers
// ---------------------------------------------------------------------------

async function resolveRequestedVersion(
  pluginKey: string,
  version: string | null | undefined,
  deps: PluginEngineDeps,
): Promise<PluginVersionResolution> {
  const resolved = await deps.resolveVersion(pluginKey, version ?? null);
  if (!resolved) {
    throw pluginEngineError(
      version ? "PLUGIN_VERSION_NOT_FOUND" : "PLUGIN_NOT_FOUND",
      version
        ? `Plugin ${pluginKey}@${version} is not in the catalog`
        : `Plugin ${pluginKey} is not in the catalog`,
    );
  }
  return resolved;
}

/**
 * Resolve the payload an EXISTING install is pinned to, verifying the
 * catalog still serves the same payload digest (fail closed on drift).
 */
async function resolvePinnedVersion(
  install: PluginInstallRow,
  deps: PluginEngineDeps,
): Promise<PluginVersionResolution> {
  const resolved = await deps.resolveVersion(
    install.plugin_key,
    install.pinned_version,
  );
  if (!resolved) {
    throw pluginEngineError(
      "PLUGIN_VERSION_NOT_FOUND",
      `Pinned version ${install.plugin_key}@${install.pinned_version} is no longer in the catalog`,
    );
  }
  if (resolved.versionEntry.payloadSha256 !== install.pinned_payload_sha256) {
    throw pluginEngineError(
      "PLUGIN_VERSION_DIGEST_MISMATCH",
      `Catalog payload digest for ${install.plugin_key}@${install.pinned_version} no longer matches the install pin`,
    );
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// installPlugin
// ---------------------------------------------------------------------------

export async function installPlugin(
  args: {
    tenantId: string;
    pluginKey: string;
    version?: string | null;
    idempotencyKey: string;
    actor: PluginEngineActor;
  },
  deps: PluginEngineDeps = createDefaultPluginEngineDeps(),
): Promise<PluginInstallRow> {
  const now = deps.now ?? (() => new Date());
  const requested = await resolveRequestedVersion(
    args.pluginKey,
    args.version,
    deps,
  );
  assertNoInfrastructureComponents(
    args.pluginKey,
    requested.versionEntry.payload,
  );

  let install = await deps.store.getInstallByTenantAndKey(
    args.tenantId,
    args.pluginKey,
  );
  let isNewlyCreated = false;

  if (!install) {
    install = await deps.store.createInstall({
      tenantId: args.tenantId,
      pluginKey: args.pluginKey,
      pinnedVersion: requested.versionEntry.version,
      pinnedPayloadSha256: requested.versionEntry.payloadSha256,
      idempotencyKey: args.idempotencyKey,
    });
    if (install) {
      isNewlyCreated = true;
    } else {
      // Lost the UNIQUE(tenant, plugin) race — adopt the winner's row.
      install = await deps.store.getInstallByTenantAndKey(
        args.tenantId,
        args.pluginKey,
      );
      if (!install) {
        throw pluginEngineError(
          "PLUGIN_INSTALL_CONFLICT",
          `Concurrent install of ${args.pluginKey} could not be resolved`,
        );
      }
    }
  }

  // Idempotency guards apply only to a PRE-EXISTING install — the row we
  // just created is ours to drive.
  if (!isNewlyCreated) {
    if (install.state === "installed") {
      throw pluginEngineError(
        "ALREADY_INSTALLED",
        `Plugin ${args.pluginKey} is already installed (version ${install.pinned_version})`,
      );
    }
    if (install.state === "uninstalling") {
      throw pluginEngineError(
        "FAILED_PRECONDITION",
        `Plugin ${args.pluginKey} is uninstalling; retry the uninstall or wait for it to finish`,
      );
    }
    if (install.state === "installing") {
      const ageMs =
        now().getTime() - new Date(install.last_transition_at).getTime();
      if (ageMs < STALE_INSTALLING_THRESHOLD_MS) {
        // In-flight: idempotent return, no second handler run.
        return install;
      }
      // Stale: fall through to the idempotent re-drive below.
    }
    // partially_installed / failed: return the row as-is — the admin
    // drives recovery through retryPluginComponent (or uninstall).
    // Re-driving here would mask per-component errors.
    if (install.state === "partially_installed" || install.state === "failed") {
      return install;
    }
  }

  // Fresh install or staleness re-drive: run against the PINNED version
  // (a concurrent caller may have pinned before us; never re-pin here).
  const pinned = await resolvePinnedVersion(install, deps);
  await deps.store.updateInstall(install.id, { touchTransition: true });
  await ensureComponentRows(install, pinned.versionEntry.payload, deps);
  await runComponentSequence(install, pinned.versionEntry.payload, deps);
  return finalizeInstallState(install, args.actor, deps);
}

// ---------------------------------------------------------------------------
// retryPluginComponent
// ---------------------------------------------------------------------------

export async function retryPluginComponent(
  args: {
    tenantId: string;
    installId: string;
    componentKey: string;
    actor: PluginEngineActor;
  },
  deps: PluginEngineDeps = createDefaultPluginEngineDeps(),
): Promise<PluginInstallRow> {
  const install = await deps.store.getInstallById(
    args.tenantId,
    args.installId,
  );
  if (!install) {
    throw pluginEngineError("NOT_FOUND", "Plugin install not found");
  }
  if (install.state === "uninstalling") {
    throw pluginEngineError(
      "FAILED_PRECONDITION",
      "Cannot retry components while the plugin is uninstalling",
    );
  }
  const components = await deps.store.listComponents(install.id);
  const row = components.find(
    (component) => component.component_key === args.componentKey,
  );
  if (!row) {
    throw pluginEngineError(
      "COMPONENT_NOT_FOUND",
      `Component ${args.componentKey} not found on this install`,
    );
  }
  if (row.state !== "failed") {
    throw pluginEngineError(
      "FAILED_PRECONDITION",
      `Component ${args.componentKey} is ${row.state}; only failed components can be retried`,
    );
  }

  const pinned = await resolvePinnedVersion(install, deps);
  const manifestComponent = findManifestComponent(
    pinned.versionEntry.payload,
    row.component_key,
  );
  if (!manifestComponent) {
    // Orphan left by a failed upgrade removal: finish the teardown.
    await teardownComponent(install, row, null, deps);
    await deps.store.deleteComponent(row.id);
    return finalizeInstallState(install, args.actor, deps);
  }
  await deps.store.updateComponent(row.id, {
    state: "pending",
    lastError: null,
  });
  const reDriving =
    (await deps.store.updateInstall(install.id, {
      state: "installing",
      touchTransition: true,
    })) ?? ({ ...install, state: "installing" } as PluginInstallRow);
  await runComponentSequence(reDriving, pinned.versionEntry.payload, deps);
  return finalizeInstallState(reDriving, args.actor, deps);
}

// ---------------------------------------------------------------------------
// upgradePlugin
// ---------------------------------------------------------------------------

export async function upgradePlugin(
  args: {
    tenantId: string;
    installId: string;
    toVersion: string;
    actor: PluginEngineActor;
  },
  deps: PluginEngineDeps = createDefaultPluginEngineDeps(),
): Promise<PluginInstallRow> {
  let install = await deps.store.getInstallById(args.tenantId, args.installId);
  if (!install) {
    throw pluginEngineError("NOT_FOUND", "Plugin install not found");
  }
  if (
    install.state !== "installed" &&
    install.state !== "partially_installed"
  ) {
    throw pluginEngineError(
      "FAILED_PRECONDITION",
      `Plugin must be installed or partially_installed to upgrade (currently ${install.state})`,
    );
  }
  if (args.toVersion === install.pinned_version) {
    throw pluginEngineError(
      "FAILED_PRECONDITION",
      `Plugin is already pinned to version ${args.toVersion}`,
    );
  }

  const next = await resolveRequestedVersion(
    install.plugin_key,
    args.toVersion,
    deps,
  );
  assertNoInfrastructureComponents(
    install.plugin_key,
    next.versionEntry.payload,
  );

  // Old payload is diff input only — a pruned old version degrades to
  // "treat every surviving component as changed".
  const previous = await deps.resolveVersion(
    install.plugin_key,
    install.pinned_version,
  );
  const oldPayload = previous?.versionEntry.payload ?? null;
  const newPayload = next.versionEntry.payload;

  // Pin the new version before touching components so a crash re-drives
  // against the new manifest, never half-old/half-new.
  install =
    (await deps.store.updateInstall(install.id, {
      state: "installing",
      pinnedVersion: next.versionEntry.version,
      pinnedPayloadSha256: next.versionEntry.payloadSha256,
      touchTransition: true,
    })) ?? install;

  const rows = await deps.store.listComponents(install.id);
  const newByKey = new Map(
    newPayload.components.map((component) => [component.key, component]),
  );

  // Removed components: teardown then delete the row.
  for (const row of rows) {
    if (newByKey.has(row.component_key)) continue;
    const oldComponent = oldPayload
      ? findManifestComponent(oldPayload, row.component_key)
      : null;
    try {
      await teardownComponent(install, row, oldComponent, deps);
      await deps.store.deleteComponent(row.id);
    } catch (error) {
      await deps.store.updateComponent(row.id, {
        state: "failed",
        lastError: `Teardown failed during upgrade: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }

  // Added components: create rows. Changed components: flip to pending so
  // the sequence re-runs the (idempotent) handler.
  const rowsByKey = new Map(rows.map((row) => [row.component_key, row]));
  for (const component of newPayload.components) {
    const row = rowsByKey.get(component.key);
    if (!row) {
      await deps.store.createComponent({
        pluginInstallId: install.id,
        componentKey: component.key,
        componentType: component.type,
      });
      continue;
    }
    const oldComponent = oldPayload
      ? findManifestComponent(oldPayload, component.key)
      : null;
    const changed =
      !oldComponent ||
      componentContentHash(oldComponent) !== componentContentHash(component);
    if (changed || row.state !== "provisioned") {
      await deps.store.updateComponent(row.id, {
        state: "pending",
        lastError: null,
      });
    }
  }

  await runComponentSequence(install, newPayload, deps);

  // Re-auth rule: scope broadening or a new auth domain invalidates
  // existing app-level grants. The engine owns this transition; U6 owns
  // the OAuth flow that resolves it.
  const newScopes = newPayload.requiredOauthScopes;
  const domainChanged = authDomainChanged(oldPayload, newPayload);
  const activations = await deps.store.listActivations(install.id);
  for (const activation of activations) {
    if (activation.status !== "active") continue;
    const granted = new Set(activation.granted_scopes ?? []);
    const scopesCovered = newScopes.every((scope) => granted.has(scope));
    if (domainChanged || !scopesCovered) {
      await deps.store.updateActivationStatus(activation.id, "needs_reauth");
    }
  }

  return finalizeInstallState(install, args.actor, deps);
}

// ---------------------------------------------------------------------------
// uninstallPlugin
// ---------------------------------------------------------------------------

export async function uninstallPlugin(
  args: {
    tenantId: string;
    installId: string;
    destructiveConfirmation: string | null | undefined;
    actor: PluginEngineActor;
  },
  deps: PluginEngineDeps = createDefaultPluginEngineDeps(),
): Promise<PluginInstallRow> {
  let install = await deps.store.getInstallById(args.tenantId, args.installId);
  if (!install) {
    throw pluginEngineError("NOT_FOUND", "Plugin install not found");
  }
  // v1 rule: every uninstall requires the destructive confirmation string
  // to match the plugin key (infra installs additionally route through the
  // deployment approval gate in U11).
  if (args.destructiveConfirmation !== install.plugin_key) {
    throw pluginEngineError(
      "DESTRUCTIVE_CONFIRMATION_MISMATCH",
      `Type the plugin key "${install.plugin_key}" to confirm uninstall`,
    );
  }

  install = (await deps.store.updateInstall(install.id, {
    state: "uninstalling",
    touchTransition: true,
  })) ?? { ...install, state: "uninstalling" };

  // Pinned payload is best-effort context for skills teardown; handler_ref
  // is the authoritative inventory.
  let pinnedPayload: PluginVersion | null = null;
  try {
    const pinned = await deps.resolveVersion(
      install.plugin_key,
      install.pinned_version,
    );
    pinnedPayload = pinned?.versionEntry.payload ?? null;
  } catch {
    pinnedPayload = null;
  }

  // 1. Activations + token rows (secret refs via the injectable port).
  const activations = await deps.store.listActivations(install.id);
  for (const activation of activations) {
    const tokens = await deps.store.listActivationTokens(activation.id);
    const secretRefs = tokens
      .map((token) => token.secret_ref)
      .filter((ref): ref is string => Boolean(ref));
    await deps.deleteSecrets(secretRefs);
    await deps.store.deleteActivationTokens(activation.id);
    await deps.store.deleteActivation(activation.id);
  }

  // 2./3. Components, skills before MCP rows (teardown order).
  const rows = await deps.store.listComponents(install.id);
  const ordered = [...rows].sort(
    (a, b) => runOrder(a.component_type) - runOrder(b.component_type),
  );
  const failures: string[] = [];
  for (const row of ordered) {
    const manifestComponent = pinnedPayload
      ? findManifestComponent(pinnedPayload, row.component_key)
      : null;
    try {
      await teardownComponent(install, row, manifestComponent, deps);
      await deps.store.deleteComponent(row.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${row.component_key}: ${message}`);
      await deps.store.updateComponent(row.id, {
        state: "failed",
        lastError: `Teardown failed: ${message}`,
      });
    }
  }

  if (failures.length > 0) {
    // Hold at 'uninstalling' with the errors recorded; re-running the
    // uninstall mutation re-drives the remaining teardown idempotently.
    const updated = await deps.store.updateInstall(install.id, {
      lastError: `Uninstall incomplete: ${failures.join("; ")}`,
    });
    return updated ?? install;
  }

  // 4. Install row last, with plugin.uninstalled in the same transaction.
  await deps.store.deleteInstall(
    install.id,
    uninstalledAudit(install, args.actor),
  );
  return { ...install, state: "uninstalling" };
}
