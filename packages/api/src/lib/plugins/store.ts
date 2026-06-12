/**
 * Plugin engine persistence port (plan 2026-06-12-001 U5).
 *
 * The engine's state machine runs against this thin interface so the
 * transition logic is unit-testable with an in-memory fake while the
 * production implementation stays plain Drizzle. The store carries NO
 * orchestration logic — ordering, idempotency, and state computation all
 * live in `engine.ts`.
 *
 * Compliance coupling: `updateInstall` / `deleteInstall` accept an
 * optional audit event that the Drizzle implementation writes inside the
 * same transaction as the state change (control-evidence tier — a failed
 * audit insert rolls back the transition).
 */

import { and, eq } from "drizzle-orm";
import {
  pluginComponents,
  pluginInstalls,
  userPluginActivations,
  userPluginActivationTokens,
  type PluginComponentState,
  type PluginInstallState,
  type UserPluginActivationStatus,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../../graphql/utils.js";
import {
  emitAuditEvent,
  type EmitAuditEventInput,
} from "../compliance/emit.js";

type DbLike = typeof defaultDb;

export type PluginInstallRow = typeof pluginInstalls.$inferSelect;
export type PluginComponentRow = typeof pluginComponents.$inferSelect;
export type UserPluginActivationRow = typeof userPluginActivations.$inferSelect;
export type UserPluginActivationTokenRow =
  typeof userPluginActivationTokens.$inferSelect;

export interface CreateInstallInput {
  tenantId: string;
  pluginKey: string;
  pinnedVersion: string;
  pinnedPayloadSha256: string;
  idempotencyKey: string;
}

export interface UpdateInstallPatch {
  state?: PluginInstallState;
  pinnedVersion?: string;
  pinnedPayloadSha256?: string;
  lastError?: string | null;
  /** When true, bump last_transition_at (set on every state transition). */
  touchTransition?: boolean;
}

export interface UpdateComponentPatch {
  state?: PluginComponentState;
  handlerRef?: Record<string, unknown>;
  lastError?: string | null;
}

export interface PluginEngineStore {
  getInstallByTenantAndKey(
    tenantId: string,
    pluginKey: string,
  ): Promise<PluginInstallRow | null>;
  getInstallById(
    tenantId: string,
    installId: string,
  ): Promise<PluginInstallRow | null>;
  listInstalls(tenantId: string): Promise<PluginInstallRow[]>;
  /**
   * Insert with ON CONFLICT (tenant, plugin) DO NOTHING; returns the
   * created row, or null when a concurrent caller won the race.
   */
  createInstall(input: CreateInstallInput): Promise<PluginInstallRow | null>;
  updateInstall(
    installId: string,
    patch: UpdateInstallPatch,
    audit?: EmitAuditEventInput,
  ): Promise<PluginInstallRow | null>;
  deleteInstall(installId: string, audit?: EmitAuditEventInput): Promise<void>;

  listComponents(installId: string): Promise<PluginComponentRow[]>;
  createComponent(input: {
    pluginInstallId: string;
    componentKey: string;
    componentType: string;
  }): Promise<PluginComponentRow | null>;
  updateComponent(
    componentId: string,
    patch: UpdateComponentPatch,
  ): Promise<PluginComponentRow | null>;
  deleteComponent(componentId: string): Promise<void>;

  listActivations(installId: string): Promise<UserPluginActivationRow[]>;
  listActivationsForUser(
    userId: string,
    installIds: string[],
  ): Promise<UserPluginActivationRow[]>;
  countActiveActivations(installId: string): Promise<number>;
  updateActivationStatus(
    activationId: string,
    status: UserPluginActivationStatus,
  ): Promise<void>;
  listActivationTokens(
    activationId: string,
  ): Promise<UserPluginActivationTokenRow[]>;
  deleteActivationTokens(activationId: string): Promise<void>;
  deleteActivation(activationId: string): Promise<void>;
}

export function createDrizzlePluginEngineStore(
  db: DbLike = defaultDb,
): PluginEngineStore {
  return {
    async getInstallByTenantAndKey(tenantId, pluginKey) {
      const [row] = await db
        .select()
        .from(pluginInstalls)
        .where(
          and(
            eq(pluginInstalls.tenant_id, tenantId),
            eq(pluginInstalls.plugin_key, pluginKey),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    async getInstallById(tenantId, installId) {
      const [row] = await db
        .select()
        .from(pluginInstalls)
        .where(
          and(
            eq(pluginInstalls.tenant_id, tenantId),
            eq(pluginInstalls.id, installId),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    async listInstalls(tenantId) {
      return db
        .select()
        .from(pluginInstalls)
        .where(eq(pluginInstalls.tenant_id, tenantId));
    },

    async createInstall(input) {
      const [row] = await db
        .insert(pluginInstalls)
        .values({
          tenant_id: input.tenantId,
          plugin_key: input.pluginKey,
          pinned_version: input.pinnedVersion,
          pinned_payload_sha256: input.pinnedPayloadSha256,
          idempotency_key: input.idempotencyKey,
          state: "installing",
        })
        .onConflictDoNothing()
        .returning();
      return row ?? null;
    },

    async updateInstall(installId, patch, audit) {
      const set = installPatchToSet(patch);
      if (audit) {
        return db.transaction(async (tx) => {
          const [row] = await tx
            .update(pluginInstalls)
            .set(set)
            .where(eq(pluginInstalls.id, installId))
            .returning();
          await emitAuditEvent(tx, audit);
          return row ?? null;
        });
      }
      const [row] = await db
        .update(pluginInstalls)
        .set(set)
        .where(eq(pluginInstalls.id, installId))
        .returning();
      return row ?? null;
    },

    async deleteInstall(installId, audit) {
      if (audit) {
        await db.transaction(async (tx) => {
          await tx
            .delete(pluginInstalls)
            .where(eq(pluginInstalls.id, installId));
          await emitAuditEvent(tx, audit);
        });
        return;
      }
      await db.delete(pluginInstalls).where(eq(pluginInstalls.id, installId));
    },

    async listComponents(installId) {
      return db
        .select()
        .from(pluginComponents)
        .where(eq(pluginComponents.plugin_install_id, installId));
    },

    async createComponent(input) {
      const [row] = await db
        .insert(pluginComponents)
        .values({
          plugin_install_id: input.pluginInstallId,
          component_key: input.componentKey,
          component_type: input.componentType,
          state: "pending",
        })
        .onConflictDoNothing()
        .returning();
      return row ?? null;
    },

    async updateComponent(componentId, patch) {
      const set: Record<string, unknown> = { updated_at: new Date() };
      if (patch.state !== undefined) set.state = patch.state;
      if (patch.handlerRef !== undefined) set.handler_ref = patch.handlerRef;
      if (patch.lastError !== undefined) set.last_error = patch.lastError;
      const [row] = await db
        .update(pluginComponents)
        .set(set)
        .where(eq(pluginComponents.id, componentId))
        .returning();
      return row ?? null;
    },

    async deleteComponent(componentId) {
      await db
        .delete(pluginComponents)
        .where(eq(pluginComponents.id, componentId));
    },

    async listActivations(installId) {
      return db
        .select()
        .from(userPluginActivations)
        .where(eq(userPluginActivations.plugin_install_id, installId));
    },

    async listActivationsForUser(userId, installIds) {
      if (installIds.length === 0) return [];
      const rows = await db
        .select()
        .from(userPluginActivations)
        .where(eq(userPluginActivations.user_id, userId));
      const allowed = new Set(installIds);
      return rows.filter((row) => allowed.has(row.plugin_install_id));
    },

    async countActiveActivations(installId) {
      const rows = await db
        .select({ id: userPluginActivations.id })
        .from(userPluginActivations)
        .where(
          and(
            eq(userPluginActivations.plugin_install_id, installId),
            eq(userPluginActivations.status, "active"),
          ),
        );
      return rows.length;
    },

    async updateActivationStatus(activationId, status) {
      await db
        .update(userPluginActivations)
        .set({
          status,
          updated_at: new Date(),
          ...(status === "revoked" ? { revoked_at: new Date() } : {}),
        })
        .where(eq(userPluginActivations.id, activationId));
    },

    async listActivationTokens(activationId) {
      return db
        .select()
        .from(userPluginActivationTokens)
        .where(eq(userPluginActivationTokens.activation_id, activationId));
    },

    async deleteActivationTokens(activationId) {
      await db
        .delete(userPluginActivationTokens)
        .where(eq(userPluginActivationTokens.activation_id, activationId));
    },

    async deleteActivation(activationId) {
      await db
        .delete(userPluginActivations)
        .where(eq(userPluginActivations.id, activationId));
    },
  };
}

function installPatchToSet(patch: UpdateInstallPatch): Record<string, unknown> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.state !== undefined) set.state = patch.state;
  if (patch.pinnedVersion !== undefined)
    set.pinned_version = patch.pinnedVersion;
  if (patch.pinnedPayloadSha256 !== undefined) {
    set.pinned_payload_sha256 = patch.pinnedPayloadSha256;
  }
  if (patch.lastError !== undefined) set.last_error = patch.lastError;
  if (patch.touchTransition) set.last_transition_at = new Date();
  return set;
}
