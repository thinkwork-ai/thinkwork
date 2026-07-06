/**
 * routineSource resolver tests — the read path the Routine Detail Code tab
 * depends on. Covers the happy path (module + fixtures decoded from GitHub),
 * the validated-sha vs branch-HEAD ref choice, and the guard rails
 * (non-git routine, no repo connected).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted so these initialize before the hoisted vi.mock factories (and the
// hoisted SUT import) reference them.
const {
  mockLimit,
  mockRequireTenantMember,
  mockResolveCallerTenantId,
  mockReadSecret,
  mockGetRef,
  mockGetContent,
} = vi.hoisted(() => ({
  mockLimit: vi.fn(),
  mockRequireTenantMember: vi.fn(),
  mockResolveCallerTenantId: vi.fn(),
  mockReadSecret: vi.fn(),
  mockGetRef: vi.fn(),
  mockGetContent: vi.fn(),
}));

// db.select().from().where().limit() — the resolver runs two such chains
// (routine, then credential); mockLimit is queued per-call by each test.
vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: mockLimit }),
      }),
    }),
  },
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  routines: { id: "routines.id" },
  tenantCredentials: {
    tenant_id: "tenant_credentials.tenant_id",
    slug: "tenant_credentials.slug",
    status: "tenant_credentials.status",
    secret_ref: "tenant_credentials.secret_ref",
  },
}));

vi.mock("../core/authz.js", () => ({
  requireTenantMember: mockRequireTenantMember,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
}));

vi.mock("../../../lib/tenant-credentials/secret-store.js", () => ({
  readTenantCredentialSecret: mockReadSecret,
}));

vi.mock("@octokit/rest", () => ({
  Octokit: class {
    git = { getRef: mockGetRef };
    repos = { getContent: mockGetContent };
  },
}));

import { routineSource } from "./routineSource.query.js";

const ctx = { auth: { tenantId: "tenant-1" } } as never;

function b64(text: string): string {
  return Buffer.from(text, "utf-8").toString("base64");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("routineSource", () => {
  it("reads module + fixtures at the validated sha", async () => {
    mockLimit
      .mockResolvedValueOnce([
        {
          id: "routine-1",
          tenant_id: "tenant-1",
          engine: "git_python",
          module_path: "routines/lastmile.py",
          fixture_paths: ["fixtures/case1.json"],
          validated_sha: "abc123",
        },
      ])
      .mockResolvedValueOnce([{ secretRef: "secret-arn" }]);
    mockReadSecret.mockResolvedValue({
      repoUrl: "https://github.com/acme/routines",
      token: "ghp_x",
      branch: "main",
    });
    mockGetContent
      .mockResolvedValueOnce({
        data: {
          content: b64("def run(ctx):\n    return 1\n"),
          encoding: "base64",
        },
      })
      .mockResolvedValueOnce({
        data: { content: b64('{"input": 1}'), encoding: "base64" },
      });

    const result = await routineSource({}, { routineId: "routine-1" }, ctx);

    expect(result.ref).toBe("abc123");
    expect(mockGetRef).not.toHaveBeenCalled(); // validated sha short-circuits HEAD
    expect(result.files).toEqual([
      {
        path: "routines/lastmile.py",
        content: "def run(ctx):\n    return 1\n",
        language: "python",
      },
      {
        path: "fixtures/case1.json",
        content: '{"input": 1}',
        language: "json",
      },
    ]);
  });

  it("falls back to branch HEAD when there is no validated sha", async () => {
    mockLimit
      .mockResolvedValueOnce([
        {
          id: "routine-1",
          tenant_id: "tenant-1",
          engine: "git_python",
          module_path: "routines/lastmile.py",
          fixture_paths: null,
          validated_sha: null,
        },
      ])
      .mockResolvedValueOnce([{ secretRef: "secret-arn" }]);
    mockReadSecret.mockResolvedValue({
      repoUrl: "acme/routines",
      token: "ghp_x",
      branch: "main",
    });
    mockGetRef.mockResolvedValue({ data: { object: { sha: "head999" } } });
    mockGetContent.mockResolvedValueOnce({
      data: { content: b64("x = 1\n"), encoding: "base64" },
    });

    const result = await routineSource({}, { routineId: "routine-1" }, ctx);

    expect(mockGetRef).toHaveBeenCalledWith({
      owner: "acme",
      repo: "routines",
      ref: "heads/main",
    });
    expect(result.ref).toBe("head999");
    expect(result.files).toHaveLength(1);
  });

  it("rejects a non-git routine", async () => {
    mockLimit.mockResolvedValueOnce([
      { id: "routine-1", tenant_id: "tenant-1", engine: "step_functions" },
    ]);
    await expect(
      routineSource({}, { routineId: "routine-1" }, ctx),
    ).rejects.toThrow(/not found/i);
  });

  it("errors when no routine repo is connected", async () => {
    mockLimit
      .mockResolvedValueOnce([
        {
          id: "routine-1",
          tenant_id: "tenant-1",
          engine: "git_python",
          module_path: "routines/lastmile.py",
          fixture_paths: [],
          validated_sha: "abc",
        },
      ])
      .mockResolvedValueOnce([]);
    await expect(
      routineSource({}, { routineId: "routine-1" }, ctx),
    ).rejects.toThrow(/no routine repo/i);
  });
});
