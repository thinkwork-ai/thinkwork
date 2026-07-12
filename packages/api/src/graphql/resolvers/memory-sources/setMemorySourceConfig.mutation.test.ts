import { beforeEach, describe, expect, it, vi } from "vitest";

const requireTenantAdminMock = vi.hoisted(() => vi.fn());
const resolveCallerTenantIdMock = vi.hoisted(() => vi.fn());
const getActiveGrantMock = vi.hoisted(() => vi.fn());

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: requireTenantAdminMock,
}));
vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: resolveCallerTenantIdMock,
}));
vi.mock("../../../lib/memory-sources/policy.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../lib/memory-sources/policy.js")
  >()),
  getActiveGrant: getActiveGrantMock,
}));

import { setMemorySourceConfig } from "./setMemorySourceConfig.mutation.js";

const TENANT = "0015953e-aa13-4cab-8398-2e70f73dda63";
const PROCESSOR = "58a7be3f-8c0f-4a8b-b7be-8f97a1c8e9d2";
const SOURCE = "9b1de2c4-1111-4222-8333-444455556666";

const SHARED_PROCESSOR = { id: PROCESSOR, tenant_id: TENANT, mode: "shared" };
const EXISTING_SOURCE = {
  id: SOURCE,
  tenant_id: TENANT,
  processor_config_id: PROCESSOR,
  source_family: "firecrawl",
  source_binding_key: "web-extract",
  enabled: true,
  boundary: { urls: ["https://example.com/pricing"] },
  created_at: new Date("2026-07-01T00:00:00.000Z"),
};

function buildCtx(options: {
  processorRows: unknown[];
  sourceRows?: unknown[];
}) {
  const limits = [
    vi.fn().mockResolvedValue(options.processorRows),
    vi.fn().mockResolvedValue(options.sourceRows ?? []),
  ];
  let selectCalls = 0;
  const select = vi.fn().mockImplementation(() => ({
    from: () => ({
      where: () => ({ limit: limits[selectCalls++] ?? vi.fn() }),
    }),
  }));

  const written: Record<string, unknown>[] = [];
  const returningRow = (values: Record<string, unknown>) => ({
    id: SOURCE,
    tenant_id: TENANT,
    processor_config_id: PROCESSOR,
    source_family: "firecrawl",
    source_binding_key: "web-extract",
    created_at: new Date("2026-07-12T00:00:00.000Z"),
    ...values,
  });

  const update = vi.fn().mockImplementation(() => ({
    set: (values: Record<string, unknown>) => ({
      where: () => ({
        returning: async () => {
          written.push(values);
          return [returningRow({ ...EXISTING_SOURCE, ...values })];
        },
      }),
    }),
  }));
  const insert = vi.fn().mockImplementation(() => ({
    values: (values: Record<string, unknown>) => ({
      onConflictDoUpdate: () => ({
        returning: async () => {
          written.push(values);
          return [returningRow(values)];
        },
      }),
    }),
  }));

  return {
    ctx: {
      db: { select, update, insert },
      auth: { tenantId: TENANT },
    } as never,
    written,
    update,
    insert,
  };
}

