import { eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { tenantContextProviderSettings } from "@thinkwork/database-pg/schema";
import type {
  ContextProviderDescriptor,
  ContextProviderFamily,
} from "./types.js";
import type { TemplateContextEngineConfig } from "../templates/context-engine-config.js";

export type TenantContextProviderSetting = {
  providerId: string;
  family: ContextProviderFamily;
  enabled: boolean;
  defaultEnabled: boolean;
  config: Record<string, unknown>;
  lastTestedAt?: string | null;
  lastTestState?: string | null;
  lastTestLatencyMs?: number | null;
  lastTestError?: string | null;
};

export type MemoryProviderConfig = {
  queryMode?: "recall" | "reflect";
  timeoutMs?: number;
  includeLegacyBanks?: boolean;
};

export type UpsertTenantContextProviderSettingInput = {
  tenantId: string;
  providerId: string;
  enabled: boolean;
  defaultEnabled: boolean;
  config?: Record<string, unknown> | null;
};

const BUILT_IN_PROVIDER_FAMILIES: Record<string, ContextProviderFamily> = {
  memory: "memory",
  wiki: "wiki",
  "workspace-files": "workspace",
  "bedrock-knowledge-base": "knowledge-base",
};

export async function loadTenantContextProviderSettings(
  tenantId: string,
): Promise<TenantContextProviderSetting[]> {
  const rows = await getDb()
    .select({
      providerId: tenantContextProviderSettings.provider_id,
      family: tenantContextProviderSettings.family,
      enabled: tenantContextProviderSettings.enabled,
      defaultEnabled: tenantContextProviderSettings.default_enabled,
      config: tenantContextProviderSettings.config,
      lastTestedAt: tenantContextProviderSettings.last_tested_at,
      lastTestState: tenantContextProviderSettings.last_test_state,
      lastTestLatencyMs: tenantContextProviderSettings.last_test_latency_ms,
      lastTestError: tenantContextProviderSettings.last_test_error,
    })
    .from(tenantContextProviderSettings)
    .where(eq(tenantContextProviderSettings.tenant_id, tenantId));

  const settings: TenantContextProviderSetting[] = [];
  for (const row of rows) {
    const family = providerFamily(row.providerId);
    if (!family) continue;
    settings.push({
      providerId: row.providerId,
      family,
      enabled: row.enabled,
      defaultEnabled: row.enabled ? row.defaultEnabled : false,
      config: normalizeProviderConfig(
        row.providerId,
        isRecord(row.config) ? row.config : {},
      ),
      lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
      lastTestState: row.lastTestState,
      lastTestLatencyMs: row.lastTestLatencyMs,
      lastTestError: row.lastTestError,
    });
  }
  return settings;
}

export function applyTenantContextProviderSettings(
  providers: ContextProviderDescriptor[],
  settings: TenantContextProviderSetting[],
): ContextProviderDescriptor[] {
  const byProviderId = new Map(
    settings.map((setting) => [setting.providerId, setting]),
  );
  return providers.map((provider) => {
    const setting = byProviderId.get(provider.id);
    if (!setting) {
      return {
        ...provider,
        enabled: provider.enabled !== false,
        config: provider.config ?? {},
      };
    }
    return {
      ...provider,
      enabled: setting.enabled,
      defaultEnabled: setting.enabled ? setting.defaultEnabled : false,
      config: setting.config,
    };
  });
}

export function memoryProviderConfig(
  settings: TenantContextProviderSetting[],
): MemoryProviderConfig {
  const setting = settings.find((item) => item.providerId === "memory");
  return normalizeMemoryProviderConfig(setting?.config ?? {});
}

export function constrainTemplateContextEngineConfig(
  config: TemplateContextEngineConfig,
  settings: TenantContextProviderSetting[],
): { config: TemplateContextEngineConfig; removedProviderIds: string[] } {
  const explicitIds = config.providers?.ids;
  if (!explicitIds) return { config, removedProviderIds: [] };

  const disabledBuiltIns = new Set(
    settings
      .filter((setting) => !setting.enabled)
      .map((setting) => setting.providerId),
  );
  const allowedIds = explicitIds.filter((id) => !disabledBuiltIns.has(id));
  const removedProviderIds = explicitIds.filter((id) =>
    disabledBuiltIns.has(id),
  );
  const next: TemplateContextEngineConfig = {
    ...config,
    providers: { ids: allowedIds },
  };
  if (!allowedIds.includes("memory") && config.providerOptions?.memory) {
    delete next.providerOptions;
  }
  return { config: next, removedProviderIds };
}

export async function upsertTenantContextProviderSetting(
  input: UpsertTenantContextProviderSettingInput,
): Promise<TenantContextProviderSetting> {
  const family = providerFamily(input.providerId);
  if (!family) {
    throw new Error(
      `Context provider ${input.providerId} is not tenant-configurable`,
    );
  }
  if (input.defaultEnabled && !input.enabled) {
    throw new Error("Disabled Company Brain sources cannot be defaults");
  }

  const config = normalizeProviderConfig(input.providerId, input.config ?? {});
  const now = new Date();
  const [row] = await getDb()
    .insert(tenantContextProviderSettings)
    .values({
      tenant_id: input.tenantId,
      provider_id: input.providerId,
      family,
      enabled: input.enabled,
      default_enabled: input.defaultEnabled,
      config,
      updated_at: now,
    })
    .onConflictDoUpdate({
      target: [
        tenantContextProviderSettings.tenant_id,
        tenantContextProviderSettings.provider_id,
      ],
      set: {
        family,
        enabled: input.enabled,
        default_enabled: input.defaultEnabled,
        config,
        updated_at: now,
      },
    })
    .returning({
      providerId: tenantContextProviderSettings.provider_id,
      family: tenantContextProviderSettings.family,
      enabled: tenantContextProviderSettings.enabled,
      defaultEnabled: tenantContextProviderSettings.default_enabled,
      config: tenantContextProviderSettings.config,
      lastTestedAt: tenantContextProviderSettings.last_tested_at,
      lastTestState: tenantContextProviderSettings.last_test_state,
      lastTestLatencyMs: tenantContextProviderSettings.last_test_latency_ms,
      lastTestError: tenantContextProviderSettings.last_test_error,
    });

  return {
    providerId: row.providerId,
    family,
    enabled: row.enabled,
    defaultEnabled: row.enabled ? row.defaultEnabled : false,
    config: normalizeProviderConfig(
      row.providerId,
      isRecord(row.config) ? row.config : {},
    ),
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastTestState: row.lastTestState,
    lastTestLatencyMs: row.lastTestLatencyMs,
    lastTestError: row.lastTestError,
  };
}

export function normalizeProviderConfig(
  providerId: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (providerId === "memory") return normalizeMemoryProviderConfig(config);
  return {};
}

export function normalizeMemoryProviderConfig(
  config: Record<string, unknown>,
): MemoryProviderConfig {
  const normalized: MemoryProviderConfig = {};
  if (config.queryMode === "recall" || config.queryMode === "reflect") {
    normalized.queryMode = config.queryMode;
  }
  const timeoutMs =
    typeof config.timeoutMs === "number"
      ? config.timeoutMs
      : Number(config.timeoutMs);
  if (Number.isFinite(timeoutMs)) {
    normalized.timeoutMs = Math.max(
      500,
      Math.min(60_000, Math.floor(timeoutMs)),
    );
  }
  if (typeof config.includeLegacyBanks === "boolean") {
    normalized.includeLegacyBanks = config.includeLegacyBanks;
  }
  return normalized;
}

function providerFamily(providerId: string): ContextProviderFamily | null {
  return BUILT_IN_PROVIDER_FAMILIES[providerId] ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
