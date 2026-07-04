import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "55555555-5555-5555-5555-555555555555";
const ARTIFACT_ID = "77777777-7777-7777-7777-777777777777";
const SPACE_ID = "88888888-8888-8888-8888-888888888888";

const mocks = vi.hoisted(() => ({
  selectQueue: [] as Array<Array<Record<string, unknown>>>,
  updateResults: [] as Array<Array<Record<string, unknown>>>,
  updateCalls: [] as Array<{ set: Record<string, unknown> }>,
  versionInserts: [] as Array<Record<string, unknown>>,
  s3Writes: [] as Array<Record<string, unknown>>,
  s3Reads: [] as string[],
  resolveCallerFromAuth: vi.fn(),
  requireTenantMember: vi.fn(),
  canAccessSpace: vi.fn(),
  artifactToCamelWithPayload: vi.fn((row: Record<string, unknown>) => ({
    id: row.id,
    status: row.status,
    title: row.title,
    spaceId: row.space_id,
    headVersion: row.head_version,
  })),
}));

vi.mock("../../utils.js", () => {
  const updateBuilder = {
    set: vi.fn((set: Record<string, unknown>) => {
      mocks.updateCalls.push({ set });
      return updateBuilder;
    }),
    where: vi.fn(() => updateBuilder),
    returning: vi.fn(() => Promise.resolve(mocks.updateResults.shift() ?? [])),
  };
  const insertBuilder = {
    values: vi.fn((row: Record<string, unknown>) => {
      mocks.versionInserts.push(row);
      return Promise.resolve(undefined);
    }),
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
      status: { name: "artifacts.status" },
      head_write_seq: { name: "artifacts.head_write_seq" },
    },
    artifactVersions: { id: { name: "artifact_versions.id" } },
    db: {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(mocks.selectQueue.shift() ?? []),
        }),
      }),
      update: vi.fn(() => updateBuilder),
      insert: vi.fn(() => insertBuilder),
    },
  };
});

vi.mock("../core/authz.js", () => ({
  requireTenantMember: mocks.requireTenantMember,
}));
vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerFromAuth: mocks.resolveCallerFromAuth,
}));
// U2 access layer: assertCanvasAccess is a no-op by default (write access
// granted); hasSpaceWriteRole reuses the existing toggle so the
// rejects-target-space test keeps working.
vi.mock("../../../lib/artifacts/canvas-access.js", () => ({
  CANVAS_LIVING_KIND: "json_render_canvas",
  assertCanvasAccess: vi.fn(() => Promise.resolve()),
  hasSpaceWriteRole: (...args: unknown[]) => mocks.canAccessSpace(...args),
}));
vi.mock("./payload.js", () => ({
  artifactToCamelWithPayload: mocks.artifactToCamelWithPayload,
}));
vi.mock("../../../lib/artifacts/payload-storage.js", () => ({
  artifactContentKey: ({ tenantId, artifactId, revision }: { tenantId: string; artifactId: string; revision?: string }) =>
    revision
      ? `tenants/${tenantId}/artifact-payloads/artifacts/${artifactId}/content/${revision}.md`
      : `tenants/${tenantId}/artifact-payloads/artifacts/${artifactId}/content.md`,
  isArtifactPayloadS3Key: () => true,
  readArtifactPayloadFromS3: () => {
    const next = mocks.s3Reads.shift() ?? "{}";
    return Promise.resolve(next);
  },
  writeArtifactPayloadToS3: (args: Record<string, unknown>) => {
    mocks.s3Writes.push(args);
    return Promise.resolve(undefined);
  },
}));

import { saveCanvas } from "./saveCanvas.mutation.js";
import { pinArtifact } from "./pinArtifact.mutation.js";

const ctx = { auth: { authType: "cognito" } } as never;

function canvasRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ARTIFACT_ID,
    tenant_id: TENANT_ID,
    type: "data_view",
    status: "draft",
    content: null,
    s3_key: `tenants/${TENANT_ID}/artifact-payloads/artifacts/${ARTIFACT_ID}/content.md`,
    head_version: 0,
    head_write_seq: 0,
    metadata: { kind: "json_render_canvas", stablePartId: "json-render:abc" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectQueue = [];
  mocks.updateResults = [];
  mocks.updateCalls = [];
  mocks.versionInserts = [];
  mocks.s3Writes = [];
  mocks.s3Reads = [];
  mocks.resolveCallerFromAuth.mockResolvedValue({
    userId: USER_ID,
    tenantId: TENANT_ID,
  });
  mocks.requireTenantMember.mockResolvedValue("member");
  mocks.canAccessSpace.mockResolvedValue(true);
});

