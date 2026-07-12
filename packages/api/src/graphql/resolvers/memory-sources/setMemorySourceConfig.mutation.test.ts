import { beforeEach, describe, expect, it, vi } from "vitest";

const requireTenantAdminMock = vi.hoisted(() => vi.fn());
const resolveCallerTenantIdMock = vi.hoisted(() => vi.fn());
const resolveCallerUserIdMock = vi.hoisted(() => vi.fn());
const getActiveGrantMock = vi.hoisted(() => vi.fn());
const resolveConnectionForUserByIdMock = vi.hoisted(() => vi.fn());

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: requireTenantAdminMock,
}));
vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: resolveCallerTenantIdMock,
  resolveCallerUserId: resolveCallerUserIdMock,
}));
vi.mock("../../../lib/oauth-token.js", () => ({
  resolveConnectionForUserById: resolveConnectionForUserByIdMock,
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
const OWNER = "b7de6c4a-8f2e-45cf-a231-5a5f9a3f6c1a";
const CONNECTION = "3f0f2a52-9d24-4e0b-9a51-2f8f19c2a111";
const PERSONAL_PROCESSOR = {
  id: PROCESSOR,
  tenant_id: TENANT,
  mode: "personal",
  target_scope: "user",
  target_id: OWNER,
  created_by_user_id: OWNER,
};
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
    resolveCallerUserIdMock.mockReset().mockResolvedValue(OWNER);
    getActiveGrantMock.mockReset().mockResolvedValue(null);
    resolveConnectionForUserByIdMock.mockReset().mockResolvedValue(null);
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

  // ---- U6 personal self-service --------------------------------------

  it("lets the owner self-configure an email source bound to their own connection", async () => {
    resolveConnectionForUserByIdMock.mockResolvedValue({
      connectionId: CONNECTION,
      providerId: "prov-1",
    });
    const { ctx, written } = buildCtx({
      processorRows: [PERSONAL_PROCESSOR],
    });
    const result = await setMemorySourceConfig(
      {},
      {
        processorConfigId: PROCESSOR,
        sourceFamily: "email",
        sourceBindingKey: CONNECTION,
        boundary: { labels: ["INBOX"], maxMessages: 25 },
      },
      ctx,
    );
    // Owner path: no tenant-admin requirement; the connection ownership
    // was proven with the caller's own user id.
    expect(requireTenantAdminMock).not.toHaveBeenCalled();
    expect(resolveConnectionForUserByIdMock).toHaveBeenCalledWith({
      tenantId: TENANT,
      userId: OWNER,
      providerName: "google_productivity",
      connectionId: CONNECTION,
    });
    expect(written[0]).toMatchObject({
      source_family: "email",
      source_binding_key: CONNECTION,
      boundary: { labels: ["INBOX"], maxMessages: 25 },
    });
    expect(result.sourceFamily).toBe("email");
  });

  it("rejects personal self-config for non-owners, non-email families, and unowned connections", async () => {
    // Caller is not the processor owner.
    resolveCallerUserIdMock.mockResolvedValue("someone-else");
    const notOwner = buildCtx({ processorRows: [PERSONAL_PROCESSOR] });
    await expect(
      setMemorySourceConfig(
        {},
        {
          processorConfigId: PROCESSOR,
          sourceFamily: "email",
          sourceBindingKey: CONNECTION,
        },
        notOwner.ctx,
      ),
    ).rejects.toThrow(/Only the owner/);
    expect(notOwner.insert).not.toHaveBeenCalled();

    // Family other than email is never self-serviceable.
    resolveCallerUserIdMock.mockResolvedValue(OWNER);
    const wrongFamily = buildCtx({ processorRows: [PERSONAL_PROCESSOR] });
    await expect(
      setMemorySourceConfig(
        {},
        {
          processorConfigId: PROCESSOR,
          sourceFamily: "firecrawl",
          sourceBindingKey: "web-extract",
        },
        wrongFamily.ctx,
      ),
    ).rejects.toThrow(/not self-serviceable/);

    // Binding must be an ACTIVE caller-owned Google connection.
    const unowned = buildCtx({ processorRows: [PERSONAL_PROCESSOR] });
    await expect(
      setMemorySourceConfig(
        {},
        {
          processorConfigId: PROCESSOR,
          sourceFamily: "email",
          sourceBindingKey: CONNECTION,
        },
        unowned.ctx,
      ),
    ).rejects.toThrow(/connection you own/);
    expect(unowned.insert).not.toHaveBeenCalled();
  });

  it("rejects malformed email label boundaries fail-closed", async () => {
    resolveConnectionForUserByIdMock.mockResolvedValue({
      connectionId: CONNECTION,
      providerId: "prov-1",
    });
    for (const boundary of [
      { labels: [""] },
      { labels: ["ok", 3] },
      { labels: "INBOX" },
      { maxMessages: 0 },
      { label: ["INBOX"] },
    ]) {
      const { ctx, insert, update } = buildCtx({
        processorRows: [PERSONAL_PROCESSOR],
      });
      await expect(
        setMemorySourceConfig(
          {},
          {
            processorConfigId: PROCESSOR,
            sourceFamily: "email",
            sourceBindingKey: CONNECTION,
            boundary,
          },
          ctx,
        ),
      ).rejects.toThrow();
      expect(insert).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    }
  });

  it("rejects unknown families and missing tenants", async () => {
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
