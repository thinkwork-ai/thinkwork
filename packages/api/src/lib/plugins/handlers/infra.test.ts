/**
 * Plugin infrastructure component handler tests (plan 2026-06-12-001 U11).
 *
 * Pure unit tests against injected deps — no DB, no AWS, no Step
 * Functions. The deps fake mirrors the shared plan-job core's contract:
 * `startPlanJob` dedupes on idempotency key and ensure-creates the
 * managed_applications row.
 */

import { describe, expect, it } from "vitest";
import type { InfrastructureComponent } from "@thinkwork/plugin-catalog";
import type { PluginDeploymentJobSnapshot } from "../deployment-job-read.js";
import {
  infraComponentHash,
  provisionPluginInfraComponent,
  teardownPluginInfraComponent,
  type InfraHandlerDeps,
} from "./infra.js";

const TENANT = "tenant-1";

function component(
  overrides: Partial<InfrastructureComponent> = {},
): InfrastructureComponent {
  return {
    type: "infrastructure",
    key: "infra",
    managedAppKey: "twenty",
    terraformInputs: {
      app_password: { description: "Twenty admin password", type: "string" },
    },
    ...overrides,
  };
}

interface FakeDeps extends InfraHandlerDeps {
  managedApps: Map<
    string,
    { id: string; desiredConfig: Record<string, unknown> }
  >;
  jobs: Map<string, PluginDeploymentJobSnapshot & { idempotencyKey: string }>;
  startCalls: Array<{
    appKey: string;
    operation: string;
    idempotencyKey: string;
    desiredConfig: Record<string, unknown>;
    requestedByUserId: string | null;
  }>;
  setJobStatus(jobId: string, status: string, errorMessage?: string): void;
}

function fakeDeps(): FakeDeps {
  const managedApps = new Map<
    string,
    { id: string; desiredConfig: Record<string, unknown> }
  >();
  const jobs = new Map<
    string,
    PluginDeploymentJobSnapshot & { idempotencyKey: string }
  >();
  const startCalls: FakeDeps["startCalls"] = [];
  let counter = 0;

  return {
    managedApps,
    jobs,
    startCalls,
    setJobStatus(jobId, status, errorMessage) {
      const job = jobs.get(jobId)!;
      jobs.set(jobId, { ...job, status, errorMessage: errorMessage ?? null });
    },
    async getManagedApplication(tenantId, key) {
      return managedApps.get(`${tenantId}:${key}`) ?? null;
    },
    async getDeploymentJob(_tenantId, jobId) {
      const job = jobs.get(jobId);
      if (!job) return null;
      const { idempotencyKey: _ignored, ...snapshot } = job;
      return { ...snapshot };
    },
    async startPlanJob(args) {
      startCalls.push({
        appKey: args.appKey,
        operation: args.operation,
        idempotencyKey: args.idempotencyKey,
        desiredConfig: args.desiredConfig,
        requestedByUserId: args.requestedByUserId,
      });
      // Idempotency dedupe, like the real core.
      const existing = [...jobs.values()].find(
        (job) => job.idempotencyKey === args.idempotencyKey,
      );
      if (existing) {
        return {
          id: existing.id,
          status: existing.status,
          applicationId: existing.applicationId,
          errorMessage: existing.errorMessage,
        };
      }
      // ensureManagedApplication semantics: create-or-update the row.
      const appsKey = `${TENANT}:${args.appKey}`;
      const app = managedApps.get(appsKey) ?? {
        id: `app-${args.appKey}`,
        desiredConfig: args.desiredConfig,
      };
      managedApps.set(appsKey, { ...app, desiredConfig: args.desiredConfig });
      counter += 1;
      const id = `job-${counter}`;
      jobs.set(id, {
        id,
        status: "planning",
        operation: args.operation,
        appKey: args.appKey,
        applicationId: app.id,
        errorMessage: null,
        evidenceBucket: "evidence",
        evidencePrefix: `${TENANT}/${args.appKey}/${id}/plan`,
        latestEvent: null,
        idempotencyKey: args.idempotencyKey,
      });
      return {
        id,
        status: "planning",
        applicationId: app.id,
        errorMessage: null,
      };
    },
  };
}

