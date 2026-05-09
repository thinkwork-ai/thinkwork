import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppletMetadataV1 } from "../lib/applets/metadata.js";

const {
  mockDb,
  selectRows,
  insertedRows,
  updatedRows,
} = vi.hoisted(() => {
  const selectRows: any[] = [];
  const insertedRows: any[] = [];
  const updatedRows: any[] = [];

  const selectBuilder = {
    from: vi.fn(() => selectBuilder),
    where: vi.fn(() => selectBuilder),
    orderBy: vi.fn(() => selectBuilder),
    limit: vi.fn(() => Promise.resolve(selectRows)),
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
    returning: vi.fn(() => Promise.resolve(updatedRows.slice(-1))),
  };

  return {
    selectRows,
    insertedRows,
    updatedRows,
    mockDb: {
      select: vi.fn(() => selectBuilder),
      insert: vi.fn(() => insertBuilder),
      update: vi.fn(() => updateBuilder),
    },
  };
});

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCaller: vi.fn(async (ctx: any) => ({
    tenantId: ctx.auth.tenantId,
    userId: ctx.auth.principalId,
  })),
}));

vi.mock("../graphql/utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../graphql/utils.js")>();
  return {
    ...actual,
    db: mockDb,
  };
});

const s3Mock = mockClient(S3Client);

