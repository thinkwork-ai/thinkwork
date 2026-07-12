import { describe, expect, it, vi } from "vitest";
import {
  findActiveUserLink,
  unlinkUser,
  upsertUserLink,
} from "./user-link-store.js";

function fakeDb(options: {
  selectRows?: Array<Record<string, unknown>>;
  insertReturning?: Array<Record<string, unknown>>;
  updateReturning?: Array<Record<string, unknown>>;
}) {
  const insertValues = vi.fn();
  const updateSet = vi.fn();
  const selectRows = options.selectRows ?? [];
  return {
    insertValues,
    updateSet,
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(selectRows),
          }),
        }),
      }),
      insert: () => ({
        values: (value: Record<string, unknown>) => {
          insertValues(value);
          return {
            onConflictDoUpdate: () => ({
              returning: () => Promise.resolve(options.insertReturning ?? []),
            }),
          };
        },
      }),
      update: () => ({
        set: (value: Record<string, unknown>) => {
          updateSet(value);
          return {
            where: () => ({
              returning: () => Promise.resolve(options.updateReturning ?? []),
            }),
          };
        },
      }),
    },
  };
}

describe("Microsoft Teams user link store", () => {
  it("creates, relinks, or reactivates the Entra-tenant-scoped user link", async () => {
    const { db, insertValues } = fakeDb({
      selectRows: [{ tenant_id: "tenant-1", status: "active" }],
      insertReturning: [{ id: "link-1", status: "active" }],
    });

    const row = await upsertUserLink(
      {
        tenantId: "tenant-1",
        entraTenantId: "entra-1",
        aadObjectId: "aad-1",
        userId: "user-1",
        displayName: "Eric",
      },
      db as any
    );

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "tenant-1",
        entra_tenant_id: "entra-1",
        aad_object_id: "aad-1",
        user_id: "user-1",
        display_name: "Eric",
        status: "active",
        unlinked_at: null,
      })
    );
    expect(row).toMatchObject({ id: "link-1", status: "active" });
  });

  it("rejects links when the Teams app is not installed", async () => {
    const { db } = fakeDb({ selectRows: [] });

    await expect(
      upsertUserLink(
        {
          tenantId: "tenant-1",
          entraTenantId: "entra-1",
          aadObjectId: "aad-1",
          userId: "user-1",
        },
        db as any
      )
    ).rejects.toThrow(/not installed/);
  });

  it("rejects links for an Entra tenant installed to another ThinkWork tenant", async () => {
    const { db, insertValues } = fakeDb({
      selectRows: [{ tenant_id: "tenant-other", status: "active" }],
    });

    await expect(
      upsertUserLink(
        {
          tenantId: "tenant-1",
          entraTenantId: "entra-1",
          aadObjectId: "aad-1",
          userId: "user-1",
        },
        db as any
      )
    ).rejects.toThrow(/different ThinkWork tenant/);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("rejects links when the tenant install is not active", async () => {
    const { db } = fakeDb({
      selectRows: [{ tenant_id: "tenant-1", status: "pending" }],
    });

    await expect(
      upsertUserLink(
        {
          tenantId: "tenant-1",
          entraTenantId: "entra-1",
          aadObjectId: "aad-1",
          userId: "user-1",
        },
        db as any
      )
    ).rejects.toThrow(/not active/);
  });

  it("finds only an active user link", async () => {
    const active = fakeDb({
      selectRows: [{ id: "link-1", user_id: "user-1", status: "active" }],
    });
    await expect(
      findActiveUserLink(
        { entraTenantId: "entra-1", aadObjectId: "aad-1" },
        active.db as any
      )
    ).resolves.toMatchObject({ id: "link-1", status: "active" });

    const missing = fakeDb({ selectRows: [] });
    await expect(
      findActiveUserLink(
        { entraTenantId: "entra-1", aadObjectId: "aad-1" },
        missing.db as any
      )
    ).resolves.toBeNull();
  });

  it("unlinks a user and stamps unlinked_at", async () => {
    const { db, updateSet } = fakeDb({
      updateReturning: [{ id: "link-1", status: "unlinked" }],
    });

    const row = await unlinkUser(
      { entraTenantId: "entra-1", aadObjectId: "aad-1" },
      db as any
    );

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "unlinked" })
    );
    expect((updateSet.mock.calls[0]?.[0] as any).unlinked_at).toBeDefined();
    expect(row).toMatchObject({ id: "link-1", status: "unlinked" });
  });

  it("returns null when unlinking a link that does not exist", async () => {
    const { db } = fakeDb({ updateReturning: [] });

    await expect(
      unlinkUser(
        { entraTenantId: "entra-1", aadObjectId: "aad-missing" },
        db as any
      )
    ).resolves.toBeNull();
  });
});
