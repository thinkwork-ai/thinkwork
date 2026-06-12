import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const mocks = vi.hoisted(() => ({
  listObjects: vi.fn(),
  appendEvent: vi.fn(),
  assertSpaceAccessAllowed: vi.fn(),
  rowsByTable: {} as Record<string, unknown[]>,
}));

vi.mock("../lib/auth.js", () => ({
  validateApiSecret: (token: string) => token === "api-secret",
}));

vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: (key: string) => (key === "WORKSPACE_BUCKET" ? "test-bucket" : ""),
}));

vi.mock("../lib/workspace-renderer/s3-store.js", () => ({
  S3WorkspaceRendererObjectStore: class {
    listObjects = mocks.listObjects;
  },
}));

vi.mock("../lib/workspace-projection-snapshot.js", () => ({
  appendWorkspaceProjectionFetchEvent: mocks.appendEvent,
}));

vi.mock(
  "../lib/workspace-renderer/space-membership-check.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../lib/workspace-renderer/space-membership-check.js")
      >();
    return {
      ...actual,
      assertSpaceAccessAllowed: mocks.assertSpaceAccessAllowed,
    };
  },
);

// Fake drizzle client: routes select chains to canned rows by table name.
// Handles both `.where(...).limit(n)` (single-row lookups) and awaiting the
// `.where(...)` result directly (the participants innerJoin query).
vi.mock("../lib/db.js", () => {
  const tableName = (table: object): string =>
    (table as Record<symbol, string>)[Symbol.for("drizzle:Name")];
  const chain = (name: string) => ({
    innerJoin: () => chain(name),
    where: () => {
      const rows = mocks.rowsByTable[name] ?? [];
      return Object.assign(Promise.resolve(rows), {
        limit: async () => rows,
      });
    },
  });
  return {
    db: {
      select: () => ({ from: (table: object) => chain(tableName(table)) }),
    },
  };
});

import { handler } from "./workspace-fetch-source";
import { SpaceAccessDeniedError } from "../lib/workspace-renderer/space-membership-check.js";

const SPACE_PREFIX = "tenants/acme/spaces/growth/";
const USER_PREFIX = "tenants/acme/users/jane/";

function event(
  body: unknown,
  headers: Record<string, string> = {
    authorization: "Bearer api-secret",
    "x-tenant-id": "tenant-1",
  },
): APIGatewayProxyEventV2 {
  return {
    requestContext: {
      http: { method: "POST", path: "/api/workspaces/fetch-source" },
    },
    headers,
    body: JSON.stringify(body),
    rawPath: "/api/workspaces/fetch-source",
  } as unknown as APIGatewayProxyEventV2;
}

function parse(res: { body?: unknown }) {
  return JSON.parse(res.body as string);
}

function spaceRequest(overrides: Record<string, unknown> = {}) {
  return {
    kind: "space",
    slug: "growth",
    threadId: "thread-1",
    threadTurnId: "turn-1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rowsByTable = {
    tenants: [{ slug: "acme" }],
    threads: [{ id: "thread-1", spaceId: "space-1", userId: "user-1" }],
    spaces: [
      {
        id: "space-1",
        slug: "growth",
        workspaceFolderName: "growth",
        accessMode: "private",
      },
    ],
    space_members: [
      {
        id: "user-2",
        workspaceFolderName: "jane",
        email: "jane@example.com",
        name: "Jane",
      },
    ],
  };
  mocks.assertSpaceAccessAllowed.mockResolvedValue(undefined);
  mocks.appendEvent.mockResolvedValue(undefined);
  mocks.listObjects.mockResolvedValue([
    {
      key: `${SPACE_PREFIX}SPACE.md`,
      etag: '"etag-space"',
      size: 100,
    },
    {
      key: `${SPACE_PREFIX}notes/brief.md`,
      etag: '"etag-brief"',
      size: 250,
    },
  ]);
});

