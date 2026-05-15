import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, selectRows, insertedRows } = vi.hoisted(() => {
  const selectRows: any[] = [];
  const insertedRows: any[] = [];

  const selectBuilder: any = {
    from: vi.fn(() => selectBuilder),
    where: vi.fn(() => selectBuilder),
    orderBy: vi.fn(() => Promise.resolve(selectRows)),
    then: (resolve: (rows: any[]) => unknown) => resolve(selectRows),
  };
  const insertBuilder: any = {
    values: vi.fn((row: any) => {
      insertedRows.push(row);
      return insertBuilder;
    }),
    returning: vi.fn(() => Promise.resolve(insertedRows.slice(-1))),
  };

  // The U6 artifact emit wraps insert + emitAuditEvent in a transaction.
  // Mock transaction by re-using mockDb as the tx handle — the builders
  // are stateful via the shared insertedRows / selectRows arrays, so a
  // single instance is sufficient.
  const mockDb: any = {
    select: vi.fn(() => selectBuilder),
    insert: vi.fn(() => insertBuilder),
    transaction: vi.fn(async (cb: (tx: any) => unknown) => cb(mockDb)),
  };

  return {
    selectRows,
    insertedRows,
    mockDb,
  };
});

vi.mock("../lib/db.js", () => ({ db: mockDb }));

const s3Mock = mockClient(S3Client);

describe("message artifact payload handler", () => {
  beforeEach(() => {
    selectRows.length = 0;
    insertedRows.length = 0;
    s3Mock.reset();
    process.env.API_AUTH_SECRET = "secret";
    process.env.WORKSPACE_BUCKET = "workspace-bucket";
    vi.clearAllMocks();
  });

  it("stores posted message artifact content in S3 and keeps DB content null", async () => {
    const { handler } = await import("../handlers/messages.js");
    selectRows.push({
      thread_id: "thread-1",
      tenant_id: "tenant-1",
    });
    s3Mock.on(PutObjectCommand).resolves({});

    const response = await handler(
      event("POST", "/api/messages/message-1/artifacts", {
        artifact_type: "text",
        name: "notes.md",
        content: "hello",
        s3_key: "tenants/tenant-1/artifact-payloads/message-artifacts/other/content",
      }),
    );

    expect(response.statusCode).toBe(201);
    expect(insertedRows[0]).toMatchObject({
      content: null,
      s3_key: expect.stringMatching(
        /^tenants\/tenant-1\/artifact-payloads\/message-artifacts\/[0-9a-f-]+\/content\/[0-9a-f-]+$/,
      ),
    });
    expect(insertedRows[0].s3_key).not.toContain("other");
    expect(s3Mock.commandCalls(PutObjectCommand)[0].args[0].input).toMatchObject({
      Bucket: "workspace-bucket",
      Key: insertedRows[0].s3_key,
      Body: "hello",
    });
    expect(JSON.parse(response.body ?? "{}")).toMatchObject({ content: "hello" });
  });

  it("hydrates S3-backed message artifact content when listing", async () => {
    const { handler } = await import("../handlers/messages.js");
    const key =
      "tenants/tenant-1/artifact-payloads/message-artifacts/artifact-1/content/revision-1";
    selectRows.push({
      id: "artifact-1",
      message_id: "message-1",
      tenant_id: "tenant-1",
      content: null,
      s3_key: key,
      created_at: new Date(),
    });
    s3Mock.on(GetObjectCommand, { Key: key }).resolves({
      Body: { transformToString: async () => "from s3" } as any,
    });

    const response = await handler(event("GET", "/api/messages/message-1/artifacts"));

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "[]")[0]).toMatchObject({
      content: "from s3",
    });
  });
});

function event(method: string, rawPath: string, body?: unknown): any {
  return {
    rawPath,
    headers: { authorization: "Bearer secret" },
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method } },
  };
}
