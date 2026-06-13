import { describe, expect, it } from "vitest";
import {
  digestInstallKey,
  issuePremiumInstallKey,
  PREMIUM_INSTALL_KEY_PREFIX,
  PremiumInstallKeyThrottle,
  redeemPremiumInstallKey,
  revokePremiumInstallKey,
  type PluginEntitlementRow,
  type PluginInstallKeyRow,
  type PremiumEntitlementActor,
  type PremiumEntitlementCatalogEntry,
  type PremiumEntitlementDeps,
  type PremiumEntitlementStore,
} from "./premium-entitlements.js";
import type { EmitAuditEventInput } from "../compliance/emit.js";

const PLUGIN: PremiumEntitlementCatalogEntry = {
  pluginKey: "company-brain",
  entitlementProductKey: "company-brain-premium",
};
const ACTOR: PremiumEntitlementActor = {
  actorId: "user-operator",
  actorType: "user",
};
const NOW = new Date("2026-06-13T12:00:00.000Z");

describe("premium plugin entitlement service", () => {
  it("issues a high-entropy key once and stores only its digest", async () => {
    const memory = createMemoryPremiumStore();
    const result = await issuePremiumInstallKey(
      {
        pluginKey: PLUGIN.pluginKey,
        tenantId: "tenant-1",
        actor: ACTOR,
        expiresAt: new Date("2026-06-20T00:00:00.000Z"),
      },
      deps(memory),
    );

    expect(result.rawKey.startsWith(PREMIUM_INSTALL_KEY_PREFIX)).toBe(true);
    expect(result.rawKey.length).toBeGreaterThan(40);
    expect(memory.keys[0]!.key_digest).toBe(digestInstallKey(result.rawKey));
    expect(JSON.stringify(memory.keys)).not.toContain(result.rawKey);
    expect(memory.audits.map((event) => event.eventType)).toEqual([
      "plugin.install_key_created",
    ]);
  });

  it("redeems a generated key into one active entitlement and marks the key redeemed", async () => {
    const memory = createMemoryPremiumStore();
    const issued = await issuePremiumInstallKey(
      { pluginKey: PLUGIN.pluginKey, tenantId: "tenant-1", actor: ACTOR },
      deps(memory),
    );

    const redeemed = await redeemPremiumInstallKey(
      {
        tenantId: "tenant-1",
        pluginKey: PLUGIN.pluginKey,
        rawKey: issued.rawKey,
        actor: ACTOR,
      },
      deps(memory),
    );

    expect(redeemed.source).toBe("install_key");
    expect(redeemed.entitlement.status).toBe("active");
    expect(redeemed.entitlement.source).toBe("install_key");
    expect(memory.keys[0]!.status).toBe("redeemed");
    expect(memory.keys[0]!.redeemed_entitlement_id).toBe(
      redeemed.entitlement.id,
    );
    expect(memory.audits.map((event) => event.eventType)).toEqual([
      "plugin.install_key_created",
      "plugin.install_key_redeemed",
      "plugin.entitlement_granted",
    ]);
  });

  it("rejects reuse of the same key without creating another entitlement", async () => {
    const memory = createMemoryPremiumStore();
    const testDeps = deps(memory);
    const issued = await issuePremiumInstallKey(
      { pluginKey: PLUGIN.pluginKey, tenantId: "tenant-1", actor: ACTOR },
      testDeps,
    );
    await redeemPremiumInstallKey(
      {
        tenantId: "tenant-1",
        pluginKey: PLUGIN.pluginKey,
        rawKey: issued.rawKey,
        actor: ACTOR,
      },
      testDeps,
    );

    await expect(
      redeemPremiumInstallKey(
        {
          tenantId: "tenant-1",
          pluginKey: PLUGIN.pluginKey,
          rawKey: issued.rawKey,
          actor: ACTOR,
        },
        testDeps,
      ),
    ).rejects.toMatchObject({
      extensions: { reason: "already_redeemed" },
    });
    expect(memory.entitlements).toHaveLength(1);
    expect(memory.audits.map((event) => event.eventType)).toContain(
      "plugin.install_key_failed",
    );
  });

  it("rejects a tenant-scoped key for another tenant", async () => {
    const memory = createMemoryPremiumStore();
    const issued = await issuePremiumInstallKey(
      { pluginKey: PLUGIN.pluginKey, tenantId: "tenant-1", actor: ACTOR },
      deps(memory),
    );

    await expect(
      redeemPremiumInstallKey(
        {
          tenantId: "tenant-2",
          pluginKey: PLUGIN.pluginKey,
          rawKey: issued.rawKey,
          actor: ACTOR,
        },
        deps(memory),
      ),
    ).rejects.toMatchObject({ extensions: { reason: "wrong_tenant" } });
    expect(memory.entitlements).toHaveLength(0);
  });

  it("uses the configured backdoor key through the normal entitlement path", async () => {
    const memory = createMemoryPremiumStore();
    const result = await redeemPremiumInstallKey(
      {
        tenantId: "tenant-1",
        pluginKey: PLUGIN.pluginKey,
        rawKey: "test-backdoor-key",
        actor: ACTOR,
      },
      deps(memory, {
        getBackdoorKey: async () => "test-backdoor-key",
      }),
    );

    expect(result.source).toBe("backdoor_key");
    expect(result.entitlement.source).toBe("backdoor_key");
    expect(memory.keys).toHaveLength(0);
    expect(memory.audits.map((event) => event.eventType)).toEqual([
      "plugin.install_key_redeemed",
      "plugin.entitlement_granted",
    ]);
  });

  it("throttles repeated invalid install-key attempts and audits failures", async () => {
    const memory = createMemoryPremiumStore();
    const testDeps = deps(memory, {
      throttle: new PremiumInstallKeyThrottle(2, 60_000),
    });

    for (const expectedReason of ["invalid_key", "invalid_key", "throttled"]) {
      await expect(
        redeemPremiumInstallKey(
          {
            tenantId: "tenant-1",
            pluginKey: PLUGIN.pluginKey,
            rawKey: `bad-${expectedReason}`,
            actor: ACTOR,
            request: { ip: "203.0.113.10" },
          },
          testDeps,
        ),
      ).rejects.toMatchObject({ extensions: { reason: expectedReason } });
    }

    expect(
      memory.audits.filter(
        (event) => event.eventType === "plugin.install_key_failed",
      ),
    ).toHaveLength(3);
    expect(memory.audits.at(-1)?.payload.reason).toBe("throttled");
  });

  it("revokes an issued key before redemption", async () => {
    const memory = createMemoryPremiumStore();
    const issued = await issuePremiumInstallKey(
      { pluginKey: PLUGIN.pluginKey, tenantId: "tenant-1", actor: ACTOR },
      deps(memory),
    );

    const revoked = await revokePremiumInstallKey(
      { keyId: issued.key.id, tenantId: "tenant-1", actor: ACTOR },
      deps(memory),
    );

    expect(revoked.key.status).toBe("revoked");
    expect(memory.audits.map((event) => event.eventType)).toContain(
      "plugin.install_key_revoked",
    );
  });
});