function provisionArgs(
  deps: FakeDeps,
  handlerRef: Record<string, unknown> = {},
) {
  return {
    tenantId: TENANT,
    pluginInstallId: "install-1",
    pluginKey: "twenty",
    component: component(),
    handlerRef,
    requestedByUserId: "user-1",
    deps,
  };
}

describe("provisionPluginInfraComponent", () => {
  it("creates an ENABLE plan job + managed_applications row and records the handler_ref", async () => {
    const deps = fakeDeps();
    const ref = await provisionPluginInfraComponent(provisionArgs(deps));

    expect(deps.startCalls).toHaveLength(1);
    expect(deps.startCalls[0]).toMatchObject({
      appKey: "twenty",
      operation: "ENABLE",
      idempotencyKey: "plugin:install-1:infra:enable:1",
      desiredConfig: {},
      requestedByUserId: "user-1",
    });
    expect(deps.managedApps.has(`${TENANT}:twenty`)).toBe(true);
    expect(ref).toMatchObject({
      managedAppKey: "twenty",
      managedApplicationId: "app-twenty",
      deploymentJobId: "job-1",
      operation: "ENABLE",
      attempt: 1,
      adoptedExisting: false,
    });
    expect(ref.componentHash).toBe(infraComponentHash(component()));
  });

  it("idempotent re-run reuses the in-flight job without creating a second one", async () => {
    const deps = fakeDeps();
    const ref = await provisionPluginInfraComponent(provisionArgs(deps));
    deps.setJobStatus("job-1", "awaiting_approval");

    const again = await provisionPluginInfraComponent(provisionArgs(deps, ref));
    expect(again.deploymentJobId).toBe("job-1");
    expect(again.attempt).toBe(1);
    expect(deps.startCalls).toHaveLength(1); // no second creation
  });

  it("a failed prior job drives a FRESH job with a bumped attempt, keeping the original operation", async () => {
    const deps = fakeDeps();
    const ref = await provisionPluginInfraComponent(provisionArgs(deps));
    deps.setJobStatus("job-1", "failed", "apply exploded");

    const retried = await provisionPluginInfraComponent(
      provisionArgs(deps, ref),
    );
    expect(retried.deploymentJobId).toBe("job-2");
    expect(retried.attempt).toBe(2);
    expect(retried.operation).toBe("ENABLE");
    expect(deps.startCalls[1]!.idempotencyKey).toBe(
      "plugin:install-1:infra:enable:2",
    );
  });

  it("ADOPTS a pre-existing managed_applications row: UPGRADE operation, desired_config preserved (U10)", async () => {
    const deps = fakeDeps();
    deps.managedApps.set(`${TENANT}:twenty`, {
      id: "app-existing",
      desiredConfig: { appPassword: "keep-me" },
    });

    const ref = await provisionPluginInfraComponent(provisionArgs(deps));
    expect(ref).toMatchObject({
      operation: "UPGRADE",
      adoptedExisting: true,
    });
    expect(deps.startCalls[0]).toMatchObject({
      operation: "UPGRADE",
      desiredConfig: { appPassword: "keep-me" },
    });
  });

  it("changed component content over a succeeded job creates an UPGRADE job instead of reusing", async () => {
    const deps = fakeDeps();
    const ref = await provisionPluginInfraComponent(provisionArgs(deps));
    deps.setJobStatus("job-1", "succeeded");

    const changed = component({
      terraformInputs: {
        app_password: { description: "rotated", type: "string" },
      },
    });
    const upgraded = await provisionPluginInfraComponent({
      ...provisionArgs(deps, ref),
      component: changed,
    });
    expect(upgraded.deploymentJobId).toBe("job-2");
    expect(upgraded.operation).toBe("UPGRADE");
    expect(upgraded.componentHash).toBe(infraComponentHash(changed));
  });

  it("an unchanged component over a succeeded job is reused (re-drive convergence)", async () => {
    const deps = fakeDeps();
    const ref = await provisionPluginInfraComponent(provisionArgs(deps));
    deps.setJobStatus("job-1", "succeeded");

    const again = await provisionPluginInfraComponent(provisionArgs(deps, ref));
    expect(again.deploymentJobId).toBe("job-1");
    expect(deps.startCalls).toHaveLength(1);
  });

  it("rejects an unknown managed-app adapter key", async () => {
    const deps = fakeDeps();
    await expect(
      provisionPluginInfraComponent({
        ...provisionArgs(deps),
        component: component({ managedAppKey: "not-an-adapter" }),
      }),
    ).rejects.toThrow(/unknown managed-app adapter key/);
    expect(deps.startCalls).toHaveLength(0);
  });
});