describe("workspace-fetch-source auth (scenario 6)", () => {
  it("rejects a bad bearer with 401 and records nothing", async () => {
    const res = await handler(
      event(spaceRequest(), {
        authorization: "Bearer wrong-secret",
        "x-tenant-id": "tenant-1",
      }),
    );
    expect(res.statusCode).toBe(401);
    expect(mocks.appendEvent).not.toHaveBeenCalled();
    expect(mocks.listObjects).not.toHaveBeenCalled();
  });

  it("rejects a missing bearer with 401", async () => {
    const res = await handler(
      event(spaceRequest(), { "x-tenant-id": "tenant-1" }),
    );
    expect(res.statusCode).toBe(401);
  });

  it("rejects a missing x-tenant-id header with 403", async () => {
    const res = await handler(
      event(spaceRequest(), { authorization: "Bearer api-secret" }),
    );
    expect(res.statusCode).toBe(403);
    expect(mocks.appendEvent).not.toHaveBeenCalled();
  });

  it("rejects an invalid kind with 400", async () => {
    const res = await handler(event(spaceRequest({ kind: "tenant" })));
    expect(res.statusCode).toBe(400);
  });
});

describe("space fetch authorization (scenarios 1 + 2)", () => {
  it("denies an unauthorized private space: no keys, denial event appended (AE3)", async () => {
    mocks.assertSpaceAccessAllowed.mockRejectedValue(
      new SpaceAccessDeniedError("growth"),
    );

    const res = await handler(event(spaceRequest()));

    expect(res.statusCode).toBe(403);
    expect(parse(res)).toEqual({
      outcome: "denied",
      deniedReason: "not_authorized",
      files: [],
    });
    expect(mocks.listObjects).not.toHaveBeenCalled();
    expect(mocks.appendEvent).toHaveBeenCalledTimes(1);
    expect(mocks.appendEvent).toHaveBeenCalledWith(
      "turn-1",
      expect.objectContaining({
        target: { kind: "space", slug: "growth" },
        outcome: "denied",
        deniedReason: "not_authorized",
        fileCount: 0,
        totalBytes: 0,
        at: expect.any(String),
      }),
      { tenantId: "tenant-1" },
    );
  });

  it("marks the denial 'revoked' when the caller asserts the routing listed it", async () => {
    mocks.assertSpaceAccessAllowed.mockRejectedValue(
      new SpaceAccessDeniedError("growth"),
    );

    const res = await handler(event(spaceRequest({ listedInRouting: true })));

    expect(res.statusCode).toBe(403);
    expect(parse(res).deniedReason).toBe("revoked");
    expect(mocks.appendEvent).toHaveBeenCalledWith(
      "turn-1",
      expect.objectContaining({ outcome: "denied", deniedReason: "revoked" }),
      { tenantId: "tenant-1" },
    );
  });

  it("returns keys + etags + relPaths for an authorized space and appends a success event", async () => {
    const res = await handler(event(spaceRequest()));

    expect(res.statusCode).toBe(200);
    expect(parse(res)).toEqual({
      outcome: "success",
      files: [
        {
          key: `${SPACE_PREFIX}SPACE.md`,
          etag: "etag-space",
          relPath: "SPACE.md",
          size: 100,
        },
        {
          key: `${SPACE_PREFIX}notes/brief.md`,
          etag: "etag-brief",
          relPath: "notes/brief.md",
          size: 250,
        },
      ],
    });
    expect(mocks.assertSpaceAccessAllowed).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        spaceId: "space-1",
        accessMode: "private",
        invokingUserId: "user-1",
      }),
    );
    expect(mocks.listObjects).toHaveBeenCalledWith({
      bucket: "test-bucket",
      prefix: SPACE_PREFIX,
    });
    expect(mocks.appendEvent).toHaveBeenCalledWith(
      "turn-1",
      expect.objectContaining({
        target: { kind: "space", slug: "growth" },
        outcome: "success",
        fileCount: 2,
        totalBytes: 350,
      }),
      { tenantId: "tenant-1" },
    );
  });

  it("returns 404 for a space slug that does not exist in the tenant", async () => {
    mocks.rowsByTable.spaces = [];
    const res = await handler(event(spaceRequest({ slug: "ghost" })));
    expect(res.statusCode).toBe(404);
    expect(mocks.listObjects).not.toHaveBeenCalled();
  });
});

