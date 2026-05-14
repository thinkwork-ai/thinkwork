import type { AdminExtensionDefinition } from "./types";

const ID_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const registry = new Map<string, AdminExtensionDefinition>();

export function registerAdminExtension(definition: AdminExtensionDefinition) {
  assertValidDefinition(definition);
  if (registry.has(definition.id)) {
    throw new Error(`Admin extension "${definition.id}" is already registered`);
  }
  registry.set(definition.id, {
    ...definition,
    navGroup: definition.navGroup ?? "integrations",
    proxyBasePath:
      definition.proxyBasePath ?? `/api/extensions/${definition.id}`,
  });
}

export function getAdminExtension(id: string): AdminExtensionDefinition | null {
  return registry.get(id) ?? null;
}

export function getAdminExtensions(): AdminExtensionDefinition[] {
  return Array.from(registry.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}

export function clearAdminExtensionsForTest() {
  if (import.meta.env.MODE !== "test") {
    throw new Error("clearAdminExtensionsForTest is only available in tests");
  }
  registry.clear();
}

function assertValidDefinition(definition: AdminExtensionDefinition) {
  if (!ID_RE.test(definition.id)) {
    throw new Error(
      "Admin extension id must be 3-64 lowercase letters, numbers, or hyphens",
    );
  }
  if (!definition.label.trim()) {
    throw new Error(`Admin extension "${definition.id}" must have a label`);
  }
  if (typeof definition.load !== "function") {
    throw new Error(`Admin extension "${definition.id}" must provide load()`);
  }
}
