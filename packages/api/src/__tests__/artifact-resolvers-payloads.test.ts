import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, insertedRows, updatedRows, selectRows, mockRequireTenantMember } =
  vi.hoisted(() => {
    const insertedRows: any[] = [];
    const updatedRows: any[] = [];
    const selectRows: any[] = [];
    const mockRequireTenantMember = vi.fn();

    const selectBuilder = {
      from: vi.fn(() => selectBuilder),
      where: vi.fn(() => Promise.resolve(selectRows)),
      then: (resolve: (rows: any[]) => unknown) => resolve(selectRows),
    };
    const insertBuilder = {
      values: vi.fn((row: any) => {
        insertedRows.push(row);
        return insertBuilder;
      }),
      returning: vi.fn(() => Promise.resolve(insertedRows.slice(-1))),
    };
    const updateBuilder = {
      set: vi.fn((row: any) => {
        updatedRows.push(row);
        return updateBuilder;
      }),
      where: vi.fn(() => updateBuilder),
      returning: vi.fn(() =>
        Promise.resolve([
          {
            ...selectRows[0],
            ...updatedRows.slice(-1)[0],
          },
        ]),
      ),
    };

    return {
      insertedRows,
      updatedRows,
      selectRows,
      mockRequireTenantMember,
      mockDb: {
        select: vi.fn(() => selectBuilder),
        insert: vi.fn(() => insertBuilder),
        update: vi.fn(() => updateBuilder),
      },
    };
  });

vi.mock("../graphql/utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../graphql/utils.js")>();
  return {
    ...actual,
    db: mockDb,
    randomUUID: vi
      .fn()
      .mockReturnValueOnce("artifact-1")
      .mockReturnValue("revision-1"),
  };
});

vi.mock("../graphql/resolvers/core/authz.js", () => ({
  requireTenantMember: mockRequireTenantMember,
}));

const s3Mock = mockClient(S3Client);

describe("artifact payload resolvers", () => {
  beforeEach(() => {
    insertedRows.length = 0;
    updatedRows.length = 0;
    selectRows.length = 0;
    s3Mock.reset();
    mockRequireTenantMember.mockResolvedValue("member");
    process.env.WORKSPACE_BUCKET = "workspace-bucket";
    vi.clearAllMocks();
  });

  it("stores created artifact content in S3 and returns hydrated content", async () => {
    const { createArtifact } = await import(
      "../graphql/resolvers/artifacts/createArtifact.mutation.js"
    );
    s3Mock.on(PutObjectCommand).resolves({});
    s3Mock.on(GetObjectCommand).resolves({
      Body: { transformToString: async () => "# Report" } as any,
    });

    const result = await createArtifact(
      null,
      {
        input: {
          tenantId: "tenant-1",
          title: "Report",
          type: "REPORT",
          content: "# Report",
        },
      },
      {} as any,
    );

    expect(mockRequireTenantMember).toHaveBeenCalledWith(expect.anything(), "tenant-1");
    expect(insertedRows[0]).toMatchObject({
      id: "artifact-1",
      tenant_id: "tenant-1",
      content: null,
      s3_key: "tenants/tenant-1/artifact-payloads/artifacts/artifact-1/content.md",
    });
    expect(s3Mock.commandCalls(PutObjectCommand)[0].args[0].input).toMatchObject({
      Bucket: "workspace-bucket",
      Key: insertedRows[0].s3_key,
      Body: "# Report",
    });
    expect(result).toMatchObject({ content: "# Report", s3Key: insertedRows[0].s3_key });
  });

  it("rejects client-managed payload S3 keys", async () => {
    const { createArtifact } = await import(
      "../graphql/resolvers/artifacts/createArtifact.mutation.js"
    );

    await expect(
      createArtifact(
        null,
        {
          input: {
            tenantId: "tenant-1",
            title: "Report",
            type: "REPORT",
            s3Key: "tenants/tenant-1/artifact-payloads/artifacts/a/content.md",
          },
        },
        {} as any,
      ),
    ).rejects.toThrow(/server-managed/);
  });

  it("updates content through an immutable revision key", async () => {
    const { updateArtifact } = await import(
      "../graphql/resolvers/artifacts/updateArtifact.mutation.js"
    );
    selectRows.push({
      id: "artifact-2",
      tenant_id: "tenant-1",
      title: "Report",
      type: "report",
      status: "final",
      content: null,
      s3_key: "tenants/tenant-1/artifact-payloads/artifacts/artifact-2/content.md",
      created_at: new Date(),
      updated_at: new Date(),
    });
    s3Mock.on(PutObjectCommand).resolves({});
    s3Mock.on(GetObjectCommand).resolves({
      Body: { transformToString: async () => "next" } as any,
    });

    await updateArtifact(
      null,
      { id: "artifact-2", input: { content: "next" } },
      {} as any,
    );

    expect(updatedRows[0].s3_key).toBe(
      "tenants/tenant-1/artifact-payloads/artifacts/artifact-2/content/revision-1.md",
    );
    expect(s3Mock.commandCalls(PutObjectCommand)[0].args[0].input).toMatchObject({
      Key: updatedRows[0].s3_key,
      Body: "next",
    });
  });

  it("favoriting an artifact stores favorited_at as a Date", async () => {
    const { updateArtifact } = await import(
      "../graphql/resolvers/artifacts/updateArtifact.mutation.js"
    );
    selectRows.push({
      id: "artifact-3",
      tenant_id: "tenant-1",
      title: "Report",
      type: "report",
      status: "final",
      content: null,
      s3_key: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    await updateArtifact(
      null,
      {
        id: "artifact-3",
        input: { favoritedAt: "2026-05-10T18:30:00.000Z" },
      },
      {} as any,
    );

    expect(updatedRows[0].favorited_at).toBeInstanceOf(Date);
    expect((updatedRows[0].favorited_at as Date).toISOString()).toBe(
      "2026-05-10T18:30:00.000Z",
    );
  });

  it("explicit null on favoritedAt clears the field", async () => {
    const { updateArtifact } = await import(
      "../graphql/resolvers/artifacts/updateArtifact.mutation.js"
    );
    selectRows.push({
      id: "artifact-4",
      tenant_id: "tenant-1",
      title: "Report",
      type: "report",
      status: "final",
      content: null,
      s3_key: null,
      favorited_at: new Date("2026-05-09T00:00:00.000Z"),
      created_at: new Date(),
      updated_at: new Date(),
    });

    await updateArtifact(
      null,
      { id: "artifact-4", input: { favoritedAt: null } },
      {} as any,
    );

    expect(updatedRows[0].favorited_at).toBeNull();
  });

  it("omitting favoritedAt leaves the existing value untouched", async () => {
    const { updateArtifact } = await import(
      "../graphql/resolvers/artifacts/updateArtifact.mutation.js"
    );
    selectRows.push({
      id: "artifact-5",
      tenant_id: "tenant-1",
      title: "Report",
      type: "report",
      status: "final",
      content: null,
      s3_key: null,
      favorited_at: new Date("2026-05-09T00:00:00.000Z"),
      created_at: new Date(),
      updated_at: new Date(),
    });

    await updateArtifact(
      null,
      { id: "artifact-5", input: { title: "Renamed" } },
      {} as any,
    );

    expect("favorited_at" in updatedRows[0]).toBe(false);
  });
});