describe("saveCanvas", () => {
  it("first-time save flips draft -> final with a pure conditional UPDATE (no version)", async () => {
    mocks.selectQueue.push([canvasRow()]);
    mocks.updateResults.push([
      canvasRow({ status: "final", title: "My Dashboard", space_id: SPACE_ID }),
    ]);

    const result = await saveCanvas(
      {},
      { artifactId: ARTIFACT_ID, title: "My Dashboard", spaceId: SPACE_ID },
      ctx,
    );

    expect(result).toMatchObject({ status: "final", spaceId: SPACE_ID });
    // Pure flip: no version row inserted, no S3 revision write.
    expect(mocks.versionInserts).toHaveLength(0);
    expect(mocks.s3Writes).toHaveLength(0);
    // The flip UPDATE targets status='draft' (double-click guard).
    expect(mocks.updateCalls[0].set).toMatchObject({ status: "final" });
  });

  it("concurrent double-save produces one saved artifact (loser returns saved row, no version)", async () => {
    // Loser reads draft, its conditional UPDATE matches 0 rows, then re-reads
    // the already-saved row.
    mocks.selectQueue.push([canvasRow()]); // initial read (draft)
    mocks.updateResults.push([]); // flip UPDATE matches nothing (lost race)
    mocks.selectQueue.push([
      canvasRow({ status: "final", title: "Winner", space_id: SPACE_ID }),
    ]); // re-read

    const result = await saveCanvas(
      {},
      { artifactId: ARTIFACT_ID, title: "Loser", spaceId: SPACE_ID },
      ctx,
    );

    expect(result).toMatchObject({ id: ARTIFACT_ID, status: "final" });
    expect(mocks.versionInserts).toHaveLength(0);
  });

  it("re-saving a saved canvas auto-pins the prior head as a version (AE3 mechanism)", async () => {
    mocks.selectQueue.push([canvasRow({ status: "final", head_version: 0 })]);
    mocks.s3Reads.push('{"canvas":"head-content"}'); // head content for the pin
    mocks.updateResults.push([
      canvasRow({ status: "final", head_version: 1, head_write_seq: 1 }),
    ]);

    const result = await saveCanvas(
      {},
      { artifactId: ARTIFACT_ID, title: "Renamed", spaceId: SPACE_ID },
      ctx,
    );

    expect(result).toMatchObject({ headVersion: 1 });
    // A version row was written from the prior head content.
    expect(mocks.versionInserts).toHaveLength(1);
    expect(mocks.versionInserts[0]).toMatchObject({
      artifact_id: ARTIFACT_ID,
      version: 1,
      created_by: USER_ID,
    });
    // Guarded UPDATE bumped head_version + carried the naming/space change.
    expect(mocks.updateCalls[0].set).toMatchObject({
      head_version: 1,
      title: "Renamed",
      space_id: SPACE_ID,
    });
    // Content-addressed write-once revision key.
    expect(mocks.s3Writes[0].key).toMatch(/\/content\/[0-9a-f]{64}\.md$/);
  });

  it("rejects saving into a space the caller is not a member of", async () => {
    mocks.selectQueue.push([canvasRow()]);
    mocks.canAccessSpace.mockResolvedValue(false);

    await expect(
      saveCanvas(
        {},
        { artifactId: ARTIFACT_ID, title: "X", spaceId: SPACE_ID },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });

  it("rejects non-canvas artifacts", async () => {
    mocks.selectQueue.push([canvasRow({ metadata: { kind: "other" } })]);
    await expect(
      saveCanvas(
        {},
        { artifactId: ARTIFACT_ID, title: "X", spaceId: SPACE_ID },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
  });
});

describe("pinArtifact", () => {
  it("pins the head at version N -> immutable version row + head_version bump", async () => {
    mocks.selectQueue.push([
      canvasRow({ status: "final", head_version: 2, head_write_seq: 3, space_id: SPACE_ID }),
    ]);
    mocks.s3Reads.push('{"canvas":"content"}');
    mocks.updateResults.push([
      canvasRow({ status: "final", head_version: 3, head_write_seq: 4, space_id: SPACE_ID }),
    ]);

    const result = await pinArtifact({}, { artifactId: ARTIFACT_ID }, ctx);

    expect(result).toMatchObject({ headVersion: 3 });
    expect(mocks.versionInserts).toHaveLength(1);
    expect(mocks.versionInserts[0]).toMatchObject({
      artifact_id: ARTIFACT_ID,
      version: 3,
      created_by: USER_ID,
    });
    expect(mocks.updateCalls[0].set).toMatchObject({ head_version: 3 });
  });

  it("throws CONFLICT when the head_write_seq guard matches nothing (concurrent write)", async () => {
    mocks.selectQueue.push([
      canvasRow({ status: "final", head_version: 1, head_write_seq: 5 }),
    ]);
    mocks.s3Reads.push('{"canvas":"content"}');
    mocks.updateResults.push([]); // guarded UPDATE matched 0 rows

    await expect(
      pinArtifact({}, { artifactId: ARTIFACT_ID }, ctx),
    ).rejects.toMatchObject({ extensions: { code: "CONFLICT" } });
    // No version row written when the guard fails.
    expect(mocks.versionInserts).toHaveLength(0);
  });
});
