/**
 * Premium plugin entitlement lifecycle (THNK-15 U3).
 *
 * Install keys are high-entropy bearer secrets. The raw value is returned once
 * at issue time; persistence stores only a SHA-256 digest. Redemption creates
 * the same persistent entitlement whether the caller presents an issued key or
 * the temporary config-scoped backdoor key.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { GraphQLError } from "graphql";
import { getConfig, getSecret } from "@thinkwork/runtime-config";
import { and, eq } from "drizzle-orm";
import {
  pluginEntitlements,
  pluginInstallKeys,
  type PluginEntitlementSource,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../../graphql/utils.js";
import {
  emitAuditEvent,
  type EmitAuditEventInput,
} from "../compliance/emit.js";

type DbLike = typeof defaultDb;
type AuditTx = Parameters<typeof emitAuditEvent>[0];

export type PluginEntitlementRow = typeof pluginEntitlements.$inferSelect;
export type PluginInstallKeyRow = typeof pluginInstallKeys.$inferSelect;

export const PREMIUM_INSTALL_KEY_PREFIX = "twpi_";
const PREMIUM_INSTALL_KEY_BYTES = 32;
const DEFAULT_THROTTLE_MAX_ATTEMPTS = 5;
const DEFAULT_THROTTLE_WINDOW_MS = 10 * 60 * 1000;

export type PremiumInstallKeyFailureReason =
  | "missing_key"
  | "invalid_key"
  | "wrong_tenant"
  | "already_redeemed"
  | "revoked"
  | "expired"
  | "throttled"
  | "backdoor_disabled";

export class PremiumInstallKeyError extends GraphQLError {
  readonly reason: PremiumInstallKeyFailureReason;

  constructor(reason: PremiumInstallKeyFailureReason, message: string) {
    super(message, {
      extensions: {
        code:
          reason === "throttled"
            ? "TOO_MANY_REQUESTS"
            : reason === "missing_key"
              ? "BAD_USER_INPUT"
              : "FORBIDDEN",
        reason,
      },
    });
    this.reason = reason;
  }
}

export interface PremiumEntitlementActor {
  actorId: string;
  actorType: "user" | "system";
}

export interface PremiumEntitlementCatalogEntry {
  pluginKey: string;
  entitlementProductKey: string;
}

export interface PremiumRequestMetadata {
  ip?: string | null;
  userAgent?: string | null;
}

export interface IssuePremiumInstallKeyInput {
  pluginKey: string;
  tenantId: string;
  expiresAt?: Date | null;
  actor: PremiumEntitlementActor;
  request?: PremiumRequestMetadata;
}

export interface IssuePremiumInstallKeyResult {
  key: PluginInstallKeyRow;
  rawKey: string;
}

export interface RedeemPremiumInstallKeyInput {
  tenantId: string;
  pluginKey: string;
  rawKey: string;
  actor: PremiumEntitlementActor;
  request?: PremiumRequestMetadata;
}

export interface RedeemPremiumInstallKeyResult {
  entitlement: PluginEntitlementRow;
  source: "install_key" | "backdoor_key" | "existing_entitlement";
}

export interface RevokePremiumInstallKeyInput {
  keyId: string;
  tenantId: string;
  actor: PremiumEntitlementActor;
  request?: PremiumRequestMetadata;
}

export interface RevokePremiumInstallKeyResult {
  key: PluginInstallKeyRow;
}

interface RedeemIssuedKeyResult {
  status: "redeemed";
  entitlement: PluginEntitlementRow;
  key: PluginInstallKeyRow;
  entitlementCreated: boolean;
}

export interface PremiumEntitlementStore {
  findActiveEntitlement(input: {
    tenantId: string;
    pluginKey: string;
  }): Promise<PluginEntitlementRow | null>;
  issueInstallKeyWithAudit(input: {
    plugin: PremiumEntitlementCatalogEntry;
    tenantId: string;
    keyDigest: string;
    digestAlgorithm: string;
    rawKeyPreview: string;
    expiresAt: Date | null;
    actor: PremiumEntitlementActor;
    request?: PremiumRequestMetadata;
    now: Date;
  }): Promise<PluginInstallKeyRow>;
  findInstallKeyByDigest(input: {
    pluginKey: string;
    keyDigest: string;
  }): Promise<PluginInstallKeyRow | null>;
  redeemIssuedInstallKeyWithAudit(input: {
    key: PluginInstallKeyRow;
    tenantId: string;
    actor: PremiumEntitlementActor;
    request?: PremiumRequestMetadata;
    now: Date;
  }): Promise<RedeemIssuedKeyResult | { status: "already_redeemed" }>;
  grantBackdoorEntitlementWithAudit(input: {
    plugin: PremiumEntitlementCatalogEntry;
    tenantId: string;
    actor: PremiumEntitlementActor;
    request?: PremiumRequestMetadata;
    now: Date;
  }): Promise<{ entitlement: PluginEntitlementRow; created: boolean }>;
  revokeInstallKeyWithAudit(input: {
    keyId: string;
    tenantId: string;
    actor: PremiumEntitlementActor;
    request?: PremiumRequestMetadata;
    now: Date;
  }): Promise<PluginInstallKeyRow | null>;
  emitFailureAudit(input: {
    tenantId: string;
    pluginKey: string;
    entitlementProductKey?: string | null;
    reason: PremiumInstallKeyFailureReason;
    actor: PremiumEntitlementActor;
    request?: PremiumRequestMetadata;
  }): Promise<void>;
}

export interface PremiumEntitlementDeps {
  store: PremiumEntitlementStore;
  resolvePremiumPlugin(
    pluginKey: string,
  ): Promise<PremiumEntitlementCatalogEntry | null>;
  now(): Date;
  throttle: PremiumInstallKeyThrottle;
  getBackdoorKey(pluginKey: string): Promise<string | null>;
}

export class PremiumInstallKeyThrottle {
  private attempts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maxAttempts = DEFAULT_THROTTLE_MAX_ATTEMPTS,
    private readonly windowMs = DEFAULT_THROTTLE_WINDOW_MS,
  ) {}

  recordFailure(input: {
    tenantId: string;
    pluginKey: string;
    actorId: string;
    ip?: string | null;
    now: Date;
  }): boolean {
    const key = [
      input.tenantId,
      input.pluginKey,
      input.actorId,
      input.ip ?? "unknown-ip",
    ].join(":");
    const nowMs = input.now.getTime();
    const current = this.attempts.get(key);
    if (!current || current.resetAt <= nowMs) {
      this.attempts.set(key, { count: 1, resetAt: nowMs + this.windowMs });
      return false;
    }
    current.count += 1;
    return current.count > this.maxAttempts;
  }

  clear(input: {
    tenantId: string;
    pluginKey: string;
    actorId: string;
    ip?: string | null;
  }): void {
    this.attempts.delete(
      [
        input.tenantId,
        input.pluginKey,
        input.actorId,
        input.ip ?? "unknown-ip",
      ].join(":"),
    );
  }
}

const defaultThrottle = new PremiumInstallKeyThrottle();

export function createDefaultPremiumEntitlementDeps(): PremiumEntitlementDeps {
  return {
    store: createDrizzlePremiumEntitlementStore(defaultDb),
    resolvePremiumPlugin: resolvePremiumPluginFromCatalog,
    now: () => new Date(),
    throttle: defaultThrottle,
    getBackdoorKey: getConfiguredBackdoorKey,
  };
}

export async function issuePremiumInstallKey(
  input: IssuePremiumInstallKeyInput,
  deps = createDefaultPremiumEntitlementDeps(),
): Promise<IssuePremiumInstallKeyResult> {
  const plugin = await requirePremiumPlugin(input.pluginKey, deps);
  const rawKey = generatePremiumInstallKey();
  const now = deps.now();
  const key = await deps.store.issueInstallKeyWithAudit({
    plugin,
    tenantId: input.tenantId,
    keyDigest: digestInstallKey(rawKey),
    digestAlgorithm: "sha256",
    rawKeyPreview: previewInstallKey(rawKey),
    expiresAt: input.expiresAt ?? null,
    actor: input.actor,
    request: input.request,
    now,
  });
  return { key, rawKey };
}

export async function getActivePremiumEntitlement(
  input: { tenantId: string; pluginKey: string },
  deps = createDefaultPremiumEntitlementDeps(),
): Promise<PluginEntitlementRow | null> {
  const plugin = await requirePremiumPlugin(input.pluginKey, deps);
  return deps.store.findActiveEntitlement({
    tenantId: input.tenantId,
    pluginKey: plugin.pluginKey,
  });
}

export async function redeemPremiumInstallKey(
  input: RedeemPremiumInstallKeyInput,
  deps = createDefaultPremiumEntitlementDeps(),
): Promise<RedeemPremiumInstallKeyResult> {
  const plugin = await requirePremiumPlugin(input.pluginKey, deps);
  const rawKey = input.rawKey.trim();
  if (!rawKey) {
    await failRedemption("missing_key", input, deps, plugin);
  }

  const now = deps.now();
  const backdoorKey = await deps.getBackdoorKey(plugin.pluginKey);
  if (backdoorKey && constantTimeEqual(rawKey, backdoorKey)) {
    const { entitlement } = await deps.store.grantBackdoorEntitlementWithAudit({
      plugin,
      tenantId: input.tenantId,
      actor: input.actor,
      request: input.request,
      now,
    });
    deps.throttle.clear({
      tenantId: input.tenantId,
      pluginKey: input.pluginKey,
      actorId: input.actor.actorId,
      ip: input.request?.ip,
    });
    return { entitlement, source: "backdoor_key" };
  }

  const key = await deps.store.findInstallKeyByDigest({
    pluginKey: plugin.pluginKey,
    keyDigest: digestInstallKey(rawKey),
  });
  if (!key) {
    await failRedemption("invalid_key", input, deps, plugin);
    throw new Error("unreachable");
  }
  if (key.tenant_id && key.tenant_id !== input.tenantId) {
    await failRedemption("wrong_tenant", input, deps, plugin);
  }
  if (key.status === "redeemed") {
    await failRedemption("already_redeemed", input, deps, plugin);
  }
  if (key.status === "revoked") {
    await failRedemption("revoked", input, deps, plugin);
  }
  if (key.status === "expired" || (key.expires_at && key.expires_at <= now)) {
    await failRedemption("expired", input, deps, plugin);
  }
  if (key.status !== "issued") {
    await failRedemption("invalid_key", input, deps, plugin);
  }

  const result = await deps.store.redeemIssuedInstallKeyWithAudit({
    key,
    tenantId: input.tenantId,
    actor: input.actor,
    request: input.request,
    now,
  });
  if (result.status === "already_redeemed") {
    await failRedemption("already_redeemed", input, deps, plugin);
    throw new Error("unreachable");
  }
  deps.throttle.clear({
    tenantId: input.tenantId,
    pluginKey: input.pluginKey,
    actorId: input.actor.actorId,
    ip: input.request?.ip,
  });
  return { entitlement: result.entitlement, source: "install_key" };
}

export async function revokePremiumInstallKey(
  input: RevokePremiumInstallKeyInput,
  deps = createDefaultPremiumEntitlementDeps(),
): Promise<RevokePremiumInstallKeyResult> {
  const key = await deps.store.revokeInstallKeyWithAudit({
    keyId: input.keyId,
    tenantId: input.tenantId,
    actor: input.actor,
    request: input.request,
    now: deps.now(),
  });
  if (!key) {
    throw new PremiumInstallKeyError(
      "invalid_key",
      "Premium install key was not found for this tenant",
    );
  }
  return { key };
}

function generatePremiumInstallKey(): string {
  return `${PREMIUM_INSTALL_KEY_PREFIX}${randomBytes(PREMIUM_INSTALL_KEY_BYTES).toString("base64url")}`;
}

export function digestInstallKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

function previewInstallKey(rawKey: string): string {
  return `${rawKey.slice(0, PREMIUM_INSTALL_KEY_PREFIX.length + 6)}...`;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

async function requirePremiumPlugin(
  pluginKey: string,
  deps: PremiumEntitlementDeps,
): Promise<PremiumEntitlementCatalogEntry> {
  const plugin = await deps.resolvePremiumPlugin(pluginKey);
  if (!plugin) {
    throw new GraphQLError(`Plugin '${pluginKey}' is not a premium plugin`, {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return plugin;
}

async function failRedemption(
  reason: PremiumInstallKeyFailureReason,
  input: RedeemPremiumInstallKeyInput,
  deps: PremiumEntitlementDeps,
  plugin: PremiumEntitlementCatalogEntry,
): Promise<never> {
  const throttled = deps.throttle.recordFailure({
    tenantId: input.tenantId,
    pluginKey: input.pluginKey,
    actorId: input.actor.actorId,
    ip: input.request?.ip,
    now: deps.now(),
  });
  const finalReason = throttled ? "throttled" : reason;
  await deps.store.emitFailureAudit({
    tenantId: input.tenantId,
    pluginKey: input.pluginKey,
    entitlementProductKey: plugin.entitlementProductKey,
    reason: finalReason,
    actor: input.actor,
    request: input.request,
  });
  throw new PremiumInstallKeyError(
    finalReason,
    premiumInstallKeyFailureMessage(finalReason),
  );
}

function premiumInstallKeyFailureMessage(
  reason: PremiumInstallKeyFailureReason,
): string {
  switch (reason) {
    case "missing_key":
      return "A ThinkWork install key is required";
    case "wrong_tenant":
      return "This install key is scoped to a different tenant";
    case "already_redeemed":
      return "This install key has already been redeemed";
    case "revoked":
      return "This install key has been revoked";
    case "expired":
      return "This install key has expired";
    case "throttled":
      return "Too many failed install key attempts. Try again later.";
    case "backdoor_disabled":
      return "The temporary install key is not enabled for this stage";
    case "invalid_key":
    default:
      return "Install key is invalid";
  }
}

async function resolvePremiumPluginFromCatalog(
  pluginKey: string,
): Promise<PremiumEntitlementCatalogEntry | null> {
  const { getPluginCatalog } = await import("./catalog-source.js");
  const catalog = await getPluginCatalog();
  const entry = catalog.plugins.find((plugin) => plugin.pluginKey === pluginKey);
  if (!entry?.premium) return null;
  return {
    pluginKey: entry.pluginKey,
    entitlementProductKey: entry.premium.entitlementProductKey,
  };
}

export async function getConfiguredBackdoorKey(
  pluginKey: string,
): Promise<string | null> {
  if (pluginKey !== "company-brain") return null;
  const stage = getConfig("STAGE") ?? process.env.STAGE ?? "";
  const allowedStages = (getConfig("COMPANY_BRAIN_BACKDOOR_INSTALL_KEY_STAGES") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!stage || !allowedStages.includes(stage)) return null;

  const raw = getConfig("COMPANY_BRAIN_BACKDOOR_INSTALL_KEY");
  if (raw) return raw;

  const secretArn = getConfig("COMPANY_BRAIN_BACKDOOR_INSTALL_KEY_SECRET_ARN");
  if (!secretArn) return null;
  return (await getSecret(secretArn)).trim() || null;
}

export function createDrizzlePremiumEntitlementStore(
  db: DbLike = defaultDb,
): PremiumEntitlementStore {
  return {
    async findActiveEntitlement(input) {
      const [row] = await db
        .select()
        .from(pluginEntitlements)
        .where(
          and(
            eq(pluginEntitlements.tenant_id, input.tenantId),
            eq(pluginEntitlements.plugin_key, input.pluginKey),
            eq(pluginEntitlements.status, "active"),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    async issueInstallKeyWithAudit(input) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .insert(pluginInstallKeys)
          .values({
            plugin_key: input.plugin.pluginKey,
            entitlement_product_key: input.plugin.entitlementProductKey,
            key_digest: input.keyDigest,
            digest_algorithm: input.digestAlgorithm,
            tenant_id: input.tenantId,
            status: "issued",
            issued_by_user_id:
              input.actor.actorType === "user" ? input.actor.actorId : null,
            issued_at: input.now,
            expires_at: input.expiresAt,
            metadata: { keyPreview: input.rawKeyPreview },
          })
          .returning();
        const key = row!;
        await emitAuditEvent(tx, {
          ...auditBase(input.tenantId, input.actor, input.request),
          eventType: "plugin.install_key_created",
          payload: {
            pluginKey: input.plugin.pluginKey,
            entitlementProductKey: input.plugin.entitlementProductKey,
            keyId: key.id,
            tenantScoped: true,
            expiresAt: input.expiresAt?.toISOString() ?? null,
          },
          resourceType: "plugin_install_key",
          resourceId: key.id,
          action: "create",
          outcome: "success",
        });
        return key;
      });
    },

    async findInstallKeyByDigest(input) {
      const [row] = await db
        .select()
        .from(pluginInstallKeys)
        .where(
          and(
            eq(pluginInstallKeys.plugin_key, input.pluginKey),
            eq(pluginInstallKeys.key_digest, input.keyDigest),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    async redeemIssuedInstallKeyWithAudit(input) {
      return db.transaction(async (tx) => {
        const { entitlement, created } = await grantEntitlementInTx(tx, {
          tenantId: input.tenantId,
          pluginKey: input.key.plugin_key,
          entitlementProductKey: input.key.entitlement_product_key,
          source: "install_key",
          actor: input.actor,
          now: input.now,
        });

        const [redeemedKey] = await tx
          .update(pluginInstallKeys)
          .set({
            status: "redeemed",
            redeemed_by_user_id:
              input.actor.actorType === "user" ? input.actor.actorId : null,
            redeemed_tenant_id: input.tenantId,
            redeemed_entitlement_id: entitlement.id,
            redeemed_at: input.now,
            updated_at: input.now,
          })
          .where(
            and(
              eq(pluginInstallKeys.id, input.key.id),
              eq(pluginInstallKeys.status, "issued"),
            ),
          )
          .returning();
        if (!redeemedKey) return { status: "already_redeemed" as const };

        await emitRedemptionAudits(tx, {
          tenantId: input.tenantId,
          actor: input.actor,
          request: input.request,
          pluginKey: input.key.plugin_key,
          entitlementProductKey: input.key.entitlement_product_key,
          keyId: redeemedKey.id,
          entitlementId: entitlement.id,
          source: "install_key",
          entitlementCreated: created,
        });
        return {
          status: "redeemed" as const,
          entitlement,
          key: redeemedKey,
          entitlementCreated: created,
        };
      });
    },

    async grantBackdoorEntitlementWithAudit(input) {
      return db.transaction(async (tx) => {
        const { entitlement, created } = await grantEntitlementInTx(tx, {
          tenantId: input.tenantId,
          pluginKey: input.plugin.pluginKey,
          entitlementProductKey: input.plugin.entitlementProductKey,
          source: "backdoor_key",
          actor: input.actor,
          now: input.now,
        });
        await emitRedemptionAudits(tx, {
          tenantId: input.tenantId,
          actor: input.actor,
          request: input.request,
          pluginKey: input.plugin.pluginKey,
          entitlementProductKey: input.plugin.entitlementProductKey,
          keyId: null,
          entitlementId: entitlement.id,
          source: "backdoor_key",
          entitlementCreated: created,
        });
        return { entitlement, created };
      });
    },

    async revokeInstallKeyWithAudit(input) {
      return db.transaction(async (tx) => {
        const [key] = await tx
          .update(pluginInstallKeys)
          .set({
            status: "revoked",
            revoked_at: input.now,
            updated_at: input.now,
          })
          .where(
            and(
              eq(pluginInstallKeys.id, input.keyId),
              eq(pluginInstallKeys.tenant_id, input.tenantId),
            ),
          )
          .returning();
        if (!key) return null;
        await emitAuditEvent(tx, {
          ...auditBase(input.tenantId, input.actor, input.request),
          eventType: "plugin.install_key_revoked",
          payload: {
            pluginKey: key.plugin_key,
            entitlementProductKey: key.entitlement_product_key,
            keyId: key.id,
          },
          resourceType: "plugin_install_key",
          resourceId: key.id,
          action: "revoke",
          outcome: "success",
        });
        return key;
      });
    },

    async emitFailureAudit(input) {
      await emitAuditEvent(db, {
        ...auditBase(input.tenantId, input.actor, input.request),
        eventType: "plugin.install_key_failed",
        payload: {
          pluginKey: input.pluginKey,
          entitlementProductKey: input.entitlementProductKey ?? null,
          reason: input.reason,
        },
        resourceType: "plugin_install_key",
        action: "redeem",
        outcome: "failure",
      });
    },
  };
}

async function grantEntitlementInTx(
  tx: AuditTx,
  input: {
    tenantId: string;
    pluginKey: string;
    entitlementProductKey: string;
    source: PluginEntitlementSource;
    actor: PremiumEntitlementActor;
    now: Date;
  },
): Promise<{ entitlement: PluginEntitlementRow; created: boolean }> {
  const [existing] = await tx
    .select()
    .from(pluginEntitlements)
    .where(
      and(
        eq(pluginEntitlements.tenant_id, input.tenantId),
        eq(pluginEntitlements.plugin_key, input.pluginKey),
        eq(pluginEntitlements.status, "active"),
      ),
    )
    .limit(1);
  if (existing) return { entitlement: existing, created: false };

  const [created] = await tx
    .insert(pluginEntitlements)
    .values({
      tenant_id: input.tenantId,
      plugin_key: input.pluginKey,
      entitlement_product_key: input.entitlementProductKey,
      status: "active",
      source: input.source,
      granted_by_user_id:
        input.actor.actorType === "user" ? input.actor.actorId : null,
      granted_at: input.now,
    })
    .returning();
  return { entitlement: created!, created: true };
}

async function emitRedemptionAudits(
  tx: AuditTx,
  input: {
    tenantId: string;
    actor: PremiumEntitlementActor;
    request?: PremiumRequestMetadata;
    pluginKey: string;
    entitlementProductKey: string;
    keyId: string | null;
    entitlementId: string;
    source: "install_key" | "backdoor_key";
    entitlementCreated: boolean;
  },
): Promise<void> {
  await emitAuditEvent(tx, {
    ...auditBase(input.tenantId, input.actor, input.request),
    eventType: "plugin.install_key_redeemed",
    payload: {
      pluginKey: input.pluginKey,
      entitlementProductKey: input.entitlementProductKey,
      keyId: input.keyId,
      source: input.source,
      entitlementId: input.entitlementId,
    },
    resourceType: "plugin_install_key",
    resourceId: input.keyId ?? input.entitlementId,
    action: "redeem",
    outcome: "success",
  });
  if (input.entitlementCreated) {
    await emitAuditEvent(tx, {
      ...auditBase(input.tenantId, input.actor, input.request),
      eventType: "plugin.entitlement_granted",
      payload: {
        pluginKey: input.pluginKey,
        entitlementProductKey: input.entitlementProductKey,
        source: input.source,
        entitlementId: input.entitlementId,
      },
      resourceType: "plugin_entitlement",
      resourceId: input.entitlementId,
      action: "grant",
      outcome: "success",
    });
  }
}

function auditBase(
  tenantId: string,
  actor: PremiumEntitlementActor,
  request?: PremiumRequestMetadata,
): Pick<
  EmitAuditEventInput,
  "tenantId" | "actorId" | "actorType" | "source" | "payload"
> & { payload: Record<string, unknown> } {
  return {
    tenantId,
    actorId: actor.actorId,
    actorType: actor.actorType,
    source: "graphql",
    payload: {
      ip: request?.ip ?? null,
      userAgent: request?.userAgent ?? null,
    },
  };
}
