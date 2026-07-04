import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTaskReviewJsonRenderFixture,
  stableStringify,
  threadJsonRenderStateSnapshotPayload,
  type ThreadJsonRenderPart,
} from "@thinkwork/thread-json-render";

const CHECKED_OUT_THREAD = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORIGINAL_ARTIFACT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const THREAD_ID = "33333333-3333-3333-3333-333333333333";
const AGENT_ID = "44444444-4444-4444-4444-444444444444";

const mocks = vi.hoisted(() => ({
  inserts: [] as Array<Record<string, unknown>>,
  onConflicts: [] as Array<Record<string, unknown>>,
  s3Writes: [] as Array<Record<string, unknown>>,
  // Checkout-routing (U8): findCheckoutRoutedArtifact selects; head update
  // reads S3 then conditionally updates. Queues feed those in call order.
  selectQueue: [] as Array<Array<Record<string, unknown>>>,
  updateResults: [] as Array<Array<Record<string, unknown>>>,
  updateCalls: [] as Array<{ set: Record<string, unknown> }>,
  s3Reads: [] as string[],
}));

vi.mock("../../graphql/utils.js", () => {
  const insertBuilder = {
    values: vi.fn((row: Record<string, unknown>) => {
      mocks.inserts.push(row);
      return insertBuilder;
    }),
    onConflictDoUpdate: vi.fn((cfg: Record<string, unknown>) => {
      mocks.onConflicts.push(cfg);
      return Promise.resolve(undefined);
    }),
  };
  const updateBuilder = {
    set: vi.fn((set: Record<string, unknown>) => {
      mocks.updateCalls.push({ set });
      return updateBuilder;
    }),
    where: vi.fn(() => updateBuilder),
    returning: vi.fn(() =>
      Promise.resolve(mocks.updateResults.shift() ?? []),
    ),
  };
  const selectBuilder = {
    from: () => selectBuilder,
    where: () => selectBuilder,
    limit: () => Promise.resolve(mocks.selectQueue.shift() ?? []),
  };
  return {
    and: (...conditions: unknown[]) => ({ and: conditions }),
    eq: (field: unknown, value: unknown) => ({ eq: [field, value] }),
    artifacts: {
      id: { name: "artifacts.id" },
      status: { name: "status" },
      metadata: { name: "metadata" },
      head_write_seq: { name: "artifacts.head_write_seq" },
    },
    db: {
      insert: vi.fn(() => insertBuilder),
      update: vi.fn(() => updateBuilder),
      select: vi.fn(() => selectBuilder),
    },
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      sql: strings.join("?"),
      values,
    }),
  };
});

vi.mock("./payload-storage.js", () => ({
  artifactContentKey: vi.fn(
    ({ tenantId, artifactId, revision }: { tenantId: string; artifactId: string; revision?: string }) =>
      revision
        ? `tenants/${tenantId}/artifact-payloads/artifacts/${artifactId}/content/${revision}.md`
        : `tenants/${tenantId}/artifact-payloads/artifacts/${artifactId}/content.md`,
  ),
  isArtifactPayloadS3Key: () => true,
  readArtifactPayloadFromS3: () =>
    Promise.resolve(mocks.s3Reads.shift() ?? "{}"),
  writeArtifactPayloadToS3: vi.fn((args: Record<string, unknown>) => {
    mocks.s3Writes.push(args);
    return Promise.resolve(undefined);
  }),
}));

import { upsertDraftCanvasFromActivityEvent } from "./born-artifact.js";
import { deriveCanvasArtifactId } from "./canvas-lifecycle.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inserts.length = 0;
  mocks.onConflicts.length = 0;
  mocks.s3Writes.length = 0;
  mocks.selectQueue.length = 0;
  mocks.updateResults.length = 0;
  mocks.updateCalls.length = 0;
  mocks.s3Reads.length = 0;
});

function snapshotPayload(part: ThreadJsonRenderPart) {
  return threadJsonRenderStateSnapshotPayload(part);
}

function legacyChunkPayload(part: ThreadJsonRenderPart) {
  return { kind: "thread_json_render.ui_message_chunk", chunk: part };
}

