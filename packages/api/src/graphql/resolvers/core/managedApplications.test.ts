import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ManagedAppStatusReaderDeps,
  TwentyStatusReaderDeps,
} from "./managedApplications.js";

let mod: typeof import("./managedApplications.js");

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllEnvs();
  mod = await import("./managedApplications.js");
});

function twentyDeps(args: {
  row?: { desiredConfig: Record<string, unknown> } | null;
  lastSucceededOperation?: string | null;
}): TwentyStatusReaderDeps {
  return {
    getManagedApplicationRow: async () => args.row ?? null,
    getLatestSucceededJobOperation: async () =>
      args.lastSucceededOperation ?? null,
  };
}

function managedAppDeps(args: {
  rows?: Partial<
    Record<"twenty" | "n8n", { desiredConfig: Record<string, unknown> }>
  >;
  lastSucceededOperations?: Partial<Record<"twenty" | "n8n", string | null>>;
}): ManagedAppStatusReaderDeps {
  return {
    getManagedApplicationRow: async (_tenantId, key = "twenty") =>
      args.rows?.[key] ?? null,
    getLatestSucceededJobOperation: async (_tenantId, key = "twenty") =>
      args.lastSucceededOperations?.[key] ?? null,
  };
}

describe("managed application status helpers", () => {
  it("normalizes known managed application aliases", () => {
    expect(mod.normalizeManagedApplicationKey("cognee")).toBe("cognee");
    expect(mod.normalizeManagedApplicationKey("knowledge-graph")).toBe(
      "cognee",
    );
    expect(mod.normalizeManagedApplicationKey("crm")).toBe("twenty");
    expect(mod.normalizeManagedApplicationKey("twenty-crm")).toBe("twenty");
    expect(mod.normalizeManagedApplicationKey("project-management")).toBeNull();
    expect(mod.normalizeManagedApplicationKey("unsupported-app")).toBeNull();
    expect(mod.normalizeManagedApplicationKey("workflow-automation")).toBe(
      "n8n",
    );
    expect(mod.normalizeManagedApplicationKey("n8n")).toBe("n8n");
    expect(mod.normalizeManagedApplicationKey("kestra")).toBeNull();
    expect(mod.normalizeManagedApplicationKey("unknown")).toBeNull();
  });

  it("projects Twenty workflow readiness from app and MCP state", () => {
    expect(
      mod.twentyWorkflowProjection({
        key: "twenty",
        status: "running",
        provisioned: true,
        runtimeEnabled: true,
        url: "https://crm.example.com",
        managedMcpInstalled: true,
        managedMcpStatus: "installed",
        managedMcpMessage: null,
      }),
    ).toMatchObject({
      workflowReadinessState: "ready",
      workflowReadinessReasons: [],
      workflowCapabilityFlags: expect.objectContaining({
        triggerFamilies: ["crm"],
        start: false,
        monitor: true,
      }),
    });

    expect(
      mod.twentyWorkflowProjection({
        key: "twenty",
        status: "parked",
        provisioned: true,
        runtimeEnabled: false,
        url: "https://crm.example.com",
        managedMcpInstalled: true,
        managedMcpStatus: "installed",
        managedMcpMessage: null,
      }),
    ).toMatchObject({
      workflowReadinessState: "blocked_not_ready",
      workflowReadinessReasons: [
        expect.objectContaining({ code: "managed_app_parked" }),
      ],
    });
  });
});

