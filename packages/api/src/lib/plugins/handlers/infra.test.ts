/**
 * Plugin infrastructure component handler tests (plan 2026-06-12-001 U11).
 *
 * Pure unit tests against injected deps — no DB, no AWS, no Step
 * Functions. The deps fake mirrors the shared plan-job core's contract:
 * `startPlanJob` dedupes on idempotency key and ensure-creates the
 * managed_applications row.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { InfrastructureComponent } from "@thinkwork/plugin-catalog";
import type { PluginDeploymentJobSnapshot } from "../deployment-job-read.js";
import {
  infraComponentHash,
  provisionPluginInfraComponent,
  teardownPluginInfraComponent,
  type InfraHandlerDeps,
} from "./infra.js";

const TENANT = "tenant-1";

afterEach(() => {
  vi.unstubAllEnvs();
});

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

interface ManagedAppFake {
  id: string | null;
  desiredConfig: Record<string, unknown>;
  currentStatus?: string | null;
  selectedReleaseVersion: string | null;
  selectedManifestDigest: string | null;
}

interface FakeDeps extends InfraHandlerDeps {
  managedApps: Map<string, ManagedAppFake>;
  jobs: Map<string, PluginDeploymentJobSnapshot & { idempotencyKey: string }>;
  startCalls: Array<{
    appKey: string;
    operation: string;
    idempotencyKey: string;
    desiredConfig: Record<string, unknown>;
    requestedByUserId: string | null;
    releaseVersion?: string | null;
    manifestDigest?: string | null;
  }>;
  setJobStatus(jobId: string, status: string, errorMessage?: string): void;
}

function fakeDeps(): FakeDeps {
  const managedApps = new Map<string, ManagedAppFake>();
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
        releaseVersion: args.releaseVersion ?? null,
        manifestDigest: args.manifestDigest ?? null,
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
        selectedReleaseVersion: args.releaseVersion ?? null,
        selectedManifestDigest: args.manifestDigest ?? null,
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
  overrides: {
    pluginKey?: string;
    component?: InfrastructureComponent;
  } = {},
) {
  return {
    tenantId: TENANT,
    pluginInstallId: "install-1",
    pluginKey: overrides.pluginKey ?? "twenty",
    component: overrides.component ?? component(),
    handlerRef,
    requestedByUserId: "user-1",
    deps,
  };
}

describe("provisionPluginInfraComponent", () => {
  /**
   * Seed a managed_applications row that exists but has NO prior deployment
   * job — the U10/Twenty adoption shape (greenfield-provisioned app the
   * plugin wires up). A CHANGED component over such a row drives a real
   * UPGRADE job; that is the only plugin-driven path that creates a job for
   * an existing app (net-new ENABLE without a row always fails — Fix B).
   */
  function seedExistingApp(deps: FakeDeps): void {
    deps.managedApps.set(`${TENANT}:twenty`, {
      id: "app-twenty",
      desiredConfig: {},
      currentStatus: "enabled",
      selectedReleaseVersion: "v1.2.3",
      selectedManifestDigest: "sha-123",
    });
  }

  /** Drive a real UPGRADE job by adopting then changing the component. */
  async function upgradeJobRef(deps: FakeDeps) {
    seedExistingApp(deps);
    const adopted = await provisionPluginInfraComponent(provisionArgs(deps));
    const changed = component({
      terraformInputs: {
        app_password: { description: "rotated", type: "string" },
      },
    });
    const ref = await provisionPluginInfraComponent({
      ...provisionArgs(deps, adopted),
      component: changed,
    });
    return { ref, changed };
  }

  it("a changed component over an adopted app creates an UPGRADE job + records the handler_ref", async () => {
    const deps = fakeDeps();
    const { ref, changed } = await upgradeJobRef(deps);

    expect(deps.startCalls).toHaveLength(1);
    expect(deps.startCalls[0]).toMatchObject({
      appKey: "twenty",
      operation: "UPGRADE",
      desiredConfig: {},
      requestedByUserId: "user-1",
    });
    expect(deps.managedApps.has(`${TENANT}:twenty`)).toBe(true);
    expect(ref).toMatchObject({
      managedAppKey: "twenty",
      managedApplicationId: "app-twenty",
      deploymentJobId: "job-1",
      operation: "UPGRADE",
      // The adopted ref carried attempt 1; the upgrade job bumps to 2.
      attempt: 2,
    });
    expect(ref.componentHash).toBe(infraComponentHash(changed));
  });

  it("idempotent re-run reuses the in-flight job without creating a second one", async () => {
    const deps = fakeDeps();
    const { ref, changed } = await upgradeJobRef(deps);
    deps.setJobStatus("job-1", "awaiting_approval");

    const again = await provisionPluginInfraComponent({
      ...provisionArgs(deps, ref),
      component: changed,
    });
    expect(again.deploymentJobId).toBe("job-1");
    expect(again.attempt).toBe(2);
    expect(deps.startCalls).toHaveLength(1); // no second creation
  });

  it("a failed prior job drives a FRESH job with a bumped attempt, keeping the original operation", async () => {
    const deps = fakeDeps();
    const { ref, changed } = await upgradeJobRef(deps);
    deps.setJobStatus("job-1", "failed", "apply exploded");

    const retried = await provisionPluginInfraComponent({
      ...provisionArgs(deps, ref),
      component: changed,
    });
    expect(retried.deploymentJobId).toBe("job-2");
    expect(retried.attempt).toBe(3);
    expect(retried.operation).toBe("UPGRADE");
    expect(deps.startCalls[1]!.idempotencyKey).toBe(
      "plugin:install-1:infra:upgrade:3",
    );
  });

  it("ADOPTS an already-running app WITHOUT a deploy job: adoptedRunningInfra marker, no job (Fix A)", async () => {
    const deps = fakeDeps();
    deps.managedApps.set(`${TENANT}:twenty`, {
      id: "app-existing",
      desiredConfig: { appPassword: "keep-me" },
      currentStatus: "enabled",
      selectedReleaseVersion: "v1.2.3",
      selectedManifestDigest: "sha-123",
    });

    const ref = await provisionPluginInfraComponent(provisionArgs(deps));
    // No deploy plan job — the existing app's Terraform is not plugin-owned.
    expect(deps.startCalls).toHaveLength(0);
    expect(ref).toMatchObject({
      managedAppKey: "twenty",
      managedApplicationId: "app-existing",
      operation: "ADOPT",
      attempt: 1,
      adoptedExisting: true,
      adoptedRunningInfra: true,
    });
    expect(ref.deploymentJobId).toBeUndefined();
    expect(ref.componentHash).toBe(infraComponentHash(component()));
  });

  it("does not adopt a managed app row whose runtime status is unknown", async () => {
    const deps = fakeDeps();
    deps.managedApps.set(`${TENANT}:twenty`, {
      id: "app-existing",
      desiredConfig: { appPassword: "keep-me" },
      selectedReleaseVersion: "v1.2.3",
      selectedManifestDigest: "sha-123",
    });

    const ref = await provisionPluginInfraComponent(provisionArgs(deps));

    expect(deps.startCalls).toHaveLength(1);
    expect(deps.startCalls[0]).toMatchObject({
      appKey: "twenty",
      operation: "ENABLE",
      desiredConfig: { appPassword: "keep-me" },
    });
    expect(ref).toMatchObject({
      managedAppKey: "twenty",
      managedApplicationId: "app-existing",
      deploymentJobId: "job-1",
      operation: "ENABLE",
      adoptedExisting: true,
    });
    expect(ref.adoptedRunningInfra).toBeUndefined();
  });

  it("an idempotent re-run of an adopted-running ref stays a no-job ADOPT (Fix A)", async () => {
    const deps = fakeDeps();
    deps.managedApps.set(`${TENANT}:twenty`, {
      id: "app-existing",
      desiredConfig: {},
      currentStatus: "enabled",
      selectedReleaseVersion: "v1.2.3",
      selectedManifestDigest: "sha-123",
    });
    const ref = await provisionPluginInfraComponent(provisionArgs(deps));

    const again = await provisionPluginInfraComponent(provisionArgs(deps, ref));
    expect(deps.startCalls).toHaveLength(0);
    expect(again).toMatchObject({
      operation: "ADOPT",
      adoptedRunningInfra: true,
    });
    expect(again.deploymentJobId).toBeUndefined();
  });

  it("a CHANGED component over an adopted-running app drives a real UPGRADE job (Fix A)", async () => {
    const deps = fakeDeps();
    deps.managedApps.set(`${TENANT}:twenty`, {
      id: "app-existing",
      desiredConfig: { appPassword: "keep-me" },
      currentStatus: "enabled",
      selectedReleaseVersion: "v1.2.3",
      selectedManifestDigest: "sha-123",
    });
    const ref = await provisionPluginInfraComponent(provisionArgs(deps));
    expect(deps.startCalls).toHaveLength(0);

    const changed = component({
      terraformInputs: {
        app_password: { description: "rotated", type: "string" },
      },
    });
    const upgraded = await provisionPluginInfraComponent({
      ...provisionArgs(deps, ref),
      component: changed,
    });
    expect(upgraded.operation).toBe("UPGRADE");
    expect(upgraded.deploymentJobId).toBe("job-1");
    expect(deps.startCalls[0]).toMatchObject({
      operation: "UPGRADE",
      desiredConfig: { appPassword: "keep-me" },
    });
  });

  it("Company Brain adopts existing Cognee through a plan-backed UPGRADE job", async () => {
    const deps = fakeDeps();
    const brainSubstrate = component({
      key: "brain-substrate",
      managedAppKey: "cognee",
      terraformInputs: {
        imageUri: { description: "image", type: "string" },
        dbPasswordSecretArn: { description: "db", type: "string" },
        bedrockModelResourceArns: {
          description: "models",
          type: "list(string)",
        },
      },
    });
    deps.managedApps.set(`${TENANT}:cognee`, {
      id: "app-cognee",
      desiredConfig: {
        imageUri: "repo/cognee@sha256:abc",
        dbPasswordSecretArn: "arn:aws:secretsmanager:db",
        bedrockModelResourceArns: ["arn:aws:bedrock:model"],
      },
      currentStatus: "enabled",
      selectedReleaseVersion: "v1.2.3",
      selectedManifestDigest: "sha-123",
    });

    const ref = await provisionPluginInfraComponent(
      provisionArgs(
        deps,
        {},
        {
          pluginKey: "company-brain",
          component: brainSubstrate,
        },
      ),
    );

    expect(deps.startCalls).toHaveLength(1);
    expect(deps.startCalls[0]).toMatchObject({
      appKey: "cognee",
      operation: "UPGRADE",
      requestedByUserId: "user-1",
      releaseVersion: "v1.2.3",
      manifestDigest: "sha-123",
      desiredConfig: {
        imageUri: "repo/cognee@sha256:abc",
        dbPasswordSecretArn: "arn:aws:secretsmanager:db",
        bedrockModelResourceArns: ["arn:aws:bedrock:model"],
      },
    });
    expect(ref).toMatchObject({
      managedAppKey: "cognee",
      managedApplicationId: "app-cognee",
      deploymentJobId: "job-1",
      operation: "UPGRADE",
      attempt: 1,
      adoptedExisting: true,
      adoptionRequiresNoChange: true,
    });
    expect(ref.adoptedRunningInfra).toBeUndefined();
    expect(ref.componentHash).toBe(infraComponentHash(brainSubstrate));
  });

  it("Plane creates an ENABLE plan when a previous managed app row is disabled", async () => {
    const deps = fakeDeps();
    deps.managedApps.set(`${TENANT}:plane`, {
      id: "app-plane",
      desiredConfig: { publicUrl: "https://plane.example.test" },
      currentStatus: "disabled",
      selectedReleaseVersion: "v1.2.3",
      selectedManifestDigest: "sha-123",
    });

    const planeRuntime = component({
      key: "runtime",
      managedAppKey: "plane",
      terraformInputs: {
        publicUrl: { description: "URL", type: "string" },
      },
    });

    const ref = await provisionPluginInfraComponent(
      provisionArgs(
        deps,
        {},
        {
          pluginKey: "plane",
          component: planeRuntime,
        },
      ),
    );

    expect(deps.startCalls).toHaveLength(1);
    expect(deps.startCalls[0]).toMatchObject({
      appKey: "plane",
      operation: "ENABLE",
      releaseVersion: "v1.2.3",
      manifestDigest: "sha-123",
      desiredConfig: { publicUrl: "https://plane.example.test" },
    });
    expect(ref).toMatchObject({
      managedAppKey: "plane",
      managedApplicationId: "app-plane",
      deploymentJobId: "job-1",
      operation: "ENABLE",
      adoptedExisting: true,
    });
    expect(ref.adoptedRunningInfra).toBeUndefined();
  });

  it("n8n net-new provisioning seeds database, storage, queue, and secret desired-config defaults", async () => {
    vi.stubEnv(
      "THINKWORK_N8N_IMAGE_URI",
      "public.ecr.aws/thinkwork/n8n@sha256:1111111111111111111111111111111111111111111111111111111111111111",
    );
    vi.stubEnv(
      "THINKWORK_N8N_DATABASE_ADMIN_SECRET_ARN",
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-db-admin",
    );
    vi.stubEnv(
      "THINKWORK_N8N_DATABASE_URL_SECRET_ARN",
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-db-url",
    );
    vi.stubEnv(
      "THINKWORK_N8N_ENCRYPTION_KEY_SECRET_ARN",
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-key",
    );
    vi.stubEnv(
      "THINKWORK_N8N_OPERATOR_SECRET_ARN",
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-operator",
    );
    vi.stubEnv(
      "THINKWORK_N8N_SERVICE_CREDENTIAL_SECRET_ARN",
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-service",
    );
    vi.stubEnv(
      "THINKWORK_N8N_AGENT_STEP_BRIDGE_CREDENTIAL_SECRET_ARN",
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-bridge",
    );
    vi.stubEnv("THINKWORK_N8N_STORAGE_BUCKET_NAME", "thinkwork-dev-n8n");
    vi.stubEnv("THINKWORK_N8N_DOMAIN", "apps.example.com");
    vi.stubEnv(
      "THINKWORK_N8N_CERTIFICATE_ARN",
      "arn:aws:acm:us-east-1:123456789012:certificate/n8n",
    );
    vi.stubEnv("THINKWORK_N8N_CUSTOM_PACKAGE_SPECS", "luxon@3.7.2,zod@3.25.76");
    vi.stubEnv(
      "THINKWORK_N8N_PACKAGE_IMAGE_URI",
      "123456789012.dkr.ecr.us-east-1.amazonaws.com/thinkwork/n8n@sha256:2222222222222222222222222222222222222222222222222222222222222222",
    );

    const deps = fakeDeps();
    const n8nRuntime = component({
      key: "runtime",
      managedAppKey: "n8n",
      terraformInputs: {
        publicUrl: { description: "URL", type: "string" },
      },
    });

    const ref = await provisionPluginInfraComponent(
      provisionArgs(
        deps,
        {},
        {
          pluginKey: "n8n",
          component: n8nRuntime,
        },
      ),
    );

    expect(ref).toMatchObject({
      managedAppKey: "n8n",
      deploymentJobId: "job-1",
      operation: "ENABLE",
      adoptedExisting: false,
    });
    expect(deps.startCalls).toHaveLength(1);
    expect(deps.startCalls[0]).toMatchObject({
      appKey: "n8n",
      operation: "ENABLE",
      releaseVersion: null,
      manifestDigest: null,
      desiredConfig: {
        imageUri:
          "public.ecr.aws/thinkwork/n8n@sha256:1111111111111111111111111111111111111111111111111111111111111111",
        databaseAdminSecretArn:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-db-admin",
        databaseUrlSecretArn:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-db-url",
        databaseName: "thinkwork_n8n",
        encryptionKeySecretArn:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-key",
        operatorSecretArn:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-operator",
        serviceCredentialSecretArn:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-service",
        agentStepBridgeCredentialSecretArn:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-bridge",
        storageBucketName: "thinkwork-dev-n8n",
        storagePrefix: "managed-apps/n8n",
        publicUrl: "https://n8n.apps.example.com",
        certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/n8n",
        domain: "apps.example.com",
        mainDesiredCount: 1,
        workerDesiredCount: 1,
        packageImageUri:
          "123456789012.dkr.ecr.us-east-1.amazonaws.com/thinkwork/n8n@sha256:2222222222222222222222222222222222222222222222222222222222222222",
        customPackageSpecs: ["luxon@3.7.2", "zod@3.25.76"],
      },
    });
  });

  it("n8n existing disabled rows preserve operator desired config over defaults", async () => {
    vi.stubEnv("THINKWORK_N8N_DATABASE_NAME", "thinkwork_n8n");
    vi.stubEnv("THINKWORK_N8N_DOMAIN", "apps.example.com");
    vi.stubEnv(
      "THINKWORK_N8N_DATABASE_URL_SECRET_ARN",
      "arn:aws:secretsmanager:us-east-1:123456789012:secret:old-env-db-url",
    );
    const deps = fakeDeps();
    deps.managedApps.set(`${TENANT}:n8n`, {
      id: "app-n8n",
      desiredConfig: {
        publicUrl: "https://automation.example.com",
        workerDesiredCount: 4,
        databaseUrlSecretArn:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:deleted-db-url",
        encryptionKeySecretArn:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:deleted-key",
        operatorSecretArn:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:deleted-operator",
        serviceCredentialSecretArn:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:deleted-service",
        agentStepBridgeCredentialSecretArn:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:deleted-bridge",
      },
      currentStatus: "disabled",
      selectedReleaseVersion: "v1.2.3",
      selectedManifestDigest: "sha-123",
    });
    const n8nRuntime = component({
      key: "runtime",
      managedAppKey: "n8n",
      terraformInputs: {
        publicUrl: { description: "URL", type: "string" },
      },
    });

    await provisionPluginInfraComponent(
      provisionArgs(
        deps,
        {},
        {
          pluginKey: "n8n",
          component: n8nRuntime,
        },
      ),
    );

    expect(deps.startCalls[0]).toMatchObject({
      appKey: "n8n",
      operation: "ENABLE",
      releaseVersion: "v1.2.3",
      manifestDigest: "sha-123",
      desiredConfig: {
        databaseName: "thinkwork_n8n",
        publicUrl: "https://automation.example.com",
        workerDesiredCount: 4,
      },
    });
    expect(deps.startCalls[0].desiredConfig).not.toHaveProperty(
      "databaseUrlSecretArn",
    );
    expect(deps.startCalls[0].desiredConfig).not.toHaveProperty(
      "encryptionKeySecretArn",
    );
    expect(deps.startCalls[0].desiredConfig).not.toHaveProperty(
      "operatorSecretArn",
    );
    expect(deps.startCalls[0].desiredConfig).not.toHaveProperty(
      "serviceCredentialSecretArn",
    );
    expect(deps.startCalls[0].desiredConfig).not.toHaveProperty(
      "agentStepBridgeCredentialSecretArn",
    );
  });

  it("Company Brain adopts existing Cognee directly when release metadata is unresolved", async () => {
    const deps = fakeDeps();
    const brainSubstrate = component({
      key: "brain-substrate",
      managedAppKey: "cognee",
      terraformInputs: {
        imageUri: { description: "image", type: "string" },
      },
    });
    deps.managedApps.set(`${TENANT}:cognee`, {
      id: "app-cognee",
      desiredConfig: { imageUri: "repo/cognee@sha256:abc" },
      currentStatus: "enabled",
      selectedReleaseVersion: "unresolved",
      selectedManifestDigest: "unresolved",
    });

    const ref = await provisionPluginInfraComponent(
      provisionArgs(
        deps,
        {},
        {
          pluginKey: "company-brain",
          component: brainSubstrate,
        },
      ),
    );

    expect(deps.startCalls).toHaveLength(0);
    expect(ref).toMatchObject({
      managedAppKey: "cognee",
      managedApplicationId: "app-cognee",
      operation: "ADOPT",
      attempt: 1,
      adoptedExisting: true,
      adoptedRunningInfra: true,
      adoptionRequiresNoChange: true,
    });
    expect(ref.deploymentJobId).toBeUndefined();
    expect(ref.componentHash).toBe(infraComponentHash(brainSubstrate));
  });

  it("Company Brain adopts env-provisioned Cognee when no managed app row exists", async () => {
    const deps = fakeDeps();
    const brainSubstrate = component({
      key: "brain-substrate",
      managedAppKey: "cognee",
      terraformInputs: {
        imageUri: { description: "image", type: "string" },
      },
    });
    deps.managedApps.set(`${TENANT}:cognee`, {
      id: null,
      desiredConfig: {},
      selectedReleaseVersion: null,
      selectedManifestDigest: null,
    });

    const ref = await provisionPluginInfraComponent(
      provisionArgs(
        deps,
        {},
        {
          pluginKey: "company-brain",
          component: brainSubstrate,
        },
      ),
    );

    expect(deps.startCalls).toHaveLength(0);
    expect(ref).toMatchObject({
      managedAppKey: "cognee",
      managedApplicationId: null,
      operation: "ADOPT",
      attempt: 1,
      adoptedExisting: true,
      adoptedRunningInfra: true,
      adoptionRequiresNoChange: true,
    });
    expect(ref.deploymentJobId).toBeUndefined();
    expect(ref.componentHash).toBe(infraComponentHash(brainSubstrate));
  });

  it("idempotently reuses the Company Brain Cognee adoption job", async () => {
    const deps = fakeDeps();
    const brainSubstrate = component({
      key: "brain-substrate",
      managedAppKey: "cognee",
      terraformInputs: {
        imageUri: { description: "image", type: "string" },
      },
    });
    deps.managedApps.set(`${TENANT}:cognee`, {
      id: "app-cognee",
      desiredConfig: { imageUri: "repo/cognee@sha256:abc" },
      selectedReleaseVersion: "v1.2.3",
      selectedManifestDigest: "sha-123",
    });
    const ref = await provisionPluginInfraComponent(
      provisionArgs(
        deps,
        {},
        {
          pluginKey: "company-brain",
          component: brainSubstrate,
        },
      ),
    );
    deps.setJobStatus("job-1", "awaiting_approval");

    const again = await provisionPluginInfraComponent(
      provisionArgs(deps, ref, {
        pluginKey: "company-brain",
        component: brainSubstrate,
      }),
    );

    expect(again.deploymentJobId).toBe("job-1");
    expect(again.adoptionRequiresNoChange).toBe(true);
    expect(deps.startCalls).toHaveLength(1);
  });

  it("changed component content over a succeeded job creates an UPGRADE job instead of reusing", async () => {
    const deps = fakeDeps();
    const { ref, changed } = await upgradeJobRef(deps);
    deps.setJobStatus("job-1", "succeeded");

    const changedAgain = component({
      terraformInputs: {
        app_password: { description: "rotated again", type: "string" },
      },
    });
    // sanity: distinct from the first change so content differs from job-1.
    expect(infraComponentHash(changedAgain)).not.toBe(
      infraComponentHash(changed),
    );
    const upgraded = await provisionPluginInfraComponent({
      ...provisionArgs(deps, ref),
      component: changedAgain,
    });
    expect(upgraded.deploymentJobId).toBe("job-2");
    expect(upgraded.operation).toBe("UPGRADE");
    expect(upgraded.componentHash).toBe(infraComponentHash(changedAgain));
  });

  it("an unchanged component over a succeeded job is reused (re-drive convergence)", async () => {
    const deps = fakeDeps();
    const { ref, changed } = await upgradeJobRef(deps);
    deps.setJobStatus("job-1", "succeeded");

    const again = await provisionPluginInfraComponent({
      ...provisionArgs(deps, ref),
      component: changed,
    });
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

  it("net-new ENABLE starts the normal managed-app plan path", async () => {
    const deps = fakeDeps();
    // No existing managed_applications row at all → net-new provisioning.
    const ref = await provisionPluginInfraComponent(provisionArgs(deps));

    expect(ref).toMatchObject({
      managedAppKey: "twenty",
      deploymentJobId: "job-1",
      operation: "ENABLE",
      adoptedExisting: false,
    });
    expect(deps.startCalls).toHaveLength(1);
    expect(deps.startCalls[0]).toMatchObject({
      appKey: "twenty",
      operation: "ENABLE",
      desiredConfig: {},
      releaseVersion: null,
      manifestDigest: null,
    });
  });

  it("net-new Company Brain provisioning seeds tenant-scoped Brain desired config", async () => {
    const deps = fakeDeps();
    const brainSubstrate = component({
      key: "brain-substrate",
      managedAppKey: "cognee",
      terraformInputs: {
        imageUri: { description: "image", type: "string" },
        dbPasswordSecretArn: { description: "db", type: "string" },
        bedrockModelResourceArns: {
          description: "models",
          type: "list(string)",
        },
      },
    });

    const ref = await provisionPluginInfraComponent(
      provisionArgs(
        deps,
        {},
        {
          pluginKey: "company-brain",
          component: brainSubstrate,
        },
      ),
    );

    expect(ref).toMatchObject({
      managedAppKey: "cognee",
      deploymentJobId: "job-1",
      operation: "ENABLE",
      adoptedExisting: false,
    });
    expect(deps.startCalls).toHaveLength(1);
    expect(deps.startCalls[0]).toMatchObject({
      appKey: "cognee",
      operation: "ENABLE",
      desiredConfig: {
        brainTenantId: TENANT,
        brainInstanceKey: "tenant-0a96abb33b07",
        brainStorageTier: "default",
        privateSubstrateMode: true,
      },
      releaseVersion: null,
      manifestDigest: null,
    });
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

  /**
   * Build a provisioned-via-real-job ref (job-1 succeeded) by adopting an
   * existing app then driving an UPGRADE — the only plugin path that creates
   * a deployment job (net-new ENABLE without a row fails — Fix B).
   */
  async function provisionedRef(deps: FakeDeps) {
    deps.managedApps.set(`${TENANT}:twenty`, {
      id: "app-twenty",
      desiredConfig: {},
      currentStatus: "enabled",
      selectedReleaseVersion: "v1.2.3",
      selectedManifestDigest: "sha-123",
    });
    const adopted = await provisionPluginInfraComponent(provisionArgs(deps));
    const changed = component({
      terraformInputs: {
        app_password: { description: "rotated", type: "string" },
      },
    });
    const ref = await provisionPluginInfraComponent({
      ...provisionArgs(deps, adopted),
      component: changed,
    });
    return ref; // deploymentJobId job-1
  }

  it("a never-provisioned component completes immediately with no job", async () => {
    const deps = fakeDeps();
    const result = await teardownPluginInfraComponent(teardownArgs(deps, {}));
    expect(result.complete).toBe(true);
    expect(deps.startCalls).toHaveLength(0);
  });

  it("a provisioned component creates a DESTROY plan job behind the approval gate", async () => {
    const deps = fakeDeps();
    const ref = await provisionedRef(deps);
    deps.setJobStatus("job-1", "succeeded");

    const result = await teardownPluginInfraComponent(teardownArgs(deps, ref));
    expect(result.complete).toBe(false);
    expect(result.handlerRef).toMatchObject({
      operation: "DESTROY",
      deploymentJobId: "job-2",
      // provisionedRef carried attempt 2 (adopt→upgrade); destroy bumps to 3.
      attempt: 3,
    });
    expect(deps.startCalls[1]).toMatchObject({
      operation: "DESTROY",
      idempotencyKey: "plugin:install-1:infra:destroy:3",
    });
  });

  it("an in-flight destroy job is reused; a succeeded one completes; a failed one re-drives fresh", async () => {
    const deps = fakeDeps();
    const ref = await provisionedRef(deps);
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
      attempt: 4,
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
    const ref = await provisionedRef(deps);
    deps.managedApps.delete(`${TENANT}:twenty`);

    const result = await teardownPluginInfraComponent(teardownArgs(deps, ref));
    expect(result.complete).toBe(true);
    expect(deps.startCalls).toHaveLength(1); // only the original provision
  });

  it("tears down an adopted-running infra (no prior deploy job) by creating a DESTROY job", async () => {
    const deps = fakeDeps();
    deps.managedApps.set(`${TENANT}:twenty`, {
      id: "app-existing",
      desiredConfig: {},
      currentStatus: "enabled",
      selectedReleaseVersion: "v1.2.3",
      selectedManifestDigest: "sha-123",
    });
    const adopted = await provisionPluginInfraComponent(provisionArgs(deps));
    expect(adopted.deploymentJobId).toBeUndefined();

    const result = await teardownPluginInfraComponent(
      teardownArgs(deps, adopted),
    );
    // First job created is the DESTROY (no provision job preceded it) → job-1.
    // The adopted ref carried attempt 1, so the destroy bumps to attempt 2.
    expect(result.complete).toBe(false);
    expect(result.handlerRef).toMatchObject({
      operation: "DESTROY",
      deploymentJobId: "job-1",
      attempt: 2,
    });
  });
});
