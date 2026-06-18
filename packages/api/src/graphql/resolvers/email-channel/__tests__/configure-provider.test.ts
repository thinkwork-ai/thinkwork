import { beforeEach, describe, expect, it, vi } from "vitest";

const { requirePluginTenantAdminMock } = vi.hoisted(() => ({
  requirePluginTenantAdminMock: vi.fn(),
}));

vi.mock("../../plugins/shared.js", () => ({
  requirePluginTenantAdmin: requirePluginTenantAdminMock,
}));

// eslint-disable-next-line import/first
import { configureEmailProvider } from "../mutations.js";

describe("configureEmailProvider", () => {
  const updateSets: Array<Record<string, unknown>> = [];
  const insertValues: Array<Record<string, unknown>> = [];
  const conflictSets: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    requirePluginTenantAdminMock.mockReset();
    requirePluginTenantAdminMock.mockResolvedValue({
      tenantId: "tenant-A",
      callerUserId: "operator-user",
    });
    updateSets.length = 0;
    insertValues.length = 0;
    conflictSets.length = 0;
  });

  it("persists explicit SES selection as active for production", async () => {
    const ctx = {
      db: {
        update: vi.fn(() => ({
          set: (set: Record<string, unknown>) => {
            updateSets.push(set);
            return {
              where: () => Promise.resolve([]),
            };
          },
        })),
        insert: vi.fn(() => ({
          values: (values: Record<string, unknown>) => {
            insertValues.push(values);
            return {
              onConflictDoUpdate: ({
                set,
              }: {
                set: Record<string, unknown>;
              }) => {
                conflictSets.push(set);
                return {
                  returning: () =>
                    Promise.resolve([
                      {
                        id: "provider-ses",
                        tenant_id: "tenant-A",
                        provider: "ses",
                        display_name: "SES",
                        status: "ready",
                        active_for_production: set.active_for_production,
                        credential_secret_ref: null,
                        webhook_secret_ref: null,
                        default_from_email: null,
                        metadata: set.metadata,
                        created_at: new Date("2026-06-17T12:00:00Z"),
                        updated_at: new Date("2026-06-17T12:00:00Z"),
                      },
                    ]),
                };
              },
            };
          },
        })),
      },
    };

    const result = await configureEmailProvider(
      null,
      {
        input: {
          provider: "SES",
          displayName: "SES",
          status: "READY",
          activeForProduction: true,
        },
      },
      ctx as never,
    );

    expect(updateSets[0]).toMatchObject({ active_for_production: false });
    expect(insertValues[0]).toMatchObject({
      tenant_id: "tenant-A",
      provider: "ses",
      active_for_production: true,
    });
    expect(conflictSets[0]).toMatchObject({
      active_for_production: true,
      status: "ready",
    });
    expect(result).toMatchObject({
      id: "provider-ses",
      provider: "SES",
      activeForProduction: true,
    });
  });
});
