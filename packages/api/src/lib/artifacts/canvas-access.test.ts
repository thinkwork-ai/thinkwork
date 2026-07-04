import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_TENANT = "99999999-9999-9999-9999-999999999999";
const SPACE_ID = "44444444-4444-4444-4444-444444444444";
const THREAD_ID = "33333333-3333-3333-3333-333333333333";
const USER_ID = "55555555-5555-5555-5555-555555555555";

const mocks = vi.hoisted(() => ({
  selectQueue: [] as Array<Array<Record<string, unknown>>>,
  resolveCallerFromAuth: vi.fn(),
  canAccessSpace: vi.fn(),
  callerVisibleThreadPredicate: vi.fn(() => ({ visible: true })),
}));

vi.mock("../../graphql/utils.js", () => ({
  and: (...c: unknown[]) => ({ and: c }),
  eq: (f: unknown, v: unknown) => ({ eq: [f, v] }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      sql: strings.join("?"),
      values,
    }),
    {},
  ),
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mocks.selectQueue.shift() ?? []),
      }),
    }),
  },
  artifacts: {
    metadata: "artifacts.metadata",
    space_id: "artifacts.space_id",
    thread_id: "artifacts.thread_id",
  },
  spaces: "spaces",
  spaceMembers: {
    role: "sm.role",
    tenant_id: "sm.tenant",
    space_id: "sm.space",
    user_id: "sm.user",
  },
  threadParticipants: "thread_participants",
  threads: { id: "threads.id", tenant_id: "threads.tenant_id" },
}));

vi.mock("../../graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCallerFromAuth: mocks.resolveCallerFromAuth,
}));

vi.mock("../../graphql/resolvers/spaces/shared.js", () => ({
  canAccessSpace: mocks.canAccessSpace,
}));

vi.mock("../../graphql/resolvers/threads/access.js", () => ({
  callerVisibleThreadPredicate: mocks.callerVisibleThreadPredicate,
}));

import {
  assertCanvasAccess,
  isCanvasArtifact,
  canvasListVisibilityPredicate,
  excludeCanvasArtifactsPredicate,
  CANVAS_SNAPSHOT_KIND,
} from "./canvas-access.js";

const ctx = { auth: { authType: "cognito" } } as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectQueue = [];
  mocks.resolveCallerFromAuth.mockResolvedValue({
    userId: USER_ID,
    tenantId: TENANT_ID,
  });
  mocks.canAccessSpace.mockResolvedValue(true);
});

function savedCanvas(overrides: Record<string, unknown> = {}) {
  return {
    tenant_id: TENANT_ID,
    space_id: SPACE_ID,
    thread_id: THREAD_ID,
    metadata: { kind: CANVAS_SNAPSHOT_KIND },
    ...overrides,
  };
}

function draftCanvas(overrides: Record<string, unknown> = {}) {
  return {
    tenant_id: TENANT_ID,
    space_id: null,
    thread_id: THREAD_ID,
    metadata: { kind: CANVAS_SNAPSHOT_KIND },
    ...overrides,
  };
}

describe("isCanvasArtifact", () => {
  it("recognizes the writer's json_render_snapshot kind", () => {
    expect(
      isCanvasArtifact({ metadata: { kind: "json_render_snapshot" } }),
    ).toBe(true);
  });

  it("regression: the dead 'genui_snapshot' gate string is NOT a canvas", () => {
    // The old artifact.query.ts gate compared against 'genui_snapshot' while the
    // writer persists 'json_render_snapshot' — so it never matched. This asserts
    // the bug's string is intentionally not treated as a canvas.
    expect(isCanvasArtifact({ metadata: { kind: "genui_snapshot" } })).toBe(
      false,
    );
  });

  it("parses stringified metadata and tolerates junk", () => {
    expect(
      isCanvasArtifact({
        metadata: JSON.stringify({ kind: "json_render_snapshot" }),
      }),
    ).toBe(true);
    expect(isCanvasArtifact({ metadata: "not json" })).toBe(false);
    expect(isCanvasArtifact({ metadata: null })).toBe(false);
    expect(isCanvasArtifact({})).toBe(false);
    expect(isCanvasArtifact({ metadata: { kind: "report" } })).toBe(false);
  });
});

