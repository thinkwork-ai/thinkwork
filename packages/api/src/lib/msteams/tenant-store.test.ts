import { describe, expect, it, vi } from "vitest";
import {
  MsteamsTenantConflictError,
  activateTenantInstall,
  findActiveTenantInstall,
  getTenantInstallStatus,
  markConsent,
  revokeTenantInstall,
  upsertTenantInstall,
} from "./tenant-store.js";

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
        from: () => {
          const rows = Promise.resolve(selectRows);
          return Object.assign(rows, {
            where: () => {
              const whereRows = Promise.resolve(selectRows);
              return Object.assign(whereRows, {
                limit: () => Promise.resolve(selectRows),
              });
            },
          });
        },
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

describe("Microsoft Teams tenant install store", () => {
  it("creates a pending install on first upsert", async () => {
    const { db, insertValues } = fakeDb({
      selectRows: [],
      insertReturning: [
        { id: "install-1", status: "pending", consent_status: "pending" },
      ],
    });

    const row = await upsertTenantInstall(
      {
        tenantId: "tenant-1",
        entraTenantId: "entra-1",
        botAppId: "bot-app-1",
        installedByUserId: "user-1",
      },
      db as any
    );

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "tenant-1",
        entra_tenant_id: "entra-1",
        bot_app_id: "bot-app-1",
        installed_by_user_id: "user-1",
        status: "pending",
        consent_status: "pending",
      })
    );
    expect(row).toMatchObject({ id: "install-1", status: "pending" });
  });

  it("is idempotent for replays with the same tenant binding", async () => {
    const { db } = fakeDb({
      selectRows: [{ tenant_id: "tenant-1" }],
      insertReturning: [
        { id: "install-1", tenant_id: "tenant-1", status: "pending" },
      ],
    });

    const row = await upsertTenantInstall(
      {
        tenantId: "tenant-1",
        entraTenantId: "entra-1",
        botAppId: "bot-app-2",
      },
      db as any
    );

    expect(row).toMatchObject({ id: "install-1", tenant_id: "tenant-1" });
  });

  it("fails closed on a cross-tenant binding conflict without mutating", async () => {
    const { db, insertValues, updateSet } = fakeDb({
      selectRows: [{ tenant_id: "tenant-other" }],
    });

    await expect(
      upsertTenantInstall(
        {
          tenantId: "tenant-1",
          entraTenantId: "entra-1",
          botAppId: "bot-app-1",
        },
        db as any
      )
    ).rejects.toBeInstanceOf(MsteamsTenantConflictError);

    expect(insertValues).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("fails closed when a concurrent conflicting insert wins the race", async () => {
    // Pre-check saw no row, but the guarded upsert matched nothing because
    // the row now belongs to another tenant: returning is empty.
    const { db } = fakeDb({ selectRows: [], insertReturning: [] });

    await expect(
      upsertTenantInstall(
        {
          tenantId: "tenant-1",
          entraTenantId: "entra-1",
          botAppId: "bot-app-1",
        },
        db as any
      )
    ).rejects.toBeInstanceOf(MsteamsTenantConflictError);
  });

  it("activates an install with consent status and installed_at", async () => {
    const { db, updateSet } = fakeDb({
      updateReturning: [
        { id: "install-1", status: "active", consent_status: "granted" },
      ],
    });

    const row = await activateTenantInstall(
      { entraTenantId: "entra-1", consentStatus: "granted" },
      db as any
    );

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "active",
        consent_status: "granted",
        uninstalled_at: null,
      })
    );
    expect((updateSet.mock.calls[0]?.[0] as any).installed_at).toBeDefined();
    expect(row).toMatchObject({ id: "install-1", status: "active" });
  });

  it("marks consent status without touching install status", async () => {
    const { db, updateSet } = fakeDb({
      updateReturning: [{ id: "install-1", consent_status: "admin_required" }],
    });

    const row = await markConsent(
      { entraTenantId: "entra-1", consentStatus: "admin_required" },
      db as any
    );

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ consent_status: "admin_required" })
    );
    expect((updateSet.mock.calls[0]?.[0] as any).status).toBeUndefined();
    expect(row).toMatchObject({ consent_status: "admin_required" });
  });

  it("revokes an install and stamps uninstalled_at", async () => {
    const { db, updateSet } = fakeDb({
      updateReturning: [{ id: "install-1", status: "revoked" }],
    });

    const row = await revokeTenantInstall(
      { entraTenantId: "entra-1" },
      db as any
    );

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "revoked" })
    );
    expect((updateSet.mock.calls[0]?.[0] as any).uninstalled_at).toBeDefined();
    expect(row).toMatchObject({ status: "revoked" });
  });

  it("returns null from update-based transitions when no install matches", async () => {
    const { db } = fakeDb({ updateReturning: [] });

    await expect(
      revokeTenantInstall({ entraTenantId: "entra-missing" }, db as any)
    ).resolves.toBeNull();
  });

  it("finds an active install, or null when absent", async () => {
    const active = fakeDb({
      selectRows: [{ id: "install-1", status: "active" }],
    });
    await expect(
      findActiveTenantInstall({ entraTenantId: "entra-1" }, active.db as any)
    ).resolves.toMatchObject({ id: "install-1", status: "active" });

    const missing = fakeDb({ selectRows: [] });
    await expect(
      findActiveTenantInstall({ entraTenantId: "entra-1" }, missing.db as any)
    ).resolves.toBeNull();
  });

  it("returns tenant-scoped install rows for the health view", async () => {
    const { db } = fakeDb({
      selectRows: [
        { id: "install-1", tenant_id: "tenant-1", status: "active" },
      ],
    });

    await expect(
      getTenantInstallStatus({ tenantId: "tenant-1" }, db as any)
    ).resolves.toEqual([
      { id: "install-1", tenant_id: "tenant-1", status: "active" },
    ]);
  });
});
