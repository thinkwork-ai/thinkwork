import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const {
  requireAdminOrServiceCallerMock,
  resolveCallerTenantIdMock,
  resolveCallerUserIdMock,
  selectMock,
} = vi.hoisted(() => ({
  requireAdminOrServiceCallerMock: vi.fn(),
  resolveCallerTenantIdMock: vi.fn(),
  resolveCallerUserIdMock: vi.fn(),
  selectMock: vi.fn(),
}));

vi.mock("../graphql/resolvers/core/authz.js", () => ({
  requireAdminOrServiceCaller: requireAdminOrServiceCallerMock,
}));

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: resolveCallerTenantIdMock,
  resolveCallerUserId: resolveCallerUserIdMock,
}));

import {
  assertCanReadKnowledgeGraphThread,
  resolveKnowledgeGraphScope,
  threadVisibilityWhereSql,
} from "../graphql/resolvers/knowledge-graph/auth.js";

function ctx(auth: Record<string, unknown> = {}) {
  return {
    auth: { authType: "cognito", tenantId: "tenant-1", ...auth },
    db: {
      select: selectMock,
    },
  } as any;
}

function selectRows(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  selectMock.mockReturnValueOnce({ from });
  return { from, where, limit };
}

beforeEach(() => {
  requireAdminOrServiceCallerMock.mockReset();
  requireAdminOrServiceCallerMock.mockResolvedValue(undefined);
  resolveCallerTenantIdMock.mockReset();
  resolveCallerTenantIdMock.mockResolvedValue("tenant-1");
  resolveCallerUserIdMock.mockReset();
  resolveCallerUserIdMock.mockResolvedValue("user-1");
  selectMock.mockReset();
});

describe("knowledge graph tenant scoping", () => {
  it("defaults tenantId from the caller and requires tenant admin access", async () => {
    const context = ctx({ tenantId: null });

    await expect(
      resolveKnowledgeGraphScope(context, {}, "knowledge_graph_entities"),
    ).resolves.toEqual({
      tenantId: "tenant-1",
      callerUserId: "user-1",
      requiresUserThreadVisibility: true,
    });

    expect(requireAdminOrServiceCallerMock).toHaveBeenCalledWith(
      context,
      "tenant-1",
      "knowledge_graph_entities",
    );
  });

  it("rejects a mismatched explicit tenant before the admin gate", async () => {
    await expect(
      resolveKnowledgeGraphScope(
        ctx(),
        { tenantId: "tenant-2" },
        "knowledge_graph_entities",
      ),
    ).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" },
    });
    expect(requireAdminOrServiceCallerMock).not.toHaveBeenCalled();
  });

  it("returns false for a cross-tenant or invisible thread", async () => {
    selectRows([]);

    await expect(
      assertCanReadKnowledgeGraphThread(
        ctx(),
        {
          tenantId: "tenant-1",
          callerUserId: "user-1",
          requiresUserThreadVisibility: true,
        },
        "thread-2",
      ),
    ).resolves.toBe(false);
  });

  it("allows service callers to skip user-level thread visibility", async () => {
    const context = ctx({ authType: "service", tenantId: "tenant-1" });
    selectRows([{ id: "thread-1" }]);

    const scope = await resolveKnowledgeGraphScope(
      context,
      { tenantId: "tenant-1" },
      "knowledge_graph_graph",
    );

    expect(scope).toEqual({
      tenantId: "tenant-1",
      callerUserId: null,
      requiresUserThreadVisibility: false,
    });
    await expect(
      assertCanReadKnowledgeGraphThread(context, scope, "thread-1"),
    ).resolves.toBe(true);
  });

  it("does not authorize knowledge graph thread results through Space visibility", async () => {
    const predicate = await threadVisibilityWhereSql({
      tenantId: "tenant-1",
      callerUserId: "user-1",
      requiresUserThreadVisibility: true,
    });

    const rendered = new PgDialect().sqlToQuery(predicate).sql;
    expect(rendered).toContain("t.user_id");
    expect(rendered).toContain("thread_participants");
    expect(rendered).not.toContain("caller_space");
    expect(rendered).not.toContain("space_members");
    expect(rendered).not.toContain("access_mode");
  });
});
