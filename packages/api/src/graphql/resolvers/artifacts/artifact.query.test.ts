import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const THREAD_ID = "33333333-3333-3333-3333-333333333333";

const mocks = vi.hoisted(() => ({
  tables: {
    artifacts: {
      id: { name: "artifacts.id" },
      tenant_id: { name: "artifacts.tenant_id" },
    },
  },
  selectQueue: [] as Array<Array<Record<string, unknown>>>,
  requireTenantMember: vi.fn(),
  assertCanvasAccess: vi.fn(),
  artifactToCamelWithPayload: vi.fn((row: Record<string, unknown>) => ({
    id: row.id,
    title: row.title,
    type: row.type,
    content: row.content,
  })),
}));

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mocks.selectQueue.shift() ?? []),
      }),
    }),
  },
  eq: (field: unknown, value: unknown) => ({ eq: [field, value] }),
  artifacts: mocks.tables.artifacts,
}));

vi.mock("../core/authz.js", () => ({
  requireTenantMember: mocks.requireTenantMember,
}));

vi.mock("../../../lib/artifacts/canvas-access.js", () => ({
  assertCanvasAccess: mocks.assertCanvasAccess,
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
  mocks.assertCanvasAccess.mockResolvedValue(undefined);
});

describe("artifact query access", () => {
  it("gates every read through requireTenantMember + assertCanvasAccess(read)", async () => {
    const row = canvasArtifact();
    mocks.selectQueue.push([row]);

    const result = await artifact({}, { id: "artifact-1" }, ctx);

    expect(mocks.requireTenantMember).toHaveBeenCalledWith(ctx, TENANT_ID);
    expect(mocks.assertCanvasAccess).toHaveBeenCalledWith(ctx, row, "read");
    expect(result).toMatchObject({ id: "artifact-1", type: "data_view" });
  });

  it("propagates a FORBIDDEN from the canvas gate and does not hydrate", async () => {
    mocks.selectQueue.push([canvasArtifact()]);
    mocks.assertCanvasAccess.mockRejectedValueOnce(
      Object.assign(new Error("no access"), {
        extensions: { code: "FORBIDDEN" },
      }),
    );

    await expect(artifact({}, { id: "artifact-1" }, ctx)).rejects.toMatchObject(
      { extensions: { code: "FORBIDDEN" } },
    );
    expect(mocks.artifactToCamelWithPayload).not.toHaveBeenCalled();
  });

  it("returns null for a missing artifact without touching the gate", async () => {
    mocks.selectQueue.push([]);

    const result = await artifact({}, { id: "missing" }, ctx);

    expect(result).toBeNull();
    expect(mocks.requireTenantMember).not.toHaveBeenCalled();
    expect(mocks.assertCanvasAccess).not.toHaveBeenCalled();
  });

  it("regression: the old 'genui_snapshot' kind string is not a canvas — the dead inline gate is gone (assertCanvasAccess owns kind detection now)", async () => {
    // Historic bug: artifact.query.ts gated on metadata.kind === 'genui_snapshot'
    // while the writer persists 'json_render_snapshot', so the gate never fired.
    // The resolver no longer inspects the kind at all; assertCanvasAccess does,
    // and a legacy 'genui_snapshot' row is a no-op there (proven in
    // canvas-access.test.ts). Here we only assert the resolver delegates.
    const legacy = {
      id: "artifact-legacy",
      tenant_id: TENANT_ID,
      thread_id: THREAD_ID,
      title: "Legacy",
      type: "data_view",
      metadata: { kind: "genui_snapshot" },
      content: "{}",
    };
    mocks.selectQueue.push([legacy]);

    const result = await artifact({}, { id: "artifact-legacy" }, ctx);

    expect(mocks.assertCanvasAccess).toHaveBeenCalledWith(ctx, legacy, "read");
    expect(result).toMatchObject({ id: "artifact-legacy" });
  });
});

function canvasArtifact() {
  return {
    id: "artifact-1",
    tenant_id: TENANT_ID,
    thread_id: THREAD_ID,
    title: "Snapshot",
    type: "data_view",
    metadata: { kind: "json_render_snapshot" },
    content: "{}",
  };
}
