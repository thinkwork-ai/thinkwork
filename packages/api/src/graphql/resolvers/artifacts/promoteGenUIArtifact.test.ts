import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  THREAD_JSON_RENDER_CATALOG_VERSION,
  THREAD_JSON_RENDER_PART_TYPE,
  THREAD_JSON_RENDER_SCHEMA_VERSION,
  createThreadJsonRenderSpecHash,
  type ThreadJsonRenderPart,
} from "../../../lib/thread-json-render/persisted-parts.js";

const THREAD_ID = "33333333-3333-3333-3333-333333333333";
const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "55555555-5555-5555-5555-555555555555";
const SOURCE_MESSAGE_ID = "66666666-6666-6666-6666-666666666666";

const mocks = vi.hoisted(() => ({
  tables: {
    artifacts: {
      __table__: "artifacts",
      id: { name: "artifacts.id" },
      tenant_id: { name: "artifacts.tenant_id" },
      thread_id: { name: "artifacts.thread_id" },
      metadata: { name: "artifacts.metadata" },
    },
    messages: {
      __table__: "messages",
      id: { name: "messages.id" },
      thread_id: { name: "messages.thread_id" },
      tenant_id: { name: "messages.tenant_id" },
      role: { name: "messages.role" },
      parts: { name: "messages.parts" },
    },
    threads: {
      __table__: "threads",
      id: { name: "threads.id" },
      tenant_id: { name: "threads.tenant_id" },
      agent_id: { name: "threads.agent_id" },
    },
  },
  insertedRows: [] as Array<Record<string, unknown>>,
  selectQueue: [] as Array<Array<Record<string, unknown>>>,
  resolveCallerFromAuth: vi.fn(),
  requireTenantMember: vi.fn(),
  visiblePredicate: vi.fn(() => ({ visible: true })),
  persistArtifactContentPayload: vi.fn(),
  artifactToCamelWithPayload: vi.fn((row: Record<string, unknown>) => ({
    id: row.id,
    title: row.title,
    type: row.type,
    content: row.content,
    s3Key: row.s3_key,
    metadata: row.metadata,
  })),
}));

vi.mock("../../utils.js", () => {
  const insertBuilder = {
    values: vi.fn((row: Record<string, unknown>) => {
      mocks.insertedRows.push(row);
      return insertBuilder;
    }),
    returning: vi.fn(() =>
      Promise.resolve([
        {
          ...mocks.insertedRows.at(-1),
          created_at: new Date("2026-06-21T00:00:00Z"),
          updated_at: new Date("2026-06-21T00:00:00Z"),
        },
      ]),
    ),
  };
  return {
    and: (...conditions: unknown[]) => ({ and: conditions }),
    artifacts: mocks.tables.artifacts,
    db: {
      insert: vi.fn(() => insertBuilder),
      select: () => ({
        from: () => ({
          where: () => {
            const rows = mocks.selectQueue.shift() ?? [];
            const promise = Promise.resolve(rows);
            return Object.assign(promise, {
              limit: () => Promise.resolve(rows),
            });
          },
        }),
      }),
    },
    eq: (field: unknown, value: unknown) => ({ eq: [field, value] }),
    messages: mocks.tables.messages,
    randomUUID: vi.fn(() => "artifact-1"),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      sql: strings.join("?"),
      values,
    }),
    threads: mocks.tables.threads,
  };
});

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
  persistArtifactContentPayload: mocks.persistArtifactContentPayload,
}));

import { promoteGenUIArtifact } from "./promoteGenUIArtifact.mutation.js";

const ctx = { auth: { authType: "cognito" } } as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.insertedRows.length = 0;
  mocks.selectQueue = [];
  mocks.resolveCallerFromAuth.mockResolvedValue({
    userId: USER_ID,
    tenantId: TENANT_ID,
  });
  mocks.requireTenantMember.mockResolvedValue("member");
  mocks.persistArtifactContentPayload.mockResolvedValue(
    "tenants/tenant-1/artifact-payloads/artifacts/artifact-1/content.md",
  );
});