describe("per-fetch caps (scenario 3)", () => {
  it("truncates at the file cap with sorted-by-key determinism and outcome partial", async () => {
    // Listed deliberately out of order to prove server-side sorting.
    const objects = Array.from({ length: 250 }, (_, i) => ({
      key: `${SPACE_PREFIX}docs/file-${String(i).padStart(3, "0")}.md`,
      etag: `"etag-${i}"`,
      size: 10,
    })).reverse();
    mocks.listObjects.mockResolvedValue(objects);

    const res = await handler(event(spaceRequest()));

    expect(res.statusCode).toBe(200);
    const body = parse(res);
    expect(body.outcome).toBe("partial");
    expect(body.partial).toBe(true);
    expect(body.files).toHaveLength(200);
    // Deterministic: first 200 keys ascending.
    expect(body.files[0].relPath).toBe("docs/file-000.md");
    expect(body.files[199].relPath).toBe("docs/file-199.md");
    expect(mocks.appendEvent).toHaveBeenCalledWith(
      "turn-1",
      expect.objectContaining({
        outcome: "partial",
        fileCount: 200,
        totalBytes: 2000,
      }),
      { tenantId: "tenant-1" },
    );
  });

  it("truncates at the byte cap", async () => {
    mocks.listObjects.mockResolvedValue([
      { key: `${SPACE_PREFIX}a.md`, etag: '"e1"', size: 3_000_000 },
      { key: `${SPACE_PREFIX}b.md`, etag: '"e2"', size: 3_000_000 },
      { key: `${SPACE_PREFIX}c.md`, etag: '"e3"', size: 3_000_000 },
    ]);

    const res = await handler(event(spaceRequest()));

    const body = parse(res);
    expect(body.outcome).toBe("partial");
    expect(body.partial).toBe(true);
    expect(body.files.map((f: { relPath: string }) => f.relPath)).toEqual([
      "a.md",
    ]);
    expect(mocks.appendEvent).toHaveBeenCalledWith(
      "turn-1",
      expect.objectContaining({
        outcome: "partial",
        fileCount: 1,
        totalBytes: 3_000_000,
      }),
      { tenantId: "tenant-1" },
    );
  });
});

describe("user-folder fetch (scenario 4)", () => {
  function userRequest(slug: string) {
    return {
      kind: "user",
      slug,
      threadId: "thread-1",
      threadTurnId: "turn-1",
    };
  }

  it("succeeds when the target user is a participant of the active space", async () => {
    mocks.listObjects.mockResolvedValue([
      { key: `${USER_PREFIX}USER.md`, etag: '"e-user"', size: 40 },
    ]);

    const res = await handler(event(userRequest("jane")));

    expect(res.statusCode).toBe(200);
    expect(parse(res)).toEqual({
      outcome: "success",
      files: [
        {
          key: `${USER_PREFIX}USER.md`,
          etag: "e-user",
          relPath: "USER.md",
          size: 40,
        },
      ],
    });
    expect(mocks.listObjects).toHaveBeenCalledWith({
      bucket: "test-bucket",
      prefix: USER_PREFIX,
    });
    // Space access assertion is the space path; the user path uses the
    // participant check instead.
    expect(mocks.assertSpaceAccessAllowed).not.toHaveBeenCalled();
  });

  it("denies a non-participant target user and records the denial", async () => {
    const res = await handler(event(userRequest("intruder")));

    expect(res.statusCode).toBe(403);
    expect(parse(res)).toEqual({
      outcome: "denied",
      deniedReason: "not_authorized",
      files: [],
    });
    expect(mocks.listObjects).not.toHaveBeenCalled();
    expect(mocks.appendEvent).toHaveBeenCalledWith(
      "turn-1",
      expect.objectContaining({
        target: { kind: "user", slug: "intruder" },
        outcome: "denied",
        deniedReason: "not_authorized",
      }),
      { tenantId: "tenant-1" },
    );
  });

  it("matches participants whose slug derives from their email local part", async () => {
    mocks.rowsByTable.space_members = [
      {
        id: "user-3",
        workspaceFolderName: null,
        email: "Sam.Lee@example.com",
        name: "Sam Lee",
      },
    ];
    mocks.listObjects.mockResolvedValue([]);

    const res = await handler(event(userRequest("sam-lee")));

    expect(res.statusCode).toBe(200);
    expect(parse(res).outcome).toBe("success");
    expect(mocks.listObjects).toHaveBeenCalledWith({
      bucket: "test-bucket",
      prefix: "tenants/acme/users/sam-lee/",
    });
  });
});