describe("assertCanvasAccess — non-canvas", () => {
  it("is a no-op for legacy non-canvas artifacts (no caller resolution)", async () => {
    await expect(
      assertCanvasAccess(
        ctx,
        { tenant_id: TENANT_ID, metadata: { kind: "report" } },
        "write",
      ),
    ).resolves.toBeUndefined();
    expect(mocks.resolveCallerFromAuth).not.toHaveBeenCalled();
  });
});

describe("assertCanvasAccess — cross-tenant", () => {
  it("refuses a caller resolved to a different tenant", async () => {
    mocks.resolveCallerFromAuth.mockResolvedValue({
      userId: USER_ID,
      tenantId: OTHER_TENANT,
    });
    await expect(
      assertCanvasAccess(ctx, savedCanvas(), "read"),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });

  it("refuses an unresolvable caller (null userId)", async () => {
    mocks.resolveCallerFromAuth.mockResolvedValue({
      userId: null,
      tenantId: null,
    });
    await expect(
      assertCanvasAccess(ctx, savedCanvas(), "read"),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });
});

describe("assertCanvasAccess — saved canvas (space-scoped)", () => {
  it("space member reads the head with no thread access", async () => {
    mocks.canAccessSpace.mockResolvedValue(true);
    await expect(
      assertCanvasAccess(ctx, savedCanvas(), "read"),
    ).resolves.toBeUndefined();
    // Read never consults thread visibility for saved canvases.
    expect(mocks.callerVisibleThreadPredicate).not.toHaveBeenCalled();
  });

  it("non-member is FORBIDDEN on read", async () => {
    mocks.canAccessSpace.mockResolvedValue(false);
    await expect(
      assertCanvasAccess(ctx, savedCanvas(), "read"),
    ).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" },
    });
  });

  it("non-member is FORBIDDEN on write (no space_members row)", async () => {
    mocks.selectQueue.push([]); // hasSpaceWriteRole → no membership row
    await expect(
      assertCanvasAccess(ctx, savedCanvas(), "write"),
    ).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" },
    });
  });

  it("owner/admin/member roles may write", async () => {
    for (const role of ["owner", "admin", "member"]) {
      mocks.selectQueue.push([{ role }]);
      await expect(
        assertCanvasAccess(ctx, savedCanvas(), "write"),
      ).resolves.toBeUndefined();
    }
  });

  it("viewer-role member reads but cannot write", async () => {
    // read: canAccessSpace true regardless of role
    mocks.canAccessSpace.mockResolvedValue(true);
    await expect(
      assertCanvasAccess(ctx, savedCanvas(), "read"),
    ).resolves.toBeUndefined();
    // write: role viewer → excluded
    mocks.selectQueue.push([{ role: "viewer" }]);
    await expect(
      assertCanvasAccess(ctx, savedCanvas(), "write"),
    ).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" },
    });
  });
});

describe("assertCanvasAccess — draft canvas (thread-scoped)", () => {
  it("a non-participant cannot read another user's draft by artifact id", async () => {
    mocks.selectQueue.push([]); // thread not visible to caller
    await expect(
      assertCanvasAccess(ctx, draftCanvas(), "read"),
    ).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" },
    });
  });

  it("the creator/participant (visible thread) can read and write", async () => {
    mocks.selectQueue.push([{ id: THREAD_ID }]); // read
    await expect(
      assertCanvasAccess(ctx, draftCanvas(), "read"),
    ).resolves.toBeUndefined();
    mocks.selectQueue.push([{ id: THREAD_ID }]); // write
    await expect(
      assertCanvasAccess(ctx, draftCanvas(), "write"),
    ).resolves.toBeUndefined();
  });

  it("a draft with no originating thread is readable by no one", async () => {
    await expect(
      assertCanvasAccess(ctx, draftCanvas({ thread_id: null }), "read"),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });
});

describe("list predicates", () => {
  it("builds a canvas visibility predicate referencing the writer's kind", () => {
    const pred = canvasListVisibilityPredicate(
      TENANT_ID,
      USER_ID,
    ) as unknown as {
      values: unknown[];
    };
    expect(pred.values).toContain(CANVAS_SNAPSHOT_KIND);
    expect(pred.values).toContain(TENANT_ID);
    expect(pred.values).toContain(USER_ID);
  });

  it("builds a fail-closed exclude predicate", () => {
    const pred = excludeCanvasArtifactsPredicate() as unknown as {
      values: unknown[];
    };
    expect(pred.values).toContain(CANVAS_SNAPSHOT_KIND);
  });
});
