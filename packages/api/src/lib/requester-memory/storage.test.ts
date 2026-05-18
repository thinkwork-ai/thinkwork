import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import {
  dreamingReportPath,
  dreamingStatePath,
  isRequesterMemorySourcePath,
  listRequesterMemoryFiles,
  readRequesterMemoryFile,
  readIdleLearningReport,
  readRequesterMemorySourceFile,
  requesterMemoryKey,
  requesterMemorySnapshotKey,
  restoreRequesterMemorySnapshot,
  writeRequesterMemoryInternalFile,
  writeIdleLearningReport,
  writeRequesterMemoryFileWithSnapshot,
} from "./storage.js";

const s3Mock = mockClient(S3Client);

function s3Body(content: string) {
  return {
    Body: {
      transformToString: async () => content,
    },
  } as any;
}

describe("requester memory storage", () => {
  beforeEach(() => {
    s3Mock.reset();
    process.env.WORKSPACE_BUCKET = "workspace-bucket";
  });

  it("builds tenant/user scoped keys for allowlisted requester memory paths", () => {
    expect(
      requesterMemoryKey({
        tenantId: "tenant-1",
        userId: "user-1",
        path: "memory/candidates/2026-05-18.md",
      }),
    ).toBe("tenants/tenant-1/users/user-1/memory/candidates/2026-05-18.md");
    expect(
      requesterMemoryKey({
        tenantId: "tenant-1",
        userId: "user-1",
        path: "memory/DREAMS.md",
      }),
    ).toBe("tenants/tenant-1/users/user-1/memory/DREAMS.md");
    expect(dreamingReportPath("rem", "2026-05-18")).toBe(
      "memory/dreaming/rem/2026-05-18.md",
    );
    expect(dreamingStatePath("2026-05-18.json")).toBe(
      "memory/.dreams/2026-05-18.json",
    );
  });

  it("rejects traversal, top-level user files, and workspace-owned paths", () => {
    const invalidPaths = [
      "../memory/MEMORY.md",
      "memory/../MEMORY.md",
      "/memory/MEMORY.md",
      "USER.md",
      "REQUESTER.md",
      "skills/test/SKILL.md",
      "tools/foo.md",
      "workspace/USER.md",
      "memory/.state/thread-idle/run-1.json",
    ];

    for (const path of invalidPaths) {
      expect(() =>
        requesterMemoryKey({
          tenantId: "tenant-1",
          userId: "user-1",
          path,
        }),
      ).toThrow();
    }
  });

  it("reads missing memory files as null", async () => {
    s3Mock
      .on(GetObjectCommand)
      .rejects(Object.assign(new Error("missing"), { name: "NoSuchKey" }));

    await expect(
      readRequesterMemoryFile({
        tenantId: "tenant-1",
        userId: "user-1",
        path: "memory/MEMORY.md",
      }),
    ).resolves.toBeNull();
  });

  it("lists public source and generated dreaming files while hiding internals by default", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: "tenants/tenant-1/users/user-1/memory/MEMORY.md", Size: 10 },
        { Key: "tenants/tenant-1/users/user-1/memory/DREAMS.md", Size: 11 },
        {
          Key: "tenants/tenant-1/users/user-1/memory/dreaming/rem/2026-05-18.md",
          Size: 12,
        },
        {
          Key: "tenants/tenant-1/users/user-1/memory/.dreams/2026-05-18.json",
          Size: 13,
        },
        {
          Key: "tenants/tenant-1/users/user-1/memory/reports/thread-idle/run-1.md",
          Size: 14,
        },
      ],
    });

    await expect(
      listRequesterMemoryFiles({ tenantId: "tenant-1", userId: "user-1" }),
    ).resolves.toEqual([
      expect.objectContaining({
        path: "memory/dreaming/rem/2026-05-18.md",
        size: 12,
      }),
      expect.objectContaining({ path: "memory/DREAMS.md", size: 11 }),
      expect.objectContaining({ path: "memory/MEMORY.md", size: 10 }),
    ]);
  });

  it("allows source reads for arbitrary memory markdown without allowing public writes there", async () => {
    s3Mock.on(GetObjectCommand).resolves(s3Body("# Contacts"));

    await expect(
      readRequesterMemorySourceFile({
        tenantId: "tenant-1",
        userId: "user-1",
        path: "memory/contacts.md",
      }),
    ).resolves.toBe("# Contacts");

    expect(isRequesterMemorySourcePath("memory/contacts.md")).toBe(true);
    expect(() =>
      requesterMemoryKey({
        tenantId: "tenant-1",
        userId: "user-1",
        path: "memory/contacts.md",
      }),
    ).toThrow();
  });

  it("snapshots the previous public memory file before writing new content", async () => {
    s3Mock.on(GetObjectCommand).resolves(s3Body("old candidates"));
    s3Mock.on(PutObjectCommand).resolves({});

    const result = await writeRequesterMemoryFileWithSnapshot({
      tenantId: "tenant-1",
      userId: "user-1",
      runId: "run-1",
      path: "memory/candidates/2026-05-18.md",
      content: "new candidates",
    });

    const snapshotKey = requesterMemorySnapshotKey({
      tenantId: "tenant-1",
      userId: "user-1",
      runId: "run-1",
      path: "memory/candidates/2026-05-18.md",
    });

    expect(result).toMatchObject({
      path: "memory/candidates/2026-05-18.md",
      key: "tenants/tenant-1/users/user-1/memory/candidates/2026-05-18.md",
      beforeBytes: 14,
      afterBytes: 14,
      snapshotKey,
      previousContent: "old candidates",
    });
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(2);
    expect(
      s3Mock.commandCalls(PutObjectCommand)[0].args[0].input,
    ).toMatchObject({
      Bucket: "workspace-bucket",
      Key: snapshotKey,
      Body: "old candidates",
    });
    expect(
      s3Mock.commandCalls(PutObjectCommand)[1].args[0].input,
    ).toMatchObject({
      Bucket: "workspace-bucket",
      Key: "tenants/tenant-1/users/user-1/memory/candidates/2026-05-18.md",
      Body: "new candidates",
    });
  });

  it("restores a requester memory file from its snapshot", async () => {
    const snapshotKey = requesterMemorySnapshotKey({
      tenantId: "tenant-1",
      userId: "user-1",
      runId: "run-1",
      path: "memory/candidates/2026-05-18.md",
    });
    s3Mock.on(GetObjectCommand).resolves(s3Body("restored candidates"));
    s3Mock.on(PutObjectCommand).resolves({});

    await restoreRequesterMemorySnapshot({
      tenantId: "tenant-1",
      userId: "user-1",
      path: "memory/candidates/2026-05-18.md",
      snapshotKey,
    });

    expect(
      s3Mock.commandCalls(PutObjectCommand)[0].args[0].input,
    ).toMatchObject({
      Key: "tenants/tenant-1/users/user-1/memory/candidates/2026-05-18.md",
      Body: "restored candidates",
    });
  });

  it("deletes the target when restoring a missing pre-write snapshot", async () => {
    s3Mock.on(DeleteObjectCommand).resolves({});

    await restoreRequesterMemorySnapshot({
      tenantId: "tenant-1",
      userId: "user-1",
      path: "memory/candidates/2026-05-18.md",
      snapshotKey: null,
    });

    expect(
      s3Mock.commandCalls(DeleteObjectCommand)[0].args[0].input,
    ).toMatchObject({
      Key: "tenants/tenant-1/users/user-1/memory/candidates/2026-05-18.md",
    });
  });

  it("writes idle-learning reports under the internal requester memory prefix", async () => {
    s3Mock.on(PutObjectCommand).resolves({});

    const report = await writeIdleLearningReport({
      tenantId: "tenant-1",
      userId: "user-1",
      runId: "run-1",
      markdown: "# Report",
    });

    expect(report).toMatchObject({
      path: "memory/reports/thread-idle/run-1.md",
      key: "tenants/tenant-1/users/user-1/memory/reports/thread-idle/run-1.md",
      bytes: 8,
    });
  });

  it("writes dreaming machine state under the internal requester memory prefix", async () => {
    s3Mock.on(PutObjectCommand).resolves({});

    const state = await writeRequesterMemoryInternalFile({
      tenantId: "tenant-1",
      userId: "user-1",
      path: "memory/.dreams/2026-05-18.json",
      content: "{}",
    });

    expect(state).toMatchObject({
      path: "memory/.dreams/2026-05-18.json",
      key: "tenants/tenant-1/users/user-1/memory/.dreams/2026-05-18.json",
    });
  });

  it("reads idle-learning reports from the internal requester memory prefix", async () => {
    s3Mock.on(GetObjectCommand).resolves(s3Body("# Report"));

    const report = await readIdleLearningReport({
      tenantId: "tenant-1",
      userId: "user-1",
      runId: "run-1",
    });

    expect(report).toBe("# Report");
    expect(
      s3Mock.commandCalls(GetObjectCommand)[0].args[0].input,
    ).toMatchObject({
      Bucket: "workspace-bucket",
      Key: "tenants/tenant-1/users/user-1/memory/reports/thread-idle/run-1.md",
    });
  });
});