describe("path filters (scenario 7)", () => {
  it("excludes non-renderable paths from a space fetch (same set composition renders)", async () => {
    mocks.listObjects.mockResolvedValue([
      { key: `${SPACE_PREFIX}SPACE.md`, etag: '"e1"', size: 10 },
      { key: `${SPACE_PREFIX}manifest.json`, etag: '"e2"', size: 10 },
      { key: `${SPACE_PREFIX}_defaults_version`, etag: '"e3"', size: 10 },
      { key: `${SPACE_PREFIX}.gitkeep`, etag: '"e4"', size: 10 },
      { key: `${SPACE_PREFIX}notes/.gitkeep`, etag: '"e5"', size: 10 },
      { key: `${SPACE_PREFIX}effective-policy.json`, etag: '"e6"', size: 10 },
      { key: `${SPACE_PREFIX}TOOLS.md`, etag: '"e7"', size: 10 },
      { key: `${SPACE_PREFIX}MCP.md`, etag: '"e8"', size: 10 },
      { key: `${SPACE_PREFIX}docs/playbook.md`, etag: '"e9"', size: 10 },
    ]);

    const res = await handler(event(spaceRequest()));

    expect(parse(res).files.map((f: { relPath: string }) => f.relPath)).toEqual(
      ["SPACE.md", "docs/playbook.md"],
    );
  });

  it("limits user-folder fetches to the renderable user-source set", async () => {
    mocks.listObjects.mockResolvedValue([
      { key: `${USER_PREFIX}USER.md`, etag: '"e1"', size: 10 },
      { key: `${USER_PREFIX}knowledge-pack.md`, etag: '"e2"', size: 10 },
      { key: `${USER_PREFIX}memory/MEMORY.md`, etag: '"e3"', size: 10 },
      { key: `${USER_PREFIX}private-scratch.md`, etag: '"e4"', size: 10 },
      {
        key: `${USER_PREFIX}memory/daily/2026-06-12.md`,
        etag: '"e5"',
        size: 10,
      },
    ]);

    const res = await handler(
      event({
        kind: "user",
        slug: "jane",
        threadId: "thread-1",
        threadTurnId: "turn-1",
      }),
    );

    expect(parse(res).files.map((f: { relPath: string }) => f.relPath)).toEqual(
      ["USER.md", "knowledge-pack.md", "memory/MEMORY.md"],
    );
  });
});

describe("snapshot append resilience", () => {
  it("still returns the authorization result when the event append fails", async () => {
    mocks.appendEvent.mockRejectedValue(new Error("db unavailable"));

    const res = await handler(event(spaceRequest()));

    expect(res.statusCode).toBe(200);
    expect(parse(res).outcome).toBe("success");
  });
});
