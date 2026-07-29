/**
 * Normalized inspect service.
 *
 * Canonical read path for "list memory records for this owner". Returns
 * ThinkWorkMemoryRecord[] with no backend-native leakage. Callers should
 * gate UI features on the adapter's {@link MemoryCapabilities}.
 */

import type { MemoryAdapter } from "./adapter.js";
import type { MemoryConfig } from "./config.js";
import type {
  InspectRequest,
  MemoryCapabilities,
  TenantInspectRequest,
  ThinkWorkMemoryRecord,
} from "./types.js";

export type NormalizedInspectService = {
  inspect(request: InspectRequest): Promise<ThinkWorkMemoryRecord[]>;
  /**
   * Cross-owner tenant listing. No engine implements a tenant-wide inspect
   * since Hindsight was retired (THINK-406), so this always resolves `[]`.
   */
  inspectTenant(
    request: TenantInspectRequest,
  ): Promise<ThinkWorkMemoryRecord[]>;
  /**
   * Session-scoped episodes + reflections for one owner. Returns `[]` on
   * engines that don't model an episodic facet — an absent capability is not
   * an error, it just means the UI has nothing to show under that facet.
   */
  inspectEpisodic(request: InspectRequest): Promise<ThinkWorkMemoryRecord[]>;
  capabilities(): Promise<MemoryCapabilities>;
};

export function createInspectService(
  config: MemoryConfig,
  adapter: MemoryAdapter,
): NormalizedInspectService {
  return {
    async inspect(request: InspectRequest): Promise<ThinkWorkMemoryRecord[]> {
      if (!config.enabled) return [];
      const records = await adapter.inspect(request);
      return [...records].sort((a, b) =>
        (b.createdAt || "").localeCompare(a.createdAt || ""),
      );
    },
    async inspectTenant(
      _request: TenantInspectRequest,
    ): Promise<ThinkWorkMemoryRecord[]> {
      return [];
    },
    async inspectEpisodic(
      request: InspectRequest,
    ): Promise<ThinkWorkMemoryRecord[]> {
      if (!config.enabled || !adapter.listEpisodicRecords) return [];
      const records = await adapter.listEpisodicRecords(request);
      return [...records].sort((a, b) =>
        (b.createdAt || "").localeCompare(a.createdAt || ""),
      );
    },
    async capabilities(): Promise<MemoryCapabilities> {
      return adapter.capabilities();
    },
  };
}
