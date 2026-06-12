/**
 * Test fakes for the plugin engine (plan 2026-06-12-001 U5).
 *
 * TEST-ONLY module: an in-memory `PluginEngineStore` that mirrors the
 * Drizzle store's contract (unique constraints, audit coupling) so the
 * engine state machine is exercisable without a database. Imported by
 * `engine.test.ts` and the plugin resolver tests; never imported by
 * production code.
 */

import type { EmitAuditEventInput } from "../compliance/emit.js";
import type { PluginSecretsClient } from "./secrets.js";
import type {
  CreateInstallInput,
  PluginComponentRow,
  PluginEngineStore,
  PluginInstallRow,
  UserPluginActivationRow,
  UserPluginActivationTokenRow,
} from "./store.js";

/**
 * In-memory PluginSecretsClient — records every put/delete so tests can
 * assert "deactivation deletes every secret" against the secrets client
 * itself, not just the DB rows.
 */
export interface InMemoryPluginSecrets extends PluginSecretsClient {
  values: Map<string, string>;
  deleted: string[];
}

export function createInMemoryPluginSecrets(): InMemoryPluginSecrets {
  const values = new Map<string, string>();
  const deleted: string[] = [];
  return {
    values,
    deleted,
    async getSecret(name) {
      return values.get(name) ?? null;
    },
    async putSecret(name, value) {
      values.set(name, value);
    },
    async deleteSecret(name) {
      values.delete(name);
      deleted.push(name);
    },
  };
}

export interface InMemoryPluginEngineStore extends PluginEngineStore {
  installs: Map<string, PluginInstallRow>;
  components: Map<string, PluginComponentRow>;
  activations: Map<string, UserPluginActivationRow>;
  tokens: Map<string, UserPluginActivationTokenRow>;
  /** Audit events written "transactionally" with install writes. */
  audits: EmitAuditEventInput[];
  seedInstall(
    partial: Partial<PluginInstallRow> & CreateInstallSeed,
  ): PluginInstallRow;
  seedComponent(
    partial: Partial<PluginComponentRow> & {
      plugin_install_id: string;
      component_key: string;
      component_type: string;
    },
  ): PluginComponentRow;
  seedActivation(
    partial: Partial<UserPluginActivationRow> & {
      user_id: string;
      plugin_install_id: string;
    },
  ): UserPluginActivationRow;
  seedToken(
    partial: Partial<UserPluginActivationTokenRow> & {
      activation_id: string;
      resource_indicator: string;
      secret_ref: string;
    },
  ): UserPluginActivationTokenRow;
}

