import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const THREAD_ID = "33333333-3333-3333-3333-333333333333";
const USER_ID = "55555555-5555-5555-5555-555555555555";

const mocks = vi.hoisted(() => ({
  tables: {
    artifacts: {
      id: { name: "artifacts.id" },
      tenant_id: { name: "artifacts.tenant_id" },
    },
    threads: {
      id: { name: "threads.id" },
      tenant_id: { name: "threads.tenant_id" },
    },
  },
  selectQueue: [] as Array<Array<Record<string, unknown>>>,
  requireTenantMember: vi.fn(),
  resolveCallerFromAuth: vi.fn(),
  visiblePredicate: vi.fn(() => ({ visible: true })),
  artifactToCamelWithPayload: vi.fn((row: Record<string, unknown>) => ({
    id: row.id,
    title: row.title,
    type: row.type,
    content: row.content,
  })),
}));

vi.mock("../../utils.js", () => ({
  and: (...conditions: unknown[]) => ({ and: conditions }),
  artifacts: mocks.tables.artifacts,
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mocks.selectQueue.shift() ?? []),
      }),
    }),
  },
  eq: (field: unknown, value: unknown) => ({ eq: [field, value] }),
  threads: mocks.tables.threads,
}));

vi.mock("../core/authz.js", () => ({
  requireTenantMember: mocks.requireTenantMember,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerFromAuth: mocks.resolveCallerFromAuth,
}));

vi.mock("../threads/access.js", () => ({
  callerVisibleThreadPredicate: mocks.visiblePredicate,
}));

vi.mock("./payload.js", () => ({
  artifactToCamelWithPayload: mocks.artifactToCamelWithPayload,
}));

import { artifact } from "./artifact.query.js";

const ctx = { auth: { authType: "cognito" } } as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectQueue = [];
  mocks.requireTenantMember.mockResolvedValue("member");
  mocks.resolveCallerFromAuth.mockResolvedValue({
    userId: USER_ID,
    tenantId: TENANT_ID,
  });
});

describe("artifact query GenUI snapshot access", () => {
  it("hydrates a GenUI snapshot only when the source thread is visible", async () => {
    mocks.selectQueue.push([genUISnapshotArtifact()]);
    mocks.selectQueue.push([{ id: THREAD_ID }]);

    const result = await artifact({}, { id: "artifact-1" }, ctx);

    expect(result).toMatchObject({ id: "artifact-1", type: "data_view" });
    expect(mocks.artifactToCamelWithPayload).toHaveBeenCalledTimes(1);
  });

  it("rejects GenUI snapshot artifact reads when the source thread is hidden", async () => {
    mocks.selectQueue.push([genUISnapshotArtifact()]);
    mocks.selectQueue.push([]);

    await expect(artifact({}, { id: "artifact-1" }, ctx)).rejects.toMatchObject(
      {
        extensions: { code: "FORBIDDEN" },
      },
    );
    expect(mocks.artifactToCamelWithPayload).not.toHaveBeenCalled();
  });

  it("keeps non-GenUI artifacts on the existing tenant-member read path", async () => {
    mocks.selectQueue.push([
      {
        id: "artifact-2",
        tenant_id: TENANT_ID,
        thread_id: THREAD_ID,
        title: "Report",
        type: "report",
        metadata: { kind: "report" },
      },
    ]);

    const result = await artifact({}, { id: "artifact-2" }, ctx);

    expect(result).toMatchObject({ id: "artifact-2", type: "report" });
    expect(mocks.resolveCallerFromAuth).not.toHaveBeenCalled();
  });
});

function genUISnapshotArtifact() {
  return {
    id: "artifact-1",
    tenant_id: TENANT_ID,
    thread_id: THREAD_ID,
    title: "Snapshot",
    type: "data_view",
    metadata: { kind: "genui_snapshot" },
    content: "{}",
  };
}
