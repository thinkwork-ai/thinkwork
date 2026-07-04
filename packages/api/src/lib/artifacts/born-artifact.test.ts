import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTaskReviewJsonRenderFixture,
  threadJsonRenderStateSnapshotPayload,
  type ThreadJsonRenderPart,
} from "@thinkwork/thread-json-render";

const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const THREAD_ID = "33333333-3333-3333-3333-333333333333";
const AGENT_ID = "44444444-4444-4444-4444-444444444444";

const mocks = vi.hoisted(() => ({
  inserts: [] as Array<Record<string, unknown>>,
  onConflicts: [] as Array<Record<string, unknown>>,
  s3Writes: [] as Array<Record<string, unknown>>,
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
  return {
    artifacts: { id: { name: "artifacts.id" }, status: { name: "status" }, metadata: { name: "metadata" } },
    db: { insert: vi.fn(() => insertBuilder) },
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
