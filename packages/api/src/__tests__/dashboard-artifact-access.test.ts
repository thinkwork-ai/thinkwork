import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSelect,
  selectRowsQueue,
  mockResolveCaller,
  mockReadDashboardManifestFromS3,
  mockEnqueueComputerTask,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  selectRowsQueue: [] as unknown[][],
  mockResolveCaller: vi.fn(),
  mockReadDashboardManifestFromS3: vi.fn(),
  mockEnqueueComputerTask: vi.fn(),
}));

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCaller: mockResolveCaller,
}));

vi.mock("../lib/dashboard-artifacts/storage.js", () => ({
  readDashboardManifestFromS3: mockReadDashboardManifestFromS3,
}));

vi.mock("../lib/computers/tasks.js", () => {
  class ComputerTaskInputError extends Error {}
  return {
    ComputerTaskInputError,
    enqueueComputerTask: mockEnqueueComputerTask,
    toGraphqlComputerTask: (row: Record<string, unknown>) => ({
      id: row.id,
      tenantId: row.tenant_id,
      computerId: row.computer_id,
      taskType: String(row.task_type ?? "").toUpperCase(),
      status: String(row.status ?? "").toUpperCase(),
      idempotencyKey: row.idempotency_key ?? null,
      input: row.input ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
  };
});

vi.mock("../graphql/utils.js", () => ({
  artifacts: {
    id: "artifacts.id",
    tenant_id: "artifacts.tenant_id",
  },
  computerTasks: {
    tenant_id: "computerTasks.tenant_id",
    computer_id: "computerTasks.computer_id",
    idempotency_key: "computerTasks.idempotency_key",
    created_at: "computerTasks.created_at",
  },
  db: {
    select: mockSelect,
  },
  eq: (...args: unknown[]) => ({ eq: args }),
  and: (...args: unknown[]) => ({ and: args }),
  desc: (value: unknown) => ({ desc: value }),
  artifactToCamel: (row: Record<string, unknown>) => ({
    id: row.id,
    tenantId: row.tenant_id,
    threadId: row.thread_id ?? null,
    title: row.title,
    type: String(row.type ?? "").toUpperCase(),
    status: String(row.status ?? "").toUpperCase(),
    s3Key: row.s3_key ?? null,
    metadata: row.metadata ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }),
}));

// eslint-disable-next-line import/first
import { dashboardArtifact } from "../graphql/resolvers/artifacts/dashboardArtifact.query.js";
// eslint-disable-next-line import/first
import { refreshDashboardArtifact } from "../graphql/resolvers/artifacts/refreshDashboardArtifact.mutation.js";
// eslint-disable-next-line import/first
import { validManifest } from "./dashboard-artifacts-manifest.test.js";

const ctx = { auth: { authType: "cognito" } } as any;

beforeEach(() => {
  selectRowsQueue.length = 0;
  mockSelect.mockReset();
  mockResolveCaller.mockReset();
  mockReadDashboardManifestFromS3.mockReset();
  mockEnqueueComputerTask.mockReset();
  mockSelect.mockReturnValue({
    from: () => ({
      where: () => queryResult(selectRowsQueue.shift() ?? []),
    }),
  });
  mockResolveCaller.mockResolvedValue({
    tenantId: "tenant-A",
    userId: "user-1",
  });
  mockReadDashboardManifestFromS3.mockResolvedValue(validManifest());
  mockEnqueueComputerTask.mockResolvedValue({
    id: "task-1",
    taskType: "DASHBOARD_ARTIFACT_REFRESH",
    status: "PENDING",
    idempotencyKey: "dashboard-artifact-refresh:artifact-1:1",
  });
});

describe("dashboard artifact resolvers", () => {
  it("allows the owner to read their dashboard manifest", async () => {
    selectRowsQueue.push([dashboardRow()], []);

    const result = await dashboardArtifact(null, { id: "artifact-1" }, ctx);

    expect(result.artifact).toMatchObject({ id: "artifact-1" });
    expect(result.manifest).toMatchObject({
      snapshot: { artifactId: "artifact-1" },
      dashboardKind: "pipeline_risk",
    });
    expect(result.canRefresh).toBe(true);
    expect(mockReadDashboardManifestFromS3).toHaveBeenCalledWith({
      tenantId: "tenant-A",
      key: "tenants/tenant-A/dashboard-artifacts/artifact-1/manifest.json",
    });
  });

  it("denies a different same-tenant user", async () => {
    mockResolveCaller.mockResolvedValue({
      tenantId: "tenant-A",
      userId: "user-2",
    });
    selectRowsQueue.push([dashboardRow()]);

    await expect(
      dashboardArtifact(null, { id: "artifact-1" }, ctx),
    ).rejects.toThrow("Dashboard artifact not found");
    expect(mockReadDashboardManifestFromS3).not.toHaveBeenCalled();
  });

  it("denies cross-tenant access", async () => {
    mockResolveCaller.mockResolvedValue({
      tenantId: "tenant-B",
      userId: "user-1",
    });
    selectRowsQueue.push([dashboardRow()]);

    await expect(
      refreshDashboardArtifact(null, { id: "artifact-1" }, ctx),
    ).rejects.toThrow("Dashboard artifact not found");
    expect(mockEnqueueComputerTask).not.toHaveBeenCalled();
  });

  it("rejects non-dashboard data-view artifacts", async () => {
    selectRowsQueue.push([
      dashboardRow({
        metadata: { kind: "spreadsheet", dashboardKind: "pipeline_risk" },
      }),
    ]);

    await expect(
      dashboardArtifact(null, { id: "artifact-1" }, ctx),
    ).rejects.toThrow("Artifact is not a dashboard artifact");
  });

  it("returns a safe error when the S3 manifest is missing or invalid", async () => {
    selectRowsQueue.push([dashboardRow()]);
    mockReadDashboardManifestFromS3.mockRejectedValue(
      new Error(
        "NoSuchKey: tenants/tenant-A/dashboard-artifacts/artifact-1/manifest.json",
      ),
    );

    const rejected = await dashboardArtifact(null, { id: "artifact-1" }, ctx)
      .then(() => null)
      .catch((err) => err as Error);
    expect(rejected?.message).toBe("Dashboard manifest is unavailable");
    expect(rejected?.message).not.toContain(
      "tenants/tenant-A/dashboard-artifacts",
    );
  });

  it("passes a stable idempotency key when refresh is requested repeatedly", async () => {
    selectRowsQueue.push([dashboardRow()], [dashboardRow()]);

    await refreshDashboardArtifact(null, { id: "artifact-1" }, ctx);
    await refreshDashboardArtifact(null, { id: "artifact-1" }, ctx);

    expect(mockEnqueueComputerTask).toHaveBeenCalledTimes(2);
    expect(mockEnqueueComputerTask).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        taskType: "dashboard_artifact_refresh",
        idempotencyKey: "dashboard-artifact-refresh:artifact-1:1",
      }),
    );
    expect(mockEnqueueComputerTask).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        taskType: "dashboard_artifact_refresh",
        idempotencyKey: "dashboard-artifact-refresh:artifact-1:1",
      }),
    );
  });

  it("rejects refresh recipes with non-read-only operations", async () => {
    const manifest = validManifest();
    manifest.recipe.steps = [
      { type: "workspace_file_write", id: "write-file" } as never,
    ];
    mockReadDashboardManifestFromS3.mockResolvedValue(manifest);
    selectRowsQueue.push([dashboardRow()]);

    await expect(
      refreshDashboardArtifact(null, { id: "artifact-1" }, ctx),
    ).rejects.toThrow("Dashboard refresh recipe is not read-only");
    expect(mockEnqueueComputerTask).not.toHaveBeenCalled();
  });
});

function queryResult(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  return {
    orderBy: () => ({ limit: () => promise }),
    limit: () => promise,
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
}

function dashboardRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "artifact-1",
    tenant_id: "tenant-A",
    thread_id: "thread-1",
    title: "Pipeline risk",
    type: "data_view",
    status: "final",
    s3_key: "tenants/tenant-A/dashboard-artifacts/artifact-1/manifest.json",
    metadata: {
      kind: "research_dashboard",
      dashboardKind: "pipeline_risk",
      computerId: "computer-1",
      ownerUserId: "user-1",
      threadId: "thread-1",
    },
    created_at: new Date("2026-05-08T16:00:00.000Z"),
    updated_at: new Date("2026-05-08T16:00:00.000Z"),
    ...overrides,
  };
}