interface MemoryPremiumStore extends PremiumEntitlementStore {
  keys: PluginInstallKeyRow[];
  entitlements: PluginEntitlementRow[];
  audits: EmitAuditEventInput[];
}

function deps(
  store: MemoryPremiumStore,
  overrides: Partial<PremiumEntitlementDeps> = {},
): PremiumEntitlementDeps {
  return {
    store,
    resolvePremiumPlugin: async (pluginKey) =>
      pluginKey === PLUGIN.pluginKey ? PLUGIN : null,
    now: () => NOW,
    throttle: new PremiumInstallKeyThrottle(),
    getBackdoorKey: async () => null,
    ...overrides,
  };
}

let id = 0;
function nextId(prefix: string): string {
  id += 1;
  return `${prefix}-${id}`;
}

function createMemoryPremiumStore(): MemoryPremiumStore {
  const keys: PluginInstallKeyRow[] = [];
  const entitlements: PluginEntitlementRow[] = [];
  const audits: EmitAuditEventInput[] = [];

  function activeEntitlement(
    tenantId: string,
    pluginKey: string,
  ): PluginEntitlementRow | null {
    return (
      entitlements.find(
        (row) =>
          row.tenant_id === tenantId &&
          row.plugin_key === pluginKey &&
          row.status === "active",
      ) ?? null
    );
  }

  function grantEntitlement(input: {
    tenantId: string;
    pluginKey: string;
    entitlementProductKey: string;
    source: "install_key" | "backdoor_key";
    actor: PremiumEntitlementActor;
    now: Date;
  }): { entitlement: PluginEntitlementRow; created: boolean } {
    const existing = activeEntitlement(input.tenantId, input.pluginKey);
    if (existing) return { entitlement: { ...existing }, created: false };
    const row = {
      id: nextId("entitlement"),
      tenant_id: input.tenantId,
      plugin_key: input.pluginKey,
      entitlement_product_key: input.entitlementProductKey,
      status: "active",
      source: input.source,
      granted_by_user_id:
        input.actor.actorType === "user" ? input.actor.actorId : null,
      granted_at: input.now,
      revoked_at: null,
      metadata: {},
      created_at: input.now,
      updated_at: input.now,
    } as PluginEntitlementRow;
    entitlements.push(row);
    return { entitlement: { ...row }, created: true };
  }

  const store: MemoryPremiumStore = {
    keys,
    entitlements,
    audits,

    async issueInstallKeyWithAudit(input) {
      const row = {
        id: nextId("key"),
        plugin_key: input.plugin.pluginKey,
        entitlement_product_key: input.plugin.entitlementProductKey,
        key_digest: input.keyDigest,
        digest_algorithm: input.digestAlgorithm,
        key_secret_version: null,
        tenant_id: input.tenantId,
        status: "issued",
        issued_by_user_id:
          input.actor.actorType === "user" ? input.actor.actorId : null,
        issued_at: input.now,
        expires_at: input.expiresAt,
        revoked_at: null,
        redeemed_by_user_id: null,
        redeemed_tenant_id: null,
        redeemed_entitlement_id: null,
        redeemed_at: null,
        audit_correlation_id: null,
        metadata: { keyPreview: input.rawKeyPreview },
        created_at: input.now,
        updated_at: input.now,
      } as PluginInstallKeyRow;
      keys.push(row);
      audits.push({
        tenantId: input.tenantId,
        actorId: input.actor.actorId,
        actorType: input.actor.actorType,
        eventType: "plugin.install_key_created",
        source: "graphql",
        payload: { keyId: row.id, pluginKey: row.plugin_key },
      });
      return { ...row };
    },

    async findInstallKeyByDigest(input) {
      return (
        keys.find(
          (row) =>
            row.plugin_key === input.pluginKey &&
            row.key_digest === input.keyDigest,
        ) ?? null
      );
    },

    async redeemIssuedInstallKeyWithAudit(input) {
      const row = keys.find((candidate) => candidate.id === input.key.id);
      if (!row || row.status !== "issued") {
        return { status: "already_redeemed" as const };
      }
      const { entitlement, created } = grantEntitlement({
        tenantId: input.tenantId,
        pluginKey: row.plugin_key,
        entitlementProductKey: row.entitlement_product_key,
        source: "install_key",
        actor: input.actor,
        now: input.now,
      });
      row.status = "redeemed";
      row.redeemed_by_user_id = input.actor.actorId;
      row.redeemed_tenant_id = input.tenantId;
      row.redeemed_entitlement_id = entitlement.id;
      row.redeemed_at = input.now;
      row.updated_at = input.now;
      audits.push({
        tenantId: input.tenantId,
        actorId: input.actor.actorId,
        actorType: input.actor.actorType,
        eventType: "plugin.install_key_redeemed",
        source: "graphql",
        payload: { keyId: row.id, pluginKey: row.plugin_key },
      });
      if (created) {
        audits.push({
          tenantId: input.tenantId,
          actorId: input.actor.actorId,
          actorType: input.actor.actorType,
          eventType: "plugin.entitlement_granted",
          source: "graphql",
          payload: { entitlementId: entitlement.id, pluginKey: row.plugin_key },
        });
      }
      return {
        status: "redeemed" as const,
        entitlement,
        key: { ...row },
        entitlementCreated: created,
      };
    },

    async grantBackdoorEntitlementWithAudit(input) {
      const { entitlement, created } = grantEntitlement({
        tenantId: input.tenantId,
        pluginKey: input.plugin.pluginKey,
        entitlementProductKey: input.plugin.entitlementProductKey,
        source: "backdoor_key",
        actor: input.actor,
        now: input.now,
      });
      audits.push({
        tenantId: input.tenantId,
        actorId: input.actor.actorId,
        actorType: input.actor.actorType,
        eventType: "plugin.install_key_redeemed",
        source: "graphql",
        payload: { source: "backdoor_key", pluginKey: input.plugin.pluginKey },
      });
      if (created) {
        audits.push({
          tenantId: input.tenantId,
          actorId: input.actor.actorId,
          actorType: input.actor.actorType,
          eventType: "plugin.entitlement_granted",
          source: "graphql",
          payload: {
            entitlementId: entitlement.id,
            pluginKey: input.plugin.pluginKey,
          },
        });
      }
      return { entitlement, created };
    },

    async revokeInstallKeyWithAudit(input) {
      const row = keys.find(
        (candidate) =>
          candidate.id === input.keyId && candidate.tenant_id === input.tenantId,
      );
      if (!row) return null;
      row.status = "revoked";
      row.revoked_at = input.now;
      row.updated_at = input.now;
      audits.push({
        tenantId: input.tenantId,
        actorId: input.actor.actorId,
        actorType: input.actor.actorType,
        eventType: "plugin.install_key_revoked",
        source: "graphql",
        payload: { keyId: row.id, pluginKey: row.plugin_key },
      });
      return { ...row };
    },

    async emitFailureAudit(input) {
      audits.push({
        tenantId: input.tenantId,
        actorId: input.actor.actorId,
        actorType: input.actor.actorType,
        eventType: "plugin.install_key_failed",
        source: "graphql",
        payload: {
          pluginKey: input.pluginKey,
          entitlementProductKey: input.entitlementProductKey,
          reason: input.reason,
        },
      });
    },
  };

  return store;
}

