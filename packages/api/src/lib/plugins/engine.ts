/**
 * Plugin engine — install / upgrade / uninstall orchestration
 * (plan 2026-06-12-001 U5).
 *
 * The engine owns orchestration state ONLY (plugin_installs /
 * plugin_components / user_plugin_activations); component handlers
 * reconcile the real runtime rows (tenant_mcp_servers, seeded skill
 * catalog prefixes + workspace folders, managed_applications +
 * deployment jobs).
 *
 * State machine:
 *
 *   installing → installed            all components provisioned
 *   installing → awaiting_approval    an infra plan job is in flight
 *   awaiting_approval → installing    job approved (apply running)
 *   awaiting_approval → failed        plan rejected
 *   installing → partially_installed  a component handler/apply failed
 *   installing → installing           staleness re-drive (idempotent)
 *   partially_installed → installing  retryPluginComponent
 *   installed → installing            upgradePlugin (component diff)
 *   * → uninstalling → (row deleted)  uninstallPlugin (async when infra
 *                                     components exist — the destroy job
 *                                     completes via read-time reconcile)
 *
 * Handlers run skills → mcp-server → ui-surface → infrastructure and MUST
 * be idempotent (create-or-repair) so a crash mid-sequence converges on
 * re-drive. A component failure aborts the sequence: later components stay
 * `pending`, the failed one records `last_error`, and the install holds at
 * `partially_installed` with per-component retry — no rollback-all.
 * Infrastructure components are different: their handler returns with the
 * component still IN-FLIGHT (pending, deployment job linked in handler_ref)
 * and the install parks at `awaiting_approval`; the EXISTING deployment
 * approve/reject mutations gate the apply — no new approval surface.
 *
 * Read-time reconciliation: `reconcileInstallStatus` recomputes the
 * install state from component states and joins each infrastructure
 * component's linked deployment job (store port): approved+applying →
 * installing, apply succeeded → provisioned, apply failed → component
 * failed (job error + evidence ref), rejected → component failed +
 * install failed. For `uninstalling` installs it completes the deferred
 * deletion once the destroy job succeeds.
 *
 * Compliance: `plugin.installed` is emitted transactionally with the
 * transition into `installed`; `plugin.uninstalled` transactionally with
 * the install-row delete (both via the store's audit-coupled writes).
 * Read-time reconciliation never emits — with one exception: completing
 * an async uninstall deletes the install row and emits
 * `plugin.uninstalled` (the deferred tail of the uninstall mutation).
 */

import { GraphQLError } from "graphql";
import { createHash } from "node:crypto";
import type {
  InfrastructureComponent,
  McpServerComponent,
  PluginComponent,
  PluginVersion,
  SkillsComponent,
} from "@thinkwork/plugin-catalog";
import type { EmitAuditEventInput } from "../compliance/emit.js";
import { getPluginVersion } from "./catalog-source.js";
import type { PluginDeploymentJobSnapshot } from "./deployment-job-read.js";
import {
  provisionPluginInfraComponent,
  teardownPluginInfraComponent,
} from "./handlers/infra.js";
import {
  provisionPluginMcpComponent,
  teardownPluginMcpComponent,
} from "./handlers/mcp.js";
import {
  provisionPluginSkillsComponent,
  teardownPluginSkillsComponent,
} from "./handlers/skills.js";
import { createSecretsManagerDeleteSecrets } from "./secrets.js";
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
 * Token-secret deletion port. The engine deletes the DB rows itself and
 * hands the secret refs to this port. The default implementation (U6)
 * performs real Secrets Manager deletion of the activation token secrets
 * under thinkwork/{stage}/plugin-tokens/... — see `secrets.ts`.
 */
export type DeleteSecretsPort = (secretRefs: string[]) => Promise<void>;

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
    /**
     * Ensure the managed_applications row + deployment PLAN job (U11).
     * Returns the updated handler_ref; the component stays IN-FLIGHT
     * (pending) — completion is learned by read-time reconciliation.
     */
    provisionInfra: (args: {
      tenantId: string;
      pluginInstallId: string;
      pluginKey: string;
      component: InfrastructureComponent;
      handlerRef: Record<string, unknown>;
      requestedByUserId: string | null;
    }) => Promise<Record<string, unknown>>;
    /**
     * Create (or re-drive) the DESTROY plan job behind the approval gate.
     * `complete: true` means nothing is left to destroy and the engine may
     * delete the component row.
     */
    teardownInfra: (args: {
      tenantId: string;
      pluginInstallId: string;
      componentKey: string;
      handlerRef: Record<string, unknown>;
      requestedByUserId: string | null;
    }) => Promise<{ handlerRef: Record<string, unknown>; complete: boolean }>;
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
      provisionInfra: (args) => provisionPluginInfraComponent(args),
      teardownInfra: (args) => teardownPluginInfraComponent(args),
    },
    deleteSecrets: createSecretsManagerDeleteSecrets(),
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

