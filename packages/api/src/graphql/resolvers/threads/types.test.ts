import { describe, expect, it, vi } from "vitest";

const { mockDb, computerRows } = vi.hoisted(() => {
  const computerRows: Record<string, unknown>[] = [];
  const mockDb = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => computerRows),
      })),
    })),
  };

  return { mockDb, computerRows };
});

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    db: mockDb,
    eq: vi.fn(() => ({ match: true })),
    computers: {
      id: { __column__: "id" },
    },
    computerToCamel: (row: Record<string, unknown>) => ({
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      slug: row.slug,
      status:
        typeof row.status === "string" ? row.status.toUpperCase() : row.status,
    }),
  };
});

describe("Thread type attribution resolvers", () => {
  it("resolves a related Computer from thread.computerId", async () => {
    computerRows.length = 0;
    computerRows.push({
      id: "computer-1",
      tenant_id: "tenant-1",
      name: "Base Computer",
      slug: "base-computer",
      status: "active",
    });

    const { threadTypeResolvers } = await import("./types.js");

    await expect(
      threadTypeResolvers.computer({ computerId: "computer-1" }),
    ).resolves.toMatchObject({
      id: "computer-1",
      name: "Base Computer",
      slug: "base-computer",
      status: "ACTIVE",
    });
  });

  it("resolves the request User through the existing user loader", async () => {
    const load = vi.fn(async (id: string) => ({
      id,
      name: "Eric Odom",
      email: "eric@thinkwork.ai",
    }));
    const { threadTypeResolvers } = await import("./types.js");

    await expect(
      threadTypeResolvers.user({ userId: "user-1" }, {}, {
        loaders: { user: { load } },
      } as any),
    ).resolves.toMatchObject({
      id: "user-1",
      name: "Eric Odom",
    });
    expect(load).toHaveBeenCalledWith("user-1");
  });

  it("returns null for missing attribution IDs", async () => {
    const { threadTypeResolvers } = await import("./types.js");

    await expect(threadTypeResolvers.computer({})).resolves.toBeNull();
    expect(
      threadTypeResolvers.user({}, {}, {
        loaders: { user: { load: vi.fn() } },
      } as any),
    ).toBeNull();
  });
});
