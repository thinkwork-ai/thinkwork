/**
 * Tenant-scope wiki read surfaces (plan 2026-06-09-004 U14).
 *
 * Exercises the union-read contract without a live Postgres:
 *   - resolveWikiUnionReadScope matrix (caller default, other-user admin
 *     path, service credentials, auth failure mapping)
 *   - wikiPage round-trips a tenant page (owner NULL) with null
 *     userId/ownerId — no cast, no null-propagation
 *   - wikiBacklinks member-only authz branch for tenant-scoped targets
 *   - toGraphQLPage null-owner passthrough
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock handles ────────────────────────────────────────────────────

const {
  mockRequireTenantScope,
  mockRequireUserScope,
  mockFindReadablePageBySlug,
  selectResults,
  selectDistinctResults,
  UserScopeAuthErrorMock,
} = vi.hoisted(() => {
  class UserScopeAuthErrorMock extends Error {
    constructor(message: string) {
      super(message);
      this.name = "UserScopeAuthError";
    }
  }
  return {
    mockRequireTenantScope: vi.fn(),
    mockRequireUserScope: vi.fn(),
    mockFindReadablePageBySlug: vi.fn(),
    // FIFO queues of rows for successive db.select()/db.selectDistinct()
    // chains — resolvers under test issue them in a deterministic order.
    selectResults: [] as unknown[][],
    selectDistinctResults: [] as unknown[][],
    UserScopeAuthErrorMock,
  };
});

vi.mock("../graphql/resolvers/core/require-user-scope.js", () => ({
  requireMemoryTenantScope: mockRequireTenantScope,
  requireMemoryUserScope: mockRequireUserScope,
  requireUserScope: vi.fn(),
  UserScopeAuthError: UserScopeAuthErrorMock,
}));

vi.mock("../lib/wiki/repository.js", async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import("../lib/wiki/repository.js");
  return {
    ...actual,
    findReadablePageBySlug: mockFindReadablePageBySlug,
  };
});

vi.mock("../graphql/utils.js", () => {
  const chainFor = (queue: unknown[][]) => {
    const rows = queue.shift() ?? [];
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: (v: unknown[]) => unknown, reject?: any) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  };
  return {
    db: {
      select: vi.fn(() => chainFor(selectResults)),
      selectDistinct: vi.fn(() => chainFor(selectDistinctResults)),
    },
  };
});

vi.mock("@thinkwork/database-pg/schema", () => {
  const col = (name: string) => ({ name });
  return {
    wikiPages: {
      id: col("pages.id"),
      tenant_id: col("pages.tenant_id"),
      owner_id: col("pages.owner_id"),
      type: col("pages.type"),
      slug: col("pages.slug"),
      status: col("pages.status"),
    },
    wikiPageLinks: {
      from_page_id: col("page_links.from_page_id"),
      to_page_id: col("page_links.to_page_id"),
    },
    wikiPageSections: {
      page_id: col("page_sections.page_id"),
      position: col("page_sections.position"),
    },
    wikiPageAliases: {
      page_id: col("page_aliases.page_id"),
      alias: col("page_aliases.alias"),
    },
  };
});

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("drizzle-orm");
  return {
    ...actual,
    eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
    and: (...xs: unknown[]) => ({ __and: xs }),
    asc: (x: unknown) => ({ __asc: x }),
    inArray: (a: unknown, b: unknown) => ({ __in: [a, b] }),
  };
});

// ─── Import after mocks ──────────────────────────────────────────────────────

import {
  resolveWikiUnionReadScope,
  WikiAuthError,
} from "../graphql/resolvers/wiki/auth.js";
import { wikiPage } from "../graphql/resolvers/wiki/wikiPage.query.js";
import { wikiBacklinks } from "../graphql/resolvers/wiki/wikiBacklinks.query.js";
import { toGraphQLPage } from "../graphql/resolvers/wiki/mappers.js";
import type { GraphQLContext } from "../graphql/context.js";

function makeCtx(): GraphQLContext {
  return {
    auth: {
      principalId: "u1",
      tenantId: "t1",
      email: "member@acme.test",
      authType: "cognito",
    },
  } as unknown as GraphQLContext;
}

function tenantPageRow(over: Record<string, unknown> = {}) {
  return {
    id: "page-1",
    tenant_id: "t1",
    owner_id: null,
    type: "entity",
    entity_subtype: "customer",
    slug: "acme",
    title: "Acme",
    summary: "Tenant-shared customer page",
    body_md: "## Overview\n\nAcme.",
    status: "active",
    parent_page_id: null,
    place_id: null,
    hubness_score: 0,
    tags: [],
    last_compiled_at: new Date("2026-06-09T00:00:00Z"),
    created_at: new Date("2026-06-01T00:00:00Z"),
    updated_at: new Date("2026-06-09T00:00:00Z"),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  selectResults.length = 0;
  selectDistinctResults.length = 0;
  mockRequireTenantScope.mockResolvedValue({ tenantId: "t1", userId: "u1" });
  mockRequireUserScope.mockResolvedValue({ tenantId: "t1", userId: "u2" });
});

// ─── resolveWikiUnionReadScope ───────────────────────────────────────────────

describe("resolveWikiUnionReadScope", () => {
  it("defaults to a tenantUnion scope keyed on the caller (any tenant member)", async () => {
    const out = await resolveWikiUnionReadScope(makeCtx(), { tenantId: "t1" });
    expect(out).toEqual({
      tenantId: "t1",
      scope: { kind: "tenantUnion", userId: "u1" },
      userId: "u1",
    });
    // No owner-or-admin check is needed for the caller's own union read.
    expect(mockRequireUserScope).not.toHaveBeenCalled();
  });

  it("treats an explicit userId equal to the caller as the caller path", async () => {
    const out = await resolveWikiUnionReadScope(makeCtx(), {
      tenantId: "t1",
      userId: "u1",
    });
    expect(out.scope).toEqual({ kind: "tenantUnion", userId: "u1" });
    expect(mockRequireUserScope).not.toHaveBeenCalled();
  });

  it("keeps the v1 owner-or-admin rule when reading another user's scope", async () => {
    const out = await resolveWikiUnionReadScope(makeCtx(), {
      tenantId: "t1",
      userId: "u2",
    });
    expect(mockRequireUserScope).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: "u2", allowTenantAdmin: true }),
    );
    expect(out.scope).toEqual({ kind: "tenantUnion", userId: "u2" });
  });

  it("maps non-member tenant rejection to WikiAuthError", async () => {
    mockRequireTenantScope.mockRejectedValueOnce(
      new UserScopeAuthErrorMock("Access denied: tenant mismatch"),
    );
    await expect(
      resolveWikiUnionReadScope(makeCtx(), { tenantId: "t-other" }),
    ).rejects.toThrow(WikiAuthError);
  });

  it("serves tenant pages only for pure service credentials (no user)", async () => {
    mockRequireTenantScope.mockResolvedValueOnce({
      tenantId: "t1",
      userId: null,
    });
    const out = await resolveWikiUnionReadScope(makeCtx(), { tenantId: "t1" });
    expect(out.scope).toEqual({ kind: "tenantUnion", userId: null });
  });
});

// ─── wikiPage — tenant page round-trip ───────────────────────────────────────

describe("wikiPage tenant round-trip", () => {
  it("returns a tenant page with null userId/ownerId and mapped sections", async () => {
    mockFindReadablePageBySlug.mockResolvedValueOnce(tenantPageRow());
    selectResults.push(
      // sections
      [
        {
          id: "s1",
          section_slug: "overview",
          heading: "Overview",
          body_md: "Acme.",
          position: 0,
          last_source_at: new Date("2026-06-09T00:00:00Z"),
        },
      ],
      // aliases
      [{ alias: "Acme Corp" }],
    );

    const out = await wikiPage(
      null,
      { tenantId: "t1", type: "ENTITY", slug: "acme" },
      makeCtx(),
    );

    expect(out).not.toBeNull();
    expect(out!.userId).toBeNull();
    expect(out!.ownerId).toBeNull();
    expect(out!.type).toBe("ENTITY");
    expect(out!.sections).toEqual([
      {
        id: "s1",
        sectionSlug: "overview",
        heading: "Overview",
        bodyMd: "Acme.",
        position: 0,
        lastSourceAt: "2026-06-09T00:00:00.000Z",
      },
    ]);
    expect(out!.aliases).toEqual(["Acme Corp"]);

    // The read went through the union scope keyed on the caller.
    expect(mockFindReadablePageBySlug).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "t1",
        scope: { kind: "tenantUnion", userId: "u1" },
        type: "entity",
        slug: "acme",
      }),
      expect.anything(),
    );
  });

  it("propagates membership rejection as WikiAuthError", async () => {
    mockRequireTenantScope.mockRejectedValueOnce(
      new UserScopeAuthErrorMock("Access denied: tenant mismatch"),
    );
    await expect(
      wikiPage(
        null,
        { tenantId: "t1", type: "ENTITY", slug: "acme" },
        makeCtx(),
      ),
    ).rejects.toThrow(WikiAuthError);
    expect(mockFindReadablePageBySlug).not.toHaveBeenCalled();
  });
});

// ─── wikiBacklinks — tenant-scoped target authz ──────────────────────────────

describe("wikiBacklinks tenant-scoped target", () => {
  it("lets any tenant member read backlinks of a null-owner page", async () => {
    selectResults.push(
      // target lookup
      [{ id: "page-1", tenant_id: "t1", owner_id: null }],
      // backlink source pages
      [tenantPageRow({ id: "page-2", slug: "acme-hq", title: "Acme HQ" })],
    );
    selectDistinctResults.push([{ id: "page-2" }]);

    const out = await wikiBacklinks(null, { pageId: "page-1" }, makeCtx());

    expect(mockRequireTenantScope).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: "t1" }),
    );
    // Member-only, NOT owner-or-admin: the user-scope rule never runs.
    expect(mockRequireUserScope).not.toHaveBeenCalled();
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("page-2");
    expect(out[0].userId).toBeNull();
  });

  it("rejects non-members of the tenant", async () => {
    selectResults.push([{ id: "page-1", tenant_id: "t1", owner_id: null }]);
    mockRequireTenantScope.mockRejectedValueOnce(
      new UserScopeAuthErrorMock("Access denied: tenant mismatch"),
    );
    await expect(
      wikiBacklinks(null, { pageId: "page-1" }, makeCtx()),
    ).rejects.toThrow(WikiAuthError);
  });

  it("keeps the owner-or-admin rule for user-scoped targets", async () => {
    selectResults.push([{ id: "page-9", tenant_id: "t1", owner_id: "u2" }], []);
    selectDistinctResults.push([]);
    await wikiBacklinks(null, { pageId: "page-9" }, makeCtx());
    expect(mockRequireUserScope).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: "u2" }),
    );
    expect(mockRequireTenantScope).not.toHaveBeenCalled();
  });
});

// ─── toGraphQLPage — null owner passthrough ──────────────────────────────────

describe("toGraphQLPage null-owner mapping", () => {
  it("maps owner_id NULL to null userId/ownerId without casting", () => {
    const mapped = toGraphQLPage(tenantPageRow(), {
      sections: [],
      aliases: [],
    });
    expect(mapped.userId).toBeNull();
    expect(mapped.ownerId).toBeNull();
    expect(mapped.tenantId).toBe("t1");
  });

  it("keeps user-scoped rows byte-identical (owner set)", () => {
    const mapped = toGraphQLPage(tenantPageRow({ owner_id: "u1" }), {
      sections: [],
      aliases: [],
    });
    expect(mapped.userId).toBe("u1");
    expect(mapped.ownerId).toBe("u1");
  });
});
