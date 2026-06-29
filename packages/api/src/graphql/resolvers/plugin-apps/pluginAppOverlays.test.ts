import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __setPluginAppOverlayDepsForTests,
  pluginAppOverlaysQuery,
  upsertPluginAppOverlay,
} from "./pluginAppOverlays.js";

const CTX = { auth: { tenantId: null } } as never;

const resolveTenantCaller = vi.fn();
const resolvePluginApp = vi.fn();
let restoreDeps: (() => void) | null = null;
let store: InMemoryOverlayStore;

describe("plugin app overlays", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    store = new InMemoryOverlayStore();
    resolveTenantCaller.mockResolvedValue({
      tenantId: "tenant-1",
      callerUserId: "user-1",
    });
    resolvePluginApp.mockResolvedValue({
      pluginInstallId: "install-1",
      pluginKey: "twenty",
      appSurfaceKey: "client-engagement",
      appKey: "twenty-client-engagement",
    });
    restoreDeps = __setPluginAppOverlayDepsForTests({
      resolveTenantCaller,
      resolvePluginApp,
      overlayStore: store,
    });
  });

  afterEach(() => {
    restoreDeps?.();
    restoreDeps = null;
  });

  it("upserts and re-queries overlay sections for an opportunity", async () => {
    await upsertPluginAppOverlay(
      null,
      {
        input: overlayInput({
          sectionKey: "kpi-baseline",
          payload: { target: "Reduce analyst hours", baselineHours: 42 },
        }),
      },
      CTX,
    );
    await upsertPluginAppOverlay(
      null,
      {
        input: overlayInput({
          sectionKey: "executive-narrative",
          payload: { summary: "Board-ready JDE visibility story" },
        }),
      },
      CTX,
    );

    const result = await pluginAppOverlaysQuery(
      null,
      {
        input: {
          appKey: "twenty-client-engagement",
          provider: "twenty",
          providerRecordType: "opportunity",
          providerRecordId: "opp-1",
        },
      },
      CTX,
    );

    expect(result.map((overlay) => overlay.sectionKey)).toEqual([
      "executive-narrative",
      "kpi-baseline",
    ]);
    expect(result[1]?.payload).toEqual({
      target: "Reduce analyst hours",
      baselineHours: 42,
    });
  });

  it("does not collide overlays for two records with the same section key", async () => {
    await upsertPluginAppOverlay(
      null,
      {
        input: overlayInput({
          providerRecordId: "opp-1",
          sectionKey: "kpi-baseline",
          payload: { baselineHours: 42 },
        }),
      },
      CTX,
    );
    await upsertPluginAppOverlay(
      null,
      {
        input: overlayInput({
          providerRecordId: "opp-2",
          sectionKey: "kpi-baseline",
          payload: { baselineHours: 7 },
        }),
      },
      CTX,
    );

    const result = await pluginAppOverlaysQuery(
      null,
      {
        input: {
          appKey: "twenty-client-engagement",
          provider: "twenty",
          providerRecordType: "opportunity",
          providerRecordId: "opp-2",
        },
      },
      CTX,
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.payload).toEqual({ baselineHours: 7 });
  });

  it("keeps overlays tenant-shared while updating audit user on write", async () => {
    const first = await upsertPluginAppOverlay(
      null,
      {
        input: overlayInput({
          sectionKey: "executive-narrative",
          payload: { summary: "Initial" },
        }),
      },
      CTX,
    );
    resolveTenantCaller.mockResolvedValue({
      tenantId: "tenant-1",
      callerUserId: "user-2",
    });

    const visibleToSecondUser = await pluginAppOverlaysQuery(
      null,
      {
        input: {
          appKey: "twenty-client-engagement",
          provider: "twenty",
          providerRecordType: "opportunity",
          providerRecordId: "opp-1",
        },
      },
      CTX,
    );
    const second = await upsertPluginAppOverlay(
      null,
      {
        input: overlayInput({
          sectionKey: "executive-narrative",
          payload: { summary: "Updated" },
        }),
      },
      CTX,
    );

    expect(visibleToSecondUser[0]?.id).toBe(first.id);
    expect(visibleToSecondUser[0]?.payload).toEqual({ summary: "Initial" });
    expect(second.id).toBe(first.id);
    expect(second.createdByUserId).toBe("user-1");
    expect(second.updatedByUserId).toBe("user-2");
    expect(second.payload).toEqual({ summary: "Updated" });
    expect(store.rows).toHaveLength(1);
  });

  it("does not expose another tenant's overlay rows", async () => {
    await upsertPluginAppOverlay(
      null,
      {
        input: overlayInput({
          sectionKey: "kpi-baseline",
          payload: { baselineHours: 42 },
        }),
      },
      CTX,
    );
    resolveTenantCaller.mockResolvedValue({
      tenantId: "tenant-2",
      callerUserId: "user-3",
    });
    resolvePluginApp.mockResolvedValue({
      pluginInstallId: "install-2",
      pluginKey: "twenty",
      appSurfaceKey: "client-engagement",
      appKey: "twenty-client-engagement",
    });

    const result = await pluginAppOverlaysQuery(
      null,
      {
        input: {
          appKey: "twenty-client-engagement",
          provider: "twenty",
          providerRecordType: "opportunity",
          providerRecordId: "opp-1",
        },
      },
      CTX,
    );

    expect(result).toEqual([]);
  });

  it("requires a launchable installed app surface before reading or writing", async () => {
    resolvePluginApp.mockRejectedValue(
      Object.assign(new Error("Plugin app is not installed"), {
        extensions: { code: "PLUGIN_APP_NOT_FOUND" },
      }),
    );

    await expect(
      pluginAppOverlaysQuery(
        null,
        {
          input: {
            appKey: "twenty-client-engagement",
            provider: "twenty",
            providerRecordType: "opportunity",
            providerRecordId: "opp-1",
          },
        },
        CTX,
      ),
    ).rejects.toMatchObject({
      extensions: { code: "PLUGIN_APP_NOT_FOUND" },
    });
    await expect(
      upsertPluginAppOverlay(
        null,
        {
          input: overlayInput({
            sectionKey: "kpi-baseline",
            payload: { baselineHours: 42 },
          }),
        },
        CTX,
      ),
    ).rejects.toMatchObject({
      extensions: { code: "PLUGIN_APP_NOT_FOUND" },
    });
    expect(store.rows).toHaveLength(0);
  });

  it("rejects non-object payloads", async () => {
    await expect(
      upsertPluginAppOverlay(
        null,
        {
          input: overlayInput({
            sectionKey: "kpi-baseline",
            payload: ["not", "an", "object"],
          }),
        },
        CTX,
      ),
    ).rejects.toMatchObject({
      extensions: { code: "BAD_USER_INPUT" },
    });
  });
});

function overlayInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    appKey: "twenty-client-engagement",
    provider: "twenty",
    providerRecordType: "opportunity",
    providerRecordId: "opp-1",
    sectionKey: "kpi-baseline",
    payload: {},
    ...overrides,
  } as {
    appKey: string;
    provider: string;
    providerRecordType: string;
    providerRecordId: string;
    sectionKey: string;
    payload: unknown;
  };
}

interface Identity {
  tenantId: string;
  pluginInstallId: string;
  pluginKey: string;
  appSurfaceKey: string;
  appKey: string;
  provider: string;
  providerRecordType: string;
  providerRecordId: string;
}

interface Row extends Identity {
  id: string;
  section_key: string;
  payload: Record<string, unknown>;
  created_by_user_id: string;
  updated_by_user_id: string;
  created_at: Date;
  updated_at: Date;
}

class InMemoryOverlayStore {
  rows: Row[] = [];

  async list(identity: Identity, sectionKeys: string[] | null) {
    return this.rows
      .filter((row) => matchesIdentity(row, identity))
      .filter((row) => !sectionKeys || sectionKeys.includes(row.section_key))
      .sort((a, b) => a.section_key.localeCompare(b.section_key))
      .map(toResolverRow);
  }

  async upsert(
    identity: Identity,
    input: {
      sectionKey: string;
      payload: Record<string, unknown>;
      callerUserId: string;
    },
  ) {
    const existing = this.rows.find(
      (row) =>
        matchesIdentity(row, identity) && row.section_key === input.sectionKey,
    );
    if (existing) {
      existing.payload = input.payload;
      existing.updated_by_user_id = input.callerUserId;
      existing.updated_at = new Date(existing.updated_at.getTime() + 1000);
      return toResolverRow(existing);
    }
    const now = new Date("2026-06-29T12:00:00.000Z");
    const row: Row = {
      ...identity,
      id: `overlay-${this.rows.length + 1}`,
      section_key: input.sectionKey,
      payload: input.payload,
      created_by_user_id: input.callerUserId,
      updated_by_user_id: input.callerUserId,
      created_at: now,
      updated_at: now,
    };
    this.rows.push(row);
    return toResolverRow(row);
  }
}

function matchesIdentity(row: Identity, identity: Identity) {
  return (
    row.tenantId === identity.tenantId &&
    row.pluginInstallId === identity.pluginInstallId &&
    row.appSurfaceKey === identity.appSurfaceKey &&
    row.appKey === identity.appKey &&
    row.provider === identity.provider &&
    row.providerRecordType === identity.providerRecordType &&
    row.providerRecordId === identity.providerRecordId
  );
}

function toResolverRow(row: Row) {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    plugin_install_id: row.pluginInstallId,
    app_surface_key: row.appSurfaceKey,
    app_key: row.appKey,
    provider: row.provider,
    provider_record_type: row.providerRecordType,
    provider_record_id: row.providerRecordId,
    section_key: row.section_key,
    payload: row.payload,
    created_by_user_id: row.created_by_user_id,
    updated_by_user_id: row.updated_by_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