describe("promoteGenUIArtifact", () => {
  it("snapshots the persisted json-render part into a DATA_VIEW artifact", async () => {
    const fixture = createTaskReviewJsonRenderFixture();
    enqueueHappySource(fixture);
    mocks.selectQueue.push([]); // duplicate lookup

    const result = await promoteGenUIArtifact(
      {},
      { input: promotionInput(fixture) },
      ctx,
    );

    expect(result.id).toBe("artifact-1");
    expect(mocks.persistArtifactContentPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId: "artifact-1",
        contentType: "application/json; charset=utf-8",
        type: "data_view",
      }),
    );
    const payload = JSON.parse(
      mocks.persistArtifactContentPayload.mock.calls[0][0].content,
    );
    expect(payload).toMatchObject({
      schemaVersion: "thread-json-render-artifact-snapshot/v1",
      kind: "json_render_snapshot",
      source: {
        threadId: THREAD_ID,
        sourceMessageId: SOURCE_MESSAGE_ID,
        partId: fixture.id,
        specHash: fixture.data.specHash,
        promotedByUserId: USER_ID,
      },
      jsonRender: {
        type: "data-json-render",
        id: fixture.id,
      },
    });
    expect(mocks.insertedRows[0]).toMatchObject({
      id: "artifact-1",
      tenant_id: TENANT_ID,
      agent_id: "agent-1",
      thread_id: THREAD_ID,
      type: "data_view",
      status: "final",
      source_message_id: SOURCE_MESSAGE_ID,
      metadata: {
        kind: "json_render_snapshot",
        schemaVersion: "thread-json-render-artifact-snapshot/v1",
        jsonRenderSnapshot: expect.objectContaining({
          partId: fixture.id,
          specHash: fixture.data.specHash,
          idempotencyKey: "idem-1",
        }),
      },
    });
  });

  it("coalesces duplicate promotion clicks by idempotency key", async () => {
    const fixture = createTaskReviewJsonRenderFixture();
    enqueueHappySource(fixture);
    mocks.selectQueue.push([
      {
        id: "artifact-existing",
        title: "Existing",
        type: "data_view",
        metadata: { kind: "json_render_snapshot" },
      },
    ]);

    const result = await promoteGenUIArtifact(
      {},
      { input: promotionInput(fixture) },
      ctx,
    );

    expect(result.id).toBe("artifact-existing");
    expect(mocks.persistArtifactContentPayload).not.toHaveBeenCalled();
    expect(mocks.insertedRows).toHaveLength(0);
  });

  it("rejects stale promotion requests before writing artifacts", async () => {
    const fixture = createTaskReviewJsonRenderFixture();
    enqueueHappySource(fixture);

    await expect(
      promoteGenUIArtifact(
        {},
        { input: { ...promotionInput(fixture), specHash: "old" } },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "CONFLICT" } });
    expect(mocks.persistArtifactContentPayload).not.toHaveBeenCalled();
    expect(mocks.insertedRows).toHaveLength(0);
  });

  it("rejects non-ready json-render parts", async () => {
    const fixture = {
      ...createTaskReviewJsonRenderFixture(),
      data: {
        ...createTaskReviewJsonRenderFixture().data,
        status: "stale" as const,
      },
    };
    enqueueHappySource(fixture);

    await expect(
      promoteGenUIArtifact(
        {},
        { input: promotionInput(createTaskReviewJsonRenderFixture()) },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expect(mocks.persistArtifactContentPayload).not.toHaveBeenCalled();
  });
});

function enqueueHappySource(fixture: ThreadJsonRenderPart) {
  mocks.selectQueue.push([{ id: THREAD_ID, agent_id: "agent-1" }]);
  mocks.selectQueue.push([
    {
      id: SOURCE_MESSAGE_ID,
      thread_id: THREAD_ID,
      tenant_id: TENANT_ID,
      role: "assistant",
      parts: [fixture],
    },
  ]);
}

function promotionInput(fixture: ThreadJsonRenderPart) {
  return {
    threadId: THREAD_ID,
    sourceMessageId: SOURCE_MESSAGE_ID,
    partId: fixture.id,
    specHash: fixture.data.specHash!,
    idempotencyKey: "idem-1",
  };
}

function createTaskReviewJsonRenderFixture(): ThreadJsonRenderPart {
  const spec = {
    root: "review",
    elements: {
      review: {
        type: "task.review",
        props: {
          title: "Review onboarding task",
          summary: "Confirm the customer kickoff task is ready.",
          status: "pending",
          primaryActionId: "approve-task",
        },
        children: [],
      },
    },
  };
  return {
    type: THREAD_JSON_RENDER_PART_TYPE,
    id: "json-render:task-review:123",
    data: {
      schemaVersion: THREAD_JSON_RENDER_SCHEMA_VERSION,
      catalogVersion: THREAD_JSON_RENDER_CATALOG_VERSION,
      status: "ready",
      spec,
      mobileFallback: {
        title: "Review onboarding task",
        summary: "Confirm the customer kickoff task is ready.",
      },
      durableActions: [
        {
          id: "approve-task",
          label: "Approve",
          kind: "approve",
          params: { taskId: "task-123" },
        },
      ],
      specHash: createThreadJsonRenderSpecHash(spec),
    },
  };
}