/**
 * Provision order: skills → mcp-server → ui-surface → infrastructure.
 * Teardown runs the same order (skills before MCP rows, infra destroy
 * jobs last).
 */
const COMPONENT_RUN_ORDER: Record<string, number> = {
  skills: 0,
  "mcp-server": 1,
  "ui-surface": 2,
  infrastructure: 3,
};

function runOrder(componentType: string): number {
  return COMPONENT_RUN_ORDER[componentType] ?? 99;
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

/** Per-infra-component gate derived from the linked deployment job. */
type InfraGate = "awaiting" | "applying" | "rejected";

interface InfraReconcileResult {
  components: PluginComponentRow[];
  gates: Map<string, InfraGate>;
}

function infraJobFailureMessage(job: PluginDeploymentJobSnapshot): string {
  return (
    job.errorMessage ||
    job.latestEvent?.message ||
    `Deployment job ${job.id} ${job.status}`
  );
}

function infraEvidencePatch(
  handlerRef: Record<string, unknown>,
  job: PluginDeploymentJobSnapshot,
): Record<string, unknown> {
  if (!job.evidenceBucket) return handlerRef;
  return {
    ...handlerRef,
    evidence: { bucket: job.evidenceBucket, prefix: job.evidencePrefix },
  };
}

/**
 * Join each infrastructure component's linked deployment job and apply the
 * U11 status mapping:
 *
 *   planning / awaiting_approval → gate 'awaiting'  (install awaiting_approval)
 *   applying                     → gate 'applying'  (install installing)
 *   succeeded                    → component provisioned
 *   failed                       → component failed (job error + evidence ref)
 *   rejected                     → component failed + gate 'rejected'
 *                                  (install failed)
 *
 * DESTROY-mode refs (in-flight teardown during upgrade/uninstall) are
 * skipped — `reconcileUninstall` owns those.
 */
async function reconcileInfraComponents(
  install: PluginInstallRow,
  components: PluginComponentRow[],
  deps: PluginEngineDeps,
): Promise<InfraReconcileResult> {
  const gates = new Map<string, InfraGate>();
  const updated: PluginComponentRow[] = [];

  for (const row of components) {
    if (row.component_type !== "infrastructure") {
      updated.push(row);
      continue;
    }
    const handlerRef = row.handler_ref ?? {};
    const jobId =
      typeof handlerRef.deploymentJobId === "string"
        ? handlerRef.deploymentJobId
        : null;
    if (!jobId) {
      // No job: either provision hasn't run yet, OR this is an
      // adoption-without-deploy row (Fix A: handler_ref.adoptedRunningInfra
      // with no deploymentJobId). Either way there is no deployment job to
      // reconcile — the row keeps the state provision set (provisioned for
      // an adopted running app), never gated, never regressed.
      updated.push(row);
      continue;
    }
    if (handlerRef.operation === "DESTROY") {
      // Removed-in-upgrade teardown in flight: release the row when the
      // destroy job succeeds; surface failures for retry; never gate the
      // install state on a removal.
      const job = await deps.store.getDeploymentJob(install.tenant_id, jobId);
      if (job?.status === "succeeded") {
        await deps.store.deleteComponent(row.id);
        continue;
      }
      if (job && (job.status === "failed" || job.status === "rejected")) {
        const message = `Teardown ${job.status}: ${infraJobFailureMessage(job)}`;
        if (row.state !== "failed" || row.last_error !== message) {
          const failed = await deps.store.updateComponent(row.id, {
            state: "failed",
            handlerRef: infraEvidencePatch(handlerRef, job),
            lastError: message,
          });
          updated.push(failed ?? { ...row, state: "failed" });
          continue;
        }
      }
      updated.push(row);
      continue;
    }
    const job = await deps.store.getDeploymentJob(install.tenant_id, jobId);
    if (!job) {
      const failed = await deps.store.updateComponent(row.id, {
        state: "failed",
        lastError: `Linked deployment job ${jobId} was not found`,
      });
      updated.push(failed ?? { ...row, state: "failed" });
      continue;
    }
    switch (job.status) {
      case "succeeded": {
        if (row.state !== "provisioned") {
          const provisioned = await deps.store.updateComponent(row.id, {
            state: "provisioned",
            handlerRef: infraEvidencePatch(handlerRef, job),
            lastError: null,
          });
          updated.push(provisioned ?? { ...row, state: "provisioned" });
        } else {
          updated.push(row);
        }
        break;
      }
      case "failed":
      case "rejected": {
        const message =
          job.status === "rejected"
            ? `Deployment plan rejected: ${infraJobFailureMessage(job)}`
            : infraJobFailureMessage(job);
        if (row.state !== "failed" || row.last_error !== message) {
          const failed = await deps.store.updateComponent(row.id, {
            state: "failed",
            handlerRef: infraEvidencePatch(handlerRef, job),
            lastError: message,
          });
          updated.push(failed ?? { ...row, state: "failed" });
        } else {
          updated.push(row);
        }
        if (job.status === "rejected") gates.set(row.id, "rejected");
        break;
      }
      case "applying": {
        gates.set(row.id, "applying");
        updated.push(row);
        break;
      }
      default: {
        // planning / awaiting_approval: the approval gate is in front.
        gates.set(row.id, "awaiting");
        updated.push(row);
        break;
      }
    }
  }
  return { components: updated, gates };
}

function computeInstallState(
  components: Pick<PluginComponentRow, "state">[],
  gates: Map<string, InfraGate>,
):
  | "installed"
  | "partially_installed"
  | "installing"
  | "awaiting_approval"
  | "failed" {
  const gateValues = [...gates.values()];
  if (gateValues.includes("rejected")) return "failed";
  if (components.some((component) => component.state === "failed")) {
    return "partially_installed";
  }
  if (gateValues.includes("awaiting")) return "awaiting_approval";
  if (components.some((component) => component.state === "pending")) {
    return "installing";
  }
  return "installed";
}

/**
 * Read-time reconciliation seam. Recomputes the install state from
 * component states joined with each infra component's deployment job;
 * for `uninstalling` installs, completes the deferred deletion once the
 * destroy job succeeds.
 */
export async function reconcileInstallStatus(
  install: PluginInstallRow,
  deps: PluginEngineDeps = createDefaultPluginEngineDeps(),
): Promise<PluginInstallRow> {
  if (install.state === "uninstalling") {
    return reconcileUninstall(install, deps);
  }
  if (
    install.state !== "installing" &&
    install.state !== "awaiting_approval" &&
    install.state !== "partially_installed" &&
    install.state !== "installed" &&
    install.state !== "failed"
  ) {
    return install;
  }
  const components = await deps.store.listComponents(install.id);
  if (components.length === 0) return install;
  const { components: reconciled, gates } = await reconcileInfraComponents(
    install,
    components,
    deps,
  );
  const computed = computeInstallState(reconciled, gates);
  if (computed === install.state) return install;
  const updated = await deps.store.updateInstall(install.id, {
    state: computed,
    touchTransition: true,
  });
  return updated ?? install;
}

const SYSTEM_ACTOR: PluginEngineActor = {
  actorId: "system",
  actorType: "system",
};

/**
 * Deferred tail of an async uninstall: destroy jobs that succeeded release
 * their component rows; once nothing remains, the install row is deleted
 * (emitting plugin.uninstalled). Failed/rejected destroy jobs mark the
 * component failed — re-running the uninstall mutation re-drives them.
 * Never creates jobs (read path).
 */
async function reconcileUninstall(
  install: PluginInstallRow,
  deps: PluginEngineDeps,
): Promise<PluginInstallRow> {
  const components = await deps.store.listComponents(install.id);
  let blocked = false;
  for (const row of components) {
    const handlerRef = row.handler_ref ?? {};
    const jobId =
      typeof handlerRef.deploymentJobId === "string"
        ? handlerRef.deploymentJobId
        : null;
    if (
      row.component_type !== "infrastructure" ||
      handlerRef.operation !== "DESTROY" ||
      !jobId
    ) {
      // Leftover non-infra rows (failed sync teardown) or infra rows whose
      // destroy job hasn't been created — the uninstall mutation re-drives.
      blocked = true;
      continue;
    }
    const job = await deps.store.getDeploymentJob(install.tenant_id, jobId);
    if (!job) {
      blocked = true;
      continue;
    }
    if (job.status === "succeeded") {
      await deps.store.deleteComponent(row.id);
      continue;
    }
    if (job.status === "failed" || job.status === "rejected") {
      const message =
        job.status === "rejected"
          ? `Destroy plan rejected: ${infraJobFailureMessage(job)}`
          : infraJobFailureMessage(job);
      if (row.state !== "failed" || row.last_error !== message) {
        await deps.store.updateComponent(row.id, {
          state: "failed",
          handlerRef: infraEvidencePatch(handlerRef, job),
          lastError: message,
        });
      }
      blocked = true;
      continue;
    }
    blocked = true; // planning / awaiting_approval / applying
  }

  if (!blocked) {
    const remaining = await deps.store.listComponents(install.id);
    if (remaining.length === 0) {
      await deps.store.deleteInstall(
        install.id,
        uninstalledAudit(install, SYSTEM_ACTOR),
      );
    }
  }
  return install;
}

// ---------------------------------------------------------------------------
// Component handler dispatch
// ---------------------------------------------------------------------------

interface ProvisionOutcome {
  handlerRef: Record<string, unknown>;
  /**
   * False for infrastructure components: the deployment job is in flight
   * and the component stays `pending` until reconciliation sees the apply
   * succeed.
   */
  provisioned: boolean;
}

async function provisionComponent(
  install: PluginInstallRow,
  row: PluginComponentRow,
  component: PluginComponent,
  actor: PluginEngineActor,
  deps: PluginEngineDeps,
): Promise<ProvisionOutcome> {
  switch (component.type) {
    case "skills":
      return {
        handlerRef: await deps.handlers.provisionSkills({
          tenantId: install.tenant_id,
          component,
        }),
        provisioned: true,
      };
    case "mcp-server":
      return {
        handlerRef: await deps.handlers.provisionMcp({
          tenantId: install.tenant_id,
          pluginInstallId: install.id,
          pluginKey: install.plugin_key,
          component,
        }),
        provisioned: true,
      };
    case "infrastructure": {
      const infraRef = await deps.handlers.provisionInfra({
        tenantId: install.tenant_id,
        pluginInstallId: install.id,
        pluginKey: install.plugin_key,
        component,
        handlerRef: row.handler_ref ?? {},
        requestedByUserId: requestedByUserIdFor(actor),
      });
      // Adoption-without-deploy (Fix A): adopting an already-running managed
      // app wires the component up WITHOUT a deployment job — there is no
      // Terraform for the plugin to re-provision and no approval gate. Mark
      // it provisioned directly so the install computes to `installed`.
      const adoptedRunningInfra =
        infraRef.adoptedRunningInfra === true && !infraRef.deploymentJobId;
      return { handlerRef: infraRef, provisioned: adoptedRunningInfra };
    }
    case "ui-surface":
      // Declared-only in v1: recorded as a provisioned no-op.
      return { handlerRef: {}, provisioned: true };
    default:
      throw pluginEngineError(
        "PLUGIN_COMPONENT_UNSUPPORTED",
        `Component type ${(component as PluginComponent).type} has no handler`,
      );
  }
}

function requestedByUserIdFor(actor: PluginEngineActor): string | null {
  return actor.actorType === "user" ? actor.actorId : null;
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
 * Tear down ONE component row and delete it when teardown completed.
 * Infrastructure rows are async: their DESTROY plan job goes through the
 * approval gate, the handler_ref is updated to point at it, and the row
 * survives (`in_flight`) until reconciliation sees the job succeed.
 */
async function removeComponentRow(
  install: PluginInstallRow,
  row: PluginComponentRow,
  manifestComponent: PluginComponent | null,
  actor: PluginEngineActor,
  deps: PluginEngineDeps,
): Promise<"deleted" | "in_flight"> {
  if (row.component_type === "infrastructure") {
    const result = await deps.handlers.teardownInfra({
      tenantId: install.tenant_id,
      pluginInstallId: install.id,
      componentKey: row.component_key,
      handlerRef: row.handler_ref ?? {},
      requestedByUserId: requestedByUserIdFor(actor),
    });
    if (result.complete) {
      await deps.store.deleteComponent(row.id);
      return "deleted";
    }
    await deps.store.updateComponent(row.id, {
      handlerRef: result.handlerRef,
      lastError: null,
    });
    return "in_flight";
  }
  await teardownComponent(install, row, manifestComponent, deps);
  await deps.store.deleteComponent(row.id);
  return "deleted";
}

/**
 * Run handlers over every non-provisioned component row, in order
 * (skills → mcp-server → ui-surface → infrastructure). Aborts on the
 * first failure (later components stay `pending`); the failure is
 * recorded on the component row, never thrown. Infrastructure handlers
 * return with the row still `pending` (job in flight) — that is not a
 * failure and does not abort.
 */
async function runComponentSequence(
  install: PluginInstallRow,
  payload: PluginVersion,
  actor: PluginEngineActor,
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
      if (
        row.component_type === "infrastructure" &&
        (row.handler_ref ?? {}).operation === "DESTROY"
      ) {
        // Removed-in-upgrade infra row with its destroy job in flight —
        // reconciliation releases it when the job succeeds.
        continue;
      }
      await deps.store.updateComponent(row.id, {
        state: "failed",
        lastError: `Component ${row.component_key} is not declared by the pinned manifest version ${install.pinned_version}`,
      });
      break;
    }
    try {
      const outcome = await provisionComponent(
        install,
        row,
        manifestComponent,
        actor,
        deps,
      );
      await deps.store.updateComponent(row.id, {
        ...(outcome.provisioned ? { state: "provisioned" as const } : {}),
        handlerRef: outcome.handlerRef,
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
 * Recompute the install state from components (joining infra deployment
 * jobs) and persist the transition. Emits `plugin.installed`
 * transactionally when (and only when) the install transitions INTO
 * `installed`.
 */
async function finalizeInstallState(
  install: PluginInstallRow,
  actor: PluginEngineActor,
  deps: PluginEngineDeps,
): Promise<PluginInstallRow> {
  const listed = await deps.store.listComponents(install.id);
  const { components, gates } = await reconcileInfraComponents(
    install,
    listed,
    deps,
  );
  const next = computeInstallState(components, gates);
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
    if (install.state === "awaiting_approval") {
      // Infra plan job in flight — nothing to drive; reconcile picks up
      // approval/rejection transitions on this read.
      return reconcileInstallStatus(install, deps);
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
  await runComponentSequence(
    install,
    pinned.versionEntry.payload,
    args.actor,
    deps,
  );
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
    await removeComponentRow(install, row, null, args.actor, deps);
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
  await runComponentSequence(
    reDriving,
    pinned.versionEntry.payload,
    args.actor,
    deps,
  );
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

  // Removed components: teardown then delete the row. Infra removals are
  // async — the row survives with its DESTROY job in flight and is
  // released by read-time reconciliation when the job succeeds.
  for (const row of rows) {
    if (newByKey.has(row.component_key)) continue;
    const oldComponent = oldPayload
      ? findManifestComponent(oldPayload, row.component_key)
      : null;
    try {
      await removeComponentRow(install, row, oldComponent, args.actor, deps);
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

  await runComponentSequence(install, newPayload, args.actor, deps);

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

  // 2./3. Components, skills before MCP rows, infra destroy jobs last
  // (teardown order). Infra teardown is ASYNC: the DESTROY plan job goes
  // through the existing approval gate, the component row survives with
  // the job linked, and read-time reconciliation deletes the rows (and
  // the install) once the job succeeds. Re-running uninstall re-drives.
  const rows = await deps.store.listComponents(install.id);
  const ordered = [...rows].sort(
    (a, b) => runOrder(a.component_type) - runOrder(b.component_type),
  );
  const failures: string[] = [];
  let infraInFlight = false;
  for (const row of ordered) {
    const manifestComponent = pinnedPayload
      ? findManifestComponent(pinnedPayload, row.component_key)
      : null;
    try {
      const outcome = await removeComponentRow(
        install,
        row,
        manifestComponent,
        args.actor,
        deps,
      );
      if (outcome === "in_flight") infraInFlight = true;
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

  if (infraInFlight) {
    // Destroy job(s) pending approval/apply — hold at 'uninstalling';
    // reconcileInstallStatus completes the deletion when they succeed.
    const updated = await deps.store.updateInstall(install.id, {
      lastError: null,
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