describe("applet GraphQL resolvers", () => {
  beforeEach(() => {
    s3Mock.reset();
    selectRows.length = 0;
    insertedRows.length = 0;
    updatedRows.length = 0;
    vi.clearAllMocks();
    process.env.WORKSPACE_BUCKET = "workspace-bucket";
  });

  it(
    "saves a valid applet source and metadata before inserting the artifact row",
    async () => {
      const { mutationResolvers } = await import("../graphql/resolvers/index.js");
      s3Mock.on(PutObjectCommand).resolves({});

      const result = await mutationResolvers.saveApplet(
        null,
        {
          input: validSaveInput({
            files: {
              "App.tsx":
                'import { AppHeader } from "@thinkwork/computer-stdlib"; export default function Applet() { return <AppHeader title="Risk" />; }',
            },
            metadata: {
              threadId: "11111111-1111-4111-8111-111111111111",
              prompt: "Show risk",
              stdlibVersionAtGeneration: "0.1.0",
            },
          }),
        },
        serviceCtx(),
      );

      expect(result).toMatchObject({
        ok: true,
        version: 1,
        validated: true,
        persisted: true,
        errors: [],
      });
      expect(result.appId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );

      const puts = s3Mock.commandCalls(PutObjectCommand);
      expect(puts).toHaveLength(2);
      expect(puts[0].args[0].input).toMatchObject({
        Bucket: "workspace-bucket",
        Key: `tenants/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/applets/${result.appId}/source.tsx`,
        ContentType: "text/plain; charset=utf-8",
      });
      expect(puts[1].args[0].input).toMatchObject({
        Bucket: "workspace-bucket",
        Key: `tenants/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/applets/${result.appId}/metadata.json`,
        ContentType: "application/json",
      });
      expect(insertedRows[0]).toMatchObject({
        id: result.appId,
        tenant_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        agent_id: "22222222-2222-4222-8222-222222222222",
        thread_id: "11111111-1111-4111-8111-111111111111",
        title: "Pipeline Risk",
        type: "applet",
        status: "final",
        s3_key: `tenants/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/applets/${result.appId}/source.tsx`,
      });
      expect(insertedRows[0].metadata).toMatchObject({
        appId: result.appId,
        name: "Pipeline Risk",
        version: 1,
        tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        prompt: "Show risk",
      });
    },
    15000,
  );

  it("returns structured validation errors and does not persist invalid imports", async () => {
    const { mutationResolvers } = await import("../graphql/resolvers/index.js");

    const result = await mutationResolvers.saveApplet(
      null,
      {
        input: validSaveInput({
          files: {
            "App.tsx":
              'import lodash from "lodash"; export default function Applet() { return lodash; }',
          },
        }),
      },
      serviceCtx(),
    );

    expect(result).toMatchObject({
      ok: false,
      validated: false,
      persisted: false,
    });
    expect(result.errors[0]).toMatchObject({
      code: "IMPORT_NOT_ALLOWED",
    });
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect(insertedRows).toHaveLength(0);
  });

  it("does not write metadata when the source write fails", async () => {
    const { mutationResolvers } = await import("../graphql/resolvers/index.js");
    s3Mock.on(PutObjectCommand).rejectsOnce(new Error("source write failed"));

    const result = await mutationResolvers.saveApplet(
      null,
      { input: validSaveInput() },
      serviceCtx(),
    );

    expect(result).toMatchObject({
      ok: false,
      validated: true,
      persisted: false,
    });
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(1);
    expect(insertedRows).toHaveLength(0);
  });

  it("regenerates an existing applet by incrementing version and preserving appId", async () => {
    const { mutationResolvers } = await import("../graphql/resolvers/index.js");
    const appId = "33333333-3333-4333-8333-333333333333";
    selectRows.push(appletRow({ id: appId, metadata: metadata({ appId, version: 2 }) }));
    s3Mock.on(PutObjectCommand).resolves({});

    const result = await mutationResolvers.regenerateApplet(
      null,
      {
        input: validSaveInput({
          appId,
          name: "Pipeline Risk v3",
          metadata: { prompt: "Refresh it" },
        }),
      },
      serviceCtx(),
    );

    expect(result).toMatchObject({
      ok: true,
      appId,
      version: 3,
      validated: true,
      persisted: true,
    });
    expect(updatedRows[0]).toMatchObject({
      title: "Pipeline Risk v3",
      metadata: expect.objectContaining({
        appId,
        version: 3,
        prompt: "Refresh it",
      }),
    });
  });

  it("returns not found for regenerate when the applet does not exist", async () => {
    const { mutationResolvers } = await import("../graphql/resolvers/index.js");

    const result = await mutationResolvers.regenerateApplet(
      null,
      {
        input: validSaveInput({
          appId: "33333333-3333-4333-8333-333333333333",
        }),
      },
      serviceCtx(),
    );

    expect(result).toMatchObject({
      ok: false,
      appId: "33333333-3333-4333-8333-333333333333",
      persisted: false,
      errors: [expect.objectContaining({ code: "NOT_FOUND" })],
    });
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it("loads an applet payload with source and reconstructed files", async () => {
    const { queryResolvers } = await import("../graphql/resolvers/index.js");
    const appId = "33333333-3333-4333-8333-333333333333";
    const source = "export default function Applet() { return null; }";
    selectRows.push(appletRow({ id: appId, metadata: metadata({ appId }) }));
    s3Mock.on(GetObjectCommand).resolves({
      Body: { transformToString: async () => source } as any,
    });

    const result = await queryResolvers.applet(
      null,
      { appId },
      userCtx(),
    );

    expect(result).toMatchObject({
      applet: {
        appId,
        name: "Pipeline Risk",
        version: 1,
        tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      files: { "App.tsx": source },
      source,
    });
  });

  it("lists metadata previews without source bodies", async () => {
    const { queryResolvers } = await import("../graphql/resolvers/index.js");
    selectRows.push(
      appletRow({
        id: "33333333-3333-4333-8333-333333333333",
        metadata: metadata({ appId: "33333333-3333-4333-8333-333333333333" }),
      }),
    );

    const result = await queryResolvers.applets(null, { limit: 10 }, userCtx());

    expect(result).toMatchObject({
      nodes: [
        {
          appId: "33333333-3333-4333-8333-333333333333",
          name: "Pipeline Risk",
          version: 1,
        },
      ],
      nextCursor: null,
    });
    expect(result.nodes[0]).not.toHaveProperty("source");
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
  });

  it("saves and loads applet state by appId, instanceId, and key", async () => {
    const { mutationResolvers, queryResolvers } = await import(
      "../graphql/resolvers/index.js"
    );
    const appId = "33333333-3333-4333-8333-333333333333";
    selectRows.push(appletRow({ id: appId, metadata: metadata({ appId }) }));

    const saved = await mutationResolvers.saveAppletState(
      null,
      {
        input: {
          appId,
          instanceId: "route-1",
          key: "form",
          value: { agenda: ["renewal"] },
        },
      },
      userCtx(),
    );

    expect(saved).toMatchObject({
      appId,
      instanceId: "route-1",
      key: "form",
      value: { agenda: ["renewal"] },
    });
    expect(insertedRows[0]).toMatchObject({
      tenant_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      thread_id: "11111111-1111-4111-8111-111111111111",
      type: "applet_state",
      status: "final",
      metadata: expect.objectContaining({
        kind: "computer_applet_state",
        appId,
        instanceId: "route-1",
        key: "form",
        value: { agenda: ["renewal"] },
      }),
    });

    selectRows.push(insertedRows[0]);

    await expect(
      queryResolvers.appletState(
        null,
        { appId, instanceId: "route-1", key: "form" },
        userCtx(),
      ),
    ).resolves.toMatchObject({
      appId,
      instanceId: "route-1",
      key: "form",
      value: { agenda: ["renewal"] },
    });
  });

  it("updates existing applet state without colliding across instances", async () => {
    const { mutationResolvers } = await import("../graphql/resolvers/index.js");
    const appId = "33333333-3333-4333-8333-333333333333";
    selectRows.push(
      appletRow({ id: appId, metadata: metadata({ appId }) }),
      appletStateRow({
        appId,
        instanceId: "route-1",
        key: "form",
        value: { agenda: ["old"] },
      }),
      appletStateRow({
        appId,
        instanceId: "route-2",
        key: "form",
        value: { agenda: ["other"] },
      }),
    );

    const saved = await mutationResolvers.saveAppletState(
      null,
      {
        input: {
          appId,
          instanceId: "route-1",
          key: "form",
          value: { agenda: ["new"] },
        },
      },
      userCtx(),
    );

    expect(saved).toMatchObject({
      appId,
      instanceId: "route-1",
      key: "form",
      value: { agenda: ["new"] },
    });
    expect(updatedRows[0]).toMatchObject({
      metadata: expect.objectContaining({
        instanceId: "route-1",
        value: { agenda: ["new"] },
      }),
    });
  });
});

function validSaveInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Pipeline Risk",
    files: { "App.tsx": "export default function Applet() { return null; }" },
    metadata: { stdlibVersionAtGeneration: "0.1.0" },
    ...overrides,
  };
}

function serviceCtx() {
  return {
    auth: {
      authType: "apikey",
      tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      principalId: "service",
      agentId: "22222222-2222-4222-8222-222222222222",
    },
  } as any;
}

function userCtx() {
  return {
    auth: {
      authType: "cognito",
      tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      principalId: "user-1",
      agentId: null,
    },
  } as any;
}

function appletRow(overrides: Record<string, unknown> = {}) {
  const appId = String(
    overrides.id ?? "33333333-3333-4333-8333-333333333333",
  );
  return {
    id: appId,
    tenant_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    agent_id: "22222222-2222-4222-8222-222222222222",
    thread_id: "11111111-1111-4111-8111-111111111111",
    title: "Pipeline Risk",
    type: "applet",
    status: "final",
    content: null,
    s3_key: `tenants/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/applets/${appId}/source.tsx`,
    summary: null,
    source_message_id: null,
    metadata: metadata({ appId }),
    created_at: new Date("2026-05-09T12:00:00.000Z"),
    updated_at: new Date("2026-05-09T12:00:00.000Z"),
    ...overrides,
  };
}

function appletStateRow({
  appId,
  instanceId,
  key,
  value,
}: {
  appId: string;
  instanceId: string;
  key: string;
  value: unknown;
}) {
  return {
    id: `${appId}-${instanceId}-${key}`,
    tenant_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    agent_id: "22222222-2222-4222-8222-222222222222",
    thread_id: "11111111-1111-4111-8111-111111111111",
    title: `Applet state: ${key}`,
    type: "applet_state",
    status: "final",
    content: null,
    s3_key: null,
    summary: null,
    source_message_id: null,
    metadata: {
      schemaVersion: 1,
      kind: "computer_applet_state",
      appId,
      instanceId,
      key,
      value,
    },
    created_at: new Date("2026-05-09T12:00:00.000Z"),
    updated_at: new Date("2026-05-09T12:00:00.000Z"),
  };
}

function metadata(
  overrides: Partial<AppletMetadataV1> = {},
): AppletMetadataV1 {
  return {
    schemaVersion: 1,
    kind: "computer_applet",
    appId: "33333333-3333-4333-8333-333333333333",
    name: "Pipeline Risk",
    version: 1,
    tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    threadId: "11111111-1111-4111-8111-111111111111",
    prompt: "Show pipeline risk",
    agentVersion: "agent-v1",
    modelId: "us.amazon.nova-pro-v1:0",
    generatedAt: "2026-05-09T12:00:00.000Z",
    stdlibVersionAtGeneration: "0.1.0",
    ...overrides,
  };
}