describe("n8n status served from DB state", () => {
  it("reports running after a succeeded ENABLE apply, with the URL from desired_config", async () => {
    const app = await mod.readManagedApplication(
      "n8n",
      "tenant-1",
      managedAppDeps({
        rows: {
          n8n: {
            desiredConfig: {
              publicUrl: "https://n8n.example.com",
              databaseName: "thinkwork_n8n",
              packageConfigDigest: "package-digest-1",
            },
          },
        },
        lastSucceededOperations: { n8n: "ENABLE" },
      }),
    );
    expect(app).toMatchObject({
      key: "n8n",
      status: "running",
      enabled: true,
      provisioned: true,
      runtimeEnabled: true,
      url: "https://n8n.example.com",
      backendMode: "queue",
      databaseName: "thinkwork_n8n",
      managedMcpInstallAvailable: true,
    });
  });

  it("reports parked after a succeeded PARK apply", async () => {
    const app = await mod.readManagedApplication(
      "n8n",
      "tenant-1",
      managedAppDeps({
        rows: {
          n8n: {
            desiredConfig: { publicUrl: "https://n8n.example.com" },
          },
        },
        lastSucceededOperations: { n8n: "PARK" },
      }),
    );
    expect(app).toMatchObject({
      status: "parked",
      enabled: false,
      provisioned: true,
      runtimeEnabled: false,
      message:
        "n8n runtime is parked; workflow data, credentials, and app secrets are retained.",
    });
  });

  it("reports disabled when no row or succeeded apply exists", async () => {
    const noRow = await mod.readN8nStatus("tenant-1", managedAppDeps({}));
    expect(noRow.provisioned).toBe(false);

    const noSucceededApply = await mod.readManagedApplication(
      "n8n",
      "tenant-1",
      managedAppDeps({
        rows: {
          n8n: {
            desiredConfig: { publicUrl: "https://n8n.example.com" },
          },
        },
        lastSucceededOperations: { n8n: null },
      }),
    );
    expect(noSucceededApply).toMatchObject({
      status: "disabled",
      provisioned: false,
      runtimeEnabled: false,
      url: null,
      databaseName: null,
    });
  });

  it("derives queue-mode ECS service and log identifiers from stage + account", async () => {
    vi.stubEnv("STAGE", "dev");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("AWS_ACCOUNT_ID", "123456789012");

    const app = await mod.readManagedApplication(
      "n8n",
      "tenant-1",
      managedAppDeps({
        rows: {
          n8n: {
            desiredConfig: {
              publicUrl: "https://n8n.example.com",
              storageBucketName: "custom-n8n-bucket",
            },
          },
        },
        lastSucceededOperations: { n8n: "ENABLE" },
      }),
    );

    expect(app).toMatchObject({
      key: "n8n",
      status: "running",
      clusterArn:
        "arn:aws:ecs:us-east-1:123456789012:cluster/thinkwork-dev-n8n-cluster",
      serviceNames: ["thinkwork-dev-n8n-main", "thinkwork-dev-n8n-worker"],
      logGroupNames: ["/thinkwork/dev/n8n/main", "/thinkwork/dev/n8n/worker"],
      storageBucketName: "custom-n8n-bucket",
      databaseName: "thinkwork_n8n",
    });
  });
});

