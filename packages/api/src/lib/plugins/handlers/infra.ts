/**
 * Plugin infrastructure component handler (plan 2026-06-12-001 U11).
 *
 * Maps a manifest `infrastructure` component onto the EXISTING deployment-
 * job machinery (plan → approve → apply, evidence, smoke) keyed by the
 * managed-app adapter key:
 *
 *   - `provision` creates a deployment PLAN job through the same shared
 *     core the `startManagedApplicationPlan` mutation uses (which also
 *     ensure-creates the `managed_applications` row), records
 *     `{ managedApplicationId, deploymentJobId, operation, attempt }` in
 *     the component handler_ref, and returns with the component still
 *     IN-FLIGHT — the engine parks the install at `awaiting_approval` and
 *     read-time reconciliation learns completion from the job's status.
 *   - Approval stays on the existing approve/reject deployment mutations;
 *     plugin-created jobs are shape-identical, so no new approval surface.
 *   - ADOPTION: when a `managed_applications` row for (tenant,
 *     managedAppKey) already exists, most plugins can attach to the running
 *     app without a job. Company Brain's Cognee substrate is stricter: first
 *     adoption creates an UPGRADE plan against the existing row, preserving
 *     desired_config, so Terraform evidence can prove a no-change adoption
 *     before the component becomes provisioned.
 *   - `teardown` creates a DESTROY plan job behind the same approval gate;
 *     the engine holds the install at `uninstalling` until reconciliation
 *     sees the destroy job succeed.
 *
 * Idempotency: an in-flight (or succeeded) job for the same component
 * content is reused; a failed/rejected job — or changed component content
 * (upgrade) — drives a FRESH job with a bumped attempt counter. Attempted
 * job creation itself dedupes on the deployment-job idempotency key, so
 * concurrent re-drives converge on one job.
 */

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { managedApplications } from "@thinkwork/database-pg/schema";
import {
  managedAppRegistry,
  type ManagedAppKey,
  type ManagedAppOperation,
} from "@thinkwork/deployment-runner/apps/registry";
import type { InfrastructureComponent } from "@thinkwork/plugin-catalog";
import { db as defaultDb } from "../../../graphql/utils.js";
import { startManagedApplicationPlanJob } from "../../deployments/start-plan-job.js";
import {
  readDeploymentJobSnapshot,
  type PluginDeploymentJobSnapshot,
} from "../deployment-job-read.js";

type DbLike = typeof defaultDb;

/** Job statuses that mean "a run of this job is still (or already) good". */
const REUSABLE_JOB_STATUSES = new Set([
  "planning",
  "awaiting_approval",
  "applying",
  "succeeded",
]);

const IN_FLIGHT_JOB_STATUSES = new Set([
  "planning",
  "awaiting_approval",
  "applying",
]);

/** handler_ref shape recorded on `infrastructure` component rows. */
export interface InfraHandlerRef extends Record<string, unknown> {
  managedAppKey: string;
  managedApplicationId: string | null;
  /**
   * Id of the linked deployment job. ABSENT on adoption-without-deploy refs
   * (`adoptedRunningInfra: true`): adopting an already-running managed app
   * wires the component up WITHOUT creating a deployment job.
   */
  deploymentJobId?: string;
  /**
   * ENABLE | UPGRADE | DESTROY — the operation of the linked job — OR the
   * handler-only marker "ADOPT". "ADOPT" is NOT a ManagedAppOperation sent
   * to the runner; it's a handler_ref state marker that pairs with
   * `adoptedRunningInfra: true` and carries no deploymentJobId.
   */
  operation: ManagedAppOperation | "ADOPT";
  /** Monotonic per-component job counter (fresh job ⇒ attempt + 1). */
  attempt: number;
  /** Content hash of the manifest component the linked job was created for. */
  componentHash: string;
  /** True when provision attached to a pre-existing managed_applications row. */
  adoptedExisting: boolean;
  /**
   * True for Company Brain's first Cognee adoption job. The job uses UPGRADE
   * machinery but semantically exists to prove safe/no-change adoption before
   * plugin ownership becomes active.
   */
  adoptionRequiresNoChange?: boolean;
  /**
   * True when provision adopted an ALREADY-running managed app without a
   * deployment job (first-time adoption, unchanged content). Such a
   * component is treated as `provisioned` directly — its Terraform is not
   * plugin-owned, so there is nothing to re-provision and no approval gate.
   */
  adoptedRunningInfra?: boolean;
}

