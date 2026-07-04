import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTaskReviewJsonRenderFixture,
  stableStringify,
} from "@thinkwork/thread-json-render";

const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "55555555-5555-5555-5555-555555555555";
const ARTIFACT_ID = "77777777-7777-7777-7777-777777777777";
const SPACE_ID = "88888888-8888-8888-8888-888888888888";
const OTHER_SPACE_ID = "99999999-9999-9999-9999-999999999999";
const THREAD_ID = "33333333-3333-3333-3333-333333333333";

const fixture = createTaskReviewJsonRenderFixture();

const mocks = vi.hoisted(() => ({
  selectQueue: [] as Array<Array<Record<string, unknown>>>,
  updateCalls: [] as Array<{ set: Record<string, unknown> }>,
  resolveCallerFromAuth: vi.fn(),
  requireTenantMember: vi.fn(),
  assertCanvasAccess: vi.fn(),
  materialize: vi.fn(),
  loadCanvasHeadContent: vi.fn(),
  artifactToCamelWithPayload: vi.fn((row: Record<string, unknown>) => ({
    id: row.id,
    status: row.status,
    spaceId: row.space_id,
  })),
}));

vi.mock("../../utils.js", () => {
  const updateBuilder = {
    set: vi.fn((set: Record<string, unknown>) => {
      mocks.updateCalls.push({ set });
      return updateBuilder;
    }),
    where: vi.fn(() => Promise.resolve(undefined)),
  };
  return {
    and: (...conditions: unknown[]) => ({ and: conditions }),
    eq: (field: unknown, value: unknown) => ({ eq: [field, value] }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      sql: strings.join("?"),
      values,
    }),
    artifacts: {
      id: { name: "artifacts.id" },
      tenant_id: { name: "artifacts.tenant_id" },
      metadata: { name: "artifacts.metadata" },
    },
    threads: {
      id: { name: "threads.id" },
      tenant_id: { name: "threads.tenant_id" },
      space_id: { name: "threads.space_id" },
      agent_id: { name: "threads.agent_id" },
    },
    db: {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(mocks.selectQueue.shift() ?? []),
        }),
      }),
      update: vi.fn(() => updateBuilder),
    },
  };
});

vi.mock("../core/authz.js", () => ({
  requireTenantMember: mocks.requireTenantMember,
}));
vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerFromAuth: mocks.resolveCallerFromAuth,
}));
vi.mock("../../../lib/artifacts/canvas-access.js", () => ({
  assertCanvasAccess: mocks.assertCanvasAccess,
}));
vi.mock("../../../lib/artifacts/canvas-lifecycle.js", () => ({
  isLivingCanvasMetadata: (metadata: unknown) =>
    !!metadata &&
    typeof metadata === "object" &&
    (metadata as { kind?: unknown }).kind === "json_render_canvas",
  loadCanvasHeadContent: mocks.loadCanvasHeadContent,
}));
vi.mock("../../../lib/artifacts/canvas-materialize.js", () => ({
  materializeCanvasIntoThread: mocks.materialize,
}));
vi.mock("./payload.js", () => ({
  artifactToCamelWithPayload: mocks.artifactToCamelWithPayload,
}));

import { checkoutCanvas } from "./checkoutCanvas.mutation.js";

const ctx = { auth: { authType: "cognito" } } as never;

function canvasRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ARTIFACT_ID,
    tenant_id: TENANT_ID,
    type: "data_view",
    status: "final",
    content: null,
    s3_key: `tenants/${TENANT_ID}/artifact-payloads/artifacts/${ARTIFACT_ID}/content.md`,
    head_version: 3,
    head_write_seq: 3,
    space_id: SPACE_ID,
    agent_id: null,
    metadata: { kind: "json_render_canvas", stablePartId: fixture.id },
    ...overrides,
  };
}

function threadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: THREAD_ID,
    tenant_id: TENANT_ID,
    space_id: SPACE_ID,
    agent_id: "44444444-4444-4444-4444-444444444444",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectQueue = [];
  mocks.updateCalls = [];
  mocks.resolveCallerFromAuth.mockResolvedValue({
    userId: USER_ID,
    tenantId: TENANT_ID,
  });
  mocks.requireTenantMember.mockResolvedValue("member");
  mocks.assertCanvasAccess.mockResolvedValue(undefined);
  mocks.materialize.mockResolvedValue({ messageId: "m", eventSeq: 1 });
  mocks.loadCanvasHeadContent.mockResolvedValue(stableStringify(fixture));
});

describe("checkoutCanvas", () => {
  it("same-space checkout materializes the head under its original stable part id + records linkage", async () => {
    mocks.selectQueue.push([canvasRow()]); // artifact
    mocks.selectQueue.push([threadRow()]); // target thread
    mocks.selectQueue.push([canvasRow()]); // refreshed return

    const result = await checkoutCanvas(
      {},
      { artifactId: ARTIFACT_ID, threadId: THREAD_ID },
      ctx,
    );

    expect(result).toMatchObject({ id: ARTIFACT_ID, status: "final" });
    // Materialized under the ORIGINAL stable part id, into the target thread.
    expect(mocks.materialize).toHaveBeenCalledTimes(1);
    const call = mocks.materialize.mock.calls[0][0];
    expect(call.threadId).toBe(THREAD_ID);
    expect(call.part.id).toBe(fixture.id);
    // Checkout linkage recorded on the artifact metadata (jsonb_set checkouts).
    expect(mocks.updateCalls).toHaveLength(1);
    expect(mocks.updateCalls[0].set.metadata).toBeDefined();
  });

  it("rejects a cross-space checkout with a typed CROSS_SPACE_CHECKOUT error", async () => {
    mocks.selectQueue.push([canvasRow({ space_id: SPACE_ID })]);
    mocks.selectQueue.push([threadRow({ space_id: OTHER_SPACE_ID })]);

    await expect(
      checkoutCanvas({}, { artifactId: ARTIFACT_ID, threadId: THREAD_ID }, ctx),
    ).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN", reason: "CROSS_SPACE_CHECKOUT" },
    });
    // Never materialized on rejection.
    expect(mocks.materialize).not.toHaveBeenCalled();
  });

  it("rejects checking out a draft (unsaved, null-space) canvas", async () => {
    mocks.selectQueue.push([canvasRow({ status: "draft", space_id: null })]);

    await expect(
      checkoutCanvas({}, { artifactId: ARTIFACT_ID, threadId: THREAD_ID }, ctx),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
  });

  it("rejects a non-canvas artifact", async () => {
    mocks.selectQueue.push([canvasRow({ metadata: { kind: "other" } })]);

    await expect(
      checkoutCanvas({}, { artifactId: ARTIFACT_ID, threadId: THREAD_ID }, ctx),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
  });

  it("propagates a write-access denial (non-member of the space)", async () => {
    mocks.selectQueue.push([canvasRow()]);
    mocks.assertCanvasAccess.mockRejectedValue(
      Object.assign(new Error("no"), { extensions: { code: "FORBIDDEN" } }),
    );

    await expect(
      checkoutCanvas({}, { artifactId: ARTIFACT_ID, threadId: THREAD_ID }, ctx),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.materialize).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when the target thread does not exist", async () => {
    mocks.selectQueue.push([canvasRow()]);
    mocks.selectQueue.push([]); // no thread

    await expect(
      checkoutCanvas({}, { artifactId: ARTIFACT_ID, threadId: THREAD_ID }, ctx),
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });
});