describe("setMemorySourceConfig mutation", () => {
  beforeEach(() => {
    requireTenantAdminMock.mockReset().mockResolvedValue(undefined);
    resolveCallerTenantIdMock.mockReset().mockResolvedValue(null);
    getActiveGrantMock.mockReset().mockResolvedValue(null);
  });

  it("creates a firecrawl source config with a validated URL boundary", async () => {
    const { ctx, written } = buildCtx({ processorRows: [SHARED_PROCESSOR] });
    const result = await setMemorySourceConfig(
      {},
      {
        processorConfigId: PROCESSOR,
        sourceFamily: "firecrawl",
        sourceBindingKey: "web-extract",
        boundary: { urls: ["https://example.com/pricing"], maxPages: 3 },
      },
      ctx,
    );
    expect(requireTenantAdminMock).toHaveBeenCalledWith(ctx, TENANT);
    expect(written[0]).toMatchObject({
      tenant_id: TENANT,
      processor_config_id: PROCESSOR,
      source_family: "firecrawl",
      source_binding_key: "web-extract",
      boundary: { urls: ["https://example.com/pricing"], maxPages: 3 },
      enabled: true,
    });
    expect(result).toMatchObject({
      sourceFamily: "firecrawl",
      sourceBindingKey: "web-extract",
      enabled: true,
    });
  });

  it("rejects malformed URL boundaries before any write (fail closed)", async () => {
    for (const boundary of [
      { urls: ["http://example.com/a"] },
      { urls: ["domain:*.example.com"] },
      { url: ["https://example.com/a"] },
      { maxPages: 0 },
    ]) {
      const { ctx, insert, update } = buildCtx({
        processorRows: [SHARED_PROCESSOR],
      });
      await expect(
        setMemorySourceConfig(
          {},
          {
            processorConfigId: PROCESSOR,
            sourceFamily: "firecrawl",
            sourceBindingKey: "web-extract",
            boundary,
          },
          ctx,
        ),
      ).rejects.toThrow();
      expect(insert).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    }
  });

  it("enforces the grant envelope when an active grant exists", async () => {
    getActiveGrantMock.mockResolvedValue({
      boundary: { urls: ["domain:example.com"] },
    });
    const ok = buildCtx({ processorRows: [SHARED_PROCESSOR] });
    await setMemorySourceConfig(
      {},
      {
        processorConfigId: PROCESSOR,
        sourceFamily: "firecrawl",
        sourceBindingKey: "web-extract",
        boundary: { urls: ["https://example.com/pricing"] },
      },
      ok.ctx,
    );
    expect(ok.written).toHaveLength(1);

    const outside = buildCtx({ processorRows: [SHARED_PROCESSOR] });
    await expect(
      setMemorySourceConfig(
        {},
        {
          processorConfigId: PROCESSOR,
          sourceFamily: "firecrawl",
          sourceBindingKey: "web-extract",
          boundary: { urls: ["https://other.example.net/x"] },
        },
        outside.ctx,
      ),
    ).rejects.toThrow(/outside the granted URL envelope/);
    expect(outside.written).toHaveLength(0);
  });

  it("updates boundary/enabled on an existing config and keeps identity immutable", async () => {
    const { ctx, written } = buildCtx({
      processorRows: [SHARED_PROCESSOR],
      sourceRows: [EXISTING_SOURCE],
    });
    const result = await setMemorySourceConfig(
      {},
      {
        processorConfigId: PROCESSOR,
        sourceConfigId: SOURCE,
        enabled: false,
      },
      ctx,
    );
    expect(written[0]).toMatchObject({
      enabled: false,
      boundary: { urls: ["https://example.com/pricing"] },
    });
    expect(result.enabled).toBe(false);

    const immutable = buildCtx({
      processorRows: [SHARED_PROCESSOR],
      sourceRows: [EXISTING_SOURCE],
    });
    await expect(
      setMemorySourceConfig(
        {},
        {
          processorConfigId: PROCESSOR,
          sourceConfigId: SOURCE,
          sourceFamily: "twenty",
        },
        immutable.ctx,
      ),
    ).rejects.toThrow(/immutable/);
  });

  it("rejects personal processors, unknown families, and missing tenants", async () => {
    const personal = buildCtx({
      processorRows: [{ ...SHARED_PROCESSOR, mode: "personal" }],
    });
    await expect(
      setMemorySourceConfig(
        {},
        {
          processorConfigId: PROCESSOR,
          sourceFamily: "firecrawl",
          sourceBindingKey: "web-extract",
        },
        personal.ctx,
      ),
    ).rejects.toThrow(/shared processors/);

    const unknown = buildCtx({ processorRows: [SHARED_PROCESSOR] });
    await expect(
      setMemorySourceConfig(
        {},
        {
          processorConfigId: PROCESSOR,
          sourceFamily: "slack",
          sourceBindingKey: "x",
        },
        unknown.ctx,
      ),
    ).rejects.toThrow(/Unknown source family/);

    const missing = buildCtx({ processorRows: [] });
    await expect(
      setMemorySourceConfig(
        {},
        {
          processorConfigId: PROCESSOR,
          sourceFamily: "firecrawl",
          sourceBindingKey: "web-extract",
        },
        missing.ctx,
      ),
    ).rejects.toThrow(/processor config not found/i);
  });
});