export interface InfraManagedApplicationSnapshot {
  id: string;
  desiredConfig: Record<string, unknown>;
  /** Operator-selected release the managed app is pinned to, if any. */
  selectedReleaseVersion: string | null;
  selectedManifestDigest: string | null;
}

export interface InfraStartPlanJobResult {
  id: string;
  status: string;
  applicationId: string | null;
  errorMessage: string | null;
}

export interface InfraHandlerDeps {
  getManagedApplication(
    tenantId: string,
    key: string,
  ): Promise<InfraManagedApplicationSnapshot | null>;
  getDeploymentJob(
    tenantId: string,
    jobId: string,
  ): Promise<PluginDeploymentJobSnapshot | null>;
  startPlanJob(args: {
    tenantId: string;
    requestedByUserId: string | null;
    appKey: ManagedAppKey;
    operation: ManagedAppOperation;
    idempotencyKey: string;
    desiredConfig: Record<string, unknown>;
    releaseVersion?: string | null;
    manifestDigest?: string | null;
  }): Promise<InfraStartPlanJobResult>;
}

export function createDefaultInfraHandlerDeps(
  db: DbLike = defaultDb,
): InfraHandlerDeps {
  return {
    async getManagedApplication(tenantId, key) {
      const [row] = await db
        .select()
        .from(managedApplications)
        .where(
          and(
            eq(managedApplications.tenant_id, tenantId),
            eq(managedApplications.key, key),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        id: row.id,
        desiredConfig: (row.desired_config ?? {}) as Record<string, unknown>,
        selectedReleaseVersion: row.selected_release_version ?? null,
        selectedManifestDigest: row.selected_manifest_digest ?? null,
      };
    },
    getDeploymentJob: (tenantId, jobId) =>
      readDeploymentJobSnapshot(tenantId, jobId, db),
    async startPlanJob(args) {
      const { job } = await startManagedApplicationPlanJob(args);
      return {
        id: job.id,
        status: job.status,
        applicationId: job.application_id,
        errorMessage: job.error_message,
      };
    },
  };
}

export function assertManagedAppKey(value: string): ManagedAppKey {
  const adapter = managedAppRegistry.find(
    (candidate) => candidate.appKey === value,
  );
  if (!adapter) {
    throw new Error(
      `Infrastructure component references unknown managed-app adapter key "${value}"`,
    );
  }
  return adapter.appKey;
}

/** Stable content hash of the manifest component (job-reuse input). */
export function infraComponentHash(component: InfrastructureComponent): string {
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

function parseHandlerRef(
  handlerRef: Record<string, unknown>,
): Partial<InfraHandlerRef> {
  return {
    managedAppKey:
      typeof handlerRef.managedAppKey === "string"
        ? handlerRef.managedAppKey
        : undefined,
    managedApplicationId:
      typeof handlerRef.managedApplicationId === "string"
        ? handlerRef.managedApplicationId
        : undefined,
    deploymentJobId:
      typeof handlerRef.deploymentJobId === "string"
        ? handlerRef.deploymentJobId
        : undefined,
    operation:
      typeof handlerRef.operation === "string"
        ? (handlerRef.operation as ManagedAppOperation | "ADOPT")
        : undefined,
    attempt:
      typeof handlerRef.attempt === "number" ? handlerRef.attempt : undefined,
    componentHash:
      typeof handlerRef.componentHash === "string"
        ? handlerRef.componentHash
        : undefined,
    adoptedExisting: handlerRef.adoptedExisting === true,
    adoptionRequiresNoChange: handlerRef.adoptionRequiresNoChange === true,
    adoptedRunningInfra: handlerRef.adoptedRunningInfra === true,
  };
}

function planJobIdempotencyKey(args: {
  pluginInstallId: string;
  componentKey: string;
  operation: string;
  attempt: number;
}): string {
  return [
    "plugin",
    args.pluginInstallId,
    args.componentKey,
    args.operation.toLowerCase(),
    String(args.attempt),
  ].join(":");
}

function requiresPlanBackedAdoption(args: {
  pluginKey: string;
  appKey: ManagedAppKey;
}): boolean {
  return args.pluginKey === "company-brain" && args.appKey === "cognee";
}

/**
 * Provision (ensure) the infrastructure component: managed_applications row
 * + deployment PLAN job. Returns the updated handler_ref; the component is
 * IN-FLIGHT (not provisioned) until reconciliation sees the apply succeed.
 */
export async function provisionPluginInfraComponent(args: {
  tenantId: string;
  pluginInstallId: string;
  pluginKey: string;
  component: InfrastructureComponent;
  handlerRef: Record<string, unknown>;
  requestedByUserId: string | null;
  deps?: InfraHandlerDeps;
}): Promise<InfraHandlerRef> {
  const deps = args.deps ?? createDefaultInfraHandlerDeps();
  const appKey = assertManagedAppKey(args.component.managedAppKey);
  const componentHash = infraComponentHash(args.component);
  const prior = parseHandlerRef(args.handlerRef);

  // Idempotent re-run of a prior adoption-without-deploy: an adopted
  // running app stays provisioned (no job to reconcile) as long as the
  // component content is unchanged. A content change drops out of this
  // branch and re-evaluates as a genuine upgrade below.
  if (
    prior.adoptedRunningInfra === true &&
    !prior.deploymentJobId &&
    (prior.componentHash === undefined || prior.componentHash === componentHash)
  ) {
    return {
      managedAppKey: appKey,
      managedApplicationId: prior.managedApplicationId ?? null,
      operation: "ADOPT",
      attempt: prior.attempt ?? 1,
      componentHash: prior.componentHash ?? componentHash,
      adoptedExisting: true,
      adoptedRunningInfra: true,
    };
  }

  // Idempotent re-run: reuse the linked job while it is in flight (or has
  // already succeeded) for the SAME component content.
  if (prior.deploymentJobId) {
    const job = await deps.getDeploymentJob(
      args.tenantId,
      prior.deploymentJobId,
    );
    if (
      job &&
      REUSABLE_JOB_STATUSES.has(job.status) &&
      job.operation !== "DESTROY" &&
      (prior.componentHash === undefined ||
        prior.componentHash === componentHash)
    ) {
      return {
        managedAppKey: appKey,
        managedApplicationId:
          prior.managedApplicationId ?? job.applicationId ?? null,
        deploymentJobId: job.id,
        operation:
          prior.operation ?? (job.operation as ManagedAppOperation | "ADOPT"),
        attempt: prior.attempt ?? 1,
        componentHash: prior.componentHash ?? componentHash,
        adoptedExisting: prior.adoptedExisting === true,
        adoptionRequiresNoChange: prior.adoptionRequiresNoChange === true,
      };
    }
  }

  const existing = await deps.getManagedApplication(args.tenantId, appKey);
  const contentChanged =
    prior.componentHash !== undefined && prior.componentHash !== componentHash;
  const adoptedExisting =
    prior.adoptedExisting === true ||
    Boolean(existing && !prior.deploymentJobId && !prior.managedApplicationId);

  const planBackedAdoption = requiresPlanBackedAdoption({
    pluginKey: args.pluginKey,
    appKey,
  });

  // ADOPTION-WITHOUT-DEPLOY (Fix A): the managed app is ALREADY deployed and
  // running (greenfield/operator-provisioned — its Terraform is not plugin-
  // owned), this component has never provisioned a job (first-time adoption),
  // and its content is unchanged. Wiring up an already-running app must NOT
  // create a deploy plan job or sit at awaiting_approval. Plugin "installed"
  // means the plugin's components are WIRED UP, not that infra is healthy
  // right now — runtime health stays visible via the deployment-details view.
  // Genuine upgrades (contentChanged), Company Brain/Cognee plan-backed
  // adoption, and net-new provisioning (no existing row) still take the
  // plan-job path below.
  if (
    existing &&
    !contentChanged &&
    !prior.deploymentJobId &&
    !planBackedAdoption
  ) {
    return {
      managedAppKey: appKey,
      managedApplicationId: existing.id,
      operation: "ADOPT",
      attempt: 1,
      componentHash,
      adoptedExisting: true,
      adoptedRunningInfra: true,
    };
  }

  // ENABLE for net-new provisioning (no existing row); UPGRADE when the
  // component content changed (plugin upgrade) against an existing row;
  // retries of a failed job keep their original operation.
  const operation: ManagedAppOperation = contentChanged
    ? "UPGRADE"
    : prior.operation === "ENABLE" || prior.operation === "UPGRADE"
      ? prior.operation
      : existing
        ? "UPGRADE"
        : "ENABLE";

  // Existing/adoption rows carry the operator-selected release. Net-new
  // provisioning intentionally passes null so the shared plan-job core can use
  // the normal configured release defaults and fail closed if they are still
  // unresolved.
  const releaseVersion = existing?.selectedReleaseVersion ?? null;
  const manifestDigest = existing?.selectedManifestDigest ?? null;

  const attempt = (prior.attempt ?? 0) + 1;
  const job = await deps.startPlanJob({
    tenantId: args.tenantId,
    requestedByUserId: args.requestedByUserId,
    appKey,
    operation,
    idempotencyKey: planJobIdempotencyKey({
      pluginInstallId: args.pluginInstallId,
      componentKey: args.component.key,
      operation,
      attempt,
    }),
    // Adoption preserves the existing row's desired_config; fresh installs
    // start from the adapter defaults ({} — the manifest declares input
    // CONTRACTS, not values).
    desiredConfig: existing?.desiredConfig ?? {},
    // Pass the operator-selected release through so the job never falls back
    // to the "unresolved" sentinel (which the Step Function rejects).
    releaseVersion,
    manifestDigest,
  });

  return {
    managedAppKey: appKey,
    managedApplicationId: job.applicationId,
    deploymentJobId: job.id,
    operation,
    attempt,
    componentHash,
    adoptedExisting,
    adoptionRequiresNoChange:
      planBackedAdoption && existing && !contentChanged ? true : undefined,
  };
}

export interface InfraTeardownResult {
  handlerRef: Record<string, unknown>;
  /** True when there is nothing (left) to destroy — the row can be deleted. */
  complete: boolean;
}

/**
 * Tear down the infrastructure component: create (or re-drive) a DESTROY
 * plan job behind the same approval gate. Never deletes plugin rows itself —
 * the engine deletes the component once reconciliation sees the destroy job
 * succeed.
 */
export async function teardownPluginInfraComponent(args: {
  tenantId: string;
  pluginInstallId: string;
  componentKey: string;
  handlerRef: Record<string, unknown>;
  requestedByUserId: string | null;
  deps?: InfraHandlerDeps;
}): Promise<InfraTeardownResult> {
  const deps = args.deps ?? createDefaultInfraHandlerDeps();
  const prior = parseHandlerRef(args.handlerRef);

  // Never provisioned: nothing reached the deployment machinery.
  if (!prior.deploymentJobId && !prior.managedAppKey) {
    return { handlerRef: args.handlerRef, complete: true };
  }
  const appKey = assertManagedAppKey(prior.managedAppKey ?? "");

  // No managed application row left — nothing to destroy.
  const existing = await deps.getManagedApplication(args.tenantId, appKey);
  if (!existing) {
    return { handlerRef: args.handlerRef, complete: true };
  }

  if (prior.operation === "DESTROY" && prior.deploymentJobId) {
    const job = await deps.getDeploymentJob(
      args.tenantId,
      prior.deploymentJobId,
    );
    if (job?.status === "succeeded") {
      return { handlerRef: args.handlerRef, complete: true };
    }
    if (job && IN_FLIGHT_JOB_STATUSES.has(job.status)) {
      // Destroy already pending approval / applying — reuse it.
      return { handlerRef: args.handlerRef, complete: false };
    }
    // failed / rejected / missing: fall through to a fresh DESTROY job.
  }

  const attempt = (prior.attempt ?? 0) + 1;
  const job = await deps.startPlanJob({
    tenantId: args.tenantId,
    requestedByUserId: args.requestedByUserId,
    appKey,
    operation: "DESTROY",
    idempotencyKey: planJobIdempotencyKey({
      pluginInstallId: args.pluginInstallId,
      componentKey: args.componentKey,
      operation: "DESTROY",
      attempt,
    }),
    desiredConfig: existing.desiredConfig,
  });

  return {
    handlerRef: {
      managedAppKey: appKey,
      managedApplicationId: prior.managedApplicationId ?? job.applicationId,
      deploymentJobId: job.id,
      operation: "DESTROY",
      attempt,
      componentHash: prior.componentHash ?? "",
      adoptedExisting: prior.adoptedExisting === true,
      adoptionRequiresNoChange: prior.adoptionRequiresNoChange === true,
    } satisfies InfraHandlerRef,
    complete: false,
  };
}