describe("upsertDraftCanvasFromActivityEvent", () => {
  it("first emission upserts exactly one draft canvas keyed by stable part id", async () => {
    const part = createTaskReviewJsonRenderFixture();
    const result = await upsertDraftCanvasFromActivityEvent({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      agentId: AGENT_ID,
      payload: snapshotPayload(part),
    });

    const expectedId = deriveCanvasArtifactId(TENANT_ID, THREAD_ID, part.id);
    expect(result).toEqual({ artifactId: expectedId });
    expect(mocks.inserts).toHaveLength(1);
    expect(mocks.inserts[0]).toMatchObject({
      id: expectedId,
      tenant_id: TENANT_ID,
      thread_id: THREAD_ID,
      agent_id: AGENT_ID,
      status: "draft",
      type: "data_view",
      metadata: {
        kind: "json_render_canvas",
        stablePartId: part.id,
      },
    });
    // head key (no revision) — content offloaded to S3.
    expect(mocks.s3Writes[0].key).toBe(
      `tenants/${TENANT_ID}/artifact-payloads/artifacts/${expectedId}/content.md`,
    );
    // ON CONFLICT only updates while still a draft (saved canvas is protected).
    expect(mocks.onConflicts[0].target).toBeDefined();
    expect(mocks.onConflicts[0].setWhere).toBeDefined();
  });

  it("re-emission of the same stable id upserts (ON CONFLICT), never a second row", async () => {
    const part = createTaskReviewJsonRenderFixture();
    await upsertDraftCanvasFromActivityEvent({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      agentId: AGENT_ID,
      payload: snapshotPayload(part),
    });
    await upsertDraftCanvasFromActivityEvent({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      agentId: AGENT_ID,
      payload: snapshotPayload(part),
    });

    const expectedId = deriveCanvasArtifactId(TENANT_ID, THREAD_ID, part.id);
    // Both calls target the SAME deterministic id; dedupe is the PK ON CONFLICT.
    expect(mocks.inserts).toHaveLength(2);
    expect(mocks.inserts[0].id).toBe(expectedId);
    expect(mocks.inserts[1].id).toBe(expectedId);
    expect(mocks.onConflicts).toHaveLength(2);
  });

  it("accepts the legacy ui_message_chunk payload shape", async () => {
    const part = createTaskReviewJsonRenderFixture();
    const result = await upsertDraftCanvasFromActivityEvent({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      agentId: AGENT_ID,
      payload: legacyChunkPayload(part),
    });
    expect(result).toEqual({
      artifactId: deriveCanvasArtifactId(TENANT_ID, THREAD_ID, part.id),
    });
    expect(mocks.inserts).toHaveLength(1);
  });

  it("returns null (no write) for a non-canvas payload", async () => {
    const result = await upsertDraftCanvasFromActivityEvent({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      agentId: AGENT_ID,
      payload: { kind: "some.other.event", foo: 1 },
    });
    expect(result).toBeNull();
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.s3Writes).toHaveLength(0);
  });

  it("returns null for an invalid json-render part", async () => {
    const result = await upsertDraftCanvasFromActivityEvent({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      agentId: AGENT_ID,
      payload: { kind: "thread_json_render.ui_message_chunk", chunk: { not: "a part" } },
    });
    expect(result).toBeNull();
    expect(mocks.inserts).toHaveLength(0);
  });

  it("routes a re-emission in a checked-out thread to the ORIGINAL artifact (U8, no new derived row)", async () => {
    const part = createTaskReviewJsonRenderFixture();
    // findCheckoutRoutedArtifact returns the ORIGINAL saved canvas (this thread
    // has it in metadata.checkouts).
    mocks.selectQueue.push([
      {
        id: ORIGINAL_ARTIFACT,
        tenant_id: TENANT_ID,
        type: "data_view",
        status: "final",
        content: null,
        s3_key: `tenants/${TENANT_ID}/artifact-payloads/artifacts/${ORIGINAL_ARTIFACT}/content.md`,
        head_version: 3,
        head_write_seq: 3,
        metadata: {
          kind: "json_render_canvas",
          stablePartId: part.id,
          checkouts: [{ threadId: CHECKED_OUT_THREAD }],
        },
      },
    ]);
    // Current head content differs from the re-emitted part → a head write.
    mocks.s3Reads.push('{"stale":"head"}');
    // Guarded UPDATE succeeds.
    mocks.updateResults.push([{ id: ORIGINAL_ARTIFACT }]);

    const result = await upsertDraftCanvasFromActivityEvent({
      tenantId: TENANT_ID,
      threadId: CHECKED_OUT_THREAD,
      agentId: AGENT_ID,
      payload: snapshotPayload(part),
    });

    // Routed to the ORIGINAL — NOT a (thread, part)-derived id — and no new row.
    expect(result).toEqual({ artifactId: ORIGINAL_ARTIFACT });
    expect(ORIGINAL_ARTIFACT).not.toBe(
      deriveCanvasArtifactId(TENANT_ID, CHECKED_OUT_THREAD, part.id),
    );
    expect(mocks.inserts).toHaveLength(0);
    // Head overwrite bumped head_write_seq (KTD6) and cleared inline content.
    expect(mocks.updateCalls).toHaveLength(1);
    expect(mocks.updateCalls[0].set).toMatchObject({ content: null });
    expect(mocks.updateCalls[0].set.head_write_seq).toBeDefined();
    expect(mocks.s3Writes).toHaveLength(1);
  });

  it("an identical re-emission of a checked-out canvas is a no-op (no head write)", async () => {
    const part = createTaskReviewJsonRenderFixture();
    mocks.selectQueue.push([
      {
        id: ORIGINAL_ARTIFACT,
        tenant_id: TENANT_ID,
        type: "data_view",
        status: "final",
        content: null,
        s3_key: `tenants/${TENANT_ID}/artifact-payloads/artifacts/${ORIGINAL_ARTIFACT}/content.md`,
        head_version: 3,
        head_write_seq: 3,
        metadata: {
          kind: "json_render_canvas",
          stablePartId: part.id,
          checkouts: [{ threadId: CHECKED_OUT_THREAD }],
        },
      },
    ]);
    // Current head is byte-identical to the re-emitted part.
    mocks.s3Reads.push(stableStringify(part));

    const result = await upsertDraftCanvasFromActivityEvent({
      tenantId: TENANT_ID,
      threadId: CHECKED_OUT_THREAD,
      agentId: AGENT_ID,
      payload: snapshotPayload(part),
    });

    expect(result).toEqual({ artifactId: ORIGINAL_ARTIFACT });
    expect(mocks.s3Writes).toHaveLength(0);
    expect(mocks.updateCalls).toHaveLength(0);
  });

  it("an unrelated thread with NO checkout mints its own derived artifact (collision safety)", async () => {
    const part = createTaskReviewJsonRenderFixture();
    // No checkout row for this (thread, part) → selectQueue empty → derive path.
    const result = await upsertDraftCanvasFromActivityEvent({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      agentId: AGENT_ID,
      payload: snapshotPayload(part),
    });

    const ownId = deriveCanvasArtifactId(TENANT_ID, THREAD_ID, part.id);
    expect(result).toEqual({ artifactId: ownId });
    expect(ownId).not.toBe(ORIGINAL_ARTIFACT);
    expect(mocks.inserts).toHaveLength(1);
    expect(mocks.inserts[0].id).toBe(ownId);
    // Never touched another thread's artifact.
    expect(mocks.updateCalls).toHaveLength(0);
  });

  it("derives distinct ids across threads but stable within a (thread, part)", () => {
    const part = createTaskReviewJsonRenderFixture();
    const a = deriveCanvasArtifactId(TENANT_ID, THREAD_ID, part.id);
    const b = deriveCanvasArtifactId(TENANT_ID, THREAD_ID, part.id);
    const c = deriveCanvasArtifactId(
      TENANT_ID,
      "99999999-9999-9999-9999-999999999999",
      part.id,
    );
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