interface CreateInstallSeed {
  tenant_id: string;
  plugin_key: string;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function createInMemoryPluginEngineStore(): InMemoryPluginEngineStore {
  const installs = new Map<string, PluginInstallRow>();
  const components = new Map<string, PluginComponentRow>();
  const activations = new Map<string, UserPluginActivationRow>();
  const tokens = new Map<string, UserPluginActivationTokenRow>();
  const audits: EmitAuditEventInput[] = [];

  function installRow(
    input: CreateInstallInput,
    overrides: Partial<PluginInstallRow> = {},
  ): PluginInstallRow {
    const now = new Date();
    return {
      id: nextId("install"),
      tenant_id: input.tenantId,
      plugin_key: input.pluginKey,
      pinned_version: input.pinnedVersion,
      pinned_payload_sha256: input.pinnedPayloadSha256,
      state: "installing",
      idempotency_key: input.idempotencyKey,
      last_transition_at: now,
      last_error: null,
      created_at: now,
      updated_at: now,
      ...overrides,
    } as PluginInstallRow;
  }

  const store: InMemoryPluginEngineStore = {
    installs,
    components,
    activations,
    tokens,
    audits,

    seedInstall(partial) {
      const row = installRow(
        {
          tenantId: partial.tenant_id,
          pluginKey: partial.plugin_key,
          pinnedVersion: (partial.pinned_version as string) ?? "0.1.0",
          pinnedPayloadSha256:
            (partial.pinned_payload_sha256 as string) ?? "sha-seed",
          idempotencyKey: (partial.idempotency_key as string) ?? "idem-seed",
        },
        partial,
      );
      installs.set(row.id, row);
      return row;
    },

    seedComponent(partial) {
      const now = new Date();
      const row = {
        id: nextId("component"),
        state: "pending",
        handler_ref: {},
        last_error: null,
        created_at: now,
        updated_at: now,
        ...partial,
      } as PluginComponentRow;
      components.set(row.id, row);
      return row;
    },

    seedActivation(partial) {
      const now = new Date();
      const row = {
        id: nextId("activation"),
        status: "active",
        granted_scopes: [],
        granted_at: now,
        revoked_at: null,
        created_at: now,
        updated_at: now,
        ...partial,
      } as UserPluginActivationRow;
      activations.set(row.id, row);
      return row;
    },

    seedToken(partial) {
      const now = new Date();
      const row = {
        id: nextId("token"),
        status: "active",
        expires_at: null,
        created_at: now,
        updated_at: now,
        ...partial,
      } as UserPluginActivationTokenRow;
      tokens.set(row.id, row);
      return row;
    },

    async getInstallByTenantAndKey(tenantId, pluginKey) {
      for (const row of installs.values()) {
        if (row.tenant_id === tenantId && row.plugin_key === pluginKey) {
          return { ...row };
        }
      }
      return null;
    },

    async getInstallById(tenantId, installId) {
      const row = installs.get(installId);
      return row && row.tenant_id === tenantId ? { ...row } : null;
    },

    async listInstalls(tenantId) {
      return [...installs.values()]
        .filter((row) => row.tenant_id === tenantId)
        .map((row) => ({ ...row }));
    },

    async createInstall(input) {
      const existing = await store.getInstallByTenantAndKey(
        input.tenantId,
        input.pluginKey,
      );
      if (existing) return null; // UNIQUE(tenant, plugin) conflict
      const row = installRow(input);
      installs.set(row.id, row);
      return { ...row };
    },

    async updateInstall(installId, patch, audit) {
      const row = installs.get(installId);
      if (!row) return null;
      if (patch.state !== undefined) row.state = patch.state;
      if (patch.pinnedVersion !== undefined) {
        row.pinned_version = patch.pinnedVersion;
      }
      if (patch.pinnedPayloadSha256 !== undefined) {
        row.pinned_payload_sha256 = patch.pinnedPayloadSha256;
      }
      if (patch.lastError !== undefined) row.last_error = patch.lastError;
      if (patch.touchTransition) row.last_transition_at = new Date();
      row.updated_at = new Date();
      if (audit) audits.push(audit);
      return { ...row };
    },

    async deleteInstall(installId, audit) {
      installs.delete(installId);
      for (const [id, row] of components) {
        if (row.plugin_install_id === installId) components.delete(id);
      }
      if (audit) audits.push(audit);
    },

    async listComponents(installId) {
      return [...components.values()]
        .filter((row) => row.plugin_install_id === installId)
        .map((row) => ({ ...row }));
    },

    async createComponent(input) {
      for (const row of components.values()) {
        if (
          row.plugin_install_id === input.pluginInstallId &&
          row.component_key === input.componentKey
        ) {
          return null; // UNIQUE(install, component_key) conflict
        }
      }
      const row = store.seedComponent({
        plugin_install_id: input.pluginInstallId,
        component_key: input.componentKey,
        component_type: input.componentType,
      });
      return { ...row };
    },

    async updateComponent(componentId, patch) {
      const row = components.get(componentId);
      if (!row) return null;
      if (patch.state !== undefined) row.state = patch.state;
      if (patch.handlerRef !== undefined) row.handler_ref = patch.handlerRef;
      if (patch.lastError !== undefined) row.last_error = patch.lastError;
      row.updated_at = new Date();
      return { ...row };
    },

    async deleteComponent(componentId) {
      components.delete(componentId);
    },

    async listActivations(installId) {
      return [...activations.values()]
        .filter((row) => row.plugin_install_id === installId)
        .map((row) => ({ ...row }));
    },

    async listActivationsForUser(userId, installIds) {
      const allowed = new Set(installIds);
      return [...activations.values()]
        .filter(
          (row) => row.user_id === userId && allowed.has(row.plugin_install_id),
        )
        .map((row) => ({ ...row }));
    },

    async getActivationByUserAndInstall(userId, installId) {
      for (const row of activations.values()) {
        if (row.user_id === userId && row.plugin_install_id === installId) {
          return { ...row };
        }
      }
      return null;
    },

    async countActiveActivations(installId) {
      return [...activations.values()].filter(
        (row) => row.plugin_install_id === installId && row.status === "active",
      ).length;
    },

    async upsertActivation(input, audit) {
      const now = new Date();
      let row = [...activations.values()].find(
        (candidate) =>
          candidate.user_id === input.userId &&
          candidate.plugin_install_id === input.pluginInstallId,
      );
      if (row) {
        row.status = "active";
        row.granted_scopes = input.grantedScopes;
        row.granted_at = now;
        row.revoked_at = null;
        row.updated_at = now;
      } else {
        row = store.seedActivation({
          user_id: input.userId,
          plugin_install_id: input.pluginInstallId,
          granted_scopes: input.grantedScopes,
        });
      }
      if (audit) audits.push(audit);
      return { ...row };
    },

    async updateActivationStatus(activationId, status, audit) {
      const row = activations.get(activationId);
      if (!row) return null;
      row.status = status;
      if (status === "revoked") row.revoked_at = new Date();
      row.updated_at = new Date();
      if (audit) audits.push(audit);
      return { ...row };
    },

    async listActivationTokens(activationId) {
      return [...tokens.values()]
        .filter((row) => row.activation_id === activationId)
        .map((row) => ({ ...row }));
    },

    async upsertActivationToken(input) {
      let row = [...tokens.values()].find(
        (candidate) =>
          candidate.activation_id === input.activationId &&
          candidate.resource_indicator === input.resourceIndicator,
      );
      if (row) {
        row.secret_ref = input.secretRef;
        row.status = "active";
        row.expires_at = input.expiresAt;
        row.updated_at = new Date();
      } else {
        row = store.seedToken({
          activation_id: input.activationId,
          resource_indicator: input.resourceIndicator,
          secret_ref: input.secretRef,
          expires_at: input.expiresAt,
        });
      }
      return { ...row };
    },

    async updateActivationToken(tokenId, patch) {
      const row = tokens.get(tokenId);
      if (!row) return;
      if (patch.expiresAt !== undefined) row.expires_at = patch.expiresAt;
      if (patch.status !== undefined) row.status = patch.status;
      row.updated_at = new Date();
    },

    async deleteActivationTokens(activationId) {
      for (const [id, row] of tokens) {
        if (row.activation_id === activationId) tokens.delete(id);
      }
    },

    async deleteActivation(activationId) {
      activations.delete(activationId);
    },
  };

  return store;
}