describe("Twenty status served from DB state (plan 2026-06-12-001 U10)", () => {
  it("reports running after a succeeded ENABLE apply, with the URL from desired_config", async () => {
    const app = await mod.readManagedApplication(
      "twenty",
      "tenant-1",
      twentyDeps({
        row: { desiredConfig: { publicUrl: "https://crm.example.com" } },
        lastSucceededOperation: "ENABLE",
      }),
    );
    expect(app).toMatchObject({
      key: "twenty",
      status: "running",
      enabled: true,
      provisioned: true,
      runtimeEnabled: true,
      url: "https://crm.example.com",
    });
  });

  it("treats a succeeded UPGRADE (the U10 adoption operation) as running", async () => {
    const twenty = await mod.readTwentyStatus(
      "tenant-1",
      twentyDeps({
        row: { desiredConfig: { publicUrl: "https://crm.example.com" } },
        lastSucceededOperation: "UPGRADE",
      }),
    );
    expect(twenty).toMatchObject({
      provisioned: true,
      runtimeEnabled: true,
      url: "https://crm.example.com",
    });
  });

  it("reports parked after a succeeded PARK apply", async () => {
    const app = await mod.readManagedApplication(
      "twenty",
      "tenant-1",
      twentyDeps({
        row: { desiredConfig: { publicUrl: "https://crm.example.com" } },
        lastSucceededOperation: "PARK",
      }),
    );
    expect(app).toMatchObject({
      status: "parked",
      enabled: false,
      provisioned: true,
      runtimeEnabled: false,
      message:
        "Twenty CRM runtime is parked; CRM data and app secrets are retained.",
    });
  });

  it("reports disabled after a succeeded DESTROY apply", async () => {
    const app = await mod.readManagedApplication(
      "twenty",
      "tenant-1",
      twentyDeps({
        row: { desiredConfig: { publicUrl: "https://crm.example.com" } },
        lastSucceededOperation: "DESTROY",
      }),
    );
    expect(app).toMatchObject({
      status: "disabled",
      provisioned: false,
      runtimeEnabled: false,
      url: null,
    });
  });

  it("reports disabled when no apply has ever succeeded (in-flight/failed jobs never flip state)", async () => {
    const app = await mod.readManagedApplication(
      "twenty",
      "tenant-1",
      twentyDeps({
        row: { desiredConfig: { publicUrl: "https://crm.example.com" } },
        lastSucceededOperation: null,
      }),
    );
    expect(app).toMatchObject({ status: "disabled", provisioned: false });
  });

  it("reports disabled when no managed_applications row exists or tenant context is missing", async () => {
    const noRow = await mod.readTwentyStatus("tenant-1", twentyDeps({}));
    expect(noRow.provisioned).toBe(false);

    const noTenant = await mod.readTwentyStatus(
      null,
      twentyDeps({
        row: { desiredConfig: { publicUrl: "https://crm.example.com" } },
        lastSucceededOperation: "ENABLE",
      }),
    );
    expect(noTenant.provisioned).toBe(false);
  });

  it("derives stable ECS service and log identifiers from stage + account", async () => {
    vi.stubEnv("STAGE", "dev");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("AWS_ACCOUNT_ID", "123456789012");

    const app = await mod.readManagedApplication(
      "twenty",
      "tenant-1",
      twentyDeps({
        row: { desiredConfig: { publicUrl: "https://crm.example.com" } },
        lastSucceededOperation: "ENABLE",
      }),
    );

    expect(app).toMatchObject({
      key: "twenty",
      status: "running",
      clusterArn:
        "arn:aws:ecs:us-east-1:123456789012:cluster/thinkwork-dev-twenty-cluster",
      serviceNames: [
        "thinkwork-dev-twenty-server",
        "thinkwork-dev-twenty-worker",
      ],
      logGroupNames: [
        "/thinkwork/dev/twenty/server",
        "/thinkwork/dev/twenty/worker",
      ],
    });
  });
});

describe("Cognee status stays on the env-var path (unchanged by U10)", () => {
  it("reads the compact COGNEE env projection", async () => {
    vi.stubEnv("COGNEE", "graphiti|https://cognee.internal.example.com");
    vi.stubEnv("STAGE", "dev");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("AWS_ACCOUNT_ID", "123456789012");
    mod = await import("./managedApplications.js");

    const cognee = mod.readCogneeStatus();
    expect(cognee).toEqual({
      enabled: true,
      endpoint: "https://cognee.internal.example.com",
      backendMode: "graphiti",
    });

    const app = await mod.readManagedApplication("cognee", "tenant-1");
    expect(app).toMatchObject({
      key: "cognee",
      status: "running",
      enabled: true,
      endpoint: "https://cognee.internal.example.com",
      backendMode: "graphiti",
      clusterArn:
        "arn:aws:ecs:us-east-1:123456789012:cluster/thinkwork-dev-brain-cluster",
    });
  });

  it("uses COGNEE_CLUSTER_ARN exactly when present", async () => {
    vi.stubEnv("COGNEE", "dogfood|https://cognee.internal.example.com");
    vi.stubEnv(
      "COGNEE_CLUSTER_ARN",
      "arn:aws:ecs:us-west-2:210987654321:cluster/compat-cluster",
    );
    mod = await import("./managedApplications.js");

    const app = await mod.readManagedApplication("cognee", "tenant-1");
    expect(app.clusterArn).toBe(
      "arn:aws:ecs:us-west-2:210987654321:cluster/compat-cluster",
    );
  });

  it("reports Cognee disabled when no env projection exists", async () => {
    const app = await mod.readManagedApplication("cognee", "tenant-1");
    expect(app).toMatchObject({
      key: "cognee",
      status: "disabled",
      enabled: false,
      message: "Cognee is not provisioned for this stage.",
    });
  });
});