describe("teardownPluginInfraComponent", () => {
  function teardownArgs(deps: FakeDeps, handlerRef: Record<string, unknown>) {
    return {
      tenantId: TENANT,
      pluginInstallId: "install-1",
      componentKey: "infra",
      handlerRef,
      requestedByUserId: "user-1",
      deps,
    };
  }

  it("a never-provisioned component completes immediately with no job", async () => {
    const deps = fakeDeps();
    const result = await teardownPluginInfraComponent(teardownArgs(deps, {}));
    expect(result.complete).toBe(true);
    expect(deps.startCalls).toHaveLength(0);
  });

  it("a provisioned component creates a DESTROY plan job behind the approval gate", async () => {
    const deps = fakeDeps();
    const ref = await provisionPluginInfraComponent(provisionArgs(deps));
    deps.setJobStatus("job-1", "succeeded");

    const result = await teardownPluginInfraComponent(teardownArgs(deps, ref));
    expect(result.complete).toBe(false);
    expect(result.handlerRef).toMatchObject({
      operation: "DESTROY",
      deploymentJobId: "job-2",
      attempt: 2,
    });
    expect(deps.startCalls[1]).toMatchObject({
      operation: "DESTROY",
      idempotencyKey: "plugin:install-1:infra:destroy:2",
    });
  });

  it("an in-flight destroy job is reused; a succeeded one completes; a failed one re-drives fresh", async () => {
    const deps = fakeDeps();
    const ref = await provisionPluginInfraComponent(provisionArgs(deps));
    deps.setJobStatus("job-1", "succeeded");
    const destroy = await teardownPluginInfraComponent(teardownArgs(deps, ref));

    // In flight (planning) — reuse.
    const inFlight = await teardownPluginInfraComponent(
      teardownArgs(deps, destroy.handlerRef),
    );
    expect(inFlight.complete).toBe(false);
    expect(deps.startCalls).toHaveLength(2);

    // Failed — fresh destroy job.
    deps.setJobStatus("job-2", "failed", "destroy exploded");
    const redriven = await teardownPluginInfraComponent(
      teardownArgs(deps, destroy.handlerRef),
    );
    expect(redriven.complete).toBe(false);
    expect(redriven.handlerRef).toMatchObject({
      deploymentJobId: "job-3",
      attempt: 3,
    });

    // Succeeded — complete.
    deps.setJobStatus("job-3", "succeeded");
    const done = await teardownPluginInfraComponent(
      teardownArgs(deps, redriven.handlerRef),
    );
    expect(done.complete).toBe(true);
  });

  it("completes when the managed_applications row is already gone", async () => {
    const deps = fakeDeps();
    const ref = await provisionPluginInfraComponent(provisionArgs(deps));
    deps.managedApps.delete(`${TENANT}:twenty`);

    const result = await teardownPluginInfraComponent(teardownArgs(deps, ref));
    expect(result.complete).toBe(true);
    expect(deps.startCalls).toHaveLength(1); // only the original provision
  });
});
