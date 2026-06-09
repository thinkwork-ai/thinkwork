import { beforeEach, describe, expect, it, vi } from "vitest";

let mod: typeof import("./managedApplications.js");

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllEnvs();
  mod = await import("./managedApplications.js");
});

describe("managed application status helpers", () => {
  it("normalizes known managed application aliases", () => {
    expect(mod.normalizeManagedApplicationKey("cognee")).toBe("cognee");
    expect(mod.normalizeManagedApplicationKey("knowledge-graph")).toBe(
      "cognee",
    );
    expect(mod.normalizeManagedApplicationKey("crm")).toBe("twenty");
    expect(mod.normalizeManagedApplicationKey("twenty-crm")).toBe("twenty");
    expect(mod.normalizeManagedApplicationKey("orchestration")).toBe("kestra");
    expect(mod.normalizeManagedApplicationKey("orchestrate")).toBe("kestra");
    expect(mod.normalizeManagedApplicationKey("unknown")).toBeNull();
  });

  it("classifies Twenty enabled, parked, disabled, and malformed states", () => {
    vi.stubEnv("TWENTY", "1|1|https://crm.example.com|cluster|server|worker");
    expect(mod.readManagedApplication("twenty")).toMatchObject({
      key: "twenty",
      status: "running",
      enabled: true,
      provisioned: true,
      runtimeEnabled: true,
      url: "https://crm.example.com",
    });

    vi.stubEnv("TWENTY", "1|0|https://crm.example.com");
    expect(mod.readManagedApplication("twenty")).toMatchObject({
      status: "parked",
      enabled: false,
      provisioned: true,
      runtimeEnabled: false,
      message:
        "Twenty CRM runtime is parked; CRM data and app secrets are retained.",
    });

    vi.stubEnv("TWENTY", "0|0|");
    expect(mod.readManagedApplication("twenty")).toMatchObject({
      status: "disabled",
      enabled: false,
      provisioned: false,
    });

    vi.stubEnv("TWENTY", "bad-value");
    expect(mod.readManagedApplication("twenty")).toMatchObject({
      status: "unknown",
      enabled: false,
      provisioned: false,
      runtimeEnabled: false,
    });
  });

  it("derives Twenty service and log details from compact status", () => {
    vi.stubEnv("STAGE", "dev");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("AWS_ACCOUNT_ID", "123456789012");
    vi.stubEnv("TWENTY", "1|1|https://crm.example.com");

    expect(mod.readManagedApplication("twenty")).toMatchObject({
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

  it("classifies Kestra enabled, parked, disabled, and malformed states", () => {
    vi.stubEnv(
      "KESTRA",
      "1|1|https://orchestrate.example.com|cluster|service|/logs|bucket|db",
    );
    expect(mod.readManagedApplication("kestra")).toMatchObject({
      key: "kestra",
      status: "running",
      enabled: true,
      provisioned: true,
      runtimeEnabled: true,
      url: "https://orchestrate.example.com",
      storageBucketName: "bucket",
      databaseName: "db",
      managedMcpInstallAvailable: true,
    });

    vi.stubEnv("KESTRA", "1|0|https://orchestrate.example.com");
    expect(mod.readManagedApplication("kestra")).toMatchObject({
      status: "parked",
      enabled: false,
      provisioned: true,
      runtimeEnabled: false,
      message:
        "Kestra runtime is parked; flow definitions, execution history, storage, and credentials are retained.",
    });

    vi.stubEnv("KESTRA", "0|0|");
    expect(mod.readManagedApplication("kestra")).toMatchObject({
      status: "disabled",
      enabled: false,
      provisioned: false,
    });

    vi.stubEnv("KESTRA", "bad-value");
    expect(mod.readManagedApplication("kestra")).toMatchObject({
      status: "unknown",
      enabled: false,
      provisioned: false,
      runtimeEnabled: false,
    });
  });

  it("derives Kestra service and log details from compact status", () => {
    vi.stubEnv("STAGE", "dev");
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("AWS_ACCOUNT_ID", "123456789012");
    vi.stubEnv("WWW_URL", "https://thinkwork.example.com");
    vi.stubEnv("KESTRA", "1|1");

    expect(mod.readManagedApplication("kestra")).toMatchObject({
      key: "kestra",
      status: "running",
      url: "https://orchestrate.thinkwork.example.com",
      clusterArn:
        "arn:aws:ecs:us-east-1:123456789012:cluster/thinkwork-dev-kestra-cluster",
      serviceNames: ["thinkwork-dev-kestra-service"],
      logGroupNames: ["/thinkwork/dev/kestra"],
      storageBucketName: "tw-dev-kestra-123456789012",
      databaseName: "thinkwork_kestra",
    });
  });
});
