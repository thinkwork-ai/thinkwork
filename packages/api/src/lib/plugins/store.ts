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
  type UserPluginActivationTokenStatus,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../../graphql/utils.js";
import {
  emitAuditEvent,
  type EmitAuditEventInput,
} from "../compliance/emit.js";
import {
  readDeploymentJobSnapshot,
  type PluginDeploymentJobSnapshot,
} from "./deployment-job-read.js";

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

export interface UpsertActivationInput {
  userId: string;
  pluginInstallId: string;
  grantedScopes: string[];
}

export interface UpsertActivationTokenInput {
  activationId: string;
  resourceIndicator: string;
  secretRef: string;
  expiresAt: Date | null;
}

export interface UpdateActivationTokenPatch {
  expiresAt?: Date | null;
  status?: UserPluginActivationTokenStatus;
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
  getActivationByUserAndInstall(
    userId: string,
    installId: string,
  ): Promise<UserPluginActivationRow | null>;
  countActiveActivations(installId: string): Promise<number>;
  /**
   * Create-or-reactivate the (user, install) grant: ON CONFLICT the
   * UNIQUE(user_id, plugin_install_id) pair the row flips back to
   * 'active' with fresh granted_scopes/granted_at and a cleared
   * revoked_at. The optional audit event (plugin.activation_granted)
   * is written in the same transaction.
   */
  upsertActivation(
    input: UpsertActivationInput,
    audit?: EmitAuditEventInput,
  ): Promise<UserPluginActivationRow>;
  updateActivationStatus(
    activationId: string,
    status: UserPluginActivationStatus,
    audit?: EmitAuditEventInput,
  ): Promise<UserPluginActivationRow | null>;
  listActivationTokens(
    activationId: string,
  ): Promise<UserPluginActivationTokenRow[]>;
  /** ON CONFLICT (activation_id, resource_indicator) DO UPDATE. */
  upsertActivationToken(
    input: UpsertActivationTokenInput,
  ): Promise<UserPluginActivationTokenRow>;
  updateActivationToken(
    tokenId: string,
    patch: UpdateActivationTokenPatch,
  ): Promise<void>;
  deleteActivationTokens(activationId: string): Promise<void>;
  deleteActivation(activationId: string): Promise<void>;

  /**
   * Read one managed-application deployment job + its latest event (U11
   * read-time reconciliation input for infrastructure components). Pure
   * read — all job writes go through the deployment mutations.
   */
  getDeploymentJob(
    tenantId: string,
    jobId: string,
  ): Promise<PluginDeploymentJobSnapshot | null>;
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

    async getActivationByUserAndInstall(userId, installId) {
      const [row] = await db
        .select()
        .from(userPluginActivations)
        .where(
          and(
            eq(userPluginActivations.user_id, userId),
            eq(userPluginActivations.plugin_install_id, installId),
          ),
        )
        .limit(1);
      return row ?? null;
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

    async upsertActivation(input, audit) {
      const now = new Date();
      const run = async (dbh: DbLike) => {
        const [row] = await dbh
          .insert(userPluginActivations)
          .values({
            user_id: input.userId,
            plugin_install_id: input.pluginInstallId,
            status: "active",
            granted_scopes: input.grantedScopes,
            granted_at: now,
            revoked_at: null,
          })
          .onConflictDoUpdate({
            target: [
              userPluginActivations.user_id,
              userPluginActivations.plugin_install_id,
            ],
            set: {
              status: "active",
              granted_scopes: input.grantedScopes,
              granted_at: now,
              revoked_at: null,
              updated_at: now,
            },
          })
          .returning();
        if (!row) {
          throw new Error("user_plugin_activations upsert returned no row");
        }
        return row;
      };
      if (audit) {
        return db.transaction(async (tx) => {
          const row = await run(tx as unknown as DbLike);
          await emitAuditEvent(tx, audit);
          return row;
        });
      }
      return run(db);
    },

    async updateActivationStatus(activationId, status, audit) {
      const set = {
        status,
        updated_at: new Date(),
        ...(status === "revoked" ? { revoked_at: new Date() } : {}),
      };
      if (audit) {
        return db.transaction(async (tx) => {
          const [row] = await tx
            .update(userPluginActivations)
            .set(set)
            .where(eq(userPluginActivations.id, activationId))
            .returning();
          await emitAuditEvent(tx, audit);
          return row ?? null;
        });
      }
      const [row] = await db
        .update(userPluginActivations)
        .set(set)
        .where(eq(userPluginActivations.id, activationId))
        .returning();
      return row ?? null;
    },

    async listActivationTokens(activationId) {
      return db
        .select()
        .from(userPluginActivationTokens)
        .where(eq(userPluginActivationTokens.activation_id, activationId));
    },

    async upsertActivationToken(input) {
      const now = new Date();
      const [row] = await db
        .insert(userPluginActivationTokens)
        .values({
          activation_id: input.activationId,
          resource_indicator: input.resourceIndicator,
          secret_ref: input.secretRef,
          status: "active",
          expires_at: input.expiresAt,
        })
        .onConflictDoUpdate({
          target: [
            userPluginActivationTokens.activation_id,
            userPluginActivationTokens.resource_indicator,
          ],
          set: {
            secret_ref: input.secretRef,
            status: "active",
            expires_at: input.expiresAt,
            updated_at: now,
          },
        })
        .returning();
      if (!row) {
        throw new Error("user_plugin_activation_tokens upsert returned no row");
      }
      return row;
    },

    async updateActivationToken(tokenId, patch) {
      const set: Record<string, unknown> = { updated_at: new Date() };
      if (patch.expiresAt !== undefined) set.expires_at = patch.expiresAt;
      if (patch.status !== undefined) set.status = patch.status;
      await db
        .update(userPluginActivationTokens)
        .set(set)
        .where(eq(userPluginActivationTokens.id, tokenId));
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

    getDeploymentJob(tenantId, jobId) {
      return readDeploymentJobSnapshot(tenantId, jobId, db);
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
