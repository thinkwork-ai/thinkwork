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
    Record<"twenty" | "plane", { desiredConfig: Record<string, unknown> }>
  >;
  lastSucceededOperations?: Partial<Record<"twenty" | "plane", string | null>>;
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
    expect(mod.normalizeManagedApplicationKey("plane")).toBe("plane");
    expect(mod.normalizeManagedApplicationKey("project-management")).toBe(
      "plane",
    );
    expect(mod.normalizeManagedApplicationKey("kestra")).toBeNull();
    expect(mod.normalizeManagedApplicationKey("unknown")).toBeNull();
  });
});

describe("Plane status served from DB state", () => {
  it("reports running after a succeeded ENABLE apply, with the URL from desired_config", async () => {
    const app = await mod.readManagedApplication(
      "plane",
      "tenant-1",
      managedAppDeps({
        rows: {
          plane: {
            desiredConfig: { publicUrl: "https://plane.example.com" },
          },
        },
        lastSucceededOperations: { plane: "ENABLE" },
      }),
    );
    expect(app).toMatchObject({
      key: "plane",
      status: "running",
      enabled: true,
      provisioned: true,
      runtimeEnabled: true,
      url: "https://plane.example.com",
      backendMode: "compact",
      managedMcpInstallAvailable: true,
    });
  });

  it("reports parked after a succeeded PARK apply", async () => {
    const app = await mod.readManagedApplication(
      "plane",
      "tenant-1",
      managedAppDeps({
        rows: {
          plane: {
            desiredConfig: { publicUrl: "https://plane.example.com" },
          },
        },
        lastSucceededOperations: { plane: "PARK" },
      }),
    );
    expect(app).toMatchObject({
      status: "parked",
      enabled: false,
      provisioned: true,
      runtimeEnabled: false,
      message:
        "Plane runtime is parked; Plane data and app secrets are retained.",
    });
  });

  it("reports disabled when no row or succeeded apply exists", async () => {
    const noRow = await mod.readPlaneStatus(
      "tenant-1",
      managedAppDeps({}),
    );
    expect(noRow.provisioned).toBe(false);

    const noSucceededApply = await mod.readManagedApplication(
      "plane",
      "tenant-1",
      managedAppDeps({
        rows: {
          plane: {
            desiredConfig: { publicUrl: "https://plane.example.com" },
          },
        },
        lastSucceededOperations: { plane: null },
      }),
    );
    expect(noSucceededApply).toMatchObject({
      status: "disabled",
      provisioned: false,
      runtimeEnabled: false,
      url: null,
    });
  });

  it("derives the compact ECS service and log identifiers from stage + account", async () => {
    vi.stubEnv("STAGE", "dev");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("AWS_ACCOUNT_ID", "123456789012");

    const app = await mod.readManagedApplication(
      "plane",
      "tenant-1",
      managedAppDeps({
        rows: {
          plane: {
            desiredConfig: {
              publicUrl: "https://plane.example.com",
              s3BucketName: "custom-plane-bucket",
            },
          },
        },
        lastSucceededOperations: { plane: "ENABLE" },
      }),
    );

    expect(app).toMatchObject({
      key: "plane",
      status: "running",
      clusterArn:
        "arn:aws:ecs:us-east-1:123456789012:cluster/thinkwork-dev-plane-cluster",
      serviceNames: ["thinkwork-dev-plane"],
      logGroupNames: [
        "/thinkwork/dev/plane/app",
        "/thinkwork/dev/plane/mcp",
        "/thinkwork/dev/plane/redis",
        "/thinkwork/dev/plane/rabbitmq",
      ],
      storageBucketName: "custom-plane-bucket",
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
