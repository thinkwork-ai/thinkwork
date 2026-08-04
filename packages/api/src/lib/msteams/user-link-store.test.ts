import { describe, expect, it, vi } from "vitest";
import {
  MsteamsLinkConflictError,
  findActiveUserLink,
  unlinkUser,
  upsertUserLink,
} from "./user-link-store.js";

const ACTIVE_INSTALL = { tenant_id: "tenant-1", status: "active" };

function fakeDb(options: {
  /**
   * Result sets returned by successive SELECTs, in call order.
   * upsertUserLink issues two: the install lookup, then the existing-link
   * pre-check. Missing entries resolve to [].
   */
  selectResults?: Array<Array<Record<string, unknown>>>;
  insertReturning?: Array<Record<string, unknown>>;
  updateReturning?: Array<Record<string, unknown>>;
}) {
  const insertValues = vi.fn();
  const updateSet = vi.fn();
  const selectQueue = [...(options.selectResults ?? [])];
  const nextSelect = () => Promise.resolve(selectQueue.shift() ?? []);
  return {
    insertValues,
    updateSet,
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => nextSelect(),
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
  it("creates the Entra-tenant-scoped user link when none exists", async () => {
    const { db, insertValues } = fakeDb({
      selectResults: [[ACTIVE_INSTALL], []],
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
      db as any,
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
      }),
    );
    expect(row).toMatchObject({ id: "link-1", status: "active" });
  });

  it("relinks the same user idempotently over an active link", async () => {
    const { db, insertValues } = fakeDb({
      selectResults: [
        [ACTIVE_INSTALL],
        [{ user_id: "user-1", status: "active" }],
      ],
      insertReturning: [{ id: "link-1", user_id: "user-1", status: "active" }],
    });

    const row = await upsertUserLink(
      {
        tenantId: "tenant-1",
        entraTenantId: "entra-1",
        aadObjectId: "aad-1",
        userId: "user-1",
      },
      db as any,
    );

    expect(insertValues).toHaveBeenCalled();
    expect(row).toMatchObject({ user_id: "user-1", status: "active" });
  });

  it("reactivates an unlinked row for any valid redemption", async () => {
    const { db } = fakeDb({
      selectResults: [
        [ACTIVE_INSTALL],
        [{ user_id: "someone-else", status: "unlinked" }],
      ],
      insertReturning: [{ id: "link-1", user_id: "user-1", status: "active" }],
    });

    const row = await upsertUserLink(
      {
        tenantId: "tenant-1",
        entraTenantId: "entra-1",
        aadObjectId: "aad-1",
        userId: "user-1",
      },
      db as any,
    );

    expect(row).toMatchObject({ user_id: "user-1", status: "active" });
  });

  it("fails closed when an active link belongs to a different user (pre-check)", async () => {
    const { db, insertValues } = fakeDb({
      selectResults: [
        [ACTIVE_INSTALL],
        [{ user_id: "someone-else", status: "active" }],
      ],
    });

    await expect(
      upsertUserLink(
        {
          tenantId: "tenant-1",
          entraTenantId: "entra-1",
          aadObjectId: "aad-1",
          userId: "user-1",
        },
        db as any,
      ),
    ).rejects.toBeInstanceOf(MsteamsLinkConflictError);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("fails closed when a concurrent conflicting link wins the race", async () => {
    // Pre-check saw no existing link, but the onConflict where-guard matched
    // nothing because the row was concurrently activated for another user:
    // returning is empty and the conflict error is raised.
    const { db, insertValues } = fakeDb({
      selectResults: [[ACTIVE_INSTALL], []],
      insertReturning: [],
    });

    await expect(
      upsertUserLink(
        {
          tenantId: "tenant-1",
          entraTenantId: "entra-1",
          aadObjectId: "aad-1",
          userId: "user-1",
        },
        db as any,
      ),
    ).rejects.toBeInstanceOf(MsteamsLinkConflictError);
    expect(insertValues).toHaveBeenCalled();
  });

  it("rejects links when the Teams app is not installed", async () => {
    const { db } = fakeDb({ selectResults: [[]] });

    await expect(
      upsertUserLink(
        {
          tenantId: "tenant-1",
          entraTenantId: "entra-1",
          aadObjectId: "aad-1",
          userId: "user-1",
        },
        db as any,
      ),
    ).rejects.toThrow(/not installed/);
  });

  it("rejects links for an Entra tenant installed to another ThinkWork tenant", async () => {
    const { db, insertValues } = fakeDb({
      selectResults: [[{ tenant_id: "tenant-other", status: "active" }]],
    });

    await expect(
      upsertUserLink(
        {
          tenantId: "tenant-1",
          entraTenantId: "entra-1",
          aadObjectId: "aad-1",
          userId: "user-1",
        },
        db as any,
      ),
    ).rejects.toThrow(/different ThinkWork tenant/);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("rejects links when the tenant install is not active", async () => {
    const { db } = fakeDb({
      selectResults: [[{ tenant_id: "tenant-1", status: "pending" }]],
    });

    await expect(
      upsertUserLink(
        {
          tenantId: "tenant-1",
          entraTenantId: "entra-1",
          aadObjectId: "aad-1",
          userId: "user-1",
        },
        db as any,
      ),
    ).rejects.toThrow(/not active/);
  });

  it("finds only an active user link", async () => {
    const active = fakeDb({
      selectResults: [[{ id: "link-1", user_id: "user-1", status: "active" }]],
    });
    await expect(
      findActiveUserLink(
        { entraTenantId: "entra-1", aadObjectId: "aad-1" },
        active.db as any,
      ),
    ).resolves.toMatchObject({ id: "link-1", status: "active" });

    const missing = fakeDb({ selectResults: [[]] });
    await expect(
      findActiveUserLink(
        { entraTenantId: "entra-1", aadObjectId: "aad-1" },
        missing.db as any,
      ),
    ).resolves.toBeNull();
  });

  it("unlinks a user and stamps unlinked_at", async () => {
    const { db, updateSet } = fakeDb({
      updateReturning: [{ id: "link-1", status: "unlinked" }],
    });

    const row = await unlinkUser(
      { entraTenantId: "entra-1", aadObjectId: "aad-1" },
      db as any,
    );

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "unlinked" }),
    );
    expect((updateSet.mock.calls[0]?.[0] as any).unlinked_at).toBeDefined();
    expect(row).toMatchObject({ id: "link-1", status: "unlinked" });
  });

  it("returns null when unlinking a link that does not exist", async () => {
    const { db } = fakeDb({ updateReturning: [] });

    await expect(
      unlinkUser(
        { entraTenantId: "entra-1", aadObjectId: "aad-missing" },
        db as any,
      ),
    ).resolves.toBeNull();
  });
});
